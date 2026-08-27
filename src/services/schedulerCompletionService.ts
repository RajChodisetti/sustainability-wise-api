import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihInstallations } from '../db/schema/installhub.js';
import {
  businessJobs,
  globalUsers,
  portalScheduleEvents,
  schedulerJobCompletionFacts,
  unifiedUsers,
} from '../db/schema/shared.js';
import { ssRooftopAssessments } from '../db/schema/solarsense.js';
import {
  captureSchedulerCompletedWorkRevenue,
  schedulerFinanceSourceMutexKey,
  type SchedulerFinanceExecutor,
} from './schedulerFinanceService.js';
import { compareSchedulerCompletionAttributionEvents } from './schedulerCompletionAttribution.js';
import { cancelPendingSchedulerNotifications } from './schedulerNotificationService.js';

export type SchedulerCompletionSource =
  | { sourceApp: 'ecoaudit'; sourceType: 'audit'; sourceId: string }
  | { sourceApp: 'solarsense'; sourceType: 'site'; sourceId: string }
  | { sourceApp: 'solarsense'; sourceType: 'assessment'; sourceId: string }
  | { sourceApp: 'installhub'; sourceType: 'installation'; sourceId: string };

type SchedulerCompletionExecutor = SchedulerFinanceExecutor;
type SchedulerNotificationCanceller = typeof cancelPendingSchedulerNotifications;
type SchedulerCompletionFactRecorder = typeof recordSchedulerCompletionFact;

type SchedulerCompletionOptions = {
  observedAt?: Date;
  cancelNotifications?: SchedulerNotificationCanceller;
  recordCompletionFact?: SchedulerCompletionFactRecorder;
  /** Explicit lifecycle provenance prevents replay-time finance backdating. */
  completionProvenance?: SchedulerCompletionProvenance;
};

type SolarSiteCompletionSource = Extract<
  SchedulerCompletionSource,
  { sourceApp: 'solarsense'; sourceType: 'site' }
>;

export type SchedulerCompletionResult = {
  matchedEventIds: string[];
  transitionedEventIds: string[];
};

export type SchedulerCompletionProvenance =
  | 'direct_transition'
  | 'offline_transition'
  | 'historical_replay';

type CommercialCompletionSource =
  | { sourceApp: 'ecoaudit'; sourceType: 'audit'; sourceId: string }
  | { sourceApp: 'solarsense'; sourceType: 'assessment'; sourceId: string }
  | { sourceApp: 'installhub'; sourceType: 'installation'; sourceId: string };

async function productCompletionIdentity(
  executor: SchedulerCompletionExecutor,
  source: CommercialCompletionSource,
): Promise<{
  exists: boolean;
  completedAt: Date | null;
  assignedProductUserId: string | null;
}> {
  if (source.sourceApp === 'ecoaudit') {
    const [row] = await executor.select({
      completedAt: eaAudits.completedAt,
      assignedProductUserId: eaAudits.assignedInspectorUserId,
    }).from(eaAudits).where(eq(eaAudits.id, source.sourceId)).limit(1);
    return row ? { exists: true, ...row } : {
      exists: false,
      completedAt: null,
      assignedProductUserId: null,
    };
  }
  if (source.sourceApp === 'solarsense') {
    const [row] = await executor.select({
      completedAt: ssRooftopAssessments.completedAt,
      assignedProductUserId: ssRooftopAssessments.assignedInspectorUserId,
    }).from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, source.sourceId))
      .limit(1);
    return row ? { exists: true, ...row } : {
      exists: false,
      completedAt: null,
      assignedProductUserId: null,
    };
  }
  const [row] = await executor.select({
    completedAt: ihInstallations.completedAt,
    assignedProductUserId: ihInstallations.assignedInspectorUserId,
  }).from(ihInstallations).where(eq(ihInstallations.id, source.sourceId)).limit(1);
  return row ? { exists: true, ...row } : {
    exists: false,
    completedAt: null,
    assignedProductUserId: null,
  };
}

