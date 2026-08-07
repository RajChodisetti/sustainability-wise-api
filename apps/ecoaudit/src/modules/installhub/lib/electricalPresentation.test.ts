import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoard,
  createInstallationTree,
  createSiteAsset,
  createZone,
} from './model';
import {
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  ensureCanonicalTree,
} from './workflow';
import {
  ASSET_METER_DRAFT_KEY_PREFIX,
  assetMeterReturnHref,
  assetMeterReturnRequest,
  applyReadinessCandidateResolution,
  electricalHierarchyRows,
  filterElectricalHierarchyRows,
  measurementTargetDetails,
  meteringInventorySummary,
  parseAssetMeterDraftSnapshot,
  pinSelectedResult,
  readinessCandidateDetails,
  readinessCorrectionAction,
  readinessEntityDetails,
  readinessResolutionCandidates,
  removeUnresolvedElectricalRelationship,
  resolvedElectricalTopology,
  shouldClearAssetMeterDraft,
  unresolvedRelationshipRemovalPlan,
  unresolvedElectricalRecords,
  zoneElectricalSummary,
  type AssetMeterDraftSnapshot,
} from './electricalPresentation';
import type {
  ElectricalTreeReadModel,
  InstallationTree,
  ReadinessIssue,
} from '@/modules/installhub/types/domain';

function fixtureTree(): InstallationTree {
  const tree = createInstallationTree({
    clientName: 'Client',
    siteName: 'Mapping Site',
    siteAddress: '1 Test Street',
    inspectorName: 'Installer',
    auditDate: '2026-08-02',
    siteCode: 'MAP',
    timezone: 'Australia/Sydney',
  }, {
    id: 'user-1',
    email: 'installer@example.com',
    fullName: 'Installer',
    role: 'admin',
  });
  tree.installation.id = 'installation-1';
  tree.gridSupplies = [{
    id: 'grid-1',
    installationId: tree.installation.id,
    name: 'Main Grid',
    nmi: 'NMI-1',
    isDefault: true,
  }];
  const zone = createZone(tree.installation.id, { zoneName: 'Plant room', zoneDescription: '' });
  zone.id = 'zone-1';
  const board = createBoard(tree.installation.id, zone.id);
  board.id = 'board-1';
  board.assetName = 'Main switchboard';
  board.displayCode = 'MAP-MSB-001';
  applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: 'grid-1' });
  const metered = createSiteAsset(tree.installation.id, zone.id);
  metered.id = 'asset-metered';
  metered.assetName = 'Chiller';
  metered.displayCode = 'MAP-HVAC-001';
  applyAssetElectricalSource(metered, { kind: 'BOARD', boardId: board.id });
  metered.meteringState = { kind: 'METERED', measurementAssignmentIds: [] };
  const unresolved = createSiteAsset(tree.installation.id, zone.id);
  unresolved.id = 'asset-tbc';
  unresolved.assetName = 'Unknown load';
  unresolved.displayCode = 'MAP-OTHER-001';
  applyAssetElectricalSource(unresolved, { kind: 'TBC' });
  unresolved.meteringState = { kind: 'TBC' };
  tree.zones = [zone];
  tree.electricalAssets = [board];
  tree.siteAssets = [metered, unresolved];
  return ensureCanonicalTree(tree);
}

test('electrical hierarchy uses FED_FROM for nesting and MEASURES only as an overlay', () => {
  const model: ElectricalTreeReadModel = {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Main Grid' },
      { id: 'board-1', kind: 'BOARD', name: 'Main board', displayCode: 'MSB-1' },
      { id: 'asset-1', kind: 'SITE_ASSET', name: 'Chiller', displayCode: 'HVAC-1' },
      { id: 'virtual-1', kind: 'VIRTUAL_RESIDUAL', name: 'Residual', parentNodeId: 'board-1' },
    ],
    edges: [
      { id: 'supply-1', sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      { id: 'supply-2', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'FED_FROM' },
      { id: 'measure-1', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'MEASURES' },
    ],
    unresolved: [],
  };
  const rows = electricalHierarchyRows(model);
  assert.deepEqual(rows.map((row) => [row.node.id, row.depth]), [
    ['grid-1', 0],
    ['board-1', 1],
    ['asset-1', 2],
    ['virtual-1', 2],
  ]);
  const asset = rows.find((row) => row.node.id === 'asset-1');
  assert.equal(asset?.parent?.id, 'board-1');
  assert.deepEqual(asset?.measuredBy.map((node) => node.id), ['board-1']);
  assert.deepEqual(filterElectricalHierarchyRows(rows, 'Chiller').map((row) => row.node.id), ['grid-1', 'board-1', 'asset-1']);
});

