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

test('backend Scheduler visibility exposes only Field App and custom work', () => {
  assert.deepEqual(
    schedulerVisibleSourceApps(),
    ['installhub', 'custom'],
  );
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(),
    ['installhub'],
  );
  assert.equal(isSchedulerSourceAppVisible('ecoaudit'), false);
  assert.equal(isSchedulerSourceAppVisible('solarsense'), false);
  assert.equal(isSchedulerSourceAppVisible('installhub'), true);
  assert.equal(isSchedulerSourceAppVisible('custom'), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub']), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub', 'custom']), true);
  assert.equal(areSchedulerSourceAppsVisible(['installhub', 'ecoaudit']), false);
});

test('the runtime guard hides non-Scheduler sources with the same 404 boundary', () => {
  assert.doesNotThrow(() => assertSchedulerSourceAppVisible('installhub'));
  assert.doesNotThrow(() => assertSchedulerSourceAppVisible('custom'));
  for (const sourceApp of ['ecoaudit', 'solarsense', 'unknown']) {
    assert.throws(
      () => assertSchedulerSourceAppVisible(sourceApp),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 404
        && error.message === 'Scheduler job not found',
      sourceApp,
    );
  }
});
