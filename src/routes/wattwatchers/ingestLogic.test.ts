import assert from 'node:assert/strict';
import test from 'node:test';
import {
  absentClientIdsForPublishedInventory,
  clientCoverageIssue,
  collectionCanPublish,
  normalizeEmailDelta,
  outageAction,
  uniqueMemberships,
} from './ingestLogic.js';
import { reportTransition } from './status.js';

test('snapshot attribution keeps one membership per client without dropping other clients', () => {
  const memberships = uniqueMemberships([
    { code: 'maas', source: 1 },
    { code: 'maas', source: 2 },
    { code: 'retail', source: 3 },
  ], (entry) => entry.code);

  assert.deepEqual(memberships, [
    { code: 'maas', source: 1 },
    { code: 'retail', source: 3 },
  ]);
});

test('partial, failed, pending, or incomplete client results cannot publish', () => {
  assert.equal(collectionCanPublish(['success', 'success'], 2), true);
  assert.equal(collectionCanPublish(['success', 'partial'], 2), false);
  assert.equal(collectionCanPublish(['success', 'failed'], 2), false);
  assert.equal(collectionCanPublish(['success', 'pending'], 2), false);
  assert.equal(collectionCanPublish(['success'], 2), false);
});

test('a claimed success cannot publish when an observation batch was lost', () => {
  assert.match(clientCoverageIssue({
    status: 'success',
    requestedDeviceCount: 400,
    fetchedDeviceCount: 400,
    attributedDeviceCount: 250,
    observedFetchedDeviceCount: 250,
    observedNonOkDeviceCount: 0,
  }) ?? '', /requested=400, attributed=250/);

  assert.equal(clientCoverageIssue({
    status: 'success',
    requestedDeviceCount: 400,
    fetchedDeviceCount: 400,
    attributedDeviceCount: 400,
    observedFetchedDeviceCount: 400,
    observedNonOkDeviceCount: 0,
  }), null);
});

test('only full published inventories retire a removed client', () => {
  const input = { activeClientIds: ['client-a', 'client-b'], configuredClientIds: ['client-a'] };
  assert.deepEqual(absentClientIdsForPublishedInventory({
    ...input, publish: true, inventoryScope: 'full',
  }), ['client-b']);
  assert.deepEqual(absentClientIdsForPublishedInventory({
    ...input, publish: true, inventoryScope: 'partial',
  }), []);
  assert.deepEqual(absentClientIdsForPublishedInventory({
    ...input, publish: false, inventoryScope: 'full',
  }), []);
});

test('email delta counts are derived from its exact deduplicated device cohorts', () => {
  assert.deepEqual(normalizeEmailDelta({
    offlineDeviceIds: ['A', 'A', 'B'],
    newlyOfflineDeviceIds: ['B'],
    recoveredDeviceIds: ['C'],
    previousOfflineDeviceIds: ['A', 'C'],
    stateOfflineDeviceIds: ['A', 'B'],
    collectionComplete: true,
    offlineCount: 999,
  }), {
    offlineDeviceIds: ['A', 'B'],
    newlyOfflineDeviceIds: ['B'],
    recoveredDeviceIds: ['C'],
    previousOfflineDeviceIds: ['A', 'C'],
    stateOfflineDeviceIds: ['A', 'B'],
    offlineCount: 2,
    newlyOfflineCount: 1,
    recoveredCount: 1,
    previousOfflineCount: 2,
    stateOfflineCount: 2,
    collectionComplete: true,
  });
});

test('an advanced heartbeat rolls a daily-scan outage into a new incident', () => {
  const oldStop = new Date('2026-07-14T00:00:00.000Z');
  const newStop = new Date('2026-07-15T12:00:00.000Z');

  assert.equal(outageAction({
    status: 'offline',
    hasOpenOutage: true,
    openTelemetryStoppedAt: oldStop,
    currentLastHeardAt: newStop,
  }), 'rollover');
  assert.equal(outageAction({
    status: 'offline',
    hasOpenOutage: true,
    openTelemetryStoppedAt: oldStop,
    currentLastHeardAt: oldStop,
  }), 'extend');

  // Connectivity incidents roll over independently of the legacy 24-hour
  // report cohort, which remains continuously offline across these scans.
  assert.equal(reportTransition(true, true, 'offline'), 'still_offline');
});
