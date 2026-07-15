import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRetryableThumbnailStatus,
  parseRetryAfterMs,
  thumbnailRetryDelayMs,
} from './thumbnailRetry';

test('only network-equivalent server and rate-limit statuses are retryable', () => {
  assert.equal(isRetryableThumbnailStatus(429), true);
  assert.equal(isRetryableThumbnailStatus(500), true);
  assert.equal(isRetryableThumbnailStatus(503), true);
  assert.equal(isRetryableThumbnailStatus(404), false);
  assert.equal(isRetryableThumbnailStatus(401), false);
});

test('honors Retry-After seconds and dates', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  assert.equal(parseRetryAfterMs('12', now), 12_000);
  assert.equal(parseRetryAfterMs('Wed, 15 Jul 2026 12:00:09 GMT', now), 9_000);
  assert.equal(parseRetryAfterMs('invalid', now), null);
  assert.equal(thumbnailRetryDelayMs(0, '12', 0, now), 12_000);
});

test('caps exponential growth while retaining jitter', () => {
  assert.equal(thumbnailRetryDelayMs(0, null, 0), 563);
  assert.equal(thumbnailRetryDelayMs(20, null, 1), 30_000);
});
