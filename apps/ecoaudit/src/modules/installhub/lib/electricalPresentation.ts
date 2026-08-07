import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeasurementTarget,
  MeasurementAssignment,
  ReadinessIssue,
  SiteAsset,
} from '@/modules/installhub/types/domain';
import {
  FORM_DEFINITION_BY_TYPE,
  formValidationIssues,
  isFieldVisible,
  isSectionVisible,
} from '@/modules/installhub/forms/catalog';
import {
  assetElectricalSource,
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  assignmentForAsset,
  boardSupplyPath,
  boardElectricalSource,
  boardTypeLabel,
  coverageState,
  displayCodeValue,
  localReadiness,
  measurementAssignments,
  meterDeviceName,
  meterDevices,
  reachableGridSuppliesForBoard,
  replaceMeterAssignments,
  setAssetMetering,
  siteAssetMeteringState,
  siteAssetTypeLabel,
  validBoardParents,
} from './workflow';

export type ElectricalNode = ElectricalTreeReadModel['nodes'][number];
export type ElectricalEdge = ElectricalTreeReadModel['edges'][number];
export type UnresolvedElectricalRelationship = ElectricalTreeReadModel['unresolved'][number];

export type ElectricalHierarchyRow = {
  node: ElectricalNode;
  depth: number;
  ancestorIds: string[];
  fedFrom?: ElectricalEdge;
  parent?: ElectricalNode;
  measuredBy: ElectricalNode[];
};

function nodeSort(left: ElectricalNode, right: ElectricalNode): number {
  const order: Record<ElectricalNode['kind'], number> = {
    GRID: 0,
    BOARD: 1,
    SITE_ASSET: 2,
    VIRTUAL_RESIDUAL: 3,
  };
  return order[left.kind] - order[right.kind]
    || (left.displayCode || left.name).localeCompare(right.displayCode || right.name)
    || left.id.localeCompare(right.id);
}

