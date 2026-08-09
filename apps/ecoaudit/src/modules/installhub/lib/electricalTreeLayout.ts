import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeasurementAssignment,
  MeterDevice,
  MeterDeviceChannel,
} from '@/modules/installhub/types/domain';
import { electricalHierarchyRows } from './electricalPresentation';
import { measurementAssignments, meterDeviceName, meterDevices } from './workflow';

export const ELECTRICAL_TREE_NODE_WIDTH = 148;
export const ELECTRICAL_TREE_NODE_HEIGHT = 116;
const ELECTRICAL_TREE_BOARD_WIDTH = 214;
const ELECTRICAL_TREE_BOARD_HEIGHT = 172;
const ELECTRICAL_TREE_GRID_WIDTH = 128;
const ELECTRICAL_TREE_GRID_HEIGHT = 116;
const ELECTRICAL_TREE_RESIDUAL_WIDTH = 144;
const ELECTRICAL_TREE_RESIDUAL_HEIGHT = 88;
const HORIZONTAL_GAP = 136;
const VERTICAL_GAP = 36;
const PACKED_TERMINAL_MAX_ROWS = 5;
const PACKED_TERMINAL_LANE_GAP = 44;
const CANVAS_PADDING = 64;

export type ElectricalTreeNodeSize = {
  width: number;
  height: number;
};

export function electricalTreeNodeSize(
  kind: ElectricalTreeReadModel['nodes'][number]['kind'],
): ElectricalTreeNodeSize {
  if (kind === 'BOARD') {
    return { width: ELECTRICAL_TREE_BOARD_WIDTH, height: ELECTRICAL_TREE_BOARD_HEIGHT };
  }
  if (kind === 'GRID') {
    return { width: ELECTRICAL_TREE_GRID_WIDTH, height: ELECTRICAL_TREE_GRID_HEIGHT };
  }
  if (kind === 'VIRTUAL_RESIDUAL') {
    return { width: ELECTRICAL_TREE_RESIDUAL_WIDTH, height: ELECTRICAL_TREE_RESIDUAL_HEIGHT };
  }
  return { width: ELECTRICAL_TREE_NODE_WIDTH, height: ELECTRICAL_TREE_NODE_HEIGHT };
}

