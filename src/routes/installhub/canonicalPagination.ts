import type {
  CanonicalInstallationTree,
  InstallationReadiness,
  ReadinessIssue,
} from './canonical.js';

export type ReadinessIssuePage = {
  issues: ReadinessIssue[];
  page: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
};

export function readinessEntityIdsForZone(
  tree: CanonicalInstallationTree,
  zoneId: string,
): ReadonlySet<string> {
  const boardIds = new Set(
    tree.electricalAssets.filter((board) => board.zoneId === zoneId).map((board) => board.id),
  );
  const assetIds = new Set(
    tree.siteAssets.filter((asset) => asset.zoneId === zoneId).map((asset) => asset.id),
  );
  const meterIds = new Set(
    tree.meterDevices
      .filter((meter) => boardIds.has(meter.installedOnBoardId))
      .map((meter) => meter.id),
  );
  const channelIds = new Set(
    tree.meterDevices
      .filter((meter) => meterIds.has(meter.id))
      .flatMap((meter) => meter.channels.map((channel) => channel.id)),
  );
  const assignmentIds = new Set(
    tree.measurementAssignments
      .filter((assignment) => (
        meterIds.has(assignment.meterId)
        || (assignment.target.kind === 'BOARD' && boardIds.has(assignment.target.boardId))
        || (assignment.target.kind === 'SITE_ASSET' && assetIds.has(assignment.target.siteAssetId))
      ))
      .map((assignment) => assignment.id),
  );
  const formIds = tree.formSubmissions
    .filter((form) => (
      form.zoneId === zoneId
      || (form.boardId !== null && form.boardId !== undefined && boardIds.has(form.boardId))
      || (form.siteAssetId !== null && form.siteAssetId !== undefined && assetIds.has(form.siteAssetId))
      || (form.meterId !== null && form.meterId !== undefined && meterIds.has(form.meterId))
    ))
    .map((form) => form.id);
  const virtualMeterIds = tree.serverDerived.virtualMeterDefinitions
    .filter((virtualMeter) => (
      boardIds.has(virtualMeter.parentNodeId)
      || assetIds.has(virtualMeter.parentNodeId)
      || assignmentIds.has(virtualMeter.totalMeasurementAssignmentId)
      || virtualMeter.subtractAssignmentIds.some((id) => assignmentIds.has(id))
    ))
    .map((virtualMeter) => virtualMeter.id);
  return new Set([
    zoneId,
    ...boardIds,
    ...assetIds,
    ...meterIds,
    ...channelIds,
    ...assignmentIds,
    ...formIds,
    ...virtualMeterIds,
  ]);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

export function paginateReadiness(
  readiness: InstallationReadiness,
  input: {
    offset?: unknown;
    limit?: unknown;
    q?: unknown;
    severity?: unknown;
    entityType?: unknown;
    entityIds?: ReadonlySet<string>;
  } = {},
): InstallationReadiness & { issuePage: ReadinessIssuePage['page'] } {
  const offset = boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedInteger(input.limit, 100, 1, 250);
  const query = typeof input.q === 'string' ? input.q.trim().toLocaleLowerCase() : '';
  const severity = input.severity === 'ERROR' || input.severity === 'WARNING'
    ? input.severity
    : null;
  const entityType = typeof input.entityType === 'string' && input.entityType.trim()
    ? input.entityType.trim()
    : null;
  const filtered = readiness.issues
    .filter((issue) => !severity || issue.severity === severity)
    .filter((issue) => !entityType || issue.entityType === entityType)
    .filter((issue) => !input.entityIds || input.entityIds.has(issue.entityId))
    .filter((issue) => !query || [
        issue.code,
        issue.message,
        issue.entityType,
        issue.entityId,
        issue.field ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query)));
  const issues = filtered.slice(offset, offset + limit);
  const nextOffset = offset + issues.length < filtered.length
    ? offset + issues.length
    : null;
  return {
    ...readiness,
    issues,
    issuePage: {
      offset,
      limit,
      total: filtered.length,
      nextOffset,
    },
  };
}

export type CanonicalCandidateKind = 'board' | 'site_asset' | 'meter' | 'channel';

export function searchCanonicalCandidates(input: {
  tree: CanonicalInstallationTree;
  kind: CanonicalCandidateKind;
  query?: string;
  cursor?: string;
  limit?: number;
}) {
  const query = input.query?.trim().toLocaleLowerCase('en-AU') ?? '';
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const values = input.kind === 'board'
    ? input.tree.electricalAssets.map((item) => ({
        id: item.id,
        kind: 'board' as const,
        name: item.assetName,
        displayCode: item.displayCode.value,
      }))
    : input.kind === 'site_asset'
      ? input.tree.siteAssets.map((item) => ({
          id: item.id,
          kind: 'site_asset' as const,
          name: item.assetName,
          displayCode: item.displayCode.value,
        }))
      : input.kind === 'meter'
        ? input.tree.meterDevices.map((item) => ({
            id: item.id,
            kind: 'meter' as const,
            name: item.displayName.value,
            displayCode: item.displayName.value,
          }))
        : input.tree.meterDevices.flatMap((meter) => meter.channels.map((channel) => ({
            id: channel.id,
            kind: 'channel' as const,
            name: `${meter.displayName.value} channel ${channel.ordinal}`,
            displayCode: meter.displayName.value,
            meterId: meter.id,
            ordinal: channel.ordinal,
            purpose: channel.purpose,
          })));
  const filtered = values
    .filter((candidate) => !input.cursor || candidate.id > input.cursor)
    .filter((candidate) => !query || (
      candidate.id.toLocaleLowerCase('en-AU').includes(query)
      || candidate.name.toLocaleLowerCase('en-AU').includes(query)
      || candidate.displayCode.toLocaleLowerCase('en-AU').includes(query)
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const items = filtered.slice(0, limit);
  return {
    items,
    page: {
      limit,
      nextCursor: filtered.length > items.length ? items.at(-1)?.id ?? null : null,
    },
  };
}
