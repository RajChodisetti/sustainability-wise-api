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

test('backend Scheduler visibility preserves every supported source', () => {
  assert.deepEqual(
    schedulerVisibleSourceApps(),
    ['ecoaudit', 'solarsense', 'installhub', 'custom'],
  );
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(),
    ['ecoaudit', 'solarsense', 'installhub'],
  );
  assert.equal(isSchedulerSourceAppVisible('ecoaudit'), true);
  assert.equal(isSchedulerSourceAppVisible('solarsense'), true);
  assert.equal(isSchedulerSourceAppVisible('installhub'), true);
  assert.equal(isSchedulerSourceAppVisible('custom'), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub']), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub', 'ecoaudit']), true);
});

test('the runtime guard accepts supported sources and rejects unknown applications', () => {
  assert.doesNotThrow(() => assertSchedulerSourceAppVisible('installhub'));
  assert.doesNotThrow(() => assertSchedulerSourceAppVisible('ecoaudit'));
  assert.throws(
    () => assertSchedulerSourceAppVisible('unknown'),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
});
