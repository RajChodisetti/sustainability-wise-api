import {
  INSTALLATION_CANONICALIZER_VERSION,
  INSTALLATION_TAXONOMY_VERSION,
  INSTALLATION_VALIDATOR_VERSION,
  canonicalPayloadHash,
  installationReadiness,
  type CanonicalBoard,
  type CanonicalInstallationTree,
  type MeasurementAssignment,
  type VirtualMeterDefinition,
} from './canonical.js';

export const INSTALLATION_CONTROLLED_LABEL_CATALOG = Object.freeze({
  boards: Object.freeze({
  MSB: 'Main Switchboard',
  MSSB: 'Main Sub-Switchboard',
  DB: 'Distribution Board',
  HVAC_DB: 'HVAC Distribution Board',
  LX_DB: 'Lighting Distribution Board',
  PV_DB: 'PV/Solar Distribution Board',
  MCC: 'Motor Control Centre',
  OTHER: 'Other',
  }),
  siteAssets: Object.freeze({
  PV: 'Solar / PV',
  HVAC: 'AC / HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Vehicle Hoist',
  FORKLIFT: 'Forklift',
  EXHAUST_FAN_SYSTEM: 'Exhaust Fan System',
  POWER_OUTLET: 'Power Outlet',
  HEATER_GEYSER: 'Heater / Geyser',
  OTHER: 'Other',
  }),
});

const BOARD_LABELS: Readonly<Record<string, string>> = INSTALLATION_CONTROLLED_LABEL_CATALOG.boards;
const ASSET_LABELS: Readonly<Record<string, string>> = INSTALLATION_CONTROLLED_LABEL_CATALOG.siteAssets;

export type ElectricalTreeNode =
  | {
      kind: 'GRID';
      id: string;
      name: string;
      isDefault: boolean;
      nmi: string | null;
      externalKey: string | null;
    }
  | {
      kind: 'BOARD';
      id: string;
      name: string;
      typeCode: string;
      typeLabel: string;
      displayCode: string;
      physicalLocationId: string;
      coverageState?: never;
    }
  | {
      kind: 'SITE_ASSET';
      id: string;
      name: string;
      typeCode: string;
      typeLabel: string;
      displayCode: string;
      physicalLocationId: string;
      coverageState: 'DIRECT' | 'VIRTUAL' | 'UNMETERED' | 'TBC';
    }
  | {
      kind: 'VIRTUAL_RESIDUAL';
      id: string;
      name: string;
      displayCode: string;
      parentNodeId: string;
      formulaVersion: number;
    };

export type ElectricalTreeEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: 'FED_FROM' | 'MEASURES';
};

export type UnresolvedElectricalRelationship = {
  id: string;
  subjectType: 'BOARD' | 'SITE_ASSET' | 'MEASUREMENT_ASSIGNMENT';
  subjectId: string;
  relation: 'SUPPLY' | 'MEASUREMENT';
  missingEnd: 'SOURCE' | 'TARGET';
  knownNodeId?: string;
  reason: 'TBC' | 'ORPHAN' | 'INVALID';
};

type ArtifactMetadata = {
  installationId: string;
  installationExternalKey: string;
  recordVersionNumber: number;
  treeRevision: number;
  canonicalizerVersion: string;
  validatorVersion: string;
  taxonomyVersion: string;
  generatedAt: string;
};

function artifactMetadata(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
): ArtifactMetadata {
  return {
    installationId: tree.installation.id,
    installationExternalKey: tree.installation.externalKey,
    recordVersionNumber,
    treeRevision: tree.installation.treeRevision,
    canonicalizerVersion: INSTALLATION_CANONICALIZER_VERSION,
    validatorVersion: INSTALLATION_VALIDATOR_VERSION,
    taxonomyVersion: INSTALLATION_TAXONOMY_VERSION,
    generatedAt: tree.installation.completedAt
      ?? tree.installation.updatedAt
      ?? tree.installation.createdAt
      ?? new Date(0).toISOString(),
  };
}

function withHash<T extends Record<string, unknown>>(payload: T): T & { payloadHash: string } {
  return { ...payload, payloadHash: canonicalPayloadHash(payload) };
}

