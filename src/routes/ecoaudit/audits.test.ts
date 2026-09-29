import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import {
  ecoAuditCopyBodyOverrides,
  eaAuditRoutes,
  exactEcoAuditCompletionReplay,
} from './audits.js';

test('copies clear the source assignee and ignore a request-body assignee', () => {
  const overrides = ecoAuditCopyBodyOverrides({
    assignedInspectorUserId: 'source-inspector',
    siteAddress: 'Original address',
    auditDate: '2026-09-24',
  }, {
    assignedInspectorUserId: 'attacker-selected-user',
    siteAddress: 'Updated address',
  });

  assert.equal(overrides.assignedInspectorUserId, null);
  assert.equal(overrides.siteAddress, 'Updated address');
});

test('completion replay returns the exact stored result after later completed metadata changes', () => {
  const stored = {
    audit: {
      id: 'audit-1',
      treeRevision: 8,
      recordVersionNumber: 3,
      siteName: 'Site at completion',
    },
    treeRevision: 8,
    editFence: 4,
    recordVersionNumber: 3,
    editLease: null,
    replayed: false,
  };
  const laterCompletedHead = {
    treeRevision: 9,
    recordVersionNumber: 4,
    siteName: 'Metadata corrected later',
  };

  const replay = exactEcoAuditCompletionReplay(stored);
  assert.deepEqual(replay, stored);
  assert.notEqual(replay.treeRevision, laterCompletedHead.treeRevision);
  assert.notEqual(replay.recordVersionNumber, laterCompletedHead.recordVersionNumber);
  assert.equal(replay.audit.siteName, 'Site at completion');
});

test('hard purge records a durable tombstone before tree deletion and create checks it', async () => {
  const source = await readFile(new URL('./audits.ts', import.meta.url), 'utf8');
  const createRoute = source.slice(
    source.indexOf("app.post('/',"),
    source.indexOf("app.get('/:id',"),
  );
  assert.match(createRoute, /from\(eaAuditPurgeTombstones\)/);
  assert.match(createRoute, /assertEcoAuditCreateIdNotPurged\(purgeTombstone\)/);

  const deleteRoute = source.slice(
    source.indexOf("app.delete('/:id',"),
    source.indexOf("app.patch('/:id\/start',"),
  );
  const tombstoneIndex = deleteRoute.indexOf('tx.insert(eaAuditPurgeTombstones)');
  const purgeIndex = deleteRoute.indexOf('purgeEcoauditAuditTreeRows(tx, id)');
  assert.ok(tombstoneIndex >= 0);
  assert.ok(purgeIndex > tombstoneIndex);
});

test('reopen is an authenticated EcoAudit inspector route and remains no-body compatible', async () => {
  const app = Fastify();
  await app.register(eaAuditRoutes, { prefix: '/audits' });
  await app.ready();

  try {
    assert.equal(app.hasRoute({
      method: 'PATCH',
      url: '/audits/:id/reopen',
    }), true);
    for (const [method, url] of [
      ['GET', '/audits/:id/tree'],
      ['POST', '/audits/:id/edit-lease'],
      ['PUT', '/audits/:id/edit-lease'],
      ['DELETE', '/audits/:id/edit-lease'],
      ['POST', '/audits/:id/edit-lease/takeover'],
      ['POST', '/audits/:id/copy'],
      ['PATCH', '/audits/:id/complete'],
    ] as const) {
      assert.equal(app.hasRoute({ method, url }), true, `${method} ${url}`);
    }

    const unauthenticated = await app.inject({
      method: 'PATCH',
      url: '/audits/audit-1/reopen',
    });
    assert.equal(unauthenticated.statusCode, 401);

    const wrongApp = await app.inject({
      method: 'PATCH',
      url: '/audits/audit-1/reopen',
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'solar-admin',
          app: 'solarsense',
          role: 'admin',
        })}`,
      },
    });
    assert.equal(wrongApp.statusCode, 403);

    const viewer = await app.inject({
      method: 'PATCH',
      url: '/audits/audit-1/reopen',
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-viewer',
          app: 'ecoaudit',
          role: 'viewer',
        })}`,
      },
    });
    assert.equal(viewer.statusCode, 403);

    const genericStatusPatch = await app.inject({
      method: 'PATCH',
      url: '/audits/audit-1',
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-inspector',
          app: 'ecoaudit',
          role: 'inspector',
        })}`,
      },
      payload: { status: 'Draft' },
    });
    assert.equal(genericStatusPatch.statusCode, 400);

    const v2Reopen = await app.inject({
      method: 'PATCH',
      url: '/audits/audit-1/reopen',
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-inspector',
          app: 'ecoaudit',
          role: 'inspector',
        })}`,
        'x-ecoaudit-protocol-version': '2',
      },
      payload: {},
    });
    assert.equal(v2Reopen.statusCode, 400);
    assert.equal(v2Reopen.json().message, 'Bad request');
  } finally {
    await app.close();
  }
});