/** Includes all records that must stay outside the confirmed topology. */
function mapExcludedElectricalRecords(
  model?: ElectricalTreeReadModel,
): UnresolvedElectricalRelationship[] {
  if (!model) return [];
  const records = [...model.unresolved];
  const existingKeys = new Set(records.map((item) => `${item.subjectType}:${item.subjectId}:${item.relation}`));
  for (const node of model.nodes) {
    if (
      node.kind !== 'SITE_ASSET'
      || (node.coverageState !== 'TBC' && node.coverageState !== 'INVALID')
      || existingKeys.has(`SITE_ASSET:${node.id}:MEASUREMENT`)
    ) continue;
    records.push({
      id: `unresolved:coverage:${node.id}`,
      subjectType: 'SITE_ASSET',
      subjectId: node.id,
      relation: 'MEASUREMENT',
      missingEnd: 'SOURCE',
      reason: node.coverageState === 'TBC' ? 'TBC' : 'INVALID',
    });
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

/** Explicitly deferred records shown in the small To be confirmed tray. */
export function unresolvedElectricalRecords(
  model?: ElectricalTreeReadModel,
): UnresolvedElectricalRelationship[] {
  return mapExcludedElectricalRecords(model).filter((item) => item.reason === 'TBC');
}

/**
 * Restricts the map to topology that has a complete, confirmed path from a
 * grid root. Records whose source or coverage is TBC/invalid, and descendants
 * that depend on those records, stay in the separate unresolved-record tray.
 */
export function resolvedElectricalTopology(
  model?: ElectricalTreeReadModel,
): ElectricalTreeReadModel | undefined {
  if (!model) return undefined;
  const unresolved = mapExcludedElectricalRecords(model);
  const excludedSubjectIds = new Set(
    unresolved.flatMap((item) => (
      item.subjectType === 'BOARD' || item.subjectType === 'SITE_ASSET'
        ? [item.subjectId]
        : []
    )),
  );
  const includedNodeIds = new Set(
    model.nodes
      .filter((node) => node.kind === 'GRID' && !excludedSubjectIds.has(node.id))
      .map((node) => node.id),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of model.edges) {
      if (
        edge.relationship !== 'FED_FROM'
        || !includedNodeIds.has(edge.sourceNodeId)
        || includedNodeIds.has(edge.targetNodeId)
        || excludedSubjectIds.has(edge.targetNodeId)
      ) continue;
      includedNodeIds.add(edge.targetNodeId);
      changed = true;
    }
    for (const node of model.nodes) {
      if (
        node.kind !== 'VIRTUAL_RESIDUAL'
        || !node.parentNodeId
        || !includedNodeIds.has(node.parentNodeId)
        || includedNodeIds.has(node.id)
        || excludedSubjectIds.has(node.id)
      ) continue;
      includedNodeIds.add(node.id);
      changed = true;
    }
  }

  return {
    ...model,
    nodes: model.nodes.filter((node) => includedNodeIds.has(node.id)),
    edges: model.edges.filter((edge) => (
      includedNodeIds.has(edge.sourceNodeId)
      && includedNodeIds.has(edge.targetNodeId)
    )),
    unresolved: [],
  };
}

export type UnresolvedRelationshipRemovalPlan = {
  canRemove: boolean;
  description: string;
  consequences: string[];
  blockedMessage?: string;
};

function completedRemovalBlock(tree: InstallationTree): string | undefined {
  return tree.installation.status === 'Completed'
    ? 'Reopen this completed installation before removing an unresolved record.'
    : undefined;
}

function currentlyToBeConfirmed(
  tree: InstallationTree,
  item: UnresolvedElectricalRelationship,
): boolean {
  if (item.reason !== 'TBC') return false;
  if (item.subjectType === 'MEASUREMENT_ASSIGNMENT') {
    const assignment = measurementAssignments(tree).find((candidate) => candidate.id === item.subjectId);
    return Boolean(assignment && (assignment.status === 'TBC' || assignment.target.kind === 'TBC'));
  }
  if (item.subjectType === 'SITE_ASSET') {
    const asset = tree.siteAssets.find((candidate) => candidate.id === item.subjectId);
    if (!asset) return false;
    return item.relation === 'SUPPLY'
      ? assetElectricalSource(asset).kind === 'TBC'
      : siteAssetMeteringState(asset).kind === 'TBC';
  }
  const board = tree.electricalAssets.find((candidate) => candidate.id === item.subjectId);
  return Boolean(board && item.relation === 'SUPPLY' && boardElectricalSource(board).kind === 'TBC');
}

/**
 * Returns a conservative removal plan. A TBC board or asset can be removed
 * only when doing so cannot delete a confirmed topology edge, meter, or
 * measurement assignment. This keeps the tray action scoped to unresolved
 * data and prevents a convenient cleanup control from becoming a cascade.
 */
export function unresolvedRelationshipRemovalPlan(
  tree: InstallationTree,
  item: UnresolvedElectricalRelationship,
): UnresolvedRelationshipRemovalPlan {
  const completedBlock = completedRemovalBlock(tree);
  const staleBlock = currentlyToBeConfirmed(tree, item)
    ? undefined
    : 'This record is no longer To be confirmed. Refresh the electrical map before making any change.';
  if (item.subjectType === 'MEASUREMENT_ASSIGNMENT') {
    const assignment = measurementAssignments(tree).find((candidate) => candidate.id === item.subjectId);
    return {
      canRemove: Boolean(assignment) && !completedBlock && !staleBlock,
      description: 'Remove only this unresolved measurement assignment from the active installation data.',
      consequences: [
        'The metering device, channels, assets, switchboards, and all other assignments will remain.',
        'If this was an asset’s only attempted measurement, that asset will remain To be confirmed.',
      ],
      ...(completedBlock
        ? { blockedMessage: completedBlock }
        : staleBlock
          ? { blockedMessage: staleBlock }
        : assignment
          ? {}
          : { blockedMessage: 'This unresolved assignment is no longer present. Refresh the electrical map.' }),
    };
  }

  if (item.subjectType === 'SITE_ASSET') {
    const asset = tree.siteAssets.find((candidate) => candidate.id === item.subjectId);
    const linkedAssignments = measurementAssignments(tree).filter((assignment) => (
      assignment.target.kind === 'SITE_ASSET'
      && assignment.target.siteAssetId === item.subjectId
    ));
    const linkedForms = tree.formSubmissions.filter((form) => form.siteAssetId === item.subjectId);
    const dependencyBlock = linkedAssignments.length
      ? `This asset still has ${linkedAssignments.length} measurement assignment${linkedAssignments.length === 1 ? '' : 's'}. Remove those assignments first so resolved metering data is preserved.`
      : linkedForms.length
        ? `This asset is referenced by ${linkedForms.length} field form${linkedForms.length === 1 ? '' : 's'}. Remove or detach those forms first so their saved context is not broken.`
        : undefined;
    return {
      canRemove: Boolean(asset) && !completedBlock && !staleBlock && !dependencyBlock,
      description: 'Remove this unresolved site asset from the active installation register.',
      consequences: [
        'No confirmed switchboard, meter, channel, or measurement relationship will be removed.',
        'Completed field records remain available in installation history.',
      ],
      ...(completedBlock
        ? { blockedMessage: completedBlock }
        : staleBlock
          ? { blockedMessage: staleBlock }
        : dependencyBlock
          ? { blockedMessage: dependencyBlock }
          : asset
            ? {}
            : { blockedMessage: 'This unresolved site asset is no longer present. Refresh the electrical map.' }),
    };
  }

  const board = tree.electricalAssets.find((candidate) => candidate.id === item.subjectId);
  const meterIds = new Set([
    ...(board?.meters || []).map((meter) => meter.id),
    ...meterDevices(tree)
      .filter((meter) => meter.installedOnBoardId === item.subjectId)
      .map((meter) => meter.id),
  ]);
  const childBoardCount = tree.electricalAssets.filter((candidate) => {
    const source = boardElectricalSource(candidate);
    return source.kind === 'BOARD' && source.boardId === item.subjectId;
  }).length;
  const suppliedAssetCount = tree.siteAssets.filter((candidate) => {
    const source = assetElectricalSource(candidate);
    return source.kind === 'BOARD' && source.boardId === item.subjectId;
  }).length;
  const linkedAssignmentCount = measurementAssignments(tree).filter((assignment) => (
    meterIds.has(assignment.meterId)
    || (assignment.target.kind === 'BOARD' && assignment.target.boardId === item.subjectId)
  )).length;
  const linkedFormCount = tree.formSubmissions.filter((form) => (
    form.boardId === item.subjectId
    || Boolean(form.meterId && meterIds.has(form.meterId))
  )).length;
  const dependencyCount = childBoardCount + suppliedAssetCount + meterIds.size + linkedAssignmentCount;
  const dependencyBlock = dependencyCount
    ? 'This switchboard still participates in confirmed downstream or metering data. Remove those relationships from their records first so resolved topology is preserved.'
    : linkedFormCount
      ? `This switchboard is referenced by ${linkedFormCount} field form${linkedFormCount === 1 ? '' : 's'}. Remove or detach those forms first so their saved context is not broken.`
      : undefined;
  return {
    canRemove: Boolean(board) && !completedBlock && !staleBlock && !dependencyBlock,
    description: 'Remove this unresolved switchboard from the active installation register.',
    consequences: [
      'No confirmed downstream supply edge, meter, or measurement assignment will be removed.',
      'Completed field records remain available in installation history.',
    ],
    ...(completedBlock
      ? { blockedMessage: completedBlock }
      : staleBlock
        ? { blockedMessage: staleBlock }
      : dependencyBlock
        ? { blockedMessage: dependencyBlock }
        : board
          ? {}
          : { blockedMessage: 'This unresolved switchboard is no longer present. Refresh the electrical map.' }),
  };
}

export function removeUnresolvedElectricalRelationship(
  tree: InstallationTree,
  item: UnresolvedElectricalRelationship,
): void {
  const plan = unresolvedRelationshipRemovalPlan(tree, item);
  if (!plan.canRemove) {
    throw new Error(plan.blockedMessage || 'This unresolved record cannot be removed.');
  }

  if (item.subjectType === 'MEASUREMENT_ASSIGNMENT') {
    const assignments = measurementAssignments(tree);
    const removed = assignments.find((assignment) => assignment.id === item.subjectId);
    tree.measurementAssignments = assignments.filter((assignment) => assignment.id !== item.subjectId);
    const affectedAssetIds = new Set([
      ...(removed?.target.kind === 'SITE_ASSET' ? [removed.target.siteAssetId] : []),
      ...tree.siteAssets.flatMap((asset) => {
        const state = siteAssetMeteringState(asset);
        return state.kind === 'METERED' && state.measurementAssignmentIds.includes(item.subjectId)
          ? [asset.id]
          : [];
      }),
    ]);
    for (const asset of tree.siteAssets.filter((candidate) => affectedAssetIds.has(candidate.id))) {
      const remaining = tree.measurementAssignments.filter((assignment) => (
        assignment.target.kind === 'SITE_ASSET'
        && assignment.target.siteAssetId === asset.id
      ));
      if (!remaining.length) {
        setAssetMetering(tree, asset, { kind: 'TBC' });
      } else if (asset.meteringState?.kind === 'METERED') {
        asset.meteringState = {
          kind: 'METERED',
          measurementAssignmentIds: remaining.map((assignment) => assignment.id),
        };
      }
    }
    return;
  }

  if (item.subjectType === 'SITE_ASSET') {
    tree.siteAssets = tree.siteAssets.filter((asset) => asset.id !== item.subjectId);
    tree.formSubmissions = tree.formSubmissions.map((form) => (
      form.status === 'Draft' && form.siteAssetId === item.subjectId
        ? { ...form, siteAssetId: null }
        : form
    ));
    return;
  }

  tree.electricalAssets = tree.electricalAssets.filter((board) => board.id !== item.subjectId);
  tree.formSubmissions = tree.formSubmissions.map((form) => (
    form.status === 'Draft' && form.boardId === item.subjectId
      ? { ...form, boardId: null }
      : form
  ));
}

/**
 * Builds presentation rows from the authoritative graph edges. FED_FROM edges
 * determine hierarchy; MEASURES edges remain an overlay and never imply supply.
 */
export function electricalHierarchyRows(
  model?: ElectricalTreeReadModel,
): ElectricalHierarchyRow[] {
  if (!model) return [];
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const parentEdgeByTarget = new Map<string, ElectricalEdge>();
  const childrenBySource = new Map<string, ElectricalNode[]>();
  const measuredByTarget = new Map<string, ElectricalNode[]>();

  for (const edge of [...model.edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = nodes.get(edge.sourceNodeId);
    const target = nodes.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (edge.relationship === 'FED_FROM') {
      if (!parentEdgeByTarget.has(target.id)) parentEdgeByTarget.set(target.id, edge);
      const children = childrenBySource.get(source.id) || [];
      if (!children.some((child) => child.id === target.id)) children.push(target);
      childrenBySource.set(source.id, children);
    } else {
      const sources = measuredByTarget.get(target.id) || [];
      if (!sources.some((candidate) => candidate.id === source.id)) sources.push(source);
      measuredByTarget.set(target.id, sources);
    }
  }

  // Virtual residuals are server-derived nodes with a canonical parentNodeId.
  // They do not receive FED_FROM edges because they are coverage formulas, not
  // physical supply endpoints.
  for (const node of model.nodes) {
    if (node.kind !== 'VIRTUAL_RESIDUAL' || !node.parentNodeId) continue;
    const parent = nodes.get(node.parentNodeId);
    if (!parent) continue;
    const children = childrenBySource.get(parent.id) || [];
    if (!children.some((child) => child.id === node.id)) children.push(node);
    childrenBySource.set(parent.id, children);
  }
  for (const children of childrenBySource.values()) children.sort(nodeSort);
  for (const sources of measuredByTarget.values()) sources.sort(nodeSort);

  const roots = model.nodes
    .filter((node) => !parentEdgeByTarget.has(node.id) && !(node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId && nodes.has(node.parentNodeId)))
    .sort(nodeSort);
  const rows: ElectricalHierarchyRow[] = [];
  const emitted = new Set<string>();

  function visit(node: ElectricalNode, depth: number, ancestorIds: string[], path: Set<string>) {
    if (path.has(node.id) || emitted.has(node.id)) return;
    const nextPath = new Set(path).add(node.id);
    const fedFrom = parentEdgeByTarget.get(node.id);
    rows.push({
      node,
      depth,
      ancestorIds,
      ...(fedFrom ? { fedFrom, parent: nodes.get(fedFrom.sourceNodeId) } : {}),
      measuredBy: measuredByTarget.get(node.id) || [],
    });
    emitted.add(node.id);
    for (const child of childrenBySource.get(node.id) || []) {
      visit(child, depth + 1, [...ancestorIds, node.id], nextPath);
    }
  }

  for (const root of roots) visit(root, 0, [], new Set());
  // Preserve malformed/cyclic/orphaned server nodes in the equivalent view.
  for (const node of [...model.nodes].sort(nodeSort)) {
    if (!emitted.has(node.id)) visit(node, 0, [], new Set());
  }
  return rows;
}

export function filterElectricalHierarchyRows(
  rows: ElectricalHierarchyRow[],
  query: string,
): ElectricalHierarchyRow[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return rows;
  const matchingIds = new Set<string>();
  for (const row of rows) {
    const searchable = [
      row.node.id,
      row.node.displayCode,
      row.node.name,
      row.node.kind,
      row.node.typeLabel,
      row.parent?.displayCode,
      row.parent?.name,
      ...row.measuredBy.flatMap((node) => [node.displayCode, node.name]),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      matchingIds.add(row.node.id);
      row.ancestorIds.forEach((id) => matchingIds.add(id));
    }
  }
  return rows.filter((row) => matchingIds.has(row.node.id));
}

export type MeasurementTargetDetails = {
  kind: MeasurementTarget['kind'];
  id: string | null;
  name: string;
  code: string | null;
  label: string;
  href: string | null;
};

export function measurementTargetDetails(
  tree: InstallationTree,
  target: MeasurementTarget,
): MeasurementTargetDetails {
  const installationBase = `/installhub/installations/${encodeURIComponent(tree.installation.id)}`;
  if (target.kind === 'BOARD') {
    const board = tree.electricalAssets.find((item) => item.id === target.boardId);
    return {
      kind: target.kind,
      id: target.boardId,
      name: board?.assetName || 'Missing switchboard',
      code: board ? displayCodeValue(board) : null,
      label: board ? `${displayCodeValue(board)} — ${board.assetName}` : `Missing switchboard ${target.boardId}`,
      href: board ? `${installationBase}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}` : null,
    };
  }
  if (target.kind === 'SITE_ASSET') {
    const asset = tree.siteAssets.find((item) => item.id === target.siteAssetId);
    return {
      kind: target.kind,
      id: target.siteAssetId,
      name: asset?.assetName || 'Missing site asset',
      code: asset ? displayCodeValue(asset) : null,
      label: asset ? `${displayCodeValue(asset)} — ${asset.assetName}` : `Missing site asset ${target.siteAssetId}`,
      href: asset ? `${installationBase}/zones/${encodeURIComponent(asset.zoneId)}/assets/${encodeURIComponent(asset.id)}` : null,
    };
  }
  if (target.kind === 'GRID_BOUNDARY') {
    const supply = tree.gridSupplies?.find((item) => item.id === target.gridSupplyId);
    return {
      kind: target.kind,
      id: target.gridSupplyId,
      name: supply?.name || 'Missing Grid boundary',
      code: supply?.nmi || null,
      label: supply ? `${supply.name}${supply.nmi ? ` — NMI ${supply.nmi}` : ''}` : `Missing Grid boundary ${target.gridSupplyId}`,
      href: null,
    };
  }
  return {
    kind: 'TBC',
    id: null,
    name: 'To be confirmed',
    code: null,
    label: 'Target to be confirmed',
    href: null,
  };
}

export type ReconciliationEntityDetails = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  zoneId: string | null;
  zoneName: string | null;
  href: string;
};

function installationHref(tree: InstallationTree): string {
  return `/installhub/installations/${encodeURIComponent(tree.installation.id)}`;
}

function detailsForId(tree: InstallationTree, id: string): ReconciliationEntityDetails | null {
  const base = installationHref(tree);
  const zoneName = (zoneId?: string | null) => tree.zones.find((zone) => zone.id === zoneId)?.zoneName || null;
  const zone = tree.zones.find((item) => item.id === id);
  if (zone) return {
    id,
    name: zone.zoneName,
    code: null,
    type: 'Zone',
    zoneId: zone.id,
    zoneName: zone.zoneName,
    href: `${base}/zones/${encodeURIComponent(zone.id)}`,
  };
  const board = tree.electricalAssets.find((item) => item.id === id);
  if (board) return {
    id,
    name: board.assetName,
    code: displayCodeValue(board),
    type: boardTypeLabel(board),
    zoneId: board.zoneId,
    zoneName: zoneName(board.zoneId),
    href: `${base}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}`,
  };
  const asset = tree.siteAssets.find((item) => item.id === id);
  if (asset) return {
    id,
    name: asset.assetName,
    code: displayCodeValue(asset),
    type: siteAssetTypeLabel(asset),
    zoneId: asset.zoneId,
    zoneName: zoneName(asset.zoneId),
    href: `${base}/zones/${encodeURIComponent(asset.zoneId)}/assets/${encodeURIComponent(asset.id)}`,
  };
  const meter = meterDevices(tree).find((item) => item.id === id);
  if (meter) {
    const installedBoard = tree.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
    return {
      id,
      name: meterDeviceName(meter),
      code: meter.serialNumber || meter.displayName.value,
      type: `${meter.deviceFamily} ${meter.deviceModel}`,
      zoneId: installedBoard?.zoneId || null,
      zoneName: zoneName(installedBoard?.zoneId),
      href: installedBoard ? `${base}/zones/${encodeURIComponent(installedBoard.zoneId)}/boards/${encodeURIComponent(installedBoard.id)}/meters/${encodeURIComponent(meter.id)}` : base,
    };
  }
  for (const device of meterDevices(tree)) {
    const channel = device.channels.find((item) => item.id === id);
    if (!channel) continue;
    const installedBoard = tree.electricalAssets.find((item) => item.id === device.installedOnBoardId);
    return {
      id,
      name: `${meterDeviceName(device)} channel ${channel.ordinal}`,
      code: `Channel ${channel.ordinal}`,
      type: channel.purpose.replaceAll('_', ' ').toLocaleLowerCase(),
      zoneId: installedBoard?.zoneId || null,
      zoneName: zoneName(installedBoard?.zoneId),
      href: installedBoard ? `${base}/zones/${encodeURIComponent(installedBoard.zoneId)}/boards/${encodeURIComponent(installedBoard.id)}/meters/${encodeURIComponent(device.id)}` : base,
    };
  }
  const assignment = measurementAssignments(tree).find((item) => item.id === id);
  if (assignment) {
    const target = measurementTargetDetails(tree, assignment.target);
    const device = meterDevices(tree).find((item) => item.id === assignment.meterId);
    const installedBoard = tree.electricalAssets.find((item) => item.id === device?.installedOnBoardId);
    return {
      id,
      name: target.label,
      code: target.code,
      type: `${assignment.phaseMode.replaceAll('_', ' ').toLocaleLowerCase()} measurement assignment`,
      zoneId: target.kind === 'BOARD'
        ? tree.electricalAssets.find((item) => item.id === target.id)?.zoneId || null
        : target.kind === 'SITE_ASSET'
          ? tree.siteAssets.find((item) => item.id === target.id)?.zoneId || null
          : installedBoard?.zoneId || null,
      zoneName: target.kind === 'BOARD'
        ? zoneName(tree.electricalAssets.find((item) => item.id === target.id)?.zoneId)
        : target.kind === 'SITE_ASSET'
          ? zoneName(tree.siteAssets.find((item) => item.id === target.id)?.zoneId)
          : zoneName(installedBoard?.zoneId),
      href: target.href || (installedBoard && device ? `${base}/zones/${encodeURIComponent(installedBoard.zoneId)}/boards/${encodeURIComponent(installedBoard.id)}/meters/${encodeURIComponent(device.id)}` : base),
    };
  }
  const grid = tree.gridSupplies?.find((item) => item.id === id);
  if (grid) return { id, name: grid.name, code: grid.nmi || null, type: 'Grid supply', zoneId: null, zoneName: null, href: base };
  const form = tree.formSubmissions.find((item) => item.id === id);
  if (form) return {
    id,
    name: form.formType.replaceAll('-', ' '),
    code: form.id,
    type: `${form.status} field form`,
    zoneId: form.zoneId || null,
    zoneName: zoneName(form.zoneId),
    href: `${base}/forms/${encodeURIComponent(form.id)}`,
  };
  const virtual = tree.serverDerived?.virtualMeterDefinitions.find((item) => item.id === id);
  if (virtual) return { id, name: `Residual at ${virtual.parentNodeId}`, code: id, type: 'Virtual residual', zoneId: null, zoneName: null, href: `${base}/data` };
  return null;
}

export function readinessIssueKey(issue: ReadinessIssue): string {
  return [issue.code, issue.entityType, issue.entityId, issue.field || ''].join(':');
}

export function readinessEntityDetails(
  tree: InstallationTree,
  issue: ReadinessIssue,
): ReconciliationEntityDetails {
  if (issue.entityType === 'installation') return {
    id: tree.installation.id,
    name: tree.installation.siteName,
    code: tree.installation.siteCode || null,
    type: 'Installation',
    zoneId: null,
    zoneName: null,
    href: installationHref(tree),
  };
  return detailsForId(tree, issue.entityId) || {
    id: issue.entityId,
    name: `Missing ${issue.entityType.replaceAll('_', ' ')}`,
    code: issue.entityId,
    type: issue.entityType.replaceAll('_', ' '),
    zoneId: null,
    zoneName: null,
    href: installationHref(tree),
  };
}

export function readinessCandidateDetails(
  tree: InstallationTree,
  issue: ReadinessIssue,
): ReconciliationEntityDetails[] {
  return (issue.candidateIds || [])
    .map((id) => detailsForId(tree, id))
    .filter((item): item is ReconciliationEntityDetails => Boolean(item));
}

export type ReadinessResolutionCandidate = ReconciliationEntityDetails & {
  action:
    | 'SET_SUPPLY_BOARD'
    | 'SET_SUPPLY_GRID'
    | 'SET_DEFAULT_GRID'
    | 'SET_MEASUREMENT_TARGET_BOARD'
    | 'SET_MEASUREMENT_TARGET_GRID'
    | 'SET_MEASUREMENT_TARGET_ASSET'
    | 'SET_METERING_UNMETERED';
};

export function readinessResolutionCandidates(
  tree: InstallationTree,
  issue: ReadinessIssue,
): ReadinessResolutionCandidate[] {
  if (issue.code === 'GRID_SUPPLY_INVALID' && issue.entityType === 'installation') {
    return (tree.gridSupplies || [])
      .map((supply) => detailsForId(tree, supply.id))
      .filter((item): item is ReconciliationEntityDetails => Boolean(item))
      .map((item) => ({ ...item, action: 'SET_DEFAULT_GRID' as const }));
  }
  if (issue.code === 'MEASUREMENT_TARGET_TBC' && issue.entityType === 'measurement_assignment') {
    return measurementTargetResolutionCandidates(tree, issue.entityId);
  }
  if (
    issue.code === 'METERING_STATE_INVALID'
    && issue.entityType === 'site_asset'
    && issue.field === 'meteringState'
  ) {
    const asset = tree.siteAssets.find((item) => item.id === issue.entityId);
    if (!asset || siteAssetMeteringState(asset).kind !== 'TBC' || assignmentForAsset(tree, asset.id)) return [];
    const zone = tree.zones.find((item) => item.id === asset.zoneId);
    return [{
      id: `unmetered:${asset.id}`,
      name: 'Confirmed unmetered',
      code: null,
      type: 'Metering state',
      zoneId: asset.zoneId,
      zoneName: zone?.zoneName || null,
      href: detailsForId(tree, asset.id)?.href || installationHref(tree),
      action: 'SET_METERING_UNMETERED',
    }];
  }
  const supplyIssueCodes = new Set([
    'SUPPLY_TBC',
    'SUPPLY_SOURCE_INVALID',
    'GRID_SUPPLY_INVALID',
    'ELECTRICAL_CYCLE',
  ]);
  if (!supplyIssueCodes.has(issue.code) || (issue.entityType !== 'board' && issue.entityType !== 'site_asset')) return [];
  // candidateIds is a bounded API preview. The loaded canonical tree is the
  // authority for the complete picker so valid resolutions beyond that preview
  // never become unreachable.
  const boards = issue.entityType === 'board'
    ? validBoardParents(tree, issue.entityId)
    : tree.electricalAssets;
  const boardCandidates = boards
    .map((board) => detailsForId(tree, board.id))
    .filter((item): item is ReconciliationEntityDetails => Boolean(item))
    .map((item) => ({ ...item, action: 'SET_SUPPLY_BOARD' as const }));
  const gridCandidates = (tree.gridSupplies || [])
    .map((supply) => detailsForId(tree, supply.id))
    .filter((item): item is ReconciliationEntityDetails => Boolean(item))
    .map((item) => ({ ...item, action: 'SET_SUPPLY_GRID' as const }));
  return [...gridCandidates, ...boardCandidates];
}

function measurementTargetResolutionCandidates(
  tree: InstallationTree,
  assignmentId: string,
): ReadinessResolutionCandidate[] {
  const assignment = measurementAssignments(tree).find((item) => item.id === assignmentId);
  const meter = assignment ? meterDevices(tree).find((item) => item.id === assignment.meterId) : undefined;
  if (!assignment || !meter || !assignment.channelIds.length) return [];
  const purposes = new Set(
    assignment.channelIds.map((channelId) => meter.channels.find((channel) => channel.id === channelId)?.purpose),
  );
  if (purposes.size !== 1 || purposes.has(undefined) || purposes.has('SPARE')) return [];
  const purpose = [...purposes][0];
  const asCandidate = (
    id: string,
    action: ReadinessResolutionCandidate['action'],
  ): ReadinessResolutionCandidate | null => {
    const details = detailsForId(tree, id);
    return details ? { ...details, action } : null;
  };
  if (purpose === 'MAIN_SUPPLY') {
    return [
      ...reachableGridSuppliesForBoard(tree, meter.installedOnBoardId)
        .map((supply) => asCandidate(supply.id, 'SET_MEASUREMENT_TARGET_GRID')),
      asCandidate(meter.installedOnBoardId, 'SET_MEASUREMENT_TARGET_BOARD'),
    ].filter((item): item is ReadinessResolutionCandidate => Boolean(item));
  }
  if (purpose !== 'SUB_CIRCUIT') return [];
  const downstreamBoards = tree.electricalAssets.filter((board) => (
    board.id !== meter.installedOnBoardId
    && boardSupplyPath(tree, board.id).includes(meter.installedOnBoardId)
  ));
  const eligibleAssets = tree.siteAssets.filter((asset) => {
    const source = assetElectricalSource(asset);
    return source.kind === 'BOARD'
    && source.boardId === meter.installedOnBoardId
    && !measurementAssignments(tree).some((candidate) => (
      candidate.id !== assignment.id
      && candidate.target.kind === 'SITE_ASSET'
      && candidate.target.siteAssetId === asset.id
    ));
  });
  return [
    ...downstreamBoards.map((board) => asCandidate(board.id, 'SET_MEASUREMENT_TARGET_BOARD')),
    ...eligibleAssets.map((asset) => asCandidate(asset.id, 'SET_MEASUREMENT_TARGET_ASSET')),
  ].filter((item): item is ReadinessResolutionCandidate => Boolean(item));
}

export function applyReadinessCandidateResolution(
  tree: InstallationTree,
  issue: ReadinessIssue,
  candidateId: string,
): boolean {
  const candidate = readinessResolutionCandidates(tree, issue).find((item) => item.id === candidateId);
  if (!candidate) return false;
  if (candidate.action === 'SET_DEFAULT_GRID') {
    tree.gridSupplies = (tree.gridSupplies || []).map((supply) => ({
      ...supply,
      isDefault: supply.id === candidateId,
    }));
    return true;
  }
  if (candidate.action === 'SET_METERING_UNMETERED') {
    const asset = tree.siteAssets.find((item) => item.id === issue.entityId);
    if (!asset) return false;
    setAssetMetering(tree, asset, { kind: 'UNMETERED' });
    return true;
  }
  if (
    candidate.action === 'SET_MEASUREMENT_TARGET_BOARD'
    || candidate.action === 'SET_MEASUREMENT_TARGET_GRID'
    || candidate.action === 'SET_MEASUREMENT_TARGET_ASSET'
  ) {
    const assignment = measurementAssignments(tree).find((item) => item.id === issue.entityId);
    if (!assignment) return false;
    const target: MeasurementAssignment['target'] = candidate.action === 'SET_MEASUREMENT_TARGET_BOARD'
      ? { kind: 'BOARD', boardId: candidateId }
      : candidate.action === 'SET_MEASUREMENT_TARGET_GRID'
        ? { kind: 'GRID_BOUNDARY', gridSupplyId: candidateId }
        : { kind: 'SITE_ASSET', siteAssetId: candidateId };
    const desired = measurementAssignments(tree)
      .filter((item) => item.meterId === assignment.meterId)
      .map((item) => item.id === assignment.id
        ? { ...item, target, status: 'CONFIRMED' as const }
        : item);
    replaceMeterAssignments(tree, assignment.meterId, desired);
    return true;
  }
  if (issue.entityType === 'board') {
    const board = tree.electricalAssets.find((item) => item.id === issue.entityId);
    if (!board) return false;
    applyBoardElectricalSource(board, candidate.action === 'SET_SUPPLY_GRID'
      ? { kind: 'GRID', gridSupplyId: candidateId }
      : { kind: 'BOARD', boardId: candidateId });
    return true;
  }
  if (issue.entityType === 'site_asset') {
    const asset = tree.siteAssets.find((item) => item.id === issue.entityId);
    if (!asset) return false;
    applyAssetElectricalSource(asset, candidate.action === 'SET_SUPPLY_GRID'
      ? { kind: 'GRID', gridSupplyId: candidateId }
      : { kind: 'BOARD', boardId: candidateId });
    return true;
  }
  return false;
}

export type ReadinessCorrectionAction = {
  href: string;
  label: string;
  instruction: string;
};

function indexedEvidenceHash(field: string | undefined, prefix: string): string {
  const index = field?.match(/\[(\d+)\]/)?.[1];
  return `#${prefix}${index === undefined ? '' : `-${Number(index) + 1}`}`;
}

function formFieldHash(fieldKey: string): string {
  return `#form-field-${fieldKey.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function firstInvalidFormHash(tree: InstallationTree, formId: string): string {
  const form = tree.formSubmissions.find((item) => item.id === formId);
  const fieldKey = form ? formValidationIssues(form)[0]?.fieldKey : undefined;
  return fieldKey ? formFieldHash(fieldKey) : '';
}

function exactEvidenceHash(tree: InstallationTree, issue: ReadinessIssue): string {
  if (issue.entityType === 'board') {
    return issue.field === 'photo'
      ? '#board-photo'
      : issue.field?.startsWith('extraPhotos[')
        ? indexedEvidenceHash(issue.field, 'board-extra-photos')
        : '#board-evidence';
  }
  if (issue.entityType === 'site_asset') {
    return issue.field === 'locationPhoto'
      ? '#asset-location-photo'
      : issue.field?.startsWith('extraPhotos[')
        ? indexedEvidenceHash(issue.field, 'asset-extra-photos')
        : '#asset-evidence';
  }
  if (issue.entityType === 'zone') {
    return issue.field?.startsWith('photos[')
      ? indexedEvidenceHash(issue.field, 'zone-photos')
      : '#zone-evidence';
  }
  if (issue.entityType === 'meter') {
    if (issue.field === 'wwPhotos.deviceInstalled') return '#meter-photo-deviceInstalled';
    if (issue.field === 'wwPhotos.switchboardOverview') return '#meter-photo-switchboardOverview';
    if (issue.field === 'wwPhotos.labeling') return '#meter-photo-labeling';
    return issue.field?.startsWith('wwPhotos.extra[')
      ? indexedEvidenceHash(issue.field, 'meter-extra-photos')
      : '#meter-evidence';
  }
  if (issue.entityType === 'form') {
    const form = tree.formSubmissions.find((item) => item.id === issue.entityId);
    const attachmentIndex = issue.field?.match(/^attachments\[(\d+)\]\.uri$/)?.[1];
    const slot = attachmentIndex === undefined
      ? undefined
      : form?.attachments[Number(attachmentIndex)]?.slot;
    const slotExists = slot && form
      ? FORM_DEFINITION_BY_TYPE[form.formType].sections.some((section) =>
          isSectionVisible(section, form.answers)
          && section.fields.some((field) =>
            field.key === slot && isFieldVisible(field, form.answers),
          ),
        )
      : false;
    if (slot && slotExists) return formFieldHash(slot);
    if (
      form?.schemaVersion === 1
      && FORM_DEFINITION_BY_TYPE[form.formType].sections.length === 0
      && form.attachments.length > 0
    ) return '#form-legacy-evidence';
    return form?.status === 'Completed' ? '#form-completed-actions' : '#form-actions';
  }
  return '';
}

function meterEditorHrefForIssue(
  tree: InstallationTree,
  issue: ReadinessIssue,
): string | null {
  const assignments = measurementAssignments(tree);
  const devices = meterDevices(tree);
  const channelOwner = issue.entityType === 'channel'
    ? devices.find((meter) => meter.channels.some((channel) => channel.id === issue.entityId))
    : undefined;
  const assignment = issue.entityType === 'measurement_assignment'
    ? assignments.find((item) => item.id === issue.entityId)
    : undefined;
  const meterId = issue.entityType === 'meter'
    ? issue.entityId
    : issue.entityType === 'channel'
      ? channelOwner?.id
      : issue.entityType === 'measurement_assignment'
        ? assignment?.meterId
        : null;
  if (!meterId) return null;
  const meter = devices.find((item) => item.id === meterId);
  const board = tree.electricalAssets.find((item) => item.id === meter?.installedOnBoardId);
  if (!meter || !board) return null;
  const channelIndex = channelOwner?.channels.findIndex((channel) => channel.id === issue.entityId) ?? -1;
  const channelOrdinal = channelIndex >= 0 ? channelIndex + 1 : null;
  const meterAssignmentIndex = assignment
    ? assignments.filter((item) => item.meterId === meterId).findIndex((item) => item.id === assignment.id)
    : -1;
  const assignmentOrdinal = meterAssignmentIndex >= 0 ? meterAssignmentIndex + 1 : null;
  const duplicateAssignment = issue.entityType === 'channel'
    && issue.code === 'CHANNEL_DUPLICATE_ASSIGNMENT'
    && issue.field === 'channelIds'
    ? assignments.filter((item) =>
        item.meterId === meterId
        && item.channelIds.includes(issue.entityId)
        && (issue.candidateIds || []).includes(item.id),
      ).at(-1)
    : undefined;
  const duplicateAssignmentIndex = duplicateAssignment
    ? assignments.filter((item) => item.meterId === meterId)
      .findIndex((item) => item.id === duplicateAssignment.id)
    : -1;
  const duplicateAssignmentOrdinal = duplicateAssignmentIndex >= 0
    ? duplicateAssignmentIndex + 1
    : null;
  const hash = issue.field === 'formSubmission'
    ? ''
    : issue.code === 'EVIDENCE_NOT_CONFIRMED'
      ? exactEvidenceHash(tree, issue)
    : issue.code === 'DISPLAY_CODE_INVALID' || issue.code === 'DISPLAY_CODE_DUPLICATE'
      ? '#meter-name'
    : issue.code === 'METER_DEVICE_REQUIRED' && issue.field !== 'formSubmission'
      ? '#meter-serial'
      : issue.code === 'CUSTOM_TYPE_REQUIRED' && issue.field === 'customModelName'
        ? '#meter-custom-model'
        : issue.code === 'CUSTOM_TYPE_REQUIRED' && issue.field === 'customManufacturerName'
          ? '#meter-custom-manufacturer'
          : duplicateAssignmentOrdinal
            ? `#meter-assignment-${duplicateAssignmentOrdinal}-channels`
          : issue.entityType === 'meter' && issue.code === 'CHANNEL_NOT_FOUND'
            ? '#meter-channel-layout'
          : issue.entityType === 'channel' && (
              issue.code === 'CHANNEL_NOT_FOUND'
              || (issue.code === 'CHANNEL_DUPLICATE_ASSIGNMENT' && issue.field === 'ordinal')
            )
            ? '#meter-channel-layout'
          : issue.entityType === 'channel' && (issue.code === 'CHANNEL_UNASSIGNED' || issue.field === 'channelIds')
            ? '#meter-assignments'
            : issue.entityType === 'channel' && channelOrdinal
              ? issue.field === 'customLoadTypeName'
                ? `#meter-channel-${channelOrdinal}-custom`
                : issue.field === 'capabilities'
                  ? `#meter-channel-${channelOrdinal}-capabilities`
                  : issue.field === 'sensorRating'
                    ? `#meter-channel-${channelOrdinal}-sensor`
                    : issue.field === 'purpose'
                      ? `#meter-channel-${channelOrdinal}-purpose`
                      : `#meter-channel-${channelOrdinal}`
              : issue.entityType === 'measurement_assignment' && assignmentOrdinal
                ? issue.field === 'target' || issue.field === 'meterId'
                  ? assignment?.target.kind === 'TBC'
                    ? `#meter-assignment-${assignmentOrdinal}-kind`
                    : `#meter-assignment-${assignmentOrdinal}-target`
                  : issue.field === 'channelIds'
                    ? `#meter-assignment-${assignmentOrdinal}-channels`
                    : issue.field === 'phaseMode'
                      ? `#meter-assignment-${assignmentOrdinal}-phase`
                      : issue.field === 'direction'
                        ? `#meter-assignment-${assignmentOrdinal}-direction`
                        : `#meter-assignment-${assignmentOrdinal}`
                : issue.code === 'METER_BOARD_MISMATCH'
                  ? '#meter-assignments'
                  : issue.code.includes('CHANNEL') || issue.code === 'SENSOR_RATING_INVALID' || issue.code === 'METER_CAPABILITY_REQUIRED'
                    ? '#meter-channels'
                    : '#meter-assignments';
  return `${installationHref(tree)}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}/meters/${encodeURIComponent(meter.id)}${hash}`;
}

export function readinessCorrectionAction(
  tree: InstallationTree,
  issue: ReadinessIssue,
): ReadinessCorrectionAction {
  const entity = readinessEntityDetails(tree, issue);
  const base = installationHref(tree);
  const meterHref = meterEditorHrefForIssue(tree, issue);
  if (issue.code === 'COMPLETED_FORM_IMMUTABLE' && issue.entityType === 'form') {
    return {
      href: `${entity.href}#form-completed-actions`,
      label: 'Open completed form to amend',
      instruction: 'Completed forms are immutable. Choose Create amendment, make the correction in the new draft, then choose Complete form.',
    };
  }
  if (issue.code === 'FORM_CONTRACT_INVALID' && issue.entityType === 'form') {
    const invalidFieldHash = firstInvalidFormHash(tree, issue.entityId);
    return {
      href: `${entity.href}${invalidFieldHash || '#form-completed-actions'}`,
      label: invalidFieldHash ? 'Open first invalid completed-form field' : 'Open completed form to amend',
      instruction: 'This completed form no longer satisfies the current field contract. Review the linked field, choose Create amendment, correct it in the new draft, then choose Complete form.',
    };
  }
  if (issue.code === 'EVIDENCE_NOT_CONFIRMED') {
    const href = issue.entityType === 'meter'
      ? meterHref || entity.href
      : `${entity.href}${exactEvidenceHash(tree, issue)}`;
    const persistInstruction = issue.entityType === 'form'
      ? 'If the form is completed, choose Create amendment first. Replace the exact evidence, wait for upload confirmation, then choose Complete form.'
      : issue.entityType === 'zone'
        ? 'Remove the exact stale reference, capture or upload its replacement, and wait for the confirmed upload message before leaving the zone.'
        : `Remove the exact stale reference, capture or upload its replacement, wait for upload confirmation, then choose ${issue.entityType === 'meter' ? 'Save meter' : issue.entityType === 'board' ? 'Save switchboard' : 'Save site asset'}.`;
    return {
      href,
      label: 'Open exact evidence field',
      instruction: `${issue.field ? `Evidence field: ${issue.field}. ` : ''}${persistInstruction}`,
    };
  }
  if (issue.code === 'VIRTUAL_METER_SOURCE_INCOMPLETE') {
    const assignments = measurementAssignments(tree);
    const assignmentId = issue.entityType === 'measurement_assignment'
      ? issue.entityId
      : (issue.candidateIds || []).find((id) => assignments.some((assignment) => assignment.id === id));
    const assignmentHref = assignmentId
      ? meterEditorHrefForIssue(tree, {
          ...issue,
          entityType: 'measurement_assignment',
          entityId: assignmentId,
          field: 'target',
        })
      : null;
    return {
      href: assignmentHref || `${base}/data`,
      label: 'Open boundary assignment mapper',
      instruction: 'Review the named boundary assignments, keep exactly one valid total or immediate-child assignment, remove the competing mapping, then choose Save meter.',
    };
  }
  if (issue.entityType === 'meter' && issue.field === 'formSubmission') {
    const meter = meterDevices(tree).find((item) => item.id === issue.entityId);
    const board = tree.electricalAssets.find((item) => item.id === meter?.installedOnBoardId);
    if (meter && board) return {
      href: `${base}/forms/new?zoneId=${encodeURIComponent(board.zoneId)}&boardId=${encodeURIComponent(board.id)}&meterId=${encodeURIComponent(meter.id)}&formType=ww-installation#new-form-ww-installation`,
      label: 'Start WW installation form',
      instruction: 'Create the meter-linked Installation Form (WW), capture any available details, then choose Complete form.',
    };
  }
  if (issue.entityType === 'channel' || issue.entityType === 'measurement_assignment' || issue.entityType === 'meter') {
    return {
      href: meterHref || entity.href,
      label: issue.code === 'MEASUREMENT_TARGET_TBC' ? 'Open exact target mapper' : 'Open meter and channel mapper',
      instruction: 'Correct the exact meter, channel group, purpose, phase, or target shown by this issue, then choose Save meter.',
    };
  }
  if (issue.entityType === 'site_asset') {
    const hash = issue.code.startsWith('DISPLAY_CODE')
      ? '#asset-name'
      : issue.code === 'CUSTOM_TYPE_REQUIRED'
        ? '#asset-custom-type'
        : issue.field?.endsWith('.boardId')
          ? '#asset-source-board'
          : issue.field?.endsWith('.gridSupplyId')
            ? '#asset-grid-supply'
            : issue.code.includes('SUPPLY') || issue.code === 'GRID_SUPPLY_INVALID'
              ? '#asset-supply'
          : '#asset-metering';
    return {
      href: `${entity.href}${hash}`,
      label: 'Open site-asset correction',
      instruction: 'Correct the highlighted supply, type, name, or exact metering state, then choose Save site asset.',
    };
  }
  if (issue.entityType === 'board') {
    const hash = issue.code.startsWith('DISPLAY_CODE')
      ? '#board-name'
      : issue.code === 'CUSTOM_TYPE_REQUIRED'
        ? '#board-custom-type'
        : issue.code === 'METER_PRESENT_MISMATCH'
          ? '#board-meters'
          : issue.field?.endsWith('.boardId')
            ? '#board-parent'
            : issue.field?.endsWith('.gridSupplyId')
              ? '#board-grid-supply'
              : '#board-supply';
    return {
      href: `${entity.href}${hash}`,
      label: 'Open switchboard correction',
      instruction: 'Correct the highlighted switchboard field or relationship, then choose Save switchboard.',
    };
  }
  if (issue.entityType === 'form') {
    const form = tree.formSubmissions.find((item) => item.id === issue.entityId);
    if (issue.code === 'FORM_CONTEXT_REQUIRED') {
      const hash = form?.status === 'Completed'
        ? '#form-completed-actions'
        : '#form-actions';
      return {
        href: `${entity.href}${hash}`,
        label: form?.status === 'Completed'
          ? 'Open immutable form context details'
          : 'Open form context correction',
        instruction: form?.status === 'Completed'
          ? 'The completed form context is immutable and an amendment would retain the same invalid relationship. Ask an administrator to repair this orphaned historical reference.'
          : 'This form’s linked entity is no longer valid. Delete the draft and recreate it from the correct switchboard, meter, or site asset workflow.',
      };
    }
    const incompleteFieldHash = issue.code === 'FORM_INCOMPLETE'
      ? firstInvalidFormHash(tree, issue.entityId)
      : '';
    return {
      href: `${entity.href}${incompleteFieldHash || (issue.code === 'FORM_INCOMPLETE' ? '#form-actions' : '')}`,
      label: issue.code === 'FORM_INCOMPLETE' ? 'Open form' : 'Open field-form correction',
      instruction: issue.code === 'FORM_INCOMPLETE'
        ? 'Review any available fields or evidence, then choose Complete form; or delete the draft explicitly.'
        : 'Correct or replace the linked form context and persist the form before retrying readiness.',
    };
  }
  if (issue.entityType === 'installation') {
    if (issue.code === 'EXTERNAL_KEY_REQUIRED') return {
      href: `${base}/data`,
      label: 'Open server identity details',
      instruction: 'This server-owned installation identity is not editable in the field form. Retry reconciliation, then ask an administrator to repair the external key if the issue remains.',
    };
    if (issue.code === 'GRID_SUPPLY_INVALID') return {
      href: `${base}#grid-supplies`,
      label: 'Open incoming connection correction',
      instruction: 'Add or choose the exact default incoming connection, then save it before retrying readiness.',
    };
    return {
      href: `${base}/edit${issue.code === 'TIMEZONE_REQUIRED_FOR_EXPORT' ? '#installation-timezone' : ''}`,
      label: 'Open installation correction',
      instruction: 'Correct the installation-level setting, then choose Save installation. Server-owned identity issues may require an administrator retry.',
    };
  }
  return {
    href: entity.href,
    label: 'Open issue-specific editor',
    instruction: 'Review the exact related records and use the editor’s explicit Save action; no candidate is selected automatically.',
  };
}

export function pinSelectedResult<T>(
  visible: T[],
  all: T[],
  selectedId: string | null | undefined,
  getId: (item: T) => string,
  limit = 100,
): T[] {
  const bounded = visible.slice(0, Math.max(1, limit));
  if (!selectedId || bounded.some((item) => getId(item) === selectedId)) return bounded;
  const selected = all.find((item) => getId(item) === selectedId);
  return selected ? [selected, ...bounded].slice(0, Math.max(1, limit)) : bounded;
}

export type ZoneElectricalSummary = {
  metered: number;
  unmetered: number;
  tbc: number;
  unresolvedSupply: number;
  unresolvedMetering: number;
  unresolved: number;
};

export function zoneElectricalSummary(
  tree: InstallationTree,
  zoneId: string,
): ZoneElectricalSummary {
  const boards = tree.electricalAssets.filter((item) => item.zoneId === zoneId);
  const assets = tree.siteAssets.filter((item) => item.zoneId === zoneId);
  const unresolvedSupply = boards.filter((board) => boardElectricalSource(board).kind === 'TBC').length
    + assets.filter((asset) => assetElectricalSource(asset).kind === 'TBC').length;
  const counts = assets.reduce((result, asset) => {
    const state = siteAssetMeteringState(asset).kind;
    result[state.toLocaleLowerCase() as 'metered' | 'unmetered' | 'tbc'] += 1;
    return result;
  }, { metered: 0, unmetered: 0, tbc: 0 });
  return {
    ...counts,
    unresolvedSupply,
    unresolvedMetering: counts.tbc,
    unresolved: unresolvedSupply + counts.tbc,
  };
}

export type MeteringInventorySummary = {
  assets: {
    total: number;
    directlyMetered: number;
    confirmedUnmetered: number;
    toBeConfirmed: number;
    brokenMappings: number;
  };
  meters: {
    total: number;
    withoutAssignments: number;
    allChannelsSpare: number;
    withUnassignedActiveChannels: number;
  };
  channels: {
    active: number;
    assignedActive: number;
    unassignedActive: number;
    spare: number;
  };
};

export function meteringInventorySummary(tree: InstallationTree): MeteringInventorySummary {
  const assignments = measurementAssignments(tree);
  const devices = meterDevices(tree);
  const readinessIssues = localReadiness(tree).issues;
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const assignedChannelIdsByMeter = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const device = deviceById.get(assignment.meterId);
    if (!device) continue;
    const validChannelIds = new Set(device.channels.map((channel) => channel.id));
    const assigned = assignedChannelIdsByMeter.get(device.id) ?? new Set<string>();
    assignment.channelIds.forEach((channelId) => {
      if (validChannelIds.has(channelId)) assigned.add(channelId);
    });
    assignedChannelIdsByMeter.set(device.id, assigned);
  }
  const assetCounts = tree.siteAssets.reduce((counts, asset) => {
    const coverage = coverageState(tree, asset, readinessIssues);
    if (coverage === 'DIRECT') counts.directlyMetered += 1;
    else if (coverage === 'TBC') counts.toBeConfirmed += 1;
    else if (coverage === 'INVALID') counts.brokenMappings += 1;
    else counts.confirmedUnmetered += 1;
    return counts;
  }, {
    total: tree.siteAssets.length,
    directlyMetered: 0,
    confirmedUnmetered: 0,
    toBeConfirmed: 0,
    brokenMappings: 0,
  });
  const deviceStats = devices.map((meter) => {
    const assignedChannelIds = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
    const assignedActive = activeChannels.filter((channel) => assignedChannelIds.has(channel.id)).length;
    const spare = meter.channels.filter((channel) => channel.purpose === 'SPARE').length;
    return {
      assignmentCount: assignments.filter((assignment) => assignment.meterId === meter.id).length,
      active: activeChannels.length,
      assignedActive,
      unassignedActive: activeChannels.length - assignedActive,
      spare,
      allChannelsSpare: meter.channels.length > 0 && spare === meter.channels.length,
    };
  });
  const active = deviceStats.reduce((total, meter) => total + meter.active, 0);
  const assignedActive = deviceStats.reduce((total, meter) => total + meter.assignedActive, 0);
  return {
    assets: assetCounts,
    meters: {
      total: devices.length,
      withoutAssignments: deviceStats.filter((meter) => meter.assignmentCount === 0).length,
      allChannelsSpare: deviceStats.filter((meter) => meter.allChannelsSpare).length,
      withUnassignedActiveChannels: deviceStats.filter((meter) => meter.unassignedActive > 0).length,
    },
    channels: {
      active,
      assignedActive,
      unassignedActive: active - assignedActive,
      spare: deviceStats.reduce((total, meter) => total + meter.spare, 0),
    },
  };
}

