import assert from 'node:assert/strict';
import test from 'node:test';
import { fleetReportCohorts } from './reportCohorts';

test('fleetReportCohorts preserves the exact archived cohort order and counts', () => {
  const cohorts = fleetReportCohorts({
    offlineDeviceIds: ['DD0001', 'DD0002', 'DD0001'],
    newlyOfflineDeviceIds: ['DD0002'],
    recoveredDeviceIds: ['DD0003'],
    offlineCount: 3,
    newlyOfflineCount: 1,
    recoveredCount: 1,
  });

  assert.deepEqual(cohorts.map((cohort) => cohort.deviceIds), [
    ['DD0001', 'DD0002', 'DD0001'],
    ['DD0002'],
    ['DD0003'],
  ]);
  assert.deepEqual(cohorts.map((cohort) => cohort.archivedCount), [3, 1, 1]);
});

test('fleetReportCohorts distinguishes a retained count from a missing ID list', () => {
  const cohorts = fleetReportCohorts({ offlineCount: 4 });

  assert.equal(cohorts[0].archivedCount, 4);
  assert.deepEqual(cohorts[0].deviceIds, []);
  assert.equal(cohorts[1].archivedCount, null);
});
