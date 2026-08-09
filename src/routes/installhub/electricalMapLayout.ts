export const ELECTRICAL_MAP_LAYOUT_VERSION = 1 as const;
export const ELECTRICAL_MAP_LAYOUT_MAX_NODES = 2_000;
export const ELECTRICAL_MAP_LAYOUT_MIN_CANVAS_SIZE = 320;
export const ELECTRICAL_MAP_LAYOUT_MAX_CANVAS_SIZE = 20_000;

export type ElectricalMapLayoutNode = {
  nodeId: string;
  centerX: number;
  centerY: number;
};

export type ElectricalMapLayoutDocument = {
  version: typeof ELECTRICAL_MAP_LAYOUT_VERSION;
  canvas: {
    width: number;
    height: number;
  };
  nodes: ElectricalMapLayoutNode[];
};

export type SavedElectricalMapLayout = ElectricalMapLayoutDocument & {
  layoutRevision: number;
  updatedAt?: string;
};

export class ElectricalMapLayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElectricalMapLayoutValidationError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ElectricalMapLayoutValidationError(`${label} must be a finite number`);
  }
  return value;
}

function canvasDimension(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (
    parsed < ELECTRICAL_MAP_LAYOUT_MIN_CANVAS_SIZE
    || parsed > ELECTRICAL_MAP_LAYOUT_MAX_CANVAS_SIZE
  ) {
    throw new ElectricalMapLayoutValidationError(
      `${label} must be between ${ELECTRICAL_MAP_LAYOUT_MIN_CANVAS_SIZE} and ${ELECTRICAL_MAP_LAYOUT_MAX_CANVAS_SIZE}`,
    );
  }
  return Number(parsed.toFixed(2));
}

/**
 * Validates and canonicalizes presentation-only electrical map coordinates.
 * Coordinates are node centres in the same design space used by the portal;
 * viewport pan and zoom are deliberately excluded.
 */
export function validateElectricalMapLayout(
  value: unknown,
  expectedNodeIds?: Iterable<string>,
): ElectricalMapLayoutDocument {
  const input = record(value);
  if (!input || input.version !== ELECTRICAL_MAP_LAYOUT_VERSION) {
    throw new ElectricalMapLayoutValidationError('layout version must be 1');
  }
  const canvas = record(input.canvas);
  if (!canvas) throw new ElectricalMapLayoutValidationError('layout canvas is required');
  const width = canvasDimension(canvas.width, 'layout canvas width');
  const height = canvasDimension(canvas.height, 'layout canvas height');
  if (!Array.isArray(input.nodes) || input.nodes.length < 1) {
    throw new ElectricalMapLayoutValidationError('layout nodes must contain at least one item');
  }
  if (input.nodes.length > ELECTRICAL_MAP_LAYOUT_MAX_NODES) {
    throw new ElectricalMapLayoutValidationError(
      `layout nodes cannot exceed ${ELECTRICAL_MAP_LAYOUT_MAX_NODES} items`,
    );
  }

  const seen = new Set<string>();
  const nodes = input.nodes.map((valueAtIndex, index): ElectricalMapLayoutNode => {
    const item = record(valueAtIndex);
    if (!item) {
      throw new ElectricalMapLayoutValidationError(`layout node ${index + 1} must be an object`);
    }
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId.trim() : '';
    if (!nodeId || nodeId.length > 256) {
      throw new ElectricalMapLayoutValidationError(
        `layout node ${index + 1} must have a nodeId from 1 to 256 characters`,
      );
    }
    if (seen.has(nodeId)) {
      throw new ElectricalMapLayoutValidationError(`layout nodeId ${nodeId} is duplicated`);
    }
    seen.add(nodeId);
    const centerX = finiteNumber(item.centerX, `layout node ${nodeId} centerX`);
    const centerY = finiteNumber(item.centerY, `layout node ${nodeId} centerY`);
    if (centerX < 0 || centerX > width || centerY < 0 || centerY > height) {
      throw new ElectricalMapLayoutValidationError(
        `layout node ${nodeId} centre must stay inside the design canvas`,
      );
    }
    return {
      nodeId,
      centerX: Number(centerX.toFixed(2)),
      centerY: Number(centerY.toFixed(2)),
    };
  }).sort((left, right) => left.nodeId.localeCompare(right.nodeId));

  if (expectedNodeIds) {
    const expected = new Set(expectedNodeIds);
    if (expected.size !== nodes.length || nodes.some((node) => !expected.has(node.nodeId))) {
      throw new ElectricalMapLayoutValidationError(
        'layout nodes must exactly match the current confirmed electrical map',
      );
    }
  }

  return {
    version: ELECTRICAL_MAP_LAYOUT_VERSION,
    canvas: { width, height },
    nodes,
  };
}

export function validStoredElectricalMapLayout(
  value: unknown,
): ElectricalMapLayoutDocument | undefined {
  try {
    return validateElectricalMapLayout(value);
  } catch {
    return undefined;
  }
}

export function electricalMapLayoutMatchesNodeIds(
  layout: ElectricalMapLayoutDocument,
  nodeIds: Iterable<string>,
): boolean {
  const expected = new Set(nodeIds);
  return expected.size === layout.nodes.length
    && layout.nodes.every((node) => expected.has(node.nodeId));
}

type ClientElectricalMapView = {
  nodes: Array<{
    id: string;
    kind: string;
    parentNodeId?: string;
    coverageState?: string;
  }>;
  edges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relationship: string;
  }>;
  unresolved: Array<{
    subjectType: string;
    subjectId: string;
  }>;
};

/** Mirrors the portal's confirmed, grid-reachable client map projection. */
export function clientElectricalMapNodeIds(view: ClientElectricalMapView): Set<string> {
  const excluded = new Set(view.unresolved.flatMap((item) => (
    item.subjectType === 'BOARD' || item.subjectType === 'SITE_ASSET'
      ? [item.subjectId]
      : []
  )));
  for (const node of view.nodes) {
    if (
      node.kind === 'SITE_ASSET'
      && (node.coverageState === 'TBC' || node.coverageState === 'INVALID')
    ) excluded.add(node.id);
  }
  const included = new Set(
    view.nodes
      .filter((node) => node.kind === 'GRID' && !excluded.has(node.id))
      .map((node) => node.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of view.edges) {
      if (
        edge.relationship !== 'FED_FROM'
        || !included.has(edge.sourceNodeId)
        || included.has(edge.targetNodeId)
        || excluded.has(edge.targetNodeId)
      ) continue;
      included.add(edge.targetNodeId);
      changed = true;
    }
    for (const node of view.nodes) {
      if (
        node.kind !== 'VIRTUAL_RESIDUAL'
        || !node.parentNodeId
        || !included.has(node.parentNodeId)
        || included.has(node.id)
        || excluded.has(node.id)
      ) continue;
      included.add(node.id);
      changed = true;
    }
  }
  return included;
}
