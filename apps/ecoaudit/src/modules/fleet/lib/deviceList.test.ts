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

test('groups contiguous device rows by client while retaining unlinked devices', () => {
  const groups = groupFleetDevices([
    device('one', 'client-a', 'Alpha'),
    device('two', 'client-a', 'Alpha'),
    device('three'),
  ], 'client');
  assert.deepEqual(groups.map((group) => [group.label, group.devices.length]), [
    ['Alpha', 2],
    ['Client not linked', 1],
  ]);
});

test('site group labels include the client to disambiguate repeated site names', () => {
  const groups = groupFleetDevices([
    device('one', 'client-a', 'Alpha', 'site-a', 'Head Office'),
    device('two', 'client-b', 'Beta', 'site-b', 'Head Office'),
  ], 'site');
  assert.deepEqual(groups.map((group) => group.label), [
    'Head Office · Alpha',
    'Head Office · Beta',
  ]);
});