export type AssetMeterDraftSnapshot = {
  version: 1;
  installationId: string;
  zoneId: string;
  mode: 'new' | 'edit';
  assetId: string;
  meterBoardId: string;
  capturedAt: string;
  draft: SiteAsset;
};

export const ASSET_METER_DRAFT_KEY_PREFIX = 'installhub:asset-meter-draft:';

export function assetMeterDraftKey(installationId: string, assetId: string, now = Date.now()): string {
  return `${ASSET_METER_DRAFT_KEY_PREFIX}${installationId}:${assetId}:${now}`;
}

export function parseAssetMeterDraftSnapshot(
  raw: string | null,
  expected: Pick<AssetMeterDraftSnapshot, 'installationId' | 'zoneId' | 'mode'> & { assetId?: string },
): AssetMeterDraftSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AssetMeterDraftSnapshot>;
    if (
      value.version !== 1
      || value.installationId !== expected.installationId
      || value.zoneId !== expected.zoneId
      || value.mode !== expected.mode
      || (expected.assetId && value.assetId !== expected.assetId)
      || !value.assetId
      || !value.meterBoardId
      || !value.draft
      || typeof value.draft !== 'object'
      || value.draft.id !== value.assetId
      || value.draft.installationId !== expected.installationId
      || value.draft.zoneId !== expected.zoneId
    ) return null;
    return value as AssetMeterDraftSnapshot;
  } catch {
    return null;
  }
}

