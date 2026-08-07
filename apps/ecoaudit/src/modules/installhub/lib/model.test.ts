import assert from 'node:assert/strict';
import test from 'node:test';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import {
  allowedFormDefinitions,
  applyDraftFormSnapshot,
  canonicalSiteCode,
  canonicalSiteCodeForWrite,
  createAmendment,
  createBoard,
  createFormSubmission,
  createInstallationTree,
  createSiteAsset,
  createZone,
  deleteDraftForm,
  normalizeOptionalFormContext,
  removeZone,
  syncOperationalMeter,
} from './model';
import { syncMeterDevice } from './workflow';
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

test('new switchboards do not create a switchboard-level phase value', () => {
  const board = createBoard('installation-1', 'zone-1');
  assert.equal(board.phase, null);
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

test('draft forms can be deleted while completed and referenced records remain immutable', () => {
  const tree = fixtureTree();
  const removable = createFormSubmission(tree, 'captis-logger', user);
  removable.attachments.push({
    id: 'attachment-1',
    slot: 'site.photo',
    uri: 'https://example.test/evidence.jpg',
    mimeType: 'image/jpeg',
    capturedAt: '2026-08-05T00:00:00.000Z',
  });
  tree.formSubmissions.push(removable);

  assert.equal(deleteDraftForm(tree, removable.id).id, removable.id);
  assert.equal(tree.formSubmissions.some((form) => form.id === removable.id), false);

  const completed = createFormSubmission(tree, 'captis-logger', user);
  completed.status = 'Completed';
  tree.formSubmissions.push(completed);
  assert.throws(() => deleteDraftForm(tree, completed.id), /immutable/);

  const referenced = createFormSubmission(tree, 'captis-logger', user);
  const amendment = createAmendment(referenced);
  tree.formSubmissions.push(referenced, amendment);
  assert.throws(() => deleteDraftForm(tree, referenced.id), /later amendment/);
});

test('meter-linked reconciliation keeps the WW installation form available', () => {
  assert.deepEqual(
    allowedFormDefinitions({ boardId: 'board-1', meterId: 'meter-1' })
      .map((definition) => definition.type),
    ['ww-installation', 'comms-fault'],
  );
  assert.deepEqual(
    allowedFormDefinitions({ meterId: 'meter-1' })
      .map((definition) => definition.type),
    ['comms-fault'],
  );
  assert.equal(
    allowedFormDefinitions({})
      .some((definition) => definition.type === 'comms-fault'),
    false,
  );
});

test('stale optional form context is cleared instead of blocking completion', () => {
  const tree = fixtureTree();
  const contextFree = createFormSubmission(tree, 'ww-installation', user);
  normalizeOptionalFormContext(tree, contextFree);
  assert.equal(contextFree.boardId, null);
  assert.equal(contextFree.zoneId, null);

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

  form.meterId = 'missing-meter';
  normalizeOptionalFormContext(tree, form);
  assert.equal(form.boardId, board.id);
  assert.equal(form.meterId, null);

  form.zoneId = 'missing-zone';
  form.boardId = 'missing-board';
  form.siteAssetId = 'missing-asset';
  normalizeOptionalFormContext(tree, form);
  assert.equal(form.zoneId, null);
  assert.equal(form.boardId, null);
  assert.equal(form.siteAssetId, null);
});

test('meter-linked WW completion preserves stable channel IDs and assignments', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Electrical',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.meters = [{
    id: 'meter-stable',
    deviceFamily: 'WATTWATCHERS',
    deviceName: 'A3RM Auditor',
    deviceType: 'A3RM',
    deviceId: 'SERIAL-STABLE',
    deviceNumber: '42',
    wwChannels: [
      { id: 'channel-red', ordinal: 1, purpose: 'MAIN_SUPPLY', loadType: 'Mains Supply', rogowskiSize: '3000A - 9cm' },
      { id: 'channel-white', ordinal: 2, purpose: 'SPARE' },
      { id: 'channel-blue', ordinal: 3, purpose: 'SPARE' },
    ],
  }];
  tree.zones.push(zone);
  tree.electricalAssets.push(board);
  syncMeterDevice(tree, board.id, board.meters[0]);
  tree.measurementAssignments = [{
    id: 'assignment-stable',
    installationId: tree.installation.id,
    meterId: 'meter-stable',
    channelIds: ['channel-red'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: board.id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  const form = createFormSubmission(tree, 'ww-installation', user, {
    zoneId: zone.id,
    boardId: board.id,
    meterId: 'meter-stable',
  });
  form.status = 'Completed';

  syncOperationalMeter(tree, form);
  syncMeterDevice(tree, board.id, board.meters[0]);

  assert.deepEqual(
    board.meters[0].wwChannels?.map((channel) => channel.id),
    ['channel-red', 'channel-white', 'channel-blue'],
  );
  assert.deepEqual(tree.measurementAssignments.map((item) => item.id), ['assignment-stable']);
});

test('meter-linked WW completion converts every prestart yes/no answer to a canonical boolean', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Electrical',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.meters = [{
    id: 'meter-prestart',
    deviceFamily: 'WATTWATCHERS',
    deviceName: 'A3RM Auditor',
    deviceType: 'A3RM',
    deviceId: 'SERIAL-PRESTART',
    wwPrestart: {
      siteInduction: true,
      safeAccess: true,
      correctPpe: true,
      livePointsAware: true,
      canIsolate: true,
      safeToProceed: true,
    },
    wwChannels: [
      { id: 'meter-prestart:1', ordinal: 1, purpose: 'MAIN_SUPPLY', loadType: 'Mains Supply', rogowskiSize: '3000A - 9cm' },
      { id: 'meter-prestart:2', ordinal: 2, purpose: 'SUB_CIRCUIT', loadType: 'HVAC', rogowskiSize: '3000A - 20cm' },
      { id: 'meter-prestart:3', ordinal: 3, purpose: 'SPARE' },
    ],
  }];
  tree.zones.push(zone);
  tree.electricalAssets.push(board);
  syncMeterDevice(tree, board.id, board.meters[0]);
  const form = createFormSubmission(tree, 'ww-installation', user, {
    zoneId: zone.id,
    boardId: board.id,
    meterId: 'meter-prestart',
  });
  Object.assign(form.answers, {
    'prestart.site_induction': 'yes',
    'prestart.safe_access': 'yes',
    'prestart.correct_ppe': 'no',
    'prestart.live_points': 'yes',
    'prestart.can_isolate': 'no',
    'prestart.additional_hazards': 'no',
    'prestart.safe_to_proceed': 'yes',
  });
  form.status = 'Completed';

  syncOperationalMeter(tree, form);
  const canonical = syncMeterDevice(tree, board.id, board.meters[0]);
  const expected = {
    siteInduction: true,
    safeAccess: true,
    correctPpe: false,
    livePointsAware: true,
    canIsolate: false,
    additionalHazards: false,
    safeToProceed: true,
  };

  assert.deepEqual(board.meters[0].wwPrestart, expected);
  assert.deepEqual(canonical.commissioningData?.prestart, expected);
  assert.ok(Object.values(canonical.commissioningData?.prestart ?? {})
    .every((value) => typeof value === 'boolean'));
});

