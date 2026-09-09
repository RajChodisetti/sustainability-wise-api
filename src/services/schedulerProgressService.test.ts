import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markLinkedInstallHubEventsInProgress,
} from './schedulerProgressService.js';

test('first Field App work advances only planned linked work to in progress', async () => {
  const events = [
    { id: 'planned-event', jobId: 'job-1', status: 'planned' },
  ];
  const updates: Array<Record<string, unknown>> = [];
  const executor = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => events.map((event) => ({ ...event })),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push(values); },
      }),
    }),
  } as never;
  const observedAt = new Date('2026-09-08T10:00:00.000Z');

  const result = await markLinkedInstallHubEventsInProgress(executor, {
    installationId: 'installation-1',
    actorUserId: 'technician-1',
    observedAt,
  });

  assert.deepEqual(result.transitionedEventIds, ['planned-event']);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], {
    status: 'in_progress',
    cancelledAt: null,
    updatedAt: observedAt,
  });
  assert.deepEqual(updates[1], {
    status: 'in_progress',
    updatedAt: observedAt,
  });
});

test('repeated work checkpoints leave an already-started event unchanged', async () => {
  let updates = 0;
  const executor = {
    select: () => ({
      from: () => ({
        where: () => ({ for: async () => [] }),
      }),
    }),
    update: () => {
      updates += 1;
      throw new Error('update is not expected');
    },
  } as never;

  const result = await markLinkedInstallHubEventsInProgress(executor, {
    installationId: 'installation-1',
    actorUserId: 'technician-1',
  });

  assert.deepEqual(result.transitionedEventIds, []);
  assert.equal(updates, 0);
});
