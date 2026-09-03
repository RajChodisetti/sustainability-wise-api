import assert from 'node:assert/strict';
import test from 'node:test';
import type { TopologyTreeItem } from '@/modules/fleet/lib/topologyBeta';
import {
  buildTopologyTreeLayout,
  TOPOLOGY_TREE_NODE_HEIGHT,
  TOPOLOGY_TREE_NODE_WIDTH,
} from '@/modules/fleet/lib/topologyTreeLayout';

function tree(
  meterId: string,
  children: TopologyTreeItem[] = [],
  parentId?: string,
): TopologyTreeItem {
  return {
    node: { meterId, deviceId: `D-${meterId}`, label: meterId.toUpperCase(), state: 'CONFIDENT' },
    incomingEdge: parentId
      ? { parent: parentId, child: meterId, state: 'CONFIDENT', confidenceLabel: 'Strong support' }
      : null,
    children,
  };
}

function centerX(node: { x: number }) {
  return node.x + TOPOLOGY_TREE_NODE_WIDTH / 2;
}

test('topology tree layout centers parents and places siblings on one level', () => {
  const forest = [tree('root', [
    tree('left', [tree('left-a', [], 'left'), tree('left-b', [], 'left')], 'root'),
    tree('right', [], 'root'),
  ])];
  const layout = buildTopologyTreeLayout(forest);
  const nodes = new Map(layout.nodes.map((node) => [node.item.node.meterId, node]));
  const root = nodes.get('root')!;
  const left = nodes.get('left')!;
  const right = nodes.get('right')!;
  const leftA = nodes.get('left-a')!;
  const leftB = nodes.get('left-b')!;

  assert.equal(root.depth, 0);
  assert.equal(left.depth, 1);
  assert.equal(right.depth, 1);
  assert.equal(left.y, right.y);
  assert.equal(left.siblingIndex, 0);
  assert.equal(right.siblingIndex, 1);
  assert.equal(left.siblingCount, 2);
  assert.ok(centerX(left) < centerX(root));
  assert.ok(centerX(root) < centerX(right));
  assert.equal(leftA.y, leftB.y);
  assert.ok(centerX(leftA) < centerX(left));
  assert.ok(centerX(left) < centerX(leftB));
  for (const depth of [1, 2]) {
    const row = layout.nodes.filter((node) => node.depth === depth).sort((a, b) => a.x - b.x);
    row.slice(1).forEach((node, index) => {
      assert.ok(node.x >= row[index]!.x + TOPOLOGY_TREE_NODE_WIDTH);
    });
  }
  assert.equal(layout.edges.length, 4);
  assert.equal(layout.height, 3 * TOPOLOGY_TREE_NODE_HEIGHT + 2 * 104 + 2 * 44);
});

test('topology tree layout creates explicit parent-to-child connector geometry', () => {
  const layout = buildTopologyTreeLayout([tree('root', [tree('child', [], 'root')])]);
  const root = layout.nodes.find((node) => node.item.node.meterId === 'root')!;
  const child = layout.nodes.find((node) => node.item.node.meterId === 'child')!;
  const branchY = root.y + TOPOLOGY_TREE_NODE_HEIGHT
    + Math.round((child.y - root.y - TOPOLOGY_TREE_NODE_HEIGHT) / 2);

  assert.deepEqual(layout.edges[0], {
    edge: child.item.incomingEdge,
    sourceMeterId: 'root',
    targetMeterId: 'child',
    path: `M ${centerX(root)} ${root.y + TOPOLOGY_TREE_NODE_HEIGHT} V ${branchY} H ${centerX(child)} V ${child.y}`,
  });
});

test('topology tree layout separates independent roots and handles an empty forest', () => {
  const layout = buildTopologyTreeLayout([tree('one'), tree('two')]);
  assert.equal(layout.nodes[0]?.siblingCount, 2);
  assert.equal(layout.nodes[1]?.siblingIndex, 1);
  assert.ok(centerX(layout.nodes[0]!) < centerX(layout.nodes[1]!));
  assert.deepEqual(buildTopologyTreeLayout([]), { width: 0, height: 0, nodes: [], edges: [] });
});
