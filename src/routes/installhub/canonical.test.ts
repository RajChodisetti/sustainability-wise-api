import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanonicalInputError,
  allocateDisplayCodes,
  assertStructurallySafeTree,
  canonicalPayloadHash,
  canonicalTreeMutationFingerprint,
  deriveVirtualMeterDefinitions,
  installationReadiness,
  installationDisplayCodePrefix,
  isValidInstallationSiteCode,
  normalizeInstallationTreeV2,
  type CanonicalFormSubmission,
  type CanonicalInstallationTree,
  type DisplayCode,
  type MeasurementAssignment,
  type MeterChannel,
  type MeterDevice,
} from './canonical.js';

test('canonical site-code contract accepts only bounded uppercase groups', () => {
  for (const valid of ['W', 'SYD-WH1', '123', 'ABCDEFGHIJKLMNOP']) {
    assert.equal(isValidInstallationSiteCode(valid), true);
  }
  for (const invalid of ['bad', 'BAD SITE', 'BAD!', '-BAD', 'BAD-', 'BAD--SITE', 'ABCDEFGHIJKLMNOPQ']) {
    assert.equal(isValidInstallationSiteCode(invalid), false);
  }
});

test('historical site codes project to one bounded display-code prefix without mutation', () => {
  assert.equal(installationDisplayCodePrefix('Legacy Site Code / 2024'), 'LEGACY-SITE-CODE');
  assert.equal(installationDisplayCodePrefix('---'), 'SITE');
  assert.equal(installationDisplayCodePrefix('123456789012345-678'), '123456789012345');
});

test('canonicalizer preserves a non-empty historical site code for immutable replay', () => {
  const tree = baseTree();
  tree.installation.siteCode = ' Legacy Site Code / 2024 ';
  assert.equal(
    normalizeInstallationTreeV2(tree).installation.siteCode,
    ' Legacy Site Code / 2024 ',
  );
});
import {
  buildAllAssetsView,
  buildElectricalTreeView,
  buildInstallationMappingExport,
  buildMeteringView,
} from './canonicalViews.js';
import {
  paginateReadiness,
  readinessEntityIdsForZone,
  searchCanonicalCandidates,
} from './canonicalPagination.js';
import {
  assertCommissionedMetersRequireAmendment,
  buildCanonicalSnapshotPayload,
  canonicalSnapshotContentHash,
  canonicalSnapshotPayloadHashMatches,
  projectCanonicalMediaManifest,
  wwCommissioningFormMatchesMeter,
} from './treeService.js';
import { liveDiagnosticCanonicalReport } from './pdf.js';

function display(value: string, isOverridden = false): DisplayCode {
  return {
    value,
    generatedValue: value,
    isOverridden,
    ruleVersion: 1,
  };
}

