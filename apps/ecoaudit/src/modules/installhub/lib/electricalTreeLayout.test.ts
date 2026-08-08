import assert from 'node:assert/strict';
import test from 'node:test';
import type { ElectricalTreeReadModel, InstallationTree } from '@/modules/installhub/types/domain';
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
  ELECTRICAL_TREE_NODE_HEIGHT,
  buildElectricalTreeLayout,
  electricalTreeNodeContext,
  fitElectricalTreeViewport,
  resolvedElectricalMeasurementDetails,
  zoomElectricalTreeViewport,
} from './electricalTreeLayout';

function topology(): ElectricalTreeReadModel {
  return {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Grid' },
      { id: 'board-1', kind: 'BOARD', name: 'Main board' },
      { id: 'board-2', kind: 'BOARD', name: 'Distribution board' },
      { id: 'asset-1', kind: 'SITE_ASSET', name: 'Chiller' },
      { id: 'asset-2', kind: 'SITE_ASSET', name: 'Lighting' },
      { id: 'virtual-1', kind: 'VIRTUAL_RESIDUAL', name: 'Residual', parentNodeId: 'board-1' },
    ],
    edges: [
      { id: 'fed-1', sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      { id: 'fed-2', sourceNodeId: 'board-1', targetNodeId: 'board-2', relationship: 'FED_FROM' },
      { id: 'fed-3', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'FED_FROM' },
      { id: 'fed-4', sourceNodeId: 'board-2', targetNodeId: 'asset-2', relationship: 'FED_FROM' },
      { id: 'measure-1', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'MEASURES' },
    ],
    unresolved: [],
  };
}

test('interactive electrical tree lays out FED_FROM branches and derived residuals deterministically', () => {
  const layout = buildElectricalTreeLayout(topology());
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));

  assert.ok(byId.get('grid-1')!.x < byId.get('board-1')!.x);
  assert.ok(byId.get('board-1')!.x < byId.get('asset-1')!.x);
  assert.equal(byId.get('virtual-1')?.parentId, 'board-1');
  assert.equal(layout.edges.some((edge) => (
    edge.derived
    && edge.sourceNodeId === 'board-1'
    && edge.targetNodeId === 'virtual-1'
  )), true);

  const branchYs = ['board-2', 'asset-1', 'virtual-1'].map((id) => byId.get(id)!.y).sort((left, right) => left - right);
  assert.ok(branchYs[1] - branchYs[0] >= ELECTRICAL_TREE_NODE_HEIGHT);
  assert.ok(branchYs[2] - branchYs[1] >= ELECTRICAL_TREE_NODE_HEIGHT);
  assert.deepEqual(buildElectricalTreeLayout(topology()), layout);
});

test('interactive electrical tree is stable across input order and draws only its chosen supply parent', () => {
  const expected = buildElectricalTreeLayout(topology());
  const shuffled = topology();
  shuffled.nodes.reverse();
  shuffled.edges.reverse();
  assert.deepEqual(buildElectricalTreeLayout(shuffled), expected);

  const multiParent = topology();
  multiParent.edges.push({
    id: 'fed-0-competing-parent',
    sourceNodeId: 'grid-1',
    targetNodeId: 'asset-1',
    relationship: 'FED_FROM',
  });
  const multiParentLayout = buildElectricalTreeLayout(multiParent);
  const inboundSupply = multiParentLayout.edges.filter((edge) => (
    edge.relationship === 'FED_FROM' && edge.targetNodeId === 'asset-1'
  ));
  assert.deepEqual(inboundSupply.map((edge) => edge.id), ['fed-0-competing-parent']);
  assert.equal(electricalTreeNodeContext(multiParentLayout, 'asset-1').parentId, 'grid-1');
});

test('interactive electrical tree context separates supply descendants from measurement overlays', () => {
  const layout = buildElectricalTreeLayout(topology());
  const board = electricalTreeNodeContext(layout, 'board-1');

  assert.equal(board.parentId, 'grid-1');
  assert.deepEqual(board.childIds, ['board-2', 'asset-1']);
  assert.deepEqual(board.derivedChildIds, ['virtual-1']);
  assert.deepEqual(board.descendantIds, ['board-2', 'asset-1', 'virtual-1', 'asset-2']);
  assert.deepEqual(board.measuresIds, ['asset-1']);
  assert.deepEqual(electricalTreeNodeContext(layout, 'asset-1').measuredByIds, ['board-1']);
  assert.equal(electricalTreeNodeContext(layout, 'virtual-1').parentId, undefined);
  assert.equal(electricalTreeNodeContext(layout, 'virtual-1').derivedParentId, 'board-1');
});