function sourceNodeId(
  source: CanonicalBoard['electricalSource'],
  boardIds: Set<string>,
  supplyIds: Set<string>,
): string | null {
  if (source.kind === 'GRID') return supplyIds.has(source.gridSupplyId) ? source.gridSupplyId : null;
  if (source.kind === 'BOARD') return boardIds.has(source.boardId) ? source.boardId : null;
  return null;
}

function electricalGraph(tree: CanonicalInstallationTree): {
  nodes: ElectricalTreeNode[];
  edges: ElectricalTreeEdge[];
  unresolved: UnresolvedElectricalRelationship[];
} {
  const boardIds = new Set(tree.electricalAssets.map((board) => board.id));
  const supplyIds = new Set(tree.gridSupplies.map((supply) => supply.id));
  const nodes: ElectricalTreeNode[] = [
    ...tree.gridSupplies.map((supply): ElectricalTreeNode => ({
      kind: 'GRID',
      id: supply.id,
      name: supply.name,
      isDefault: supply.isDefault,
      nmi: supply.nmi ?? null,
      externalKey: supply.externalKey ?? null,
    })),
    ...tree.electricalAssets.map((board): ElectricalTreeNode => ({
      kind: 'BOARD',
      id: board.id,
      name: board.assetName,
      typeCode: board.typeCode,
      typeLabel: board.typeCode === 'OTHER'
        ? board.customTypeName ?? BOARD_LABELS.OTHER
        : BOARD_LABELS[board.typeCode] ?? board.typeCode,
      displayCode: board.displayCode.value,
      physicalLocationId: board.zoneId,
    })),
    ...tree.siteAssets.map((asset): ElectricalTreeNode => ({
      kind: 'SITE_ASSET',
      id: asset.id,
      name: asset.assetName,
      typeCode: asset.typeCode,
      typeLabel: asset.typeCode === 'OTHER'
        ? asset.customTypeName ?? ASSET_LABELS.OTHER
        : ASSET_LABELS[asset.typeCode] ?? asset.typeCode,
      displayCode: asset.displayCode.value,
      physicalLocationId: asset.zoneId,
      coverageState: (() => {
        const direct = tree.measurementAssignments.some((assignment) => (
          assignment.status === 'CONFIRMED'
          && assignment.target.kind === 'SITE_ASSET'
          && assignment.target.siteAssetId === asset.id
        ));
        if (direct) return 'DIRECT';
        if (asset.meteringState.kind === 'TBC') return 'TBC';
        return virtualForAsset(tree, asset.id) ? 'VIRTUAL' : 'UNMETERED';
      })(),
    })),
    ...tree.serverDerived.virtualMeterDefinitions.map((virtual): ElectricalTreeNode => ({
      kind: 'VIRTUAL_RESIDUAL',
      id: virtual.id,
      name: `Residual at ${virtual.parentNodeId}`,
      displayCode: `VIRTUAL-${virtual.id.replace(/^virtual_/, '').toUpperCase()}`,
      parentNodeId: virtual.parentNodeId,
      formulaVersion: virtual.formulaVersion,
    })),
  ];
  const edges: ElectricalTreeEdge[] = [];
  const unresolved: UnresolvedElectricalRelationship[] = [];
  for (const entity of [
    ...tree.electricalAssets.map((item) => ({ item, entityType: 'BOARD' as const })),
    ...tree.siteAssets.map((item) => ({ item, entityType: 'SITE_ASSET' as const })),
  ]) {
    const sourceId = sourceNodeId(entity.item.electricalSource, boardIds, supplyIds);
    if (sourceId) {
      edges.push({
        id: `supplies:${sourceId}:${entity.item.id}`,
        sourceNodeId: sourceId,
        targetNodeId: entity.item.id,
        relationship: 'FED_FROM',
      });
    } else {
      unresolved.push({
        id: `unresolved:supply:${entity.item.id}`,
        subjectType: entity.entityType,
        subjectId: entity.item.id,
        relation: 'SUPPLY',
        missingEnd: 'SOURCE',
        reason: entity.item.electricalSource.kind === 'TBC' ? 'TBC' : 'INVALID',
      });
    }
  }
  const meterById = new Map(tree.meterDevices.map((meter) => [meter.id, meter]));
  for (const assignment of tree.measurementAssignments) {
    const meter = meterById.get(assignment.meterId);
    const targetNodeId = assignment.target.kind === 'BOARD'
      ? assignment.target.boardId
      : assignment.target.kind === 'SITE_ASSET'
        ? assignment.target.siteAssetId
        : assignment.target.kind === 'GRID_BOUNDARY'
          ? assignment.target.gridSupplyId
          : null;
    if (meter && targetNodeId) {
      edges.push({
        id: `measures:${assignment.id}`,
        sourceNodeId: meter.installedOnBoardId,
        targetNodeId,
        relationship: 'MEASURES',
      });
    } else {
      unresolved.push({
        id: `unresolved:measurement:${assignment.id}`,
        subjectType: 'MEASUREMENT_ASSIGNMENT',
        subjectId: assignment.id,
        relation: 'MEASUREMENT',
        missingEnd: targetNodeId ? 'SOURCE' : 'TARGET',
        ...(targetNodeId ? { knownNodeId: targetNodeId } : {}),
        reason: assignment.target.kind === 'TBC' ? 'TBC' : 'ORPHAN',
      });
    }
  }
  const kindOrder: Record<ElectricalTreeNode['kind'], number> = {
    GRID: 0,
    BOARD: 1,
    SITE_ASSET: 2,
    VIRTUAL_RESIDUAL: 3,
  };
  nodes.sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  unresolved.sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges, unresolved };
}

