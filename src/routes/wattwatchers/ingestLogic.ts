export function uniqueMemberships<T>(entries: T[], codeFor: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const code = codeFor(entry);
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

export function collectionCanPublish(clientStatuses: string[], configuredClientCount: number): boolean {
  return configuredClientCount > 0
    && clientStatuses.length === configuredClientCount
    && clientStatuses.every((status) => status === 'success');
}

export type InventoryScope = 'full' | 'partial';

export type ClientCoverage = {
  status: string;
  requestedDeviceCount: number;
  fetchedDeviceCount: number;
  attributedDeviceCount: number;
  observedFetchedDeviceCount: number;
  observedNonOkDeviceCount: number;
};

/**
 * A collector's success flag is not sufficient proof that every uploaded
 * batch arrived. Compare its accounting with the immutable attribution rows
 * before a run is allowed to replace the published inventory.
 */
export function clientCoverageIssue(coverage: ClientCoverage): string | null {
  if (coverage.status !== 'success') return null;
  if (coverage.attributedDeviceCount !== coverage.requestedDeviceCount) {
    return `Coverage mismatch: requested=${coverage.requestedDeviceCount}, attributed=${coverage.attributedDeviceCount}`;
  }
  if (coverage.fetchedDeviceCount !== coverage.requestedDeviceCount) {
    return `Fetch accounting mismatch: requested=${coverage.requestedDeviceCount}, reportedFetched=${coverage.fetchedDeviceCount}`;
  }
  if (coverage.observedFetchedDeviceCount !== coverage.fetchedDeviceCount) {
    return `Fetch accounting mismatch: reportedFetched=${coverage.fetchedDeviceCount}, observedFetched=${coverage.observedFetchedDeviceCount}`;
  }
  if (
    coverage.observedFetchedDeviceCount + coverage.observedNonOkDeviceCount
    !== coverage.attributedDeviceCount
  ) {
    return `Observation accounting mismatch: attributed=${coverage.attributedDeviceCount}, observedFetched=${coverage.observedFetchedDeviceCount}, observedNonOk=${coverage.observedNonOkDeviceCount}`;
  }
  if (coverage.observedNonOkDeviceCount !== 0) {
    return `Successful client contains ${coverage.observedNonOkDeviceCount} non-ok observation(s)`;
  }
  return null;
}

/** Only a complete, published full-fleet inventory can retire removed clients. */
export function absentClientIdsForPublishedInventory(input: {
  activeClientIds: string[];
  configuredClientIds: string[];
  publish: boolean;
  inventoryScope: InventoryScope;
}): string[] {
  if (!input.publish || input.inventoryScope !== 'full') return [];
  const configured = new Set(input.configuredClientIds);
  return input.activeClientIds.filter((id) => !configured.has(id));
}

export type EmailDelta = {
  offlineDeviceIds: string[];
  newlyOfflineDeviceIds: string[];
  recoveredDeviceIds: string[];
  previousOfflineDeviceIds: string[];
  stateOfflineDeviceIds: string[];
  offlineCount: number;
  newlyOfflineCount: number;
  recoveredCount: number;
  previousOfflineCount: number;
  stateOfflineCount: number;
  collectionComplete: boolean | null;
};

function normalizedDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= 200);
  return [...new Set(ids)].slice(0, 10_000);
}

/**
 * Normalizes the collector's local-state/email delta. Counts are derived from
 * the archived IDs so they cannot drift from the exact report cohort.
 */
export function normalizeEmailDelta(value: unknown): EmailDelta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const offlineDeviceIds = normalizedDeviceIds(input.offlineDeviceIds);
  const newlyOfflineDeviceIds = normalizedDeviceIds(input.newlyOfflineDeviceIds);
  const recoveredDeviceIds = normalizedDeviceIds(input.recoveredDeviceIds);
  const previousOfflineDeviceIds = normalizedDeviceIds(input.previousOfflineDeviceIds);
  const stateOfflineDeviceIds = normalizedDeviceIds(input.stateOfflineDeviceIds);
  const hasKnownField = [
    'offlineDeviceIds', 'newlyOfflineDeviceIds', 'recoveredDeviceIds',
    'previousOfflineDeviceIds', 'stateOfflineDeviceIds', 'collectionComplete',
  ].some((key) => Object.hasOwn(input, key));
  if (!hasKnownField) return null;
  return {
    offlineDeviceIds,
    newlyOfflineDeviceIds,
    recoveredDeviceIds,
    previousOfflineDeviceIds,
    stateOfflineDeviceIds,
    offlineCount: offlineDeviceIds.length,
    newlyOfflineCount: newlyOfflineDeviceIds.length,
    recoveredCount: recoveredDeviceIds.length,
    previousOfflineCount: previousOfflineDeviceIds.length,
    stateOfflineCount: stateOfflineDeviceIds.length,
    collectionComplete: typeof input.collectionComplete === 'boolean'
      ? input.collectionComplete
      : null,
  };
}

export type OutageAction = 'open' | 'extend' | 'rollover' | 'close' | 'ignore';

/**
 * Daily scans can miss a recovery followed by another outage. An advanced
 * heartbeat proves the old incident ended even when the device is offline
 * again by the time of the next scan.
 */
export function outageAction(input: {
  status: string;
  hasOpenOutage: boolean;
  openTelemetryStoppedAt: Date | null;
  currentLastHeardAt: Date | null;
}): OutageAction {
  if (input.status === 'offline') {
    if (!input.hasOpenOutage) return 'open';
    if (
      input.openTelemetryStoppedAt
      && input.currentLastHeardAt
      && input.currentLastHeardAt.getTime() > input.openTelemetryStoppedAt.getTime()
    ) {
      return 'rollover';
    }
    return 'extend';
  }
  if (
    input.hasOpenOutage
    && (input.status === 'communicating' || input.status === 'delayed')
  ) {
    return 'close';
  }
  return 'ignore';
}
