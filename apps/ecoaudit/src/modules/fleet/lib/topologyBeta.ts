import type {
  TopologyBetaDocument,
  TopologyBetaEdge,
  TopologyBetaNode,
  TopologyBetaSite,
  FleetBusinessSiteSearchItem,
} from '@/modules/fleet/types/domain';

export type TopologyTreeItem = {
  node: TopologyBetaNode;
  incomingEdge: TopologyBetaEdge | null;
  children: TopologyTreeItem[];
};

export type TopologyPresentation = {
  forest: TopologyTreeItem[];
  unplacedNodes: TopologyBetaNode[];
  displayedEdges: TopologyBetaEdge[];
  suppressedEdgeCount: number;
};

export type TopologyNodeRoleDisplay = {
  label: 'Role' | 'Suggested role';
  value: string;
};

type ValidatedTelemetryEvidence = {
  intervalSeconds: number;
  evidenceDays: number;
  maximumSampleCount: number;
  bootstrapWindowSize: number;
  stableForGreen: boolean;
};

export function parseTopologyDeviceIds(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,;]+/u)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
}

export function topologySiteLabel(site: TopologyBetaSite): string {
  return `${site.name} — ${site.clientCode} · ${site.meterCount} meter${site.meterCount === 1 ? '' : 's'}`;
}

export function businessSiteSearchLabel(site: FleetBusinessSiteSearchItem): string {
  return `${site.name} — ${site.clientName}`;
}

export function businessSiteMatchesQuery(
  site: FleetBusinessSiteSearchItem,
  query: string,
): boolean {
  const partial = query.trim().toLocaleLowerCase();
  if (!partial) return true;
  return [
    site.name,
    site.clientName,
    site.address,
    site.locality,
    site.state,
    site.postcode,
  ].some((value) => value?.toLocaleLowerCase().includes(partial));
}

export function isReviewedTopologyEdge(edge: TopologyBetaEdge): boolean {
  return edge.provenance === 'REVIEWED_SITE_EVIDENCE';
}

export function topologyNodeRoleDisplay(node: TopologyBetaNode): TopologyNodeRoleDisplay | null {
  const heuristic = node.roleSource === 'LABEL_HEURISTIC_REVIEW_REQUIRED';
  const value = heuristic ? node.suggestedRole || node.role : node.role;
  return value ? { label: heuristic ? 'Suggested role' : 'Role', value } : null;
}