async function recordSchedulerCompletionFact(
  executor: SchedulerCompletionExecutor,
  source: SchedulerCompletionSource,
  matchedEvents: Array<{
    id: string;
    status: string;
    assigneeFieldUserId: string;
    assigneeDisplayName: string | null;
    updatedAt: Date;
  }>,
  observedAt: Date,
  completionProvenance: SchedulerCompletionProvenance,
): Promise<void> {
  if (source.sourceApp === 'solarsense' && source.sourceType === 'site') return;
  const commercialSource = source as CommercialCompletionSource;
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      ${schedulerFinanceSourceMutexKey(commercialSource)},
      0
    ))
  `);
  const [existingFact] = await executor.select({
    id: schedulerJobCompletionFacts.id,
  }).from(schedulerJobCompletionFacts).where(and(
    eq(schedulerJobCompletionFacts.sourceApp, commercialSource.sourceApp),
    eq(schedulerJobCompletionFacts.sourceType, commercialSource.sourceType),
    eq(schedulerJobCompletionFacts.sourceId, commercialSource.sourceId),
  )).limit(1);
  if (existingFact) return;

  const product = await productCompletionIdentity(executor, commercialSource);
  // Historical state without a timestamp cannot be placed in a reporting
  // window. Never invent a completion instant during replay/backfill.
  if (completionProvenance === 'historical_replay' && !product.completedAt) return;
  const event = [...matchedEvents].sort(compareSchedulerCompletionAttributionEvents)[0];

  let primaryGlobalUserId: string | null = null;
  let assigneeFieldUserId: string | null = event?.assigneeFieldUserId ?? null;
  let assigneeDisplayName: string | null = event?.assigneeDisplayName ?? null;
  let attributionSource: 'scheduler_event' | 'product_assignment' | 'unattributed' = 'unattributed';
  if (event) {
    const [identity] = await executor.select({
      globalUserId: globalUsers.id,
      displayName: globalUsers.fullName,
      displayEmail: globalUsers.displayEmail,
    }).from(globalUsers)
      .where(eq(globalUsers.fieldUserId, event.assigneeFieldUserId))
      .limit(1);
    if (identity) {
      primaryGlobalUserId = identity.globalUserId;
      assigneeDisplayName = assigneeDisplayName
        ?? identity.displayName?.trim()
        ?? identity.displayEmail;
      attributionSource = 'scheduler_event';
    }
  }
  if (!primaryGlobalUserId && product.assignedProductUserId) {
    const [identity] = commercialSource.sourceApp === 'installhub'
      ? await executor.select({
          globalUserId: globalUsers.id,
          fieldUserId: globalUsers.fieldUserId,
          displayName: globalUsers.fullName,
          email: globalUsers.displayEmail,
        }).from(globalUsers).where(
          eq(globalUsers.fieldUserId, product.assignedProductUserId),
        ).limit(1)
      : await executor.select({
          globalUserId: unifiedUsers.globalUserId,
          fieldUserId: unifiedUsers.fieldUserId,
          displayName: unifiedUsers.fullName,
          email: unifiedUsers.email,
        }).from(unifiedUsers).where(and(
          eq(unifiedUsers.originApp, source.sourceApp),
          eq(unifiedUsers.originUserId, product.assignedProductUserId),
        )).limit(1);
    if (identity) {
      primaryGlobalUserId = identity.globalUserId;
      assigneeFieldUserId = identity.fieldUserId;
      assigneeDisplayName = identity.displayName?.trim() || identity.email;
      attributionSource = 'product_assignment';
    }
  }

  const revenueSnapshot = product.exists && completionProvenance !== 'historical_replay'
    ? await captureSchedulerCompletedWorkRevenue(commercialSource, executor)
    : null;

  await executor.insert(schedulerJobCompletionFacts).values({
    id: randomUUID(),
    sourceApp: commercialSource.sourceApp,
    sourceType: commercialSource.sourceType,
    sourceId: commercialSource.sourceId,
    completedAt: product.completedAt ?? observedAt,
    primaryGlobalUserId,
    assigneeFieldUserId,
    assigneeDisplayName,
    attributionSource,
    revenueSnapshotStatus: revenueSnapshot?.status ?? 'unavailable',
    currency: revenueSnapshot?.currency ?? null,
    amountExGstCents: revenueSnapshot?.amountExGstCents ?? null,
    gstAmountCents: revenueSnapshot?.gstAmountCents ?? null,
    totalIncGstCents: revenueSnapshot?.totalIncGstCents ?? null,
    gstRateBps: revenueSnapshot?.gstRateBps ?? null,
    revenueCapturedAt: revenueSnapshot ? observedAt : null,
    createdAt: observedAt,
  }).onConflictDoNothing({
    target: [
      schedulerJobCompletionFacts.sourceApp,
      schedulerJobCompletionFacts.sourceType,
      schedulerJobCompletionFacts.sourceId,
    ],
  });
}

/**
 * Projects a product completion onto every non-cancelled linked Scheduler row.
 *
 * Re-observing a completion is deliberately safe: rows already marked done are
 * left untouched, while their still-pending automated reminders are reconciled
 * again. Manual reminder history is not cancelled or rewritten.
 */
export function completeLinkedSchedulerEvents(
  executor: SchedulerCompletionExecutor,
  source: CommercialCompletionSource,
  options: SchedulerCompletionOptions & {
    completionProvenance: SchedulerCompletionProvenance;
  },
): Promise<SchedulerCompletionResult>;
export function completeLinkedSchedulerEvents(
  executor: SchedulerCompletionExecutor,
  source: SolarSiteCompletionSource,
  options?: Omit<SchedulerCompletionOptions, 'completionProvenance'>,
): Promise<SchedulerCompletionResult>;
export async function completeLinkedSchedulerEvents(
  executor: SchedulerCompletionExecutor,
  source: SchedulerCompletionSource,
  options: SchedulerCompletionOptions = {},
): Promise<SchedulerCompletionResult> {
  const isSolarSite = source.sourceApp === 'solarsense' && source.sourceType === 'site';
  if (!isSolarSite && !options.completionProvenance) {
    throw new Error('completion_provenance_required');
  }
  const observedAt = options.observedAt ?? new Date();
  const cancelNotifications = options.cancelNotifications
    ?? cancelPendingSchedulerNotifications;
  const recordCompletionFact = options.recordCompletionFact
    ?? recordSchedulerCompletionFact;
  const matched = await executor
    .select({
      id: portalScheduleEvents.id,
      jobId: portalScheduleEvents.jobId,
      status: portalScheduleEvents.status,
      assigneeFieldUserId: portalScheduleEvents.assigneeFieldUserId,
      assigneeDisplayName: portalScheduleEvents.assigneeDisplayName,
      updatedAt: portalScheduleEvents.updatedAt,
    })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, source.sourceApp),
      eq(portalScheduleEvents.sourceType, source.sourceType),
      eq(portalScheduleEvents.sourceId, source.sourceId),
      ne(portalScheduleEvents.status, 'cancelled'),
    ))
    .for('update');

  const transitionedEventIds = matched
    .filter((event) => event.status !== 'done')
    .map((event) => event.id);
  if (transitionedEventIds.length > 0) {
    await executor
      .update(portalScheduleEvents)
      .set({
        status: 'done',
        cancelledAt: null,
        updatedAt: observedAt,
      })
      .where(and(
        inArray(portalScheduleEvents.id, transitionedEventIds),
        ne(portalScheduleEvents.status, 'cancelled'),
        ne(portalScheduleEvents.status, 'done'),
      ));
    const transitionedJobIds = matched
      .filter((event) => event.status !== 'done' && event.jobId)
      .map((event) => event.jobId as string);
    if (transitionedJobIds.length > 0) {
      await executor.update(businessJobs)
        .set({ status: 'done', updatedAt: observedAt })
        .where(inArray(businessJobs.id, transitionedJobIds));
    }
  }

  for (const event of matched) {
    await cancelNotifications(
      executor,
      event.id,
      { automatedOnly: true },
      observedAt,
    );
  }

  await recordCompletionFact(
    executor,
    source,
    matched,
    observedAt,
    options.completionProvenance ?? 'historical_replay',
  );

  return {
    matchedEventIds: matched.map((event) => event.id),
    transitionedEventIds,
  };
}
