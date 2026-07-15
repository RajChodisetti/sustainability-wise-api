const removedTimingKeys = new Set([
  'startedAt',
  'completedAt',
  'started_at',
  'completed_at',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withoutTimingKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !removedTimingKeys.has(key)),
  );
}

/**
 * Removes retired audit timing metadata before persisting a sync snapshot.
 * Both naming styles are stripped so legacy clients cannot reintroduce the
 * values through record_versions after the timing columns have been dropped.
 */
export function sanitizeEcoAuditSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return snapshot;

  const sanitized = withoutTimingKeys(snapshot);
  if (isRecord(sanitized.audit)) {
    sanitized.audit = withoutTimingKeys(sanitized.audit);
  }
  return sanitized;
}
