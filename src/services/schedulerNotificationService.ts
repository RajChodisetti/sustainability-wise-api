import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihInstallations } from '../db/schema/installhub.js';
import {
  appPushDevices,
  appPushDeviceFences,
  globalUsers,
  portalScheduleEvents,
  schedulerNotificationDeliveries,
  schedulerNotificationJobs,
  unifiedUsers,
  type SchedulerNotificationData,
} from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

export type MobileScheduleSourceApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type SchedulerNotificationKind = SchedulerNotificationData['notificationKind'];

type NotificationExecutor = Pick<typeof db, 'insert' | 'select' | 'update'>;
type ScheduleEventRow = typeof portalScheduleEvents.$inferSelect;

export type PushDeviceInput = {
  expoPushToken: string;
  platform: 'ios' | 'android';
  projectId: string;
  registrationGeneration: number;
};

export type PushDeviceDto = {
  deviceId: string;
  app: MobileScheduleSourceApp;
  platform: 'ios' | 'android';
  projectId: string;
  registrationGeneration: number;
  enabled: boolean;
};

export type ManualReminderResult = {
  queued: boolean;
  notificationId: string;
};

const AUTOMATED_KINDS: SchedulerNotificationKind[] = ['one_day_before', 'day_of'];
const PENDING_JOB_STATUSES = ['queued', 'processing', 'awaiting_receipts'] as const;
// One initial send plus eight receipt checks must fit even when transient send
// failures consume additional claims. Delivery receiptChecks remains the
// authoritative eight-poll bound.
const SCHEDULER_NOTIFICATION_MAX_ATTEMPTS = 16;
const MOBILE_APPS = new Set<MobileScheduleSourceApp>([
  'ecoaudit',
  'solarsense',
  'installhub',
]);

export function isMobileScheduleSourceApp(value: string): value is MobileScheduleSourceApp {
  return MOBILE_APPS.has(value as MobileScheduleSourceApp);
}

/**
 * Only concrete product work that a mobile client can open is a push target.
 * Legacy Solar site rows remain readable in the portal, but the mobile app
 * assigns and opens individual rooftop assessments, not their parent sites.
 */
export function isMobileScheduleNotificationTarget(
  event: Pick<ScheduleEventRow, 'sourceApp' | 'sourceType' | 'sourceId'>,
): boolean {
  if (typeof event.sourceId !== 'string' || !event.sourceId.trim()) return false;
  return (event.sourceApp === 'ecoaudit' && event.sourceType === 'audit')
    || (event.sourceApp === 'solarsense' && event.sourceType === 'assessment')
    || (event.sourceApp === 'installhub' && event.sourceType === 'installation');
}

function isActiveScheduleStatus(status: string): boolean {
  return status === 'planned' || status === 'in_progress';
}

/**
 * Resolve the canonical user who can currently open the linked mobile work.
 * This is intentionally stricter than the portal's ability to read historical
 * scheduler rows: the product record and membership must both still be active,
 * and the product's assignment must agree with the scheduler snapshot.
 */
