import assert from 'node:assert/strict';
import test from 'node:test';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import {
  applyDraftFormSnapshot,
  canonicalSiteCode,
  canonicalSiteCodeForWrite,
  createAmendment,
  createBoard,
  createFormSubmission,
  createInstallationTree,
  createSiteAsset,
  createZone,
  removeZone,
  syncOperationalMeter,
} from './model';
import type { InstallHubUser } from '../types/domain';

const user: InstallHubUser = {
  id: 'user-1',
  email: 'installer@example.com',
  fullName: 'Installer One',
  role: 'admin',
};

test('site-code rule matches the canonical eight-initial cross-client fixtures', () => {
  assert.deepEqual([
    canonicalSiteCode('Warehouse'),
    canonicalSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf'),
    canonicalSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'),
    canonicalSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India'),
  ], ['W', 'ABCDEFG', 'ABCDEFGH', 'ABCDEFGH']);
  assert.equal(canonicalSiteCode('Warehouse', 'syd-wh1'), 'SYD-WH1');
  for (const invalid of ['BAD SITE', 'BAD!', '-BAD', 'BAD-', 'BAD--SITE', 'ABCDEFGHIJKLMNOPQ']) {
    assert.throws(() => canonicalSiteCode('Warehouse', invalid), /Site code must be/);
  }
});

test('site-code editing preserves only the unchanged authoritative historical value', () => {
  const historical = ' Legacy Site Code / 2024 ';
  assert.equal(
    canonicalSiteCodeForWrite('Warehouse', historical, historical),
    historical,
  );
  assert.equal(
    canonicalSiteCodeForWrite('Warehouse', 'syd-wh1', historical),
    'SYD-WH1',
  );
  assert.throws(
    () => canonicalSiteCodeForWrite('Warehouse', 'Different Legacy Code', historical),
    /Site code must be/,
  );
});

function fixtureTree() {
  return createInstallationTree(
    {
      clientName: 'Client',
      siteName: 'Site',
      siteAddress: '1 Test Street',
      inspectorName: 'Installer One',
      auditDate: '2026-07-23',
    },
    user,
  );
}

test('removeZone cascades owned records and marks surviving relationships TBC', () => {
  const tree = fixtureTree();
  const removedZone = createZone(tree.installation.id, {
    zoneName: 'Removed',
    zoneDescription: '',
  });
  const survivingZone = createZone(tree.installation.id, {
    zoneName: 'Surviving',
    zoneDescription: '',
  });
  const removedBoard = createBoard(tree.installation.id, removedZone.id);
  removedBoard.assetName = 'Main board';
  removedBoard.meters = [
    {
      id: 'removed-meter',
      deviceName: 'A3RM Auditor',
      deviceType: 'A3RM',
      deviceId: 'meter-serial',
    },
  ];
  const survivingBoard = createBoard(tree.installation.id, survivingZone.id);
  survivingBoard.electricalParentId = removedBoard.id;
  survivingBoard.electricalParentTbc = false;
  const survivingAsset = createSiteAsset(
    tree.installation.id,
    survivingZone.id,
  );
  survivingAsset.electricalBoardId = removedBoard.id;
  survivingAsset.electricalBoardTbc = false;
  survivingAsset.meterPresent = true;
  survivingAsset.meterSwitchboardId = removedBoard.id;
  survivingAsset.meterSwitchboardTbc = false;
  const removedMeterForm = createFormSubmission(
    tree,
    'comms-fault',
    user,
    { meterId: 'removed-meter' },
  );
  const survivingForm = createFormSubmission(
    tree,
    'captis-logger',
    user,
    { zoneId: survivingZone.id, siteAssetId: survivingAsset.id },
  );

  tree.zones = [removedZone, survivingZone];
  tree.electricalAssets = [removedBoard, survivingBoard];
  tree.siteAssets = [survivingAsset];
  tree.formSubmissions = [removedMeterForm, survivingForm];

  removeZone(tree, removedZone.id);

  assert.deepEqual(tree.zones.map((zone) => zone.id), [survivingZone.id]);
  assert.deepEqual(tree.electricalAssets.map((board) => board.id), [
    survivingBoard.id,
  ]);
  assert.equal(tree.electricalAssets[0].electricalParentId, null);
  assert.equal(tree.electricalAssets[0].electricalParentTbc, true);
  assert.equal(tree.siteAssets[0].electricalBoardId, null);
  assert.equal(tree.siteAssets[0].electricalBoardTbc, true);
  assert.equal(tree.siteAssets[0].meterSwitchboardId, null);
  assert.equal(tree.siteAssets[0].meterSwitchboardTbc, true);
  assert.deepEqual(tree.formSubmissions.map((form) => form.id), [
    survivingForm.id,
  ]);
});

