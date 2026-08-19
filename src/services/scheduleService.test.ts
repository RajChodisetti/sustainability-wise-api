import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  assertPortalSchedulerApp,
  createScheduleEvent,
  deriveScheduledEndAt,
  MAX_ESTIMATED_DURATION_MINUTES,
  parseEstimatedDurationMinutes,
  sortByDeadlineUrgency,
} from './scheduleService.js';

const ecoAdmin = {
  app: 'ecoaudit',
  role: 'admin',
  userId: 'eco-admin-1',
} as never;

test('Eco Audit administrators retain Scheduler access', () => {
  assert.doesNotThrow(() => assertPortalSchedulerApp(ecoAdmin));
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

test('estimated duration accepts only optional positive whole minutes within seven days', () => {
  assert.equal(parseEstimatedDurationMinutes(undefined), null);
  assert.equal(parseEstimatedDurationMinutes(null), null);
  assert.equal(parseEstimatedDurationMinutes(''), null);
  assert.equal(parseEstimatedDurationMinutes(1), 1);
  assert.equal(
    parseEstimatedDurationMinutes(MAX_ESTIMATED_DURATION_MINUTES),
    MAX_ESTIMATED_DURATION_MINUTES,
  );

  for (const invalid of [0, -1, 1.5, '60', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => parseEstimatedDurationMinutes(invalid),
      (error: unknown) => error instanceof AppError
        && error.detail?.startsWith('estimatedDurationMinutes must be a whole number') === true,
    );
  }
  assert.throws(
    () => parseEstimatedDurationMinutes(MAX_ESTIMATED_DURATION_MINUTES + 1),
    (error: unknown) => error instanceof AppError
      && error.detail?.startsWith('estimatedDurationMinutes must be a whole number') === true,
  );
});

test('calendar end is derived only when an estimate exists', () => {
  const start = new Date('2026-08-20T09:00:00.000Z');
  assert.equal(deriveScheduledEndAt(start, null), null);
  assert.equal(
    deriveScheduledEndAt(start, 90)?.toISOString(),
    '2026-08-20T10:30:00.000Z',
  );
});

test('client-provided end time is rejected before persistence', async () => {
  await assert.rejects(
    () => createScheduleEvent(ecoAdmin, {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: 'audit-id',
      assigneeFieldUserId: 'field-user',
      scheduledStartAt: '2026-08-20T09:00:00.000Z',
      scheduledEndAt: '2026-08-20T10:00:00.000Z',
      deadlineAt: '2026-08-22T17:00:00.000Z',
    }),
    (error: unknown) => error instanceof AppError
      && error.detail === (
        'scheduledEndAt is derived; refresh and provide estimatedDurationMinutes instead'
      ),
  );
});
