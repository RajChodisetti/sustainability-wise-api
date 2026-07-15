import type { Audit } from '@/types/domain';

export function parseAuditDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prefer explicit startedAt; fall back to createdAt for older records. */
export function getAuditStartedAt(audit: Audit): Date | null {
  return parseAuditDate(audit.startedAt) ?? parseAuditDate(audit.createdAt);
}

/** Prefer explicit completedAt; for completed audits fall back to updatedAt. */
export function getAuditCompletedAt(audit: Audit): Date | null {
  const explicit = parseAuditDate(audit.completedAt);
  if (explicit) return explicit;
  if (audit.status === 'Completed') return parseAuditDate(audit.updatedAt);
  return null;
}

export function getAuditDurationMs(audit: Audit, now = Date.now()): number | null {
  const start = getAuditStartedAt(audit);
  if (!start) return null;
  const end = getAuditCompletedAt(audit);
  const endMs = end ? end.getTime() : (audit.status === 'Completed' ? null : now);
  if (endMs == null) return null;
  return Math.max(0, endMs - start.getTime());
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${minutes}m`;
  const seconds = Math.floor(ms / 1000);
  return seconds > 0 ? `${seconds}s` : '<1s';
}

export function formatDateTime(value?: string | Date | null): string {
  const d = value instanceof Date ? value : parseAuditDate(typeof value === 'string' ? value : null);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function averageDurationMs(audits: Audit[]): number | null {
  const durations = audits
    .map((a) => (a.status === 'Completed' ? getAuditDurationMs(a) : null))
    .filter((v): v is number => v != null);
  if (durations.length === 0) return null;
  return durations.reduce((sum, v) => sum + v, 0) / durations.length;
}