async function resolveAlignedActiveTargetGlobalUserId(
  executor: NotificationExecutor,
  event: ScheduleEventRow,
): Promise<string | null> {
  if (!isMobileScheduleNotificationTarget(event) || !isActiveScheduleStatus(event.status)) {
    return null;
  }
  const [identity] = await executor
    .select({
      globalUserId: globalUsers.id,
      fieldUserId: globalUsers.fieldUserId,
      originUserId: unifiedUsers.originUserId,
    })
    .from(globalUsers)
    .innerJoin(unifiedUsers, and(
      eq(unifiedUsers.globalUserId, globalUsers.id),
      eq(unifiedUsers.originApp, event.sourceApp),
      eq(unifiedUsers.isActive, true),
      isNull(unifiedUsers.deletedAt),
    ))
    .where(and(
      eq(globalUsers.fieldUserId, event.assigneeFieldUserId),
      eq(globalUsers.isActive, true),
    ))
    .limit(1);
  if (!identity) return null;

  if (event.sourceApp === 'ecoaudit' && event.sourceType === 'audit') {
    const [source] = await executor.select({ id: eaAudits.id })
      .from(eaAudits)
      .where(and(
        eq(eaAudits.id, event.sourceId!),
        eq(eaAudits.status, 'Draft'),
        isNull(eaAudits.deletedAt),
        eq(eaAudits.assignedInspectorUserId, identity.originUserId),
      ))
      .limit(1);
    return source ? identity.globalUserId : null;
  }

  if (event.sourceApp === 'solarsense' && event.sourceType === 'assessment') {
    const [source] = await executor.select({ id: ssRooftopAssessments.id })
      .from(ssRooftopAssessments)
      .innerJoin(ssSites, and(
        eq(ssSites.id, ssRooftopAssessments.siteId),
        eq(ssSites.status, 'Draft'),
        isNull(ssSites.deletedAt),
      ))
      .where(and(
        eq(ssRooftopAssessments.id, event.sourceId!),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
        eq(ssRooftopAssessments.assignedInspectorUserId, identity.originUserId),
      ))
      .limit(1);
    return source ? identity.globalUserId : null;
  }

  const [source] = await executor.select({ id: ihInstallations.id })
    .from(ihInstallations)
    .where(and(
      eq(ihInstallations.id, event.sourceId!),
      eq(ihInstallations.status, 'Draft'),
      isNull(ihInstallations.deletedAt),
      eq(ihInstallations.assignedInspectorUserId, identity.fieldUserId),
    ))
    .limit(1);
  return source ? identity.globalUserId : null;
}

/**
 * Kind-aware delivery invariant. Active-work notifications require the current
 * linked Draft to be visible to the target. Removal and cancellation are
 * inverse lifecycle notices, so they validate the corresponding scheduler
 * transition without requiring the old product assignment to remain in place.
 */
export async function isSchedulerNotificationEligible(
  executor: NotificationExecutor,
  event: ScheduleEventRow,
  globalUserId: string,
  kind: SchedulerNotificationKind,
): Promise<boolean> {
  if (!isMobileScheduleNotificationTarget(event)) return false;

  if (kind === 'cancelled') {
    if (event.status !== 'cancelled') return false;
    const [target] = await executor.select({ id: globalUsers.id })
      .from(globalUsers)
      .where(and(
        eq(globalUsers.id, globalUserId),
        eq(globalUsers.fieldUserId, event.assigneeFieldUserId),
      ))
      .limit(1);
    return Boolean(target);
  }

  const alignedTarget = await resolveAlignedActiveTargetGlobalUserId(executor, event);
  if (!alignedTarget) return false;
  if (kind === 'assignment_removed') return alignedTarget !== globalUserId;
  return alignedTarget === globalUserId;
}

function requireMobileJwtUser(user: AuthUser): asserts user is AuthUser & {
  app: MobileScheduleSourceApp;
  authType: 'jwt';
} {
  if (!isMobileScheduleSourceApp(user.app)) {
    throw forbidden('Push notifications are unavailable for this application');
  }
  if (user.authType !== 'jwt') {
    throw forbidden('Push devices must be registered with a signed-in mobile user');
  }
}

async function resolveActiveGlobalUserId(
  executor: NotificationExecutor,
  user: AuthUser & { app: MobileScheduleSourceApp },
): Promise<string> {
  const [identity] = await executor
    .select({ globalUserId: globalUsers.id })
    .from(unifiedUsers)
    .innerJoin(globalUsers, and(
      eq(globalUsers.id, unifiedUsers.globalUserId),
      eq(globalUsers.isActive, true),
    ))
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
      eq(unifiedUsers.isActive, true),
      isNull(unifiedUsers.deletedAt),
    ))
    .limit(1);
  if (!identity) throw forbidden('Active canonical user account required');
  return identity.globalUserId;
}

async function resolvePushDeviceOwnerGlobalUserId(
  executor: NotificationExecutor,
  user: AuthUser & { app: MobileScheduleSourceApp },
): Promise<string> {
  const [identity] = await executor
    .select({ globalUserId: unifiedUsers.globalUserId })
    .from(unifiedUsers)
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
    ))
    .limit(1);
  if (!identity) throw forbidden('Canonical user account required');
  return identity.globalUserId;
}

function validateDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized || normalized.length > 200) {
    throw badRequest('deviceId must be between 1 and 200 characters');
  }
  return normalized;
}

export function validateExpoPushToken(value: string): string {
  const token = value.trim();
  if (
    token.length > 256
    || !/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)
  ) {
    throw badRequest('expoPushToken must be a valid Expo push token');
  }
  return token;
}

function validateProjectId(value: string): string {
  const projectId = value.trim();
  if (!projectId || projectId.length > 200) {
    throw badRequest('projectId must be between 1 and 200 characters');
  }
  return projectId;
}

export function validateRegistrationGeneration(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw badRequest('registrationGeneration must be a positive safe integer');
  }
  return value;
}

export async function registerPushDevice(
  user: AuthUser,
  rawDeviceId: string,
  input: PushDeviceInput,
): Promise<PushDeviceDto> {
  requireMobileJwtUser(user);
  const deviceId = validateDeviceId(rawDeviceId);
  const expoPushToken = validateExpoPushToken(input.expoPushToken);
  const projectId = validateProjectId(input.projectId);
  const registrationGeneration = validateRegistrationGeneration(
    input.registrationGeneration,
  );
  if (input.platform !== 'ios' && input.platform !== 'android') {
    throw badRequest('platform must be ios or android');
  }

  const row = await db.transaction(async (tx) => {
    const globalUserId = await resolveActiveGlobalUserId(tx, user);
    const now = new Date();

    // Serialize transfers for both stable device identity and token. The
    // partial unique index is the final database invariant; these locks make
    // concurrent re-login/token rotation deterministic instead of surfacing a
    // constraint race to a mobile client.
    const registrationLocks = [
      `push-device:${user.app}:${deviceId}`,
      `push-token:${user.app}:${expoPushToken}`,
    ].sort();
    for (const lockKey of registrationLocks) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    }

    const [fence] = await tx.select()
      .from(appPushDeviceFences)
      .where(and(
        eq(appPushDeviceFences.app, user.app),
        eq(appPushDeviceFences.deviceId, deviceId),
        eq(appPushDeviceFences.globalUserId, globalUserId),
      ))
      .for('update')
      .limit(1);
    if (fence && registrationGeneration < fence.registrationGeneration) {
      throw conflict('A newer push registration lifecycle already exists for this device');
    }
    if (fence && registrationGeneration === fence.registrationGeneration) {
      if (!fence.enabled) {
        throw conflict('registrationGeneration was revoked during logout');
      }
    }

    const [previousDeviceOwner] = await tx.select({
      globalUserId: appPushDevices.globalUserId,
      registrationGeneration: appPushDevices.registrationGeneration,
    }).from(appPushDevices).where(and(
      eq(appPushDevices.app, user.app),
      eq(appPushDevices.deviceId, deviceId),
    )).for('update').limit(1);
    if (
      previousDeviceOwner
      && (
        previousDeviceOwner.globalUserId !== globalUserId
        || previousDeviceOwner.registrationGeneration !== registrationGeneration
      )
    ) {
      await tx.update(appPushDeviceFences).set({
        enabled: false,
        updatedAt: now,
      }).where(and(
        eq(appPushDeviceFences.app, user.app),
        eq(appPushDeviceFences.deviceId, deviceId),
        eq(appPushDeviceFences.globalUserId, previousDeviceOwner.globalUserId),
        eq(
          appPushDeviceFences.registrationGeneration,
          previousDeviceOwner.registrationGeneration,
        ),
      ));
    }

    const staleTokenOwners = await tx.select({
      globalUserId: appPushDevices.globalUserId,
      deviceId: appPushDevices.deviceId,
      registrationGeneration: appPushDevices.registrationGeneration,
    }).from(appPushDevices).where(and(
      eq(appPushDevices.app, user.app),
      eq(appPushDevices.expoPushToken, expoPushToken),
      ne(appPushDevices.deviceId, deviceId),
      eq(appPushDevices.enabled, true),
    ));
    for (const staleOwner of staleTokenOwners) {
      await tx.update(appPushDeviceFences).set({
        enabled: false,
        updatedAt: now,
      }).where(and(
        eq(appPushDeviceFences.app, user.app),
        eq(appPushDeviceFences.deviceId, staleOwner.deviceId),
        eq(appPushDeviceFences.globalUserId, staleOwner.globalUserId),
        eq(
          appPushDeviceFences.registrationGeneration,
          staleOwner.registrationGeneration,
        ),
      ));
    }

    // A token can outlive a failed logout or app reinstall. Disable every stale
    // registration for the same app/token before transferring this device to
    // the currently authenticated canonical identity.
    await tx.update(appPushDevices).set({
      enabled: false,
      disabledReason: 'token_re_registered',
      updatedAt: now,
    }).where(and(
      eq(appPushDevices.app, user.app),
      eq(appPushDevices.expoPushToken, expoPushToken),
      ne(appPushDevices.deviceId, deviceId),
    ));

    await tx.insert(appPushDeviceFences).values({
      app: user.app,
      deviceId,
      globalUserId,
      registrationGeneration,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        appPushDeviceFences.app,
        appPushDeviceFences.deviceId,
        appPushDeviceFences.globalUserId,
      ],
      set: {
        globalUserId,
        registrationGeneration,
        enabled: true,
        updatedAt: now,
      },
    });

    const [registered] = await tx.insert(appPushDevices).values({
      id: randomUUID(),
      globalUserId,
      app: user.app,
      deviceId,
      registrationGeneration,
      expoPushToken,
      platform: input.platform,
      projectId,
      enabled: true,
      disabledReason: null,
      lastRegisteredAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [appPushDevices.app, appPushDevices.deviceId],
      set: {
        globalUserId,
        registrationGeneration,
        expoPushToken,
        platform: input.platform,
        projectId,
        enabled: true,
        disabledReason: null,
        lastRegisteredAt: now,
        updatedAt: now,
      },
    }).returning();
    return registered;
  });

  return {
    deviceId: row.deviceId,
    app: row.app as MobileScheduleSourceApp,
    platform: row.platform as 'ios' | 'android',
    projectId: row.projectId,
    registrationGeneration: row.registrationGeneration,
    enabled: row.enabled,
  };
}

