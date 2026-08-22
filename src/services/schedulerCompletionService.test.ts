import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSchedulerCompletionAttributionEvents } from './schedulerCompletionAttribution.js';
import { completeLinkedSchedulerEvents } from './schedulerCompletionService.js';

test('first-completion event selection is deterministic for exact timestamp ties', () => {
  const updatedAt = new Date('2026-08-21T12:00:00.000Z');
  const sorted = [
    { id: 'done-newer', status: 'done', updatedAt: new Date(updatedAt.getTime() + 1_000) },
    { id: 'active-z', status: 'planned', updatedAt },
    { id: 'active-a', status: 'in_progress', updatedAt },
  ].sort(compareSchedulerCompletionAttributionEvents);
  assert.deepEqual(sorted.map((event) => event.id), [
    'active-a',
    'active-z',
    'done-newer',
  ]);
});

test('product completion marks linked work done and only cancels automated reminders', async () => {
  const events = [
    { id: 'planned-event', status: 'planned' },
    { id: 'progress-event', status: 'in_progress' },
    { id: 'done-event', status: 'done' },
  ];
  const notifications = events.flatMap((event) => [
    { eventId: event.id, kind: 'one_hour_before', status: 'queued' },
    { eventId: event.id, kind: 'manual_reminder', status: 'queued' },
  ]);
  const updates: Array<Record<string, unknown>> = [];
  const completionProvenance: string[] = [];
  const executor = {
    insert: () => {
      throw new Error('insert is not expected');
    },
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => events.map((event) => ({ ...event })),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          for (const event of events) {
            if (event.status !== 'done') event.status = String(values.status);
          }
        },
      }),
    }),
  } as never;
  const observedAt = new Date('2026-08-21T12:00:00.000Z');
  const cancelNotifications = async (
    _executor: never,
    eventId: string,
    options: { automatedOnly?: boolean },
    completedAt: Date,
  ) => {
    assert.deepEqual(options, { automatedOnly: true });
    assert.equal(completedAt, observedAt);
    for (const notification of notifications) {
      if (notification.eventId === eventId && notification.kind !== 'manual_reminder') {
        notification.status = 'cancelled';
      }
    }
  };

  const first = await completeLinkedSchedulerEvents(executor, {
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'installation-1',
  }, {
    observedAt,
    cancelNotifications: cancelNotifications as never,
    completionProvenance: 'direct_transition',
    recordCompletionFact: async (_executor, _source, _events, _observedAt, provenance) => {
      completionProvenance.push(provenance);
    },
  });
  assert.deepEqual(first, {
    matchedEventIds: ['planned-event', 'progress-event', 'done-event'],
    transitionedEventIds: ['planned-event', 'progress-event'],
  });
  assert.deepEqual(events.map((event) => event.status), ['done', 'done', 'done']);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.updatedAt, observedAt);
  assert.ok(notifications
    .filter((notification) => notification.kind === 'one_hour_before')
    .every((notification) => notification.status === 'cancelled'));
  assert.ok(notifications
    .filter((notification) => notification.kind === 'manual_reminder')
    .every((notification) => notification.status === 'queued'));

  const second = await completeLinkedSchedulerEvents(executor, {
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'installation-1',
  }, {
    observedAt,
    cancelNotifications: cancelNotifications as never,
    completionProvenance: 'historical_replay',
    recordCompletionFact: async (_executor, _source, _events, _observedAt, provenance) => {
      completionProvenance.push(provenance);
    },
  });
  assert.deepEqual(second.transitionedEventIds, []);
  assert.equal(updates.length, 1);
  assert.deepEqual(completionProvenance, ['direct_transition', 'historical_replay']);
});
