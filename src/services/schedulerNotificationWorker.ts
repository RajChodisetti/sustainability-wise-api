import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import {
  appPushDeviceFences,
  appPushDevices,
  globalUsers,
  portalScheduleEvents,
  schedulerNotificationDeliveries,
  schedulerNotificationJobs,
  type SchedulerNotificationData,
} from '../db/schema/shared.js';
import {
  isSchedulerNotificationEligible,
  type SchedulerNotificationKind,
} from './schedulerNotificationService.js';

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_MESSAGE_BATCH_SIZE = 100;
const EXPO_RECEIPT_BATCH_SIZE = 1_000;
const MAX_RECEIPT_CHECKS = 8;

type NotificationJob = typeof schedulerNotificationJobs.$inferSelect;
type NotificationDelivery = typeof schedulerNotificationDeliveries.$inferSelect;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: 'scheduler-updates' | 'scheduler';
};

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushReceipt = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

export interface ExpoPushTransport {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  getReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>>;
}

class ExpoRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ExpoRequestError';
  }
}

export function chunkExpoItems<T>(items: T[], maximum: number): T[][] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error('Chunk maximum must be a positive integer');
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += maximum) {
    chunks.push(items.slice(index, index + maximum));
  }
  return chunks;
}

export function schedulerAndroidChannel(
  sourceApp: string,
): 'scheduler-updates' | 'scheduler' {
  return sourceApp === 'installhub' ? 'scheduler' : 'scheduler-updates';
}

export function automaticNotificationStillRelevant(
  kind: string,
  scheduledStartAt: Date,
  scheduledEndAt: Date | null,
  now = new Date(),
): boolean {
  if (kind === 'one_day_before') {
    return now.getTime() < scheduledStartAt.getTime();
  }
  if (kind === 'day_of') {
    const maximumExpiry = scheduledStartAt.getTime() + 24 * 60 * 60_000;
    const expiry = scheduledEndAt && scheduledEndAt.getTime() > scheduledStartAt.getTime()
      ? Math.min(scheduledEndAt.getTime(), maximumExpiry)
      : maximumExpiry;
    return now.getTime() < expiry;
  }
  return true;
}

async function expoPostJson(
  url: string,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(config.expoPush.accessToken
          ? { authorization: `Bearer ${config.expoPush.accessToken}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.expoPush.requestTimeoutMs),
    });
  } catch {
    throw new ExpoRequestError('expo_network_error');
  }
  if (!response.ok) {
    throw new ExpoRequestError(`expo_http_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ExpoRequestError('expo_invalid_json');
  }
}

export const expoHttpTransport: ExpoPushTransport = {
  async send(messages) {
    if (messages.length < 1 || messages.length > EXPO_MESSAGE_BATCH_SIZE) {
      throw new ExpoRequestError('expo_invalid_message_batch');
    }
    const response = await expoPostJson(EXPO_SEND_URL, messages) as {
      data?: ExpoPushTicket[] | ExpoPushTicket;
    };
    const tickets = Array.isArray(response.data)
      ? response.data
      : response.data
        ? [response.data]
        : [];
    if (tickets.length !== messages.length) {
      throw new ExpoRequestError('expo_ticket_count_mismatch');
    }
    return tickets;
  },

  async getReceipts(ids) {
    if (ids.length < 1 || ids.length > EXPO_RECEIPT_BATCH_SIZE) {
      throw new ExpoRequestError('expo_invalid_receipt_batch');
    }
    const response = await expoPostJson(EXPO_RECEIPTS_URL, { ids }) as {
      data?: Record<string, ExpoPushReceipt>;
    };
    return response.data ?? {};
  },
};

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, Math.min(attempts - 1, 6))));
}

function safeWorkerError(error: unknown): string {
  if (error instanceof ExpoRequestError) return error.code;
  return 'notification_delivery_failed';
}

function claimedJobCondition(jobId: string, claimToken: string) {
  return and(
    eq(schedulerNotificationJobs.id, jobId),
    eq(schedulerNotificationJobs.status, 'processing'),
    eq(schedulerNotificationJobs.claimToken, claimToken),
  );
}