test('meter-linked WW forms prefill canonical device and channel context', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Electrical',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.meters = [{
    id: 'meter-1',
    deviceFamily: 'WATTWATCHERS',
    deviceName: 'A3RM Auditor',
    deviceType: 'A3RM',
    deviceId: 'A3RM-001',
    deviceNumber: '7',
    wwChannels: [
      {
        id: 'meter-1:2',
        ordinal: 2,
        purpose: 'SUB_CIRCUIT',
        loadType: 'OTHER',
        customLoadTypeName: 'Refrigeration',
        rogowskiSize: '3000A - 9cm',
        description: 'Mechanical room circuit',
      },
      {
        id: 'meter-1:1',
        ordinal: 1,
        purpose: 'MAIN_SUPPLY',
        loadType: 'Mains Supply',
        rogowskiSize: '3000A - 9cm',
        description: 'Incoming red phase',
      },
      {
        id: 'meter-1:3',
        ordinal: 3,
        purpose: 'SPARE',
        loadType: 'Not Used',
        rogowskiSize: '3000A - 20cm',
        description: 'Stale spare metadata',
      },
    ],
  }];
  tree.zones.push(zone);
  tree.electricalAssets.push(board);

  const form = createFormSubmission(tree, 'ww-installation', user, {
    zoneId: zone.id,
    boardId: board.id,
    meterId: 'meter-1',
  });

  assert.equal(form.answers['device.type'], 'A3RM');
  assert.equal(form.answers['device.name'], 'A3RM Meter');
  assert.equal(form.answers['device.id'], 'A3RM-001');
  assert.equal(form.answers['device.number'], '7');
  assert.equal(form.answers['channel.1.purpose'], 'Main board supply');
  assert.equal(form.answers['channel.1.load'], 'Mains Supply');
  assert.equal(form.answers['channel.1.rating'], '3000A - 9cm');
  assert.equal(form.answers['channel.1.description'], 'Incoming red phase');
  assert.equal(form.answers['channel.2.purpose'], 'Sub-circuit / asset');
  assert.equal(form.answers['channel.2.load'], 'Other');
  assert.equal(form.answers['channel.2.custom_load_type'], 'Refrigeration');
  assert.equal(form.answers['channel.2.description'], 'Mechanical room circuit');
  assert.equal(form.answers['channel.3.purpose'], 'Spare / unused');
  assert.equal(form.answers['channel.3.load'], undefined);
  assert.equal(form.answers['channel.3.rating'], undefined);
  assert.equal(form.answers['channel.3.description'], undefined);
  assert.equal(form.answers['existing.device_id'], undefined);
});

