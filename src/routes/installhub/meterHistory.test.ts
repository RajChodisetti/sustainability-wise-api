import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInstallationTreeV2, type CanonicalInstallationTree } from './canonical.js';
import {
  CommsReplacementStateError,
  MeterHistoryRestoreError,
  ambiguousCommsReplacementMeterIds,
  authorizeCommsReplacementTransitions,
  completedCommsReplacementTransitions,
  meterHistoryStateHash,
  retainPendingCommsReplacementMeterState,
  restoreMeterFromHistory,
} from './meterHistory.js';
import { retainCompletedFormsDuringMetadata } from './treeService.js';
import {
  prepareCanonicalInstallHubWrite,
  validateCanonicalFormContractsForSync,
} from './sync.js';

function tree(): CanonicalInstallationTree {
  return {
    treeSchemaVersion: 2,
    installation: {
      id: 'installation-1',
      externalKey: 'ih-installation-1',
      siteCode: 'SITE',
      timezone: 'Australia/Sydney',
      clientName: 'Client',
      siteName: 'Site',
      siteAddress: 'Address',
      inspectorName: 'Inspector',
      auditDate: '2026-08-08',
      status: 'Draft',
      treeSchemaVersion: 2,
      treeRevision: 7,
      recordVersionNumber: 4,
    },
    gridSupplies: [{
      id: 'grid-1',
      installationId: 'installation-1',
      name: 'Grid',
      isDefault: true,
    }],
    zones: [{
      id: 'zone-1',
      installationId: 'installation-1',
      zoneCode: 'Z1',
      zoneName: 'Main',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: 'board-1',
      installationId: 'installation-1',
      zoneId: 'zone-1',
      assetName: 'MSB',
      typeCode: 'MSB',
      displayCode: {
        value: 'SITE-Z1-01-MSB-MSB',
        generatedValue: 'SITE-Z1-01-MSB-MSB',
        isOverridden: false,
        ruleVersion: 4,
      },
      electricalSource: { kind: 'GRID', gridSupplyId: 'grid-1' },
      extraPhotos: [],
      meterPresent: true,
    }],
    siteAssets: [{
      id: 'asset-1',
      installationId: 'installation-1',
      zoneId: 'zone-1',
      assetName: 'HVAC',
      typeCode: 'HVAC',
      displayCode: {
        value: 'SITE-Z1-02-HVAC-HVAC',
        generatedValue: 'SITE-Z1-02-HVAC-HVAC',
        isOverridden: false,
        ruleVersion: 4,
      },
      electricalSource: { kind: 'BOARD', boardId: 'board-1' },
      meteringState: { kind: 'METERED', measurementAssignmentIds: ['assignment-1'] },
      meterPresent: true,
      comments: 'Current unrelated note',
      extraPhotos: [],
    }],
    meterDevices: [{
      id: 'meter-1',
      installationId: 'installation-1',
      installedOnBoardId: 'board-1',
      customName: 'Main meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A6M',
      deviceNumber: 'new-number',
      serialNumber: 'new-serial',
      displayName: {
        value: 'SITE-Z1-03-A6M-MAIN-METER',
        generatedValue: 'SITE-Z1-03-A6M-MAIN-METER',
        isOverridden: false,
        ruleVersion: 4,
      },
      channels: [{
        id: 'meter-1:1',
        ordinal: 1,
        purpose: 'SUB_CIRCUIT',
        description: 'Current HVAC',
      }],
    }],
    measurementAssignments: [{
      id: 'assignment-1',
      installationId: 'installation-1',
      meterId: 'meter-1',
      channelIds: ['meter-1:1'],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    }],
    formSubmissions: [{
      id: 'form-1',
      installationId: 'installation-1',
      formType: 'comms-fault',
      schemaVersion: 2,
      status: 'Draft',
      zoneId: 'zone-1',
      boardId: 'board-1',
      meterId: 'meter-1',
      answers: { 'works.replace_device': 'yes' },
      attachments: [],
    }],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

test('a comms replacement is detected once at the completed boundary', () => {
  const current = tree();
  const incoming = structuredClone(current);
  incoming.formSubmissions[0].status = 'Completed';
  assert.deepEqual(completedCommsReplacementTransitions({ current, incoming }), [{
    formSubmissionId: 'form-1',
    meterId: 'meter-1',
  }]);

  current.formSubmissions[0].status = 'Completed';
  assert.deepEqual(completedCommsReplacementTransitions({ current, incoming }), []);
});

test('three sequential replacements each cross one durable completion boundary', () => {
  let current = tree();
  for (let index = 1; index <= 3; index += 1) {
    const incoming = structuredClone(current);
    const form = {
      ...structuredClone(incoming.formSubmissions[0]),
      id: `form-${index}`,
      status: 'Completed',
      answers: {
        'works.replace_device': 'yes',
        'works.new_device_id': `serial-${index}`,
      },
    };
    incoming.formSubmissions = [
      ...incoming.formSubmissions.filter((item) => item.id !== form.id),
      form,
    ];
    assert.deepEqual(completedCommsReplacementTransitions({ current, incoming }), [{
      formSubmissionId: `form-${index}`,
      meterId: 'meter-1',
    }]);
    current = incoming;
  }
});

test('two newly completed forms for one meter are an ambiguous replacement batch', () => {
  assert.deepEqual(ambiguousCommsReplacementMeterIds([
    { formSubmissionId: 'form-1', meterId: 'meter-1' },
    { formSubmissionId: 'form-2', meterId: 'meter-1' },
    { formSubmissionId: 'form-3', meterId: 'meter-2' },
  ]), ['meter-1']);
});

test('metadata keeps a pending Draft replacement identity and topology out of the live tree', () => {
  const current = tree();
  const incoming = tree();
  incoming.installation.siteName = 'Unrelated metadata edit';
  incoming.formSubmissions[0].answers['works.replace_device'] = 'yes';
  incoming.meterDevices[0].deviceModel = 'A3RM';
  incoming.meterDevices[0].serialNumber = 'staged-replacement';
  incoming.meterDevices[0].channels = incoming.meterDevices[0].channels.slice(0, 1);
  incoming.meterDevices[0].notes = 'Independent meter note';
  incoming.meterDevices[0].wwPhotos = { enclosure: 'photo-2' };
  incoming.meterDevices[0].commissioningData = {
    verification: { communicationsOk: true },
  };
  incoming.meterDevices[0].updatedAt = '2026-08-08T12:00:00.000Z';
  incoming.measurementAssignments = [];
  incoming.siteAssets[0].meterPresent = false;
  incoming.siteAssets[0].meteringState = { kind: 'TBC' };

  assert.deepEqual(
    retainPendingCommsReplacementMeterState({ current, incoming }),
    ['meter-1'],
  );
  assert.equal(incoming.installation.siteName, 'Unrelated metadata edit');
  assert.equal(incoming.meterDevices[0].serialNumber, 'new-serial');
  assert.equal(incoming.meterDevices[0].notes, 'Independent meter note');
  assert.deepEqual(incoming.meterDevices[0].wwPhotos, { enclosure: 'photo-2' });
  assert.deepEqual(incoming.meterDevices[0].commissioningData, {
    verification: { communicationsOk: true },
  });
  assert.equal(incoming.meterDevices[0].updatedAt, '2026-08-08T12:00:00.000Z');
  assert.deepEqual(incoming.measurementAssignments, []);
  assert.deepEqual(incoming.siteAssets[0].meteringState, { kind: 'TBC' });
  assert.equal(incoming.siteAssets[0].meterPresent, false);
});

test('metadata restores staged server-completed forms before pending replacement detection', () => {
  const current = tree();
  current.formSubmissions[0].status = 'Completed';
  current.formSubmissions[0].completedAt = '2026-08-08T10:00:00.000Z';
  const incoming = structuredClone(current);
  incoming.formSubmissions[0].status = 'Draft';
  incoming.formSubmissions[0].completedAt = null;
  incoming.meterDevices[0].customName = 'Legitimate later label edit';

  incoming.formSubmissions = retainCompletedFormsDuringMetadata({
    existing: current.formSubmissions,
    incoming: incoming.formSubmissions,
  });
  assert.deepEqual(retainPendingCommsReplacementMeterState({ current, incoming }), []);
  assert.equal(incoming.formSubmissions[0].status, 'Completed');
  assert.equal(incoming.meterDevices[0].customName, 'Legitimate later label edit');
});

test('commissioned identity authorization requires the exact comms transformation', () => {
  const current = tree();
  current.meterDevices[0].deviceModel = 'A3RM';
  current.meterDevices[0].channels.push(
    { id: 'meter-1:2', ordinal: 2, purpose: 'SPARE', capabilities: {} },
    { id: 'meter-1:3', ordinal: 3, purpose: 'SPARE', capabilities: {} },
  );
  current.measurementAssignments[0].channelIds = ['meter-1:1', 'meter-1:2', 'meter-1:3'];
  current.measurementAssignments[0].phaseMode = 'THREE_PHASE';
  current.measurementAssignments.push({
    ...structuredClone(current.measurementAssignments[0]),
    id: 'assignment-2',
    channelIds: ['meter-1:1'],
    phaseMode: 'SINGLE_PHASE',
  });
  current.siteAssets[0].meteringState = {
    kind: 'METERED',
    measurementAssignmentIds: ['assignment-1', 'assignment-2'],
  };
  const incoming = structuredClone(current);
  incoming.formSubmissions[0].status = 'Completed';
  incoming.formSubmissions[0].answers = {
    'works.replace_device': 'yes',
    'works.new_device_type': 'A6M',
    'works.new_device_id': 'replacement-serial',
    'works.new_sensor_rating': 'CT-60A',
  };
  incoming.meterDevices[0] = {
    ...incoming.meterDevices[0],
    deviceModel: 'A6M',
    deviceNumber: 'replacement-serial',
    serialNumber: 'replacement-serial',
    channels: [
      {
        ...incoming.meterDevices[0].channels[0],
        sensorRating: 'CT-60A',
      },
      {
        ...incoming.meterDevices[0].channels[1],
        sensorRating: 'CT-60A',
      },
      {
        ...incoming.meterDevices[0].channels[2],
        sensorRating: 'CT-60A',
      },
      ...[4, 5, 6].map((ordinal) => ({
        id: `meter-1:${ordinal}`,
        ordinal,
        purpose: 'SUB_CIRCUIT' as const,
        sensorRating: 'CT-60A',
        capabilities: {},
      })),
    ],
  };
  const transitions = completedCommsReplacementTransitions({ current, incoming });
  assert.deepEqual(
    [...authorizeCommsReplacementTransitions({ current, incoming, transitions })],
    ['meter-1'],
  );
  assert.equal(incoming.meterDevices[0].channels[0].sensorRating, 'CT-60A');
  assert.equal(incoming.meterDevices[0].channels[1].sensorRating, 'CT-60A');
  assert.equal(incoming.meterDevices[0].channels[2].sensorRating, 'CT-60A');
  const portalExpansion = structuredClone(incoming);
  for (const channel of portalExpansion.meterDevices[0].channels.slice(3)) {
    channel.purpose = 'SPARE';
  }
  assert.deepEqual(
    [...authorizeCommsReplacementTransitions({
      current,
      incoming: portalExpansion,
      transitions,
    })],
    ['meter-1'],
  );
  const reorderedMapping = structuredClone(incoming);
  reorderedMapping.measurementAssignments[0].channelIds.reverse();
  if (reorderedMapping.siteAssets[0].meteringState.kind === 'METERED') {
    reorderedMapping.siteAssets[0].meteringState.measurementAssignmentIds.reverse();
  }
  assert.deepEqual(
    [...authorizeCommsReplacementTransitions({
      current,
      incoming: reorderedMapping,
      transitions,
    })],
    ['meter-1'],
  );
  const assertStateMismatch = (candidate: CanonicalInstallationTree) => assert.throws(
    () => authorizeCommsReplacementTransitions({ current, incoming: candidate, transitions }),
    (error: unknown) => (
      error instanceof CommsReplacementStateError
      && error.code === 'comms_replacement_state_mismatch'
    ),
  );

  const blankIdentity = structuredClone(incoming);
  blankIdentity.formSubmissions[0].answers['works.new_device_id'] = '';
  blankIdentity.formSubmissions[0].answers['works.new_device_number'] = '';
  blankIdentity.meterDevices[0].serialNumber = '';
  blankIdentity.meterDevices[0].deviceNumber = null;
  assertStateMismatch(blankIdentity);

  const missingSensor = structuredClone(incoming);
  delete missingSensor.formSubmissions[0].answers['works.new_sensor_rating'];
  for (const channel of missingSensor.meterDevices[0].channels) channel.sensorRating = null;
  assertStateMismatch(missingSensor);

  const invalidSensor = structuredClone(incoming);
  invalidSensor.formSubmissions[0].answers['works.new_sensor_rating'] = 'arbitrary-sensor';
  for (const channel of invalidSensor.meterDevices[0].channels) {
    channel.sensorRating = 'arbitrary-sensor';
  }
  assertStateMismatch(invalidSensor);

  const unsupportedModel = structuredClone(incoming);
  unsupportedModel.formSubmissions[0].answers['works.new_device_type'] = 'OTHER';
  unsupportedModel.meterDevices[0].deviceModel = 'OTHER';
  unsupportedModel.meterDevices[0].channels = [];
  assertStateMismatch(unsupportedModel);

  const optionalZone = structuredClone(incoming);
  optionalZone.formSubmissions[0].zoneId = null;
  assert.deepEqual(
    [...authorizeCommsReplacementTransitions({ current, incoming: optionalZone, transitions })],
    ['meter-1'],
  );

  const assertMappingChanged = (candidate: CanonicalInstallationTree) => assert.throws(
    () => authorizeCommsReplacementTransitions({ current, incoming: candidate, transitions }),
    (error: unknown) => (
      error instanceof CommsReplacementStateError
      && error.code === 'comms_replacement_mapping_changed'
    ),
  );
  const removedMapping = structuredClone(incoming);
  removedMapping.measurementAssignments = [];
  assertMappingChanged(removedMapping);
  const detachedAsset = structuredClone(incoming);
  detachedAsset.siteAssets[0].meterPresent = false;
  detachedAsset.siteAssets[0].meteringState = { kind: 'TBC' };
  assertMappingChanged(detachedAsset);

  incoming.formSubmissions[0].zoneId = 'wrong-zone';
  assertStateMismatch(incoming);
  incoming.formSubmissions[0].zoneId = 'zone-1';
  incoming.formSubmissions[0].boardId = 'wrong-board';
  assertStateMismatch(incoming);
  incoming.formSubmissions[0].boardId = 'board-1';
  incoming.meterDevices[0].channels[0].purpose = 'MAIN_SUPPLY';
  assertStateMismatch(incoming);
});

test('same-model comms replacement preserves the installed-client SPARE sensor transform', () => {
  const current = tree();
  current.meterDevices[0].deviceModel = 'A3RM';
  current.meterDevices[0].channels.push(
    { id: 'meter-1:2', ordinal: 2, purpose: 'SPARE', capabilities: {} },
    { id: 'meter-1:3', ordinal: 3, purpose: 'SPARE', capabilities: {} },
  );
  const incoming = structuredClone(current);
  incoming.formSubmissions[0].status = 'Completed';
  incoming.formSubmissions[0].answers = {
    'works.replace_device': 'yes',
    'works.new_device_type': 'A3RM',
    'works.new_device_id': 'same-model-serial',
    'works.new_sensor_rating': '3000A - 20cm',
  };
  incoming.meterDevices[0].serialNumber = 'same-model-serial';
  incoming.meterDevices[0].deviceNumber = 'same-model-serial';
  for (const channel of incoming.meterDevices[0].channels) {
    channel.sensorRating = '3000A - 20cm';
  }

  const transitions = completedCommsReplacementTransitions({ current, incoming });
  authorizeCommsReplacementTransitions({ current, incoming, transitions });
  assert.deepEqual(
    incoming.meterDevices[0].channels.map((channel) => channel.sensorRating ?? null),
    ['3000A - 20cm', '3000A - 20cm', '3000A - 20cm'],
  );
});

test('A6M to A3RM replacement cannot drop an assigned channel', () => {
  const current = tree();
  current.meterDevices[0].deviceModel = 'A6M';
  current.meterDevices[0].channels = Array.from({ length: 6 }, (_, index) => ({
    id: `meter-1:${index + 1}`,
    ordinal: index + 1,
    purpose: 'SUB_CIRCUIT' as const,
    sensorRating: 'CT-60A',
    capabilities: {},
  }));
  current.measurementAssignments.push({
    id: 'assignment-channel-4',
    installationId: 'installation-1',
    meterId: 'meter-1',
    channelIds: ['meter-1:4'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  });
  const incoming = structuredClone(current);
  incoming.formSubmissions[0].status = 'Completed';
  incoming.formSubmissions[0].answers = {
    'works.replace_device': 'yes',
    'works.new_device_type': 'A3RM',
    'works.new_device_id': 'a3-replacement',
    'works.new_sensor_rating': '3000A - 20cm',
  };
  incoming.meterDevices[0].deviceModel = 'A3RM';
  incoming.meterDevices[0].serialNumber = 'a3-replacement';
  incoming.meterDevices[0].deviceNumber = 'a3-replacement';
  incoming.meterDevices[0].channels = incoming.meterDevices[0].channels
    .slice(0, 3)
    .map((channel) => ({ ...channel, sensorRating: '3000A - 20cm' }));
  const transitions = completedCommsReplacementTransitions({ current, incoming });
  assert.throws(
    () => authorizeCommsReplacementTransitions({ current, incoming, transitions }),
    (error: unknown) => (
      error instanceof CommsReplacementStateError
      && error.code === 'comms_replacement_mapping_changed'
    ),
  );
});

test('pending replacement staging fails closed when its meter is absent', () => {
  const current = tree();
  const incoming = tree();
  incoming.meterDevices = [];
  assert.throws(
    () => retainPendingCommsReplacementMeterState({ current, incoming }),
    (error: unknown) => (
      error instanceof CommsReplacementStateError
      && error.code === 'comms_replacement_meter_missing'
    ),
  );
});

function offlineNewMeter(): { current: CanonicalInstallationTree; incoming: CanonicalInstallationTree } {
  const incoming = tree();
  incoming.formSubmissions[0].historicalMeterRemoved = false;
  const meter = incoming.meterDevices[0];
  meter.deviceModel = 'A3RM';
  meter.deviceNumber = 'ORIGINAL-TAG';
  meter.serialNumber = 'ORIGINAL-SERIAL';
  meter.channels = [1, 2, 3].map((ordinal) => ({
    id: `${meter.id}:${ordinal}`, ordinal, purpose: 'SPARE', capabilities: {},
  }));
  meter.wwPhotos = {};
  incoming.measurementAssignments = [];
  incoming.siteAssets[0].meterPresent = false;
  incoming.siteAssets[0].meteringState = { kind: 'UNMETERED' };
  incoming.formSubmissions[0].answers = {
    'existing.device_type': 'A3RM',
    'existing.device_id': 'ORIGINAL-SERIAL',
    'existing.device_number': 'ORIGINAL-TAG',
    'works.replace_device': 'yes',
    'works.new_device_type': 'A6M',
    'works.new_device_id': 'REPLACEMENT-SERIAL',
    'works.new_device_number': 'REPLACEMENT-TAG',
    'works.new_sensor_rating': 'CT-400A',
  };
  const current = structuredClone(incoming);
  current.meterDevices = [];
  current.formSubmissions = [];
  return { current, incoming };
}

// Exercise the production sync preparation, normalization, retention and form
// contract boundary. The route's DB/CAS/ownership guards remain separate.
function stageMetadata(input: ReturnType<typeof offlineNewMeter>): CanonicalInstallationTree {
  const { current } = input;
  const incoming = normalizeInstallationTreeV2(prepareCanonicalInstallHubWrite({
    ...structuredClone(input.incoming),
    baseTreeRevision: current.installation.treeRevision,
    syncStage: 'metadata',
  }, current.installation, current.installation.externalKey));
  incoming.formSubmissions = retainCompletedFormsDuringMetadata({
    existing: current.formSubmissions,
    incoming: incoming.formSubmissions,
  });
  retainPendingCommsReplacementMeterState({ current, incoming });
  validateCanonicalFormContractsForSync({
    incoming: incoming.formSubmissions,
    existing: current.formSubmissions,
    syncStage: 'metadata',
  });
  return incoming;
}

test('metadata stages a new supported meter and Comms Draft with its original state and no WW prerequisite', () => {
  const fixture = offlineNewMeter();
  const before = structuredClone(fixture);
  const staged = stageMetadata(fixture);
  assert.deepEqual(staged.meterDevices, normalizeInstallationTreeV2(fixture.incoming).meterDevices);
  assert.equal(staged.meterDevices[0].deviceModel, 'A3RM');
  assert.equal(staged.meterDevices[0].serialNumber, 'ORIGINAL-SERIAL');
  assert.equal(staged.meterDevices[0].deviceNumber, 'ORIGINAL-TAG');
  assert.equal(staged.meterDevices[0].channels.length, 3);
  assert.equal(staged.formSubmissions[0].status, 'Draft');
  assert.equal(staged.formSubmissions[0].answers['works.new_device_id'], 'REPLACEMENT-SERIAL');
  assert.deepEqual(completedCommsReplacementTransitions({ current: fixture.current, incoming: staged }), []);
  assert.deepEqual(fixture, before, 'staging never mutates the frozen original input');
});

test('metadata permits a newly captured supported meter with its linked WW and Comms Drafts', () => {
  const fixture = offlineNewMeter();
  fixture.incoming.formSubmissions.push({
    ...structuredClone(fixture.incoming.formSubmissions[0]),
    id: 'ww-draft-1',
    formType: 'ww-installation',
    answers: {
      'device.type': 'A3RM',
      'device.id': 'ORIGINAL-SERIAL',
      'device.number': 'ORIGINAL-TAG',
    },
  });
  const staged = stageMetadata(fixture);
  assert.equal(staged.formSubmissions.length, 2);
  assert.equal(staged.meterDevices[0].serialNumber, 'ORIGINAL-SERIAL');
  assert.deepEqual(staged.meterDevices[0].channels, normalizeInstallationTreeV2(fixture.incoming).meterDevices[0].channels);
});

test('new-meter original captures use canonical trimmed text and remain optional when blank', () => {
  for (const model of ['A3RM', 'A6M'] as const) {
    for (const capture of ['omitted', 'blank', 'trimmed'] as const) {
      const fixture = offlineNewMeter();
      fixture.incoming.meterDevices[0].deviceModel = model;
      fixture.incoming.meterDevices[0].serialNumber = ' ORIGINAL-SERIAL ';
      fixture.incoming.meterDevices[0].deviceNumber = ' ORIGINAL-TAG ';
      const answers = fixture.incoming.formSubmissions[0].answers;
      for (const [key, value] of Object.entries({
        'existing.device_type': model,
        'existing.device_id': 'ORIGINAL-SERIAL',
        'existing.device_number': 'ORIGINAL-TAG',
      })) {
        if (capture === 'omitted') delete answers[key];
        else answers[key] = capture === 'blank' ? '  ' : ` ${value} `;
      }
      const staged = stageMetadata(fixture);
      assert.equal(staged.meterDevices[0].deviceModel, model);
      assert.equal(staged.meterDevices[0].serialNumber, 'ORIGINAL-SERIAL');
      assert.equal(staged.meterDevices[0].deviceNumber, 'ORIGINAL-TAG');
    }
  }
});

test('new-meter staging rejects a supplied original identity that describes a different meter', () => {
  for (const key of ['existing.device_type', 'existing.device_id', 'existing.device_number']) {
    const fixture = offlineNewMeter();
    fixture.incoming.formSubmissions[0].answers[key] = 'different';
    assert.throws(() => stageMetadata(fixture), /comms_replacement_state_mismatch/, key);
  }
  const projectedTooEarly = offlineNewMeter();
  projectedTooEarly.incoming.meterDevices[0].deviceModel = 'A6M';
  projectedTooEarly.incoming.meterDevices[0].serialNumber = 'REPLACEMENT-SERIAL';
  assert.throws(() => stageMetadata(projectedTooEarly), /comms_replacement_state_mismatch/);
});

test('new-meter exception rejects unsupported family-model pairs and mismatched form context', () => {
  for (const mutate of [
    (input: ReturnType<typeof offlineNewMeter>) => { input.incoming.meterDevices[0].deviceFamily = 'OTHER'; },
    (input: ReturnType<typeof offlineNewMeter>) => { input.incoming.meterDevices[0].deviceModel = 'OTHER'; },
    (input: ReturnType<typeof offlineNewMeter>) => { input.current.installation.id = 'foreign-installation'; },
    (input: ReturnType<typeof offlineNewMeter>) => {
      input.incoming.electricalAssets.push({ ...input.incoming.electricalAssets[0], id: 'board-2' });
      input.incoming.formSubmissions[0].boardId = 'board-2';
    },
    (input: ReturnType<typeof offlineNewMeter>) => {
      input.incoming.zones.push({ ...input.incoming.zones[0], id: 'zone-2', zoneCode: 'Z2' });
      input.incoming.formSubmissions[0].zoneId = 'zone-2';
    },
  ]) {
    const fixture = offlineNewMeter();
    mutate(fixture);
    assert.throws(() => stageMetadata(fixture), /comms_replacement_state_mismatch/);
  }
});

test('canonical metadata normalization still rejects missing meters, foreign parents and malformed channels', () => {
  for (const mutate of [
    (input: ReturnType<typeof offlineNewMeter>) => { input.incoming.meterDevices = []; },
    (input: ReturnType<typeof offlineNewMeter>) => { input.incoming.meterDevices[0].installationId = 'foreign'; },
    (input: ReturnType<typeof offlineNewMeter>) => { input.incoming.meterDevices[0].channels[0].ordinal = 0; },
  ]) {
    const fixture = offlineNewMeter();
    mutate(fixture);
    assert.throws(() => stageMetadata(fixture));
  }
});

test('a previously saved form or retained meter history cannot use the first-capture exception', () => {
  for (const type of ['comms-fault', 'ww-installation']) {
    const fixture = offlineNewMeter();
    fixture.current.formSubmissions = [{
      ...structuredClone(fixture.incoming.formSubmissions[0]),
      id: 'retained-form', formType: type, status: 'Completed', historicalMeterRemoved: true,
    }];
    assert.throws(() => stageMetadata(fixture), /comms_replacement_meter_missing/);
  }
  const repointedDraft = offlineNewMeter();
  repointedDraft.current.formSubmissions = [{
    ...structuredClone(repointedDraft.incoming.formSubmissions[0]), meterId: 'different-old-meter',
  }];
  assert.throws(() => stageMetadata(repointedDraft), /comms_replacement_state_mismatch/);
});

test('first-capture Draft staging does not authorize an invalid completed replacement', () => {
  const fixture = offlineNewMeter();
  const completedWithoutPreimage = structuredClone(fixture.incoming);
  completedWithoutPreimage.formSubmissions[0].status = 'Completed';
  assert.throws(() => authorizeCommsReplacementTransitions({
    current: fixture.current,
    incoming: completedWithoutPreimage,
    transitions: completedCommsReplacementTransitions({ current: fixture.current, incoming: completedWithoutPreimage }),
  }), /comms_replacement_meter_missing/);
  const staged = stageMetadata(fixture);
  const incompleteReplacement = structuredClone(staged);
  incompleteReplacement.formSubmissions[0].status = 'Completed';
  assert.throws(() => authorizeCommsReplacementTransitions({
    current: staged,
    incoming: incompleteReplacement,
    transitions: completedCommsReplacementTransitions({ current: staged, incoming: incompleteReplacement }),
  }), /comms_replacement_state_mismatch/);
});

test('rollback restores the selected device graph and preserves unrelated current data', () => {
  const current = tree();
  const target = tree();
  target.meterDevices[0].deviceModel = 'A3RM';
  target.meterDevices[0].deviceNumber = 'old-number';
  target.meterDevices[0].serialNumber = 'old-serial';
  target.meterDevices[0].channels[0].description = 'Historical HVAC';
  target.formSubmissions = [];
  target.siteAssets[0].comments = 'Historical note must not return';

  const restored = restoreMeterFromHistory({ current, target, meterId: 'meter-1' });
  assert.equal(restored.meterDevices[0].deviceModel, 'A3RM');
  assert.equal(restored.meterDevices[0].serialNumber, 'old-serial');
  assert.equal(restored.meterDevices[0].channels[0].description, 'Historical HVAC');
  assert.deepEqual(
    restored.measurementAssignments,
    current.measurementAssignments,
    'current compatible target relationships stay attached',
  );
  assert.equal(restored.siteAssets[0].comments, 'Current unrelated note');
  assert.equal(restored.formSubmissions.length, 1, 'immutable current forms stay retained');
  assert.notEqual(
    meterHistoryStateHash(restored, 'meter-1'),
    meterHistoryStateHash(current, 'meter-1'),
  );
});

test('assignment-only edits do not create a false device-state version', () => {
  const before = tree();
  const after = tree();
  after.measurementAssignments[0].direction = 'BIDIRECTIONAL';
  after.siteAssets[0].comments = 'An unrelated mapping edit';
  assert.equal(
    meterHistoryStateHash(before, 'meter-1'),
    meterHistoryStateHash(after, 'meter-1'),
  );
});

test('rollback rejects a changed switchboard or incompatible A6M assignment atomically', () => {
  const current = tree();
  const target = tree();
  target.meterDevices[0].installedOnBoardId = 'historical-board';
  assert.throws(
    () => restoreMeterFromHistory({ current, target, meterId: 'meter-1' }),
    (error: unknown) => (
      error instanceof MeterHistoryRestoreError
      && error.code === 'meter_history_context_changed'
    ),
  );

  target.meterDevices[0].installedOnBoardId = 'board-1';
  current.meterDevices[0].channels.push({
    id: 'meter-1:4',
    ordinal: 4,
    purpose: 'SUB_CIRCUIT',
  });
  current.measurementAssignments.push({
    id: 'assignment-channel-4',
    installationId: 'installation-1',
    meterId: 'meter-1',
    channelIds: ['meter-1:4'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: 'board-1' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  });
  assert.throws(
    () => restoreMeterFromHistory({ current, target, meterId: 'meter-1' }),
    (error: unknown) => (
      error instanceof MeterHistoryRestoreError
      && error.code === 'meter_history_context_changed'
    ),
  );
});

test('rollback rejects BOARD and Grid assignments whose historical purpose is incompatible', () => {
  for (const targetKind of ['BOARD', 'GRID_BOUNDARY'] as const) {
    const current = tree();
    current.meterDevices[0].channels[0].purpose = 'MAIN_SUPPLY';
    current.measurementAssignments[0].target = targetKind === 'BOARD'
      ? { kind: 'BOARD', boardId: 'board-1' }
      : { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid-1' };
    const target = structuredClone(current);
    target.meterDevices[0].channels[0].purpose = 'SUB_CIRCUIT';
    assert.throws(
      () => restoreMeterFromHistory({ current, target, meterId: 'meter-1' }),
      (error: unknown) => (
        error instanceof MeterHistoryRestoreError
        && error.code === 'meter_history_context_changed'
      ),
      targetKind,
    );
  }
});

test('rollback permits historical unassigned active channels as optional follow-up', () => {
  for (const purpose of ['MAIN_SUPPLY', 'SUB_CIRCUIT'] as const) {
    const current = tree();
    const target = tree();
    target.meterDevices[0].channels.push({
      id: 'meter-1:2',
      ordinal: 2,
      purpose,
      capabilities: {},
    });
    assert.doesNotThrow(
      () => restoreMeterFromHistory({ current, target, meterId: 'meter-1' }),
      purpose,
    );
  }
});
