import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueAutomatedSchedulerNotifications,
  isMobileScheduleNotificationTarget,
  isMobileScheduleSourceApp,
  schedulerNotificationCopy,
  validateExpoPushToken,
  validateRegistrationGeneration,
} from './schedulerNotificationService.js';
import { scheduleBusinessFieldsChanged } from './scheduleService.js';

function scheduleEvent(start: Date) {
  const now = new Date('2026-08-15T08:00:00.000Z');
  return {
    id: 'event-1',
    title: 'Rooftop assessment',
    description: 'Private site directions must not be sent',
    sourceApp: 'solarsense',
    sourceType: 'assessment',
    sourceId: 'assessment-1',
    assigneeFieldUserId: 'field-user-1',
    assigneeDisplayName: 'Inspector',
    assigneeEmail: 'private@example.test',
    scheduledStartAt: start,
    scheduledEndAt: null,
    deadlineAt: new Date(start.getTime() + 60 * 60_000),
    status: 'planned',
    createdByUserId: 'admin-1',
    createdByApp: 'ecoaudit',
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
  };
}

function capturingExecutor() {
  const inserted: Array<Record<string, unknown>> = [];
  let selectCalls = 0;
  const executor = {
    select() {
      selectCalls += 1;
      const rows = selectCalls === 1
        ? [{
            globalUserId: 'global-user-1',
            fieldUserId: 'field-user-1',
            originUserId: 'solar-user-1',
          }]
        : [{ id: 'assessment-1' }];
      const chain = {
        from() { return chain; },
        innerJoin() { return chain; },
        where() { return chain; },
        limit: async () => rows,
      };
      return chain;
    },
    insert() {
      return {
        async values(value: Record<string, unknown>) {
          inserted.push(value);
        },
      };
    },
  };
  return { inserted, executor };
}

test('automatic reminders enqueue only future one-day and start-time triggers', async () => {
  const now = new Date('2026-08-15T08:00:00.000Z');
  const future = capturingExecutor();
  await enqueueAutomatedSchedulerNotifications(
    future.executor as never,
    scheduleEvent(new Date('2026-08-17T08:00:00.000Z')) as never,
    'global-user-1',
    now,
  );
  assert.deepEqual(
    future.inserted.map((row) => row.notificationKind),
    ['one_day_before', 'day_of'],
  );
  assert.deepEqual(
    future.inserted.map((row) => (row.availableAt as Date).toISOString()),
    ['2026-08-16T08:00:00.000Z', '2026-08-17T08:00:00.000Z'],
  );

  const insideOneDay = capturingExecutor();
  await enqueueAutomatedSchedulerNotifications(
    insideOneDay.executor as never,
    scheduleEvent(new Date('2026-08-15T20:00:00.000Z')) as never,
    'global-user-1',
    now,
  );
  assert.deepEqual(
    insideOneDay.inserted.map((row) => row.notificationKind),
    ['day_of'],
  );

  const past = capturingExecutor();
  await enqueueAutomatedSchedulerNotifications(
    past.executor as never,
    scheduleEvent(now) as never,
    'global-user-1',
    now,
  );
  assert.equal(past.inserted.length, 0);

  const terminal = capturingExecutor();
  await enqueueAutomatedSchedulerNotifications(
    terminal.executor as never,
    { ...scheduleEvent(new Date('2026-08-17T08:00:00.000Z')), status: 'done' } as never,
    'global-user-1',
    now,
  );
  assert.equal(terminal.inserted.length, 0);
});

test('only concrete mobile work pairs with a source ID are notification targets', () => {
  const event = scheduleEvent(new Date('2026-08-17T08:00:00.000Z'));
  assert.equal(isMobileScheduleNotificationTarget(event as never), true);
  assert.equal(isMobileScheduleNotificationTarget({
    ...event,
    sourceApp: 'ecoaudit',
    sourceType: 'audit',
  } as never), true);
  assert.equal(isMobileScheduleNotificationTarget({
    ...event,
    sourceApp: 'installhub',
    sourceType: 'installation',
  } as never), true);
  assert.equal(isMobileScheduleNotificationTarget({
    ...event,
    sourceType: 'site',
  } as never), false);
  assert.equal(isMobileScheduleNotificationTarget({
    ...event,
    sourceId: null,
  } as never), false);
  assert.equal(isMobileScheduleNotificationTarget({
    ...event,
    sourceApp: 'custom',
    sourceType: 'custom',
  } as never), false);
});

test('Eco Audit remains a supported mobile device app', () => {
  assert.equal(isMobileScheduleSourceApp('ecoaudit'), true);
});

test('scheduler payload contains routing IDs but no private description or credentials', async () => {
  const captured = capturingExecutor();
  await enqueueAutomatedSchedulerNotifications(
    captured.executor as never,
    scheduleEvent(new Date('2026-08-17T08:00:00.000Z')) as never,
    'global-user-1',
    new Date('2026-08-15T08:00:00.000Z'),
  );
  const row = captured.inserted[0];
  assert.deepEqual(Object.keys(row.payload as object).sort(), [
    'eventId',
    'notificationKind',
    'scheduledStartAt',
    'sourceApp',
    'sourceId',
    'sourceType',
    'type',
  ]);
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes('Rooftop assessment'), false);
  assert.equal(serialized.includes('Private site directions'), false);
  assert.equal(serialized.includes('private@example.test'), false);
});

test('notification copy is generic and Expo token validation accepts both prefixes', () => {
  const copy = schedulerNotificationCopy(
    'assigned',
    '  New   assessment  ',
    new Date('2026-08-20T09:30:00.000Z'),
  );
  assert.equal(copy.title, 'New job assigned');
  assert.equal(copy.body, 'You were assigned a scheduled job.');
  assert.equal(copy.body.includes('New assessment'), false);
  assert.deepEqual(schedulerNotificationCopy(
    'day_of',
    'Private job title',
    new Date('2026-08-20T23:00:00.000Z'),
  ), {
    title: 'Scheduled job reminder',
    body: 'You have a scheduled job.',
  });
  assert.equal(validateExpoPushToken('ExpoPushToken[abc_123-XYZ]'), 'ExpoPushToken[abc_123-XYZ]');
  assert.equal(validateExpoPushToken('ExponentPushToken[abc123]'), 'ExponentPushToken[abc123]');
  assert.throws(() => validateExpoPushToken('not-a-token'));
  assert.equal(validateRegistrationGeneration(1), 1);
  assert.equal(validateRegistrationGeneration(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.throws(() => validateRegistrationGeneration(0));
  assert.throws(() => validateRegistrationGeneration(1.5));
  assert.throws(() => validateRegistrationGeneration(Number.MAX_SAFE_INTEGER + 1));
});

test('scheduler no-op comparison ignores persistence timestamps', () => {
  const fields = {
    title: 'Audit',
    description: null,
    assigneeFieldUserId: 'field-user',
    scheduledStartAt: '2026-08-20T09:00:00.000Z',
    scheduledEndAt: null,
    deadlineAt: '2026-08-20T17:00:00.000Z',
    status: 'planned' as const,
  };
  assert.equal(scheduleBusinessFieldsChanged(fields, { ...fields }), false);
  assert.equal(scheduleBusinessFieldsChanged(fields, {
    ...fields,
    scheduledStartAt: '2026-08-21T09:00:00.000Z',
  }), true);
});
