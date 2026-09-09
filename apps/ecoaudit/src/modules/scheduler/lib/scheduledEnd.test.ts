import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scheduledEndAtFromLocal,
  scheduledEndError,
  scheduledEndLocalParts,
  scheduledEndUpdate,
} from './scheduledEnd';

test('optional end time uses the selected end date or the start date', () => {
  const start = '2026-09-09T09:00';
  assert.equal(scheduledEndAtFromLocal(start, '', ''), null);
  assert.equal(
    scheduledEndAtFromLocal(start, '', '17:30'),
    new Date('2026-09-09T17:30').toISOString(),
  );
  assert.equal(
    scheduledEndAtFromLocal(start, '2026-09-10', '08:15'),
    new Date('2026-09-10T08:15').toISOString(),
  );
});

test('end time must be after start and edits preserve unchanged values', () => {
  assert.equal(scheduledEndError('2026-09-09T09:00', '', ''), null);
  assert.equal(
    scheduledEndError('2026-09-09T09:00', '', '08:59'),
    'End time must be after the start time.',
  );
  const end = new Date('2026-09-09T17:30').toISOString();
  assert.deepEqual(scheduledEndUpdate(end, end), {});
  assert.deepEqual(scheduledEndUpdate(end, null), { scheduledEndAt: null });
});

test('stored end timestamps are restored as local date and time fields', () => {
  const value = new Date(2026, 8, 9, 17, 30).toISOString();
  assert.deepEqual(scheduledEndLocalParts(value), {
    date: '2026-09-09',
    time: '17:30',
  });
});