export type ElectricalTreeLayoutNode = {
  node: ElectricalTreeReadModel['nodes'][number];
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentId?: string;
  presentationLane?: number;
  presentationRow?: number;
  packedTerminal?: boolean;
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

export type ElectricalTreeNodeCardSummary = {
  devices: Array<{
    id: string;
    name: string;
    serialNumber?: string;
    channelOrdinals: number[];
  }>;
  loadLabels: string[];
  assignedAssets: Array<{
    id: string;
    name: string;
    displayCode?: string;
  }>;
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
  const depthById = new Map<string, number>();

  function selectedParentDepth(nodeId: string, path = new Set<string>()): number {
    const cached = depthById.get(nodeId);
    if (cached !== undefined) return cached;
    const parentId = parentById.get(nodeId);
    if (!parentId || !rowById.has(parentId) || path.has(nodeId)) {
      depthById.set(nodeId, 0);
      return 0;
    }
    const parentDepth = selectedParentDepth(parentId, new Set(path).add(nodeId));
    const cycleRootDepth = depthById.get(nodeId);
    if (cycleRootDepth !== undefined) return cycleRootDepth;
    const depth = parentDepth + 1;
    depthById.set(nodeId, depth);
    return depth;
  }

  for (const row of rows) selectedParentDepth(row.node.id);

  const sizeById = new Map(rows.map((row) => [row.node.id, electricalTreeNodeSize(row.node.kind)]));
  const centerYById = new Map<string, number>();
  const presentationById = new Map<string, { lane: number; row: number }>();
  type ChildUnit =
    | { kind: 'NODE'; nodeIds: [string] }
    | { kind: 'PACKED_TERMINALS'; nodeIds: string[]; laneCount: number; rowCount: number };
  const childUnitsById = new Map<string, ChildUnit[]>();
  const subtreeHeightById = new Map<string, number>();

  function childUnits(nodeId: string): ChildUnit[] {
    const cached = childUnitsById.get(nodeId);
    if (cached) return cached;
    const children = childrenById.get(nodeId) || [];
    const packableIds = children.filter((childId) => (
      rowById.get(childId)?.node.kind === 'SITE_ASSET'
      && !(childrenById.get(childId)?.length)
    ));
    if (packableIds.length <= PACKED_TERMINAL_MAX_ROWS) {
      const units: ChildUnit[] = children.map((childId) => ({ kind: 'NODE', nodeIds: [childId] }));
      childUnitsById.set(nodeId, units);
      return units;
    }
    const packable = new Set(packableIds);
    const laneCount = Math.ceil(packableIds.length / PACKED_TERMINAL_MAX_ROWS);
    const rowCount = Math.ceil(packableIds.length / laneCount);
    const units: ChildUnit[] = [];
    let packedInserted = false;
    for (const childId of children) {
      if (!packable.has(childId)) {
        units.push({ kind: 'NODE', nodeIds: [childId] });
      } else if (!packedInserted) {
        units.push({ kind: 'PACKED_TERMINALS', nodeIds: packableIds, laneCount, rowCount });
        packedInserted = true;
      }
    }
    childUnitsById.set(nodeId, units);
    return units;
  }

  function packedUnitHeight(unit: Extract<ChildUnit, { kind: 'PACKED_TERMINALS' }>): number {
    const tallestNode = Math.max(...unit.nodeIds.map((nodeId) => (
      sizeById.get(nodeId)?.height || ELECTRICAL_TREE_NODE_HEIGHT
    )));
    return unit.rowCount * tallestNode + Math.max(0, unit.rowCount - 1) * VERTICAL_GAP;
  }

  function subtreeHeight(nodeId: string, path = new Set<string>()): number {
    const cached = subtreeHeightById.get(nodeId);
    if (cached !== undefined) return cached;
    const ownHeight = sizeById.get(nodeId)?.height || ELECTRICAL_TREE_NODE_HEIGHT;
    if (path.has(nodeId)) return ownHeight;
    const nextPath = new Set(path).add(nodeId);
    const units = childUnits(nodeId);
    const childrenHeight = units.reduce((total, unit) => (
      total + (unit.kind === 'PACKED_TERMINALS'
        ? packedUnitHeight(unit)
        : subtreeHeight(unit.nodeIds[0], nextPath))
    ), 0) + Math.max(0, units.length - 1) * VERTICAL_GAP;
    const height = Math.max(ownHeight, childrenHeight);
    subtreeHeightById.set(nodeId, height);
    return height;
  }

  function placeNode(nodeId: string, top: number, path = new Set<string>()) {
    if (centerYById.has(nodeId)) return;
    const height = subtreeHeight(nodeId, path);
    centerYById.set(nodeId, top + height / 2);
    if (path.has(nodeId)) return;
    const nextPath = new Set(path).add(nodeId);
    const units = childUnits(nodeId);
    const unitHeights = units.map((unit) => (
      unit.kind === 'PACKED_TERMINALS'
        ? packedUnitHeight(unit)
        : subtreeHeight(unit.nodeIds[0], nextPath)
    ));
    const totalChildrenHeight = unitHeights.reduce((total, unitHeight) => total + unitHeight, 0)
      + Math.max(0, units.length - 1) * VERTICAL_GAP;
    let childTop = top + (height - totalChildrenHeight) / 2;
    units.forEach((unit, unitIndex) => {
      if (unit.kind === 'NODE') {
        placeNode(unit.nodeIds[0], childTop, nextPath);
      } else {
        const tallestNode = Math.max(...unit.nodeIds.map((childId) => (
          sizeById.get(childId)?.height || ELECTRICAL_TREE_NODE_HEIGHT
        )));
        unit.nodeIds.forEach((childId, childIndex) => {
          const lane = Math.floor(childIndex / unit.rowCount);
          const row = childIndex % unit.rowCount;
          centerYById.set(
            childId,
            childTop + row * (tallestNode + VERTICAL_GAP) + tallestNode / 2,
          );
          presentationById.set(childId, { lane, row });
        });
      }
      childTop += unitHeights[unitIndex] + VERTICAL_GAP;
    });
  }

  const roots = rows.filter((row) => !parentById.has(row.node.id));
  let nextRootTop = CANVAS_PADDING;
  for (const root of roots) {
    placeNode(root.node.id, nextRootTop);
    nextRootTop += subtreeHeight(root.node.id) + VERTICAL_GAP;
  }
  for (const row of rows) {
    if (centerYById.has(row.node.id)) continue;
    placeNode(row.node.id, nextRootTop);
    nextRootTop += subtreeHeight(row.node.id) + VERTICAL_GAP;
  }

  const maxDepth = Math.max(0, ...rows.map((row) => depthById.get(row.node.id) || 0));
  const maxWidthByDepth = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const row of rows) {
    const width = sizeById.get(row.node.id)?.width || ELECTRICAL_TREE_NODE_WIDTH;
    const depth = depthById.get(row.node.id) || 0;
    maxWidthByDepth[depth] = Math.max(maxWidthByDepth[depth], width);
  }
  const xByDepth = [CANVAS_PADDING];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    xByDepth[depth] = xByDepth[depth - 1] + maxWidthByDepth[depth - 1] + HORIZONTAL_GAP;
  }
  const nodes = rows.map((row) => {
    const size = sizeById.get(row.node.id) || electricalTreeNodeSize(row.node.kind);
    const presentation = presentationById.get(row.node.id);
    const depth = depthById.get(row.node.id) || 0;
    return {
      node: row.node,
      x: xByDepth[depth] + (presentation?.lane || 0) * (size.width + PACKED_TERMINAL_LANE_GAP),
      y: (centerYById.get(row.node.id) || CANVAS_PADDING) - size.height / 2,
      width: size.width,
      height: size.height,
      depth,
      ...(parentById.has(row.node.id) ? { parentId: parentById.get(row.node.id) } : {}),
      ...(presentation ? {
        presentationLane: presentation.lane,
        presentationRow: presentation.row,
        packedTerminal: true,
      } : {}),
    };
  });
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

  const maxRight = Math.max(CANVAS_PADDING, ...nodes.map((item) => item.x + item.width));
  const maxBottom = Math.max(CANVAS_PADDING, ...nodes.map((item) => item.y + item.height));
  return {
    width: maxRight + CANVAS_PADDING,
    height: maxBottom + CANVAS_PADDING,
    nodes,
    edges,
  };
}

function cleanCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Produces the orthogonal, single-line-diagram route used for supply,
 * measurement, and calculated-residual connectors.
 */
export function electricalTreeOrthogonalPath(
  source: ElectricalTreeLayoutNode,
  target: ElectricalTreeLayoutNode,
  options: { sourceYOffset?: number; targetYOffset?: number; trunkRatio?: number } = {},
): string {
  if (source.node.id === target.node.id) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height / 2 + (options.sourceYOffset || 0);
    const loopX = sourceX + 30;
    const targetX = source.x + source.width * 0.68;
    const targetY = source.y + source.height;
    const loopY = targetY + 24;
    return `M ${cleanCoordinate(sourceX)} ${cleanCoordinate(sourceY)} H ${cleanCoordinate(loopX)} V ${cleanCoordinate(loopY)} H ${cleanCoordinate(targetX)} V ${cleanCoordinate(targetY)}`;
  }
  const movingRight = target.x >= source.x;
  const sourceX = movingRight ? source.x + source.width : source.x;
  const targetX = movingRight ? target.x : target.x + target.width;
  const sourceY = source.y + source.height / 2 + (options.sourceYOffset || 0);
  const targetY = target.y + target.height / 2 + (options.targetYOffset || 0);
  const trunkRatio = clamp(options.trunkRatio ?? 0.46, 0.2, 0.8);
  const presentationLane = target.presentationLane || 0;
  const firstLaneX = target.x - presentationLane * (target.width + PACKED_TERMINAL_LANE_GAP);
  const trunkDestinationX = target.packedTerminal ? firstLaneX : targetX;
  const trunkX = sourceX + (trunkDestinationX - sourceX) * trunkRatio;
  if (movingRight && target.packedTerminal && presentationLane > 0) {
    const routeY = target.y - VERTICAL_GAP / 2;
    return `M ${cleanCoordinate(sourceX)} ${cleanCoordinate(sourceY)} H ${cleanCoordinate(trunkX)} V ${cleanCoordinate(routeY)} H ${cleanCoordinate(targetX)} V ${cleanCoordinate(targetY)}`;
  }
  return `M ${cleanCoordinate(sourceX)} ${cleanCoordinate(sourceY)} H ${cleanCoordinate(trunkX)} V ${cleanCoordinate(targetY)} H ${cleanCoordinate(targetX)}`;
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

