import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeasurementAssignment,
  MeterDevice,
  MeterDeviceChannel,
} from '@/modules/installhub/types/domain';
import { electricalHierarchyRows } from './electricalPresentation';
import { measurementAssignments, meterDeviceName, meterDevices } from './workflow';

export const ELECTRICAL_TREE_NODE_WIDTH = 232;
export const ELECTRICAL_TREE_NODE_HEIGHT = 470;
const ELECTRICAL_TREE_BOARD_WIDTH = 296;
const ELECTRICAL_TREE_BOARD_HEIGHT = 548;
const ELECTRICAL_TREE_GRID_WIDTH = 328;
const ELECTRICAL_TREE_GRID_HEIGHT = 540;
const ELECTRICAL_TREE_RESIDUAL_WIDTH = 232;
const ELECTRICAL_TREE_RESIDUAL_HEIGHT = 432;
const CANVAS_PADDING = 72;
const ISLAND_GAP = 96;
const SIBLING_GAP = 24;
const HIERARCHY_LEVEL_GAP = 64;

export type ElectricalTreeNodeSize = {
  width: number;
  height: number;
};

export type ElectricalTreeNodeVisualSize = ElectricalTreeNodeSize & {
  haloSize: number;
  iconSize: number;
};

export const ELECTRICAL_TREE_NODE_DESCRIPTION_TYPOGRAPHY = {
  symbolLabel: { previousFontSize: 9, fontSize: 27 },
  nodeName: { previousFontSize: 11, fontSize: 33 },
  compactDetail: { previousFontSize: 7, fontSize: 21 },
  secondaryDetail: { previousFontSize: 8, fontSize: 24 },
} as const;

/**
 * Keeps the enlarged artwork boxes coupled to the minimum halo and footprint
 * required for labels, drag bounds, connector clipping and collision clearance.
 * Persisted layout centres remain unchanged.
 */
const ELECTRICAL_TREE_NODE_VISUAL_SIZES: Readonly<Record<
  ElectricalTreeReadModel['nodes'][number]['kind'],
  ElectricalTreeNodeVisualSize
>> = {
  GRID: {
    width: ELECTRICAL_TREE_GRID_WIDTH,
    height: ELECTRICAL_TREE_GRID_HEIGHT,
    haloSize: 312,
    iconSize: 280,
  },
  BOARD: {
    width: ELECTRICAL_TREE_BOARD_WIDTH,
    height: ELECTRICAL_TREE_BOARD_HEIGHT,
    haloSize: 280,
    iconSize: 252,
  },
  SITE_ASSET: {
    width: ELECTRICAL_TREE_NODE_WIDTH,
    height: ELECTRICAL_TREE_NODE_HEIGHT,
    haloSize: 216,
    iconSize: 196,
  },
  VIRTUAL_RESIDUAL: {
    width: ELECTRICAL_TREE_RESIDUAL_WIDTH,
    height: ELECTRICAL_TREE_RESIDUAL_HEIGHT,
    haloSize: 216,
    iconSize: 196,
  },
};

export function electricalTreeNodeVisualSize(
  kind: ElectricalTreeReadModel['nodes'][number]['kind'],
): ElectricalTreeNodeVisualSize {
  return { ...ELECTRICAL_TREE_NODE_VISUAL_SIZES[kind] };
}

export function electricalTreeNodeSize(
  kind: ElectricalTreeReadModel['nodes'][number]['kind'],
): ElectricalTreeNodeSize {
  const { width, height } = electricalTreeNodeVisualSize(kind);
  return { width, height };
}

