import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availabilityPercent,
  classifyFleetObservation,
  lastUsableReportOffline,
  reportTransition,
} from './status.js';

const observedAt = new Date('2026-07-16T00:00:00.000Z');
const thresholds = {
  delayedThresholdMinutes: 15,
  offlineThresholdMinutes: 60,
  reportOfflineThresholdHours: 24,
};

test('connectivity uses lastHeardAt thresholds and a distinct report cohort', () => {
  const delayed = classifyFleetObservation({
    fetchStatus: 'ok', uninitialised: false, observedAt,
    lastHeardAt: new Date(observedAt.getTime() - 20 * 60_000), thresholds,
  });
  assert.equal(delayed.status, 'delayed');
  assert.equal(delayed.reportOffline, false);

  const connectivityOfflineOnly = classifyFleetObservation({
    fetchStatus: 'ok', uninitialised: false, observedAt,
    lastHeardAt: new Date(observedAt.getTime() - 2 * 60 * 60_000), thresholds,
  });
  assert.equal(connectivityOfflineOnly.status, 'offline');
  assert.equal(connectivityOfflineOnly.reportOffline, false);

  const offline = classifyFleetObservation({
    fetchStatus: 'ok', uninitialised: false, observedAt,
    lastHeardAt: new Date(observedAt.getTime() - 25 * 60 * 60_000), thresholds,
  });
  assert.equal(offline.status, 'offline');
  assert.equal(offline.reportOffline, true);
});

test('uninitialised stays inactive while retaining the legacy email cohort rule', () => {
  const neverHeard = classifyFleetObservation({
    fetchStatus: 'ok', uninitialised: true, observedAt, lastHeardAt: null, thresholds,
  });
  assert.equal(neverHeard.status, 'inactive');
  assert.equal(neverHeard.reportOffline, false);

  const oldHeartbeat = classifyFleetObservation({
    fetchStatus: 'ok', uninitialised: true, observedAt,
    lastHeardAt: new Date(observedAt.getTime() - 25 * 60 * 60_000), thresholds,
  });
  assert.equal(oldHeartbeat.status, 'inactive');
  assert.equal(oldHeartbeat.reportOffline, true);

  assert.equal(classifyFleetObservation({
    fetchStatus: 'error', uninitialised: false, observedAt, lastHeardAt: null, thresholds,
  }).status, 'unknown');
});

test('report transitions do not claim recovery from unusable observations', () => {
  assert.equal(reportTransition(false, true, 'offline'), 'newly_offline');
  assert.equal(reportTransition(true, false, 'communicating'), 'recovered');
  assert.equal(reportTransition(true, false, 'unknown'), 'unknown');
  assert.equal(reportTransition(null, true, 'offline'), 'baseline_offline');
});

test('report transitions carry the last usable state across unknown or inactive gaps', () => {
  const previous = lastUsableReportOffline([
    { status: 'unknown', reportOffline: false },
    { status: 'inactive', reportOffline: false },
    { status: 'offline', reportOffline: true },
  ]);
  assert.equal(previous, true);
  assert.equal(reportTransition(previous, true, 'offline'), 'still_offline');
});

test('availability excludes inactive and unknown cohorts', () => {
  assert.equal(availabilityPercent({ communicating: 8, delayed: 1, offline: 1 }), 80);
  assert.equal(availabilityPercent({ communicating: 0, delayed: 0, offline: 0 }), null);
});
