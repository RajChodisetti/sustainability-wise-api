import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const details = readFileSync(
  new URL('../components/DeviceMeterRegisterDetails.tsx', import.meta.url),
  'utf8',
);
const detailPage = readFileSync(new URL('../pages/DeviceDetailPage.tsx', import.meta.url), 'utf8');
const devicesPage = readFileSync(new URL('../pages/DevicesPage.tsx', import.meta.url), 'utf8');
const fleetApi = readFileSync(new URL('../api/fleet.ts', import.meta.url), 'utf8');

test('selected Fleet devices expose organized mapped fields and exact Excel evidence', () => {
  assert.match(detailPage, /DeviceMeterRegisterDetails/);
  for (const section of [
    'Client, customer and site',
    'Device identifiers and source',
    'Work and meter details',
    'MaaS and data',
    'Invoice values',
    'Recurring invoice schedule',
    'Raw Excel columns',
  ]) {
    assert.match(details, new RegExp(section));
  }
  assert.match(details, /Edit all mapped fields/);
  assert.match(details, /isAdmin[\s\S]*Invoice values/);
});

test('device list sends the Excel filter and grouping choice to the backend', () => {
  assert.match(devicesPage, /Excel devices only/);
  assert.match(devicesPage, /Group devices by/);
  assert.match(devicesPage, /meterRegister,[\s\S]*groupBy,/);
  assert.match(fleetApi, /meterRegister\?: '' \| 'true' \| 'false'/);
  assert.match(fleetApi, /groupBy\?: '' \| 'client' \| 'site'/);
});