function deliveryClaimCondition(
  deliveryId: string,
  jobId: string,
  claimToken: string,
) {
  return and(
    eq(schedulerNotificationDeliveries.id, deliveryId),
    sql`EXISTS (
      SELECT 1
      FROM scheduler_notification_jobs notification_job
      WHERE notification_job.id = ${jobId}
        AND notification_job.status = 'processing'
        AND notification_job.claim_token = ${claimToken}
    )`,
  );
}

async function refreshJobClaim(jobId: string, claimToken: string): Promise<boolean> {
  const [row] = await db.update(schedulerNotificationJobs).set({
    claimedAt: new Date(),
    updatedAt: new Date(),
  }).where(claimedJobCondition(jobId, claimToken))
    .returning({ id: schedulerNotificationJobs.id });
  const refreshed = Boolean(row);
  if (!refreshed) {
    // A scheduler mutation can terminalize a job while a worker is creating
    // its per-device snapshot. Clean up any delivery inserted after the
    // mutation's own delivery update so terminal jobs cannot strand work.
    await terminalizeDeliveriesForTerminalJob(jobId);
  }
  return refreshed;
}

async function terminalizeDeliveriesForTerminalJob(jobId: string): Promise<void> {
  const now = new Date();
  await db.update(schedulerNotificationDeliveries).set({
    status: 'failed',
    lastError: 'notification_job_no_longer_active',
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(schedulerNotificationDeliveries.jobId, jobId),
    inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
    sql`EXISTS (
      SELECT 1
      FROM scheduler_notification_jobs notification_job
      WHERE notification_job.id = ${jobId}
        AND notification_job.status IN ('cancelled', 'failed', 'delivered')
    )`,
  ));
}

function payloadMatchesCurrentEvent(
  job: NotificationJob,
  event: typeof portalScheduleEvents.$inferSelect,
): boolean {
  if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) return false;
  const payload = job.payload as Partial<SchedulerNotificationData>;
  const stableFieldsMatch = payload.type === 'scheduler'
    && payload.notificationKind === job.notificationKind
    && payload.eventId === event.id
    && payload.sourceApp === event.sourceApp
    && payload.sourceType === event.sourceType
    && payload.sourceId === event.sourceId
    && job.eventId === event.id
    && job.sourceApp === event.sourceApp;
  if (!stableFieldsMatch) return false;
  if (job.notificationKind === 'one_day_before' || job.notificationKind === 'day_of') {
    return payload.scheduledStartAt === event.scheduledStartAt.toISOString();
  }
  return true;
}

async function terminalCancelIneligibleClaim(
  job: NotificationJob,
  claimToken: string,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [claimed] = await tx.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(claimedJobCondition(job.id, claimToken))
      .for('update')
      .limit(1);
    if (!claimed) return;
    await tx.update(schedulerNotificationDeliveries).set({
      status: 'failed',
      lastError: 'scheduler_target_no_longer_eligible',
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(schedulerNotificationDeliveries.jobId, job.id),
      inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
    ));
    await tx.update(schedulerNotificationJobs).set({
      status: 'cancelled',
      claimToken: null,
      claimedAt: null,
      lastError: 'scheduler_target_no_longer_eligible',
      completedAt: now,
      updatedAt: now,
    }).where(claimedJobCondition(job.id, claimToken));
  });
}

/** Re-read event + linked product state at the external-send boundary. */
async function revalidateClaimedJobEligibility(
  job: NotificationJob,
  claimToken: string,
): Promise<boolean> {
  const [event] = await db.select()
    .from(portalScheduleEvents)
    .where(eq(portalScheduleEvents.id, job.eventId))
    .limit(1);
  const eligible = Boolean(event)
    && payloadMatchesCurrentEvent(job, event!)
    && automaticNotificationStillRelevant(
      job.notificationKind,
      event!.scheduledStartAt,
      event!.scheduledEndAt,
    )
    && await isSchedulerNotificationEligible(
      db,
      event!,
      job.globalUserId,
      job.notificationKind as SchedulerNotificationKind,
    );
  if (eligible) return true;
  await terminalCancelIneligibleClaim(job, claimToken);
  return false;
}