export function topologyDecisionLabel(decision: string): string {
  const normalized = decision.trim().toUpperCase().split('.').at(-1) ?? '';
  const labels: Record<string, string> = {
    COLLECT_MORE: 'Collecting relationship evidence',
    WAITING_TELEMETRY: 'Waiting for relationship evidence',
    STABLE_CANDIDATE: 'Stable candidate',
    CONVERGED: 'Converged',
    REVIEW_REQUIRED: 'Review required',
  };
  if (labels[normalized]) return labels[normalized];
  if (!normalized) return 'Status unavailable';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0)}${word.slice(1).toLocaleLowerCase()}`)
    .join(' ');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function nodeLacksTelemetryEvidence(
  node: TopologyBetaNode,
  maximumSampleCount: number,
): boolean {
  const sampleCount = node.sampleCount;
  const validSampleCount = node.validSampleCount;
  const validFraction = node.validFraction;
  const expectedValidFraction = isNonNegativeInteger(sampleCount) && sampleCount > 0
    && isNonNegativeInteger(validSampleCount)
    ? validSampleCount / sampleCount
    : 0;
  return node.state === 'WAITING'
    || node.telemetryStatus?.trim().toUpperCase() !== 'ONLINE'
    || node.telemetryEvidenceValid !== true
    || !isNonNegativeInteger(sampleCount)
    || sampleCount > maximumSampleCount
    || !isNonNegativeInteger(validSampleCount)
    || validSampleCount <= 0
    || validSampleCount > sampleCount
    || !isUnitInterval(validFraction)
    || !nearlyEqual(validFraction, expectedValidFraction);
}

function validatedTelemetryEvidence(
  document: TopologyBetaDocument,
  minimumOverlap: number,
): ValidatedTelemetryEvidence | null {
  const evidence = document.evidence;
  const sourceWindow = evidence?.sourceWindow;
  const bootstrap = evidence?.bootstrap;
  const assessmentReasons = evidence?.assessmentReasons;
  const blockReasons = evidence?.telemetryCandidateBlockReasons;
  if (!evidence
    || !sourceWindow
    || !bootstrap
    || !Array.isArray(assessmentReasons)
    || assessmentReasons.some((reason) => typeof reason !== 'string' || !reason.trim())
    || assessmentReasons.some((reason) => [
      'INVALID_EVIDENCE_DIAGNOSTICS',
      'BEST_HYPOTHESIS_INCOMPLETE_ROOTED_TREE',
      'BOOTSTRAP_EVIDENCE_INCOMPLETE',
      'WAITING_FOR_OFFLINE_METERS',
    ].includes(reason.trim().toUpperCase()))
    || !Array.isArray(blockReasons)
    || blockReasons.some((reason) => typeof reason !== 'string' || !reason.trim())
    || blockReasons.length > 0
    || document.reconstruction?.job?.lastErrorCode
    || (document.reconstruction?.job?.consecutiveFailures ?? 0) > 0
  ) return null;

  const { fromTs, toTs, intervalSeconds } = sourceWindow;
  if (!isNonNegativeInteger(fromTs)
    || !isNonNegativeInteger(toTs)
    || !isNonNegativeInteger(intervalSeconds)
    || intervalSeconds <= 0
    || fromTs >= toTs
  ) return null;
  const maximumSampleCount = Math.floor((toTs - 1) / intervalSeconds)
    - Math.floor(fromTs / intervalSeconds)
    + 1;
  const evidenceDays = (toTs - fromTs) / 86_400;
  if (evidence.sourceWindowMaximumSampleCount != null
    && (!isNonNegativeInteger(evidence.sourceWindowMaximumSampleCount)
      || evidence.sourceWindowMaximumSampleCount !== maximumSampleCount)
  ) return null;
  if (evidence.sourceWindowEvidenceDays != null
    && (typeof evidence.sourceWindowEvidenceDays !== 'number'
      || !Number.isFinite(evidence.sourceWindowEvidenceDays)
      || !nearlyEqual(evidence.sourceWindowEvidenceDays, evidenceDays))
  ) return null;

  const requested = bootstrap.requestedReplicates;
  const successful = bootstrap.successfulReplicates;
  const failed = bootstrap.failedReplicates;
  const observationCount = bootstrap.observationCount;
  const windowSize = bootstrap.windowSize;
  if (!isNonNegativeInteger(requested)
    || requested <= 0
    || !isNonNegativeInteger(successful)
    || !isNonNegativeInteger(failed)
    || successful + failed !== requested
    || !isNonNegativeInteger(observationCount)
    || observationCount <= 0
    || observationCount > maximumSampleCount
    || !isNonNegativeInteger(windowSize)
    || windowSize < minimumOverlap
    || windowSize > observationCount
  ) return null;
  const successFraction = successful / requested;
  if (!isUnitInterval(bootstrap.successFraction)
    || !nearlyEqual(bootstrap.successFraction, successFraction)
  ) return null;
  const configuredSuccessFloor = document.thresholds.minimumBootstrapSuccessFraction;
  if (configuredSuccessFloor != null && !isUnitInterval(configuredSuccessFloor)) return null;
  if (successFraction < Math.max(0.8, configuredSuccessFloor ?? 0)) return null;

  const consecutiveStableRuns = evidence.consecutiveStableRuns;
  const stableRunsRequired = evidence.stableRunsRequired;
  const stabilityEvidenceToTs = evidence.stabilityEvidenceToTs;
  const configuredStableRunsRequired = document.thresholds.stableRunsRequired;
  const stableMetadataValid = evidence.stabilityMetadataValid === true
    && isNonNegativeInteger(consecutiveStableRuns)
    && isNonNegativeInteger(stableRunsRequired)
    && stableRunsRequired >= 3
    && isNonNegativeInteger(stabilityEvidenceToTs)
    && stabilityEvidenceToTs >= fromTs
    && stabilityEvidenceToTs <= toTs
    && (configuredStableRunsRequired == null
      || (isNonNegativeInteger(configuredStableRunsRequired)
        && configuredStableRunsRequired === stableRunsRequired));
  const normalizedDecision = typeof document.decision === 'string'
    ? document.decision.trim().toUpperCase().split('.').at(-1)
    : '';
  const stableForGreen = stableMetadataValid
    && consecutiveStableRuns >= stableRunsRequired
    && (normalizedDecision === 'STABLE_CANDIDATE' || normalizedDecision === 'CONVERGED');

  return {
    intervalSeconds,
    evidenceDays,
    maximumSampleCount,
    bootstrapWindowSize: windowSize,
    stableForGreen,
  };
}

function edgeHasImpossibleOverlap(
  edge: TopologyBetaEdge,
  parent: TopologyBetaNode,
  child: TopologyBetaNode,
): boolean {
  return typeof edge.overlapSampleCount !== 'number'
    || !Number.isFinite(edge.overlapSampleCount)
    || !Number.isInteger(edge.overlapSampleCount)
    || edge.overlapSampleCount < 0
    || ((typeof parent.validSampleCount === 'number'
      && Number.isFinite(parent.validSampleCount)
      && edge.overlapSampleCount > parent.validSampleCount)
      || (typeof child.validSampleCount === 'number'
        && Number.isFinite(child.validSampleCount)
        && edge.overlapSampleCount > child.validSampleCount));
}

function hasCompleteRootedHypothesis(
  nodes: TopologyBetaNode[],
  edges: TopologyBetaEdge[],
  expectedRootMeterId?: string | null,
): boolean {
  const nodeIds = nodes.map((node) => node.meterId);
  const known = new Set(nodeIds);
  if (known.size !== nodeIds.length || known.size === 0 || edges.length !== known.size - 1) {
    return false;
  }

  const incoming = new Map<string, number>();
  const children = new Map<string, string[]>();
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.parent}\u0000${edge.child}`;
    if (!known.has(edge.parent)
      || !known.has(edge.child)
      || edge.parent === edge.child
      || seenEdges.has(key)
    ) return false;
    seenEdges.add(key);
    incoming.set(edge.child, (incoming.get(edge.child) ?? 0) + 1);
    if ((incoming.get(edge.child) ?? 0) !== 1) return false;
    children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
  }

  const roots = nodeIds.filter((meterId) => !incoming.has(meterId));
  if (roots.length !== 1 || (expectedRootMeterId && roots[0] !== expectedRootMeterId)) return false;
  const visited = new Set<string>();
  const pending = [roots[0]!];
  while (pending.length > 0) {
    const meterId = pending.pop()!;
    if (visited.has(meterId)) return false;
    visited.add(meterId);
    pending.push(...(children.get(meterId) ?? []));
  }
  return visited.size === known.size;
}

