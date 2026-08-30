export const MAX_ESTIMATED_DURATION_MINUTES = 10_080;

/**
 * Parse the optional duration field without inventing a value.
 * `null` means the field was intentionally left blank; `undefined` is invalid.
 */
export function parseEstimatedDurationMinutes(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;

  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_ESTIMATED_DURATION_MINUTES) {
    return undefined;
  }
  return minutes;
}

export function estimatedDurationError(value: string): string | null {
  return parseEstimatedDurationMinutes(value) === undefined
    ? `Enter whole minutes from 1 to ${MAX_ESTIMATED_DURATION_MINUTES.toLocaleString('en-AU')}, or leave this blank.`
    : null;
}

/** Preserve a legacy end time unless the admin actually changes the estimate. */
export function estimatedDurationUpdate(
  current: number | null,
  next: number | null,
): { estimatedDurationMinutes?: number | null } {
  return current === next ? {} : { estimatedDurationMinutes: next };
}

export function formatEstimatedDuration(minutes: number | null): string {
  if (minutes === null) return 'Not estimated';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${remainingMinutes} min`;
}
