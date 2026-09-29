import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@/api/client';
import type { Audit } from '@/types/domain';
import {
  auditAuthorityState,
  auditLeaseRenewalDelay,
  auditMutationHeaders,
  auditPhotoMetadataGuard,
  auditProtocolErrorMessage,
  auditWriteGuard,
  auditWriteHeaders,
  beginPendingAuditAcquireCommand,
  beginPendingAuditCopyCommand,
  beginPendingAuditCreateCommand,
  clearPendingAuditCommand,
  getAuditClientInstanceId,
  getPendingAuditAcquireCommand,
  getPendingAuditCopyCommand,
  getPendingAuditCreateCommand,
  getStoredAuditLease,
  isDefinitiveAuditCommandRejection,
  persistPendingAuditCommand,
  storeAuditLease,
  storeAuditLeaseDurably,
} from '@/lib/auditProtocol';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function audit(overrides: Partial<Audit> = {}): Audit {
  return {
    id: 'audit-1',
    siteName: 'Site',
    siteAddress: 'Address',
    inspectorName: 'Inspector',
    status: 'Draft',
    treeRevision: 7,
    editFence: 3,
    editLease: {
      ownerUserId: 'user-1',
      clientInstanceId: 'client-1',
      clientKind: 'portal',
      clientLabel: 'Portal',
      fence: 3,
      ownedByCaller: true,
    },
    ...overrides,
  };
}

test('portal client identity is stable in browser storage', () => {
  const storage = new MemoryStorage();
  assert.equal(getAuditClientInstanceId(storage, () => 'client-1'), 'client-1');
  assert.equal(getAuditClientInstanceId(storage, () => 'client-2'), 'client-1');
});

test('portal client identity remains stable for the tab when storage is unavailable', () => {
  assert.equal(getAuditClientInstanceId(null, () => 'volatile-client-1'), 'volatile-client-1');
  assert.equal(getAuditClientInstanceId(null, () => 'volatile-client-2'), 'volatile-client-1');
});

test('lease storage is scoped to its audit and client instance', () => {
  const storage = new MemoryStorage();
  assert.equal(storeAuditLease({
    auditId: 'audit-1',
    clientInstanceId: 'client-1',
    leaseToken: 'secret-token',
    editFence: 3,
  }, storage), true);
  assert.equal(getStoredAuditLease('audit-1', 'client-1', storage)?.leaseToken, 'secret-token');
  assert.equal(getStoredAuditLease('audit-1', 'client-2', storage), null);
});

test('lease token remains usable in the current tab when browser storage is unavailable', () => {
  assert.equal(storeAuditLease({
    auditId: 'volatile-audit',
    clientInstanceId: 'volatile-client-1',
    leaseToken: 'volatile-secret-token',
    editFence: 4,
  }, null), true);
  assert.equal(
    getStoredAuditLease('volatile-audit', 'volatile-client-1', null)?.leaseToken,
    'volatile-secret-token',
  );
});

test('command completion requires lease proof that survives a reload', () => {
  assert.equal(storeAuditLeaseDurably({
    auditId: 'audit-durable',
    clientInstanceId: 'client-1',
    leaseToken: 'secret-token',
    editFence: 1,
  }, null), false);
  const nonPersistentStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  assert.equal(storeAuditLeaseDurably({
    auditId: 'audit-not-persisted',
    clientInstanceId: 'client-1',
    leaseToken: 'secret-token',
    editFence: 1,
  }, nonPersistentStorage), false);
});

test('pending create survives reload and freezes the first request body', () => {
  const storage = new MemoryStorage();
  const command = beginPendingAuditCreateCommand({
    siteName: 'Original site',
    siteAddress: '1 First Street',
    inspectorName: 'Inspector',
    auditDate: '2026-09-24',
  }, 'user-1', 'client-1', storage, () => 'create-audit-11111111-1111-4111-8111-111111111111', () => '2026-09-24T12:00:00.000Z');

  const afterReload = getPendingAuditCreateCommand('user-1', 'client-1', storage);
  assert.deepEqual(afterReload, command);
  assert.deepEqual(beginPendingAuditCreateCommand({
    siteName: 'Changed site',
    siteAddress: '2 Second Street',
    inspectorName: 'Someone else',
    auditDate: null,
  }, 'user-1', 'client-1', storage), command);
  assert.equal(command.body.idempotencyKey, command.idempotencyKey);
  assert.equal(command.body.editClient.clientInstanceId, command.clientInstanceId);
});