function hasSafeReviewedForest(nodes: TopologyBetaNode[], edges: TopologyBetaEdge[]): boolean {
  const nodeIds = nodes.map((node) => node.meterId);
  const known = new Set(nodeIds);
  if (known.size !== nodeIds.length) return false;
  const parentByChild = new Map<string, string>();
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.parent}\u0000${edge.child}`;
    if (!known.has(edge.parent)
      || !known.has(edge.child)
      || edge.parent === edge.child
      || seenEdges.has(key)
      || parentByChild.has(edge.child)
    ) return false;
    seenEdges.add(key);
    parentByChild.set(edge.child, edge.parent);
  }
  for (const meterId of nodeIds) {
    const visited = new Set<string>();
    let cursor: string | undefined = meterId;
    while (cursor !== undefined) {
      if (visited.has(cursor)) return false;
      visited.add(cursor);
      cursor = parentByChild.get(cursor);
    }
  }
  return true;
}

function finiteProbabilityMeetsFloor(value: number | null | undefined, floor: number): boolean {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
    && Number.isFinite(floor)
    && floor >= 0
    && floor <= 1
    && value >= floor;
}

function finiteProbabilityMeetsConfiguredFloor(
  value: number | null | undefined,
  configuredFloor: number | null | undefined,
  absoluteFloor: number,
): boolean {
  if (configuredFloor == null) return finiteProbabilityMeetsFloor(value, absoluteFloor);
  if (typeof configuredFloor !== 'number' || !Number.isFinite(configuredFloor)) return false;
  return finiteProbabilityMeetsFloor(value, Math.max(absoluteFloor, configuredFloor));
}

function finiteMeasurementMeetsFloor(
  value: number | null | undefined,
  configuredFloor: number | null | undefined,
  absoluteFloor: number,
): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (!Number.isInteger(value) || value < 0) return false;
  if (configuredFloor == null) return value >= absoluteFloor;
  if (typeof configuredFloor !== 'number' || !Number.isFinite(configuredFloor)) return false;
  return value >= Math.max(absoluteFloor, configuredFloor);
}

function normalizeTelemetryEdgeState(
  edge: TopologyBetaEdge,
  parent: TopologyBetaNode,
  child: TopologyBetaNode,
  document: TopologyBetaDocument,
  evidence: ValidatedTelemetryEvidence,
): TopologyBetaEdge {
  if (edge.state !== 'CONFIDENT') return edge;
  const configuredValidFraction = document.thresholds.minimumHighValidFraction;
  const highValidFraction = configuredValidFraction == null
    ? 0.65
    : isUnitInterval(configuredValidFraction)
      ? Math.max(0.65, configuredValidFraction)
      : Number.POSITIVE_INFINITY;
  const configuredEvidenceDays = document.thresholds.minimumEvidenceDays;
  const highEvidenceDays = configuredEvidenceDays == null
    ? 7
    : typeof configuredEvidenceDays === 'number'
      && Number.isFinite(configuredEvidenceDays)
      && configuredEvidenceDays > 0
      ? Math.max(7, configuredEvidenceDays)
      : Number.POSITIVE_INFINITY;
  const derivedValidSampleCount = Math.ceil(
    highEvidenceDays * 86_400 / evidence.intervalSeconds * highValidFraction,
  );
  const configuredValidSampleCount = document.thresholds.minimumHighValidSampleCount;
  const highValidSampleCount = configuredValidSampleCount == null
    ? derivedValidSampleCount
    : isNonNegativeInteger(configuredValidSampleCount) && configuredValidSampleCount > 0
      ? Math.max(derivedValidSampleCount, configuredValidSampleCount)
      : Number.POSITIVE_INFINITY;
  const configuredHighOverlap = document.thresholds.minimumHighOverlapSamples;
  const highOverlap = configuredHighOverlap == null
    ? 576
    : isNonNegativeInteger(configuredHighOverlap)
      ? Math.max(576, configuredHighOverlap)
      : Number.POSITIVE_INFINITY;
  const stronglySupported = evidence.stableForGreen && finiteProbabilityMeetsFloor(
    edge.topKInclusionWeight,
    Math.max(0.9, document.thresholds.minimumTopKInclusion),
  ) && finiteProbabilityMeetsFloor(
    edge.bootstrapStability,
    Math.max(0.9, document.thresholds.minimumBootstrapStability),
  ) && finiteMeasurementMeetsFloor(
    edge.overlapSampleCount,
    configuredHighOverlap,
    576,
  )
    && evidence.bootstrapWindowSize >= highOverlap
    && evidence.evidenceDays >= highEvidenceDays
    && [parent, child].every((node) => (
      finiteProbabilityMeetsConfiguredFloor(
        node.validFraction,
        configuredValidFraction,
        0.65,
      )
      && finiteMeasurementMeetsFloor(
        node.validSampleCount,
        configuredValidSampleCount,
        highValidSampleCount,
      )
    ));
  return stronglySupported
    ? edge
    : {
        ...edge,
        state: 'REVIEW',
        confidenceLabel: 'Possible relation — needs review or more telemetry',
      };
}

function buildForest(
  nodes: TopologyBetaNode[],
  edges: TopologyBetaEdge[],
  rootMeterId?: string | null,
): TopologyTreeItem[] {
  const nodeById = new Map(nodes.map((node) => [node.meterId, node]));
  const childrenByParent = new Map<string, TopologyBetaEdge[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    const children = childrenByParent.get(edge.parent) ?? [];
    children.push(edge);
    childrenByParent.set(edge.parent, children);
    incoming.add(edge.child);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.child.localeCompare(right.child));
  }

  const rootIds = [
    ...(rootMeterId && nodeById.has(rootMeterId) ? [rootMeterId] : []),
    ...nodes
      .map((node) => node.meterId)
      .filter((meterId) => meterId !== rootMeterId && !incoming.has(meterId))
      .sort((left, right) => left.localeCompare(right)),
  ];
  const visited = new Set<string>();

  function visit(
    meterId: string,
    incomingEdge: TopologyBetaEdge | null,
    ancestors: Set<string>,
  ): TopologyTreeItem | null {
    const node = nodeById.get(meterId);
    if (!node || visited.has(meterId) || ancestors.has(meterId)) return null;
    visited.add(meterId);
    const nextAncestors = new Set(ancestors).add(meterId);
    const children = (childrenByParent.get(meterId) ?? [])
      .map((edge) => visit(edge.child, edge, nextAncestors))
      .filter((item): item is TopologyTreeItem => item !== null);
    return { node, incomingEdge, children };
  }

  const forest = rootIds
    .map((meterId) => visit(meterId, null, new Set()))
    .filter((item): item is TopologyTreeItem => item !== null);
  for (const node of [...nodes].sort((left, right) => left.meterId.localeCompare(right.meterId))) {
    const item = visit(node.meterId, null, new Set());
    if (item) forest.push(item);
  }
  return forest;
}

export function buildTopologyPresentation(document: TopologyBetaDocument): TopologyPresentation {
  const nodeById = new Map(document.nodes.map((node) => [node.meterId, node]));
  const unresolved = new Set(document.unresolvedMeterIds);
  const normalizedDecision = typeof document.decision === 'string'
    ? document.decision.trim().toUpperCase().split('.').at(-1)
    : '';
  const waitingForTelemetry = normalizedDecision === 'WAITING_TELEMETRY'
    || document.nodes.some((node) => node.telemetryStatus?.trim().toUpperCase() !== 'ONLINE');
  const configuredMinimumOverlap = document.thresholds.minimumLowOverlapSamples;
  const minimumOverlap = isNonNegativeInteger(configuredMinimumOverlap)
    ? Math.max(288, configuredMinimumOverlap)
    : Number.POSITIVE_INFINITY;
  const telemetryEvidence = validatedTelemetryEvidence(document, minimumOverlap);
  const reviewedEdges = document.edges.filter(isReviewedTopologyEdge);
  const reviewedStructureValid = hasSafeReviewedForest(document.nodes, reviewedEdges);
  const telemetryStructureValid = unresolved.size === 0
    && document.unknownRequestedMeters.length === 0
    && hasCompleteRootedHypothesis(
      document.nodes,
      document.edges,
      document.location.rootMeterId,
    );
  const displayedEdges = document.edges.flatMap((edge) => {
    const parent = nodeById.get(edge.parent);
    const child = nodeById.get(edge.child);
    if (!parent || !child) return [];
    // Reviewed site evidence has its own explicit provenance and is not a
    // telemetry-confidence claim, so telemetry diagnostics do not veto it.
    if (isReviewedTopologyEdge(edge)) return reviewedStructureValid ? [edge] : [];
    if (!telemetryEvidence || !telemetryStructureValid) return [];
    if (edgeHasImpossibleOverlap(edge, parent, child)) return [];
    if (waitingForTelemetry || unresolved.has(edge.parent) || unresolved.has(edge.child)) return [];
    if (nodeLacksTelemetryEvidence(parent, telemetryEvidence.maximumSampleCount)
      || nodeLacksTelemetryEvidence(child, telemetryEvidence.maximumSampleCount)
    ) return [];
    const meetsDisplayFloor = typeof edge.overlapSampleCount === 'number'
      && Number.isFinite(edge.overlapSampleCount)
      && Number.isInteger(edge.overlapSampleCount)
      && edge.overlapSampleCount >= minimumOverlap
      && finiteProbabilityMeetsFloor(
        edge.topKInclusionWeight,
        document.thresholds.minimumLowTopKInclusion,
      )
      && finiteProbabilityMeetsFloor(
        edge.bootstrapStability,
        document.thresholds.minimumLowBootstrapStability,
    );
    return meetsDisplayFloor
      ? [normalizeTelemetryEdgeState(edge, parent, child, document, telemetryEvidence)]
      : [];
  });

  const relationshipNodeIds = new Set<string>();
  for (const edge of displayedEdges) {
    relationshipNodeIds.add(edge.parent);
    relationshipNodeIds.add(edge.child);
  }
  const relationshipNodes = document.nodes.filter((node) => relationshipNodeIds.has(node.meterId));
  const unplacedNodes = document.nodes
    .filter((node) => !relationshipNodeIds.has(node.meterId))
    .sort((left, right) => left.meterId.localeCompare(right.meterId));

  return {
    forest: buildForest(relationshipNodes, displayedEdges, document.location.rootMeterId),
    unplacedNodes,
    displayedEdges,
    suppressedEdgeCount: document.edges.length - displayedEdges.length,
  };
}

export function buildTopologyForest(document: TopologyBetaDocument): TopologyTreeItem[] {
  return buildTopologyPresentation(document).forest;
}