test('WW forms project first-class cold-service load types through editable Other labels', () => {
  const tree = fixtureTree();
  const zone = createZone(tree.installation.id, {
    zoneName: 'Cold services',
    zoneDescription: '',
  });
  const board = createBoard(tree.installation.id, zone.id);
  board.meters = [{
    id: 'meter-cold-services',
    deviceFamily: 'WATTWATCHERS',
    deviceName: 'A3RM Meter',
    deviceType: 'A3RM',
    deviceId: 'A3RM-COLD-001',
    wwChannels: [
      {
        id: 'meter-cold-services:2',
        ordinal: 2,
        purpose: 'SUB_CIRCUIT',
        loadType: 'REFRIGERATION',
      },
      {
        id: 'meter-cold-services:3',
        ordinal: 3,
        purpose: 'SUB_CIRCUIT',
        loadType: 'COMPRESSED_AIR',
      },
    ],
  }];
  tree.zones.push(zone);
  tree.electricalAssets.push(board);

  const form = createFormSubmission(tree, 'ww-installation', user, {
    zoneId: zone.id,
    boardId: board.id,
    meterId: 'meter-cold-services',
  });

  assert.equal(form.answers['channel.2.load'], 'Other');
  assert.equal(form.answers['channel.2.custom_load_type'], 'Refrigeration');
  assert.equal(form.answers['channel.3.load'], 'Other');
  assert.equal(form.answers['channel.3.custom_load_type'], 'Compressed Air');
});

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
      slot: 'logger.cumulocity_screenshot',
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