test('new forms send only answer keys supported by their selected schema', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Plant',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.assetName = 'MSB';
  board.assetType = 'MSB';
  board.siteNmi = 'NMI-123';
  tree.zones.push(zone);
  tree.electricalAssets.push(board);

  const form = createFormSubmission(tree, 'ace-switchboard', user, {
    zoneId: zone.id,
    boardId: board.id,
  });
  const supported = new Set(
    FORM_DEFINITION_BY_TYPE['ace-switchboard'].sections.flatMap((section) =>
      section.fields
        .filter((field) => field.kind !== 'photo')
        .map((field) => field.key),
    ),
  );

  assert.ok(Object.keys(form.answers).length > 0);
  assert.ok(Object.keys(form.answers).every((key) => supported.has(key)));
  assert.equal('auditor.switchboard_name' in form.answers, false);
});

test('amendments preserve evidence references without sharing mutable arrays', () => {
  const tree = fixtureTree();
  const original = createFormSubmission(tree, 'captis-logger', user);
  original.status = 'Completed';
  original.completedAt = '2026-07-23T10:00:00.000Z';
  original.attachments = [
    {
      id: 'attachment-1',
      slot: 'captis.photo_installed',
      uri: '/v1/photos/attachment-1',
      mimeType: 'image/jpeg',
      caption: 'Installed logger',
      capturedAt: '2026-07-23T09:00:00.000Z',
    },
  ];

  const amendment = createAmendment(original);

  assert.notEqual(amendment.id, original.id);
  assert.equal(amendment.status, 'Draft');
  assert.equal(amendment.completedAt, null);
  assert.equal(amendment.supersedesId, original.id);
  assert.deepEqual(amendment.attachments, original.attachments);
  assert.notEqual(amendment.attachments, original.attachments);
  assert.notEqual(amendment.attachments[0], original.attachments[0]);
});

test('navigation flush saves the latest draft answers and captions as detached snapshots', () => {
  const tree = fixtureTree();
  const form = createFormSubmission(tree, 'honeywell-q400', user);
  tree.formSubmissions.push(form);
  const answers = {
    ...form.answers,
    'water.serial_number': 'Q400-9042',
  };
  const attachments = [
    {
      id: 'attachment-navigation',
      slot: 'water.lcd_photo',
      uri: '/v1/files/installhub/navigation/photo.jpg',
      mimeType: 'image/jpeg',
      caption: 'LCD after commissioning',
      capturedAt: '2026-07-26T12:00:00.000Z',
    },
  ];

  const saved = applyDraftFormSnapshot(
    tree,
    form.id,
    answers,
    attachments,
    '2026-07-26T12:01:00.000Z',
  );
  answers['water.serial_number'] = 'changed-after-save';
  attachments[0].caption = 'changed-after-save';

  assert.equal(saved?.answers['water.serial_number'], 'Q400-9042');
  assert.equal(saved?.attachments[0]?.caption, 'LCD after commissioning');
  assert.equal(saved?.updatedAt, '2026-07-26T12:01:00.000Z');

  saved!.status = 'Completed';
  assert.equal(
    applyDraftFormSnapshot(
      tree,
      form.id,
      { 'water.serial_number': 'must-not-overwrite' },
      [],
    ),
    null,
  );
  assert.equal(saved?.answers['water.serial_number'], 'Q400-9042');
});

test('completed Wattwatcher forms update the operational meter registry', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Electrical',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  tree.zones.push(zone);
  tree.electricalAssets.push(board);
  const form = createFormSubmission(tree, 'ww-installation', user, {
    zoneId: zone.id,
    boardId: board.id,
  });
  form.status = 'Completed';
  form.answers['device.type'] = 'A3RM';
  form.answers['device.id'] = 'A3RM-001';
  form.answers['device.number'] = '7';
  form.answers['channel.1.load'] = 'Mains Supply';
  form.answers['channel.1.description'] = 'Incoming mains';
  form.answers['channel.1.rating'] = '3000A - 9cm';

  syncOperationalMeter(tree, form);

  assert.equal(board.meterPresent, true);
  assert.equal(board.meters.length, 1);
  assert.equal(board.meters[0].deviceType, 'A3RM');
  assert.equal(board.meters[0].deviceId, 'A3RM-001');
  assert.equal(board.meters[0].wwChannels?.length, 3);
  assert.equal(board.meters[0].wwChannels?.[0].description, 'Incoming mains');
  assert.equal(form.meterId, board.meters[0].id);
});
