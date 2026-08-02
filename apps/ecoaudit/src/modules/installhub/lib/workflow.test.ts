import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TREE_SYNC_STAGE,
  FORM_COMPLETION_SYNC_STAGE,
  authoritativeReportProvenanceFromVersion,
  deleteInstallationMeter,
  findRecordVersionContainingForms,
  getInstallationReadiness,
  getLatestExportJob,
  matchesInstallHubReportProvenance,
  requireRecordVersionNumber,
  startFormPdfJob,
  startInstallationPdfJob,
} from '@/modules/installhub/api/installhub';
import {
  deferTreeNavigationPrompt,
  focusWorkflowErrorTarget,
  guardedTreeAnchorHref,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';
import {
  mergeRecoveredNonMediaTree,
  executeInstallationTreeRetry,
  localReadinessPage,
  pendingInstallationDraft,
  pendingTreeWithoutMedia,
  planInstallationDraftRecovery,
  shouldRestoreInstallationDraft,
  submitAndConfirmInstallationTree,
  treeWriteFailurePhase,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  createBoard,
  clearInstallationCreateAttempt,
  createInstallationTree,
  createSiteAsset,
  createZone,
  installationCreateFailureDisposition,
  installationCreateAttempt,
  installationCreateAttemptSessionKey,
  persistInstallationCreateAttempt,
  restoreInstallationCreateAttempt,
} from '@/modules/installhub/lib/model';
import type {
  FormSubmission,
  InstallationTree,
  InstallationVersionRecord,
  InstallHubUser,
  MeasurementAssignment,
  Meter,
} from '@/modules/installhub/types/domain';
import {
  applyAuthoritativeTreeRevision,
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  boardTypeCode,
  coverageState,
  displayCodeMetadata,
  ensureCanonicalTree,
  generatedDisplayCode,
  installationDisplayCodePrefix,
  localMappingExport,
  localReadiness,
  meterDependencyPreview,
  meterEditorHasChanges,
  meterBoardsForAsset,
  primaryGridSupply,
  reconcileRemovedMeter,
  reachableGridSuppliesForBoard,
  replaceMeterAssignments,
  serializeInstallationTree,
  setAssetMetering,
  siteAssetMeteringState,
  siteAssetTypeCode,
  siteAssetTypeLabel,
  syncMeterDevice,
  validBoardParents,
} from './workflow';

test('historical site codes use the shared bounded display-code prefix', () => {
  assert.equal(installationDisplayCodePrefix('Legacy Site Code / 2024'), 'LEGACY-SITE-CODE');
  assert.equal(installationDisplayCodePrefix('---'), 'SITE');
  assert.equal(installationDisplayCodePrefix('123456789012345-678'), '123456789012345');
});

const user: InstallHubUser = {
  id: 'user-1',
  email: 'installer@example.com',
  fullName: 'Installer One',
  role: 'admin',
};

function fixtureTree(): InstallationTree {
  const tree = createInstallationTree({
    clientName: 'Client',
    siteName: 'Golden Site',
    siteAddress: '1 Test Street',
    inspectorName: 'Installer One',
    auditDate: '2026-08-01',
    siteCode: 'GOLD',
    timezone: 'Australia/Sydney',
  }, user);
  tree.installation.id = 'installation-golden';
  tree.installation.externalKey = 'external-installation-golden';
  tree.baseTreeRevision = 4;
  tree.treeRevision = 4;
  tree.gridSupplies = [
    {
      id: 'grid-b',
      installationId: tree.installation.id,
      name: 'Secondary Grid',
      isDefault: true,
    },
    {
      id: 'grid-a',
      installationId: tree.installation.id,
      name: 'Primary Grid',
      isDefault: true,
    },
  ];
  const zoneA = createZone(tree.installation.id, { zoneName: 'Plant', zoneDescription: '' });
  zoneA.id = 'zone-a';
  const zoneB = createZone(tree.installation.id, { zoneName: 'Roof', zoneDescription: '' });
  zoneB.id = 'zone-b';
  const boardA = createBoard(tree.installation.id, zoneA.id);
  boardA.id = 'board-a';
  boardA.assetName = 'Main board';
  boardA.assetType = 'MS8' as typeof boardA.assetType;
  boardA.typeCode = undefined;
  boardA.displayCode = '';
  applyBoardElectricalSource(boardA, { kind: 'GRID', gridSupplyId: 'grid-a' });
  const boardB = createBoard(tree.installation.id, zoneB.id);
  boardB.id = 'board-b';
  boardB.assetName = 'Lighting board';
  boardB.assetType = 'Main Sub-Switchboard' as typeof boardB.assetType;
  boardB.typeCode = undefined;
  boardB.displayCode = '';
  applyBoardElectricalSource(boardB, { kind: 'BOARD', boardId: boardA.id });
  const asset = createSiteAsset(tree.installation.id, zoneB.id);
  asset.id = 'asset-a';
  asset.assetName = 'Warehouse lights';
  asset.assetType = 'Lightning' as typeof asset.assetType;
  asset.typeCode = undefined;
  asset.displayCode = '';
  applyAssetElectricalSource(asset, { kind: 'BOARD', boardId: boardB.id });
  asset.meteringState = { kind: 'TBC' };
  tree.zones = [zoneA, zoneB];
  tree.electricalAssets = [boardA, boardB];
  tree.siteAssets = [asset];
  return ensureCanonicalTree(tree);
}

function sixChannelMeter(): Meter {
  return {
    id: 'meter-a',
    deviceName: '',
    deviceNameOverridden: false,
    deviceFamily: 'WATTWATCHERS',
    deviceType: 'A6M',
    deviceId: 'SERIAL-A6M',
    wwChannels: Array.from({ length: 6 }, (_, index) => ({
      id: `meter-a:${index + 1}`,
      ordinal: index + 1,
      phaseLabel: `L${(index % 3) + 1}`,
      purpose: index < 3 ? 'MAIN_SUPPLY' : 'SUB_CIRCUIT',
      loadType: index < 3 ? 'Mains Supply' : 'Lighting',
      capabilities: { waveform: index === 0 },
    })),
    wwPhotos: { deviceInstalled: '/v1/photos/meter-a' },
  };
}

test('authoritative upload revisions advance every portal CAS field together', () => {
  const tree = fixtureTree();
  assert.equal(applyAuthoritativeTreeRevision(tree, 9), 9);
  assert.equal(tree.baseTreeRevision, 9);
  assert.equal(tree.treeRevision, 9);
  assert.equal(tree.installation.treeRevision, 9);
  assert.throws(
    () => applyAuthoritativeTreeRevision(tree, undefined),
    /authoritative installation revision/,
  );
});

test('portal canonicalization mirrors the golden v2 wire shape and legacy taxonomy aliases', () => {
  const tree = fixtureTree();
  assert.equal(tree.treeSchemaVersion, 2);
  assert.equal(primaryGridSupply(tree).id, 'grid-a');
  assert.equal(tree.gridSupplies?.filter((supply) => supply.isDefault).length, 1);
  assert.equal(boardTypeCode(tree.electricalAssets[0]), 'MSB');
  assert.equal(boardTypeCode(tree.electricalAssets[1]), 'MSSB');
  assert.equal(siteAssetTypeCode(tree.siteAssets[0]), 'LIGHTING');

  const custom = { ...tree.siteAssets[0], typeCode: undefined, assetType: 'Refrigeration' as typeof tree.siteAssets[0]['assetType'], customTypeName: null };
  tree.siteAssets.push(custom);
  ensureCanonicalTree(tree);
  assert.equal(siteAssetTypeCode(custom), 'OTHER');
  assert.equal(siteAssetTypeLabel(custom), 'Refrigeration');

  const wire = serializeInstallationTree(tree);
  assert.equal(wire.treeSchemaVersion, 2);
  assert.ok(Array.isArray(wire.gridSupplies));
  assert.ok(Array.isArray(wire.meterDevices));
  assert.ok(Array.isArray(wire.measurementAssignments));
  assert.equal(typeof (wire.electricalAssets as Array<Record<string, unknown>>)[0].displayCode, 'object');
});

test('fresh portal creation serializes the complete canonical-v2 installation handshake', () => {
  const tree = createInstallationTree({
    clientName: 'Fresh Client',
    siteName: 'Fresh Site',
    siteAddress: '1 New Road',
    inspectorName: 'Installer One',
    auditDate: '2026-08-02',
    siteCode: 'fresh-1',
    timezone: 'Australia/Sydney',
  }, user);
  const wire = serializeInstallationTree(tree);
  const installation = wire.installation as Record<string, unknown>;

  assert.equal(wire.treeSchemaVersion, 2);
  assert.equal(wire.baseTreeRevision, 0);
  assert.equal(installation.treeSchemaVersion, 2);
  assert.equal(installation.treeRevision, 0);
  assert.equal(installation.recordVersionNumber, 0);
  assert.equal(installation.externalKey, null);
  assert.equal(installation.siteCode, 'FRESH-1');
});

test('fresh portal create keeps one exact installation snapshot across an ambiguous retry', async () => {
  const input = {
    clientName: 'Fresh Client',
    siteName: 'Fresh Site',
    siteAddress: '1 New Road',
    inspectorName: 'Installer One',
    auditDate: '2026-08-02',
    siteCode: 'FRESH-1',
    timezone: 'Australia/Sydney',
  };
  const first = installationCreateAttempt(null, input, user);
  const firstWire = JSON.stringify(serializeInstallationTree(first));
  await assert.rejects(
    submitAndConfirmInstallationTree(first.installation.id, first, 'metadata', {
      save: async () => { throw new Error('response lost after submit'); },
      get: async () => { assert.fail('A failed submit response cannot begin confirmation.'); },
    }),
    /response lost/,
  );

  const retry = installationCreateAttempt(first, {
    ...input,
    siteName: 'A changed field must not allocate a duplicate ID',
  }, user);
  assert.strictEqual(retry, first);
  assert.equal(retry.installation.id, first.installation.id);
  assert.equal(JSON.stringify(serializeInstallationTree(retry)), firstWire);

  let saves = 0;
  let pulls = 0;
  const unconfirmed = await submitAndConfirmInstallationTree(
    retry.installation.id,
    retry,
    'metadata',
    {
      save: async () => {
        saves += 1;
        return {
          installationId: retry.installation.id,
          treeRevision: 1,
          versionNumber: null,
        };
      },
      get: async () => {
        pulls += 1;
        throw new Error('confirmation pull unavailable');
      },
    },
  );
  assert.equal(unconfirmed.kind, 'SAVED_UNCONFIRMED');
  assert.equal(saves, 1);
  assert.equal(pulls, 1);
});

test('fresh portal create survives only a valid same-tab retry owned by the signed-in user', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const tree = createInstallationTree({
    clientName: 'Fresh Client',
    siteName: 'Fresh Site',
    siteAddress: '1 New Road',
    inspectorName: 'Installer One',
    auditDate: '2026-08-02',
    siteCode: 'FRESH-1',
    timezone: 'Australia/Sydney',
  }, user);

  assert.equal(persistInstallationCreateAttempt(tree, user.id, storage), true);
  const storageKey = installationCreateAttemptSessionKey(user.id);
  const encoded = values.get(storageKey);
  assert.ok(encoded);
  const restored = restoreInstallationCreateAttempt(user.id, storage);
  assert.deepEqual(restored, tree);
  assert.notStrictEqual(restored, tree);

  assert.equal(restoreInstallationCreateAttempt('another-user', storage), null);
  assert.equal(values.has(storageKey), true);

  assert.equal(persistInstallationCreateAttempt(tree, user.id, storage), true);
  assert.equal(clearInstallationCreateAttempt(user.id, tree.installation.id, storage), true);
  assert.equal(values.has(storageKey), false);
});

