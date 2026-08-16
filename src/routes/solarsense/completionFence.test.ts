import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../utils/errors.js';
import {
  completionAtFirstObservation,
  parseSolarLifecycleStatus,
  resolveSolarCompletionFence,
  resolveSyncedCompletion,
} from './completionFence.js';

const firstCompletedAt = new Date('2026-08-15T10:00:00.000Z');
const laterReceivedAt = new Date('2026-08-15T11:00:00.000Z');

test('Completed is timestamped from the server clock on first observation', () => {
  assert.equal(completionAtFirstObservation('Draft', laterReceivedAt), null);
  assert.equal(
    completionAtFirstObservation('Completed', laterReceivedAt)?.getTime(),
    laterReceivedAt.getTime(),
  );
  assert.deepEqual(resolveSyncedCompletion({
    incomingStatus: 'Completed',
    receivedAt: laterReceivedAt,
    entity: 'assessment',
  }), {
    status: 'Completed',
    completedAt: laterReceivedAt,
  });
});

test('repeated Completed sync preserves the first server completion boundary', () => {
  assert.deepEqual(resolveSyncedCompletion({
    existing: { status: 'Completed', completedAt: firstCompletedAt },
    incomingStatus: 'Completed',
    receivedAt: laterReceivedAt,
    entity: 'site',
  }), {
    status: 'Completed',
    completedAt: firstCompletedAt,
  });
});

test('a legacy Completed record without a boundary receives one on sync', () => {
  assert.deepEqual(resolveSyncedCompletion({
    existing: { status: 'Completed', completedAt: null },
    incomingStatus: 'Completed',
    receivedAt: laterReceivedAt,
    entity: 'site',
  }), {
    status: 'Completed',
    completedAt: laterReceivedAt,
  });
});

test('generic sync cannot reopen a Completed record', () => {
  assert.throws(() => resolveSyncedCompletion({
    existing: { status: 'Completed', completedAt: firstCompletedAt },
    incomingStatus: 'Draft',
    receivedAt: laterReceivedAt,
    entity: 'assessment',
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.detail, 'assessment_completed_reopen_requires_explicit_transition');
    return true;
  });
});

test('only supported Solar lifecycle statuses are accepted', () => {
  assert.equal(parseSolarLifecycleStatus(undefined), 'Draft');
  assert.equal(parseSolarLifecycleStatus('Completed'), 'Completed');
  assert.throws(() => parseSolarLifecycleStatus('complete'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test('completion fence uses the earliest immutable assessment or site boundary', () => {
  assert.deepEqual(resolveSolarCompletionFence(
    { status: 'Completed', completedAt: firstCompletedAt },
    { status: 'Completed', completedAt: laterReceivedAt },
  ), {
    completed: true,
    completionBoundary: firstCompletedAt,
  });
});

test('a Completed record missing its boundary fails closed', () => {
  assert.deepEqual(resolveSolarCompletionFence(
    { status: 'Completed', completedAt: null },
    { status: 'Draft', completedAt: null },
  ), {
    completed: true,
    completionBoundary: null,
  });
});

test('Draft site and assessment have no completion fence', () => {
  assert.deepEqual(resolveSolarCompletionFence(
    { status: 'Draft', completedAt: null },
    { status: 'Draft', completedAt: null },
  ), {
    completed: false,
    completionBoundary: null,
  });
});
