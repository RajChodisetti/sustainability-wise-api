import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeasurementAssignment,
  MeterDevice,
  MeterDeviceChannel,
} from '@/modules/installhub/types/domain';
import { electricalHierarchyRows } from './electricalPresentation';
import { measurementAssignments, meterDevices } from './workflow';

export const ELECTRICAL_TREE_NODE_WIDTH = 232;
export const ELECTRICAL_TREE_NODE_HEIGHT = 108;
const HORIZONTAL_GAP = 88;
const VERTICAL_GAP = 32;
const CANVAS_PADDING = 48;

export type ElectricalTreeLayoutNode = {
  node: ElectricalTreeReadModel['nodes'][number];
  x: number;
  y: number;
  depth: number;
  parentId?: string;
};

export type ElectricalTreeLayoutEdge = Omit<ElectricalTreeReadModel['edges'][number], 'relationship'> & {
  relationship: ElectricalTreeReadModel['edges'][number]['relationship'] | 'DERIVED_FROM';
  derived?: boolean;
};

export type ElectricalTreeLayout = {
  width: number;
  height: number;
  nodes: ElectricalTreeLayoutNode[];
  edges: ElectricalTreeLayoutEdge[];
};

export type ElectricalTreeNodeContext = {
  parentId?: string;
  derivedParentId?: string;
  childIds: string[];
  derivedChildIds: string[];
  descendantIds: string[];
  measuredByIds: string[];
  measuresIds: string[];
};

export type ResolvedElectricalMeasurementDetail = {
  assignment: MeasurementAssignment;
  meter: MeterDevice;
  channels: MeterDeviceChannel[];
};

