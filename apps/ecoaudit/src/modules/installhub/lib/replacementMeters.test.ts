import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeReplacementMeterNumbers,
  plannedReplacementMeterNumber,
  replacementMeterNumbersFromStored,
  storedReplacementMeterNumbers,
} from '../components/ReplacementMeterPicker';

test('replacement meter planning trims, deduplicates, and round-trips multiple meter numbers', () => {
  assert.deepEqual(
    normalizeReplacementMeterNumbers([' WW-100 ', 'ww-100', 'WW-200']),
    ['WW-100', 'WW-200'],
  );
  assert.equal(storedReplacementMeterNumbers(['WW-100', 'WW-200']), 'WW-100\nWW-200');
  assert.deepEqual(replacementMeterNumbersFromStored('WW-100\nWW-200'), ['WW-100', 'WW-200']);
  assert.equal(plannedReplacementMeterNumber('WW-100\nWW-200', ' ww-200 '), 'WW-200');
  assert.equal(plannedReplacementMeterNumber('WW-100\nWW-200', 'WW-300'), null);
  assert.equal(
    storedReplacementMeterNumbers(Array.from({ length: 51 }, () => 'WW-100')),
    'WW-100',
  );
  assert.throws(
    () => storedReplacementMeterNumbers(Array.from({ length: 51 }, (_, index) => `WW-${index}`)),
    /at most 50 unique meters/,
  );
  assert.throws(
    () => storedReplacementMeterNumbers(['X'.repeat(201)]),
    /at most 200 characters/,
  );
  assert.throws(
    () => storedReplacementMeterNumbers(Array.from({ length: 50 }, (_, index) => (
      `${String(index).padStart(3, '0')}${'X'.repeat(197)}`
    ))),
    /at most 10,000 characters in total/,
  );
});