test('resolved electrical topology excludes TBC subjects and dependent islands from the map', () => {
  const model: ElectricalTreeReadModel = {
    installationId: 'installation-1',
    treeRevision: 2,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Main Grid' },
      { id: 'board-resolved', kind: 'BOARD', name: 'Resolved board' },
      { id: 'asset-resolved', kind: 'SITE_ASSET', name: 'Resolved asset' },
      { id: 'board-tbc', kind: 'BOARD', name: 'TBC board' },
      { id: 'board-invalid', kind: 'BOARD', name: 'Invalid board' },
      { id: 'asset-dependent', kind: 'SITE_ASSET', name: 'Depends on TBC board' },
      { id: 'asset-metering-tbc', kind: 'SITE_ASSET', name: 'Metering TBC', coverageState: 'TBC' },
      { id: 'virtual-resolved', kind: 'VIRTUAL_RESIDUAL', name: 'Resolved residual', parentNodeId: 'board-resolved' },
      { id: 'virtual-unresolved', kind: 'VIRTUAL_RESIDUAL', name: 'Unresolved residual', parentNodeId: 'board-tbc' },
    ],
    edges: [
      { id: 'supply-1', sourceNodeId: 'grid-1', targetNodeId: 'board-resolved', relationship: 'FED_FROM' },
      { id: 'supply-2', sourceNodeId: 'board-resolved', targetNodeId: 'asset-resolved', relationship: 'FED_FROM' },
      { id: 'stale-supply', sourceNodeId: 'grid-1', targetNodeId: 'board-tbc', relationship: 'FED_FROM' },
      { id: 'invalid-supply', sourceNodeId: 'grid-1', targetNodeId: 'board-invalid', relationship: 'FED_FROM' },
      { id: 'dependent-supply', sourceNodeId: 'board-tbc', targetNodeId: 'asset-dependent', relationship: 'FED_FROM' },
      { id: 'metering-tbc-supply', sourceNodeId: 'board-resolved', targetNodeId: 'asset-metering-tbc', relationship: 'FED_FROM' },
      { id: 'measure-resolved', sourceNodeId: 'board-resolved', targetNodeId: 'asset-resolved', relationship: 'MEASURES' },
      { id: 'measure-unresolved-island', sourceNodeId: 'board-tbc', targetNodeId: 'asset-dependent', relationship: 'MEASURES' },
    ],
    unresolved: [
      {
        id: 'unresolved:supply:board-tbc',
        subjectType: 'BOARD',
        subjectId: 'board-tbc',
        relation: 'SUPPLY',
        missingEnd: 'SOURCE',
        reason: 'TBC',
      },
      {
        id: 'unresolved:supply:board-invalid',
        subjectType: 'BOARD',
        subjectId: 'board-invalid',
        relation: 'SUPPLY',
        missingEnd: 'SOURCE',
        reason: 'INVALID',
      },
    ],
  };

  const resolved = resolvedElectricalTopology(model);
  assert.deepEqual(resolved?.nodes.map((node) => node.id), [
    'grid-1',
    'board-resolved',
    'asset-resolved',
    'virtual-resolved',
  ]);
  assert.deepEqual(resolved?.edges.map((edge) => edge.id), [
    'supply-1',
    'supply-2',
    'measure-resolved',
  ]);
  assert.deepEqual(resolved?.unresolved, []);
  assert.equal(model.unresolved.length, 2, 'the source model remains unchanged');
  assert.deepEqual(unresolvedElectricalRecords(model).map((item) => item.id), [
    'unresolved:coverage:asset-metering-tbc',
    'unresolved:supply:board-tbc',
  ], 'the side tray shows only explicit TBC records');
});