test('fresh portal create fails closed when tab storage is invalid or unavailable', () => {
  const values = new Map<string, string>([[
    installationCreateAttemptSessionKey(user.id),
    '{not valid json',
  ]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(restoreInstallationCreateAttempt(user.id, storage), null);
  assert.equal(values.has(installationCreateAttemptSessionKey(user.id)), false);

  const tree = createInstallationTree({
    clientName: 'Fresh Client',
    siteName: 'Fresh Site',
    siteAddress: '1 New Road',
    inspectorName: 'Installer One',
    auditDate: '2026-08-02',
    timezone: 'Australia/Sydney',
  }, user);
  assert.equal(persistInstallationCreateAttempt(tree, user.id, {
    getItem: () => null,
    setItem: () => { throw new Error('quota unavailable'); },
    removeItem: () => undefined,
  }), false);
});

test('stale create cleanup cannot remove a newer same-owner installation attempt', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const tree = createInstallationTree({
    clientName: 'Fresh Client',
    siteName: 'Fresh Site',
    siteAddress: '1 New Road',
    inspectorName: 'Installer One',
    auditDate: '2026-08-02',
    timezone: 'Australia/Sydney',
  }, user);
  assert.equal(persistInstallationCreateAttempt(tree, user.id, storage), true);
  assert.equal(
    clearInstallationCreateAttempt(user.id, 'an-older-installation-id', storage),
    false,
  );
  assert.deepEqual(restoreInstallationCreateAttempt(user.id, storage), tree);
  assert.equal(clearInstallationCreateAttempt(user.id, tree.installation.id, storage), true);
  assert.equal(restoreInstallationCreateAttempt(user.id, storage), null);
});

test('fresh portal create retains every automatic failure until explicit reconciliation or discard', () => {
  assert.equal(installationCreateFailureDisposition(null), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(0), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(408), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(500), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(503), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(409), 'RECONCILE');
  assert.equal(installationCreateFailureDisposition(400), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(401), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(404), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(422), 'RETAIN');
  assert.equal(installationCreateFailureDisposition(429), 'RETAIN');
});

test('generated display codes retain underscores, refresh only while provisional, and stay stable once confirmed', () => {
  const tree = fixtureTree();
  const generated = generatedDisplayCode(tree, 'HVAC_DB', 'new-board');
  assert.match(generated, /^GOLD-HVAC_DB-\d{3}$/);
  const initial = displayCodeMetadata(tree, 'DB', '', undefined, 'new-board');
  const changed = displayCodeMetadata(tree, 'PV_DB', initial.value, initial, 'new-board');
  assert.equal(changed.value, initial.value);
  assert.equal(changed.generatedValue, initial.generatedValue);
  const provisionalChanged = displayCodeMetadata(tree, 'PV_DB', initial.value, initial, 'new-board', true);
  assert.match(provisionalChanged.value, /^GOLD-PV_DB-\d{3}$/);
  const overridden = displayCodeMetadata(tree, 'PV_DB', 'CUSTOM-1', {
    ...initial,
    value: 'CUSTOM-1',
    isOverridden: true,
  }, 'new-board');
  assert.equal(overridden.value, 'CUSTOM-1');
  assert.equal(overridden.generatedValue, initial.generatedValue);

  tree.installation.siteCode = 'RENAMED';
  const afterSiteChange = displayCodeMetadata(tree, 'PV_DB', changed.value, changed, 'new-board');
  assert.equal(afterSiteChange.value, initial.value);
  assert.equal(afterSiteChange.generatedValue, initial.generatedValue);
});

test('cross-zone parent candidates are deterministic and never include cycles', () => {
  const tree = fixtureTree();
  const candidates = validBoardParents(tree, 'board-a');
  assert.equal(candidates.some((board) => board.id === 'board-b'), false);
  assert.deepEqual(validBoardParents(tree, 'board-b').map((board) => board.id), ['board-a']);
});

test('legacy ambiguous metering remains TBC and direct-Grid assets receive no inferred meter board', () => {
  const tree = fixtureTree();
  const asset = tree.siteAssets[0];
  asset.meteringState = undefined;
  asset.meterPresent = false;
  asset.meterId = null;
  asset.meterChannelIds = [];
  asset.meterChannels = [];
  asset.meterSwitchboardId = null;
  asset.meterSwitchboardTbc = false;
  assert.deepEqual(siteAssetMeteringState(asset), { kind: 'TBC' });
  applyAssetElectricalSource(asset, { kind: 'GRID', gridSupplyId: 'grid-a' });
  assert.deepEqual(meterBoardsForAsset(tree, asset), []);
});

test('exact meter groups accept explicit main TBC and constrain confirmed board totals to the installed board', () => {
  const tree = fixtureTree();
  const meter = sixChannelMeter();
  tree.electricalAssets[0].meters = [meter];
  tree.electricalAssets[0].meterPresent = true;
  syncMeterDevice(tree, 'board-a', meter);
  const canonicalMeter = tree.meterDevices?.find((item) => item.id === meter.id);
  assert.deepEqual(
    canonicalMeter?.channels.map((channel) => channel.loadTypeCode),
    [null, null, null, 'LIGHTING', 'LIGHTING', 'LIGHTING'],
  );
  assert.equal(tree.measurementAssignments?.length, 0);
  const unassignedChannels = localReadiness(tree).issues.filter((item) => item.code === 'CHANNEL_UNASSIGNED');
  assert.equal(unassignedChannels.length, 6);
  assert.equal(unassignedChannels[0].field, 'measurementAssignments');
  assert.equal(unassignedChannels[0].message, 'Every non-spare meter channel must belong to exactly one measurement assignment.');

  const main: MeasurementAssignment = {
    id: 'assignment-main',
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: ['meter-a:1', 'meter-a:2', 'meter-a:3'],
    phaseMode: 'THREE_PHASE',
    target: { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid-a' },
    direction: 'BIDIRECTIONAL',
    status: 'CONFIRMED',
  };
  const sub: MeasurementAssignment = {
    id: 'assignment-sub',
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: ['meter-a:4', 'meter-a:5', 'meter-a:6'],
    phaseMode: 'THREE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-a' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  };
  const beforeDuplicateAttempt = structuredClone(tree.measurementAssignments || []);
  assert.throws(() => replaceMeterAssignments(tree, meter.id, [{
    ...sub,
    id: 'assignment-duplicate-a',
    channelIds: ['meter-a:4'],
    phaseMode: 'SINGLE_PHASE',
  }, {
    ...sub,
    id: 'assignment-duplicate-b',
    channelIds: ['meter-a:5'],
    phaseMode: 'SINGLE_PHASE',
  }]), /only one active measurement assignment/);
  assert.deepEqual(tree.measurementAssignments || [], beforeDuplicateAttempt);
  replaceMeterAssignments(tree, meter.id, [main, sub]);
  assert.deepEqual(
    tree.measurementAssignments?.map((assignment) => assignment.installationId),
    [tree.installation.id, tree.installation.id],
  );
  assert.equal(localReadiness(tree).issues.some((item) => item.code === 'CHANNEL_UNASSIGNED'), false);
  assert.deepEqual(tree.siteAssets[0].meteringState, {
    kind: 'METERED',
    measurementAssignmentIds: ['assignment-sub'],
  });
  assert.doesNotThrow(() => replaceMeterAssignments(tree, meter.id, [{
    ...main,
    target: { kind: 'TBC' },
    status: 'TBC',
  }]));
  assert.throws(() => replaceMeterAssignments(tree, meter.id, [{
    ...main,
    target: { kind: 'BOARD', boardId: 'board-b' },
  }]), /switchboard where this meter is installed/);
  assert.doesNotThrow(() => replaceMeterAssignments(tree, meter.id, [{
    ...main,
    target: { kind: 'BOARD', boardId: 'board-a' },
  }]));
  assert.throws(() => replaceMeterAssignments(tree, meter.id, [{
    ...sub,
    target: { kind: 'BOARD', boardId: 'board-a' },
  }]), /downstream switchboard or site asset/);
  assert.doesNotThrow(() => replaceMeterAssignments(tree, meter.id, [{
    ...sub,
    target: { kind: 'BOARD', boardId: 'board-b' },
  }]));
  tree.gridSupplies!.push({
    id: 'grid-unreachable',
    installationId: tree.installation.id,
    name: 'Unreachable Grid',
    isDefault: false,
  });
  assert.deepEqual(reachableGridSuppliesForBoard(tree, 'board-a').map((supply) => supply.id), ['grid-a']);
  assert.throws(() => replaceMeterAssignments(tree, meter.id, [{
    ...main,
    target: { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid-unreachable' },
  }]), /reachable upstream/);
  assert.throws(() => setAssetMetering(tree, tree.siteAssets[0], {
    kind: 'METERED',
    meterId: meter.id,
    channelIds: ['meter-a:1'],
    phaseMode: 'SINGLE_PHASE',
    direction: 'CONSUMPTION',
  }), /spare, unavailable, or belongs/);
});

test('meter assignment replacement rejects a silent cross-meter asset remap atomically', () => {
  const tree = fixtureTree();
  const meterA = sixChannelMeter();
  const meterB: Meter = {
    ...structuredClone(meterA),
    id: 'meter-b',
    deviceId: 'SERIAL-B',
    wwChannels: (meterA.wwChannels || []).map((channel, index) => ({
      ...channel,
      id: `meter-b:${index + 1}`,
    })),
  };
  tree.electricalAssets[0].meters = [meterA];
  tree.electricalAssets[0].meterPresent = true;
  tree.electricalAssets[1].meters = [meterB];
  tree.electricalAssets[1].meterPresent = true;
  syncMeterDevice(tree, 'board-a', meterA);
  syncMeterDevice(tree, 'board-b', meterB);
  replaceMeterAssignments(tree, meterA.id, [{
    id: 'assignment-owner',
    installationId: tree.installation.id,
    meterId: meterA.id,
    channelIds: ['meter-a:4'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-a' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }]);
  const before = structuredClone({
    assignments: tree.measurementAssignments,
    asset: tree.siteAssets[0],
  });
  assert.throws(() => replaceMeterAssignments(tree, meterB.id, [{
    id: 'assignment-takeover',
    installationId: tree.installation.id,
    meterId: meterB.id,
    channelIds: ['meter-b:4'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-a' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }]), /already measured by another meter/);
  assert.deepEqual({
    assignments: tree.measurementAssignments,
    asset: tree.siteAssets[0],
  }, before);
});

test('local readiness zone filtering includes both meter and measured-target zones', () => {
  const tree = fixtureTree();
  const meter = sixChannelMeter();
  tree.electricalAssets[0].meters = [meter];
  tree.electricalAssets[0].meterPresent = true;
  syncMeterDevice(tree, 'board-a', meter);
  tree.measurementAssignments = [{
    id: 'assignment-cross-zone',
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: ['meter-a:4'],
    phaseMode: 'THREE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-a' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  const zoneA = localReadinessPage(tree, { zoneId: 'zone-a', entityType: 'measurement_assignment' });
  const zoneB = localReadinessPage(tree, { zoneId: 'zone-b', entityType: 'measurement_assignment' });
  assert.ok(zoneA.issues.some((issue) => issue.entityId === 'assignment-cross-zone'));
  assert.ok(zoneB.issues.some((issue) => issue.entityId === 'assignment-cross-zone'));
});

test('shared residual coverage may identify several unmetered descendants without numeric allocation', () => {
  const tree = fixtureTree();
  const asset = tree.siteAssets[0];
  asset.meteringState = { kind: 'UNMETERED' };
  applyAssetElectricalSource(asset, { kind: 'GRID', gridSupplyId: 'grid-a' });
  tree.serverDerived = {
    virtualMeterDefinitions: [{
      id: 'virtual-grid',
      parentNodeId: 'grid-a',
      totalMeasurementAssignmentId: 'assignment-main',
      subtractAssignmentIds: [],
      formulaVersion: 1,
      allocation: 'UNALLOCATED_RESIDUAL',
    }],
  };
  assert.equal(coverageState(tree, asset), 'VIRTUAL');
  const sibling = createSiteAsset(tree.installation.id, 'zone-a');
  sibling.id = 'asset-grid-sibling';
  sibling.assetName = 'Grid sibling';
  sibling.meteringState = { kind: 'UNMETERED' };
  applyAssetElectricalSource(sibling, { kind: 'GRID', gridSupplyId: 'grid-a' });
  tree.siteAssets.push(sibling);
  assert.equal(coverageState(tree, asset), 'VIRTUAL');
  assert.equal(coverageState(tree, sibling), 'VIRTUAL');
  applyAssetElectricalSource(asset, { kind: 'BOARD', boardId: 'board-b' });
  assert.equal(coverageState(tree, asset), 'VIRTUAL');
});

test('local readiness and mapping remain explicitly advisory and missing external keys block local consistency', () => {
  const tree = fixtureTree();
  tree.installation.externalKey = null;
  const readiness = localReadiness(tree);
  assert.equal(readiness.authority, 'LOCAL_ADVISORY');
  assert.equal(readiness.readyToComplete, false);
  assert.equal(readiness.eligibility.mappingExport, false);
  assert.ok(readiness.issues.some((issue) => issue.code === 'EXTERNAL_KEY_REQUIRED'));
  const mapping = localMappingExport(tree);
  assert.equal(mapping.authority, 'LOCAL_ADVISORY');
  assert.equal(mapping.installation.externalKey, '');
});

test('custom meters require explicit channels, positive ordinals, and non-empty capabilities', () => {
  const tree = fixtureTree();
  tree.meterDevices = [{
    id: 'custom-meter',
    installationId: tree.installation.id,
    installedOnBoardId: 'board-a',
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    customManufacturerName: 'Custom Maker',
    customModelName: 'C-1',
    displayName: {
      value: 'GOLD-OTHER-001',
      generatedValue: 'GOLD-OTHER-001',
      isOverridden: false,
      ruleVersion: 1,
    },
    serialNumber: 'CUSTOM-1',
    channels: [],
  }];
  let readiness = localReadiness(tree);
  assert.ok(readiness.issues.some((issue) => issue.code === 'METER_CAPABILITY_REQUIRED' && issue.field === 'channels'));
  tree.meterDevices[0].channels = [{
    id: 'custom-channel-1',
    ordinal: 1,
    purpose: 'SPARE',
    capabilities: {},
  }];
  readiness = localReadiness(tree);
  assert.ok(readiness.issues.some((issue) => issue.code === 'METER_CAPABILITY_REQUIRED' && issue.field === 'capabilities'));
  tree.meterDevices[0].channels[0].capabilities = { currentRange: '0-600A' };
  readiness = localReadiness(tree);
  assert.equal(readiness.issues.some((issue) => issue.code === 'METER_CAPABILITY_REQUIRED'), false);
});

test('same-tab recovery strips all media and only overlays a draft when the server revision is unchanged', () => {
  const draftTree = fixtureTree();
  draftTree.zones[0].photos = ['/v1/photos/zone'];
  draftTree.electricalAssets[0].photo = '/v1/photos/board';
  draftTree.electricalAssets[0].extraPhotos = ['/v1/photos/board-extra'];
  draftTree.siteAssets[0].locationPhoto = '/v1/photos/asset';
  draftTree.siteAssets[0].extraPhotos = ['/v1/photos/asset-extra'];
  draftTree.formSubmissions = [{
    id: 'form-a',
    installationId: draftTree.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Draft',
    answers: {},
    attachments: [{
      id: 'attachment-a',
      slot: 'photo',
      uri: '/v1/photos/form',
      mimeType: 'image/jpeg',
      capturedAt: '2026-08-01T00:00:00.000Z',
    }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }];
  const meter = sixChannelMeter();
  draftTree.electricalAssets[0].meters = [meter];
  syncMeterDevice(draftTree, 'board-a', meter);
  draftTree.installation.siteName = 'Unsent site name';
  const redacted = pendingTreeWithoutMedia(draftTree);
  assert.deepEqual(redacted.zones[0].photos, []);
  assert.equal(redacted.electricalAssets[0].photo, null);
  assert.deepEqual(redacted.electricalAssets[0].extraPhotos, []);
  assert.equal(redacted.meterDevices?.[0].wwPhotos, undefined);
  assert.deepEqual(redacted.formSubmissions[0].attachments, []);

  const server = fixtureTree();
  server.installation.siteName = 'Server site name';
  server.zones[0].photos = ['/v1/photos/server-zone'];
  const draft = pendingInstallationDraft(server.installation.id, draftTree, '2026-08-01T00:00:00.000Z');
  const recovery = planInstallationDraftRecovery(server, draft);
  assert.equal(recovery.kind, 'RESTORE');
  if (recovery.kind === 'RESTORE') {
    assert.equal(recovery.tree.installation.siteName, 'Unsent site name');
    assert.deepEqual(recovery.tree.zones[0].photos, ['/v1/photos/server-zone']);
    assert.equal(recovery.tree.baseTreeRevision, 4);
  }
  assert.equal(shouldRestoreInstallationDraft('reload'), true);
  assert.equal(shouldRestoreInstallationDraft('navigate'), false);
  assert.equal(shouldRestoreInstallationDraft('back_forward'), false);
});

test('reload after a mobile save and 409 retry preserve newer server non-media fields', () => {
  const stale = fixtureTree();
  stale.installation.siteName = 'Older tab draft';
  stale.treeRevision = 7;
  stale.baseTreeRevision = 7;
  const draft = pendingInstallationDraft(stale.installation.id, stale);
  const newerServer = fixtureTree();
  newerServer.installation.siteName = 'Mobile save wins';
  newerServer.installation.siteAddress = '2 New Server Street';
  newerServer.treeRevision = 8;
  newerServer.baseTreeRevision = 8;
  const recovery = planInstallationDraftRecovery(newerServer, draft);
  assert.equal(recovery.kind, 'CONFLICT');
  if (recovery.kind === 'CONFLICT') {
    assert.equal(recovery.server.installation.siteName, 'Mobile save wins');
    assert.equal(recovery.server.installation.siteAddress, '2 New Server Street');
    assert.equal(recovery.draft.baseRevision, 7);
  }
  assert.throws(() => mergeRecoveredNonMediaTree(newerServer, stale), /newer server revision/);
  assert.equal(treeWriteFailurePhase(409), 'conflict');
  assert.equal(treeWriteFailurePhase(503), 'failed');
});

test('ordinary writes default to metadata and meter removal omits active canonical and nested records', () => {
  assert.equal(DEFAULT_TREE_SYNC_STAGE, 'metadata');
  const tree = fixtureTree();
  const meter = sixChannelMeter();
  tree.electricalAssets[0].meters = [meter];
  tree.electricalAssets[0].meterPresent = true;
  syncMeterDevice(tree, 'board-a', meter);
  setAssetMetering(tree, tree.siteAssets[0], {
    kind: 'METERED',
    meterId: meter.id,
    channelIds: ['meter-a:4'],
    phaseMode: 'SINGLE_PHASE',
    direction: 'CONSUMPTION',
  });
  tree.formSubmissions.push({
    id: 'completed-ww',
    installationId: tree.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Completed',
    boardId: 'board-a',
    meterId: meter.id,
    answers: {},
    attachments: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  tree.recordVersionNumber = 3;
  const draftPreview = meterDependencyPreview(tree, meter.id);
  assert.equal(draftPreview.blocked, false);
  assert.match(draftPreview.consequences.join(' · '), /assignment.*soft-deleted/i);
  assert.match(draftPreview.consequences.join(' · '), /site asset.*TBC/i);
  assert.match(draftPreview.consequences.join(' · '), /immutable in pinned record version 3/i);
  tree.installation.status = 'Completed';
  assert.equal(meterDependencyPreview(tree, meter.id).blocked, true);
  tree.installation.status = 'Draft';
  reconcileRemovedMeter(tree, meter.id);
  assert.equal(tree.meterDevices?.some((item) => item.id === meter.id), false);
  assert.equal(tree.electricalAssets[0].meters.some((item) => item.id === meter.id), false);
  assert.equal(tree.electricalAssets[0].meterPresent, false);
  assert.equal(tree.measurementAssignments?.some((item) => item.meterId === meter.id), false);
  assert.deepEqual(tree.siteAssets[0].meteringState, { kind: 'TBC' });
  assert.equal(tree.formSubmissions[0].id, 'completed-ww');
});

test('canonical meter deletion sends the viewed revision and preserves historical commissioning metadata', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const values = new Map<string, string>([['ih_web_jwt', 'test-token']]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const responseTree = fixtureTree();
  responseTree.treeRevision = 5;
  responseTree.baseTreeRevision = 5;
  responseTree.recordVersionNumber = 3;
  responseTree.formSubmissions = [{
    id: 'completed-ww',
    installationId: responseTree.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Completed',
    boardId: 'board-a',
    meterId: 'meter-removed',
    historicalMeterRemoved: true,
    answers: {},
    attachments: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }];
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      ...responseTree,
      readiness: localReadiness(responseTree),
      meterRemoval: {
        meterId: 'meter-removed',
        removedAssignmentIds: ['assignment-1'],
        affectedSiteAssetIds: ['asset-a'],
        retainedFormIds: ['completed-ww'],
        retainedRecordVersions: [{ id: 'version-3', recordVersionNumber: 3 }],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await deleteInstallationMeter(
      responseTree.installation.id,
      'meter/removed',
      { baseTreeRevision: 4 },
    );
    assert.match(
      capturedUrl,
      /\/v1\/installhub\/installations\/installation-golden\/meters\/meter%2Fremoved$/,
    );
    assert.equal(capturedInit?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), { baseTreeRevision: 4 });
    assert.equal(result.tree.treeRevision, 5);
    assert.equal(result.tree.formSubmissions[0].historicalMeterRemoved, true);
    assert.deepEqual(result.meterRemoval.retainedRecordVersions, [
      { id: 'version-3', recordVersionNumber: 3 },
    ]);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('authoritative report starters require a pinned version and send it in the exact API location', async () => {
  assert.throws(() => requireRecordVersionNumber(undefined), /pinned record version/i);
  assert.throws(() => requireRecordVersionNumber(0), /pinned record version/i);
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const values = new Map<string, string>([['ih_web_jwt', 'test-token']]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ jobId: 'job-1', reused: false }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await startFormPdfJob('installation-golden', 'form/history', 7);
    await startInstallationPdfJob('installation-golden', {
      recordVersionNumber: 7,
      formSubmissionIds: ['form-a', 'form-a', 'form-b'],
    });
    await getLatestExportJob('installation-golden', {
      recordVersionNumber: 7,
      recordVersionPayloadHash: 'payload-hash-7',
      reportSource: 'canonical-version',
    });
    assert.match(
      requests[0].url,
      /\/forms\/form%2Fhistory\/report\/pdf\/jobs\?recordVersionNumber=7$/,
    );
    assert.equal(requests[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {});
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
      recordVersionNumber: 7,
      formSubmissionIds: ['form-a', 'form-b'],
    });
    const latestUrl = new URL(requests[2].url, 'http://localhost');
    assert.equal(latestUrl.pathname, '/v1/export/jobs/latest');
    assert.equal(latestUrl.searchParams.get('entityId'), 'installation-golden');
    assert.equal(latestUrl.searchParams.get('recordVersionNumber'), '7');
    assert.equal(latestUrl.searchParams.get('recordVersionPayloadHash'), 'payload-hash-7');
    assert.equal(latestUrl.searchParams.get('reportSource'), 'canonical-version');
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('historical forms select an eligible retained pinned version after reopen', async () => {
  const base = fixtureTree();
  const completedForm = (id: string): FormSubmission => ({
    id,
    installationId: base.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Completed',
    answers: {},
    attachments: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  const trees = new Map<number, InstallationTree>([
    [5, { ...structuredClone(base), formSubmissions: [completedForm('current-only')] }],
    [4, { ...structuredClone(base), formSubmissions: [completedForm('history-a'), completedForm('history-b')] }],
    [3, { ...structuredClone(base), formSubmissions: [completedForm('history-a')] }],
  ]);
  const versionRecord = (
    installationId: string,
    versionNumber: number,
  ): InstallationVersionRecord => {
    const installationTree = trees.get(versionNumber)!;
    installationTree.recordVersionNumber = versionNumber;
    const canonicalInstallationTree = installationTree as InstallationVersionRecord['snapshot']['installationTree'];
    canonicalInstallationTree.installation.recordVersionNumber = versionNumber;
    const payloadHash = `payload-hash-${versionNumber}`;
    return {
      id: `version-${versionNumber}`,
      versionNumber,
      createdByUserId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      app: 'installhub',
      entityType: 'installation',
      entityId: installationId,
      payloadHash,
      snapshot: {
        snapshotSchema: 'InstallationCanonicalSnapshotV2',
        installationTree: canonicalInstallationTree,
        readiness: {
          installationId,
          treeRevision: installationTree.treeRevision ?? 1,
          recordVersionNumber: versionNumber,
          readyToComplete: versionNumber !== 5,
          eligibility: {
            draftDiagnosticReport: true,
            authoritativeReport: versionNumber !== 5,
            mappingExport: versionNumber !== 5,
            dataDomeDelivery: false,
          },
          issues: [],
        },
        payloadHash,
      },
    };
  };
  const selected = await findRecordVersionContainingForms(
    base.installation.id,
    ['history-a', 'history-b'],
    5,
    {
      list: async () => ({
        app: 'installhub',
        entityType: 'installation',
        entityId: base.installation.id,
        versions: [5, 4, 3].map((versionNumber) => ({
          id: `version-${versionNumber}`,
          versionNumber,
          createdByUserId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        })),
      }),
      get: async (installationId, versionNumber) => versionRecord(installationId, versionNumber),
    },
  );
  assert.equal(selected, 4);
  assert.deepEqual(
    authoritativeReportProvenanceFromVersion(versionRecord(base.installation.id, selected)),
    {
      recordVersionNumber: 4,
      recordVersionPayloadHash: 'payload-hash-4',
      reportSource: 'canonical-version',
    },
  );
});

test('portal report provenance matching rejects stale versions, stale hashes, and live diagnostics', () => {
  const expected = {
    recordVersionNumber: 7,
    recordVersionPayloadHash: 'payload-hash-7',
    reportSource: 'canonical-version' as const,
  };
  assert.equal(matchesInstallHubReportProvenance(expected, expected), true);
  assert.equal(matchesInstallHubReportProvenance({
    ...expected,
    recordVersionNumber: 6,
  }, expected), false);
  assert.equal(matchesInstallHubReportProvenance({
    ...expected,
    recordVersionPayloadHash: 'stale-hash',
  }, expected), false);
  assert.equal(matchesInstallHubReportProvenance({
    ...expected,
    reportSource: 'diagnostic-live',
  }, expected), false);
  assert.equal(matchesInstallHubReportProvenance(null, expected), false);
});

test('readiness paging and search keep issues beyond the first one hundred reachable', async () => {
  const tree = fixtureTree();
  const original = tree.siteAssets[0];
  tree.siteAssets = Array.from({ length: 130 }, (_, index) => ({
    ...structuredClone(original),
    id: `asset-${String(index + 1).padStart(3, '0')}`,
    displayCode: `GOLD-LX-${String(index + 1).padStart(3, '0')}`,
    displayCodeMeta: {
      value: `GOLD-LX-${String(index + 1).padStart(3, '0')}`,
      generatedValue: `GOLD-LX-${String(index + 1).padStart(3, '0')}`,
      isOverridden: false,
      ruleVersion: 1,
    },
    meteringState: { kind: 'TBC' as const },
  }));
  const page = localReadinessPage(tree, {
    offset: 100,
    limit: 50,
    q: 'metering_state_invalid',
  });
  assert.equal(page.issuePage.total, 130);
  assert.equal(page.issuePage.offset, 100);
  assert.equal(page.issues.length, 30);
  assert.equal(page.issuePage.nextOffset, null);

  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const values = new Map<string, string>([['ih_web_jwt', 'test-token']]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null },
  });
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const response = await getInstallationReadiness(tree.installation.id, {
      offset: 100,
      limit: 50,
      q: 'metering state',
      severity: 'ERROR',
      entityType: 'site_asset',
      zoneId: 'zone-b',
    });
    assert.match(
      requestedUrl,
      /readiness\?offset=100&limit=50&q=metering\+state&severity=ERROR&entityType=site_asset&zoneId=zone-b$/,
    );
    assert.equal(response.issuePage?.total, 130);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('form completion returns the server-confirmed version and a later retry does not duplicate it', async () => {
  assert.equal(FORM_COMPLETION_SYNC_STAGE, 'complete');
  const attempted = fixtureTree();
  attempted.recordVersionNumber = 7;
  const serverConfirmed = fixtureTree();
  serverConfirmed.treeRevision = 6;
  serverConfirmed.baseTreeRevision = 6;
  serverConfirmed.recordVersionNumber = 9;
  let submissionCount = 0;
  let confirmationCount = 0;

  const outcome = await submitAndConfirmInstallationTree(
    attempted.installation.id,
    attempted,
    FORM_COMPLETION_SYNC_STAGE,
    {
      save: async (_tree, stage) => {
        submissionCount += 1;
        assert.equal(stage, 'complete');
        return {
          installationId: attempted.installation.id,
          treeRevision: 5,
          versionNumber: 8,
        };
      },
      get: async (installationId) => {
        confirmationCount += 1;
        assert.equal(installationId, attempted.installation.id);
        return serverConfirmed;
      },
    },
  );

  assert.equal(outcome.kind, 'CONFIRMED');
  assert.equal(outcome.tree.recordVersionNumber, 9);
  assert.equal(outcome.tree.treeRevision, 6);
  assert.equal(submissionCount, 1);
  assert.equal(confirmationCount, 1);

  let refreshCount = 0;
  let resubmitCount = 0;
  const retryResult = await executeInstallationTreeRetry(
    null,
    'saved',
    {
      refresh: async () => { refreshCount += 1; },
      reviewConflict: async () => {
        assert.fail('A confirmed write must not enter conflict review on retry.');
      },
      resubmitOriginal: async () => {
        resubmitCount += 1;
        return attempted;
      },
    },
  );
  assert.equal(retryResult, null);
  assert.equal(refreshCount, 1);
  assert.equal(resubmitCount, 0);
  assert.equal(submissionCount, 1);
});

test('error-summary jumps make a non-control target focusable and move keyboard focus', () => {
  let focused = false;
  let scrolled = false;
  const attributes = new Map<string, string>();
  const target = {
    matches: () => false,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    addEventListener: () => undefined,
    scrollIntoView: () => { scrolled = true; },
    focus: () => { focused = true; },
  } as unknown as HTMLElement;
  const root = {
    getElementById: (id: string) => id === 'meter-channels' ? target : null,
  } as Pick<Document, 'getElementById'>;
  assert.equal(focusWorkflowErrorTarget('meter-channels', root), true);
  assert.equal(attributes.get('tabindex'), '-1');
  assert.equal(scrolled, true);
  assert.equal(focused, true);
  assert.equal(focusWorkflowErrorTarget('missing', root), false);
});

test('programmatic back, push, and replace callbacks can be held by the shared navigation guard', () => {
  const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fakeWindow = new EventTarget();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });
  try {
    const calls: string[] = [];
    const blocker = (event: Event) => event.preventDefault();
    fakeWindow.addEventListener('installhub:tree-navigation-request', blocker);
    requestTreeNavigation(() => calls.push('back'), 'the previous page');
    requestTreeNavigation(() => calls.push('push'), 'a child page');
    requestTreeNavigation(() => calls.push('replace'), 'the saved record');
    assert.equal(calls.length, 0);
    fakeWindow.removeEventListener('installhub:tree-navigation-request', blocker);
    requestTreeNavigation(() => calls.push('back'), 'the previous page');
    assert.deepEqual(calls, ['back']);
  } finally {
    if (priorDescriptor) Object.defineProperty(globalThis, 'window', priorDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('controlled operational notes make the existing meter dirty before a breadcrumb anchor can leave', () => {
  const source = sixChannelMeter();
  source.notes = '';
  const controlledDraft = { ...source, notes: 'Verified during the physical walk' };
  const dirty = meterEditorHasChanges(
    controlledDraft,
    source,
    [],
    [],
    'edit',
  );
  assert.equal(dirty, true);
  assert.equal(
    guardedTreeAnchorHref(
      dirty,
      { href: 'https://portal.example/installhub/installations/installation-golden' },
      'https://portal.example/installhub/installations/installation-golden/zones/zone-a/boards/board-a/meters/meter-a',
    ),
    'https://portal.example/installhub/installations/installation-golden',
  );
  assert.equal(
    guardedTreeAnchorHref(
      false,
      { href: 'https://portal.example/installhub/installations/installation-golden' },
      'https://portal.example/installhub/installations/installation-golden/zones/zone-a/boards/board-a/meters/meter-a',
    ),
    null,
  );
});

test('Navigation API interception defers the React prompt update beyond the interception phase', () => {
  let insertionPhase = true;
  let scheduled: (() => void) | undefined;
  let promptShown = false;
  deferTreeNavigationPrompt(
    (callback) => { scheduled = callback; },
    () => {
      assert.equal(insertionPhase, false);
      promptShown = true;
    },
  );
  assert.equal(promptShown, false);
  insertionPhase = false;
  scheduled?.();
  assert.equal(promptShown, true);
});
