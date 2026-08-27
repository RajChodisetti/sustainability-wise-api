import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schedulerDefaultSourceApp,
  schedulerCreatableSourceApps,
  schedulerIsFieldOnly,
  schedulerSelectableSourceApps,
  schedulerSourceAppIsSelectable,
  schedulerSourceAppIsVisible,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from './visibility';

test('existing Scheduler work remains visible across every source', () => {
  const visibleSourceApps = schedulerVisibleSourceApps();
  assert.deepEqual(visibleSourceApps, ['ecoaudit', 'solarsense', 'installhub', 'custom']);
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(visibleSourceApps),
    ['ecoaudit', 'solarsense', 'installhub'],
  );
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'ecoaudit'), true);
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'solarsense'), true);
  assert.equal(schedulerIsFieldOnly(visibleSourceApps), false);
});

test('new Scheduler work is limited to Field App and custom jobs', () => {
  const all = schedulerSelectableSourceApps();
  assert.deepEqual(
    schedulerCreatableSourceApps(all, ['ecoaudit']),
    ['installhub', 'custom'],
  );
  assert.deepEqual(
    schedulerCreatableSourceApps(all, ['ecoaudit', 'solarsense', 'installhub']),
    all,
  );
});

test('Scheduler creation controls hide EcoAudit and SolarSense', () => {
  const selectableSourceApps = schedulerSelectableSourceApps();
  assert.deepEqual(selectableSourceApps, ['installhub', 'custom']);
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(selectableSourceApps),
    ['installhub'],
  );
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'ecoaudit'), false);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'solarsense'), false);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'installhub'), true);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'custom'), true);
  assert.equal(schedulerIsFieldOnly(selectableSourceApps), true);
});

test('new Scheduler work defaults to Field App, never a display-only source', () => {
  assert.equal(schedulerDefaultSourceApp(schedulerSelectableSourceApps()), 'installhub');
  assert.equal(schedulerDefaultSourceApp(schedulerVisibleSourceApps()), 'installhub');
});