export async function claimDueSchedulerNotificationJobs(
  now = new Date(),
  limit = config.expoPush.claimBatchSize,
): Promise<Array<NotificationJob & { claimToken: string }>> {
  const batchSize = Math.min(100, Math.max(1, limit));
  const staleBefore = new Date(now.getTime() - config.expoPush.staleClaimMs);

  return db.transaction(async (tx) => {
    const hasDeliveredDestination = sql`EXISTS (
      SELECT 1
      FROM scheduler_notification_deliveries completed_delivery
      WHERE completed_delivery.job_id = ${schedulerNotificationJobs.id}
        AND completed_delivery.status = 'delivered'
    )`;
    const exhaustedJobs = await tx.update(schedulerNotificationJobs).set({
      status: sql`CASE WHEN ${hasDeliveredDestination} THEN 'delivered' ELSE 'failed' END`,
      claimToken: null,
      claimedAt: null,
      lastError: sql`CASE WHEN ${hasDeliveredDestination}
        THEN NULL ELSE 'notification_attempts_exhausted' END`,
      completedAt: now,
      updatedAt: now,
    }).where(and(
      or(
        inArray(schedulerNotificationJobs.status, ['queued', 'awaiting_receipts']),
        and(
          eq(schedulerNotificationJobs.status, 'processing'),
          lt(schedulerNotificationJobs.claimedAt, staleBefore),
        ),
      ),
      sql`${schedulerNotificationJobs.attempts} >= ${schedulerNotificationJobs.maxAttempts}`,
    )).returning({ id: schedulerNotificationJobs.id });
    if (exhaustedJobs.length > 0) {
      await tx.update(schedulerNotificationDeliveries).set({
        status: 'failed',
        lastError: 'notification_attempts_exhausted',
        completedAt: now,
        updatedAt: now,
      }).where(and(
        inArray(
          schedulerNotificationDeliveries.jobId,
          exhaustedJobs.map((job) => job.id),
        ),
        inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
      ));
    }

    const candidates = await tx.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(and(
        or(
          and(
            inArray(schedulerNotificationJobs.status, ['queued', 'awaiting_receipts']),
            lte(schedulerNotificationJobs.availableAt, now),
          ),
          and(
            eq(schedulerNotificationJobs.status, 'processing'),
            lt(schedulerNotificationJobs.claimedAt, staleBefore),
          ),
        ),
        sql`${schedulerNotificationJobs.attempts} < ${schedulerNotificationJobs.maxAttempts}`,
      ))
      .orderBy(
        asc(schedulerNotificationJobs.availableAt),
        asc(schedulerNotificationJobs.createdAt),
      )
      .for('update', { skipLocked: true })
      .limit(batchSize);
    if (candidates.length === 0) return [];

    const claimToken = randomUUID();
    const rows = await tx.update(schedulerNotificationJobs).set({
      status: 'processing',
      claimToken,
      claimedAt: now,
      attempts: sql`${schedulerNotificationJobs.attempts} + 1`,
      updatedAt: now,
    }).where(inArray(
      schedulerNotificationJobs.id,
      candidates.map((candidate) => candidate.id),
    )).returning();
    return rows.map((row) => ({ ...row, claimToken }));
  });
}

