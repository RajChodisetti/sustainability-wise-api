import type { TopologyTreeItem } from '@/modules/fleet/lib/topologyBeta';
import type { TopologyBetaEdge, TopologyBetaNode } from '@/modules/fleet/types/domain';

export const TOPOLOGY_TREE_NODE_WIDTH = 232;
export const TOPOLOGY_TREE_NODE_HEIGHT = 196;

const HORIZONTAL_GAP = 44;
const VERTICAL_GAP = 104;
const ROOT_GAP = 72;
const CANVAS_PADDING = 44;
const MINIMUM_CANVAS_WIDTH = 640;

export type TopologyTreeLayoutNode = {
  item: TopologyTreeItem;
  parent: TopologyBetaNode | null;
  x: number;
  y: number;
  depth: number;
  siblingIndex: number;
  siblingCount: number;
};

export type TopologyTreeLayoutEdge = {
  edge: TopologyBetaEdge;
  sourceMeterId: string;
  targetMeterId: string;
  path: string;
};

export type TopologyTreeLayout = {
  width: number;
  height: number;
  nodes: TopologyTreeLayoutNode[];
  edges: TopologyTreeLayoutEdge[];
};

type MeasuredTree = {
  item: TopologyTreeItem;
  children: MeasuredTree[];
  width: number;
};

function measureTree(item: TopologyTreeItem): MeasuredTree {
  const children = item.children.map(measureTree);
  const childrenWidth = children.reduce((total, child) => total + child.width, 0)
    + Math.max(0, children.length - 1) * HORIZONTAL_GAP;
  return {
    item,
    children,
    width: Math.max(TOPOLOGY_TREE_NODE_WIDTH, childrenWidth),
  };
}

function layoutHeight(nodes: TopologyTreeLayoutNode[]): number {
  const maximumDepth = nodes.reduce((depth, node) => Math.max(depth, node.depth), 0);
  return CANVAS_PADDING * 2
    + (maximumDepth + 1) * TOPOLOGY_TREE_NODE_HEIGHT
    + maximumDepth * VERTICAL_GAP;
}

export function buildTopologyTreeLayout(forest: TopologyTreeItem[]): TopologyTreeLayout {
  if (forest.length === 0) return { width: 0, height: 0, nodes: [], edges: [] };

  const measuredRoots = forest.map(measureTree);
  const forestWidth = measuredRoots.reduce((total, root) => total + root.width, 0)
    + Math.max(0, measuredRoots.length - 1) * ROOT_GAP;
  const width = Math.max(MINIMUM_CANVAS_WIDTH, forestWidth + CANVAS_PADDING * 2);
  const nodes: TopologyTreeLayoutNode[] = [];

  function placeTree(
    measured: MeasuredTree,
    left: number,
    depth: number,
    parent: TopologyBetaNode | null,
    siblingIndex: number,
    siblingCount: number,
  ): void {
    const centerX = left + measured.width / 2;
    nodes.push({
      item: measured.item,
      parent,
      x: Math.round(centerX - TOPOLOGY_TREE_NODE_WIDTH / 2),
      y: CANVAS_PADDING + depth * (TOPOLOGY_TREE_NODE_HEIGHT + VERTICAL_GAP),
      depth,
      siblingIndex,
      siblingCount,
    });

    const childrenWidth = measured.children.reduce((total, child) => total + child.width, 0)
      + Math.max(0, measured.children.length - 1) * HORIZONTAL_GAP;
    let childLeft = left + (measured.width - childrenWidth) / 2;
    measured.children.forEach((child, index) => {
      placeTree(
        child,
        childLeft,
        depth + 1,
        measured.item.node,
        index,
        measured.children.length,
      );
      childLeft += child.width + HORIZONTAL_GAP;
    });
  }

  let rootLeft = (width - forestWidth) / 2;
  measuredRoots.forEach((root, index) => {
    placeTree(root, rootLeft, 0, null, index, measuredRoots.length);
    rootLeft += root.width + ROOT_GAP;
  });

  const nodeByMeterId = new Map(nodes.map((node) => [node.item.node.meterId, node]));
  const edges = nodes.flatMap((target): TopologyTreeLayoutEdge[] => {
    const incomingEdge = target.item.incomingEdge;
    if (!incomingEdge || !target.parent) return [];
    const source = nodeByMeterId.get(target.parent.meterId);
    if (!source) return [];
    const sourceX = source.x + TOPOLOGY_TREE_NODE_WIDTH / 2;
    const sourceY = source.y + TOPOLOGY_TREE_NODE_HEIGHT;
    const targetX = target.x + TOPOLOGY_TREE_NODE_WIDTH / 2;
    const targetY = target.y;
    const branchY = Math.round(sourceY + (targetY - sourceY) / 2);
    return [{
      edge: incomingEdge,
      sourceMeterId: source.item.node.meterId,
      targetMeterId: target.item.node.meterId,
      path: `M ${sourceX} ${sourceY} V ${branchY} H ${targetX} V ${targetY}`,
    }];
  });

  return { width, height: layoutHeight(nodes), nodes, edges };
}