export type ElectricalTreeViewport = {
  x: number;
  y: number;
  scale: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces a deterministic left-to-right forest from the confirmed electrical
 * topology. FED_FROM controls placement; MEASURES remains a visual overlay.
 */
export function buildElectricalTreeLayout(
  model?: ElectricalTreeReadModel,
): ElectricalTreeLayout {
  if (!model?.nodes.length) return { width: 0, height: 0, nodes: [], edges: [] };

  const rows = electricalHierarchyRows(model);
  const rowById = new Map(rows.map((row) => [row.node.id, row]));
  const orderById = new Map(rows.map((row, index) => [row.node.id, index]));
  const parentById = new Map<string, string>();
  const childrenById = new Map<string, string[]>();

  for (const row of rows) {
    const candidateParentId = row.depth > 0
      ? row.parent?.id || (row.node.kind === 'VIRTUAL_RESIDUAL' ? row.node.parentNodeId : undefined)
      : undefined;
    if (!candidateParentId || !rowById.has(candidateParentId) || candidateParentId === row.node.id) continue;
    parentById.set(row.node.id, candidateParentId);
    const children = childrenById.get(candidateParentId) || [];
    if (!children.includes(row.node.id)) children.push(row.node.id);
    childrenById.set(candidateParentId, children);
  }
  for (const children of childrenById.values()) {
    children.sort((left, right) => (orderById.get(left) || 0) - (orderById.get(right) || 0));
  }

  const yById = new Map<string, number>();
  const visited = new Set<string>();
  let nextLeafY = CANVAS_PADDING;

  function place(nodeId: string, path: Set<string>): number {
    const existing = yById.get(nodeId);
    if (existing !== undefined) return existing;
    if (path.has(nodeId)) {
      const cycleY = nextLeafY;
      nextLeafY += ELECTRICAL_TREE_NODE_HEIGHT + VERTICAL_GAP;
      yById.set(nodeId, cycleY);
      return cycleY;
    }
    const nextPath = new Set(path).add(nodeId);
    const children = (childrenById.get(nodeId) || []).filter((childId) => !nextPath.has(childId));
    let y: number;
    if (!children.length) {
      y = nextLeafY;
      nextLeafY += ELECTRICAL_TREE_NODE_HEIGHT + VERTICAL_GAP;
    } else {
      const childYs = children.map((childId) => place(childId, nextPath));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }
    yById.set(nodeId, y);
    visited.add(nodeId);
    return y;
  }

  const roots = rows.filter((row) => !parentById.has(row.node.id));
  for (const root of roots) place(root.node.id, new Set());
  for (const row of rows) {
    if (!visited.has(row.node.id)) place(row.node.id, new Set());
  }

  const nodes = rows.map((row) => ({
    node: row.node,
    x: CANVAS_PADDING + row.depth * (ELECTRICAL_TREE_NODE_WIDTH + HORIZONTAL_GAP),
    y: yById.get(row.node.id) || CANVAS_PADDING,
    depth: row.depth,
    ...(parentById.has(row.node.id) ? { parentId: parentById.get(row.node.id) } : {}),
  }));
  const nodeIds = new Set(nodes.map((item) => item.node.id));
  const seenEdgeIds = new Set<string>();
  const edges: ElectricalTreeLayoutEdge[] = [...model.edges]
    .sort((left, right) => (
      left.relationship.localeCompare(right.relationship)
      || left.sourceNodeId.localeCompare(right.sourceNodeId)
      || left.targetNodeId.localeCompare(right.targetNodeId)
      || left.id.localeCompare(right.id)
    ))
    .filter((edge) => {
      const key = `${edge.relationship}:${edge.id}`;
      if (
        !nodeIds.has(edge.sourceNodeId)
        || !nodeIds.has(edge.targetNodeId)
        || seenEdgeIds.has(key)
        || (edge.relationship === 'FED_FROM' && parentById.get(edge.targetNodeId) !== edge.sourceNodeId)
      ) return false;
      seenEdgeIds.add(key);
      return true;
    });
  const fedTargets = new Set(edges.filter((edge) => edge.relationship === 'FED_FROM').map((edge) => edge.targetNodeId));
  for (const item of nodes) {
    if (!item.parentId || fedTargets.has(item.node.id)) continue;
    edges.push({
      id: `derived-parent:${item.parentId}:${item.node.id}`,
      sourceNodeId: item.parentId,
      targetNodeId: item.node.id,
      relationship: 'DERIVED_FROM',
      derived: true,
    });
  }

  const maxDepth = Math.max(0, ...nodes.map((item) => item.depth));
  const maxY = Math.max(CANVAS_PADDING, ...nodes.map((item) => item.y));
  return {
    width: CANVAS_PADDING * 2 + ELECTRICAL_TREE_NODE_WIDTH + maxDepth * (ELECTRICAL_TREE_NODE_WIDTH + HORIZONTAL_GAP),
    height: maxY + ELECTRICAL_TREE_NODE_HEIGHT + CANVAS_PADDING,
    nodes,
    edges,
  };
}

function appendUnique(items: string[], value: string) {
  if (!items.includes(value)) items.push(value);
}

export function electricalTreeNodeContexts(
  layout: ElectricalTreeLayout,
): Map<string, ElectricalTreeNodeContext> {
  const contexts = new Map<string, ElectricalTreeNodeContext>(layout.nodes.map((item) => [
    item.node.id,
    {
      childIds: [],
      derivedChildIds: [],
      descendantIds: [],
      measuredByIds: [],
      measuresIds: [],
    },
  ]));
  for (const edge of layout.edges) {
    const source = contexts.get(edge.sourceNodeId);
    const target = contexts.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (edge.relationship === 'FED_FROM') {
      if (!target.parentId) target.parentId = edge.sourceNodeId;
      appendUnique(source.childIds, edge.targetNodeId);
    } else if (edge.relationship === 'DERIVED_FROM') {
      if (!target.derivedParentId) target.derivedParentId = edge.sourceNodeId;
      appendUnique(source.derivedChildIds, edge.targetNodeId);
    } else {
      appendUnique(source.measuresIds, edge.targetNodeId);
      appendUnique(target.measuredByIds, edge.sourceNodeId);
    }
  }
  const nodeOrder = new Map(layout.nodes.map((item, index) => [item.node.id, index]));
  const byNodeOrder = (left: string, right: string) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0);
  for (const context of contexts.values()) {
    context.childIds.sort(byNodeOrder);
    context.derivedChildIds.sort(byNodeOrder);
    context.measuredByIds.sort(byNodeOrder);
    context.measuresIds.sort(byNodeOrder);
  }
  for (const [nodeId, context] of contexts) {
    const queued = [...context.childIds, ...context.derivedChildIds];
    const visited = new Set<string>([nodeId]);
    while (queued.length) {
      const current = queued.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      context.descendantIds.push(current);
      const childContext = contexts.get(current);
      if (childContext) queued.push(...childContext.childIds, ...childContext.derivedChildIds);
    }
  }
  return contexts;
}

