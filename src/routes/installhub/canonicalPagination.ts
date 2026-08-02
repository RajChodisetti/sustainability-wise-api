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

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

export function paginateReadiness(
  readiness: InstallationReadiness,
  input: { offset?: unknown; limit?: unknown; q?: unknown } = {},
): InstallationReadiness & { issuePage: ReadinessIssuePage['page'] } {
  const offset = boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = boundedInteger(input.limit, 100, 1, 250);
  const query = typeof input.q === 'string' ? input.q.trim().toLocaleLowerCase() : '';
  const filtered = query
    ? readiness.issues.filter((issue) => [
        issue.code,
        issue.message,
        issue.entityType,
        issue.entityId,
        issue.field ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query)))
    : readiness.issues;
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
