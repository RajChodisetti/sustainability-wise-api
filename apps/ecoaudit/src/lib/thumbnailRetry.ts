const BASE_RETRY_DELAY_MS = 750;
const MAX_EXPONENTIAL_DELAY_MS = 30_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function isRetryableThumbnailStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(Math.max(0, dateMs - nowMs), MAX_RETRY_AFTER_MS);
}

/**
 * Retries continue indefinitely while a preview is mounted, but the
 * exponential portion stops growing. Jitter prevents a large imported audit
 * from retrying hundreds of thumbnails in lockstep.
 */
export function thumbnailRetryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random = Math.random(),
  nowMs = Date.now(),
): number {
  const exponent = Math.min(Math.max(0, Math.trunc(attempt)), 16);
  const exponential = Math.min(
    MAX_EXPONENTIAL_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** exponent,
  );
  const jittered = Math.min(
    MAX_EXPONENTIAL_DELAY_MS,
    Math.round(exponential * (0.75 + Math.min(1, Math.max(0, random)) * 0.5)),
  );
  return Math.max(jittered, parseRetryAfterMs(retryAfter, nowMs) ?? 0);
}
