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

test('new cross-product work is offered only when the actor has the required product identity', () => {
  const all = schedulerSelectableSourceApps();
  assert.deepEqual(
    schedulerCreatableSourceApps(all, ['ecoaudit']),
    ['ecoaudit', 'installhub', 'custom'],
  );
  assert.deepEqual(
    schedulerCreatableSourceApps(all, ['ecoaudit', 'solarsense', 'installhub']),
    all,
  );
});

test('Scheduler controls and unscheduled drag choices cover every supported job type', () => {
  const selectableSourceApps = schedulerSelectableSourceApps();
  assert.deepEqual(selectableSourceApps, ['ecoaudit', 'solarsense', 'installhub', 'custom']);
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(selectableSourceApps),
    ['ecoaudit', 'solarsense', 'installhub'],
  );
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'ecoaudit'), true);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'solarsense'), true);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'installhub'), true);
  assert.equal(schedulerSourceAppIsSelectable(selectableSourceApps, 'custom'), true);
  assert.equal(schedulerIsFieldOnly(selectableSourceApps), false);
});

test('new Scheduler work defaults to Field App, never a display-only source', () => {
  assert.equal(schedulerDefaultSourceApp(schedulerSelectableSourceApps()), 'installhub');
  assert.equal(schedulerDefaultSourceApp(schedulerVisibleSourceApps()), 'installhub');
});