test('TBC tray removal deletes only the selected assignment and returns its asset to TBC', () => {
  const tree = fixtureTree();
  const meteredAsset = tree.siteAssets.find((asset) => asset.id === 'asset-metered')!;
  meteredAsset.meterPresent = true;
  meteredAsset.meterId = 'missing-meter';
  meteredAsset.meterChannelIds = ['missing-channel'];
  meteredAsset.meteringState = { kind: 'METERED', measurementAssignmentIds: ['assignment-tbc'] };
  tree.measurementAssignments = [{
    id: 'assignment-tbc',
    installationId: tree.installation.id,
    meterId: 'missing-meter',
    channelIds: ['missing-channel'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: meteredAsset.id },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  const item: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:measurement:assignment-tbc',
    subjectType: 'MEASUREMENT_ASSIGNMENT',
    subjectId: 'assignment-tbc',
    relation: 'MEASUREMENT',
    missingEnd: 'SOURCE',
    knownNodeId: meteredAsset.id,
    reason: 'TBC',
  };

  assert.equal(unresolvedRelationshipRemovalPlan(tree, item).canRemove, true);
  removeUnresolvedElectricalRelationship(tree, item);

  assert.deepEqual(tree.measurementAssignments, []);
  assert.equal(tree.siteAssets.some((asset) => asset.id === meteredAsset.id), true);
  assert.deepEqual(meteredAsset.meteringState, { kind: 'TBC' });
  assert.equal(meteredAsset.meterId, null);
  assert.deepEqual(tree.electricalAssets.map((board) => board.id), ['board-1']);
});

test('TBC tray removal rechecks the current relationship and rejects stale resolved entries', () => {
  const assignmentTree = fixtureTree();
  assignmentTree.measurementAssignments = [{
    id: 'assignment-stale',
    installationId: assignmentTree.installation.id,
    meterId: 'missing-meter',
    channelIds: [],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  const assignmentItem: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:measurement:assignment-stale',
    subjectType: 'MEASUREMENT_ASSIGNMENT',
    subjectId: 'assignment-stale',
    relation: 'MEASUREMENT',
    missingEnd: 'TARGET',
    reason: 'TBC',
  };
  assignmentTree.measurementAssignments[0]!.target = { kind: 'SITE_ASSET', siteAssetId: 'asset-metered' };
  assignmentTree.measurementAssignments[0]!.status = 'CONFIRMED';
  assert.equal(unresolvedRelationshipRemovalPlan(assignmentTree, assignmentItem).canRemove, false);
  assert.throws(
    () => removeUnresolvedElectricalRelationship(assignmentTree, assignmentItem),
    /no longer To be confirmed/i,
  );
  assert.equal(assignmentTree.measurementAssignments.some((assignment) => assignment.id === 'assignment-stale'), true);

  const assetTree = fixtureTree();
  const assetItem: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:supply:asset-tbc',
    subjectType: 'SITE_ASSET',
    subjectId: 'asset-tbc',
    relation: 'SUPPLY',
    missingEnd: 'SOURCE',
    reason: 'TBC',
  };
  applyAssetElectricalSource(assetTree.siteAssets.find((asset) => asset.id === 'asset-tbc')!, { kind: 'BOARD', boardId: 'board-1' });
  assert.equal(unresolvedRelationshipRemovalPlan(assetTree, assetItem).canRemove, false);
  assert.throws(
    () => removeUnresolvedElectricalRelationship(assetTree, assetItem),
    /no longer To be confirmed/i,
  );
  assert.equal(assetTree.siteAssets.some((asset) => asset.id === 'asset-tbc'), true);

  const boardTree = fixtureTree();
  const board = createBoard(boardTree.installation.id, 'zone-1');
  board.id = 'board-stale';
  applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: 'grid-1' });
  boardTree.electricalAssets.push(board);
  const boardItem: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:supply:board-stale',
    subjectType: 'BOARD',
    subjectId: board.id,
    relation: 'SUPPLY',
    missingEnd: 'SOURCE',
    reason: 'TBC',
  };
  assert.equal(unresolvedRelationshipRemovalPlan(boardTree, boardItem).canRemove, false);
  assert.throws(
    () => removeUnresolvedElectricalRelationship(boardTree, boardItem),
    /no longer To be confirmed/i,
  );
  assert.equal(boardTree.electricalAssets.some((candidate) => candidate.id === board.id), true);
});

test('unresolved tray removal preserves confirmed dependencies and permits isolated TBC records', () => {
  const tree = fixtureTree();
  const tbcAssetItem: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:supply:asset-tbc',
    subjectType: 'SITE_ASSET',
    subjectId: 'asset-tbc',
    relation: 'SUPPLY',
    missingEnd: 'SOURCE',
    reason: 'TBC',
  };
  removeUnresolvedElectricalRelationship(tree, tbcAssetItem);
  assert.deepEqual(tree.siteAssets.map((asset) => asset.id), ['asset-metered']);
  assert.deepEqual(tree.electricalAssets.map((board) => board.id), ['board-1']);

  const tbcBoard = createBoard(tree.installation.id, 'zone-1');
  tbcBoard.id = 'board-tbc';
  tbcBoard.assetName = 'TBC board';
  applyBoardElectricalSource(tbcBoard, { kind: 'TBC' });
  const child = createBoard(tree.installation.id, 'zone-1');
  child.id = 'board-child';
  child.assetName = 'Resolved child';
  applyBoardElectricalSource(child, { kind: 'BOARD', boardId: tbcBoard.id });
  tree.electricalAssets.push(tbcBoard, child);
  const tbcBoardItem: ElectricalTreeReadModel['unresolved'][number] = {
    id: 'unresolved:supply:board-tbc',
    subjectType: 'BOARD',
    subjectId: tbcBoard.id,
    relation: 'SUPPLY',
    missingEnd: 'SOURCE',
    reason: 'TBC',
  };
  const plan = unresolvedRelationshipRemovalPlan(tree, tbcBoardItem);
  assert.equal(plan.canRemove, false);
  assert.match(plan.blockedMessage || '', /resolved topology is preserved/i);
  assert.throws(
    () => removeUnresolvedElectricalRelationship(tree, tbcBoardItem),
    /resolved topology is preserved/i,
  );
  assert.equal(tree.electricalAssets.some((board) => board.id === tbcBoard.id), true);
  assert.equal(tree.electricalAssets.some((board) => board.id === child.id), true);
});