test('pending copy and acquire commands are scoped to the source audit and replay exactly', () => {
  const storage = new MemoryStorage();
  const copy = beginPendingAuditCopyCommand({
    sourceAuditId: 'audit-source',
    expectedTreeRevision: 12,
  }, 'user-1', 'client-1', storage, () => 'copy-audit-22222222-2222-4222-8222-222222222222', () => '2026-09-24T12:00:00.000Z');
  const acquire = beginPendingAuditAcquireCommand({
    auditId: 'audit-draft',
    expectedTreeRevision: 4,
  }, 'user-1', 'client-1', storage, () => 'acquire-audit-33333333-3333-4333-8333-333333333333', () => '2026-09-24T12:01:00.000Z');

  assert.deepEqual(getPendingAuditCopyCommand('audit-source', 'user-1', 'client-1', storage), copy);
  assert.equal(getPendingAuditCopyCommand('different-audit', 'user-1', 'client-1', storage), null);
  assert.deepEqual(getPendingAuditAcquireCommand('audit-draft', 'user-1', 'client-1', storage), acquire);
  assert.equal(acquire.body.expectedTreeRevision, 4);
  assert.equal(acquire.body.idempotencyKey, acquire.idempotencyKey);
  assert.equal(acquire.body.clientInstanceId, acquire.clientInstanceId);
});

test('pending commands are bound to the authenticated actor', () => {
  const storage = new MemoryStorage();
  const command = beginPendingAuditCreateCommand({
    siteName: 'Private site',
    siteAddress: '1 Private Street',
    inspectorName: 'Inspector',
    auditDate: null,
  }, 'user-1', 'shared-browser', storage,
  () => 'create-audit-77777777-7777-4777-8777-777777777777');

  assert.equal(getPendingAuditCreateCommand('user-2', 'shared-browser', storage), null);
  assert.deepEqual(getPendingAuditCreateCommand('user-1', 'shared-browser', storage), command);
});

test('clearing a completed command cannot delete a newer command in the same scope', () => {
  const storage = new MemoryStorage();
  const first = beginPendingAuditAcquireCommand({ auditId: 'audit-1', expectedTreeRevision: 4 }, 'user-1', 'client-1', storage,
    () => 'acquire-audit-44444444-4444-4444-8444-444444444444');
  const newer = {
    ...first,
    idempotencyKey: 'acquire-audit-55555555-5555-4555-8555-555555555555',
    body: {
      ...first.body,
      idempotencyKey: 'acquire-audit-55555555-5555-4555-8555-555555555555',
    },
  };
  assert.equal(persistPendingAuditCommand(newer, storage), true);
  assert.equal(clearPendingAuditCommand(first, storage), true);
  assert.deepEqual(getPendingAuditAcquireCommand('audit-1', 'user-1', 'client-1', storage), newer);
  assert.equal(clearPendingAuditCommand(newer, storage), true);
  assert.equal(getPendingAuditAcquireCommand('audit-1', 'user-1', 'client-1', storage), null);
});

test('a command is never returned for sending when durable storage fails', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => undefined,
  };
  assert.throws(() => beginPendingAuditCreateCommand({
    siteName: 'Site',
    siteAddress: 'Address',
    inspectorName: 'Inspector',
    auditDate: null,
  }, 'user-1', 'client-1', storage, () => 'create-audit-66666666-6666-4666-8666-666666666666'), /nothing was sent/i);
});

