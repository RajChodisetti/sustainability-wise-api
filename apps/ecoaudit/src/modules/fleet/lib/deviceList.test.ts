import assert from 'node:assert/strict';
import test from 'node:test';
import { groupFleetDevices } from './deviceList';
import type { DeviceObservation } from '@/modules/fleet/types/domain';

function device(
  deviceId: string,
  clientId?: string,
  clientName?: string,
  siteId?: string,
  siteName?: string,
): DeviceObservation {
  return {
    deviceId,
    status: 'communicating',
    currentPlacement: clientId && clientName ? {
      source: 'meter_register',
      effectiveDate: null,
      businessClient: { id: clientId, name: clientName },
      site: siteId && siteName ? { id: siteId, name: siteName, address: '1 Test St' } : null,
    } : null,
  };
}

test('coalesces non-contiguous client rows while retaining first-seen order and unlinked devices', () => {
  const groups = groupFleetDevices([
    device('one', 'client-a', 'Alpha'),
    device('two', 'client-b', 'Beta'),
    device('three', 'client-a', 'Alpha'),
    device('four'),
  ], 'client');
  assert.deepEqual(groups.map((group) => [
    group.label,
    group.devices.map((item) => item.deviceId),
  ]), [
    ['Alpha', ['one', 'three']],
    ['Beta', ['two']],
    ['Client not linked', ['four']],
  ]);
  assert.equal(new Set(groups.map((group) => group.key)).size, groups.length);
});

test('coalesces non-contiguous site rows and includes the client in repeated site names', () => {
  const groups = groupFleetDevices([
    device('one', 'client-a', 'Alpha', 'site-a', 'Head Office'),
    device('two', 'client-b', 'Beta', 'site-b', 'Head Office'),
    device('three', 'client-a', 'Alpha', 'site-a', 'Head Office'),
  ], 'site');
  assert.deepEqual(groups.map((group) => [
    group.label,
    group.devices.map((item) => item.deviceId),
  ]), [
    ['Head Office · Alpha', ['one', 'three']],
    ['Head Office · Beta', ['two']],
  ]);
  assert.equal(new Set(groups.map((group) => group.key)).size, groups.length);
});