export async function deregisterPushDevice(
  user: AuthUser,
  rawDeviceId: string,
  rawRegistrationGeneration: unknown,
): Promise<void> {
  requireMobileJwtUser(user);
  const deviceId = validateDeviceId(rawDeviceId);
  const registrationGeneration = validateRegistrationGeneration(
    rawRegistrationGeneration,
  );
  await db.transaction(async (tx) => {
    // Logout cleanup remains available to a recently deactivated identity.
    // Its per-owner fence blocks a delayed PUT from this login generation,
    // while the device-row owner predicate protects a newer user's session.
    const globalUserId = await resolvePushDeviceOwnerGlobalUserId(tx, user);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${
      `push-device:${user.app}:${deviceId}`
    }, 0))`);
    const now = new Date();
    const [fence] = await tx.select()
      .from(appPushDeviceFences)
      .where(and(
        eq(appPushDeviceFences.app, user.app),
        eq(appPushDeviceFences.deviceId, deviceId),
        eq(appPushDeviceFences.globalUserId, globalUserId),
      ))
      .for('update')
      .limit(1);
    if (fence && registrationGeneration < fence.registrationGeneration) return;
    await tx.insert(appPushDeviceFences).values({
      app: user.app,
      deviceId,
      globalUserId,
      registrationGeneration,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        appPushDeviceFences.app,
        appPushDeviceFences.deviceId,
        appPushDeviceFences.globalUserId,
      ],
      set: {
        globalUserId,
        registrationGeneration,
        enabled: false,
        updatedAt: now,
      },
    });
    await tx.update(appPushDevices).set({
      enabled: false,
      disabledReason: 'logout',
      updatedAt: now,
    }).where(and(
      eq(appPushDevices.app, user.app),
      eq(appPushDevices.deviceId, deviceId),
      eq(appPushDevices.globalUserId, globalUserId),
      lte(appPushDevices.registrationGeneration, registrationGeneration),
    ));
  });
}

export function schedulerNotificationCopy(
  kind: SchedulerNotificationKind,
  _eventTitle: string,
  _scheduledStartAt: Date,
): { title: string; body: string } {
  const notificationTitles: Record<SchedulerNotificationKind, string> = {
    assigned: 'New job assigned',
    changed: 'Job updated',
    assignment_removed: 'Assignment removed',
    cancelled: 'Job cancelled',
    manual_reminder: 'Job reminder',
    one_day_before: 'Upcoming job',
    day_of: 'Scheduled job reminder',
  };
  const notificationBodies: Record<SchedulerNotificationKind, string> = {
    assigned: 'You were assigned a scheduled job.',
    changed: 'A scheduled job was updated.',
    assignment_removed: 'A job is no longer assigned to you.',
    cancelled: 'A scheduled job was cancelled.',
    manual_reminder: 'You have a scheduled job reminder.',
    one_day_before: 'A scheduled job is coming up.',
    day_of: 'You have a scheduled job.',
  };
  return {
    title: notificationTitles[kind],
    body: notificationBodies[kind],
  };
}

function notificationPayload(
  kind: SchedulerNotificationKind,
  event: ScheduleEventRow,
): SchedulerNotificationData {
  if (!isMobileScheduleNotificationTarget(event)) {
    throw badRequest('Scheduler event does not have a supported mobile notification target');
  }
  return {
    type: 'scheduler',
    notificationKind: kind,
    eventId: event.id,
    sourceApp: event.sourceApp as MobileScheduleSourceApp,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    scheduledStartAt: event.scheduledStartAt.toISOString(),
  };
}

async function insertSchedulerNotification(
  executor: NotificationExecutor,
  input: {
    event: ScheduleEventRow;
    globalUserId: string;
    kind: SchedulerNotificationKind;
    availableAt: Date;
    dedupeKey?: string;
    now: Date;
  },
): Promise<string> {
  const id = randomUUID();
  const copy = schedulerNotificationCopy(
    input.kind,
    input.event.title,
    input.event.scheduledStartAt,
  );
  await executor.insert(schedulerNotificationJobs).values({
    id,
    eventId: input.event.id,
    globalUserId: input.globalUserId,
    sourceApp: input.event.sourceApp,
    notificationKind: input.kind,
    title: copy.title,
    body: copy.body,
    payload: notificationPayload(input.kind, input.event),
    dedupeKey: input.dedupeKey
      ?? `scheduler:${input.event.id}:${input.kind}:${randomUUID()}`,
    status: 'queued',
    availableAt: input.availableAt,
    attempts: 0,
    maxAttempts: SCHEDULER_NOTIFICATION_MAX_ATTEMPTS,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
}

export async function enqueueImmediateSchedulerNotification(
  executor: NotificationExecutor,
  event: ScheduleEventRow,
  globalUserId: string,
  kind: Exclude<SchedulerNotificationKind, 'one_day_before' | 'day_of'>,
  now = new Date(),
): Promise<string | null> {
  if (!await isSchedulerNotificationEligible(executor, event, globalUserId, kind)) return null;
  return insertSchedulerNotification(executor, {
    event,
    globalUserId,
    kind,
    availableAt: now,
    now,
  });
}

/** Enqueue only future triggers; a newly-created past trigger is never replayed. */
export async function enqueueAutomatedSchedulerNotifications(
  executor: NotificationExecutor,
  event: ScheduleEventRow,
  globalUserId: string,
  now = new Date(),
): Promise<string[]> {
  if (
    !isMobileScheduleNotificationTarget(event)
    || event.status === 'cancelled'
    || event.status === 'done'
  ) {
    return [];
  }
  if (!await isSchedulerNotificationEligible(
    executor,
    event,
    globalUserId,
    'day_of',
  )) return [];
  const triggers: Array<{ kind: 'one_day_before' | 'day_of'; at: Date }> = [
    {
      kind: 'one_day_before',
      at: new Date(event.scheduledStartAt.getTime() - 24 * 60 * 60 * 1_000),
    },
    { kind: 'day_of', at: event.scheduledStartAt },
  ];
  const ids: string[] = [];
  const generation = randomUUID();
  for (const trigger of triggers) {
    if (trigger.at.getTime() <= now.getTime()) continue;
    ids.push(await insertSchedulerNotification(executor, {
      event,
      globalUserId,
      kind: trigger.kind,
      availableAt: trigger.at,
      dedupeKey: `scheduler:${event.id}:automatic:${generation}:${trigger.kind}`,
      now,
    }));
  }
  return ids;
}

export async function cancelPendingSchedulerNotifications(
  executor: NotificationExecutor,
  eventId: string,
  options: {
    globalUserId?: string;
    automatedOnly?: boolean;
  } = {},
  now = new Date(),
): Promise<void> {
  const conditions = [
    eq(schedulerNotificationJobs.eventId, eventId),
    inArray(schedulerNotificationJobs.status, [...PENDING_JOB_STATUSES]),
  ];
  if (options.globalUserId) {
    conditions.push(eq(schedulerNotificationJobs.globalUserId, options.globalUserId));
  }
  if (options.automatedOnly) {
    conditions.push(inArray(schedulerNotificationJobs.notificationKind, AUTOMATED_KINDS));
  }
  const affected = await executor.select({ id: schedulerNotificationJobs.id })
    .from(schedulerNotificationJobs)
    .where(and(...conditions))
    .for('update');
  if (affected.length === 0) return;
  const jobIds = affected.map((job) => job.id);
  await executor.update(schedulerNotificationJobs).set({
    status: 'cancelled',
    claimToken: null,
    claimedAt: null,
    completedAt: now,
    updatedAt: now,
  }).where(inArray(schedulerNotificationJobs.id, jobIds));
  await executor.update(schedulerNotificationDeliveries).set({
    status: 'failed',
    lastError: 'scheduler_notification_cancelled',
    completedAt: now,
    updatedAt: now,
  }).where(and(
    inArray(schedulerNotificationDeliveries.jobId, jobIds),
    inArray(schedulerNotificationDeliveries.status, ['pending', 'ticketed']),
  ));
}

function manualReminderDedupeKey(eventId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${eventId}\0${idempotencyKey}`)
    .digest('hex');
  return `scheduler:${eventId}:manual:${digest}`;
}

