import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWholeBillingHoursInput,
  stepWholeBillingHours,
  wholeBillingHours,
} from './billingHours';

test('billing hours round to the nearest non-negative whole hour', () => {
  assert.equal(wholeBillingHours(1.49), 1);
  assert.equal(wholeBillingHours(1.5), 2);
  assert.equal(wholeBillingHours(-1), 0);
  assert.equal(wholeBillingHours(Number.NaN), 0);
});

test('billing hours input accepts only empty or non-negative whole-number text', () => {
  assert.equal(isWholeBillingHoursInput(''), true);
  assert.equal(isWholeBillingHoursInput('0'), true);
  assert.equal(isWholeBillingHoursInput('12'), true);
  assert.equal(isWholeBillingHoursInput('01'), true);
  assert.equal(isWholeBillingHoursInput('1.5'), false);
  assert.equal(isWholeBillingHoursInput('-1'), false);
});

test('focused wheel steps billing hours by one without crossing zero', () => {
  assert.equal(stepWholeBillingHours('2', 1), '3');
  assert.equal(stepWholeBillingHours('2', -1), '1');
  assert.equal(stepWholeBillingHours('0', -1), '0');
  assert.equal(stepWholeBillingHours('', 1), '1');
});
