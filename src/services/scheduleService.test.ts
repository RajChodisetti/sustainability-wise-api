import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByDeadlineUrgency } from './scheduleService.js';

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
