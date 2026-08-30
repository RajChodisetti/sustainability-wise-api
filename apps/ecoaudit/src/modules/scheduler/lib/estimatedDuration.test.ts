import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimatedDurationError,
  estimatedDurationUpdate,
  formatEstimatedDuration,
  MAX_ESTIMATED_DURATION_MINUTES,
  parseEstimatedDurationMinutes,
} from './estimatedDuration';

test('optional estimated duration remains absent when the field is blank', () => {
  assert.equal(parseEstimatedDurationMinutes(''), null);
  assert.equal(parseEstimatedDurationMinutes('   '), null);
  assert.equal(estimatedDurationError(''), null);
});

test('estimated duration accepts positive whole minutes through seven days', () => {
  assert.equal(parseEstimatedDurationMinutes('1'), 1);
  assert.equal(parseEstimatedDurationMinutes(' 90 '), 90);
  assert.equal(
    parseEstimatedDurationMinutes(String(MAX_ESTIMATED_DURATION_MINUTES)),
    MAX_ESTIMATED_DURATION_MINUTES,
  );
});

test('estimated duration rejects fractions, signs, zero, and out-of-range values', () => {
  for (const value of ['0', '-1', '+1', '1.5', 'ten', '10081']) {
    assert.equal(parseEstimatedDurationMinutes(value), undefined, value);
    assert.ok(estimatedDurationError(value));
  }
});

test('unchanged blank estimate does not clear a historical end time during edit', () => {
  assert.deepEqual(estimatedDurationUpdate(null, null), {});
  assert.deepEqual(estimatedDurationUpdate(90, 90), {});
  assert.deepEqual(estimatedDurationUpdate(90, null), { estimatedDurationMinutes: null });
  assert.deepEqual(estimatedDurationUpdate(null, 45), { estimatedDurationMinutes: 45 });
});

test('estimated duration is formatted for delayed calendar details', () => {
  assert.equal(formatEstimatedDuration(null), 'Not estimated');
  assert.equal(formatEstimatedDuration(45), '45 min');
  assert.equal(formatEstimatedDuration(60), '1 hr');
  assert.equal(formatEstimatedDuration(90), '1 hr 30 min');
  assert.equal(formatEstimatedDuration(120), '2 hrs');
});
