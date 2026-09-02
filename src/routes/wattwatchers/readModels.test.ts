import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchedRegisterRoles,
  resolveDevicePlacement,
  sortDevicePlacements,
  summarizeDeviceStatuses,
  type DevicePlacement,
} from './readModels.js';

function placement(input: Partial<DevicePlacement> & Pick<DevicePlacement, 'source'>): DevicePlacement {
  return {
    source: input.source,
    effectiveDate: input.effectiveDate ?? null,
    businessClient: input.businessClient ?? { id: 'client-1', name: 'Client' },
    site: input.site === undefined ? { id: 'site-1', name: 'Site', address: '1 Test St' } : input.site,
    deviceRole: input.deviceRole ?? 'current',
    provenance: input.provenance ?? null,
  };
}

test('Field placement wins while a competing imported current site is reported', () => {
  const result = resolveDevicePlacement([
    placement({
      source: 'maas_assignment',
      effectiveDate: '2026-08-01',
      site: { id: 'site-2', name: 'Imported', address: '2 Test St' },
    }),
    placement({ source: 'field_installation', effectiveDate: '2026-08-02' }),
  ]);
  assert.equal(result.currentPlacement?.source, 'field_installation');
  assert.equal(result.currentPlacement?.site?.id, 'site-1');
  assert.equal(result.placementConflict, true);
});

test('duplicate placement evidence at one site is not a conflict', () => {
  const result = resolveDevicePlacement([
    placement({ source: 'field_installation' }),
    placement({ source: 'maas_assignment', effectiveDate: '2026-08-01' }),
  ]);
  assert.equal(result.placementConflict, false);
});

test('historical replacement roles cannot become the current placement', () => {
  const historical = placement({
    source: 'maas_assignment',
    deviceRole: 'existing',
    effectiveDate: '2026-09-01',
  });
  const current = placement({
    source: 'maas_assignment',
    deviceRole: 'current',
    effectiveDate: '2026-08-01',
  });
  assert.equal(resolveDevicePlacement([historical, current]).currentPlacement?.effectiveDate, '2026-08-01');
});

test('imported placement ordering is stable by date, row, then assignment ID', () => {
  const rows = sortDevicePlacements([
    placement({
      source: 'maas_assignment', effectiveDate: '2026-08-01',
      provenance: { assignmentId: 'b', sourceWorkbook: 'w', sourceSheet: 's', sourceRow: 10 },
    }),
    placement({
      source: 'maas_assignment', effectiveDate: '2026-08-01',
      provenance: { assignmentId: 'a', sourceWorkbook: 'w', sourceSheet: 's', sourceRow: 11 },
    }),
  ]);
  assert.equal(rows[0]?.provenance?.assignmentId, 'a');
});

test('field placement ordering is deterministic when timestamps tie', () => {
  const rows = sortDevicePlacements([
    placement({
      source: 'field_installation',
      effectiveDate: '2026-08-01T00:00:00.000Z',
      site: { id: 'site-b', name: 'B', address: '2 Test St' },
    }),
    placement({
      source: 'field_installation',
      effectiveDate: '2026-08-01T00:00:00.000Z',
      site: { id: 'site-a', name: 'A', address: '1 Test St' },
    }),
  ]);
  assert.equal(rows[0]?.site?.id, 'site-a');
});

test('status summary keeps not-collected distinct from connectivity offline', () => {
  assert.deepEqual(summarizeDeviceStatuses([
    { status: 'communicating', fetchStatus: 'ok', reportOffline: false },
    { status: 'offline', fetchStatus: 'ok', reportOffline: true },
    { status: 'unknown', fetchStatus: 'not_collected', reportOffline: false },
  ]), {
    totalDevices: 3,
    communicating: 1,
    delayed: 0,
    offline: 1,
    inactive: 0,
    unknown: 1,
    notCollected: 1,
    reportOffline: 1,
  });
});

test('status summary safely treats future provider states as unknown', () => {
  assert.deepEqual(summarizeDeviceStatuses([
    { status: 'provider_pending', fetchStatus: 'ok', reportOffline: false },
  ]), {
    totalDevices: 1,
    communicating: 0,
    delayed: 0,
    offline: 0,
    inactive: 0,
    unknown: 1,
    notCollected: 0,
    reportOffline: 0,
  });
});

test('Meter Register evidence retains every matching device role', () => {
  assert.deepEqual(matchedRegisterRoles({
    existingWattwatchersDeviceId: 'device-1',
    newWattwatchersDeviceId: 'device-2',
    currentWattwatchersDeviceId: 'device-2',
  }, 'device-2'), ['new', 'current']);
});
