import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireAuditEditLease, createAudit, createAuditAmendment, renewAuditEditLease } from '@/api/audits';
import { saveTokens } from '@/api/client';
import {
  beginPendingAuditAcquireCommand,
  beginPendingAuditCopyCommand,
  beginPendingAuditCreateCommand,
} from '@/lib/auditProtocol';
import type { Audit, AuditWriteGuard } from '@/types/domain';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function installBrowserGlobals(storage: Storage): () => void {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage, addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  return () => {
    if (originalStorage === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  };
}

test('completed audit copy sends provenance-safe v2 amendment command', async () => {
  const storage = memoryStorage();
  storage.setItem('ea_edit_client_instance_v1', 'portal-client-1');
  const restoreBrowserGlobals = installBrowserGlobals(storage);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const source: Audit = {
    id: 'audit-source',
    siteName: 'Site',
    siteAddress: 'Address',
    inspectorName: 'Inspector',
    status: 'Completed',
    treeRevision: 12,
    recordVersionNumber: 4,
  };

  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({
        audit: { ...source, id: 'audit-copy', status: 'Draft', treeRevision: 1 },
        sourceAuditId: source.id,
        sourceRecordVersionNumber: 4,
        treeRevision: 1,
        editFence: 1,
        leaseToken: 'new-lease-token',
        editLease: {
          ownerUserId: 'user-1',
          clientInstanceId: 'portal-client-1',
          clientKind: 'portal',
          fence: 1,
          ownedByCaller: true,
        },
      });
    };

    const command = beginPendingAuditCopyCommand({
      sourceAuditId: source.id,
      expectedTreeRevision: source.treeRevision,
    }, 'user-1', 'portal-client-1', storage, () => 'copy-command-11111111-1111-4111-8111-111111111111');
    const result = await createAuditAmendment(command);
    assert.equal(result.audit.id, 'audit-copy');
    assert.equal(result.audit.treeRevision, 1);
    const captured = requests[0];
    assert.ok(captured);
    assert.match(captured.input, /\/v1\/ecoaudit\/audits\/audit-source\/copy$/);
    assert.equal(captured.init?.method, 'POST');
    const headers = new Headers(captured.init?.headers);
    assert.equal(headers.get('x-ecoaudit-protocol-version'), '2');
    assert.equal(headers.get('x-ecoaudit-client-instance-id'), 'portal-client-1');
    assert.equal(headers.get('x-ecoaudit-base-tree-revision'), '12');
    assert.equal(headers.get('idempotency-key'), command.idempotencyKey);
    assert.deepEqual(JSON.parse(String(captured.init?.body)), command.body);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});

test('lease heartbeat carries the complete writer fence without rotating it', async () => {
  const storage = memoryStorage();
  const restoreBrowserGlobals = installBrowserGlobals(storage);
  const originalFetch = globalThis.fetch;
  let headers = new Headers();
  const guard: AuditWriteGuard = {
    auditId: 'audit-1',
    clientInstanceId: 'portal-client-1',
    leaseToken: 'lease-token',
    editFence: 7,
    baseTreeRevision: 22,
  };

  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({
        auditId: 'audit-1',
        treeRevision: 22,
        editFence: 7,
        editLease: {
          ownerUserId: 'user-1',
          clientInstanceId: 'portal-client-1',
          clientKind: 'portal',
          fence: 7,
          ownedByCaller: true,
        },
      });
    };

    const result = await renewAuditEditLease('audit-1', guard);
    assert.equal(result.treeRevision, 22);
    assert.equal(headers.get('x-ecoaudit-protocol-version'), '2');
    assert.equal(headers.get('x-ecoaudit-client-instance-id'), 'portal-client-1');
    assert.equal(headers.get('x-ecoaudit-lease-token'), 'lease-token');
    assert.equal(headers.get('x-ecoaudit-lease-fence'), '7');
    assert.equal(headers.get('x-ecoaudit-base-tree-revision'), '22');
  } finally {
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});

test('audit create sends the exact durable command body and identity', async () => {
  const storage = memoryStorage();
  storage.setItem('ea_edit_client_instance_v1', 'portal-client-1');
  const restoreBrowserGlobals = installBrowserGlobals(storage);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];

  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({
        audit: {
          id: 'audit-new',
          siteName: 'Frozen site',
          siteAddress: '1 Main Street',
          inspectorName: 'Inspector',
          status: 'Draft',
          treeRevision: 1,
        },
        treeRevision: 1,
        editFence: 1,
        leaseToken: 'new-lease-token',
        editLease: {
          ownerUserId: 'user-1',
          clientInstanceId: 'portal-client-1',
          clientKind: 'portal',
          fence: 1,
          ownedByCaller: true,
        },
      });
    };

    const command = beginPendingAuditCreateCommand({
      siteName: 'Frozen site',
      siteAddress: '1 Main Street',
      inspectorName: 'Inspector',
      auditDate: null,
    }, 'user-1', 'portal-client-1', storage, () => 'create-command-22222222-2222-4222-8222-222222222222');
    const result = await createAudit(command);
    assert.equal(result.audit.id, 'audit-new');
    const captured = requests[0];
    assert.ok(captured);
    assert.match(captured.input, /\/v1\/ecoaudit\/audits$/);
    assert.equal(captured.init?.method, 'POST');
    const headers = new Headers(captured.init?.headers);
    assert.equal(headers.get('x-ecoaudit-client-instance-id'), command.clientInstanceId);
    assert.equal(headers.get('idempotency-key'), command.idempotencyKey);
    assert.deepEqual(JSON.parse(String(captured.init?.body)), command.body);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});

test('lease acquire sends the exact durable recovery command', async () => {
  const storage = memoryStorage();
  storage.setItem('ea_edit_client_instance_v1', 'portal-client-1');
  const restoreBrowserGlobals = installBrowserGlobals(storage);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];

  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({
        auditId: 'audit-1',
        treeRevision: 23,
        editFence: 8,
        leaseToken: 'recovered-lease-token',
        editLease: {
          ownerUserId: 'user-1',
          clientInstanceId: 'portal-client-1',
          clientKind: 'portal',
          fence: 8,
          ownedByCaller: true,
        },
      });
    };

    const command = beginPendingAuditAcquireCommand({
      auditId: 'audit-1',
      expectedTreeRevision: 22,
    }, 'user-1', 'portal-client-1', storage, () => 'acquire-command-33333333-3333-4333-8333-333333333333');
    const result = await acquireAuditEditLease(command);
    assert.equal(result.leaseToken, 'recovered-lease-token');
    const captured = requests[0];
    assert.ok(captured);
    assert.match(captured.input, /\/v1\/ecoaudit\/audits\/audit-1\/edit-lease$/);
    assert.equal(captured.init?.method, 'POST');
    const headers = new Headers(captured.init?.headers);
    assert.equal(headers.get('x-ecoaudit-protocol-version'), '2');
    assert.equal(headers.get('x-ecoaudit-client-instance-id'), command.clientInstanceId);
    assert.equal(headers.get('idempotency-key'), command.idempotencyKey);
    assert.deepEqual(JSON.parse(String(captured.init?.body)), command.body);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});
