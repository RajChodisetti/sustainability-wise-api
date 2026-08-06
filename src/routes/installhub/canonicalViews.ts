import {
  INSTALLATION_CANONICALIZER_VERSION,
  INSTALLATION_TAXONOMY_VERSION,
  INSTALLATION_VALIDATOR_VERSION,
  canonicalPayloadHash,
  installationReadiness,
  type CanonicalBoard,
  type CanonicalInstallationTree,
  type CanonicalSiteAsset,
  type MeasurementAssignment,
  type ReadinessIssue,
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
  REFRIGERATION: 'Refrigeration',
  COMPRESSED_AIR: 'Compressed Air',
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
      coverageState: 'DIRECT' | 'VIRTUAL' | 'UNMETERED' | 'TBC' | 'INVALID';
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

export type AssetCoverage =
  | { kind: 'DIRECT'; measurementAssignmentIds: string[] }
  | {
      kind: 'VIRTUAL';
      virtualMeterId: string;
      parentNodeId: string;
      allocation: 'UNALLOCATED_RESIDUAL';
    }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' }
  | {
      kind: 'INVALID';
      reason: 'METERING_STATE_MISMATCH' | 'MEASUREMENT_RELATIONSHIP_INVALID';
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
  const assignmentsByAsset = targetAssignmentsByAsset(tree);
  const readinessIssues = installationReadiness(tree).issues;
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
      coverageState: assetCoverageFor(
        tree,
        asset,
        assignmentsByAsset.get(asset.id) ?? [],
        readinessIssues,
      ).kind,
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

function targetAssignmentsByAsset(tree: CanonicalInstallationTree): Map<string, MeasurementAssignment[]> {
  const result = new Map<string, MeasurementAssignment[]>();
  for (const assignment of tree.measurementAssignments) {
    if (assignment.target.kind !== 'SITE_ASSET') continue;
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

function assetCoverageFor(
  tree: CanonicalInstallationTree,
  asset: CanonicalSiteAsset,
  assignments: MeasurementAssignment[],
  readinessIssues: ReadinessIssue[],
): AssetCoverage {
  const hasDirectAssignments = assignments.length > 0;
  const legacyMeterPresenceMatches = asset.meterPresent === hasDirectAssignments;
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  const meterIds = new Set(assignments.map((assignment) => assignment.meterId));
  const channelIds = new Set(assignments.flatMap((assignment) => assignment.channelIds));
  const relationshipInvalid = readinessIssues.some((issue) => {
    if (issue.severity !== 'ERROR') return false;
    if (
      issue.entityType === 'site_asset'
      && issue.entityId === asset.id
      && asset.meteringState.kind !== 'TBC'
      && (issue.code === 'METERING_STATE_INVALID' || issue.code === 'METER_PRESENT_MISMATCH')
    ) return true;
    if (issue.entityType === 'measurement_assignment' && assignmentIds.has(issue.entityId)) return true;
    if (
      issue.entityType === 'channel'
      && channelIds.has(issue.entityId)
      && [
        'CHANNEL_NOT_FOUND',
        'CHANNEL_DUPLICATE_ASSIGNMENT',
        'CHANNEL_PURPOSE_CONFLICT',
        'METER_CAPABILITY_REQUIRED',
        'SENSOR_RATING_INVALID',
      ].includes(issue.code)
    ) return true;
    return issue.entityType === 'meter'
      && meterIds.has(issue.entityId)
      && ['METER_BOARD_MISMATCH', 'CHANNEL_NOT_FOUND', 'METER_CAPABILITY_REQUIRED'].includes(issue.code);
  });
  if (asset.meteringState.kind === 'METERED') {
    const declaredIds = new Set(asset.meteringState.measurementAssignmentIds);
    const actualIds = new Set(assignments.map((assignment) => assignment.id));
    const exactSingleAssignment = declaredIds.size === 1
      && actualIds.size === 1
      && [...declaredIds].every((id) => actualIds.has(id))
      && assignments[0]?.status === 'CONFIRMED';
    return exactSingleAssignment && legacyMeterPresenceMatches && !relationshipInvalid
      ? { kind: 'DIRECT', measurementAssignmentIds: [...actualIds].sort() }
      : {
          kind: 'INVALID',
          reason: relationshipInvalid
            ? 'MEASUREMENT_RELATIONSHIP_INVALID'
            : 'METERING_STATE_MISMATCH',
        };
  }
  if (hasDirectAssignments || !legacyMeterPresenceMatches || relationshipInvalid) {
    return {
      kind: 'INVALID',
      reason: relationshipInvalid
        ? 'MEASUREMENT_RELATIONSHIP_INVALID'
        : 'METERING_STATE_MISMATCH',
    };
  }
  if (asset.meteringState.kind === 'TBC') return { kind: 'TBC' };
  const residual = virtualForAsset(tree, asset.id);
  return residual
    ? {
        kind: 'VIRTUAL',
        virtualMeterId: residual.id,
        parentNodeId: residual.parentNodeId,
        allocation: 'UNALLOCATED_RESIDUAL',
      }
    : { kind: 'UNMETERED' };
}

export function buildAllAssetsView(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const assignmentsByAsset = targetAssignmentsByAsset(tree);
  const readinessIssues = installationReadiness(tree).issues;
  const zoneNames = new Map(tree.zones.map((zone) => [zone.id, zone.zoneName]));
  const boardNames = new Map(tree.electricalAssets.map((board) => [board.id, board.assetName]));
  const assets = tree.siteAssets.map((asset) => {
    const assignments = assignmentsByAsset.get(asset.id) ?? [];
    const coverage = assetCoverageFor(tree, asset, assignments, readinessIssues);
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
  const readinessIssues = installationReadiness(tree).issues;
  const assignedChannelIdsByMeter = new Map<string, Set<string>>();
  for (const assignment of tree.measurementAssignments) {
    const meter = meterById.get(assignment.meterId);
    if (!meter) continue;
    const meterChannelIds = new Set(meter.channels.map((channel) => channel.id));
    const assigned = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    for (const channelId of assignment.channelIds) {
      if (meterChannelIds.has(channelId)) assigned.add(channelId);
    }
    assignedChannelIdsByMeter.set(meter.id, assigned);
  }
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
  const deviceSummaries = tree.meterDevices.map((meter) => {
    const board = boardById.get(meter.installedOnBoardId);
    const meterAssignments = tree.measurementAssignments.filter((assignment) => assignment.meterId === meter.id);
    const assignedChannelIds = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
    const assignedActiveChannels = activeChannels.filter((channel) => assignedChannelIds.has(channel.id));
    const unassignedActiveChannels = activeChannels.filter((channel) => !assignedChannelIds.has(channel.id));
    const spareChannels = meter.channels.filter((channel) => channel.purpose === 'SPARE');
    const meterAssignmentIds = new Set(meterAssignments.map((assignment) => assignment.id));
    const meterChannelIds = new Set(meter.channels.map((channel) => channel.id));
    const blockingIssues = readinessIssues.filter((issue) => issue.severity === 'ERROR' && (
      (issue.entityType === 'meter' && issue.entityId === meter.id)
      || (issue.entityType === 'channel' && meterChannelIds.has(issue.entityId))
      || (issue.entityType === 'measurement_assignment' && meterAssignmentIds.has(issue.entityId))
    ));
    const nonAssignmentIssues = blockingIssues.filter((issue) => issue.code !== 'CHANNEL_UNASSIGNED');
    const state = unassignedActiveChannels.length
      ? 'UNASSIGNED_ACTIVE'
      : nonAssignmentIssues.length
        ? 'MAPPING_ISSUE'
      : activeChannels.length
        ? 'MAPPED'
        : spareChannels.length === meter.channels.length && meter.channels.length > 0
          ? 'ALL_SPARE'
          : 'NO_ACTIVE_CHANNELS';
    return {
      meterId: meter.id,
      meterDisplayName: meter.displayName.value,
      installedOnBoardId: meter.installedOnBoardId,
      installedOnBoardName: board?.assetName ?? null,
      assignmentCount: meterAssignments.length,
      activeChannelCount: activeChannels.length,
      assignedActiveChannelCount: assignedActiveChannels.length,
      unassignedActiveChannelCount: unassignedActiveChannels.length,
      spareChannelCount: spareChannels.length,
      blockingIssueCount: blockingIssues.length,
      blockingIssueCodes: [...new Set(blockingIssues.map((issue) => issue.code))].sort(),
      state,
    };
  }).sort((left, right) => left.meterId.localeCompare(right.meterId));
  const unassignedChannels = tree.meterDevices.flatMap((meter) => {
    const board = boardById.get(meter.installedOnBoardId);
    const assignedChannelIds = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    return meter.channels.flatMap((channel) => (
      channel.purpose === 'SPARE' || assignedChannelIds.has(channel.id)
        ? []
        : [{
            meterId: meter.id,
            meterDisplayName: meter.displayName.value,
            installedOnBoardId: meter.installedOnBoardId,
            installedOnBoardName: board?.assetName ?? null,
            channelId: channel.id,
            channelOrdinal: channel.ordinal,
            channelPurpose: channel.purpose,
            channelDescription: channel.description ?? null,
          }]
    ));
  }).sort((left, right) => (
    `${left.meterId}:${String(left.channelOrdinal).padStart(6, '0')}`
      .localeCompare(`${right.meterId}:${String(right.channelOrdinal).padStart(6, '0')}`)
  ));
  const activeChannelCount = deviceSummaries.reduce((total, meter) => total + meter.activeChannelCount, 0);
  const assignedActiveChannelCount = deviceSummaries.reduce((total, meter) => total + meter.assignedActiveChannelCount, 0);
  const spareChannelCount = deviceSummaries.reduce((total, meter) => total + meter.spareChannelCount, 0);
  return withHash({
    schemaVersion: 1,
    metadata: artifactMetadata(tree, recordVersionNumber),
    rows,
    deviceSummaries,
    unassignedChannels,
    summary: {
      meterCount: tree.meterDevices.length,
      metersWithUnassignedActiveChannels: deviceSummaries.filter((meter) => meter.unassignedActiveChannelCount > 0).length,
      metersWithoutAssignments: deviceSummaries.filter((meter) => meter.assignmentCount === 0).length,
      allSpareMeters: deviceSummaries.filter((meter) => (
        meter.activeChannelCount === 0 && meter.spareChannelCount > 0
      )).length,
      activeChannelCount,
      assignedActiveChannelCount,
      unassignedActiveChannelCount: activeChannelCount - assignedActiveChannelCount,
      spareChannelCount,
    },
  });
}

export function buildInstallationMappingExport(
  tree: CanonicalInstallationTree,
  recordVersionNumber: number,
) {
  const graph = electricalGraph(tree);
  const readiness = installationReadiness(tree);
  const assignmentsByAsset = targetAssignmentsByAsset(tree);
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
      const assignments = assignmentsByAsset.get(asset.id) ?? [];
      const coverage = assetCoverageFor(tree, asset, assignments, readiness.issues);
      if (coverage.kind === 'DIRECT') {
        return {
          assetId: asset.id,
          state: 'DIRECT' as const,
          source: { kind: 'MEASUREMENT_ASSIGNMENT' as const, id: coverage.measurementAssignmentIds[0] },
        };
      }
      if (coverage.kind === 'VIRTUAL') {
        return {
          assetId: asset.id,
          state: 'VIRTUAL' as const,
          source: {
            kind: 'VIRTUAL_METER' as const,
            id: coverage.virtualMeterId,
            parentNodeId: coverage.parentNodeId,
            allocation: 'UNALLOCATED_RESIDUAL' as const,
          },
        };
      }
      if (coverage.kind === 'INVALID') {
        return {
          assetId: asset.id,
          state: 'INVALID' as const,
          reason: coverage.reason,
        };
      }
      return {
        assetId: asset.id,
        state: coverage.kind,
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