export type AssetMeterReturnRequest = {
  mode: 'new' | 'edit';
  zoneId: string;
  assetId: string;
  resumeDraftKey: string;
};

export type AssetMeterDraftOutcome =
  | 'RESTORED'
  | 'DEVICE_SAVE_FAILED'
  | 'ASSET_SAVE_FAILED'
  | 'ASSET_SAVE_CONFIRMED'
  | 'EXPLICIT_DISCARD';

export function shouldClearAssetMeterDraft(outcome: AssetMeterDraftOutcome): boolean {
  return outcome === 'ASSET_SAVE_CONFIRMED' || outcome === 'EXPLICIT_DISCARD';
}

export function assetMeterReturnRequest(
  params: URLSearchParams,
): AssetMeterReturnRequest | null {
  const mode = params.get('returnAssetMode');
  const zoneId = params.get('returnAssetZoneId');
  const assetId = params.get('returnAssetId');
  const resumeDraftKey = params.get('resumeDraftKey');
  if (
    (mode !== 'new' && mode !== 'edit')
    || !zoneId
    || !assetId
    || !resumeDraftKey?.startsWith(ASSET_METER_DRAFT_KEY_PREFIX)
    || resumeDraftKey.length > 500
  ) return null;
  return { mode, zoneId, assetId, resumeDraftKey };
}

export function assetMeterReturnHref(
  installationId: string,
  request: AssetMeterReturnRequest,
  createdMeterId?: string,
): string {
  const base = `/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(request.zoneId)}/assets`;
  const path = request.mode === 'new' ? `${base}/new` : `${base}/${encodeURIComponent(request.assetId)}`;
  const params = new URLSearchParams({ resumeDraftKey: request.resumeDraftKey });
  if (createdMeterId) params.set('createdMeterId', createdMeterId);
  return `${path}?${params.toString()}`;
}
