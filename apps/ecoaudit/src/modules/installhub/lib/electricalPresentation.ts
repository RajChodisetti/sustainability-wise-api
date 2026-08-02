import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeasurementTarget,
  MeasurementAssignment,
  ReadinessIssue,
  SiteAsset,
} from '@/modules/installhub/types/domain';
import {
  assetElectricalSource,
  applyAssetElectricalSource,
  applyBoardElectricalSource,
  assignmentForAsset,
  boardSupplyPath,
  boardElectricalSource,
  boardTypeLabel,
  displayCodeValue,
  measurementAssignments,
  meterDeviceName,
  meterDevices,
  meterBoardsForAsset,
  reachableGridSuppliesForBoard,
  replaceMeterAssignments,
  setAssetMetering,
  siteAssetMeteringState,
  siteAssetTypeLabel,
  validBoardParents,
} from './workflow';

export type ElectricalNode = ElectricalTreeReadModel['nodes'][number];
export type ElectricalEdge = ElectricalTreeReadModel['edges'][number];

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

export const READINESS_RESOLUTION_VISIBLE_LIMIT = 100;

export function filterReadinessResolutionCandidates(
  candidates: ReadinessResolutionCandidate[],
  query: string,
  selectedId = '',
  limit = READINESS_RESOLUTION_VISIBLE_LIMIT,
): ReadinessResolutionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase('en-AU');
  const matches = candidates.filter((candidate) => (
    !normalized
    || `${candidate.code || ''} ${candidate.name} ${candidate.type} ${candidate.zoneName || ''} ${candidate.id}`
      .toLocaleLowerCase('en-AU')
      .includes(normalized)
  ));
  const visible = matches.slice(0, Math.max(1, limit));
  const selected = selectedId
    ? candidates.find((candidate) => candidate.id === selectedId)
    : undefined;
  if (selected && !visible.some((candidate) => candidate.id === selected.id)) {
    return [selected, ...visible].slice(0, Math.max(1, limit));
  }
  return visible;
}

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
  const eligibleAssets = tree.siteAssets.filter((asset) => (
    meterBoardsForAsset(tree, asset).some((board) => board.id === meter.installedOnBoardId)
    && !measurementAssignments(tree).some((candidate) => (
      candidate.id !== assignment.id
      && candidate.target.kind === 'SITE_ASSET'
      && candidate.target.siteAssetId === asset.id
    ))
  ));
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

function meterEditorHrefForIssue(
  tree: InstallationTree,
  issue: ReadinessIssue,
): string | null {
  const assignments = measurementAssignments(tree);
  const devices = meterDevices(tree);
  const meterId = issue.entityType === 'meter'
    ? issue.entityId
    : issue.entityType === 'channel'
      ? devices.find((meter) => meter.channels.some((channel) => channel.id === issue.entityId))?.id
      : issue.entityType === 'measurement_assignment'
        ? assignments.find((assignment) => assignment.id === issue.entityId)?.meterId
        : null;
  if (!meterId) return null;
  const meter = devices.find((item) => item.id === meterId);
  const board = tree.electricalAssets.find((item) => item.id === meter?.installedOnBoardId);
  if (!meter || !board) return null;
  const assignmentEditorIssue = issue.entityType === 'measurement_assignment'
    || issue.code === 'CHANNEL_UNASSIGNED'
    || issue.code === 'METER_BOARD_MISMATCH';
  const hash = issue.field === 'formSubmission'
    ? ''
    : issue.code === 'EVIDENCE_NOT_CONFIRMED'
      ? '#meter-evidence'
    : issue.code === 'DISPLAY_CODE_INVALID' || issue.code === 'DISPLAY_CODE_DUPLICATE'
      ? '#meter-name'
      : issue.code === 'METER_DEVICE_REQUIRED' && issue.field !== 'formSubmission'
        ? '#meter-serial'
        : issue.code === 'CUSTOM_TYPE_REQUIRED'
          ? '#meter-custom-manufacturer'
          : assignmentEditorIssue
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
      href: entity.href,
      label: 'Open completed form to amend',
      instruction: 'Completed forms are immutable. Choose Create amendment, make the correction in the new draft, then choose Complete form.',
    };
  }
  if (issue.code === 'EVIDENCE_NOT_CONFIRMED') {
    const href = issue.entityType === 'meter'
      ? meterHref || entity.href
      : issue.entityType === 'board'
        ? `${entity.href}#board-evidence`
        : issue.entityType === 'site_asset'
          ? `${entity.href}#asset-evidence`
          : issue.entityType === 'zone'
            ? `${entity.href}#zone-evidence`
            : entity.href;
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
      href: `${base}/forms/new?zoneId=${encodeURIComponent(board.zoneId)}&boardId=${encodeURIComponent(board.id)}&meterId=${encodeURIComponent(meter.id)}`,
      label: 'Start required WW form',
      instruction: 'Create the meter-linked Installation Form (WW), complete its required evidence, then choose Complete form.',
    };
  }
  if (issue.entityType === 'channel' || issue.entityType === 'measurement_assignment' || (
    issue.entityType === 'meter'
    && !['DISPLAY_CODE_INVALID', 'DISPLAY_CODE_DUPLICATE', 'CUSTOM_TYPE_REQUIRED'].includes(issue.code)
  )) {
    return {
      href: meterHref || entity.href,
      label: issue.code === 'MEASUREMENT_TARGET_TBC' ? 'Open exact target mapper' : 'Open meter and channel mapper',
      instruction: 'Correct the exact meter, channel group, purpose, phase, or target shown by this issue, then choose Save meter.',
    };
  }
  if (issue.entityType === 'site_asset') {
    const hash = issue.code.startsWith('DISPLAY_CODE')
      ? '#asset-code'
      : issue.code === 'CUSTOM_TYPE_REQUIRED'
        ? '#asset-custom-type'
        : issue.code.includes('SUPPLY') || issue.code === 'GRID_SUPPLY_INVALID'
          ? '#asset-supply'
          : '#asset-metering';
    return {
      href: `${entity.href}${hash}`,
      label: 'Open site-asset correction',
      instruction: 'Correct the highlighted supply, type, display code, or exact metering state, then choose Save site asset.',
    };
  }
  if (issue.entityType === 'board') {
    const hash = issue.code.startsWith('DISPLAY_CODE')
      ? '#board-code'
      : issue.code === 'CUSTOM_TYPE_REQUIRED'
        ? '#board-custom-type'
        : issue.code === 'METER_PRESENT_MISMATCH'
          ? '#board-meter-presence'
          : '#board-supply';
    return {
      href: `${entity.href}${hash}`,
      label: 'Open switchboard correction',
      instruction: 'Correct the highlighted switchboard field or relationship, then choose Save switchboard.',
    };
  }
  if (issue.entityType === 'form') {
    return {
      href: issue.code === 'FORM_CONTEXT_REQUIRED' ? `${base}/forms` : entity.href,
      label: issue.code === 'FORM_INCOMPLETE' ? 'Open form to complete' : 'Open field-form correction',
      instruction: issue.code === 'FORM_INCOMPLETE'
        ? 'Complete every required field and evidence item, then choose Complete form; or delete the draft explicitly.'
        : 'Correct or replace the linked form context and persist the form before retrying readiness.',
    };
  }
  if (issue.entityType === 'installation') {
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
