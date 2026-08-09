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
  applyElectricalTreeMapLayout,
  buildElectricalTreeLayout,
  electricalTreeCurvedPath,
  electricalTreeMapLayoutDocument,
  electricalTreeMapLayoutDraft,
  electricalTreeMapLayoutsEqual,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContext,
  electricalTreeNodeSize,
  electricalTreeNodeVisualSize,
  electricalTreeOrthogonalPath,
  electricalTreePointerDelta,
  electricalTreePointerDragStarted,
  electricalTreeStraightPath,
  filterElectricalTreeLayout,
  fitElectricalTreeViewport,
  moveElectricalTreeMapLayoutNode,
  resolvedElectricalMeasurementDetails,
  zoomElectricalTreeViewport,
} from './electricalTreeLayout';

test('map pictograms are prominent inside interaction-safe stable node footprints', () => {
  const expected = {
    GRID: { width: 176, height: 172, haloSize: 112, iconSize: 80 },
    BOARD: { width: 172, height: 166, haloSize: 96, iconSize: 72 },
    SITE_ASSET: { width: 144, height: 142, haloSize: 80, iconSize: 56 },
    VIRTUAL_RESIDUAL: { width: 136, height: 126, haloSize: 80, iconSize: 56 },
  } as const;

  for (const [kind, dimensions] of Object.entries(expected)) {
    const visual = electricalTreeNodeVisualSize(kind as keyof typeof expected);
    assert.deepEqual(visual, dimensions);
    assert.deepEqual(electricalTreeNodeSize(kind as keyof typeof expected), {
      width: dimensions.width,
      height: dimensions.height,
    });
    assert.ok(visual.iconSize / visual.haloSize >= 0.7, `${kind} icon must read prominently`);
    assert.ok(visual.haloSize >= 44, `${kind} halo must remain touch-sized`);
    assert.ok(visual.width >= visual.haloSize && visual.height >= visual.haloSize);
  }
});

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

function balancedBranchTopology(): ElectricalTreeReadModel {
  const boards = Array.from({ length: 4 }, (_, index) => ({
    id: `board-${index + 1}`,
    kind: 'BOARD' as const,
    name: `Branch board ${index + 1}`,
  }));
  const assets = Array.from({ length: 4 }, (_, index) => ({
    id: `asset-${index + 1}`,
    kind: 'SITE_ASSET' as const,
    name: `Branch load ${index + 1}`,
  }));
  return {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Incoming grid' },
      ...boards,
      ...assets,
    ],
    edges: [
      ...boards.map((board, index) => ({
        id: `fed-board-${index + 1}`,
        sourceNodeId: 'grid-1',
        targetNodeId: board.id,
        relationship: 'FED_FROM' as const,
      })),
      ...assets.map((asset, index) => ({
        id: `fed-asset-${index + 1}`,
        sourceNodeId: boards[index].id,
        targetNodeId: asset.id,
        relationship: 'FED_FROM' as const,
      })),
    ],
    unresolved: [],
  };
}

type LayoutNode = ReturnType<typeof buildElectricalTreeLayout>['nodes'][number];

function nodeCenter(node: LayoutNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function nodesOverlap(left: LayoutNode, right: LayoutNode): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function assertNoNodeOverlap(nodes: LayoutNode[]) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      assert.equal(
        nodesOverlap(nodes[leftIndex], nodes[rightIndex]),
        false,
        `${nodes[leftIndex].node.id} should not overlap ${nodes[rightIndex].node.id}`,
      );
    }
  }
}

function pointIsOnNodePerimeter(node: LayoutNode, x: number, y: number): boolean {
  const epsilon = 0.03;
  const withinX = x >= node.x - epsilon && x <= node.x + node.width + epsilon;
  const withinY = y >= node.y - epsilon && y <= node.y + node.height + epsilon;
  const onVertical = Math.abs(x - node.x) <= epsilon || Math.abs(x - node.x - node.width) <= epsilon;
  const onHorizontal = Math.abs(y - node.y) <= epsilon || Math.abs(y - node.y - node.height) <= epsilon;
  return withinX && withinY && (onVertical || onHorizontal);
}