function measurementTree(): InstallationTree {
  const tree = createInstallationTree({
    clientName: 'Client',
    siteName: 'Tree site',
    siteAddress: '1 Test Street',
    inspectorName: 'Installer',
    auditDate: '2026-08-08',
    siteCode: 'TREE',
    timezone: 'Australia/Sydney',
  }, {
    id: 'user-1',
    email: 'installer@example.com',
    fullName: 'Installer',
    role: 'admin',
  });
  tree.installation.id = 'installation-1';
  tree.gridSupplies = [{ id: 'grid-1', installationId: tree.installation.id, name: 'Grid', isDefault: true }];
  const zone = createZone(tree.installation.id, { zoneName: 'Plant room', zoneDescription: '' });
  zone.id = 'zone-1';
  const board = createBoard(tree.installation.id, zone.id);
  board.id = 'board-1';
  applyBoardElectricalSource(board, { kind: 'GRID', gridSupplyId: 'grid-1' });
  const asset = createSiteAsset(tree.installation.id, zone.id);
  asset.id = 'asset-1';
  applyAssetElectricalSource(asset, { kind: 'BOARD', boardId: board.id });
  asset.meteringState = { kind: 'METERED', measurementAssignmentIds: ['assignment-valid'] };
  tree.zones = [zone];
  tree.electricalAssets = [board];
  tree.siteAssets = [asset];
  tree.meterDevices = [{
    id: 'meter-1',
    installationId: tree.installation.id,
    installedOnBoardId: board.id,
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    displayName: { value: 'Plant meter', generatedValue: 'Plant meter', isOverridden: false, ruleVersion: 4 },
    serialNumber: 'SERIAL-1',
    channels: [
      { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
      { id: 'channel-2', ordinal: 2, purpose: 'SUB_CIRCUIT' },
    ],
  }];
  tree.measurementAssignments = [
    {
      id: 'assignment-valid',
      installationId: tree.installation.id,
      meterId: 'meter-1',
      channelIds: ['channel-2', 'channel-1'],
      phaseMode: 'THREE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    },
    {
      id: 'assignment-invalid-confirmed',
      installationId: tree.installation.id,
      meterId: 'meter-1',
      channelIds: ['missing-channel'],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    },
    {
      id: 'assignment-tbc',
      installationId: tree.installation.id,
      meterId: 'meter-1',
      channelIds: ['channel-1'],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
      direction: 'CONSUMPTION',
      status: 'TBC',
    },
  ];
  return ensureCanonicalTree(tree);
}

test('node details expose exact meter channels only through canonical MEASURES edges', () => {
  const tree = measurementTree();
  const model = topology();
  model.edges = [
    ...model.edges.filter((edge) => edge.relationship !== 'MEASURES'),
    { id: 'measures:assignment-valid', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'MEASURES' },
  ];

  const details = resolvedElectricalMeasurementDetails(tree, model, 'asset-1');
  assert.deepEqual(details.map((detail) => detail.assignment.id), ['assignment-valid']);
  assert.deepEqual(details[0].channels.map((channel) => channel.ordinal), [1, 2]);
  assert.equal(details[0].meter.serialNumber, 'SERIAL-1');

  model.edges[model.edges.length - 1] = {
    id: 'measure_assignment-valid',
    sourceNodeId: 'board-1',
    targetNodeId: 'asset-1',
    relationship: 'MEASURES',
  };
  assert.deepEqual(resolvedElectricalMeasurementDetails(tree, model, 'asset-1').map((detail) => detail.assignment.id), ['assignment-valid']);
});

test('interactive electrical tree fits and zooms around the requested anchor', () => {
  const fitted = fitElectricalTreeViewport(1000, 600, 1600, 800);
  assert.equal(fitted.scale, 0.585);
  assert.equal(fitted.x, 32);
  assert.equal(fitted.y, 66);

  const zoomed = zoomElectricalTreeViewport(fitted, fitted.scale * 2, 500, 300);
  assert.deepEqual(zoomed, { x: -436, y: -168, scale: 1.17 });
  assert.equal(zoomElectricalTreeViewport(zoomed, 10, 0, 0).scale, 2);
  assert.equal(zoomElectricalTreeViewport(zoomed, 0.001, 0, 0).scale, 0.005);

  const largeOverview = fitElectricalTreeViewport(1000, 600, 1600, 14_000);
  assert.equal(largeOverview.scale, 536 / 14_000);
  assert.ok(1600 * largeOverview.scale <= 936);
  assert.ok(14_000 * largeOverview.scale <= 536);
});