test('measurement targets and reconciliation records expose exact identity and valid candidates', () => {
  const tree = fixtureTree();
  const target = measurementTargetDetails(tree, { kind: 'SITE_ASSET', siteAssetId: 'asset-metered' });
  assert.equal(target.id, 'asset-metered');
  assert.match(target.label, /MAP-HVAC-001.*Chiller/);
  assert.match(target.href || '', /assets\/asset-metered$/);

  const issue: ReadinessIssue = {
    code: 'SUPPLY_TBC',
    severity: 'ERROR',
    entityType: 'site_asset',
    entityId: 'asset-tbc',
    field: 'electricalSource',
    message: 'Choose a supply.',
    candidateIds: ['grid-1'],
  };
  const details = readinessEntityDetails(tree, issue);
  assert.equal(details.name, 'Unknown load');
  assert.equal(details.zoneName, 'Plant room');
  assert.deepEqual(readinessCandidateDetails(tree, issue).map((item) => item.id), ['grid-1']);
  // candidateIds is only the bounded API preview; the complete canonical tree
  // still supplies valid picker options omitted from that preview.
  assert.deepEqual(readinessResolutionCandidates(tree, issue).map((item) => item.id), ['grid-1', 'board-1']);
  assert.equal(applyReadinessCandidateResolution(tree, issue, 'missing-board'), false);
  assert.equal(applyReadinessCandidateResolution(tree, issue, 'board-1'), true);
  assert.deepEqual(tree.siteAssets.find((item) => item.id === 'asset-tbc')?.electricalSource, { kind: 'BOARD', boardId: 'board-1' });
  assert.equal(applyReadinessCandidateResolution(tree, issue, 'grid-1'), true);
  assert.deepEqual(tree.siteAssets.find((item) => item.id === 'asset-tbc')?.electricalSource, { kind: 'GRID', gridSupplyId: 'grid-1' });

  const invalidSourceIssue = { ...issue, code: 'SUPPLY_SOURCE_INVALID' };
  assert.deepEqual(readinessResolutionCandidates(tree, invalidSourceIssue).map((item) => item.id), ['grid-1', 'board-1']);
  assert.equal(applyReadinessCandidateResolution(tree, invalidSourceIssue, 'board-1'), true);
  assert.deepEqual(tree.siteAssets.find((item) => item.id === 'asset-tbc')?.electricalSource, { kind: 'BOARD', boardId: 'board-1' });
  const cycleIssue = { ...issue, code: 'ELECTRICAL_CYCLE', entityType: 'board' as const, entityId: 'board-1' };
  assert.deepEqual(readinessResolutionCandidates(tree, cycleIssue).map((item) => item.id), ['grid-1']);
  assert.equal(applyReadinessCandidateResolution(tree, cycleIssue, 'grid-1'), true);
  assert.deepEqual(tree.electricalAssets.find((item) => item.id === 'board-1')?.electricalSource, { kind: 'GRID', gridSupplyId: 'grid-1' });
});