export function electricalTreeNodeContext(
  layout: ElectricalTreeLayout,
  nodeId: string,
): ElectricalTreeNodeContext {
  return electricalTreeNodeContexts(layout).get(nodeId) || {
    childIds: [],
    derivedChildIds: [],
    descendantIds: [],
    measuredByIds: [],
    measuresIds: [],
  };
}

function assignmentTargetNodeId(assignment: MeasurementAssignment): string | null {
  if (assignment.target.kind === 'BOARD') return assignment.target.boardId;
  if (assignment.target.kind === 'SITE_ASSET') return assignment.target.siteAssetId;
  if (assignment.target.kind === 'GRID_BOUNDARY') return assignment.target.gridSupplyId;
  return null;
}

function measurementEdgeAssignmentId(edge: ElectricalTreeLayoutEdge): string | null {
  if (edge.relationship !== 'MEASURES') return null;
  if (edge.id.startsWith('measures:')) return edge.id.slice('measures:'.length);
  if (edge.id.startsWith('measure_')) return edge.id.slice('measure_'.length);
  return null;
}

/**
 * Joins exact meter/channel identity only through canonical MEASURES edges.
 * A raw CONFIRMED assignment is not sufficient because semantic projection can
 * reject wrong-board, wrong-purpose, duplicate, or otherwise invalid groups.
 */
export function resolvedElectricalMeasurementDetails(
  tree: InstallationTree,
  model: ElectricalTreeReadModel,
  targetNodeId: string,
): ResolvedElectricalMeasurementDetail[] {
  const assignmentById = new Map(measurementAssignments(tree).map((assignment) => [assignment.id, assignment]));
  const meterById = new Map(meterDevices(tree).map((meter) => [meter.id, meter]));
  const emitted = new Set<string>();
  const details: ResolvedElectricalMeasurementDetail[] = [];
  for (const edge of model.edges) {
    if (edge.relationship !== 'MEASURES' || edge.targetNodeId !== targetNodeId) continue;
    const assignmentId = measurementEdgeAssignmentId(edge);
    if (!assignmentId || emitted.has(assignmentId)) continue;
    const assignment = assignmentById.get(assignmentId);
    const meter = assignment ? meterById.get(assignment.meterId) : undefined;
    if (
      !assignment
      || !meter
      || assignment.status !== 'CONFIRMED'
      || assignmentTargetNodeId(assignment) !== edge.targetNodeId
      || meter.installedOnBoardId !== edge.sourceNodeId
      || new Set(assignment.channelIds).size !== assignment.channelIds.length
    ) continue;
    const channelById = new Map(meter.channels.map((channel) => [channel.id, channel]));
    const channels = assignment.channelIds.map((channelId) => channelById.get(channelId));
    if (channels.some((channel) => !channel)) continue;
    emitted.add(assignmentId);
    details.push({
      assignment,
      meter,
      channels: (channels as MeterDeviceChannel[]).sort((left, right) => left.ordinal - right.ordinal),
    });
  }
  return details;
}

export function fitElectricalTreeViewport(
  viewportWidth: number,
  viewportHeight: number,
  layoutWidth: number,
  layoutHeight: number,
  padding = 32,
): ElectricalTreeViewport {
  if (viewportWidth <= 0 || viewportHeight <= 0 || layoutWidth <= 0 || layoutHeight <= 0) {
    return { x: padding, y: padding, scale: 1 };
  }
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = clamp(Math.min(availableWidth / layoutWidth, availableHeight / layoutHeight), 0.005, 1.2);
  return {
    scale,
    x: (viewportWidth - layoutWidth * scale) / 2,
    y: (viewportHeight - layoutHeight * scale) / 2,
  };
}

export function zoomElectricalTreeViewport(
  viewport: ElectricalTreeViewport,
  nextScale: number,
  anchorX: number,
  anchorY: number,
): ElectricalTreeViewport {
  const scale = clamp(nextScale, 0.005, 2);
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: anchorX - (anchorX - viewport.x) * ratio,
    y: anchorY - (anchorY - viewport.y) * ratio,
  };
}
