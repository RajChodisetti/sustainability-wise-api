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
  buildElectricalTreeLayout,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContext,
  electricalTreeNodeSize,
  electricalTreeOrthogonalPath,
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
      { id: 'asset-1', kind: 'SITE_ASSET', name: 'Chiller', typeLabel: 'AC / HVAC' },
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

function largeTerminalFanoutTopology(): ElectricalTreeReadModel {
  const assets = Array.from({ length: 10 }, (_, index) => ({
    id: `asset-${index + 1}`,
    kind: 'SITE_ASSET' as const,
    name: `HVAC load ${index + 1}`,
    typeLabel: 'AC / HVAC',
  }));
  return {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Incoming grid' },
      { id: 'board-1', kind: 'BOARD', name: 'Main switchboard' },
      ...assets,
    ],
    edges: [
      { id: 'fed-board', sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      ...assets.map((asset, index) => ({
        id: `fed-asset-${index + 1}`,
        sourceNodeId: 'board-1',
        targetNodeId: asset.id,
        relationship: 'FED_FROM' as const,
      })),
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

  const branches = ['board-2', 'asset-1', 'virtual-1']
    .map((id) => byId.get(id)!)
    .sort((left, right) => left.y - right.y);
  assert.ok(branches[0].y + branches[0].height < branches[1].y);
  assert.ok(branches[1].y + branches[1].height < branches[2].y);
  assert.deepEqual(buildElectricalTreeLayout(topology()), layout);
});

test('single-line schematic uses variable equipment footprints and orthogonal connectors', () => {
  const layout = buildElectricalTreeLayout(topology());
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const grid = byId.get('grid-1')!;
  const board = byId.get('board-1')!;
  const asset = byId.get('asset-1')!;
  const residual = byId.get('virtual-1')!;

  assert.deepEqual(
    { width: board.width, height: board.height },
    electricalTreeNodeSize('BOARD'),
  );
  assert.ok(board.width > asset.width);
  assert.ok(board.height > asset.height);
  assert.ok(residual.height < asset.height);
  assert.ok(grid.x + grid.width < board.x);

  const supplyPath = electricalTreeOrthogonalPath(grid, board);
  assert.match(supplyPath, /^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? H -?\d+(?:\.\d+)? V -?\d+(?:\.\d+)? H -?\d+(?:\.\d+)?$/);
  assert.doesNotMatch(supplyPath, /[CQ]/);
  assert.notEqual(
    supplyPath,
    electricalTreeOrthogonalPath(grid, board, { sourceYOffset: 13, targetYOffset: 13, trunkRatio: 0.58 }),
  );
  const selfMeasurementPath = electricalTreeOrthogonalPath(board, board, { sourceYOffset: 13 });
  assert.match(selfMeasurementPath, /^M .+ H .+ V .+ H .+ V .+$/);
  assert.doesNotMatch(selfMeasurementPath, /[CQ]/);

  for (const depth of new Set(layout.nodes.map((item) => item.depth))) {
    const column = layout.nodes
      .filter((item) => item.depth === depth)
      .sort((left, right) => left.y - right.y);
    for (let index = 1; index < column.length; index += 1) {
      assert.ok(column[index - 1].y + column[index - 1].height < column[index].y);
    }
  }
});

test('variable-height sibling boards reserve enough branch space to avoid overlap', () => {
  const model: ElectricalTreeReadModel = {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Grid' },
      { id: 'board-1', kind: 'BOARD', name: 'Board one' },
      { id: 'board-2', kind: 'BOARD', name: 'Board two' },
      { id: 'residual-1', kind: 'VIRTUAL_RESIDUAL', name: 'Residual one', parentNodeId: 'board-1' },
      { id: 'residual-2', kind: 'VIRTUAL_RESIDUAL', name: 'Residual two', parentNodeId: 'board-2' },
    ],
    edges: [
      { id: 'fed-1', sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      { id: 'fed-2', sourceNodeId: 'grid-1', targetNodeId: 'board-2', relationship: 'FED_FROM' },
    ],
    unresolved: [],
  };
  const layout = buildElectricalTreeLayout(model);
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const firstBoard = byId.get('board-1')!;
  const secondBoard = byId.get('board-2')!;
  const firstResidual = byId.get('residual-1')!;
  const secondResidual = byId.get('residual-2')!;

  assert.equal(firstBoard.depth, secondBoard.depth);
  assert.ok(firstBoard.y + firstBoard.height < secondBoard.y);
  assert.ok(firstResidual.y + firstResidual.height < secondResidual.y);
  assert.equal(firstBoard.y + firstBoard.height / 2, firstResidual.y + firstResidual.height / 2);
  assert.equal(secondBoard.y + secondBoard.height / 2, secondResidual.y + secondResidual.height / 2);
});

test('large terminal asset fan-outs pack into legible presentation lanes without changing semantic depth', () => {
  const model = largeTerminalFanoutTopology();
  const layout = buildElectricalTreeLayout(model);
  const assets = layout.nodes.filter((item) => item.node.kind === 'SITE_ASSET');
  const fitted = fitElectricalTreeViewport(1200, 640, layout.width, layout.height);

  assert.equal(assets.length, 10);
  assert.deepEqual([...new Set(assets.map((item) => item.depth))], [2]);
  assert.deepEqual([...new Set(assets.map((item) => item.presentationLane))], [0, 1]);
  assert.ok(Math.max(...assets.map((item) => item.presentationRow || 0)) <= 4);
  assert.ok(fitted.scale >= 0.6, `expected a legible overview scale, received ${fitted.scale}`);
  assert.ok(8 * fitted.scale >= 4.8, 'compact labels should retain at least a 4.8px rendered overview size');

  for (let leftIndex = 0; leftIndex < assets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assets.length; rightIndex += 1) {
      const left = assets[leftIndex];
      const right = assets[rightIndex];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      assert.equal(overlaps, false, `${left.node.id} should not overlap ${right.node.id}`);
    }
  }

  const secondLaneAsset = assets.find((item) => item.presentationLane === 1)!;
  const board = layout.nodes.find((item) => item.node.id === 'board-1')!;
  const deeperLanePath = electricalTreeOrthogonalPath(board, secondLaneAsset);
  assert.match(deeperLanePath, /^M .+ H .+ V .+ H .+ V .+$/);
  const coordinates = (deeperLanePath.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  assert.equal(coordinates.length, 6);
  const [, sourceY, trunkX, routeY, finalX] = coordinates;
  const firstLaneAssets = assets.filter((item) => item.presentationLane === 0);
  const firstLaneX = Math.min(...firstLaneAssets.map((item) => item.x));
  const firstLaneRight = Math.max(...firstLaneAssets.map((item) => item.x + item.width));
  assert.ok(trunkX > board.x + board.width && trunkX < firstLaneX);
  assert.ok(sourceY > board.y && sourceY < board.y + board.height);
  assert.ok(finalX > firstLaneRight);
  for (const firstLaneAsset of firstLaneAssets) {
    assert.ok(
      routeY < firstLaneAsset.y || routeY > firstLaneAsset.y + firstLaneAsset.height,
      `deeper-lane horizontal route should stay outside ${firstLaneAsset.node.id}`,
    );
  }
  assert.deepEqual(buildElectricalTreeLayout(structuredClone(model)), layout);
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
  const multiParentById = new Map(multiParentLayout.nodes.map((item) => [item.node.id, item]));
  assert.equal(multiParentById.get('asset-1')?.depth, 1);
  assert.equal(multiParentById.get('asset-1')?.x, multiParentById.get('board-1')?.x);
  assert.ok(multiParentById.get('grid-1')!.x < multiParentById.get('asset-1')!.x);
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
      { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', loadTypeCode: 'HVAC' },
      { id: 'channel-2', ordinal: 2, purpose: 'SUB_CIRCUIT', loadTypeCode: 'OTHER', customLoadTypeName: 'PAC 1' },
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

test('schematic summaries expose installed device identity, channel loads, and confirmed assigned assets', () => {
  const tree = measurementTree();
  const model = topology();
  model.edges = [
    ...model.edges.filter((edge) => edge.relationship !== 'MEASURES'),
    { id: 'measures:assignment-valid', sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'MEASURES' },
  ];

  const board = electricalTreeNodeCardSummary(tree, model, 'board-1');
  assert.deepEqual(board.devices, [{
    id: 'meter-1',
    name: 'Plant meter',
    serialNumber: 'SERIAL-1',
    channelOrdinals: [1, 2],
  }]);
  assert.deepEqual(board.loadLabels, ['HVAC', 'PAC 1']);
  assert.deepEqual(board.assignedAssets, [{ id: 'asset-1', name: 'Chiller' }]);

  const asset = electricalTreeNodeCardSummary(tree, model, 'asset-1');
  assert.deepEqual(asset.devices, board.devices);
  assert.deepEqual(asset.loadLabels, ['AC / HVAC', 'PAC 1']);
  assert.deepEqual(asset.assignedAssets, []);

  const withoutCanonicalMeasurement = structuredClone(model);
  withoutCanonicalMeasurement.edges[withoutCanonicalMeasurement.edges.length - 1] = {
    id: 'unrecognised-measurement-edge',
    sourceNodeId: 'board-1',
    targetNodeId: 'asset-1',
    relationship: 'MEASURES',
  };
  assert.deepEqual(electricalTreeNodeCardSummary(tree, withoutCanonicalMeasurement, 'asset-1'), {
    devices: [],
    loadLabels: ['AC / HVAC'],
    assignedAssets: [],
  });
  assert.deepEqual(electricalTreeNodeCardSummary(tree, withoutCanonicalMeasurement, 'board-1').devices, [{
    id: 'meter-1',
    name: 'Plant meter',
    serialNumber: 'SERIAL-1',
    channelOrdinals: [],
  }]);

  const descriptionFallbackTree = structuredClone(tree);
  delete descriptionFallbackTree.meterDevices![0].channels[0].loadTypeCode;
  descriptionFallbackTree.meterDevices![0].channels[0].description = 'Chiller feeder';
  assert.deepEqual(
    electricalTreeNodeCardSummary(descriptionFallbackTree, model, 'board-1').loadLabels,
    ['Chiller feeder', 'PAC 1'],
  );
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