async function snapshotPendingDeliveries(
  job: NotificationJob,
  claimToken: string,
): Promise<NotificationDelivery[]> {
  return db.transaction(async (tx) => {
    // Lock the claimed job before creating delivery rows. Scheduler mutation
    // paths use the same job -> deliveries lock order, so cancellation either
    // wins before this check (no insert) or follows and terminalizes every row.
    const [claimed] = await tx.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(claimedJobCondition(job.id, claimToken))
      .for('update')
      .limit(1);
    if (!claimed) return [];

    const devices = await tx.select({
      id: appPushDevices.id,
      expoPushToken: appPushDevices.expoPushToken,
      registrationGeneration: appPushDevices.registrationGeneration,
      updatedAt: appPushDevices.updatedAt,
    }).from(appPushDevices)
      .innerJoin(appPushDeviceFences, and(
        eq(appPushDeviceFences.app, appPushDevices.app),
        eq(appPushDeviceFences.deviceId, appPushDevices.deviceId),
        eq(appPushDeviceFences.globalUserId, appPushDevices.globalUserId),
        eq(
          appPushDeviceFences.registrationGeneration,
          appPushDevices.registrationGeneration,
        ),
        eq(appPushDeviceFences.enabled, true),
      ))
      .innerJoin(globalUsers, and(
        eq(globalUsers.id, appPushDevices.globalUserId),
        eq(globalUsers.isActive, true),
      ))
      .where(and(
        eq(appPushDevices.globalUserId, job.globalUserId),
        eq(appPushDevices.app, job.sourceApp),
        eq(appPushDevices.enabled, true),
      ))
      .orderBy(desc(appPushDevices.updatedAt));

    const uniqueDevices = new Map<string, typeof devices[number]>();
    for (const device of devices) {
      if (!uniqueDevices.has(device.expoPushToken)) {
        uniqueDevices.set(device.expoPushToken, device);
      }
    }
    const now = new Date();
    for (const device of uniqueDevices.values()) {
      await tx.insert(schedulerNotificationDeliveries).values({
        id: randomUUID(),
        jobId: job.id,
        deviceRegistrationId: device.id,
        registrationGeneration: device.registrationGeneration,
        expoPushToken: device.expoPushToken,
        status: 'pending',
        receiptChecks: 0,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({
        target: [
          schedulerNotificationDeliveries.jobId,
          schedulerNotificationDeliveries.deviceRegistrationId,
        ],
      });
      await tx.update(schedulerNotificationDeliveries).set({
        expoPushToken: device.expoPushToken,
        registrationGeneration: device.registrationGeneration,
        updatedAt: now,
      }).where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        eq(schedulerNotificationDeliveries.deviceRegistrationId, device.id),
        eq(schedulerNotificationDeliveries.status, 'pending'),
      ));
    }

    const activeDeviceIds = new Set([...uniqueDevices.values()].map((device) => device.id));
    const pending = await tx.select()
      .from(schedulerNotificationDeliveries)
      .where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        eq(schedulerNotificationDeliveries.status, 'pending'),
      ));
    const activePending: NotificationDelivery[] = [];
    for (const delivery of pending) {
      if (activeDeviceIds.has(delivery.deviceRegistrationId)) {
        activePending.push(delivery);
        continue;
      }
      await tx.update(schedulerNotificationDeliveries).set({
        status: 'failed',
        lastError: 'registration_disabled_or_replaced',
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(schedulerNotificationDeliveries.id, delivery.id),
        eq(schedulerNotificationDeliveries.status, 'pending'),
      ));
    }
    return activePending;
  });
}

async function disableDeviceNotRegistered(delivery: NotificationDelivery): Promise<void> {
  await db.transaction(async (tx) => {
    const [registration] = await tx.select({ id: appPushDevices.id })
      .from(appPushDevices).where(and(
      eq(appPushDevices.id, delivery.deviceRegistrationId),
      eq(appPushDevices.expoPushToken, delivery.expoPushToken),
      eq(appPushDevices.registrationGeneration, delivery.registrationGeneration),
    )).for('update').limit(1);
    if (!registration) return;
    const now = new Date();
    await tx.update(appPushDevices).set({
      enabled: false,
      disabledReason: 'DeviceNotRegistered',
      updatedAt: now,
    }).where(and(
      eq(appPushDevices.id, delivery.deviceRegistrationId),
      eq(appPushDevices.expoPushToken, delivery.expoPushToken),
    ));
  });
}