test('electrical constellation centres the grid and lays out FED_FROM branches deterministically', () => {
  const layout = buildElectricalTreeLayout(topology());
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const grid = byId.get('grid-1')!;
  const board = byId.get('board-1')!;
  const gridCenter = nodeCenter(grid);

  assert.ok(Math.abs(gridCenter.x - layout.width / 2) <= 0.02);
  assert.ok(Math.abs(gridCenter.y - layout.height / 2) <= 0.02);
  assert.equal(grid.presentationRing, 0);
  assert.equal(board.presentationRing, 1);
  assert.ok((board.radialDistance || 0) > 0);
  assert.ok((byId.get('asset-1')!.radialDistance || 0) > (board.radialDistance || 0));
  assert.equal(byId.get('virtual-1')?.parentId, 'board-1');
  assert.equal(layout.edges.some((edge) => (
    edge.derived
    && edge.sourceNodeId === 'board-1'
    && edge.targetNodeId === 'virtual-1'
  )), true);

  const branchAngles = ['board-2', 'asset-1', 'virtual-1'].map((id) => byId.get(id)!.angle!);
  assert.ok(Math.max(...branchAngles) - Math.min(...branchAngles) > Math.PI * 0.65);
  assertNoNodeOverlap(layout.nodes);
  assert.deepEqual(buildElectricalTreeLayout(topology()), layout);
});

test('balanced primary branches occupy all four quadrants around the incoming grid', () => {
  const layout = buildElectricalTreeLayout(balancedBranchTopology());
  const grid = layout.nodes.find((item) => item.node.id === 'grid-1')!;
  const gridCenter = nodeCenter(grid);
  const boards = layout.nodes.filter((item) => item.node.kind === 'BOARD');
  const quadrants = new Set(boards.map((board) => {
    const center = nodeCenter(board);
    return `${Math.sign(center.x - gridCenter.x)},${Math.sign(center.y - gridCenter.y)}`;
  }));

  assert.equal(quadrants.size, 4);
  assert.deepEqual([...new Set(boards.map((board) => board.presentationRing))], [1]);
  assert.equal(new Set(boards.map((board) => board.branchId)).size, 4);
  assertNoNodeOverlap(layout.nodes);
});

