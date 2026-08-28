import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schedulerDefaultSourceApp,
  schedulerCreatableSourceApps,
  schedulerEventSupportsMobileNotifications,
  schedulerIsFieldOnly,
  schedulerSelectableSourceApps,
  schedulerSourceAppIsSelectable,
  schedulerSourceAppIsVisible,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from './visibility';

test('Scheduler visibility is limited to Field App and custom work', () => {
  const visibleSourceApps = schedulerVisibleSourceApps();
  assert.deepEqual(visibleSourceApps, ['installhub', 'custom']);
  assert.deepEqual(
    schedulerVisibleFinanceSourceApps(visibleSourceApps),
    ['installhub'],
  );
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'ecoaudit'), false);
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'solarsense'), false);
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'installhub'), true);
  assert.equal(schedulerSourceAppIsVisible(visibleSourceApps, 'custom'), true);
  assert.equal(schedulerIsFieldOnly(visibleSourceApps), true);
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

test('only linked Field App jobs support Scheduler mobile notifications', () => {
  assert.equal(schedulerEventSupportsMobileNotifications({
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'installation-1',
  }), true);
  assert.equal(schedulerEventSupportsMobileNotifications({
    sourceApp: 'ecoaudit',
    sourceType: 'audit',
    sourceId: 'audit-1',
  }), false);
  assert.equal(schedulerEventSupportsMobileNotifications({
    sourceApp: 'solarsense',
    sourceType: 'assessment',
    sourceId: 'assessment-1',
  }), false);
  assert.equal(schedulerEventSupportsMobileNotifications({
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: '   ',
  }), false);
});
