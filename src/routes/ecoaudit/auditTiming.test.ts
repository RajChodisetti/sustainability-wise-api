import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCompletionTiming,
  resolveReopenTiming,
  resolveSyncedAuditTiming,
} from './auditTiming.js';

test('completion preserves the first start and completion timestamps', () => {
  const startedAt = new Date('2026-01-01T01:00:00.000Z');
  const completedAt = new Date('2026-01-01T02:00:00.000Z');
  const now = new Date('2026-01-02T00:00:00.000Z');

  assert.deepEqual(resolveCompletionTiming({ startedAt, completedAt }, now), {
    startedAt,
    completedAt,
  });
});

test('completion falls back to audit creation time and the current time', () => {
  const createdAt = new Date('2026-01-01T01:00:00.000Z');
  const now = new Date('2026-01-01T03:00:00.000Z');

  assert.deepEqual(resolveCompletionTiming({ createdAt }, now), {
    startedAt: createdAt,
    completedAt: now,
  });
});

test('reopening clears completion timing while preserving the original start', () => {
  const startedAt = new Date('2026-01-01T01:00:00.000Z');

  assert.deepEqual(resolveReopenTiming({
    startedAt,
    completedAt: new Date('2026-01-01T02:00:00.000Z'),
  }), {
    startedAt,
    completedAt: null,
  });
});

test('reopening an unstarted draft is idempotent', () => {
  assert.deepEqual(resolveReopenTiming({
    startedAt: null,
    completedAt: null,
  }), {
    startedAt: null,
    completedAt: null,
  });
});

test('sync persists explicit timing supplied by a completed audit', () => {
  const incomingStartedAt = new Date('2026-02-01T01:00:00.000Z');
  const incomingCompletedAt = new Date('2026-02-01T02:00:00.000Z');

  assert.deepEqual(resolveSyncedAuditTiming({
    status: 'Completed',
    incomingStartedAt,
    incomingCompletedAt,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T03:00:00.000Z'),
  }), { startedAt: incomingStartedAt, completedAt: incomingCompletedAt });
});

test('sync gives legacy completed audits stable fallback timing', () => {
  const createdAt = new Date('2026-03-01T01:00:00.000Z');
  const updatedAt = new Date('2026-03-01T02:00:00.000Z');

  assert.deepEqual(resolveSyncedAuditTiming({
    status: 'Completed',
    incomingStartedAt: null,
    incomingCompletedAt: null,
    createdAt,
    updatedAt,
  }), { startedAt: createdAt, completedAt: updatedAt });
});

test('sync does not retain a completion timestamp when an audit is draft', () => {
  const startedAt = new Date('2026-04-01T01:00:00.000Z');

  assert.deepEqual(resolveSyncedAuditTiming({
    status: 'Draft',
    incomingStartedAt: null,
    incomingCompletedAt: null,
    existingStartedAt: startedAt,
    existingCompletedAt: new Date('2026-04-01T02:00:00.000Z'),
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T03:00:00.000Z'),
  }), { startedAt, completedAt: null });
});