export function buildElectricalTreeView(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const graph = electricalGraph(tree);
  const payload = {
    installationId: tree.installation.id,
    treeRevision: tree.installation.treeRevision,
    recordVersionNumber,
    nodes: graph.nodes,
    edges: graph.edges,
    unresolved: graph.unresolved,
  };
  return { ...payload, payloadHash: canonicalPayloadHash(payload) };
}

function directAssignmentsByAsset(tree: CanonicalInstallationTree): Map<string, MeasurementAssignment[]> {
  const result = new Map<string, MeasurementAssignment[]>();
  for (const assignment of tree.measurementAssignments) {
    if (assignment.target.kind !== 'SITE_ASSET' || assignment.status !== 'CONFIRMED') continue;
    const entries = result.get(assignment.target.siteAssetId) ?? [];
    entries.push(assignment);
    result.set(assignment.target.siteAssetId, entries);
  }
  for (const entries of result.values()) entries.sort((left, right) => left.id.localeCompare(right.id));
  return result;
}

function virtualForAsset(
  tree: CanonicalInstallationTree,
  assetId: string,
): VirtualMeterDefinition | null {
  const asset = tree.siteAssets.find((item) => item.id === assetId);
  if (!asset || asset.electricalSource.kind === 'TBC') return null;
  const parentId = asset.electricalSource.kind === 'GRID'
    ? asset.electricalSource.gridSupplyId
    : asset.electricalSource.boardId;
  const parentKind = asset.electricalSource.kind === 'GRID'
    ? 'GRID_BOUNDARY'
    : 'BOARD';
  const assignmentById = new Map(
    tree.measurementAssignments.map((assignment) => [assignment.id, assignment]),
  );
  const definition = tree.serverDerived.virtualMeterDefinitions.find((candidate) => {
    if (candidate.parentNodeId !== parentId) return false;
    const total = assignmentById.get(candidate.totalMeasurementAssignmentId);
    if (!total) return false;
    if (parentKind === 'GRID_BOUNDARY') {
      return total.target.kind === 'GRID_BOUNDARY'
        && total.target.gridSupplyId === parentId;
    }
    return total.target.kind === 'BOARD' && total.target.boardId === parentId;
  });
  if (!definition) return null;
  const measuredAssetIds = new Set(definition.subtractAssignmentIds.flatMap((assignmentId) => {
    const assignment = assignmentById.get(assignmentId);
    return assignment?.target.kind === 'SITE_ASSET'
      ? [assignment.target.siteAssetId]
      : [];
  }));
  // A residual is boundary coverage, not a numeric allocation. Every
  // unmeasured immediate child may reference the same virtual meter, while
  // measured children remain direct. Consumers must not infer a share,
  // quantity, or percentage from this relationship.
  return measuredAssetIds.has(asset.id) ? null : definition;
}