test('reconciliation resolves exact measurement targets and safe unmetered state without inference', () => {
  const mainTree = fixtureTree();
  mainTree.meterDevices = [{
    id: 'meter-1',
    installationId: mainTree.installation.id,
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    displayName: { value: 'Meter 1', generatedValue: 'Meter 1', isOverridden: false, ruleVersion: 1 },
    serialNumber: 'SERIAL-1',
    channels: [{ id: 'channel-main', ordinal: 1, purpose: 'MAIN_SUPPLY' }],
  }];
  mainTree.measurementAssignments = [{
    id: 'assignment-main',
    installationId: mainTree.installation.id,
    meterId: 'meter-1',
    channelIds: ['channel-main'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  const targetIssue: ReadinessIssue = {
    code: 'MEASUREMENT_TARGET_TBC',
    severity: 'ERROR',
    entityType: 'measurement_assignment',
    entityId: 'assignment-main',
    field: 'target',
    message: 'Choose a target.',
  };
  assert.deepEqual(readinessResolutionCandidates(mainTree, targetIssue).map((item) => item.id), ['grid-1', 'board-1']);
  assert.equal(applyReadinessCandidateResolution(mainTree, targetIssue, 'board-1'), true);
  assert.deepEqual(mainTree.measurementAssignments?.[0].target, { kind: 'BOARD', boardId: 'board-1' });

  const subTree = fixtureTree();
  subTree.meterDevices = [{
    ...structuredClone(mainTree.meterDevices![0]),
    channels: [{ id: 'channel-sub', ordinal: 1, purpose: 'SUB_CIRCUIT' }],
  }, {
    ...structuredClone(mainTree.meterDevices![0]),
    id: 'meter-2',
    serialNumber: 'SERIAL-2',
    channels: [{ id: 'channel-owner', ordinal: 1, purpose: 'SUB_CIRCUIT' }],
  }];
  subTree.measurementAssignments = [{
    id: 'assignment-sub',
    installationId: subTree.installation.id,
    meterId: 'meter-1',
    channelIds: ['channel-sub'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }, {
    id: 'assignment-owner',
    installationId: subTree.installation.id,
    meterId: 'meter-2',
    channelIds: ['channel-owner'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-metered' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  const freeDirectAsset = createSiteAsset(subTree.installation.id, 'zone-1');
  freeDirectAsset.id = 'asset-free';
  freeDirectAsset.assetName = 'Free direct load';
  freeDirectAsset.displayCode = 'MAP-OTHER-002';
  applyAssetElectricalSource(freeDirectAsset, { kind: 'BOARD', boardId: 'board-1' });
  freeDirectAsset.meteringState = { kind: 'TBC' };
  subTree.siteAssets.push(freeDirectAsset);
  const subIssue = { ...targetIssue, entityId: 'assignment-sub' };
  const subCandidateIds = readinessResolutionCandidates(subTree, subIssue).map((item) => item.id);
  assert.equal(subCandidateIds.includes('asset-metered'), false);
  assert.equal(subCandidateIds.includes('asset-tbc'), false);
  assert.equal(subCandidateIds.includes('asset-free'), true);
  assert.equal(applyReadinessCandidateResolution(subTree, subIssue, 'asset-free'), true);
  assert.deepEqual(subTree.measurementAssignments?.find((item) => item.id === 'assignment-sub')?.target, { kind: 'SITE_ASSET', siteAssetId: 'asset-free' });

  const meteringTree = fixtureTree();
  const meteringIssue: ReadinessIssue = {
    code: 'METERING_STATE_INVALID',
    severity: 'ERROR',
    entityType: 'site_asset',
    entityId: 'asset-tbc',
    field: 'meteringState',
    message: 'Confirm metering.',
  };
  const unmetered = readinessResolutionCandidates(meteringTree, meteringIssue);
  assert.deepEqual(unmetered.map((item) => item.action), ['SET_METERING_UNMETERED']);
  assert.equal(applyReadinessCandidateResolution(meteringTree, meteringIssue, unmetered[0].id), true);
  assert.deepEqual(meteringTree.siteAssets.find((item) => item.id === 'asset-tbc')?.meteringState, { kind: 'UNMETERED' });

  const gridTree = fixtureTree();
  gridTree.gridSupplies!.push({
    id: 'grid-2',
    installationId: gridTree.installation.id,
    name: 'Backup Grid',
    isDefault: false,
  });
  const gridIssue: ReadinessIssue = {
    code: 'GRID_SUPPLY_INVALID',
    severity: 'ERROR',
    entityType: 'installation',
    entityId: gridTree.installation.id,
    field: 'gridSupplies',
    message: 'Choose one default Grid.',
  };
  assert.deepEqual(readinessResolutionCandidates(gridTree, gridIssue).map((item) => item.id), ['grid-1', 'grid-2']);
  assert.equal(applyReadinessCandidateResolution(gridTree, gridIssue, 'grid-2'), true);
  assert.deepEqual(gridTree.gridSupplies?.filter((item) => item.isDefault).map((item) => item.id), ['grid-2']);
});

test('TBC and retained legacy issue helpers get persisted correction routes', () => {
  const tree = fixtureTree();
  tree.meterDevices = [{
    id: 'meter-1',
    installationId: tree.installation.id,
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    displayName: { value: 'Meter 1', generatedValue: 'Meter 1', isOverridden: false, ruleVersion: 1 },
    serialNumber: 'SERIAL-1',
    channels: [{ id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT' }],
  }];
  tree.measurementAssignments = [{
    id: 'assignment-1',
    installationId: tree.installation.id,
    meterId: 'meter-1',
    channelIds: ['channel-1'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-metered' },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  tree.formSubmissions.push({
    id: 'form-1',
    installationId: tree.installation.id,
    formType: 'ww-installation',
    schemaVersion: 2,
    status: 'Completed',
    zoneId: 'zone-1',
    boardId: 'board-1',
    meterId: 'meter-1',
    answers: {},
    attachments: [{
      id: 'attachment-1',
      slot: 'commissioning.start_screenshot',
      uri: 'https://example.test/evidence.jpg',
      mimeType: 'image/jpeg',
      capturedAt: '2026-08-02T00:00:00.000Z',
    }],
    completedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  });
  const channelAction = readinessCorrectionAction(tree, {
    code: 'CHANNEL_UNASSIGNED',
    severity: 'ERROR',
    entityType: 'channel',
    entityId: 'channel-1',
    field: 'measurementAssignments',
    message: 'Assign channel.',
  });
  assert.match(channelAction.href, /meter-1#meter-assignments$/);
  assert.match(channelAction.instruction, /Save meter/);
  const formAction = readinessCorrectionAction(tree, {
    code: 'FORM_INCOMPLETE',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'missing-form',
    message: 'Complete form.',
  });
  assert.match(formAction.instruction, /Complete form/);
  const completedFormAction = readinessCorrectionAction(tree, {
    code: 'COMPLETED_FORM_IMMUTABLE',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'missing-form',
    message: 'Completed forms cannot be edited.',
  });
  assert.match(completedFormAction.label, /amend/i);
  assert.match(completedFormAction.instruction, /Create amendment.*Complete form/);
  const contractAction = readinessCorrectionAction(tree, {
    code: 'FORM_CONTRACT_INVALID',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'answers.device.serial',
    message: 'Correct the completed form contract.',
  });
  assert.match(contractAction.href, /forms\/form-1#form-completed-actions$/);
  assert.match(contractAction.label, /amend/i);
  assert.match(contractAction.instruction, /Create amendment.*Complete form/);
  const evidenceAction = readinessCorrectionAction(tree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'meter',
    entityId: 'meter-1',
    field: 'wwPhotos.deviceInstalled',
    message: 'Confirm exact evidence.',
  });
  assert.match(evidenceAction.href, /meter-1#meter-photo-deviceInstalled$/);
  assert.match(evidenceAction.instruction, /wwPhotos\.deviceInstalled.*upload confirmation.*Save meter/);
  const zoneEvidenceAction = readinessCorrectionAction(tree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'zone',
    entityId: 'zone-1',
    field: 'photos[0]',
    message: 'Confirm exact evidence.',
  });
  assert.match(zoneEvidenceAction.href, /zones\/zone-1#zone-photos-1$/);
  assert.match(zoneEvidenceAction.instruction, /confirmed upload message/);
  const boardEvidenceAction = readinessCorrectionAction(tree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'board',
    entityId: 'board-1',
    field: 'extraPhotos[2]',
    message: 'Confirm exact evidence.',
  });
  assert.match(boardEvidenceAction.href, /boards\/board-1#board-extra-photos-3$/);
  const assetEvidenceAction = readinessCorrectionAction(tree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'site_asset',
    entityId: 'asset-metered',
    field: 'locationPhoto',
    message: 'Confirm exact evidence.',
  });
  assert.match(assetEvidenceAction.href, /assets\/asset-metered#asset-location-photo$/);
  const formEvidenceAction = readinessCorrectionAction(tree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'attachments[0].uri',
    message: 'Confirm exact evidence.',
  });
  assert.match(formEvidenceAction.href, /forms\/form-1#form-field-commissioning-start_screenshot$/);
  const schemaOneTree = structuredClone(tree);
  schemaOneTree.formSubmissions[0].schemaVersion = 1;
  schemaOneTree.formSubmissions[0].formType = 'a3rm-installation';
  const schemaOneEvidenceAction = readinessCorrectionAction(schemaOneTree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'attachments[0].uri',
    message: 'Confirm exact evidence.',
  });
  assert.match(schemaOneEvidenceAction.href, /forms\/form-1#form-field-commissioning-start_screenshot$/);
  const unknownSlotTree = structuredClone(tree);
  unknownSlotTree.formSubmissions[0].attachments[0].slot = 'legacy.unknown-photo';
  const unknownSlotEvidenceAction = readinessCorrectionAction(unknownSlotTree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'attachments[0].uri',
    message: 'Confirm legacy evidence.',
  });
  assert.match(unknownSlotEvidenceAction.href, /forms\/form-1#form-completed-actions$/);
  const legacyUnknownSlotTree = structuredClone(schemaOneTree);
  legacyUnknownSlotTree.formSubmissions[0].attachments[0].slot = 'legacy.unknown-photo';
  const legacyUnknownSlotEvidenceAction = readinessCorrectionAction(legacyUnknownSlotTree, {
    code: 'EVIDENCE_NOT_CONFIRMED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'attachments[0].uri',
    message: 'Confirm legacy evidence.',
  });
  assert.match(legacyUnknownSlotEvidenceAction.href, /forms\/form-1#form-completed-actions$/);
  const virtualMeterAction = readinessCorrectionAction(tree, {
    code: 'VIRTUAL_METER_SOURCE_INCOMPLETE',
    severity: 'ERROR',
    entityType: 'virtual_meter',
    entityId: 'board-1',
    field: 'subtractAssignmentIds',
    message: 'Resolve competing child assignments.',
    candidateIds: ['assignment-1'],
  });
  assert.match(virtualMeterAction.href, /meter-1#meter-assignment-1-target$/);
  assert.match(virtualMeterAction.instruction, /exactly one.*Save meter/);
  const requiredWwFormAction = readinessCorrectionAction(tree, {
    code: 'METER_DEVICE_REQUIRED',
    severity: 'ERROR',
    entityType: 'meter',
    entityId: 'meter-1',
    field: 'formSubmission',
    message: 'Open the WW form.',
  });
  assert.match(requiredWwFormAction.href, /forms\/new\?.*formType=ww-installation#new-form-ww-installation$/);
  const channelLayoutAction = readinessCorrectionAction(tree, {
    code: 'CHANNEL_NOT_FOUND',
    severity: 'ERROR',
    entityType: 'meter',
    entityId: 'meter-1',
    field: 'channels.ordinal',
    message: 'Restore the standard channel layout.',
  });
  assert.match(channelLayoutAction.href, /meter-1#meter-channel-layout$/);
  const ordinalLayoutAction = readinessCorrectionAction(tree, {
    code: 'CHANNEL_DUPLICATE_ASSIGNMENT',
    severity: 'ERROR',
    entityType: 'channel',
    entityId: 'channel-1',
    field: 'ordinal',
    message: 'Restore unique channel ordinals.',
  });
  assert.match(ordinalLayoutAction.href, /meter-1#meter-channel-layout$/);
  const duplicateTree = structuredClone(tree);
  duplicateTree.measurementAssignments!.push({
    ...duplicateTree.measurementAssignments![0],
    id: 'assignment-2',
    target: { kind: 'TBC' },
    status: 'TBC',
  });
  const duplicateChannelAction = readinessCorrectionAction(duplicateTree, {
    code: 'CHANNEL_DUPLICATE_ASSIGNMENT',
    severity: 'ERROR',
    entityType: 'channel',
    entityId: 'channel-1',
    field: 'channelIds',
    message: 'Choose only one assignment.',
    candidateIds: ['assignment-1', 'assignment-2'],
  });
  assert.match(duplicateChannelAction.href, /meter-1#meter-assignment-2-channels$/);
  const routeCases: Array<[ReadinessIssue, RegExp]> = [
    [{ code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'board', entityId: 'board-1', field: 'customTypeName', message: 'Type.' }, /#board-custom-type$/],
    [{ code: 'METERING_STATE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: 'asset-tbc', field: 'meteringState', message: 'Metering.' }, /#asset-metering$/],
    [{ code: 'SENSOR_RATING_INVALID', severity: 'ERROR', entityType: 'channel', entityId: 'channel-1', field: 'sensorRating', message: 'Rating.' }, /#meter-channel-1-sensor$/],
    [{ code: 'CHANNEL_UNASSIGNED', severity: 'ERROR', entityType: 'channel', entityId: 'channel-1', field: 'channelIds', message: 'Assign.' }, /#meter-assignments$/],
    [{ code: 'DISPLAY_CODE_INVALID', severity: 'ERROR', entityType: 'meter', entityId: 'meter-1', field: 'displayName', message: 'Name.' }, /#meter-name$/],
    [{ code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: 'meter-1', field: 'customModelName', message: 'Model.' }, /#meter-custom-model$/],
    [{ code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: 'meter-1', field: 'customManufacturerName', message: 'Manufacturer.' }, /#meter-custom-manufacturer$/],
    [{ code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'board', entityId: 'board-1', field: 'electricalSource.boardId', message: 'Parent.' }, /#board-parent$/],
    [{ code: 'GRID_SUPPLY_INVALID', severity: 'ERROR', entityType: 'board', entityId: 'board-1', field: 'electricalSource.gridSupplyId', message: 'Grid.' }, /#board-grid-supply$/],
    [{ code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: 'asset-tbc', field: 'electricalSource.boardId', message: 'Board.' }, /#asset-source-board$/],
    [{ code: 'GRID_SUPPLY_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: 'asset-tbc', field: 'electricalSource.gridSupplyId', message: 'Grid.' }, /#asset-grid-supply$/],
    [{ code: 'TIMEZONE_REQUIRED_FOR_EXPORT', severity: 'WARNING', entityType: 'installation', entityId: tree.installation.id, field: 'timezone', message: 'Timezone.' }, /\/edit#installation-timezone$/],
  ];
  for (const [issue, expectedHref] of routeCases) {
    const action = readinessCorrectionAction(tree, issue);
    assert.match(action.href, expectedHref);
    assert.match(action.instruction, /Save|persist|Complete/);
  }

  const tbcTree = structuredClone(tree);
  tbcTree.measurementAssignments![0].target = { kind: 'TBC' };
  const tbcAction = readinessCorrectionAction(tbcTree, {
    code: 'MEASUREMENT_TARGET_TBC',
    severity: 'ERROR',
    entityType: 'measurement_assignment',
    entityId: 'assignment-1',
    field: 'target',
    message: 'Choose a target.',
  });
  assert.match(tbcAction.href, /#meter-assignment-1-kind$/);

  const nonWwDraftTree = structuredClone(tree);
  nonWwDraftTree.formSubmissions[0].formType = 'ace-switchboard';
  nonWwDraftTree.formSubmissions[0].status = 'Draft';
  const nonWwContextAction = readinessCorrectionAction(nonWwDraftTree, {
    code: 'FORM_CONTEXT_REQUIRED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'context',
    message: 'Choose valid context.',
  });
  assert.match(nonWwContextAction.href, /forms\/form-1#form-actions$/);
  assert.match(nonWwContextAction.instruction, /Delete the draft.*recreate/i);

  const wwDraftTree = structuredClone(tree);
  wwDraftTree.formSubmissions[0].status = 'Draft';
  const wwDraftContextAction = readinessCorrectionAction(wwDraftTree, {
    code: 'FORM_CONTEXT_REQUIRED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'context',
    message: 'Choose valid context.',
  });
  assert.match(wwDraftContextAction.href, /forms\/form-1#form-actions$/);
  const wwCompletedContextAction = readinessCorrectionAction(tree, {
    code: 'FORM_CONTEXT_REQUIRED',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'context',
    message: 'Repair historical context.',
  });
  assert.match(wwCompletedContextAction.href, /forms\/form-1#form-completed-actions$/);

  const incompleteAction = readinessCorrectionAction(nonWwDraftTree, {
    code: 'FORM_INCOMPLETE',
    severity: 'ERROR',
    entityType: 'form',
    entityId: 'form-1',
    field: 'status',
    message: 'Complete the form.',
  });
  assert.match(incompleteAction.href, /forms\/form-1#form-actions$/);

  const externalKeyAction = readinessCorrectionAction(tree, {
    code: 'EXTERNAL_KEY_REQUIRED',
    severity: 'ERROR',
    entityType: 'installation',
    entityId: tree.installation.id,
    field: 'externalKey',
    message: 'External key is required.',
  });
  assert.match(externalKeyAction.href, /\/data$/);
  assert.match(externalKeyAction.instruction, /server-owned.*administrator/i);
});

test('bounded search results pin a selected record outside the first visible window', () => {
  const all = Array.from({ length: 150 }, (_, index) => ({ id: `item-${index + 1}` }));
  const visible = pinSelectedResult(all, all, 'item-150', (item) => item.id);
  assert.equal(visible.length, 100);
  assert.equal(visible[0].id, 'item-150');
});

test('zone summaries distinguish mapping state and unresolved relationships', () => {
  const summary = zoneElectricalSummary(fixtureTree(), 'zone-1');
  assert.deepEqual(summary, {
    metered: 1,
    unmetered: 0,
    tbc: 1,
    unresolvedSupply: 1,
    unresolvedMetering: 1,
    unresolved: 2,
  });
});

test('metering inventory separates valid unmetered assets from broken mappings and unassigned channels', () => {
  const tree = fixtureTree();
  const unmetered = createSiteAsset(tree.installation.id, 'zone-1');
  unmetered.id = 'asset-unmetered';
  unmetered.assetName = 'Unmetered fan';
  unmetered.displayCode = 'MAP-FAN-001';
  unmetered.meteringState = { kind: 'UNMETERED' };
  unmetered.meterPresent = false;
  applyAssetElectricalSource(unmetered, { kind: 'BOARD', boardId: 'board-1' });
  tree.siteAssets.push(unmetered);
  tree.meterDevices = [{
    id: 'meter-1',
    installationId: tree.installation.id,
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    displayName: { value: 'MAP-A3RM-001', generatedValue: 'MAP-A3RM-001', isOverridden: false, ruleVersion: 1 },
    serialNumber: 'SERIAL-1',
    channels: [
      { id: 'channel-active', ordinal: 1, purpose: 'SUB_CIRCUIT' },
      { id: 'channel-spare-1', ordinal: 2, purpose: 'SPARE' },
      { id: 'channel-spare-2', ordinal: 3, purpose: 'SPARE' },
    ],
  }];
  tree.measurementAssignments = [{
    id: 'wrong-meter-assignment',
    installationId: tree.installation.id,
    meterId: 'missing-meter',
    channelIds: ['channel-active'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  const summary = meteringInventorySummary(tree);
  assert.deepEqual(summary.assets, {
    total: 3,
    directlyMetered: 0,
    confirmedUnmetered: 1,
    toBeConfirmed: 1,
    brokenMappings: 1,
  });
  assert.deepEqual(summary.meters, {
    total: 1,
    withoutAssignments: 1,
    allChannelsSpare: 0,
    withUnassignedActiveChannels: 1,
  });
  assert.deepEqual(summary.channels, {
    active: 1,
    assignedActive: 0,
    unassignedActive: 1,
    spare: 2,
  });
});

test('asset-to-meter detour validates its stored draft and builds a scoped return URL', () => {
  const tree = fixtureTree();
  const draft = tree.siteAssets[0];
  const key = `${ASSET_METER_DRAFT_KEY_PREFIX}installation-1:${draft.id}:1`;
  const snapshot: AssetMeterDraftSnapshot = {
    version: 1,
    installationId: 'installation-1',
    zoneId: 'zone-1',
    mode: 'edit',
    assetId: draft.id,
    meterBoardId: 'board-1',
    capturedAt: '2026-08-02T00:00:00.000Z',
    draft,
  };
  assert.equal(parseAssetMeterDraftSnapshot(JSON.stringify(snapshot), {
    installationId: 'installation-1',
    zoneId: 'zone-1',
    mode: 'edit',
    assetId: draft.id,
  })?.meterBoardId, 'board-1');
  assert.equal(parseAssetMeterDraftSnapshot(JSON.stringify(snapshot), {
    installationId: 'another-installation',
    zoneId: 'zone-1',
    mode: 'edit',
    assetId: draft.id,
  }), null);
  assert.equal(parseAssetMeterDraftSnapshot('{not-valid-json', {
    installationId: 'installation-1',
    zoneId: 'zone-1',
    mode: 'edit',
    assetId: draft.id,
  }), null);

  const request = assetMeterReturnRequest(new URLSearchParams({
    returnAssetMode: 'edit',
    returnAssetZoneId: 'zone-1',
    returnAssetId: draft.id,
    resumeDraftKey: key,
  }));
  assert.ok(request);
  assert.equal(
    assetMeterReturnHref('installation-1', request!, 'meter-new'),
    `/installhub/installations/installation-1/zones/zone-1/assets/${draft.id}?resumeDraftKey=${encodeURIComponent(key)}&createdMeterId=meter-new`,
  );
  assert.equal(
    assetMeterReturnHref('installation-1', request!),
    `/installhub/installations/installation-1/zones/zone-1/assets/${draft.id}?resumeDraftKey=${encodeURIComponent(key)}`,
  );
  assert.equal(shouldClearAssetMeterDraft('RESTORED'), false);
  assert.equal(shouldClearAssetMeterDraft('DEVICE_SAVE_FAILED'), false);
  assert.equal(shouldClearAssetMeterDraft('ASSET_SAVE_FAILED'), false);
  assert.equal(shouldClearAssetMeterDraft('ASSET_SAVE_CONFIRMED'), true);
  assert.equal(shouldClearAssetMeterDraft('EXPLICIT_DISCARD'), true);
});
