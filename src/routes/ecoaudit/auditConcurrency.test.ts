import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../utils/errors.js';
import {
  assertEcoAuditCompletedPhotoMetadataClient,
  assertEcoAuditCompletedPhotoMetadataRequest,
  assertEcoAuditCopySourceEligible,
  assertEcoAuditCreateIdNotPurged,
  assertEcoAuditLeaseAvailableForAcquire,
  assertEcoAuditLegacyMutationAllowed,
  assertEcoAuditSyncTargetActive,
  canonicalCommandFingerprint,
  deriveEcoAuditCommandLeaseToken,
  ecoAuditCommandLeaseToken,
  ecoAuditCompletionFence,
  ecoAuditIdempotencyStorageKey,
  parseEcoAuditBaseRevisionContext,
  parseEcoAuditRecoveryKey,
  parseEcoAuditWriteContext,
  presentEcoAuditLease,
  releaseEcoAuditEditLease,
} from './auditConcurrency.js';

function request(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

test('completed metadata context requires v2 client and exact base revision but no lease secret', () => {
  assert.throws(
    () => parseEcoAuditBaseRevisionContext(request({})),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'ecoaudit_client_upgrade_required',
  );
  assert.deepEqual(parseEcoAuditBaseRevisionContext(request({
    'x-ecoaudit-protocol-version': '2',
    'x-ecoaudit-client-instance-id': 'portal-window-1',
    'x-ecoaudit-client-kind': 'portal',
    'x-ecoaudit-base-tree-revision': '17',
  })), {
    clientInstanceId: 'portal-window-1',
    clientKind: 'portal',
    baseTreeRevision: 17,
  });

  assert.throws(
    () => parseEcoAuditWriteContext(request({
      'x-ecoaudit-protocol-version': '2',
      'x-ecoaudit-client-instance-id': 'portal-window-1',
      'x-ecoaudit-base-tree-revision': '17',
    })),
    (error) => error instanceof AppError
      && error.statusCode === 400
      && error.detail === 'X-EcoAudit-Lease-Token is required',
  );
});

test('completed metadata correction unconditionally rejects legacy non-v2 requests', () => {
  assert.throws(
    () => assertEcoAuditCompletedPhotoMetadataRequest(
      { userId: 'admin-1', app: 'ecoaudit', role: 'admin', authType: 'jwt' },
      request({}),
      17,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'ecoaudit_client_upgrade_required',
  );
});

test('completed metadata context requires an explicit recognized client kind', () => {
  const baseHeaders = {
    'x-ecoaudit-protocol-version': '2',
    'x-ecoaudit-client-instance-id': 'client-1',
    'x-ecoaudit-base-tree-revision': '17',
  };
  assert.throws(
    () => parseEcoAuditBaseRevisionContext(request(baseHeaders)),
    (error) => error instanceof AppError
      && error.statusCode === 400
      && error.detail === 'X-EcoAudit-Client-Kind must be mobile or portal',
  );
  assert.deepEqual(parseEcoAuditBaseRevisionContext(request({
    ...baseHeaders,
    'x-ecoaudit-client-kind': 'mobile',
  })), {
    clientInstanceId: 'client-1',
    clientKind: 'mobile',
    baseTreeRevision: 17,
  });
  assert.throws(
    () => assertEcoAuditCompletedPhotoMetadataClient(
      { userId: 'admin-1', app: 'ecoaudit', role: 'admin', authType: 'jwt' },
      { clientInstanceId: 'device-1', clientKind: 'mobile', baseTreeRevision: 17 },
      17,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_completed_photo_metadata_portal_only',
  );
  assert.throws(
    () => assertEcoAuditCompletedPhotoMetadataClient(
      { userId: 'inspector-1', app: 'ecoaudit', role: 'inspector', authType: 'jwt' },
      { clientInstanceId: 'portal-1', clientKind: 'portal', baseTreeRevision: 17 },
      17,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 403
      && error.detail === 'audit_completed_photo_metadata_admin_required',
  );
  assert.doesNotThrow(() => assertEcoAuditCompletedPhotoMetadataClient(
    { userId: 'admin-1', app: 'ecoaudit', role: 'admin', authType: 'jwt' },
    { clientInstanceId: 'portal-1', clientKind: 'portal', baseTreeRevision: 17 },
    17,
  ));
  assert.doesNotThrow(() => assertEcoAuditCompletedPhotoMetadataClient(
    { userId: 'service-1', app: 'ecoaudit', role: 'service_account', authType: 'apikey' },
    { clientInstanceId: 'portal-service-1', clientKind: 'portal', baseTreeRevision: 17 },
    17,
  ));
  assert.throws(
    () => assertEcoAuditCompletedPhotoMetadataClient(
      { userId: 'admin-1', app: 'ecoaudit', role: 'admin', authType: 'jwt' },
      { clientInstanceId: 'portal-1', clientKind: 'portal', baseTreeRevision: 16 },
      17,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_tree_revision_changed',
  );
});

test('an audit that has ever been fenced cannot silently downgrade to legacy writes', () => {
  assert.doesNotThrow(() => assertEcoAuditLegacyMutationAllowed(
    { editFence: 0 },
    undefined,
  ));
  assert.throws(
    () => assertEcoAuditLegacyMutationAllowed({ editFence: 2 }, undefined),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'ecoaudit_client_upgrade_required',
  );
});

test('v2 sync cannot resurrect a soft-deleted audit', () => {
  assert.doesNotThrow(() => assertEcoAuditSyncTargetActive(
    { deletedAt: null, status: 'Draft' },
    true,
  ));
  assert.doesNotThrow(() => assertEcoAuditSyncTargetActive(
    { deletedAt: new Date('2026-01-01T00:00:00Z'), status: 'Draft' },
    false,
  ));
  assert.throws(
    () => assertEcoAuditSyncTargetActive(
      { deletedAt: new Date('2026-01-01T00:00:00Z'), status: 'Draft' },
      true,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_edit_lease_invalid',
  );
  assert.throws(
    () => assertEcoAuditSyncTargetActive(
      { deletedAt: null, status: 'Completed' },
      false,
    ),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_completed_reopen_requires_explicit_transition',
  );
});

test('a deterministic create ID can never be reused after a hard purge', () => {
  assert.doesNotThrow(() => assertEcoAuditCreateIdNotPurged(undefined));
  assert.throws(
    () => assertEcoAuditCreateIdNotPurged({ auditId: 'purged-audit' }),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_id_permanently_purged',
  );
});

test('POST acquire never rotates an existing lease, including an expired same-client lease', () => {
  const expiredLease = {
    auditId: 'audit-1',
    fence: 4,
    ownerUserId: 'user-1',
    clientInstanceId: 'device-1',
    clientKind: 'mobile',
    clientLabel: 'iPad',
    tokenHash: 'secret-hash',
    acquiredAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-01T00:01:00Z'),
    expiresAt: new Date('2026-01-01T00:02:00Z'),
  };
  assert.throws(
    () => assertEcoAuditLeaseAvailableForAcquire({ editFence: 4 }, expiredLease),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_edit_lease_held',
  );
  assert.doesNotThrow(() => assertEcoAuditLeaseAvailableForAcquire(
    { editFence: 0 },
    undefined,
  ));
  assert.throws(
    () => assertEcoAuditLeaseAvailableForAcquire({ editFence: 4 }, undefined),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_edit_lease_invalid',
  );
});

test('legacy copy cannot bypass an in-progress or previously fenced source', () => {
  const completed = { status: 'Completed', treeRevision: 9, editFence: 0 };
  assert.doesNotThrow(() => assertEcoAuditCopySourceEligible(
    completed,
    undefined,
    { protocolV2: false },
  ));
  assert.throws(
    () => assertEcoAuditCopySourceEligible(
      { ...completed, status: 'Draft' },
      undefined,
      { protocolV2: false },
    ),
    (error) => error instanceof AppError
      && error.detail === 'audit_copy_requires_completed_source',
  );
  assert.throws(
    () => assertEcoAuditCopySourceEligible(
      { ...completed, editFence: 2 },
      undefined,
      { protocolV2: false },
    ),
    (error) => error instanceof AppError
      && error.detail === 'ecoaudit_client_upgrade_required',
  );
});

test('command fingerprints are stable across object key order', () => {
  assert.equal(
    canonicalCommandFingerprint({ stage: 'complete', nested: { a: 1, b: 2 } }),
    canonicalCommandFingerprint({ nested: { b: 2, a: 1 }, stage: 'complete' }),
  );
});

test('command recovery keys are high entropy, hashed at rest, and derive stable scoped lease tokens', () => {
  const key = 'create-audit-5ebf20c4-6025-4b35-95bd-1f514ea50412';
  assert.equal(parseEcoAuditRecoveryKey(key), key);
  assert.throws(
    () => parseEcoAuditRecoveryKey('guessable'),
    (error) => error instanceof AppError && error.statusCode === 400,
  );
  assert.notEqual(ecoAuditIdempotencyStorageKey(key), key);
  assert.equal(ecoAuditIdempotencyStorageKey(key).length, 64);

  const input = {
    auditId: 'audit-1',
    operation: 'create' as const,
    actorUserId: 'user-1',
    clientInstanceId: 'device-1',
    idempotencyKey: key,
  };
  assert.equal(ecoAuditCommandLeaseToken(input), ecoAuditCommandLeaseToken(input));
  assert.notEqual(
    ecoAuditCommandLeaseToken(input),
    ecoAuditCommandLeaseToken({ ...input, auditId: 'audit-2' }),
  );
});

test('command lease recovery remains stable across JWT signing-key rotation', () => {
  const input = {
    auditId: 'audit-1',
    operation: 'create' as const,
    actorUserId: 'user-1',
    clientInstanceId: 'device-1',
    idempotencyKey: 'create-audit-5ebf20c4-6025-4b35-95bd-1f514ea50412',
  };
  const stableCommandSecret = 'stable-command-secret-012345678901234567890';
  const beforeJwtRotation = deriveEcoAuditCommandLeaseToken(stableCommandSecret, input);
  const afterJwtRotation = deriveEcoAuditCommandLeaseToken(stableCommandSecret, input);

  assert.equal(afterJwtRotation, beforeJwtRotation);
  assert.notEqual(
    beforeJwtRotation,
    deriveEcoAuditCommandLeaseToken('rotated-jwt-secret-0123456789012345678901', input),
  );
});

test('legacy completion stays unfenced while protected completion advances the fence', () => {
  assert.equal(ecoAuditCompletionFence(0, false), 0);
  assert.equal(ecoAuditCompletionFence(4, true), 5);
});

test('a Draft lease cannot be released for another device to claim', async () => {
  await assert.rejects(
    releaseEcoAuditEditLease({
      auditId: 'audit-1',
      user: {
        userId: 'user-1',
        app: 'ecoaudit',
        role: 'inspector',
        authType: 'jwt',
      },
      request: request({}),
    }),
    (error) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'audit_edit_release_requires_completion',
  );
});

test('lease presentation never exposes token hash and identifies the exact caller', () => {
  const lease = {
    auditId: 'audit-1',
    fence: 4,
    ownerUserId: 'user-1',
    clientInstanceId: 'device-1',
    clientKind: 'mobile',
    clientLabel: 'iPad',
    tokenHash: 'secret-hash',
    acquiredAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-01T00:01:00Z'),
    expiresAt: new Date('2099-01-01T00:00:00Z'),
  };
  const presented = presentEcoAuditLease(lease, {
    userId: 'user-1',
    clientInstanceId: 'device-1',
  });
  assert.equal(presented?.ownedByCaller, true);
  assert.equal('tokenHash' in (presented ?? {}), false);
});