test('only a current matching owner receives a write guard', () => {
  const storage = new MemoryStorage();
  storeAuditLease({
    auditId: 'audit-1',
    clientInstanceId: 'client-1',
    leaseToken: 'secret-token',
    editFence: 3,
  }, storage);
  assert.equal(auditAuthorityState(audit(), 'client-1', storage), 'owned');
  assert.equal(auditWriteGuard(audit(), 'client-1', storage)?.baseTreeRevision, 7);
  assert.equal(auditAuthorityState(audit({ status: 'Completed' }), 'client-1', storage), 'completed');
  assert.equal(auditAuthorityState(audit({ editLease: { ...audit().editLease!, ownedByCaller: false } }), 'client-1', storage), 'other-owner');
  assert.equal(auditWriteGuard(audit({ editFence: 4 }), 'client-1', storage), null);
  const expired = audit({ editLease: { ...audit().editLease!, expiresAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(auditWriteGuard(expired, 'client-1', storage), null);
  assert.equal(auditAuthorityState(expired, 'client-1', storage), 'owned-expired');
  assert.equal(auditAuthorityState(audit({ editFence: 4 }), 'client-1', storage), 'owned-token-missing');
});

test('write headers carry every v2 concurrency fence', () => {
  assert.deepEqual(auditWriteHeaders({
    auditId: 'audit-1',
    baseTreeRevision: 7,
    editFence: 3,
    leaseToken: 'secret-token',
    clientInstanceId: 'client-1',
  }, 'command-1'), {
    'X-EcoAudit-Protocol-Version': '2',
    'X-EcoAudit-Client-Instance-Id': 'client-1',
    'X-EcoAudit-Client-Kind': 'portal',
    'X-EcoAudit-Lease-Token': 'secret-token',
    'X-EcoAudit-Lease-Fence': '3',
    'X-EcoAudit-Base-Tree-Revision': '7',
    'Idempotency-Key': 'command-1',
  });
});

test('completed photo metadata guard carries only exact portal revision context', () => {
  const completed = audit({ status: 'Completed', treeRevision: 11 });
  const guard = auditPhotoMetadataGuard(completed, 'admin', 'portal-client-1');
  assert.deepEqual(guard, {
    auditId: 'audit-1',
    baseTreeRevision: 11,
    clientInstanceId: 'portal-client-1',
  });
  assert.deepEqual(auditMutationHeaders(guard!), {
    'X-EcoAudit-Protocol-Version': '2',
    'X-EcoAudit-Client-Instance-Id': 'portal-client-1',
    'X-EcoAudit-Client-Kind': 'portal',
    'X-EcoAudit-Base-Tree-Revision': '11',
  });
  assert.equal(auditPhotoMetadataGuard(completed, 'inspector', 'portal-client-1'), null);
  assert.equal(auditPhotoMetadataGuard(audit({ status: 'Draft' }), 'admin', 'portal-client-1'), null);
});

test('owned leases renew after two thirds of their server-issued lifetime', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  assert.equal(auditLeaseRenewalDelay({
    ...audit().editLease!,
    lastSeenAt: '2026-09-24T12:00:00.000Z',
    expiresAt: '2026-09-24T12:15:00.000Z',
  }, now), 10 * 60_000);
  assert.equal(auditLeaseRenewalDelay({
    ...audit().editLease!,
    ownedByCaller: false,
    expiresAt: '2026-09-24T12:15:00.000Z',
  }, now), null);
});

test('machine conflict codes become safe user-facing messages', () => {
  const message = auditProtocolErrorMessage(new ApiError(
    'Conflict',
    409,
    'audit_tree_revision_changed',
    'audit_tree_revision_changed',
  ));
  assert.match(message ?? '', /cloud audit changed/i);
  assert.doesNotMatch(message ?? '', /audit_tree_revision_changed/);
});

test('idempotency keys reset only after a definitive command rejection', () => {
  assert.equal(isDefinitiveAuditCommandRejection(new ApiError('Conflict', 409, 'audit_tree_revision_changed')), true);
  assert.equal(isDefinitiveAuditCommandRejection(new ApiError('Unavailable', 503)), false);
  assert.equal(isDefinitiveAuditCommandRejection(new ApiError('Forbidden', 403)), false);
  assert.equal(isDefinitiveAuditCommandRejection(new ApiError('Rate limited', 429)), false);
  assert.equal(isDefinitiveAuditCommandRejection(new TypeError('Failed to fetch')), false);
});