function baseTree(): CanonicalInstallationTree {
  return {
    treeSchemaVersion: 2,
    installation: {
      id: 'installation-1',
      externalKey: 'external-1',
      siteCode: 'ACME',
      timezone: 'Australia/Sydney',
      clientName: 'Acme',
      siteName: 'Acme Factory',
      siteAddress: '1 Test Street',
      inspectorName: 'Inspector',
      auditDate: '2026-08-01',
      status: 'Draft',
      treeSchemaVersion: 2,
      treeRevision: 4,
      recordVersionNumber: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    gridSupplies: [{
      id: 'grid-1',
      installationId: 'installation-1',
      name: 'Grid',
      isDefault: true,
      nmi: 'NMI-1',
    }],
    zones: [{
      id: 'zone-1',
      installationId: 'installation-1',
      zoneName: 'Plant room',
      zoneDescription: '',
      photos: [],
    }],
    electricalAssets: [{
      id: 'board-1',
      installationId: 'installation-1',
      zoneId: 'zone-1',
      assetName: 'Main board',
      typeCode: 'MSB',
      displayCode: display('ACME-MSB-001'),
      electricalSource: { kind: 'GRID', gridSupplyId: 'grid-1' },
      extraPhotos: [],
      meterPresent: false,
    }],
    siteAssets: [{
      id: 'asset-1',
      installationId: 'installation-1',
      zoneId: 'zone-1',
      assetName: 'Air conditioner',
      typeCode: 'HVAC',
      displayCode: display('ACME-HVAC-001'),
      electricalSource: { kind: 'BOARD', boardId: 'board-1' },
      meteringState: { kind: 'UNMETERED' },
      meterPresent: false,
      extraPhotos: [],
    }],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    serverDerived: { virtualMeterDefinitions: [] },
  };
}

function channel(
  ordinal: number,
  purpose: MeterChannel['purpose'] = 'SUB_CIRCUIT',
): MeterChannel {
  return {
    id: `channel-${ordinal}`,
    ordinal,
    purpose,
    ...(purpose === 'SUB_CIRCUIT'
      ? { loadTypeCode: 'HVAC' as const, sensorRating: '120A' }
      : purpose === 'MAIN_SUPPLY'
        ? { sensorRating: '120A' }
        : {}),
  };
}

function a3Meter(serialNumber = 'serial-old'): MeterDevice {
  return {
    id: 'meter-1',
    installationId: 'installation-1',
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    deviceNumber: 'device-1',
    serialNumber,
    displayName: display('ACME-A3RM-001'),
    channels: [channel(1), channel(2), channel(3)],
    wwPhotos: {},
  };
}

function wwAnswers(meter: MeterDevice): Record<string, string> {
  const answers: Record<string, string> = {
    'device.type': meter.deviceModel,
    'device.number': meter.deviceNumber ?? '',
    'device.id': meter.serialNumber,
  };
  for (const meterChannel of meter.channels) {
    answers[`channel.${meterChannel.ordinal}.load`] = meterChannel.purpose === 'SPARE'
      ? 'Not Used'
      : meterChannel.purpose === 'MAIN_SUPPLY'
        ? 'Mains Supply'
        : meterChannel.loadTypeCode === 'HVAC'
          ? 'HVAC'
          : 'Other';
    if (meterChannel.sensorRating) {
      answers[`channel.${meterChannel.ordinal}.rating`] = meterChannel.sensorRating;
    }
    if (meterChannel.customLoadTypeName) {
      answers[`channel.${meterChannel.ordinal}.description`] = meterChannel.customLoadTypeName;
    }
  }
  return answers;
}

function completedWwForm(
  id: string,
  meter: MeterDevice,
  supersedesId?: string,
): CanonicalFormSubmission {
  return {
    id,
    installationId: 'installation-1',
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Completed',
    zoneId: 'zone-1',
    boardId: meter.installedOnBoardId,
    meterId: meter.id,
    answers: wwAnswers(meter),
    attachments: [],
    historicalMeterRemoved: false,
    completedAt: id === 'form-1'
      ? '2026-08-01T01:00:00.000Z'
      : '2026-08-01T02:00:00.000Z',
    ...(supersedesId ? { supersedesId } : {}),
  };
}

test('v2 normalizer rejects legacy aliases, missing tags, and fabricated defaults', () => {
  const aliasedBoard = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const boards = aliasedBoard.electricalAssets as Array<Record<string, unknown>>;
  delete boards[0].typeCode;
  boards[0].assetType = 'Main Snachboard';
  assert.throws(() => normalizeInstallationTreeV2(aliasedBoard), /board\.typeCode/);

  const missingSource = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const sourceBoard = (missingSource.electricalAssets as Array<Record<string, unknown>>)[0];
  delete sourceBoard.electricalSource;
  sourceBoard.sourceKind = 'GRID';
  sourceBoard.gridSupplyId = 'grid-1';
  assert.throws(() => normalizeInstallationTreeV2(missingSource), /electricalSource must be an object/);

  const missingMeteringState = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const asset = (missingMeteringState.siteAssets as Array<Record<string, unknown>>)[0];
  delete asset.meteringState;
  asset.meteringStateKind = 'UNMETERED';
  assert.throws(() => normalizeInstallationTreeV2(missingMeteringState), /meteringState must be an object/);

  const missingInstallationStatus = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  delete (missingInstallationStatus.installation as Record<string, unknown>).status;
  assert.throws(() => normalizeInstallationTreeV2(missingInstallationStatus), /installation\.status/);

  const aliasedMeter = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const meter = a3Meter() as unknown as Record<string, unknown>;
  delete meter.deviceModel;
  meter.deviceType = 'A3RM';
  (aliasedMeter.meterDevices as unknown[]) = [meter];
  assert.throws(() => normalizeInstallationTreeV2(aliasedMeter), /deviceModel/);
});

test('structural validation rejects channel ownership, duplicate ordinals, and dangling form refs', () => {
  const duplicateOrdinal = baseTree();
  const firstMeter = a3Meter();
  firstMeter.channels[1].ordinal = firstMeter.channels[0].ordinal;
  duplicateOrdinal.meterDevices = [firstMeter];
  assert.throws(() => normalizeInstallationTreeV2(duplicateOrdinal), /duplicate channel ordinal/);

  const wrongMeterChannel = baseTree();
  const meterOne = a3Meter();
  const meterTwo = structuredClone(a3Meter('serial-two'));
  meterTwo.id = 'meter-2';
  meterTwo.deviceNumber = 'device-2';
  meterTwo.displayName = display('ACME-A3RM-002');
  meterTwo.channels = meterTwo.channels.map((channel, index) => ({
    ...channel,
    id: `meter-2-channel-${index + 1}`,
  }));
  wrongMeterChannel.meterDevices = [meterOne, meterTwo];
  wrongMeterChannel.measurementAssignments = [{
    id: 'assignment-wrong-meter',
    installationId: wrongMeterChannel.installation.id,
    meterId: meterOne.id,
    channelIds: [meterTwo.channels[0].id],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: wrongMeterChannel.siteAssets[0].id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  assert.throws(() => normalizeInstallationTreeV2(wrongMeterChannel), /channel owned by another meter/);

  const danglingForm = baseTree();
  danglingForm.formSubmissions = [{
    id: 'form-dangling',
    installationId: danglingForm.installation.id,
    formType: 'site-details',
    schemaVersion: 2,
    status: 'Draft',
    zoneId: 'missing-zone',
    answers: {},
    attachments: [],
    historicalMeterRemoved: false,
  }];
  assert.throws(() => normalizeInstallationTreeV2(danglingForm), /unknown zoneId/);
});

test('EXP-06 electrical graph node ids are globally unique and reserve virtual identities', () => {
  const crossKindCollision = baseTree();
  crossKindCollision.gridSupplies[0].id = crossKindCollision.electricalAssets[0].id;
  crossKindCollision.electricalAssets[0].electricalSource = {
    kind: 'GRID',
    gridSupplyId: crossKindCollision.gridSupplies[0].id,
  };
  assert.throws(
    () => normalizeInstallationTreeV2(crossKindCollision),
    /Electrical node id board-1 is shared by GRID and BOARD/,
  );

  const reservedPhysicalId = baseTree();
  reservedPhysicalId.siteAssets[0].id = 'virtual_client_impersonation';
  assert.throws(
    () => normalizeInstallationTreeV2(reservedPhysicalId),
    /uses the reserved virtual_ namespace/,
  );

  const populatedDerivedCollision = baseTree();
  populatedDerivedCollision.serverDerived.virtualMeterDefinitions = [{
    id: populatedDerivedCollision.electricalAssets[0].id,
    parentNodeId: populatedDerivedCollision.electricalAssets[0].id,
    totalMeasurementAssignmentId: 'assignment-total',
    subtractAssignmentIds: [],
    formulaVersion: 1,
    allocation: 'UNALLOCATED_RESIDUAL',
  }];
  assert.throws(
    () => assertStructurallySafeTree(populatedDerivedCollision),
    /is shared by BOARD and VIRTUAL_RESIDUAL/,
  );
});

test('normalizer rejects cross-installation ownership references', () => {
  const raw = structuredClone(baseTree());
  raw.zones[0].installationId = 'installation-2';
  assert.throws(
    () => normalizeInstallationTreeV2(raw),
    (error: unknown) => error instanceof CanonicalInputError
      && /another installation/.test(error.message),
  );
});

test('multiple Grid supplies allow one default and reject normalized identity collisions', () => {
  const tree = baseTree();
  tree.gridSupplies.push({
    id: 'grid-2',
    installationId: tree.installation.id,
    name: 'Embedded network',
    isDefault: false,
    nmi: 'NMI-2',
    externalKey: 'embedded-2',
  });
  assert.doesNotThrow(() => normalizeInstallationTreeV2(tree));
  tree.gridSupplies[1].isDefault = true;
  assert.throws(() => normalizeInstallationTreeV2(tree), /Exactly one active Grid supply/);
  tree.gridSupplies[1].isDefault = false;
  tree.gridSupplies[1].nmi = ' n m i - 1 ';
  assert.throws(() => normalizeInstallationTreeV2(tree), /normalized nmi/);
});

test('strict v2 wire scalars reject coercion, non-string answers, and zero defaults', () => {
  const topSchemaString = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  topSchemaString.treeSchemaVersion = '2';
  assert.throws(() => normalizeInstallationTreeV2(topSchemaString), /treeSchemaVersion must be 2/);

  const nestedSchemaString = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  (nestedSchemaString.installation as Record<string, unknown>).treeSchemaVersion = '2';
  assert.throws(
    () => normalizeInstallationTreeV2(nestedSchemaString),
    /installation\.treeSchemaVersion must be 2/,
  );

  const nonStringAnswer = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  nonStringAnswer.formSubmissions = [{
    id: 'form-non-string',
    installationId: 'installation-1',
    formType: 'site-details',
    schemaVersion: 2,
    status: 'Draft',
    answers: { count: 42 },
    attachments: [],
    historicalMeterRemoved: false,
  }];
  assert.throws(() => normalizeInstallationTreeV2(nonStringAnswer), /answers\.count must be a string/);

  const zeroDefault = baseTree();
  zeroDefault.gridSupplies = [];
  assert.throws(() => normalizeInstallationTreeV2(zeroDefault), /Exactly one active Grid supply/);
});

test('strict v2 tagged unions reject contradictory fields and client-derived state', () => {
  const contradictorySource = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const source = (
    (contradictorySource.electricalAssets as Array<Record<string, unknown>>)[0]
      .electricalSource as Record<string, unknown>
  );
  source.boardId = 'board-1';
  assert.throws(() => normalizeInstallationTreeV2(contradictorySource), /boardId is not allowed/);

  const contradictoryMetering = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  const meteringState = (
    (contradictoryMetering.siteAssets as Array<Record<string, unknown>>)[0]
      .meteringState as Record<string, unknown>
  );
  meteringState.measurementAssignmentIds = [];
  assert.throws(
    () => normalizeInstallationTreeV2(contradictoryMetering),
    /measurementAssignmentIds is not allowed/,
  );

  const contradictoryTarget = baseTree();
  const meter = a3Meter();
  contradictoryTarget.meterDevices = [meter];
  contradictoryTarget.measurementAssignments = [{
    id: 'assignment-contradictory-target',
    installationId: contradictoryTarget.installation.id,
    meterId: meter.id,
    channelIds: [meter.channels[0].id],
    phaseMode: 'SINGLE_PHASE',
    target: {
      kind: 'BOARD',
      boardId: contradictoryTarget.electricalAssets[0].id,
      siteAssetId: contradictoryTarget.siteAssets[0].id,
    } as MeasurementAssignment['target'],
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  assert.throws(() => normalizeInstallationTreeV2(contradictoryTarget), /siteAssetId is not allowed/);

  const suppliedDerived = structuredClone(baseTree()) as unknown as Record<string, unknown>;
  (suppliedDerived.serverDerived as Record<string, unknown>).virtualMeterDefinitions = [{}];
  assert.throws(() => normalizeInstallationTreeV2(suppliedDerived), /server-owned and must be empty/);
});

test('strict v2 form lineage and historical meter state are structurally enforced', () => {
  const cycle = baseTree();
  cycle.formSubmissions = [
    {
      id: 'form-a',
      installationId: cycle.installation.id,
      formType: 'site-details',
      schemaVersion: 2,
      status: 'Completed',
      answers: {},
      attachments: [],
      historicalMeterRemoved: false,
      supersedesId: 'form-b',
    },
    {
      id: 'form-b',
      installationId: cycle.installation.id,
      formType: 'site-details',
      schemaVersion: 2,
      status: 'Completed',
      answers: {},
      attachments: [],
      historicalMeterRemoved: false,
      supersedesId: 'form-a',
    },
  ];
  assert.throws(() => normalizeInstallationTreeV2(cycle), /supersedes cycle/);

  const activeMeter = baseTree();
  const meter = a3Meter();
  activeMeter.meterDevices = [meter];
  const forgedActive = completedWwForm('form-active', meter);
  forgedActive.historicalMeterRemoved = true;
  activeMeter.formSubmissions = [forgedActive];
  assert.throws(() => normalizeInstallationTreeV2(activeMeter), /invalid historicalMeterRemoved state/);

  const draftHistorical = baseTree();
  const forgedDraft = completedWwForm('form-draft', meter);
  forgedDraft.status = 'Draft';
  forgedDraft.historicalMeterRemoved = true;
  draftHistorical.formSubmissions = [forgedDraft];
  assert.throws(() => normalizeInstallationTreeV2(draftHistorical), /invalid historicalMeterRemoved state/);

  const nonWwHistorical = baseTree();
  const forgedNonWw = completedWwForm('form-non-ww', meter);
  forgedNonWw.formType = 'site-details';
  forgedNonWw.historicalMeterRemoved = true;
  nonWwHistorical.formSubmissions = [forgedNonWw];
  assert.throws(() => normalizeInstallationTreeV2(nonWwHistorical), /invalid historicalMeterRemoved state/);

  const danglingFalse = baseTree();
  danglingFalse.formSubmissions = [completedWwForm('form-dangling-false', meter)];
  assert.throws(() => normalizeInstallationTreeV2(danglingFalse), /unknown meterId/);

  const historical = baseTree();
  const validHistorical = completedWwForm('form-historical-valid', meter);
  validHistorical.historicalMeterRemoved = true;
  historical.formSubmissions = [validHistorical];
  assert.equal(
    normalizeInstallationTreeV2(historical).formSubmissions[0].historicalMeterRemoved,
    true,
  );
});

test('display allocation is deterministic, installation-wide, and never reuses claims', () => {
  const initial = baseTree();
  initial.electricalAssets[0].displayCode = display('');
  initial.siteAssets[0].displayCode = display('');
  const claims = allocateDisplayCodes({ tree: initial, existingClaims: [] });
  assert.equal(initial.electricalAssets[0].displayCode.value, 'ACME-MSB-001');
  assert.equal(initial.siteAssets[0].displayCode.value, 'ACME-HVAC-001');

  const replacement = baseTree();
  replacement.electricalAssets = [{
    ...replacement.electricalAssets[0],
    id: 'board-2',
    displayCode: display(''),
  }];
  replacement.siteAssets[0].electricalSource = { kind: 'GRID', gridSupplyId: 'grid-1' };
  allocateDisplayCodes({ tree: replacement, existingClaims: claims });
  assert.equal(replacement.electricalAssets[0].displayCode.value, 'ACME-MSB-002');
  assert.ok(claims.some((claim) => claim.entityId === 'board-1'));

  const collision = baseTree();
  collision.siteAssets[0].id = 'asset-new';
  collision.siteAssets[0].displayCode = display('ACME-MSB-001', true);
  assert.throws(
    () => allocateDisplayCodes({ tree: collision, existingClaims: claims }),
    (error: unknown) => error instanceof CanonicalInputError
      && error.code === 'display_code_conflict',
  );

  const defensive = baseTree();
  defensive.electricalAssets[0].displayCode = display('');
  allocateDisplayCodes({
    tree: defensive,
    existingClaims: [{
      entityType: 'board',
      entityId: 'legacy-board',
      typeCode: 'MSB',
      sequence: null,
      displayCode: 'ACME-MSB-001',
      normalizedDisplayCode: 'ACME-MSB-001',
      generated: false,
      ruleVersion: 1,
    }],
  });
  assert.equal(defensive.electricalAssets[0].displayCode.value, 'ACME-MSB-002');

  const frozen = structuredClone(initial);
  frozen.installation.siteCode = 'RENAMED';
  frozen.electricalAssets[0].typeCode = 'DB';
  frozen.electricalAssets[0].displayCode.ruleVersion = 99;
  const frozenNewClaims = allocateDisplayCodes({ tree: frozen, existingClaims: claims });
  assert.equal(frozen.electricalAssets[0].displayCode.value, 'ACME-MSB-001');
  assert.equal(frozen.electricalAssets[0].displayCode.ruleVersion, 1);
  assert.equal(frozenNewClaims.length, 0);

  frozen.electricalAssets[0].displayCode = display('CUSTOM-MAIN', true);
  const overrideClaims = allocateDisplayCodes({ tree: frozen, existingClaims: claims });
  assert.equal(overrideClaims.length, 0);
  assert.equal(frozen.electricalAssets[0].displayCode.value, 'ACME-MSB-001');
  assert.equal(frozen.electricalAssets[0].displayCode.isOverridden, false);

  const newRuleEntity = baseTree();
  newRuleEntity.electricalAssets[0].id = 'board-new-rule';
  newRuleEntity.electricalAssets[0].displayCode = {
    ...display(''),
    ruleVersion: 99,
  };
  const newRuleClaims = allocateDisplayCodes({ tree: newRuleEntity, existingClaims: claims });
  assert.equal(newRuleClaims[0].entityId, 'board-new-rule');
  assert.equal(newRuleClaims[0].ruleVersion, 99);
});

test('historical site code stays unchanged while new display codes use the bounded prefix', () => {
  const tree = baseTree();
  tree.installation.siteCode = 'Legacy Site Code / 2024';
  tree.electricalAssets[0].displayCode = display('');
  tree.siteAssets = [];
  allocateDisplayCodes({ tree, existingClaims: [] });
  assert.equal(tree.installation.siteCode, 'Legacy Site Code / 2024');
  assert.equal(tree.electricalAssets[0].displayCode.value, 'LEGACY-SITE-CODE-MSB-001');
});

test('readiness enforces exact A3/A6 ordinals, grouping, purpose, and WW context', () => {
  const tree = baseTree();
  const meter = a3Meter();
  meter.channels[0].purpose = 'MAIN_SUPPLY';
  meter.channels[0].loadTypeCode = null;
  meter.channels[2].ordinal = 4;
  meter.channels[2].purpose = 'SPARE';
  meter.channels[2].description = 'must be empty';
  tree.meterDevices = [meter];
  tree.electricalAssets[0].meterPresent = true;
  tree.formSubmissions = [completedWwForm('form-1', meter)];
  tree.measurementAssignments = [{
    id: 'assignment-1',
    installationId: 'installation-1',
    meterId: meter.id,
    channelIds: ['channel-1', 'channel-2'],
    phaseMode: 'THREE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  tree.siteAssets[0].electricalSource = { kind: 'GRID', gridSupplyId: 'grid-1' };
  tree.siteAssets[0].meterPresent = true;
  tree.siteAssets[0].meteringState = {
    kind: 'METERED',
    measurementAssignmentIds: ['assignment-1'],
  };
  const codes = installationReadiness(tree).issues.map((issue) => issue.code);
  assert.ok(codes.includes('CHANNEL_NOT_FOUND'));
  assert.ok(codes.includes('PHASE_GROUP_INVALID'));
  assert.ok(codes.includes('CHANNEL_PURPOSE_CONFLICT'));
  assert.ok(codes.includes('METER_BOARD_MISMATCH'));

  tree.formSubmissions[0].boardId = 'missing-board';
  const invalidContext = installationReadiness(tree).issues;
  assert.ok(invalidContext.some((issue) => issue.code === 'FORM_CONTEXT_REQUIRED'));
  assert.ok(invalidContext.some((issue) => issue.code === 'METER_DEVICE_REQUIRED'));
});

test('virtual residual uses only immediate measured children and rejects ambiguous totals', () => {
  const tree = baseTree();
  tree.electricalAssets.push(
    {
      ...tree.electricalAssets[0],
      id: 'board-child',
      assetName: 'Child',
      typeCode: 'DB',
      displayCode: display('ACME-DB-001'),
      electricalSource: { kind: 'BOARD', boardId: 'board-1' },
    },
    {
      ...tree.electricalAssets[0],
      id: 'board-grandchild',
      assetName: 'Grandchild',
      typeCode: 'DB',
      displayCode: display('ACME-DB-002'),
      electricalSource: { kind: 'BOARD', boardId: 'board-child' },
    },
  );
  const meter: MeterDevice = {
    ...a3Meter(),
    deviceModel: 'OTHER',
    customModelName: 'Test model',
    channels: [
      channel(1, 'MAIN_SUPPLY'),
      channel(2),
      channel(3),
      channel(4),
      channel(5, 'MAIN_SUPPLY'),
      channel(6),
    ],
  };
  tree.meterDevices = [meter];
  const assignment = (
    id: string,
    channelId: string,
    target: MeasurementAssignment['target'],
  ): MeasurementAssignment => ({
    id,
    installationId: 'installation-1',
    meterId: meter.id,
    channelIds: [channelId],
    phaseMode: 'SINGLE_PHASE',
    target,
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  });
  tree.measurementAssignments = [
    assignment('total-root', 'channel-1', { kind: 'BOARD', boardId: 'board-1' }),
    assignment('measured-child', 'channel-2', { kind: 'BOARD', boardId: 'board-child' }),
    assignment('measured-asset', 'channel-3', { kind: 'SITE_ASSET', siteAssetId: 'asset-1' }),
    assignment('measured-grandchild', 'channel-4', { kind: 'BOARD', boardId: 'board-grandchild' }),
  ];
  const [residual] = deriveVirtualMeterDefinitions(tree);
  assert.equal(residual.parentNodeId, 'board-1');
  assert.deepEqual(residual.subtractAssignmentIds, ['measured-asset', 'measured-child']);
  assert.equal(residual.formulaVersion, 1);

  tree.siteAssets.push(
    {
      ...tree.siteAssets[0],
      id: 'asset-unmetered-1',
      assetName: 'Unmetered child one',
      displayCode: display('ACME-HVAC-002'),
    },
    {
      ...tree.siteAssets[0],
      id: 'asset-unmetered-2',
      assetName: 'Unmetered child two',
      displayCode: display('ACME-HVAC-003'),
    },
  );
  tree.serverDerived.virtualMeterDefinitions = deriveVirtualMeterDefinitions(tree);
  const residualCoverage = buildAllAssetsView(tree, 1).assets
    .filter((asset) => asset.id.startsWith('asset-unmetered-'))
    .map((asset) => asset.coverage);
  assert.equal(residualCoverage.length, 2);
  assert.ok(residualCoverage.every((coverage) => (
    coverage.kind === 'VIRTUAL'
    && coverage.virtualMeterId === residual.id
    && coverage.parentNodeId === 'board-1'
    && coverage.allocation === 'UNALLOCATED_RESIDUAL'
    && !('quantity' in coverage)
    && !('percentage' in coverage)
  )));

  tree.measurementAssignments.push(
    assignment('duplicate-child', 'channel-6', { kind: 'BOARD', boardId: 'board-child' }),
  );
  assert.equal(
    deriveVirtualMeterDefinitions(tree).some((item) => item.parentNodeId === 'board-1'),
    false,
  );
  assert.ok(installationReadiness(tree).issues.some((issue) => (
    issue.code === 'VIRTUAL_METER_SOURCE_INCOMPLETE'
    && issue.entityId === 'board-1'
  )));
  tree.measurementAssignments.pop();

  tree.measurementAssignments.push(
    assignment('second-total-root', 'channel-5', { kind: 'BOARD', boardId: 'board-1' }),
  );
  assert.equal(
    deriveVirtualMeterDefinitions(tree).some((item) => item.parentNodeId === 'board-1'),
    false,
  );
  assert.ok(installationReadiness(tree).issues.some(
    (issue) => issue.code === 'VIRTUAL_METER_SOURCE_INCOMPLETE',
  ));
});

test('terminal site-asset MAIN_SUPPLY measurements never create virtual residuals', () => {
  const tree = baseTree();
  const meter = a3Meter();
  meter.channels = [channel(1, 'MAIN_SUPPLY')];
  tree.meterDevices = [meter];
  tree.measurementAssignments = [{
    id: 'terminal-asset-total',
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: [meter.channels[0].id],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: tree.siteAssets[0].id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];

  assert.deepEqual(deriveVirtualMeterDefinitions(tree), []);
});

test('virtual residuals keep BOARD and GRID immediate-child namespaces distinct', () => {
  const tree = baseTree();
  const sharedParentId = 'shared-parent';
  tree.gridSupplies[0].id = sharedParentId;
  tree.electricalAssets[0].id = sharedParentId;
  tree.electricalAssets[0].electricalSource = {
    kind: 'GRID',
    gridSupplyId: sharedParentId,
  };
  tree.siteAssets[0].electricalSource = {
    kind: 'BOARD',
    boardId: sharedParentId,
  };
  tree.siteAssets.push(
    {
      ...tree.siteAssets[0],
      id: 'board-unmeasured-asset',
      assetName: 'Board-fed unmeasured asset',
      displayCode: display('ACME-HVAC-002'),
    },
    {
      ...tree.siteAssets[0],
      id: 'grid-unmeasured-asset',
      assetName: 'Grid-fed unmeasured asset',
      displayCode: display('ACME-HVAC-003'),
      electricalSource: { kind: 'GRID', gridSupplyId: sharedParentId },
    },
  );
  const meter = a3Meter();
  meter.installedOnBoardId = sharedParentId;
  meter.channels = [
    channel(1, 'MAIN_SUPPLY'),
    channel(2, 'MAIN_SUPPLY'),
    channel(3),
  ];
  tree.meterDevices = [meter];
  const assignment = (
    id: string,
    channelId: string,
    target: MeasurementAssignment['target'],
  ): MeasurementAssignment => ({
    id,
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: [channelId],
    phaseMode: 'SINGLE_PHASE',
    target,
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  });
  tree.measurementAssignments = [
    assignment('board-total', meter.channels[0].id, {
      kind: 'BOARD',
      boardId: sharedParentId,
    }),
    assignment('grid-total', meter.channels[1].id, {
      kind: 'GRID_BOUNDARY',
      gridSupplyId: sharedParentId,
    }),
    assignment('asset-measured', meter.channels[2].id, {
      kind: 'SITE_ASSET',
      siteAssetId: tree.siteAssets[0].id,
    }),
  ];

  const definitions = deriveVirtualMeterDefinitions(tree);
  const byTotal = new Map(definitions.map((definition) => (
    [definition.totalMeasurementAssignmentId, definition] as const
  )));
  assert.deepEqual(byTotal.get('board-total')?.subtractAssignmentIds, ['asset-measured']);
  assert.deepEqual(byTotal.get('grid-total')?.subtractAssignmentIds, ['board-total']);

  tree.serverDerived.virtualMeterDefinitions = definitions;
  const allAssets = buildAllAssetsView(tree, 1);
  const coverageByAsset = new Map(allAssets.assets.map((asset) => [asset.id, asset.coverage]));
  assert.deepEqual(coverageByAsset.get('board-unmeasured-asset'), {
    kind: 'VIRTUAL',
    virtualMeterId: byTotal.get('board-total')?.id,
    parentNodeId: sharedParentId,
    allocation: 'UNALLOCATED_RESIDUAL',
  });
  assert.deepEqual(coverageByAsset.get('grid-unmeasured-asset'), {
    kind: 'VIRTUAL',
    virtualMeterId: byTotal.get('grid-total')?.id,
    parentNodeId: sharedParentId,
    allocation: 'UNALLOCATED_RESIDUAL',
  });

  const mapping = buildInstallationMappingExport(tree, 1);
  const mappingCoverage = new Map(mapping.assetCoverage.map((item) => [item.assetId, item]));
  assert.equal(
    mappingCoverage.get('board-unmeasured-asset')?.source?.id,
    byTotal.get('board-total')?.id,
  );
  assert.equal(
    mappingCoverage.get('grid-unmeasured-asset')?.source?.id,
    byTotal.get('grid-total')?.id,
  );

  const report = liveDiagnosticCanonicalReport(tree);
  const reportCoverage = new Map(report.virtualMeterDefinitions.map((definition) => (
    [definition.id, definition.coverage.map((asset) => asset.assetId)] as const
  )));
  assert.deepEqual(reportCoverage.get(byTotal.get('board-total')!.id), ['board-unmeasured-asset']);
  assert.deepEqual(reportCoverage.get(byTotal.get('grid-total')!.id), ['grid-unmeasured-asset']);
});

test('fingerprint suppresses array, channel, and timestamp reorder-only changes', () => {
  const original = baseTree();
  original.electricalAssets.push({
    ...original.electricalAssets[0],
    id: 'board-2',
    assetName: 'Second board',
    typeCode: 'DB',
    displayCode: display('ACME-DB-001'),
  });
  const reordered = structuredClone(original);
  reordered.electricalAssets.reverse();
  reordered.gridSupplies.reverse();
  reordered.installation.updatedAt = '2030-01-01T00:00:00.000Z';
  assert.equal(
    canonicalTreeMutationFingerprint(original),
    canonicalTreeMutationFingerprint(reordered),
  );
  reordered.installation.siteName = 'Changed';
  assert.notEqual(
    canonicalTreeMutationFingerprint(original),
    canonicalTreeMutationFingerprint(reordered),
  );
});

test('views are deterministic, target-neutral, and mapping strips candidate hints', () => {
  const tree = baseTree();
  const meter = a3Meter();
  meter.channels[0].phaseLabel = 'L1';
  meter.channels[0].description = 'Compressor bank';
  meter.channels[0].capabilities = { current: true, voltage: false };
  tree.meterDevices = [meter];
  tree.serverDerived.virtualMeterDefinitions = deriveVirtualMeterDefinitions(tree);
  const electrical = buildElectricalTreeView(tree, 7);
  const assets = buildAllAssetsView(tree, 7);
  const metering = buildMeteringView(tree, 7);
  const mapping = buildInstallationMappingExport(tree, 7);
  assert.equal(electrical.nodes[1]?.kind, 'BOARD');
  assert.equal(assets.assets[0].coverage.kind, 'UNMETERED');
  assert.deepEqual(metering.rows, []);
  assert.equal(mapping.schema, 'installation-mapping/v1');
  assert.equal(mapping.electricalNodes.find((node) => node.kind === 'BOARD')?.typeLabel, 'Main Switchboard');
  assert.deepEqual(mapping.channels[0], {
    id: 'channel-1',
    meterId: 'meter-1',
    ordinal: 1,
    phaseLabel: 'L1',
    purpose: 'SUB_CIRCUIT',
    loadTypeCode: 'HVAC',
    sensorRating: '120A',
    description: 'Compressor bank',
    capabilities: { current: true, voltage: false },
  });
  assert.equal(JSON.stringify(mapping).includes('candidateIds'), false);
  assert.equal(
    buildInstallationMappingExport(structuredClone(tree), 7).contentHash,
    mapping.contentHash,
  );
});

test('invalid IANA timezone is a deterministic export warning and eligibility fence', () => {
  const tree = baseTree();
  tree.installation.status = 'Completed';
  tree.installation.timezone = 'Australia/Definitely_Not_A_Zone';
  const readiness = installationReadiness(tree);
  assert.equal(readiness.readyToComplete, true);
  assert.equal(readiness.eligibility.authoritativeReport, false);
  assert.equal(readiness.eligibility.mappingExport, false);
  assert.ok(readiness.issues.some((issue) => issue.code === 'TIMEZONE_REQUIRED_FOR_EXPORT'));
});

test('all Draft forms block completion and invalid/future form states are rejected structurally', () => {
  const tree = baseTree();
  tree.formSubmissions = [{
    id: 'form-other',
    installationId: 'installation-1',
    formType: 'ace-switchboard',
    schemaVersion: 1,
    status: 'Draft',
    answers: {},
    attachments: [],
    historicalMeterRemoved: false,
  }];
  assert.ok(installationReadiness(tree).issues.some((issue) => (
    issue.code === 'FORM_INCOMPLETE' && issue.entityId === 'form-other'
  )));

  const invalidStatus = structuredClone(tree) as unknown as Record<string, unknown>;
  (invalidStatus.formSubmissions as Array<Record<string, unknown>>)[0].status = 'done';
  assert.throws(() => normalizeInstallationTreeV2(invalidStatus), CanonicalInputError);
  const futureSchema = structuredClone(tree) as unknown as Record<string, unknown>;
  (futureSchema.formSubmissions as Array<Record<string, unknown>>)[0].schemaVersion = 3;
  assert.throws(() => normalizeInstallationTreeV2(futureSchema), CanonicalInputError);
});

test('completed commissioning evidence survives explicit historical meter removal only', () => {
  const meter = a3Meter();
  const tree = baseTree();
  const historical = completedWwForm('form-historical', meter);
  historical.historicalMeterRemoved = true;
  tree.formSubmissions = [historical];
  assert.equal(installationReadiness(tree).issues.some((issue) => (
    issue.entityId === historical.id
    && (issue.code === 'FORM_CONTEXT_REQUIRED' || issue.code === 'METER_DEVICE_REQUIRED')
  )), false);

  historical.status = 'Draft';
  assert.ok(installationReadiness(tree).issues.some((issue) => (
    issue.entityId === historical.id
    && (issue.code === 'FORM_CONTEXT_REQUIRED' || issue.code === 'METER_DEVICE_REQUIRED')
  )));
});

test('custom labels are bounded before persistence', () => {
  const tree = baseTree() as unknown as Record<string, unknown>;
  const board = (tree.electricalAssets as Array<Record<string, unknown>>)[0];
  board.typeCode = 'OTHER';
  board.customTypeName = 'x'.repeat(121);
  assert.throws(() => normalizeInstallationTreeV2(tree), /at most 120 characters/);
});

test('only custom channels require explicit capabilities and A3/A6 ratings use pinned vocabularies', () => {
  const custom = baseTree();
  custom.electricalAssets[0].meterPresent = true;
  custom.meterDevices = [{
    ...a3Meter(),
    deviceModel: 'OTHER',
    customModelName: 'Custom meter',
    channels: [],
  }];
  assert.ok(installationReadiness(custom).issues.some((issue) => (
    issue.code === 'METER_CAPABILITY_REQUIRED'
    && issue.entityType === 'meter'
  )));

  const a3 = baseTree();
  const meter = a3Meter();
  meter.channels.forEach((item) => {
    item.capabilities = { current: true };
    item.sensorRating = '3000A - 9cm';
  });
  a3.electricalAssets[0].meterPresent = true;
  a3.meterDevices = [meter];
  a3.formSubmissions = [completedWwForm('form-1', meter)];
  assert.equal(
    installationReadiness(a3).issues.some((issue) => issue.code === 'SENSOR_RATING_INVALID'),
    false,
  );
  meter.channels[1].sensorRating = '120A';
  assert.ok(installationReadiness(a3).issues.some((issue) => (
    issue.code === 'SENSOR_RATING_INVALID' && issue.entityId === 'channel-2'
  )));
  meter.channels[1].capabilities = {};
  assert.equal(installationReadiness(a3).issues.some((issue) => (
    issue.code === 'METER_CAPABILITY_REQUIRED' && issue.entityId === 'channel-2'
  )), false);

  const customWithChannel = baseTree();
  customWithChannel.electricalAssets[0].meterPresent = true;
  customWithChannel.meterDevices = [{
    ...a3Meter(),
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    customManufacturerName: 'Example manufacturer',
    customModelName: 'Example model',
    channels: [{ ...channel(1), capabilities: {} }],
  }];
  assert.ok(installationReadiness(customWithChannel).issues.some((issue) => (
    issue.code === 'METER_CAPABILITY_REQUIRED' && issue.entityId === 'channel-1'
  )));
});

test('standard A3RM spare channels use model-defined capabilities', () => {
  const tree = baseTree();
  const meter = a3Meter();
  meter.channels = [channel(1, 'SPARE'), channel(2, 'SPARE'), channel(3, 'SPARE')];
  tree.electricalAssets[0].meterPresent = true;
  tree.meterDevices = [meter];
  tree.formSubmissions = [completedWwForm('form-1', meter)];
  assert.equal(installationReadiness(tree).issues.some((issue) => (
    issue.code === 'METER_CAPABILITY_REQUIRED'
  )), false);
});

test('main-supply assignments allow explicit TBC but cannot target a downstream board', () => {
  const draft = baseTree();
  const draftMeter = a3Meter();
  draftMeter.channels = [
    { ...channel(1, 'MAIN_SUPPLY'), sensorRating: '3000A - 9cm' },
    channel(2, 'SPARE'),
    channel(3, 'SPARE'),
  ];
  draft.electricalAssets[0].meterPresent = true;
  draft.meterDevices = [draftMeter];
  draft.measurementAssignments = [{
    id: 'assignment-main-tbc',
    installationId: draft.installation.id,
    meterId: draftMeter.id,
    channelIds: [draftMeter.channels[0].id],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  draft.formSubmissions = [completedWwForm('form-1', draftMeter)];
  const draftIssues = installationReadiness(draft).issues.filter(
    (issue) => issue.entityId === 'assignment-main-tbc',
  );
  assert.ok(draftIssues.some((issue) => issue.code === 'MEASUREMENT_TARGET_TBC'));
  assert.equal(
    draftIssues.some((issue) => issue.code === 'CHANNEL_PURPOSE_CONFLICT'),
    false,
  );

  const wrongBoard = structuredClone(draft);
  wrongBoard.electricalAssets.push({
    ...wrongBoard.electricalAssets[0],
    id: 'board-2',
    assetName: 'Child board',
    displayCode: display('ACME-DB-001'),
    typeCode: 'DB',
    electricalSource: { kind: 'BOARD', boardId: 'board-1' },
    meterPresent: false,
  });
  wrongBoard.measurementAssignments[0] = {
    ...wrongBoard.measurementAssignments[0],
    id: 'assignment-main-child-board',
    target: { kind: 'BOARD', boardId: 'board-2' },
    status: 'CONFIRMED',
  };
  assert.ok(installationReadiness(wrongBoard).issues.some((issue) => (
    issue.code === 'METER_BOARD_MISMATCH'
    && issue.entityId === 'assignment-main-child-board'
  )));

  const subCircuitAtInstalledBoard = structuredClone(draft);
  subCircuitAtInstalledBoard.meterDevices[0].channels[0] = {
    ...channel(1, 'SUB_CIRCUIT'),
    sensorRating: '3000A - 9cm',
  };
  subCircuitAtInstalledBoard.measurementAssignments[0] = {
    ...subCircuitAtInstalledBoard.measurementAssignments[0],
    id: 'assignment-subcircuit-installed-board',
    target: { kind: 'BOARD', boardId: 'board-1' },
    status: 'CONFIRMED',
  };
  assert.ok(installationReadiness(subCircuitAtInstalledBoard).issues.some((issue) => (
    issue.code === 'METER_BOARD_MISMATCH'
    && issue.entityId === 'assignment-subcircuit-installed-board'
  )));

  const unassignedActiveChannel = structuredClone(draft);
  unassignedActiveChannel.meterDevices[0].channels[1] = {
    ...channel(2, 'SUB_CIRCUIT'),
    sensorRating: '3000A - 9cm',
  };
  assert.ok(installationReadiness(unassignedActiveChannel).issues.some((issue) => (
    issue.code === 'CHANNEL_UNASSIGNED'
    && issue.entityId === 'channel-2'
  )));
});

test('high-card readiness and candidate search stay deterministically bounded and paginated', () => {
  const tree = baseTree();
  tree.siteAssets = [];
  tree.electricalAssets = Array.from({ length: 400 }, (_, index) => ({
    ...tree.electricalAssets[0],
    id: `board-${String(index).padStart(4, '0')}`,
    assetName: `Board ${index}`,
    displayCode: display('DUPLICATE-CODE'),
  }));
  const readiness = installationReadiness(tree);
  assert.ok(readiness.issues.length >= 400);
  assert.ok(readiness.issues.every((issue) => (issue.candidateIds?.length ?? 0) <= 50));
  const firstPage = paginateReadiness(readiness, { limit: 25 });
  assert.equal(firstPage.issues.length, 25);
  assert.equal(firstPage.issuePage.total, readiness.issues.length);
  assert.equal(firstPage.issuePage.nextOffset, 25);
  const secondPage = paginateReadiness(readiness, { offset: 25, limit: 25 });
  assert.notEqual(firstPage.issues[0].entityId, secondPage.issues[0].entityId);

  const candidates = searchCanonicalCandidates({
    tree,
    kind: 'board',
    query: 'Board 2',
    limit: 10,
  });
  assert.equal(candidates.items.length, 10);
  assert.ok(candidates.page.nextCursor);
  const nextCandidates = searchCanonicalCandidates({
    tree,
    kind: 'board',
    query: 'Board 2',
    cursor: candidates.page.nextCursor ?? undefined,
    limit: 10,
  });
  assert.ok(nextCandidates.items.every((item) => item.id > candidates.items.at(-1)!.id));

  const highCardinality = {
    ...readiness,
    issues: Array.from({ length: 10_001 }, (_, index) => ({
      code: index % 2 === 0 ? 'FORM_INCOMPLETE' as const : 'CUSTOM_TYPE_REQUIRED' as const,
      severity: 'ERROR' as const,
      entityType: index % 2 === 0 ? 'form' as const : 'site_asset' as const,
      entityId: `entity-${String(index).padStart(5, '0')}`,
      field: index % 2 === 0 ? 'status' : 'customTypeName',
      message: index % 2 === 0 ? `Needs completion ${index}` : `Needs custom label ${index}`,
    })),
  };
  const bounded = paginateReadiness(highCardinality, { limit: 10_001 });
  assert.equal(bounded.issues.length, 250);
  assert.equal(bounded.issuePage.total, 10_001);
  assert.equal(bounded.issuePage.nextOffset, 250);
  const searched = paginateReadiness(highCardinality, {
    q: 'custom_type_required',
    offset: 5_000,
    limit: 250,
  });
  assert.equal(searched.issuePage.total, 5_000);
  assert.equal(searched.issues.length, 0);
  assert.equal(searched.issuePage.nextOffset, null);
});

test('readiness paging filters the full result set by severity, type, and physical zone before slicing', () => {
  const tree = baseTree();
  const zoneEntityIds = readinessEntityIdsForZone(tree, 'zone-1');
  assert.ok(zoneEntityIds.has('board-1'));
  const base = installationReadiness(tree);
  const filtered = paginateReadiness({
    ...base,
    issues: [
      {
        code: 'FORM_INCOMPLETE', severity: 'ERROR', entityType: 'board', entityId: 'board-1',
        message: 'Zone-scoped blocking board issue.',
      },
      {
        code: 'SUPPLY_TBC', severity: 'WARNING', entityType: 'board', entityId: 'board-1',
        message: 'Wrong severity.',
      },
      {
        code: 'FORM_INCOMPLETE', severity: 'ERROR', entityType: 'site_asset', entityId: 'asset-outside-zone',
        message: 'Wrong type and zone.',
      },
    ],
  }, {
    severity: 'ERROR', entityType: 'board', entityIds: zoneEntityIds, limit: 1,
  });
  assert.deepEqual(filtered.issues.map((issue) => issue.entityId), ['board-1']);
  assert.equal(filtered.issuePage.total, 1);
  assert.equal(filtered.issuePage.nextOffset, null);
});

test('supply reconciliation candidates include Grid and exclude a board self and descendants', () => {
  const tree = baseTree();
  tree.electricalAssets.push({
    ...tree.electricalAssets[0],
    id: 'board-child',
    assetName: 'Child board',
    displayCode: display('ACME-DB-001'),
    typeCode: 'DB',
    electricalSource: { kind: 'BOARD', boardId: 'board-1' },
    meterPresent: false,
  });
  tree.electricalAssets[0].electricalSource = { kind: 'TBC' };
  const issue = installationReadiness(tree).issues.find((candidate) => (
    candidate.code === 'SUPPLY_TBC' && candidate.entityId === 'board-1'
  ));
  assert.ok(issue);
  assert.ok(issue.candidateIds?.includes('grid-1'));
  assert.equal(issue.candidateIds?.includes('board-1'), false);
  assert.equal(issue.candidateIds?.includes('board-child'), false);
});

test('blank immutable external key blocks completion', () => {
  const tree = baseTree();
  tree.installation.externalKey = '   ';
  const readiness = installationReadiness(tree);
  assert.equal(readiness.readyToComplete, false);
  assert.ok(readiness.issues.some((issue) => issue.code === 'EXTERNAL_KEY_REQUIRED'));
});

test('commissioned meter identity changes require an equivalent completed amendment', () => {
  const existing = baseTree();
  const oldMeter = a3Meter();
  existing.meterDevices = [oldMeter];
  existing.electricalAssets[0].meterPresent = true;
  existing.formSubmissions = [completedWwForm('form-1', oldMeter)];

  const incoming = structuredClone(existing);
  incoming.meterDevices[0].serialNumber = 'serial-new';
  assert.throws(
    () => assertCommissionedMetersRequireAmendment({ existing, incoming }),
    /WW_METER_AMENDMENT_REQUIRED:meter-1/,
  );

  const amendment = completedWwForm('form-2', incoming.meterDevices[0], 'form-1');
  assert.equal(wwCommissioningFormMatchesMeter(amendment, incoming.meterDevices[0]), true);
  incoming.formSubmissions.push(amendment);
  assert.doesNotThrow(() => assertCommissionedMetersRequireAmendment({ existing, incoming }));

  amendment.answers['device.id'] = 'wrong-serial';
  assert.throws(
    () => assertCommissionedMetersRequireAmendment({ existing, incoming }),
    /WW_METER_AMENDMENT_REQUIRED:meter-1/,
  );
});

test('snapshot manifest pins only exact currently referenced confirmed remote evidence', () => {
  const PHOTO_A = '11111111-1111-4111-8111-111111111111';
  const PHOTO_B = '22222222-2222-4222-8222-222222222222';
  const PHOTO_OLD = '33333333-3333-4333-8333-333333333333';
  type Photo = Parameters<typeof projectCanonicalMediaManifest>[1][number];
  const photo = (id: string, entityId: string, fieldName: string): Photo => ({
    id,
    checksum: `checksum-${id}`,
    remoteUrl: `https://api.example.test/photos/${id}`,
    onedriveItemId: null,
    storageKey: `installhub/photos/${id}.jpg`,
    contentType: 'image/jpeg',
    originalFilename: `${id}.jpg`,
    app: 'installhub',
    parentId: 'installation-1',
    entityType: 'zone',
    entityId,
    fieldName,
    fileSizeBytes: 123,
    status: 'confirmed',
    baseTreeRevision: null,
    confirmedTreeRevision: null,
    uploadedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const photos = [
    photo(PHOTO_A, 'zone-1', 'photos[0]'),
    photo(PHOTO_B, 'asset-1', 'locationPhoto'),
    photo(PHOTO_OLD, 'zone-1', 'photos[1]'),
  ];
  const historical = baseTree();
  historical.zones[0].photos = [
    `https://api.example.test/photos/${PHOTO_A}`,
    `https://api.example.test/photos/${PHOTO_OLD}`,
  ];
  historical.siteAssets[0].locationPhoto = `file:///temporary/${PHOTO_B}.jpg`;
  assert.deepEqual(
    projectCanonicalMediaManifest(historical, photos).map((item) => item.id),
    [PHOTO_A, PHOTO_OLD],
  );

  const current = structuredClone(historical);
  current.zones[0].photos = [`https://api.example.test/photos/${PHOTO_A}`];
  assert.deepEqual(
    projectCanonicalMediaManifest(current, photos).map((item) => item.id),
    [PHOTO_A],
  );
});

test('historical snapshot pins rendered labels, versions, readiness, and artifact bytes', () => {
  const tree = baseTree();
  tree.installation.status = 'Completed';
  tree.installation.recordVersionNumber = 9;
  tree.installation.completedAt = '2026-08-01T03:00:00.000Z';
  const snapshot = buildCanonicalSnapshotPayload({ tree, mediaManifest: [] });
  const before = JSON.stringify(snapshot);
  tree.electricalAssets[0].assetName = 'Mutated after completion';
  tree.installation.timezone = 'Invalid/Timezone';

  assert.equal(snapshot.controlledLabelCatalog.boards.MSSB, 'Main Sub-Switchboard');
  assert.equal(snapshot.displayCodeRuleVersion, 1);
  assert.equal(snapshot.virtualMeterFormulaVersion, 1);
  assert.equal(snapshot.viewArtifacts.mapping.installation.recordVersionNumber, 9);
  assert.equal(
    snapshot.viewArtifacts.electricalTree.nodes.find((node) => node.kind === 'BOARD')?.name,
    'Main board',
  );
  assert.equal(snapshot.readiness.eligibility.mappingExport, true);
  assert.equal(JSON.stringify(snapshot), before);
});

test('canonical snapshot hash and evidence fields ignore input array order', () => {
  const photoA = '11111111-1111-4111-8111-111111111111';
  const photoB = '22222222-2222-4222-8222-222222222222';
  const firstTree = baseTree();
  firstTree.installation.recordVersionNumber = 1;
  firstTree.zones[0].photos = [
    `https://files.example.test/${photoB}`,
    `https://files.example.test/${photoA}`,
  ];
  type Manifest = Parameters<typeof buildCanonicalSnapshotPayload>[0]['mediaManifest'];
  const firstManifest: Manifest = [
    {
      id: photoB,
      checksum: 'checksum-b',
      entityType: 'zone',
      entityId: 'zone-1',
      fieldName: 'photos[0]',
      contentType: 'image/jpeg',
      fileSizeBytes: 200,
    },
    {
      id: photoA,
      checksum: 'checksum-a',
      entityType: 'zone',
      entityId: 'zone-1',
      fieldName: 'photos[1]',
      contentType: 'image/jpeg',
      fileSizeBytes: 100,
    },
  ];
  const secondTree = structuredClone(firstTree);
  secondTree.zones[0].photos.reverse();
  const secondManifest: Manifest = [
    { ...firstManifest[1], fieldName: 'photos[0]' },
    { ...firstManifest[0], fieldName: 'photos[1]' },
  ];
  const first = buildCanonicalSnapshotPayload({ tree: firstTree, mediaManifest: firstManifest });
  const second = buildCanonicalSnapshotPayload({ tree: secondTree, mediaManifest: secondManifest });
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.mediaManifest.map((item) => [item.id, item.fieldName]), [
    [photoA, 'photos[0]'],
    [photoB, 'photos[1]'],
  ]);
  assert.match(first.installationTree.zones[0].photos[0], /^urn:installhub:photo:/);
  assert.equal(JSON.stringify(first).includes('https://files.example.test'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(first.installationTree, 'baseTreeRevision'),
    false,
  );
  const storedShape = JSON.parse(JSON.stringify(first)) as typeof first;
  assert.equal(canonicalSnapshotPayloadHashMatches(storedShape), true);

  const { payloadHash: _payloadHash, ...storedWithoutHash } = storedShape;
  const legacyWithoutHash = {
    ...storedWithoutHash,
    canonicalizerVersion: 'installation-canonical-v2.1',
    installationTree: {
      ...storedWithoutHash.installationTree,
      baseTreeRevision: undefined,
    },
  };
  const legacySnapshot = {
    ...storedShape,
    canonicalizerVersion: 'installation-canonical-v2.1',
    payloadHash: canonicalPayloadHash(legacyWithoutHash),
  };
  const legacyBeforeVerification = JSON.stringify(legacySnapshot);
  assert.equal(canonicalSnapshotPayloadHashMatches(legacySnapshot), true);
  assert.equal(
    canonicalSnapshotContentHash(legacySnapshot),
    canonicalSnapshotContentHash(storedShape),
  );
  assert.equal(JSON.stringify(legacySnapshot), legacyBeforeVerification);
  assert.equal(storedShape.canonicalizerVersion, 'installation-canonical-v2.2');
});