test('constellation uses compact equipment footprints and straight perimeter connectors', () => {
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
  assert.equal(grid.radialDistance, 0);
  assert.ok((board.radialDistance || 0) < (asset.radialDistance || 0));

  const supplyPath = electricalTreeStraightPath(grid, board);
  assert.match(supplyPath, /^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? L -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?$/);
  assert.doesNotMatch(supplyPath, /[CHVQ]/);
  assert.equal(electricalTreeCurvedPath(grid, board), supplyPath);
  assert.equal(electricalTreeOrthogonalPath(grid, board), supplyPath);
  assert.notEqual(
    supplyPath,
    electricalTreeStraightPath(grid, board, { sourceYOffset: 13, targetYOffset: 13 }),
  );
  const selfMeasurementPath = electricalTreeStraightPath(board, board, { sourceYOffset: 13 });
  assert.match(selfMeasurementPath, /^M .+ L .+$/);
  assert.doesNotMatch(selfMeasurementPath, /[CHVQ]/);

  const coordinates = (supplyPath.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  assert.equal(coordinates.length, 4);
  assert.equal(pointIsOnNodePerimeter(grid, coordinates[0], coordinates[1]), true);
  assert.equal(pointIsOnNodePerimeter(board, coordinates[2], coordinates[3]), true);

  const coincidentBoard = {
    ...board,
    x: grid.x + (grid.width - board.width) / 2,
    y: grid.y + (grid.height - board.height) / 2,
  };
  const coincidentPath = electricalTreeStraightPath(grid, coincidentBoard);
  assert.match(coincidentPath, /^M .+ L .+$/);
  assert.doesNotMatch(coincidentPath, /NaN|Infinity/);
  assertNoNodeOverlap(layout.nodes);
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
  assert.equal(firstBoard.presentationRing, secondBoard.presentationRing);
  assert.equal(firstBoard.angle, firstResidual.angle);
  assert.equal(secondBoard.angle, secondResidual.angle);
  assert.ok((firstResidual.radialDistance || 0) > (firstBoard.radialDistance || 0));
  assert.ok((secondResidual.radialDistance || 0) > (secondBoard.radialDistance || 0));
  assertNoNodeOverlap(layout.nodes);
});

test('large terminal fan-outs form a non-overlapping local branch cluster without changing semantic depth', () => {
  const model = largeTerminalFanoutTopology();
  const layout = buildElectricalTreeLayout(model);
  const assets = layout.nodes.filter((item) => item.node.kind === 'SITE_ASSET');
  const fitted = fitElectricalTreeViewport(1200, 640, layout.width, layout.height);

  assert.equal(assets.length, 10);
  assert.deepEqual([...new Set(assets.map((item) => item.depth))], [2]);
  assert.deepEqual([...new Set(assets.map((item) => item.presentationRing))], [2]);
  assert.deepEqual([...new Set(assets.map((item) => item.clusterParentId))], ['board-1']);
  assert.deepEqual([...new Set(assets.map((item) => item.branchId))], ['board-1']);
  assert.ok(fitted.scale >= 0.45, `expected a legible overview scale, received ${fitted.scale}`);
  assert.ok(11 * fitted.scale >= 4.95, 'primary labels should retain at least a 4.95px rendered overview size');

  const grid = layout.nodes.find((item) => item.node.id === 'grid-1')!;
  const gridCenter = nodeCenter(grid);
  const quadrants = new Set(assets.map((asset) => {
    const center = nodeCenter(asset);
    return `${Math.sign(center.x - gridCenter.x)},${Math.sign(center.y - gridCenter.y)}`;
  }));
  assert.ok(quadrants.size >= 3);
  assertNoNodeOverlap(layout.nodes);

  const branchAsset = assets[assets.length - 1];
  const board = layout.nodes.find((item) => item.node.id === 'board-1')!;
  const branchPath = electricalTreeStraightPath(board, branchAsset);
  assert.match(branchPath, /^M .+ L .+$/);
  assert.equal((branchPath.match(/-?\d+(?:\.\d+)?/g) || []).length, 4);
  assert.deepEqual(buildElectricalTreeLayout(structuredClone(model)), layout);
});

test('multiple incoming grids are packed into separate centred constellation islands', () => {
  const model: ElectricalTreeReadModel = {
    installationId: 'installation-1',
    treeRevision: 1,
    nodes: [
      { id: 'grid-a', kind: 'GRID', name: 'Grid A' },
      { id: 'board-a', kind: 'BOARD', name: 'Board A' },
      { id: 'asset-a', kind: 'SITE_ASSET', name: 'Load A' },
      { id: 'grid-b', kind: 'GRID', name: 'Grid B' },
      { id: 'board-b', kind: 'BOARD', name: 'Board B' },
      { id: 'asset-b', kind: 'SITE_ASSET', name: 'Load B' },
    ],
    edges: [
      { id: 'fed-a-1', sourceNodeId: 'grid-a', targetNodeId: 'board-a', relationship: 'FED_FROM' },
      { id: 'fed-a-2', sourceNodeId: 'board-a', targetNodeId: 'asset-a', relationship: 'FED_FROM' },
      { id: 'fed-b-1', sourceNodeId: 'grid-b', targetNodeId: 'board-b', relationship: 'FED_FROM' },
      { id: 'fed-b-2', sourceNodeId: 'board-b', targetNodeId: 'asset-b', relationship: 'FED_FROM' },
    ],
    unresolved: [],
  };
  const layout = buildElectricalTreeLayout(model);
  const gridA = layout.nodes.find((item) => item.node.id === 'grid-a')!;
  const gridB = layout.nodes.find((item) => item.node.id === 'grid-b')!;

  assert.notEqual(nodeCenter(gridA).x, nodeCenter(gridB).x);
  assert.equal(nodeCenter(gridA).y, nodeCenter(gridB).y);
  assertNoNodeOverlap(layout.nodes);
});

test('saved electrical map centres override automatic positions in a stable design canvas', () => {
  const automatic = buildElectricalTreeLayout(topology());
  const automaticDocument = electricalTreeMapLayoutDocument(automatic);
  const board = automatic.nodes.find((item) => item.node.id === 'board-1')!;
  const movedDocument = moveElectricalTreeMapLayoutNode(
    automaticDocument,
    board.node.id,
    automaticDocument.canvas.width - board.width / 2,
    board.height / 2,
    board,
  );
  const arranged = applyElectricalTreeMapLayout(automatic, movedDocument);
  const movedBoard = arranged.nodes.find((item) => item.node.id === board.node.id)!;

  assert.equal(movedBoard.x + movedBoard.width / 2, movedDocument.canvas.width - board.width / 2);
  assert.equal(movedBoard.y + movedBoard.height / 2, board.height / 2);
  assert.equal(arranged.width, movedDocument.canvas.width);
  assert.equal(arranged.height, movedDocument.canvas.height);
  assert.notEqual(electricalTreeStraightPath(
    arranged.nodes.find((item) => item.node.id === 'grid-1')!,
    movedBoard,
  ), electricalTreeStraightPath(
    automatic.nodes.find((item) => item.node.id === 'grid-1')!,
    board,
  ));
  assert.equal(electricalTreeMapLayoutsEqual(
    electricalTreeMapLayoutDocument(arranged),
    movedDocument,
  ), true);
});

test('saved map application ignores removed IDs and leaves new topology nodes automatically placed', () => {
  const original = buildElectricalTreeLayout(topology());
  const originalDocument = electricalTreeMapLayoutDocument(original);
  const changedModel = topology();
  changedModel.nodes = changedModel.nodes.filter((node) => node.id !== 'asset-2');
  changedModel.edges = changedModel.edges.filter((edge) => (
    edge.sourceNodeId !== 'asset-2' && edge.targetNodeId !== 'asset-2'
  ));
  changedModel.nodes.push({ id: 'asset-new', kind: 'SITE_ASSET', name: 'New load' });
  changedModel.edges.push({
    id: 'fed-new',
    sourceNodeId: 'board-2',
    targetNodeId: 'asset-new',
    relationship: 'FED_FROM',
  });
  const changedAutomatic = buildElectricalTreeLayout(changedModel);
  const arranged = applyElectricalTreeMapLayout(changedAutomatic, {
    ...originalDocument,
    nodes: [
      ...originalDocument.nodes,
      { nodeId: 'removed-node', centerX: 12, centerY: 12 },
    ],
  });
  const automaticNew = changedAutomatic.nodes.find((item) => item.node.id === 'asset-new')!;
  const arrangedNew = arranged.nodes.find((item) => item.node.id === 'asset-new')!;

  assert.deepEqual(
    { x: arrangedNew.x, y: arrangedNew.y },
    { x: automaticNew.x, y: automaticNew.y },
  );
  assert.equal(arranged.nodes.some((item) => item.node.id === 'removed-node'), false);
  assert.equal(arranged.nodes.some((item) => item.node.id === 'asset-2'), false);
});

test('filtering an arranged map preserves complete-canvas coordinates', () => {
  const complete = buildElectricalTreeLayout(topology());
  const board = complete.nodes.find((item) => item.node.id === 'board-1')!;
  const filtered = filterElectricalTreeLayout(complete, new Set(['grid-1', 'board-1']));

  assert.equal(filtered.width, complete.width);
  assert.equal(filtered.height, complete.height);
  assert.deepEqual(filtered.nodes.map((item) => item.node.id), ['grid-1', 'board-1']);
  assert.deepEqual(filtered.nodes.find((item) => item.node.id === 'board-1'), board);
  assert.deepEqual(filtered.edges.map((edge) => edge.id), ['fed-1']);
});

test('pointer movement is converted from screen pixels to design coordinates at any zoom', () => {
  assert.deepEqual(electricalTreePointerDelta(30, -20, 0.5), { x: 60, y: -40 });
  assert.deepEqual(electricalTreePointerDelta(30, -20, 1), { x: 30, y: -20 });
  assert.deepEqual(electricalTreePointerDelta(30, -20, 2), { x: 15, y: -10 });
  assert.deepEqual(electricalTreePointerDelta(30, -20, 0), { x: 30, y: -20 });
  assert.equal(electricalTreePointerDragStarted(3, 4), false);
  assert.equal(electricalTreePointerDragStarted(3.6, 4.8), true);
  assert.equal(electricalTreePointerDragStarted(Number.NaN, 10), false);
});

test('map layout documents are sorted, rounded, clamped, and compare by presentation fields', () => {
  const automatic = buildElectricalTreeLayout(topology());
  const document = electricalTreeMapLayoutDocument(automatic);
  const board = automatic.nodes.find((item) => item.node.id === 'board-1')!;
  const moved = moveElectricalTreeMapLayoutNode(document, 'board-1', -500, 50_000, board);
  const movedBoard = moved.nodes.find((item) => item.nodeId === 'board-1')!;
  const saved = {
    ...moved,
    nodes: [...moved.nodes].reverse(),
    layoutRevision: 7,
    updatedAt: '2026-08-09T00:00:00.000Z',
  };

  assert.deepEqual(document.nodes.map((item) => item.nodeId), [...document.nodes.map((item) => item.nodeId)].sort());
  assert.equal(movedBoard.centerX, board.width / 2);
  assert.equal(movedBoard.centerY, document.canvas.height - board.height / 2);
  assert.equal(electricalTreeMapLayoutsEqual(moved, electricalTreeMapLayoutDraft(saved)), true);
  assert.equal(
    moveElectricalTreeMapLayoutNode(moved, 'missing', 10, 10, board),
    moved,
  );
  assert.equal(
    moveElectricalTreeMapLayoutNode(moved, 'board-1', Number.NaN, 10, board),
    moved,
  );
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
  assert.equal(multiParentById.get('asset-1')?.presentationRing, 1);
  assert.equal(multiParentById.get('board-1')?.presentationRing, 1);
  assert.notEqual(multiParentById.get('asset-1')?.branchId, multiParentById.get('board-1')?.branchId);
  assertNoNodeOverlap(multiParentLayout.nodes);
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
