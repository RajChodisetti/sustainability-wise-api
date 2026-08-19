import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPortalSchedulerApp,
  createScheduleEvent,
  createSchedulerDispatch,
  isSchedulerSourceEnabled,
  listUnscheduledJobs,
  searchJobOptions,
  sortByDeadlineUrgency,
} from './scheduleService.js';

const ecoAdmin = {
  app: 'ecoaudit',
  role: 'admin',
  userId: 'eco-admin-1',
} as never;

test('Eco Audit is disabled as scheduler work without disabling other sources', () => {
  assert.doesNotThrow(() => assertPortalSchedulerApp(ecoAdmin));
  assert.equal(isSchedulerSourceEnabled('ecoaudit'), false);
  assert.equal(isSchedulerSourceEnabled('solarsense'), true);
  assert.equal(isSchedulerSourceEnabled('installhub'), true);
  assert.equal(isSchedulerSourceEnabled('custom'), true);
});

test('Eco Audit jobs cannot be searched, listed as unscheduled, linked, or dispatched', async () => {
  assert.deepEqual(await searchJobOptions(ecoAdmin, 'site', 'ecoaudit'), []);
  assert.deepEqual(await listUnscheduledJobs(ecoAdmin, { sourceApp: 'ecoaudit' }), []);
  const isDisabledEcoSourceError = (error: unknown) => {
    assert.equal(
      (error as { detail?: string }).detail,
      'Eco Audit jobs are not available in Scheduler',
    );
    return true;
  };
  await assert.rejects(
    createScheduleEvent(ecoAdmin, { sourceApp: 'ecoaudit' } as never),
    isDisabledEcoSourceError,
  );
  await assert.rejects(
    createSchedulerDispatch(ecoAdmin, { sourceApp: 'ecoaudit' } as never),
    isDisabledEcoSourceError,
  );
});

test('sortByDeadlineUrgency puts overdue and soonest first; done last', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const sorted = sortByDeadlineUrgency(
    [
      { id: 'future', deadlineAt: '2026-08-20T00:00:00.000Z', status: 'planned' },
      { id: 'overdue', deadlineAt: '2026-08-01T00:00:00.000Z', status: 'planned' },
      { id: 'soon', deadlineAt: '2026-08-11T00:00:00.000Z', status: 'in_progress' },
      { id: 'done', deadlineAt: '2026-08-05T00:00:00.000Z', status: 'done' },
    ],
    now,
  );
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['overdue', 'soon', 'future', 'done'],
  );
});
