import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_NOTIFICATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('product completion atomically marks linked events done and preserves manual reminders', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    {
      globalUsers,
      portalScheduleEvents,
      schedulerNotificationJobs,
    },
    { completeLinkedSchedulerEvents },
    { and, eq, inArray },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/shared.js'),
    import('./schedulerCompletionService.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const globalUserId = `completion-global-${runId}`;
  const fieldUserId = `completion-field-${runId}`;
  const sourceId = `completion-installation-${runId}`;
  const eventId = `completion-event-${runId}`;
  const cancelledEventId = `completion-cancelled-event-${runId}`;
  const firstObservedAt = new Date('2026-08-21T12:00:00.000Z');
  const secondObservedAt = new Date('2026-08-21T13:00:00.000Z');
  const scheduledStartAt = new Date('2026-08-24T12:00:00.000Z');

  const notification = (
    id: string,
    linkedEventId: string,
    notificationKind: 'day_of' | 'one_day_before' | 'manual_reminder',
  ) => ({
    id,
    eventId: linkedEventId,
    globalUserId,
    sourceApp: 'installhub',
    notificationKind,
    title: 'Scheduler test',
    body: 'Scheduler completion integration test',
    payload: {
      type: 'scheduler' as const,
      notificationKind,
      eventId: linkedEventId,
      sourceApp: 'installhub' as const,
      sourceType: 'installation',
      sourceId,
      scheduledStartAt: scheduledStartAt.toISOString(),
    },
    dedupeKey: `completion:${runId}:${id}`,
    status: 'queued',
    availableAt: scheduledStartAt,
  });

  try {
    await db.insert(globalUsers).values({
      id: globalUserId,
      loginKey: `completion-${runId}@example.test`,
      fieldUserId,
      primaryOriginApp: 'installhub',
      primaryOriginUserId: `completion-origin-${runId}`,
      displayEmail: `completion-${runId}@example.test`,
      fullName: 'Completion Test User',
      role: 'inspector',
      isActive: true,
    });
    await db.insert(portalScheduleEvents).values([
      {
        id: eventId,
        title: 'Active linked job',
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt,
        deadlineAt: scheduledStartAt,
        status: 'planned',
        createdByUserId: globalUserId,
        createdByApp: 'installhub',
      },
      {
        id: cancelledEventId,
        title: 'Cancelled linked job',
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt,
        deadlineAt: scheduledStartAt,
        status: 'cancelled',
        createdByUserId: globalUserId,
        createdByApp: 'installhub',
        cancelledAt: firstObservedAt,
      },
    ]);
    await db.insert(schedulerNotificationJobs).values([
      notification(`automatic-${runId}`, eventId, 'day_of'),
      notification(`manual-${runId}`, eventId, 'manual_reminder'),
      notification(`cancelled-event-${runId}`, cancelledEventId, 'day_of'),
    ]);

    const first = await db.transaction((tx) => completeLinkedSchedulerEvents(tx, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId,
    }, { observedAt: firstObservedAt }));
    assert.deepEqual(first.matchedEventIds, [eventId]);
    assert.deepEqual(first.transitionedEventIds, [eventId]);

    const [completedEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eventId));
    assert.equal(completedEvent.status, 'done');
    assert.equal(completedEvent.updatedAt.getTime(), firstObservedAt.getTime());
    const firstJobs = await db.select().from(schedulerNotificationJobs)
      .where(inArray(schedulerNotificationJobs.eventId, [eventId, cancelledEventId]));
    assert.equal(firstJobs.find((job) => job.id === `automatic-${runId}`)?.status, 'cancelled');
    assert.equal(firstJobs.find((job) => job.id === `manual-${runId}`)?.status, 'queued');
    assert.equal(firstJobs.find((job) => job.id === `cancelled-event-${runId}`)?.status, 'queued');

    const recoveryJobId = `recovery-${runId}`;
    await db.insert(schedulerNotificationJobs).values(
      notification(recoveryJobId, eventId, 'one_day_before'),
    );
    const second = await db.transaction((tx) => completeLinkedSchedulerEvents(tx, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId,
    }, { observedAt: secondObservedAt }));
    assert.deepEqual(second.transitionedEventIds, []);
    const [reobservedEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eventId));
    assert.equal(reobservedEvent.updatedAt.getTime(), firstObservedAt.getTime());
    const [recoveryJob] = await db.select().from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.id, recoveryJobId),
        eq(schedulerNotificationJobs.eventId, eventId),
      ));
    assert.equal(recoveryJob.status, 'cancelled');
  } finally {
    await db.delete(portalScheduleEvents).where(inArray(
      portalScheduleEvents.id,
      [eventId, cancelledEventId],
    ));
    await db.delete(globalUsers).where(eq(globalUsers.id, globalUserId));
    await closeDb();
  }
});
