import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  areSchedulerSourceAppsVisible,
  assertSchedulerSourceAppVisible,
  isSchedulerSourceAppVisible,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from './schedulerVisibility.js';

test('scheduler visibility preserves every source when the flag is false', () => {
  assert.deepEqual(
    schedulerVisibleSourceApps(false),
    ['ecoaudit', 'solarsense', 'installhub', 'custom'],
  );
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(false),
    ['ecoaudit', 'solarsense', 'installhub'],
  );
  assert.equal(isSchedulerSourceAppVisible('ecoaudit', false), true);
  assert.equal(isSchedulerSourceAppVisible('solarsense', false), true);
});

test('scheduler visibility hides Eco Audit and Solar Sense only when the flag is true', () => {
  assert.deepEqual(schedulerVisibleSourceApps(true), ['installhub', 'custom']);
  assert.deepEqual(schedulerVisibleFinanceSourceApps(true), ['installhub']);
  assert.equal(isSchedulerSourceAppVisible('ecoaudit', true), false);
  assert.equal(isSchedulerSourceAppVisible('solarsense', true), false);
  assert.equal(isSchedulerSourceAppVisible('installhub', true), true);
  assert.equal(isSchedulerSourceAppVisible('custom', true), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub'], true), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub', 'ecoaudit'], true), false);
});

test('the runtime guard returns a non-discoverable response for hidden jobs', () => {
  assert.doesNotThrow(() => assertSchedulerSourceAppVisible('installhub', true));
  assert.throws(
    () => assertSchedulerSourceAppVisible('ecoaudit', true),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
});
