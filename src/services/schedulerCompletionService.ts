import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { portalScheduleEvents } from '../db/schema/shared.js';
import { cancelPendingSchedulerNotifications } from './schedulerNotificationService.js';

export type SchedulerCompletionSource =
  | { sourceApp: 'ecoaudit'; sourceType: 'audit'; sourceId: string }
  | { sourceApp: 'solarsense'; sourceType: 'site' | 'assessment'; sourceId: string }
  | { sourceApp: 'installhub'; sourceType: 'installation'; sourceId: string };

type SchedulerCompletionExecutor = Pick<typeof db, 'insert' | 'select' | 'update'>;
type SchedulerNotificationCanceller = typeof cancelPendingSchedulerNotifications;

export type SchedulerCompletionResult = {
  matchedEventIds: string[];
  transitionedEventIds: string[];
};

/**
 * Projects a product completion onto every non-cancelled linked Scheduler row.
 *
 * Re-observing a completion is deliberately safe: rows already marked done are
 * left untouched, while their still-pending automated reminders are reconciled
 * again. Manual reminder history is not cancelled or rewritten.
 */
export async function completeLinkedSchedulerEvents(
  executor: SchedulerCompletionExecutor,
  source: SchedulerCompletionSource,
  options: {
    observedAt?: Date;
    cancelNotifications?: SchedulerNotificationCanceller;
  } = {},
): Promise<SchedulerCompletionResult> {
  const observedAt = options.observedAt ?? new Date();
  const cancelNotifications = options.cancelNotifications
    ?? cancelPendingSchedulerNotifications;
  const matched = await executor
    .select({
      id: portalScheduleEvents.id,
      status: portalScheduleEvents.status,
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
  }

  for (const event of matched) {
    await cancelNotifications(
      executor,
      event.id,
      { automatedOnly: true },
      observedAt,
    );
  }

  return {
    matchedEventIds: matched.map((event) => event.id),
    transitionedEventIds,
  };
}
