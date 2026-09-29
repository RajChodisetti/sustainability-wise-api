import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { db as sharedDb } from '../../db/client.js';
import { signAccessToken } from '../../auth/jwt.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { loadEcoAuditRefreshTree } from './auditTreeService.js';
import { eaAuditRoutes } from './audits.js';

function database(audit: Record<string, unknown> | null) {
  const tables: unknown[] = [];
  const executor = {
    select() {
      let table: unknown;
      const query = {
        from(value: unknown) { table = value; tables.push(value); return query; },
        where() { return query; },
        orderBy() { return query; },
        then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(table === eaAudits && audit ? [audit] : []).then(resolve); },
      };
      return query;
    },
  };
  return { executor, tables };
}

test('unchanged revision reads only the audit row, without loading equipment or zones', async () => {
  const db = database({ id: 'audit-1', treeRevision: 4 });
  assert.deepEqual(await loadEcoAuditRefreshTree(db.executor, 'audit-1', 4), {
    audit: { id: 'audit-1', treeRevision: 4 }, treeUnchanged: true,
  });
  assert.equal(db.tables.length, 1);
});

test('changed and legacy requests retain every full-tree collection', async () => {
  for (const revision of [3, undefined]) {
    const db = database({ id: 'audit-1', treeRevision: 4 });
    const result = await loadEcoAuditRefreshTree(db.executor, 'audit-1', revision);
    assert.ok(result && 'zones' in result);
    assert.ok('waterAssets' in result);
    assert.equal('treeUnchanged' in result, false);
    assert.ok(db.tables.length >= 12);
  }
});

test('missing audits do not return an unchanged response', async () => {
  const db = database(null);
  assert.equal(await loadEcoAuditRefreshTree(db.executor, 'missing', 0), null);
});

test('conditional HTTP reads retain authentication, app, ownership and revision validation', async (t) => {
  const snapshot = database({ id: 'audit-1', treeRevision: 4, status: 'Draft', createdByUserId: 'owner', assignedInspectorUserId: null });
  t.mock.method(sharedDb, 'transaction', async (callback: (tx: any) => unknown) => callback(snapshot.executor));
  const app = Fastify();
  await app.register(eaAuditRoutes, { prefix: '/audits' });
  const headers = (userId: string, appName: 'ecoaudit' | 'solarsense' = 'ecoaudit') => ({
    authorization: `Bearer ${signAccessToken({ userId, app: appName, role: 'inspector' })}`,
  });
  try {
    const url = '/audits/audit-1/tree?knownTreeRevision=4';
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url, headers: headers('owner', 'solarsense') })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url, headers: headers('other') })).statusCode, 403);
    const allowed = await app.inject({ method: 'GET', url, headers: headers('owner') });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().treeUnchanged, true);
    assert.equal(allowed.json().audit.editLease, null);
    assert.equal(allowed.headers['cache-control'], 'private, no-store');
    for (const revision of ['-1', '4.5', 'invalid']) {
      const invalid = await app.inject({ method: 'GET', url: `/audits/audit-1/tree?knownTreeRevision=${revision}`, headers: headers('owner') });
      assert.equal(invalid.statusCode, 400);
    }
  } finally {
    await app.close();
  }
});
