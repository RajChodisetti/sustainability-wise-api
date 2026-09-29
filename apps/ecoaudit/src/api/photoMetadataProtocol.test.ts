import assert from 'node:assert/strict';
import test from 'node:test';
import { updateEquipment } from '@/api/equipment';
import { saveTokens } from '@/api/client';
import { updateZone } from '@/api/zones';
import type { AuditPhotoMetadataGuard } from '@/types/domain';

const guard: AuditPhotoMetadataGuard = {
  auditId: 'audit-1',
  baseTreeRevision: 19,
  clientInstanceId: 'portal-window-1',
};

function installStorage(): () => void {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  } as Storage;
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

test('completed zone metadata request sends portal identity and exact revision without lease authority', async () => {
  const originalFetch = globalThis.fetch;
  const restoreStorage = installStorage();
  let captured: RequestInit | undefined;
  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (_input, init) => {
      captured = init;
      return Response.json({
        id: 'zone-1',
        auditId: 'audit-1',
        zoneName: 'Kitchen',
        photos: ['https://example.test/kitchen.jpg'],
        photoDescs: { 'photos.0': { name: 'Kitchen overview' } },
        treeRevision: 20,
      });
    };

    const updated = await updateZone('zone-1', {
      photoDescs: { 'photos.0': { name: 'Kitchen overview' } },
    }, guard);
    assert.equal(updated.treeRevision, 20);

    const headers = new Headers(captured?.headers);
    assert.equal(headers.get('x-ecoaudit-protocol-version'), '2');
    assert.equal(headers.get('x-ecoaudit-client-instance-id'), 'portal-window-1');
    assert.equal(headers.get('x-ecoaudit-client-kind'), 'portal');
    assert.equal(headers.get('x-ecoaudit-base-tree-revision'), '19');
    assert.equal(headers.has('x-ecoaudit-lease-token'), false);
    assert.equal(headers.has('x-ecoaudit-lease-fence'), false);
    assert.deepEqual(JSON.parse(String(captured?.body)), {
      photoDescs: { 'photos.0': { name: 'Kitchen overview' } },
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('completed water custom-photo metadata request contains no question, answer, or photo arrays', async () => {
  const originalFetch = globalThis.fetch;
  const restoreStorage = installStorage();
  let captured: RequestInit | undefined;
  try {
    saveTokens('access-token', 'refresh-token');
    globalThis.fetch = async (_input, init) => {
      captured = init;
      return Response.json({
        id: 'water-1',
        auditId: 'audit-1',
        zoneId: 'zone-1',
        assetType: 'water_asset_system',
        name: 'Cooling tower',
        data: {},
        photos: [],
        customFields: [],
        photoDescs: {},
        treeRevision: 20,
      });
    };

    const updated = await updateEquipment('water-assets-systems', 'water-1', {
      photoDescs: { 'photos.0': { name: 'Asset overview', largeInPdf: true } },
      customFields: [{
        id: 'question-1',
        photoDescs: { 'photos.0': { name: 'Condition detail' } },
      }],
    }, guard);
    assert.equal(updated.treeRevision, 20);

    const body = JSON.parse(String(captured?.body));
    assert.deepEqual(body, {
      photoDescs: { 'photos.0': { name: 'Asset overview', largeInPdf: true } },
      customFields: [{
        id: 'question-1',
        photoDescs: { 'photos.0': { name: 'Condition detail' } },
      }],
    });
    assert.deepEqual(Object.keys(body).sort(), ['customFields', 'photoDescs']);
    assert.deepEqual(Object.keys(body.customFields[0]).sort(), ['id', 'photoDescs']);
    assert.equal('question' in body.customFields[0], false);
    assert.equal('answer' in body.customFields[0], false);
    assert.equal('photos' in body.customFields[0], false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});