export type AssetCoverage =
  | { kind: 'DIRECT'; measurementAssignmentIds: string[] }
  | {
      kind: 'VIRTUAL';
      virtualMeterId: string;
      parentNodeId: string;
      allocation: 'UNALLOCATED_RESIDUAL';
    }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

export function buildAllAssetsView(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const direct = directAssignmentsByAsset(tree);
  const zoneNames = new Map(tree.zones.map((zone) => [zone.id, zone.zoneName]));
  const boardNames = new Map(tree.electricalAssets.map((board) => [board.id, board.assetName]));
  const assets = tree.siteAssets.map((asset) => {
    const assignments = direct.get(asset.id) ?? [];
    const residual = assignments.length ? null : virtualForAsset(tree, asset.id);
    const coverage: AssetCoverage = assignments.length
      ? { kind: 'DIRECT', measurementAssignmentIds: assignments.map((assignment) => assignment.id) }
      : asset.meteringState.kind === 'TBC'
        ? { kind: 'TBC' }
        : residual
          ? {
              kind: 'VIRTUAL',
              virtualMeterId: residual.id,
              parentNodeId: residual.parentNodeId,
              allocation: 'UNALLOCATED_RESIDUAL',
            }
          : { kind: 'UNMETERED' };
    return {
      id: asset.id,
      name: asset.assetName,
      typeCode: asset.typeCode,
      typeLabel: asset.typeCode === 'OTHER'
        ? asset.customTypeName ?? ASSET_LABELS.OTHER
        : ASSET_LABELS[asset.typeCode] ?? asset.typeCode,
      displayCode: asset.displayCode.value,
      zoneId: asset.zoneId,
      zoneName: zoneNames.get(asset.zoneId) ?? '',
      source: asset.electricalSource,
      sourceBoardName: asset.electricalSource.kind === 'BOARD'
        ? boardNames.get(asset.electricalSource.boardId) ?? null
        : null,
      meteringState: asset.meteringState,
      coverage,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return withHash({
    schemaVersion: 1,
    metadata: artifactMetadata(tree, recordVersionNumber),
    assets,
  });
}

export function buildMeteringView(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const boardById = new Map(tree.electricalAssets.map((board) => [board.id, board]));
  const meterById = new Map(tree.meterDevices.map((meter) => [meter.id, meter]));
  const rows = tree.measurementAssignments.flatMap((assignment) => {
    const meter = meterById.get(assignment.meterId);
    if (!meter) return [];
    const board = boardById.get(meter.installedOnBoardId);
    return assignment.channelIds.map((channelId) => {
      const channel = meter.channels.find((item) => item.id === channelId);
      return {
        assignmentId: assignment.id,
        meterId: meter.id,
        meterDisplayName: meter.displayName.value,
        deviceFamily: meter.deviceFamily,
        deviceModel: meter.deviceModel,
        serialNumber: meter.serialNumber,
        installedOnBoardId: meter.installedOnBoardId,
        installedOnBoardName: board?.assetName ?? null,
        channelId,
        channelOrdinal: channel?.ordinal ?? null,
        channelPurpose: channel?.purpose ?? null,
        channelDescription: channel?.description ?? null,
        phaseMode: assignment.phaseMode,
        target: assignment.target,
        direction: assignment.direction,
        status: assignment.status,
      };
    });
  }).sort((left, right) => (
    `${left.meterId}:${String(left.channelOrdinal ?? 0).padStart(6, '0')}:${left.assignmentId}`
      .localeCompare(`${right.meterId}:${String(right.channelOrdinal ?? 0).padStart(6, '0')}:${right.assignmentId}`)
  ));
  return withHash({
    schemaVersion: 1,
    metadata: artifactMetadata(tree, recordVersionNumber),
    rows,
  });
}

export function buildInstallationMappingExport(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const graph = electricalGraph(tree);
  const readiness = installationReadiness(tree);
  const direct = directAssignmentsByAsset(tree);
  const payload = {
    schema: 'installation-mapping/v1' as const,
    installation: {
      id: tree.installation.id,
      externalKey: tree.installation.externalKey,
      recordVersionNumber,
      canonicalizerVersion: 1,
      validatorVersion: 1,
      taxonomyCatalogVersion: 1,
      siteName: tree.installation.siteName,
      timezone: tree.installation.timezone,
      ...(tree.installation.completedAt ? { completedAt: tree.installation.completedAt } : {}),
    },
    physicalLocations: tree.zones.map((zone) => ({
      id: zone.id,
      name: zone.zoneName,
      ...(zone.zoneDescription ? { description: zone.zoneDescription } : {}),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    electricalNodes: graph.nodes,
    supplyEdges: graph.edges
      .filter((edge) => edge.relationship === 'FED_FROM')
      .map(({ id, sourceNodeId, targetNodeId }) => ({ id, sourceNodeId, targetNodeId })),
    unresolvedRelationships: graph.unresolved,
    meters: tree.meterDevices.map((meter) => ({
      id: meter.id,
      installedOnBoardId: meter.installedOnBoardId,
      deviceFamily: meter.deviceFamily,
      deviceModel: meter.deviceModel,
      ...(meter.customManufacturerName
        ? { customManufacturerName: meter.customManufacturerName }
        : {}),
      ...(meter.customModelName ? { customModelName: meter.customModelName } : {}),
      ...(meter.deviceNumber ? { deviceNumber: meter.deviceNumber } : {}),
      serialNumber: meter.serialNumber,
      displayName: meter.displayName,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    channels: tree.meterDevices.flatMap((meter) => meter.channels.map((channel) => ({
      id: channel.id,
      meterId: meter.id,
      ordinal: channel.ordinal,
      ...(channel.phaseLabel ? { phaseLabel: channel.phaseLabel } : {}),
      purpose: channel.purpose,
      ...(channel.loadTypeCode ? { loadTypeCode: channel.loadTypeCode } : {}),
      ...(channel.customLoadTypeName
        ? { customLoadTypeName: channel.customLoadTypeName }
        : {}),
      ...(channel.sensorRating ? { sensorRating: channel.sensorRating } : {}),
      ...(channel.description ? { description: channel.description } : {}),
      ...(channel.capabilities && Object.keys(channel.capabilities).length
        ? { capabilities: channel.capabilities }
        : {}),
    }))).sort((left, right) => left.id.localeCompare(right.id)),
    measurementAssignments: tree.measurementAssignments.map((assignment) => ({
      id: assignment.id,
      installationId: assignment.installationId,
      meterId: assignment.meterId,
      channelIds: assignment.channelIds,
      phaseMode: assignment.phaseMode,
      target: assignment.target,
      direction: assignment.direction,
      status: assignment.status,
    }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    assetCoverage: tree.siteAssets.map((asset) => {
      const assignments = direct.get(asset.id) ?? [];
      if (assignments.length) {
        return {
          assetId: asset.id,
          state: 'DIRECT' as const,
          source: { kind: 'MEASUREMENT_ASSIGNMENT' as const, id: assignments[0].id },
        };
      }
      const virtual = asset.meteringState.kind === 'TBC' ? null : virtualForAsset(tree, asset.id);
      if (virtual) {
        return {
          assetId: asset.id,
          state: 'VIRTUAL' as const,
          source: {
            kind: 'VIRTUAL_METER' as const,
            id: virtual.id,
            parentNodeId: virtual.parentNodeId,
            allocation: 'UNALLOCATED_RESIDUAL' as const,
          },
        };
      }
      return {
        assetId: asset.id,
        state: asset.meteringState.kind === 'TBC' ? 'TBC' as const : 'UNMETERED' as const,
      };
    }).sort((left, right) => left.assetId.localeCompare(right.assetId)),
    virtualMeters: tree.serverDerived.virtualMeterDefinitions,
    readiness: {
      installationId: readiness.installationId,
      treeRevision: readiness.treeRevision,
      ...(readiness.recordVersionNumber !== undefined
        ? { recordVersionNumber: readiness.recordVersionNumber }
        : {}),
      readyToComplete: readiness.readyToComplete,
      eligibility: readiness.eligibility,
      issues: readiness.issues.map(({ candidateIds: _candidateIds, ...issue }) => issue),
    },
  };
  return { ...payload, contentHash: canonicalPayloadHash(payload) };
}