export type ElectricalTreeLayoutNode = {
  node: ElectricalTreeReadModel['nodes'][number];
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentId?: string;
  /** Legacy radial metadata retained for compatibility; depth remains semantic. */
  angle?: number;
  radialDistance?: number;
  presentationRing?: number;
  branchId?: string;
  clusterParentId?: string;
  /** Legacy lane metadata retained for callers compiled against the prior layout. */
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

export type ElectricalMapLayoutDocument = Pick<
  NonNullable<ElectricalTreeReadModel['mapLayout']>,
  'version' | 'canvas' | 'nodes'
>;

export type SavedElectricalMapLayout = NonNullable<ElectricalTreeReadModel['mapLayout']>;

const ELECTRICAL_MAP_MIN_CANVAS_SIZE = 320;
const ELECTRICAL_MAP_MAX_CANVAS_SIZE = 20_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces a deterministic top-to-bottom hierarchy from the confirmed topology.
 * FED_FROM controls placement; MEASURES remains a visual overlay. Every semantic
 * depth shares one vertical level, sibling subtrees stay contiguous, and each
 * parent is centred over the complete span reserved for its children.
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
    children.sort((left, right) => (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0));
  }

  // A malformed Draft can contain a supply cycle. Break one stable parent link
  // per cycle so every node still appears in a deterministic forest.
  for (const row of rows) {
    const path: string[] = [];
    const pathIndexById = new Map<string, number>();
    let currentId: string | undefined = row.node.id;
    while (currentId) {
      const cycleIndex = pathIndexById.get(currentId);
      if (cycleIndex !== undefined) {
        const cycleRootId = path
          .slice(cycleIndex)
          .sort((left, right) => (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0))[0];
        const formerParentId = parentById.get(cycleRootId);
        parentById.delete(cycleRootId);
        if (formerParentId) {
          childrenById.set(
            formerParentId,
            (childrenById.get(formerParentId) || []).filter((nodeId) => nodeId !== cycleRootId),
          );
        }
        break;
      }
      pathIndexById.set(currentId, path.length);
      path.push(currentId);
      currentId = parentById.get(currentId);
    }
  }

  const depthById = new Map<string, number>();
  function selectedParentDepth(nodeId: string): number {
    const cached = depthById.get(nodeId);
    if (cached !== undefined) return cached;
    const parentId = parentById.get(nodeId);
    if (!parentId || !rowById.has(parentId)) {
      depthById.set(nodeId, 0);
      return 0;
    }
    const depth = selectedParentDepth(parentId) + 1;
    depthById.set(nodeId, depth);
    return depth;
  }
  for (const row of rows) selectedParentDepth(row.node.id);

  const sizeById = new Map(rows.map((row) => [row.node.id, electricalTreeNodeSize(row.node.kind)]));
  const subtreeWidthById = new Map<string, number>();
  function subtreeWidth(nodeId: string): number {
    const cached = subtreeWidthById.get(nodeId);
    if (cached !== undefined) return cached;
    const children = childrenById.get(nodeId) || [];
    const childrenWidth = children.reduce((total, childId) => total + subtreeWidth(childId), 0)
      + Math.max(0, children.length - 1) * SIBLING_GAP;
    const width = Math.max(sizeById.get(nodeId)!.width, childrenWidth);
    subtreeWidthById.set(nodeId, width);
    return width;
  }
  const rootIds = rows
    .filter((row) => !parentById.has(row.node.id))
    .map((row) => row.node.id);
  for (const rootId of rootIds) subtreeWidth(rootId);

  const forestWidth = rootIds.reduce((total, rootId) => total + subtreeWidth(rootId), 0)
    + Math.max(0, rootIds.length - 1) * ISLAND_GAP;
  const width = Math.max(ELECTRICAL_MAP_MIN_CANVAS_SIZE, forestWidth + CANVAS_PADDING * 2);
  const centerXById = new Map<string, number>();
  const rootById = new Map<string, string>();
  const branchById = new Map<string, string>();

  function placeSubtree(
    nodeId: string,
    left: number,
    rootId: string,
    branchId: string,
  ) {
    const reservedWidth = subtreeWidth(nodeId);
    centerXById.set(nodeId, left + reservedWidth / 2);
    rootById.set(nodeId, rootId);
    branchById.set(nodeId, branchId);
    const children = childrenById.get(nodeId) || [];
    if (!children.length) return;
    const childrenWidth = children.reduce((total, childId) => total + subtreeWidth(childId), 0)
      + Math.max(0, children.length - 1) * SIBLING_GAP;
    let childLeft = left + (reservedWidth - childrenWidth) / 2;
    for (const childId of children) {
      const childBranchId = nodeId === rootId ? childId : branchId;
      placeSubtree(childId, childLeft, rootId, childBranchId);
      childLeft += subtreeWidth(childId) + SIBLING_GAP;
    }
  }

  let islandLeft = (width - forestWidth) / 2;
  for (const rootId of rootIds) {
    placeSubtree(rootId, islandLeft, rootId, rootId);
    islandLeft += subtreeWidth(rootId) + ISLAND_GAP;
  }

  const maximumDepth = Math.max(0, ...depthById.values());
  const levelHeightByDepth = Array.from({ length: maximumDepth + 1 }, () => 0);
  for (const row of rows) {
    const depth = depthById.get(row.node.id) || 0;
    levelHeightByDepth[depth] = Math.max(levelHeightByDepth[depth], sizeById.get(row.node.id)!.height);
  }
  const levelCenterYByDepth: number[] = [];
  let levelTop = CANVAS_PADDING;
  for (let depth = 0; depth <= maximumDepth; depth += 1) {
    levelCenterYByDepth[depth] = levelTop + levelHeightByDepth[depth] / 2;
    levelTop += levelHeightByDepth[depth] + HIERARCHY_LEVEL_GAP;
  }
  const height = Math.max(
    ELECTRICAL_MAP_MIN_CANVAS_SIZE,
    levelTop - HIERARCHY_LEVEL_GAP + CANVAS_PADDING,
  );

  const presentationLaneById = new Map<string, number>();
  for (let depth = 0; depth <= maximumDepth; depth += 1) {
    rows
      .filter((row) => (depthById.get(row.node.id) || 0) === depth)
      .sort((left, right) => (
        (centerXById.get(left.node.id) || 0) - (centerXById.get(right.node.id) || 0)
        || (orderById.get(left.node.id) ?? 0) - (orderById.get(right.node.id) ?? 0)
      ))
      .forEach((row, index) => presentationLaneById.set(row.node.id, index));
  }

  const nodes = rows.map((row) => {
    const size = sizeById.get(row.node.id) || electricalTreeNodeSize(row.node.kind);
    const depth = depthById.get(row.node.id) || 0;
    const centerX = centerXById.get(row.node.id) || width / 2;
    const centerY = levelCenterYByDepth[depth];
    const rootId = rootById.get(row.node.id) || row.node.id;
    const rootCenterX = centerXById.get(rootId) || centerX;
    const rootCenterY = levelCenterYByDepth[0];
    const deltaX = centerX - rootCenterX;
    const deltaY = centerY - rootCenterY;
    const parentId = parentById.get(row.node.id);
    return {
      node: row.node,
      x: cleanCoordinate(centerX - size.width / 2),
      y: cleanCoordinate(centerY - size.height / 2),
      width: size.width,
      height: size.height,
      depth,
      // Retained compatibility metadata now describes the top-to-bottom result.
      angle: depth === 0 ? 0 : cleanCoordinate(Math.atan2(deltaY, deltaX)),
      radialDistance: cleanCoordinate(Math.hypot(deltaX, deltaY)),
      presentationRing: depth,
      branchId: branchById.get(row.node.id) || rootId,
      presentationLane: presentationLaneById.get(row.node.id) || 0,
      presentationRow: depth,
      ...(row.node.kind === 'SITE_ASSET' && parentId && !(childrenById.get(row.node.id)?.length)
        ? { clusterParentId: parentId }
        : {}),
      ...(parentId ? { parentId } : {}),
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

  return {
    width: cleanCoordinate(width),
    height: cleanCoordinate(height),
    nodes,
    edges,
  };
}

function cleanCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

function safeCanvasDimension(value: number, fallback: number): number {
  const candidate = Number.isFinite(value) ? value : fallback;
  return cleanCoordinate(clamp(
    Math.max(candidate, fallback, ELECTRICAL_MAP_MIN_CANVAS_SIZE),
    ELECTRICAL_MAP_MIN_CANVAS_SIZE,
    ELECTRICAL_MAP_MAX_CANVAS_SIZE,
  ));
}

/**
 * Serializes node centres only. Viewport pan and zoom are deliberately not
 * part of this document so the same coordinates can drive the portal and PDF.
 */
export function electricalTreeMapLayoutDocument(
  layout: ElectricalTreeLayout,
): ElectricalMapLayoutDocument {
  const width = safeCanvasDimension(layout.width, ELECTRICAL_MAP_MIN_CANVAS_SIZE);
  const height = safeCanvasDimension(layout.height, ELECTRICAL_MAP_MIN_CANVAS_SIZE);
  return {
    version: 1,
    canvas: { width, height },
    nodes: layout.nodes
      .map((item) => ({
        nodeId: item.node.id,
        centerX: cleanCoordinate(clamp(item.x + item.width / 2, 0, width)),
        centerY: cleanCoordinate(clamp(item.y + item.height / 2, 0, height)),
      }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
  };
}

/** Returns the presentation fields from either a saved or unsaved document. */
export function electricalTreeMapLayoutDraft(
  layout: ElectricalMapLayoutDocument | SavedElectricalMapLayout,
): ElectricalMapLayoutDocument {
  return {
    version: 1,
    canvas: {
      width: cleanCoordinate(layout.canvas.width),
      height: cleanCoordinate(layout.canvas.height),
    },
    nodes: layout.nodes
      .map((item) => ({
        nodeId: item.nodeId,
        centerX: cleanCoordinate(item.centerX),
        centerY: cleanCoordinate(item.centerY),
      }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
  };
}

/**
 * Applies saved centres to the current topology. Unknown saved IDs are ignored
 * and newly introduced nodes retain their deterministic automatic positions.
 */
export function applyElectricalTreeMapLayout(
  automaticLayout: ElectricalTreeLayout,
  savedLayout?: ElectricalMapLayoutDocument | SavedElectricalMapLayout,
): ElectricalTreeLayout {
  if (!savedLayout) return automaticLayout;
  const width = safeCanvasDimension(savedLayout.canvas.width, automaticLayout.width);
  const height = safeCanvasDimension(savedLayout.canvas.height, automaticLayout.height);
  const centres = new Map(savedLayout.nodes.flatMap((item) => (
    item
      && typeof item.nodeId === 'string'
      && Number.isFinite(item.centerX)
      && Number.isFinite(item.centerY)
      ? [[item.nodeId, item] as const]
      : []
  )));
  const arranged = {
    ...automaticLayout,
    width,
    height,
    nodes: automaticLayout.nodes.map((item) => {
      const centre = centres.get(item.node.id);
      if (!centre) return item;
      const centerX = clamp(centre.centerX, item.width / 2, Math.max(item.width / 2, width - item.width / 2));
      const centerY = clamp(centre.centerY, item.height / 2, Math.max(item.height / 2, height - item.height / 2));
      return {
        ...item,
        x: cleanCoordinate(centerX - item.width / 2),
        y: cleanCoordinate(centerY - item.height / 2),
      };
    }),
  };
  // Renderer-v9 layouts persisted centres sized for substantially shorter
  // markers. Reusing those centres with the enlarged descriptions can stack
  // adjacent hierarchy levels on top of each other. Preserve safe manual
  // arrangements, but deterministically reflow any geometry that no longer
  // clears the current marker footprints.
  for (let leftIndex = 0; leftIndex < arranged.nodes.length; leftIndex += 1) {
    const left = arranged.nodes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < arranged.nodes.length; rightIndex += 1) {
      const right = arranged.nodes[rightIndex];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      if (overlaps) return automaticLayout;
    }
  }
  return arranged;
}

/** Filters visibility without recomputing or rebasing saved coordinates. */
export function filterElectricalTreeLayout(
  layout: ElectricalTreeLayout,
  visibleNodeIds?: ReadonlySet<string>,
): ElectricalTreeLayout {
  if (!visibleNodeIds) return layout;
  return {
    ...layout,
    nodes: layout.nodes.filter((item) => visibleNodeIds.has(item.node.id)),
    edges: layout.edges.filter((edge) => (
      visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId)
    )),
  };
}

/** Converts a pointer movement in CSS pixels into unscaled design-space units. */
export function electricalTreePointerDelta(
  deltaX: number,
  deltaY: number,
  viewportScale: number,
): { x: number; y: number } {
  const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1;
  return {
    x: cleanCoordinate(deltaX / scale),
    y: cleanCoordinate(deltaY / scale),
  };
}

export function electricalTreePointerDragStarted(
  deltaX: number,
  deltaY: number,
  threshold = 6,
): boolean {
  if (![deltaX, deltaY, threshold].every(Number.isFinite)) return false;
  return Math.hypot(deltaX, deltaY) >= Math.max(0, threshold);
}

/** Pointer dragging is direct on editable full maps; Arrange mode is not required. */
export function electricalTreeDirectPointerDragEnabled(options: {
  canSaveLayout: boolean;
  hasVisibleNodeFilter: boolean;
  saving: boolean;
}): boolean {
  return options.canSaveLayout && !options.hasVisibleNodeFilter && !options.saving;
}

/** Replaces one centre while keeping its marker fully inside the design canvas. */
export function moveElectricalTreeMapLayoutNode(
  layout: ElectricalMapLayoutDocument,
  nodeId: string,
  centerX: number,
  centerY: number,
  size: ElectricalTreeNodeSize,
): ElectricalMapLayoutDocument {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return layout;
  let found = false;
  const nodes = layout.nodes.map((item) => {
    if (item.nodeId !== nodeId) return item;
    found = true;
    return {
      ...item,
      centerX: cleanCoordinate(clamp(
        centerX,
        size.width / 2,
        Math.max(size.width / 2, layout.canvas.width - size.width / 2),
      )),
      centerY: cleanCoordinate(clamp(
        centerY,
        size.height / 2,
        Math.max(size.height / 2, layout.canvas.height - size.height / 2),
      )),
    };
  });
  return found ? { ...layout, nodes } : layout;
}

export function electricalTreeMapLayoutsEqual(
  left: ElectricalMapLayoutDocument,
  right: ElectricalMapLayoutDocument,
): boolean {
  if (
    cleanCoordinate(left.canvas.width) !== cleanCoordinate(right.canvas.width)
    || cleanCoordinate(left.canvas.height) !== cleanCoordinate(right.canvas.height)
    || left.nodes.length !== right.nodes.length
  ) return false;
  const leftNodes = [...left.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const rightNodes = [...right.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return leftNodes.every((item, index) => (
    item.nodeId === rightNodes[index]?.nodeId
    && cleanCoordinate(item.centerX) === cleanCoordinate(rightNodes[index].centerX)
    && cleanCoordinate(item.centerY) === cleanCoordinate(rightNodes[index].centerY)
  ));
}

/** Options shared by direct connectors and retained compatibility aliases. */
export type ElectricalTreeConnectorOptions = {
  sourceYOffset?: number;
  targetYOffset?: number;
  /** Retained for compatibility with callers compiled against curved routes. */
  trunkRatio?: number;
  /** Retained for compatibility with callers compiled against curved routes. */
  bend?: number;
};

/**
 * Connects the visible perimeters of two draggable nodes with one direct line.
 * Geometry is derived at render time, so moving a saved node immediately moves
 * its connector without changing any persisted coordinates.
 */
export function electricalTreeStraightPath(
  source: ElectricalTreeLayoutNode,
  target: ElectricalTreeLayoutNode,
  options: ElectricalTreeConnectorOptions = {},
): string {
  if (source.node.id === target.node.id) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height / 2 + (options.sourceYOffset || 0);
    const targetX = source.x + source.width * 0.72;
    const targetY = source.y;
    return `M ${cleanCoordinate(sourceX)} ${cleanCoordinate(sourceY)} L ${cleanCoordinate(targetX)} ${cleanCoordinate(targetY)}`;
  }

  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2 + (options.sourceYOffset || 0),
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2 + (options.targetYOffset || 0),
  };
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  const routeDirectionX = deltaX === 0 && deltaY === 0 ? 1 : deltaX;
  const routeDirectionY = deltaX === 0 && deltaY === 0 ? 0 : deltaY;

  function perimeterPoint(
    center: { x: number; y: number },
    width: number,
    height: number,
    directionX: number,
    directionY: number,
  ) {
    const scale = 1 / Math.max(
      Math.abs(directionX) / Math.max(1, width / 2),
      Math.abs(directionY) / Math.max(1, height / 2),
    );
    return {
      x: center.x + directionX * scale,
      y: center.y + directionY * scale,
    };
  }

  const start = perimeterPoint(
    sourceCenter,
    source.width,
    source.height,
    routeDirectionX,
    routeDirectionY,
  );
  const end = perimeterPoint(
    targetCenter,
    target.width,
    target.height,
    -routeDirectionX,
    -routeDirectionY,
  );
  return `M ${cleanCoordinate(start.x)} ${cleanCoordinate(start.y)} L ${cleanCoordinate(end.x)} ${cleanCoordinate(end.y)}`;
}

/** Compatibility alias for callers that have not migrated to the explicit name. */
export function electricalTreeCurvedPath(
  source: ElectricalTreeLayoutNode,
  target: ElectricalTreeLayoutNode,
  options: ElectricalTreeConnectorOptions = {},
): string {
  return electricalTreeStraightPath(source, target, options);
}

/** Compatibility alias while renderers migrate from the prior orthogonal API. */
export function electricalTreeOrthogonalPath(
  source: ElectricalTreeLayoutNode,
  target: ElectricalTreeLayoutNode,
  options: ElectricalTreeConnectorOptions = {},
): string {
  return electricalTreeStraightPath(source, target, options);
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
