import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schedulerDefaultSourceApp,
  schedulerFlagEnabled,
  schedulerIsFieldOnly,
  schedulerSourceAppIsVisible,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from './visibility';

test('scheduler flag parsing matches the API boolean convention', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(schedulerFlagEnabled(value), true);
  }
  for (const value of [undefined, '', '0', 'false', 'off', ' true ']) {
    assert.equal(schedulerFlagEnabled(value), false);
  }
});

test('flag-on portal visibility keeps Field App and custom work only', () => {
  const sourceApps = schedulerVisibleSourceApps(true);
  assert.deepEqual(sourceApps, ['installhub', 'custom']);
  assert.deepEqual(schedulerVisibleFinanceSourceApps(sourceApps), ['installhub']);
  assert.equal(schedulerSourceAppIsVisible(sourceApps, 'ecoaudit'), false);
  assert.equal(schedulerSourceAppIsVisible(sourceApps, 'solarsense'), false);
  assert.equal(schedulerSourceAppIsVisible(sourceApps, 'installhub'), true);
  assert.equal(schedulerSourceAppIsVisible(sourceApps, 'custom'), true);
  assert.equal(schedulerIsFieldOnly(sourceApps), true);
});

test('flag-off portal visibility restores all Scheduler products', () => {
  const sourceApps = schedulerVisibleSourceApps(false);
  assert.deepEqual(sourceApps, ['ecoaudit', 'solarsense', 'installhub', 'custom']);
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(sourceApps),
    ['ecoaudit', 'solarsense', 'installhub'],
  );
  assert.equal(schedulerIsFieldOnly(sourceApps), false);
});

test('new scheduler work defaults to the first supported product', () => {
  assert.equal(schedulerDefaultSourceApp(schedulerVisibleSourceApps(false)), 'ecoaudit');
  assert.equal(schedulerDefaultSourceApp(schedulerVisibleSourceApps(true)), 'installhub');
});