async function updateDeliveryFromTicket(
  job: NotificationJob,
  claimToken: string,
  delivery: NotificationDelivery,
  ticket: ExpoPushTicket,
  now: Date,
): Promise<void> {
  if (ticket.status === 'ok' && ticket.id) {
    await db.update(schedulerNotificationDeliveries).set({
      status: 'ticketed',
      ticketId: ticket.id,
      receiptAvailableAt: new Date(now.getTime() + config.expoPush.receiptDelayMs),
      lastError: null,
      updatedAt: now,
    }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
    return;
  }

  const errorCode = ticket.details?.error ?? 'expo_ticket_error';
  if (errorCode === 'DeviceNotRegistered') {
    await disableDeviceNotRegistered(delivery);
  }
  if (errorCode === 'MessageRateExceeded') {
    // Expo explicitly classifies this per-message ticket error as retryable.
    // Keep only this device pending; ticketed/successful siblings are retained
    // and the job-level backoff prevents a hot retry loop.
    await db.update(schedulerNotificationDeliveries).set({
      status: 'pending',
      lastError: errorCode,
      completedAt: null,
      updatedAt: now,
    }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
    return;
  }
  await db.update(schedulerNotificationDeliveries).set({
    status: 'failed',
    lastError: errorCode,
    completedAt: now,
    updatedAt: now,
  }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
}

async function revalidateDeliveryBatch(
  job: NotificationJob,
  claimToken: string,
  deliveries: NotificationDelivery[],
): Promise<Array<{ delivery: NotificationDelivery; projectId: string }>> {
  if (deliveries.length === 0) return [];
  const registrations = await db.select({
    id: appPushDevices.id,
    expoPushToken: appPushDevices.expoPushToken,
    registrationGeneration: appPushDevices.registrationGeneration,
    projectId: appPushDevices.projectId,
  }).from(appPushDevices)
    .innerJoin(appPushDeviceFences, and(
      eq(appPushDeviceFences.app, appPushDevices.app),
      eq(appPushDeviceFences.deviceId, appPushDevices.deviceId),
      eq(appPushDeviceFences.globalUserId, appPushDevices.globalUserId),
      eq(
        appPushDeviceFences.registrationGeneration,
        appPushDevices.registrationGeneration,
      ),
      eq(appPushDeviceFences.enabled, true),
    ))
    .innerJoin(globalUsers, and(
      eq(globalUsers.id, appPushDevices.globalUserId),
      eq(globalUsers.isActive, true),
    ))
    .where(and(
      inArray(
        appPushDevices.id,
        deliveries.map((delivery) => delivery.deviceRegistrationId),
      ),
      eq(appPushDevices.globalUserId, job.globalUserId),
      eq(appPushDevices.app, job.sourceApp),
      eq(appPushDevices.enabled, true),
    ));
  const currentRegistrations = new Map(
    registrations.map((registration) => [registration.id, registration]),
  );
  const valid: Array<{ delivery: NotificationDelivery; projectId: string }> = [];
  const now = new Date();
  for (const delivery of deliveries) {
    const registration = currentRegistrations.get(delivery.deviceRegistrationId);
    if (
      registration?.expoPushToken === delivery.expoPushToken
      && registration.registrationGeneration === delivery.registrationGeneration
    ) {
      valid.push({ delivery, projectId: registration.projectId });
      continue;
    }
    if (registration) {
      const refreshedDelivery = {
        ...delivery,
        expoPushToken: registration.expoPushToken,
        registrationGeneration: registration.registrationGeneration,
        updatedAt: now,
      };
      await db.update(schedulerNotificationDeliveries).set({
        expoPushToken: registration.expoPushToken,
        registrationGeneration: registration.registrationGeneration,
        updatedAt: now,
      }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
      valid.push({ delivery: refreshedDelivery, projectId: registration.projectId });
      continue;
    }
    await db.update(schedulerNotificationDeliveries).set({
      status: 'failed',
      lastError: 'registration_disabled_or_replaced',
      completedAt: now,
      updatedAt: now,
    }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
  }
  return valid;
}

async function finishClaimFromDeliveries(
  job: NotificationJob,
  claimToken: string,
  now = new Date(),
): Promise<void> {
  const deliveries = await db.select({
    status: schedulerNotificationDeliveries.status,
    receiptAvailableAt: schedulerNotificationDeliveries.receiptAvailableAt,
    lastError: schedulerNotificationDeliveries.lastError,
  }).from(schedulerNotificationDeliveries)
    .where(eq(schedulerNotificationDeliveries.jobId, job.id));
  const pending = deliveries.filter((delivery) => delivery.status === 'pending');
  const ticketed = deliveries.filter((delivery) => delivery.status === 'ticketed');
  const anyDelivered = deliveries.some((delivery) => delivery.status === 'delivered');
  if (job.attempts >= job.maxAttempts && (pending.length > 0 || ticketed.length > 0)) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx.select({ id: schedulerNotificationJobs.id })
        .from(schedulerNotificationJobs)
        .where(claimedJobCondition(job.id, claimToken))
        .for('update')
        .limit(1);
      if (!claimed) return;
      await tx.update(schedulerNotificationDeliveries).set({
        status: 'failed',
        lastError: 'notification_attempts_exhausted',
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
      ));
      await tx.update(schedulerNotificationJobs).set({
        status: anyDelivered ? 'delivered' : 'failed',
        claimToken: null,
        claimedAt: null,
        lastError: anyDelivered ? null : 'notification_attempts_exhausted',
        completedAt: now,
        updatedAt: now,
      }).where(claimedJobCondition(job.id, claimToken));
    });
    return;
  }
  if (pending.length > 0) {
    const rateLimited = pending.some((delivery) => delivery.lastError === 'MessageRateExceeded');
    await db.update(schedulerNotificationJobs).set({
      status: 'queued',
      availableAt: rateLimited
        ? new Date(now.getTime() + retryDelayMs(job.attempts))
        : now,
      claimToken: null,
      claimedAt: null,
      updatedAt: now,
    }).where(claimedJobCondition(job.id, claimToken));
    return;
  }
  if (ticketed.length > 0) {
    const nextReceiptAt = ticketed.reduce<Date>((earliest, delivery) => {
      const candidate = delivery.receiptAvailableAt ?? new Date(
        now.getTime() + config.expoPush.receiptRetryMs,
      );
      return candidate < earliest ? candidate : earliest;
    }, new Date(8_640_000_000_000_000));
    await db.update(schedulerNotificationJobs).set({
      status: 'awaiting_receipts',
      availableAt: nextReceiptAt,
      claimToken: null,
      claimedAt: null,
      updatedAt: now,
    }).where(claimedJobCondition(job.id, claimToken));
    return;
  }

  const noDestinations = deliveries.length === 0;
  await db.update(schedulerNotificationJobs).set({
    status: anyDelivered || noDestinations ? 'delivered' : 'failed',
    claimToken: null,
    claimedAt: null,
    lastError: noDestinations
      ? 'no_enabled_push_devices'
      : anyDelivered
        ? null
        : 'all_deliveries_failed',
    completedAt: now,
    updatedAt: now,
  }).where(claimedJobCondition(job.id, claimToken));
}

async function sendPendingDeliveries(
  job: NotificationJob,
  claimToken: string,
  transport: ExpoPushTransport,
): Promise<void> {
  if (!await refreshJobClaim(job.id, claimToken)) return;
  if (!await revalidateClaimedJobEligibility(job, claimToken)) return;
  const pending = await snapshotPendingDeliveries(job, claimToken);
  for (const batch of chunkExpoItems(pending, EXPO_MESSAGE_BATCH_SIZE)) {
    const currentBatch = await revalidateDeliveryBatch(job, claimToken, batch);
    if (currentBatch.length === 0) continue;
    const byProject = new Map<string, typeof currentBatch>();
    for (const item of currentBatch) {
      const group = byProject.get(item.projectId) ?? [];
      group.push(item);
      byProject.set(item.projectId, group);
    }
    for (const projectBatch of byProject.values()) {
      // Scheduler mutation cancellation clears status/claimToken. Re-check at
      // the last possible point before the external send to avoid stale pushes.
      if (!await refreshJobClaim(job.id, claimToken)) return;
      if (!await revalidateClaimedJobEligibility(job, claimToken)) return;
      if (!await refreshJobClaim(job.id, claimToken)) return;
      const tickets = await transport.send(projectBatch.map(({ delivery }) => ({
        to: delivery.expoPushToken,
        title: job.title,
        body: job.body,
        data: job.payload as Record<string, unknown>,
        sound: 'default',
        priority: 'high',
        channelId: schedulerAndroidChannel(job.sourceApp),
      })));
      if (!await refreshJobClaim(job.id, claimToken)) return;
      const now = new Date();
      for (let index = 0; index < projectBatch.length; index += 1) {
        if (index > 0 && index % 25 === 0) {
          if (!await refreshJobClaim(job.id, claimToken)) return;
        }
        await updateDeliveryFromTicket(
          job,
          claimToken,
          projectBatch[index].delivery,
          tickets[index],
          now,
        );
      }
    }
  }
  await finishClaimFromDeliveries(job, claimToken);
}

async function ticketedDeliveriesDue(jobId: string, now: Date): Promise<NotificationDelivery[]> {
  return db.select()
    .from(schedulerNotificationDeliveries)
    .where(and(
      eq(schedulerNotificationDeliveries.jobId, jobId),
      eq(schedulerNotificationDeliveries.status, 'ticketed'),
      lte(schedulerNotificationDeliveries.receiptAvailableAt, now),
    ))
    .orderBy(asc(schedulerNotificationDeliveries.receiptAvailableAt))
    .limit(EXPO_RECEIPT_BATCH_SIZE);
}

async function updateDeliveryFromReceipt(
  job: NotificationJob,
  claimToken: string,
  delivery: NotificationDelivery,
  receipt: ExpoPushReceipt | undefined,
  now: Date,
): Promise<void> {
  if (!receipt) {
    const nextChecks = delivery.receiptChecks + 1;
    await db.update(schedulerNotificationDeliveries).set(nextChecks >= MAX_RECEIPT_CHECKS
      ? {
          status: 'failed',
          receiptChecks: nextChecks,
          lastError: 'expo_receipt_unavailable',
          completedAt: now,
          updatedAt: now,
        }
      : {
          receiptChecks: nextChecks,
          receiptAvailableAt: new Date(now.getTime() + config.expoPush.receiptRetryMs),
          lastError: 'expo_receipt_pending',
          updatedAt: now,
        }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
    return;
  }
  if (receipt.status === 'ok') {
    await db.update(schedulerNotificationDeliveries).set({
      status: 'delivered',
      receiptChecks: delivery.receiptChecks + 1,
      lastError: null,
      completedAt: now,
      updatedAt: now,
    }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
    return;
  }

  const errorCode = receipt.details?.error ?? 'expo_receipt_error';
  if (errorCode === 'DeviceNotRegistered') {
    await disableDeviceNotRegistered(delivery);
  }
  if (errorCode === 'MessageRateExceeded') {
    await db.update(schedulerNotificationDeliveries).set({
      status: 'pending',
      ticketId: null,
      receiptAvailableAt: null,
      receiptChecks: delivery.receiptChecks + 1,
      lastError: errorCode,
      completedAt: null,
      updatedAt: now,
    }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
    return;
  }
  await db.update(schedulerNotificationDeliveries).set({
    status: 'failed',
    receiptChecks: delivery.receiptChecks + 1,
    lastError: errorCode,
    completedAt: now,
    updatedAt: now,
  }).where(deliveryClaimCondition(delivery.id, job.id, claimToken));
}

async function checkDeliveryReceipts(
  job: NotificationJob,
  claimToken: string,
  transport: ExpoPushTransport,
): Promise<void> {
  const now = new Date();
  const due = await ticketedDeliveriesDue(job.id, now);
  for (const batch of chunkExpoItems(due, EXPO_RECEIPT_BATCH_SIZE)) {
    if (!await refreshJobClaim(job.id, claimToken)) return;
    const ids = batch.flatMap((delivery) => delivery.ticketId ? [delivery.ticketId] : []);
    if (ids.length !== batch.length) {
      throw new ExpoRequestError('missing_expo_ticket_id');
    }
    const receipts = await transport.getReceipts(ids);
    if (!await refreshJobClaim(job.id, claimToken)) return;
    const checkedAt = new Date();
    for (let index = 0; index < batch.length; index += 1) {
      if (index > 0 && index % 50 === 0) {
        if (!await refreshJobClaim(job.id, claimToken)) return;
      }
      const delivery = batch[index];
      await updateDeliveryFromReceipt(
        job,
        claimToken,
        delivery,
        receipts[delivery.ticketId!],
        checkedAt,
      );
    }
  }
  await finishClaimFromDeliveries(job, claimToken);
}

async function requeueClaimedJob(
  job: NotificationJob,
  claimToken: string,
  error: unknown,
): Promise<void> {
  const now = new Date();
  const exhausted = job.attempts >= job.maxAttempts;
  await db.transaction(async (tx) => {
    const [claimed] = await tx.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(claimedJobCondition(job.id, claimToken))
      .for('update')
      .limit(1);
    if (!claimed) return;
    const deliveryStates = await tx.select({
      id: schedulerNotificationDeliveries.id,
      status: schedulerNotificationDeliveries.status,
    })
      .from(schedulerNotificationDeliveries)
      .where(eq(schedulerNotificationDeliveries.jobId, job.id));
    const pending = deliveryStates.find((delivery) => delivery.status === 'pending');
    const anyDelivered = deliveryStates.some((delivery) => delivery.status === 'delivered');
    if (exhausted) {
      await tx.update(schedulerNotificationDeliveries).set({
        status: 'failed',
        lastError: 'notification_attempts_exhausted',
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
      ));
    }
    await tx.update(schedulerNotificationJobs).set({
      status: exhausted
        ? anyDelivered ? 'delivered' : 'failed'
        : pending ? 'queued' : 'awaiting_receipts',
      availableAt: exhausted
        ? now
        : new Date(now.getTime() + retryDelayMs(job.attempts)),
      claimToken: null,
      claimedAt: null,
      lastError: exhausted
        ? anyDelivered ? null : 'notification_attempts_exhausted'
        : safeWorkerError(error),
      completedAt: exhausted ? now : null,
      updatedAt: now,
    }).where(claimedJobCondition(job.id, claimToken));
  });
}

export async function processClaimedSchedulerNotificationJob(
  job: NotificationJob & { claimToken: string },
  transport: ExpoPushTransport = expoHttpTransport,
): Promise<void> {
  try {
    const [pending] = await db.select({ id: schedulerNotificationDeliveries.id })
      .from(schedulerNotificationDeliveries)
      .where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        eq(schedulerNotificationDeliveries.status, 'pending'),
      ))
      .limit(1);
    const [ticketed] = await db.select({ id: schedulerNotificationDeliveries.id })
      .from(schedulerNotificationDeliveries)
      .where(and(
        eq(schedulerNotificationDeliveries.jobId, job.id),
        eq(schedulerNotificationDeliveries.status, 'ticketed'),
      ))
      .limit(1);

    if (pending || !ticketed) {
      await sendPendingDeliveries(job, job.claimToken, transport);
    } else {
      await checkDeliveryReceipts(job, job.claimToken, transport);
    }
  } catch (error) {
    await requeueClaimedJob(job, job.claimToken, error);
  }
}

export async function drainSchedulerNotificationJobs(
  transport: ExpoPushTransport = expoHttpTransport,
  now = new Date(),
): Promise<number> {
  // Claim immediately before processing so a slow first Expo call cannot leave
  // a pre-claimed tail to be recovered by another process and consume attempts
  // without ever making a delivery attempt.
  let processed = 0;
  for (let index = 0; index < config.expoPush.claimBatchSize; index += 1) {
    const [job] = await claimDueSchedulerNotificationJobs(now, 1);
    if (!job) break;
    await processClaimedSchedulerNotificationJob(job, transport);
    processed += 1;
  }
  return processed;
}

export type SchedulerNotificationWorker = {
  stop: () => Promise<void>;
};

export function startSchedulerNotificationWorker(
  transport: ExpoPushTransport = expoHttpTransport,
): SchedulerNotificationWorker {
  if (!config.expoPush.enabled) {
    return { stop: async () => {} };
  }
  let timer: NodeJS.Timeout | null = null;
  let active: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || active) return;
    active = drainSchedulerNotificationJobs(transport)
      .then(() => undefined)
      .catch(() => {
        // Never log Expo response bodies or tokens; the durable job stores a
        // normalized error code for operators.
        console.error('[notifications] worker tick failed');
      })
      .finally(() => {
        active = null;
      });
  };
  tick();
  timer = setInterval(tick, config.expoPush.pollIntervalMs);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (active) await active;
    },
  };
}