function readableElectricalCode(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => /^(AC|CT|DB|EV|HVAC|PV)$/i.test(word)
      ? word.toUpperCase()
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function comparableElectricalLabel(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Builds the compact, human-readable metadata shown on each map card from the
 * same canonical MEASURES edges used by the graph. Installed-but-unassigned
 * devices are included on their switchboard, but never presented as measuring
 * a load or asset until a confirmed assignment exists.
 */
export function electricalTreeNodeCardSummary(
  tree: InstallationTree,
  model: ElectricalTreeReadModel,
  nodeId: string,
): ElectricalTreeNodeCardSummary {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const node = nodeById.get(nodeId);
  if (!node) return { devices: [], loadLabels: [], assignedAssets: [] };

  const measurementTargetIds = new Set<string>([nodeId]);
  if (node.kind === 'BOARD') {
    for (const edge of model.edges) {
      if (edge.relationship === 'MEASURES' && edge.sourceNodeId === nodeId) {
        measurementTargetIds.add(edge.targetNodeId);
      }
    }
  }

  const details = [...measurementTargetIds].flatMap((targetNodeId) => (
    resolvedElectricalMeasurementDetails(tree, model, targetNodeId)
      .filter((detail) => node.kind !== 'BOARD' || detail.meter.installedOnBoardId === nodeId)
  ));
  const detailsByMeterId = new Map<string, ResolvedElectricalMeasurementDetail[]>();
  for (const detail of details) {
    const meterDetails = detailsByMeterId.get(detail.meter.id) || [];
    meterDetails.push(detail);
    detailsByMeterId.set(detail.meter.id, meterDetails);
  }

  if (node.kind === 'BOARD') {
    for (const meter of meterDevices(tree)) {
      if (meter.installedOnBoardId !== nodeId || (meter.lifecycleState ?? 'ACTIVE') !== 'ACTIVE') continue;
      if (!detailsByMeterId.has(meter.id)) detailsByMeterId.set(meter.id, []);
    }
  }

  const devices = [...detailsByMeterId.entries()]
    .map(([id, meterDetails]) => {
      const meter = meterDetails[0]?.meter || meterDevices(tree).find((candidate) => candidate.id === id);
      if (!meter) return null;
      return {
        id,
        name: meterDeviceName(meter),
        ...(meter.serialNumber.trim() ? { serialNumber: meter.serialNumber.trim() } : {}),
        channelOrdinals: [...new Set(meterDetails.flatMap((detail) => (
          detail.channels.map((channel) => channel.ordinal)
        )))].sort((left, right) => left - right),
      };
    })
    .filter((device): device is NonNullable<typeof device> => Boolean(device))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const loadLabels = [...new Set(details.flatMap((detail) => detail.channels.flatMap((channel) => {
    const label = channel.customLoadTypeName?.trim()
      || readableElectricalCode(channel.loadTypeCode)
      || channel.description?.trim()
      || (channel.purpose === 'MAIN_SUPPLY'
        ? 'Main supply'
        : channel.purpose === 'SUB_CIRCUIT'
          ? 'Sub-circuit'
          : null);
    return label ? [label] : [];
  })))].sort((left, right) => left.localeCompare(right));
  if (node.kind === 'SITE_ASSET' && node.typeLabel?.trim()) {
    const typeLabel = node.typeLabel.trim();
    const comparableType = comparableElectricalLabel(typeLabel);
    const channelLoads = loadLabels.filter((label) => {
      const comparableLoad = comparableElectricalLabel(label);
      return !comparableType.includes(comparableLoad) && !comparableLoad.includes(comparableType);
    });
    loadLabels.splice(0, loadLabels.length, typeLabel, ...channelLoads);
  }

  const assignedAssets = [...new Map(model.edges.flatMap((edge) => {
    if (edge.relationship !== 'MEASURES' || edge.sourceNodeId !== nodeId) return [];
    const target = nodeById.get(edge.targetNodeId);
    if (
      target?.kind !== 'SITE_ASSET'
      || !resolvedElectricalMeasurementDetails(tree, model, target.id).some(
        (detail) => detail.meter.installedOnBoardId === nodeId,
      )
    ) return [];
    return [[target.id, {
      id: target.id,
      name: target.name,
      ...(target.displayCode ? { displayCode: target.displayCode } : {}),
    }] as const];
  })).values()].sort((left, right) => (
    (left.displayCode || left.name).localeCompare(right.displayCode || right.name)
    || left.id.localeCompare(right.id)
  ));

  return { devices, loadLabels, assignedAssets };
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
