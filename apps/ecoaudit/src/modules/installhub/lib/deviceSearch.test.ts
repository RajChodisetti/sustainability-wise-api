import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoard,
  createInstallationTree,
  createZone,
} from '@/modules/installhub/lib/model';
import {
  createReplacementForm,
  createDeviceCommissioningForm,
  deviceSearchRecords,
  filterDeviceSearchRecords,
} from '@/modules/installhub/lib/deviceSearch';
import { suggestedDeviceDisplayName } from '@/modules/installhub/lib/meterPresentation';
import type { InstallHubUser } from '@/modules/installhub/types/domain';

const user: InstallHubUser = {
  id: 'user-1',
  email: 'inspector@example.com',
  fullName: 'Field Inspector',
  role: 'inspector',
};

function fixture() {
  const tree = createInstallationTree({
    siteName: 'Inchcape Essendon',
    clientName: 'Inchcape',
    siteAddress: '1 Workshop Way',
    auditDate: '2026-08-05',
    inspectorName: user.fullName || 'Field Inspector',
  }, user);
  const zone = createZone(tree.installation.id, {
    zoneName: 'Basement plant room',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.assetName = 'Main switchboard';
  board.meters.push({
    id: 'meter-1',
    deviceName: 'Legacy machine code',
    deviceNameOverridden: false,
    deviceType: 'A3RM',
    deviceId: 'SERIAL-42',
    deviceNumber: 'COMPAT-42',
    wwChannels: [],
  });
  board.meterPresent = true;
  tree.zones.push(zone);
  tree.electricalAssets.push(board);
  tree.meterDevices = undefined;
  return { tree, zone, board };
}

test('device search covers human site, zone, board, type, serial and compatibility identity', () => {
  const { tree } = fixture();
  const records = deviceSearchRecords([tree]);

  assert.equal(records[0].deviceName, 'Wattwatchers A3RM');
  for (const query of [
    'SERIAL-42',
    'COMPAT-42',
    'Inchcape',
    'Basement',
    'Main switchboard',
    'distribution board',
    'A3RM',
  ]) {
    assert.equal(filterDeviceSearchRecords(records, query).length, 1, query);
  }
});

test('replace creates a preselected comms form with stable device context', () => {
  const { tree, zone, board } = fixture();
  const record = deviceSearchRecords([tree])[0];
  const form = createReplacementForm(tree, user, record);

  assert.equal(form.formType, 'comms-fault');
  assert.equal(form.zoneId, zone.id);
  assert.equal(form.boardId, board.id);
  assert.equal(form.meterId, 'meter-1');
  assert.equal(form.answers['works.replace_device'], 'yes');
  assert.equal(form.answers['existing.device_id'], 'SERIAL-42');
  assert.equal(form.answers['existing.device_number'], 'COMPAT-42');
  assert.equal(tree.formSubmissions.at(-1)?.id, form.id);
});

test('replacement rejects device families unsupported by the comms-fault contract', () => {
  const { tree, board, zone } = fixture();
  board.meters[0] = {
    ...board.meters[0],
    deviceFamily: 'OTHER',
    deviceType: 'Other',
    customManufacturerName: 'Example',
    customModelName: 'A3RM',
  };
  assert.equal(deviceSearchRecords([tree])[0].supportsCommsReplacement, false);

  assert.throws(
    () => createReplacementForm(tree, user, {
      zoneId: zone.id,
      boardId: board.id,
      meterId: board.meters[0].id,
    }),
    /supports A3RM and A6M devices only/,
  );
  assert.equal(tree.formSubmissions.length, 0);
});

test('replacement rejects stale device-to-switchboard context', () => {
  const { tree, board, zone } = fixture();
  assert.throws(
    () => createReplacementForm(tree, user, {
      zoneId: zone.id,
      boardId: 'different-board',
      meterId: board.meters[0].id,
    }),
    /not installed on this switchboard/,
  );
  assert.throws(
    () => createReplacementForm(tree, user, {
      zoneId: 'different-zone',
      boardId: board.id,
      meterId: board.meters[0].id,
    }),
    /not installed on this switchboard/,
  );
  assert.equal(tree.formSubmissions.length, 0);
});

test('installation-scoped device search includes every zone but excludes other installations', () => {
  const { tree, board } = fixture();
  const secondZone = createZone(tree.installation.id, {
    zoneName: 'Roof plant',
    zoneDescription: '',
  });
  const secondBoard = createBoard(tree.installation.id, secondZone.id);
  secondBoard.assetName = 'Roof distribution board';
  secondBoard.meters.push({
    ...structuredClone(board.meters[0]),
    id: 'meter-2',
    deviceId: 'SERIAL-ROOF',
    deviceNumber: 'SERIAL-ROOF',
  });
  secondBoard.meterPresent = true;
  tree.zones.push(secondZone);
  tree.electricalAssets.push(secondBoard);

  const other = fixture().tree;
  other.installation.siteName = 'Other installation';
  const records = deviceSearchRecords([tree, other]);
  const scoped = filterDeviceSearchRecords(records, '', tree.installation.id);

  assert.equal(scoped.length, 2);
  assert.deepEqual(new Set(scoped.map((record) => record.zoneName)), new Set([
    'Basement plant room',
    'Roof plant',
  ]));
  assert.ok(scoped.every((record) => record.installationId === tree.installation.id));
});

test('device quick-add starts the detailed WW installation form on the selected board', () => {
  const { tree, zone, board } = fixture();
  const form = createDeviceCommissioningForm(tree, user, {
    zoneId: zone.id,
    boardId: board.id,
  });

  assert.equal(form.formType, 'ww-installation');
  assert.equal(form.zoneId, zone.id);
  assert.equal(form.boardId, board.id);
  assert.equal(form.answers['auditor.switchboard_name'], board.assetName);
});

test('suggested device names use human site, zone and device labels without exceeding the contract', () => {
  assert.equal(
    suggestedDeviceDisplayName({
      siteName: 'Inchcape Essendon',
      zoneName: 'Basement',
      deviceModel: 'A3RM',
      serialNumber: 'SERIAL-42',
    }),
    'Inchcape Essendon · Basement · A3RM · SERIAL-42',
  );
  assert.ok(suggestedDeviceDisplayName({
    siteName: 'A very long human-readable installation name for the northern campus',
    zoneName: 'Main electrical services room',
    deviceModel: 'A6M',
    serialNumber: 'SERIAL-9000',
  }).length <= 64);
});
