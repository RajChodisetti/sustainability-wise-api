import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../utils/errors.js';
import {
  assertAuditReopenVersion,
  assertAuditSyncVersion,
  nextAuditUpdatedAt,
  parseAuditReopenPreconditions,
  parseExpectedAuditUpdatedAt,
} from './auditVersion.js';

const updatedAt = new Date('2026-09-23T01:02:03.004Z');
const completedAt = new Date('2026-09-22T09:08:07.006Z');

function assertAppError(error: unknown, statusCode: number, detail: string): boolean {
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.detail, detail);
  return true;
}

test('legacy reopen requests can omit all version preconditions', () => {
  assert.deepEqual(parseAuditReopenPreconditions(undefined), {});
  assert.doesNotThrow(() => assertAuditReopenVersion(
    { updatedAt, completedAt },
    parseAuditReopenPreconditions(undefined),
  ));
});

test('reopen validates supplied update and completion versions', () => {
  const expected = parseAuditReopenPreconditions({
    expectedUpdatedAt: updatedAt.toISOString(),
    expectedCompletedAt: completedAt.toISOString(),
  });
  assert.doesNotThrow(() => assertAuditReopenVersion({ updatedAt, completedAt }, expected));
  assert.throws(
    () => assertAuditReopenVersion(
      { updatedAt: new Date(updatedAt.getTime() + 1), completedAt },
      expected,
    ),
    (error) => assertAppError(error, 409, 'audit_reopen_version_changed'),
  );
  assert.throws(
    () => assertAuditReopenVersion(
      { updatedAt, completedAt: new Date(completedAt.getTime() + 1) },
      expected,
    ),
    (error) => assertAppError(error, 409, 'audit_reopen_version_changed'),
  );
});

test('reopen accepts and compares an explicit null completion version', () => {
  const expected = parseAuditReopenPreconditions({
    expectedCompletedAt: null,
  });
  assert.doesNotThrow(() => assertAuditReopenVersion({ updatedAt, completedAt: null }, expected));
  assert.throws(
    () => assertAuditReopenVersion({ updatedAt, completedAt }, expected),
    (error) => assertAppError(error, 409, 'audit_reopen_version_changed'),
  );
});

test('invalid version fields fail closed as bad requests', () => {
  assert.throws(
    () => parseAuditReopenPreconditions({ expectedUpdatedAt: 'not-a-date' }),
    (error) => assertAppError(error, 400, 'expectedUpdatedAt must be a valid ISO datetime'),
  );
  assert.throws(
    () => parseAuditReopenPreconditions({ expectedCompletedAt: 123 }),
    (error) => assertAppError(error, 400, 'expectedCompletedAt must be a valid ISO datetime'),
  );
  assert.throws(
    () => parseExpectedAuditUpdatedAt(null, true),
    (error) => assertAppError(error, 400, 'expectedAuditUpdatedAt must be a valid ISO datetime'),
  );
});

test('sync CAS rejects stale or missing audits and legacy pushes remain compatible', () => {
  const expected = parseExpectedAuditUpdatedAt(updatedAt.toISOString(), true);
  assert.doesNotThrow(() => assertAuditSyncVersion({ updatedAt }, expected));
  assert.throws(
    () => assertAuditSyncVersion({ updatedAt: new Date(updatedAt.getTime() + 1) }, expected),
    (error) => assertAppError(error, 409, 'audit_sync_version_changed'),
  );
  assert.throws(
    () => assertAuditSyncVersion(undefined, expected),
    (error) => assertAppError(error, 409, 'audit_sync_version_changed'),
  );
  assert.doesNotThrow(() => assertAuditSyncVersion(undefined, undefined));
});

test('server mutation timestamps advance monotonically beyond the CAS token', () => {
  assert.equal(
    nextAuditUpdatedAt(updatedAt, new Date(updatedAt.getTime() - 1000)).toISOString(),
    new Date(updatedAt.getTime() + 1).toISOString(),
  );
});
