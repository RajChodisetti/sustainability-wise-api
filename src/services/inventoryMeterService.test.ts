import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  inventoryClaimDecision,
  NON_INSTALLED_INVENTORY_STATUSES,
  parseInventoryMeterRegistration,
  toNonInstalledInventoryMeterItem,
} from './inventoryMeterService.js';

test('active inventory excludes installed meter history', () => {
  assert.deepEqual(NON_INSTALLED_INVENTORY_STATUSES, ['company', 'user']);
  assert.equal(NON_INSTALLED_INVENTORY_STATUSES.includes('installed' as never), false);
});

test('inventory registration accepts and normalizes meter-only company stock details', () => {
  assert.deepEqual(parseInventoryMeterRegistration({
    deviceId: '  meter-ab12  ',
    deviceModel: 'A6M',
    customManufacturerName: '',
    customModelName: null,
    notes: '  Box 4  ',
  }), {
    deviceId: 'METER-AB12',
    deviceModel: 'A6M',
    customManufacturerName: null,
    customModelName: null,
    notes: 'Box 4',
  });

  assert.deepEqual(parseInventoryMeterRegistration({
    deviceId: 'other-1',
    deviceModel: 'OTHER',
    customManufacturerName: ' Acme ',
    customModelName: ' M-100 ',
  }), {
    deviceId: 'OTHER-1',
    deviceModel: 'OTHER',
    customManufacturerName: 'Acme',
    customModelName: 'M-100',
    notes: null,
  });
});

test('inventory registration rejects job, site, installation, and custody fields', () => {
  for (const field of [
    'jobId',
    'siteId',
    'installationId',
    'scheduledStartAt',
    'custodianUserId',
    'status',
  ]) {
    assert.throws(
      () => parseInventoryMeterRegistration({
        deviceId: 'METER-1',
        deviceModel: 'A3RM',
        [field]: 'not-meter-stock',
      }),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === 'Only meter details can be saved in inventory',
      field,
    );
  }
});

test('OTHER inventory meters require a custom manufacturer and model', () => {
  for (const input of [
    { deviceId: 'OTHER-1', deviceModel: 'OTHER' },
    {
      deviceId: 'OTHER-1',
      deviceModel: 'OTHER',
      customManufacturerName: 'Acme',
    },
    {
      deviceId: 'OTHER-1',
      deviceModel: 'OTHER',
      customModelName: 'M-100',
    },
  ]) {
    assert.throws(
      () => parseInventoryMeterRegistration(input),
      (error) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === 'OTHER meters require customManufacturerName and customModelName',
    );
  }
});

test('Field inventory claims transfer company stock and are idempotent only for the same user', () => {
  assert.equal(inventoryClaimDecision({ status: 'company', custodianUserId: null }, 'user-1'), 'transfer');
  assert.equal(inventoryClaimDecision({ status: 'user', custodianUserId: 'user-1' }, 'user-1'), 'already-held');

  for (const [state, detail] of [
    [null, 'This meter is not registered in company stock'],
    [{ status: 'installed', custodianUserId: null }, 'This meter is already installed'],
    [{ status: 'user', custodianUserId: 'user-2' }, 'This meter is assigned to another user'],
  ] as const) {
    assert.throws(
      () => inventoryClaimDecision(state, 'user-1'),
      (error) => error instanceof AppError && error.statusCode === 409 && error.detail === detail,
    );
  }
});

test('non-installed inventory DTO exposes the current holder without job or site data', () => {
  const item = toNonInstalledInventoryMeterItem({
    meter: {
      id: 'inventory-1',
      deviceId: 'METER-1',
      deviceModel: 'A3RM',
      customManufacturerName: null,
      customModelName: null,
      status: 'user',
      custodianUserId: 'field-user-1',
      installedInstallationId: null,
      installedMeterId: null,
      businessClientId: null,
      businessSiteId: null,
      businessJobId: null,
      notes: 'Van 2',
      revision: 3,
      createdByUserId: 'admin-1',
      updatedByUserId: 'admin-1',
      createdAt: new Date('2026-08-20T01:00:00.000Z'),
      updatedAt: new Date('2026-08-21T02:00:00.000Z'),
      deletedAt: null,
    },
    custodianName: '  Field User  ',
    custodianEmail: 'field@example.test',
  });

  assert.deepEqual(item, {
    inventoryMeterId: 'inventory-1',
    deviceId: 'METER-1',
    deviceModel: 'A3RM',
    customManufacturerName: null,
    customModelName: null,
    notes: 'Van 2',
    status: 'user',
    custodianUserId: 'field-user-1',
    custodianName: 'Field User',
    custodianEmail: 'field@example.test',
    revision: 3,
    createdAt: '2026-08-20T01:00:00.000Z',
    updatedAt: '2026-08-21T02:00:00.000Z',
  });
  assert.equal(Object.hasOwn(item, 'installationId'), false);
  assert.equal(Object.hasOwn(item, 'jobId'), false);
  assert.equal(Object.hasOwn(item, 'siteId'), false);
});
