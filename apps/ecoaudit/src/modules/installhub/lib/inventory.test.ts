import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installHubInventoryModelLabel,
  normalizeInventoryDeviceId,
} from './inventory';
import type { InstallHubInventoryMeter } from '../types/inventory';

function meter(
  patch: Partial<InstallHubInventoryMeter> = {},
): InstallHubInventoryMeter {
  return {
    id: 'meter-1',
    deviceId: 'ABC-123',
    deviceModel: 'A3RM',
    customManufacturerName: null,
    customModelName: null,
    status: 'user',
    custodianUserId: 'user-1',
    custodianName: 'Alex Field',
    installedInstallationId: null,
    installedMeterId: null,
    businessClientId: null,
    businessSiteId: null,
    businessJobId: null,
    notes: null,
    revision: 1,
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    deletedAt: null,
    ...patch,
  };
}

test('inventory Device IDs are normalized before a custody claim', () => {
  assert.equal(normalizeInventoryDeviceId('  abc-123  '), 'ABC-123');
});

test('custom inventory models keep their manufacturer and model label', () => {
  assert.equal(installHubInventoryModelLabel(meter({
    deviceId: 'OTHER-9',
    deviceModel: 'OTHER',
    customManufacturerName: 'Acme',
    customModelName: 'Pulse 9',
    custodianName: null,
  })), 'Other · Acme Pulse 9');
});