test('amendments remove unsupported contract values without mutating the completed source', () => {
  const tree = fixtureTree();
  const original = createFormSubmission(tree, 'captis-logger', user);
  original.status = 'Completed';
  original.answers = {
    ...original.answers,
    'captis.physical_location': 'Plant room',
    'obsolete.answer': 'legacy-only',
  };
  original.attachments = [
    {
      id: 'attachment-visible',
      slot: 'logger.cumulocity_screenshot',
      uri: '/v1/photos/visible',
      mimeType: 'image/jpeg',
      capturedAt: '2026-08-06T00:00:00.000Z',
    },
    {
      id: 'attachment-obsolete',
      slot: 'obsolete.photo',
      uri: '/v1/photos/obsolete',
      mimeType: 'image/jpeg',
      capturedAt: '2026-08-06T00:00:00.000Z',
    },
  ];

  const amendment = createAmendment(original);

  assert.equal(amendment.answers['obsolete.answer'], undefined);
  assert.deepEqual(amendment.attachments.map((item) => item.id), ['attachment-visible']);
  assert.equal(original.answers['obsolete.answer'], 'legacy-only');
  assert.deepEqual(original.attachments.map((item) => item.id), [
    'attachment-visible',
    'attachment-obsolete',
  ]);
});

test('amendments clear supported answers that are hidden by the retained controlling answer', () => {
  const tree = fixtureTree();
  const original = createFormSubmission(tree, 'a3rm-installation', user);
  original.status = 'Completed';
  original.answers = {
    ...original.answers,
    'channel.1.rating': 'Not Used',
    'commissioning.channel_1_current': '12.5',
  };

  const amendment = createAmendment(original);

  assert.equal(amendment.answers['commissioning.channel_1_current'], undefined);
  assert.equal(original.answers['commissioning.channel_1_current'], '12.5');
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
  form.answers['auditor.switchboard_name'] = 'Main distribution board';
  form.answers['auditor.switchboard_location'] = 'Electrical room';
  form.answers['commissioning.signal_strength'] = 'High';
  form.answers['commissioning.antenna_type'] = 'Internal';
  form.answers['channel.1.load'] = 'Mains Supply';
  form.answers['channel.1.purpose'] = 'Main board supply';
  form.answers['channel.1.description'] = 'Incoming mains';
  form.answers['channel.1.rating'] = '3000A - 9cm';
  form.answers['channel.2.purpose'] = 'Sub-circuit / asset';
  form.answers['channel.2.load'] = 'Other';
  form.answers['channel.2.custom_load_type'] = 'Refrigeration';
  form.answers['channel.2.description'] = 'Cool-room circuit';
  form.answers['channel.2.rating'] = '3000A - 9cm';
  form.answers['channel.3.purpose'] = 'Spare / unused';

  syncOperationalMeter(tree, form);

  assert.equal(board.meterPresent, true);
  assert.equal(board.meters.length, 1);
  assert.equal(board.meters[0].deviceType, 'A3RM');
  assert.equal(board.meters[0].deviceId, 'A3RM-001');
  assert.equal(board.meters[0].deviceNumber, '7');
  assert.equal(board.meters[0].customName, 'A3RM Meter');
  assert.equal(board.meters[0].deviceName, 'A3RM Meter');
  assert.equal(board.meters[0].deviceNameOverridden, false);
  assert.deepEqual(board.meters[0].wwSwitchboard, {
    name: 'Main distribution board',
    location: 'Electrical room',
    deviceSerial: 'A3RM-001',
    signalStrength: 'High',
    antennaType: 'Internal',
  });
  assert.equal(board.meters[0].wwChannels?.length, 3);
  assert.equal(board.meters[0].wwChannels?.[0].description, 'Incoming mains');
  assert.equal(board.meters[0].wwChannels?.[0].purpose, 'MAIN_SUPPLY');
  assert.equal(board.meters[0].wwChannels?.[1].purpose, 'SUB_CIRCUIT');
  assert.equal(board.meters[0].wwChannels?.[1].loadType, 'Refrigeration');
  assert.equal(board.meters[0].wwChannels?.[1].customLoadTypeName, 'Refrigeration');
  assert.equal(board.meters[0].wwChannels?.[1].description, 'Cool-room circuit');
  assert.equal(board.meters[0].wwChannels?.[2].purpose, 'SPARE');
  assert.equal(board.meters[0].wwChannels?.[2].loadType, undefined);
  assert.equal(board.meters[0].wwChannels?.[2].rogowskiSize, undefined);
  assert.equal(form.meterId, board.meters[0].id);
});