export async function queueManualSchedulerReminder(
  user: AuthUser,
  eventId: string,
  rawIdempotencyKey: string,
): Promise<ManualReminderResult> {
  if (!isMobileScheduleSourceApp(user.app) || user.role !== 'admin') {
    throw forbidden('Only product admins can send scheduler reminders');
  }
  const idempotencyKey = rawIdempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw badRequest('idempotencyKey must be between 1 and 200 characters');
  }
  const dedupeKey = manualReminderDedupeKey(eventId, idempotencyKey);

  return db.transaction(async (tx) => {
    const [event] = await tx.select()
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eventId))
      .for('update')
      .limit(1);
    if (!event) throw notFound('Schedule event');
    if (!isMobileScheduleNotificationTarget(event)) {
      throw badRequest('Scheduler event does not have a supported mobile notification target');
    }
    const existing = await tx.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.dedupeKey, dedupeKey))
      .limit(1);
    if (existing[0]) {
      return { queued: false, notificationId: existing[0].id };
    }
    if (event.status === 'cancelled' || event.status === 'done') {
      throw badRequest('Only active scheduler events can be reminded');
    }

    const [target] = await tx.select({ globalUserId: globalUsers.id })
      .from(globalUsers)
      .where(and(
        eq(globalUsers.fieldUserId, event.assigneeFieldUserId),
        eq(globalUsers.isActive, true),
      ))
      .limit(1);
    if (!target) throw badRequest('Assigned canonical user is no longer active');
    if (!await isSchedulerNotificationEligible(
      tx,
      event,
      target.globalUserId,
      'manual_reminder',
    )) {
      throw badRequest('Linked mobile work is no longer active and assigned to this user');
    }

    const now = new Date();
    const notificationId = await insertSchedulerNotification(tx, {
      event,
      globalUserId: target.globalUserId,
      kind: 'manual_reminder',
      availableAt: now,
      dedupeKey,
      now,
    });
    return { queued: true, notificationId };
  });
}
