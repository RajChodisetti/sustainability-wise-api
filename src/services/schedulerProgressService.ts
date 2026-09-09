import { and, eq, inArray } from 'drizzle-orm';
import {
  businessJobs,
  portalScheduleEvents,
} from '../db/schema/shared.js';
import type { SchedulerFinanceExecutor } from './schedulerFinanceService.js';

type SchedulerProgressExecutor = SchedulerFinanceExecutor;

export type SchedulerProgressResult = {
  transitionedEventIds: string[];
};

/**
 * Project the first accepted Field App work checkpoint onto the linked
 * Scheduler event. Only the assigned technician may start a planned event;
 * done, cancelled, and already-in-progress rows remain untouched.
 */
export async function markLinkedInstallHubEventsInProgress(
  executor: SchedulerProgressExecutor,
  input: {
    installationId: string;
    actorUserId: string;
    observedAt?: Date;
  },
): Promise<SchedulerProgressResult> {
  const observedAt = input.observedAt ?? new Date();
  const matched = await executor
    .select({
      id: portalScheduleEvents.id,
      jobId: portalScheduleEvents.jobId,
      status: portalScheduleEvents.status,
    })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, 'installhub'),
      eq(portalScheduleEvents.sourceType, 'installation'),
      eq(portalScheduleEvents.sourceId, input.installationId),
      eq(portalScheduleEvents.assigneeFieldUserId, input.actorUserId),
      eq(portalScheduleEvents.status, 'planned'),
    ))
    .for('update');

  const transitionedEventIds = matched.map((event) => event.id);
  if (transitionedEventIds.length === 0) return { transitionedEventIds };

  await executor.update(portalScheduleEvents).set({
    status: 'in_progress',
    cancelledAt: null,
    updatedAt: observedAt,
  }).where(and(
    inArray(portalScheduleEvents.id, transitionedEventIds),
    eq(portalScheduleEvents.status, 'planned'),
  ));

  const transitionedJobIds = matched
    .map((event) => event.jobId)
    .filter((jobId): jobId is string => Boolean(jobId));
  if (transitionedJobIds.length > 0) {
    await executor.update(businessJobs).set({
      status: 'in_progress',
      updatedAt: observedAt,
    }).where(and(
      inArray(businessJobs.id, transitionedJobIds),
      eq(businessJobs.status, 'planned'),
    ));
  }

  return { transitionedEventIds };
}
