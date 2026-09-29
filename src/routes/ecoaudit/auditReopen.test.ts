import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '../../db/client.js';
import { signAccessToken } from '../../auth/jwt.js';
import { AppError } from '../../utils/errors.js';
import { eaAuditRoutes } from './audits.js';
import { assertEcoAuditReopenAllowed } from './auditReopen.js';
import { deriveEcoAuditCommandLeaseToken } from './auditConcurrency.js';

test('reopen requires the exact fetched completed revision', () => {
  assert.doesNotThrow(() => assertEcoAuditReopenAllowed({ status: 'Completed', treeRevision: 8 }, 8));
  for (const [audit, expected, detail] of [
    [{ status: 'Completed', treeRevision: 9 }, 8, 'audit_tree_revision_changed'],
    [{ status: 'Draft', treeRevision: 8 }, 8, 'audit_reopen_requires_completed'],
  ] as const) assert.throws(() => assertEcoAuditReopenAllowed(audit, expected), (e: unknown) => e instanceof AppError && e.detail === detail);
});

test('reopen response recovery is deterministic and isolated from create/acquire operations', () => {
  const command = { auditId: 'audit', operation: 'reopen' as const, actorUserId: 'user', clientInstanceId: 'phone', idempotencyKey: randomUUID() };
  const first = deriveEcoAuditCommandLeaseToken('test-command-secret', command);
  assert.equal(deriveEcoAuditCommandLeaseToken('test-command-secret', command), first);
  for (const override of [{ operation: 'acquire' as const }, { clientInstanceId: 'other' }, { actorUserId: 'other' }, { idempotencyKey: randomUUID() }]) {
    assert.notEqual(deriveEcoAuditCommandLeaseToken('test-command-secret', { ...command, ...override }), first);
  }
});

test('reopen HTTP lifecycle preserves latest data/history, rejects races and recovers response loss', {
  skip: process.env.ECOAUDIT_REOPEN_DB_TESTS !== '1',
}, async () => {
  const [identity] = await sql`select current_database() as name`;
  assert.match(identity.name, /(?:test|restore)/, 'Requires an isolated test/restore database');
  const auditId = randomUUID(), userId = randomUUID(), otherId = randomUUID(), zoneId = randomUUID();
  const clientId = randomUUID();
  const app = Fastify();
  app.setErrorHandler((error: Error & { statusCode?: number; detail?: string }, _req, reply) => reply.status(error.statusCode ?? 500).send({ error: error.message, detail: error.detail }));
  await app.register(eaAuditRoutes, { prefix: '/v1/ecoaudit/audits' });
  const token = (id: string) => signAccessToken({ userId: id, app: 'ecoaudit', role: 'inspector' });
  const headers = { authorization: `Bearer ${token(userId)}`, 'x-ecoaudit-protocol-version': '2', 'x-ecoaudit-client-instance-id': clientId };
  const route = `/v1/ecoaudit/audits/${auditId}`;
  try {
    await sql`insert into ea_users (id,email,password_hash,role) values (${userId},${`reopen-test-${userId}@ecoaudit.users.local`},'non-login-test-fixture','inspector'),(${otherId},${`reopen-test-${otherId}@ecoaudit.users.local`},'non-login-test-fixture','inspector')`;
    await sql`insert into ea_audits (id,site_name,site_address,inspector_name,status,created_by_user_id,tree_revision,edit_fence,completed_at) values (${auditId},'Disposable Reopen Integration','Test fixture','Test inspector','Completed',${userId},8,4,now())`;
    await sql`insert into ea_zones (id,audit_id,zone_name) values (${zoneId},${auditId},'Latest cloud zone')`;
    const latest = await app.inject({ method: 'GET', url: route + '/tree', headers });
    assert.equal(latest.statusCode, 200); assert.equal(latest.json().zones[0].zoneName, 'Latest cloud zone');
    const body = { expectedTreeRevision: 8, clientInstanceId: clientId, clientKind: 'mobile', clientLabel: 'Test phone', idempotencyKey: randomUUID() };
    const denied = await app.inject({ method: 'PATCH', url: route + '/reopen', headers: { ...headers, authorization: `Bearer ${token(otherId)}` }, payload: body });
    assert.equal(denied.statusCode, 403);
    // Simulate an administrator changing the cloud after the phone fetched it.
    await sql`update ea_audits set tree_revision=9 where id=${auditId}`;
    await sql`update ea_zones set zone_name='Newer cloud evidence' where id=${zoneId}`;
    const stale = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: body });
    assert.equal(stale.statusCode, 409); assert.equal(stale.json().detail, 'audit_tree_revision_changed');
    body.expectedTreeRevision = 9;
    const reopened = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: body });
    assert.equal(reopened.statusCode, 200, reopened.body);
    const first = reopened.json(); assert.equal(first.audit.id, auditId); assert.equal(first.audit.status, 'Draft'); assert.equal(first.audit.completedAt, null);
    assert.equal(first.treeRevision, 10); assert.equal(first.editFence, 5); assert.equal(first.audit.recordVersionNumber, 1);
    const [zone] = await sql`select zone_name from ea_zones where id=${zoneId}`; assert.equal(zone.zone_name, 'Newer cloud evidence');
    const [version] = await sql`select snapshot from record_versions where entity_id=${auditId} and version_number=1`;
    assert.equal(version.snapshot.audit.status, 'Completed'); assert.equal(version.snapshot.zones[0].zoneName, 'Newer cloud evidence');
    const retry = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: body });
    assert.equal(retry.statusCode, 200); assert.equal(retry.json().leaseToken, first.leaseToken); assert.equal(retry.json().treeRevision, 10);
    const changedKey = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: { ...body, expectedTreeRevision: 10 } });
    assert.equal(changedKey.statusCode, 409); assert.equal(changedKey.json().detail, 'idempotency_key_reused');
    const secondEditor = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: { ...body, idempotencyKey: randomUUID(), clientInstanceId: randomUUID() } });
    assert.equal(secondEditor.statusCode, 409);
    const complete = await app.inject({ method: 'PATCH', url: route + '/complete', headers: { ...headers, 'x-ecoaudit-lease-token': first.leaseToken, 'x-ecoaudit-lease-fence': '5', 'x-ecoaudit-base-tree-revision': '10', 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(complete.statusCode, 200, complete.body); assert.equal(complete.json().audit.status, 'Completed');
    assert.equal(complete.json().audit.recordVersionNumber, 2);
    const lateRetry = await app.inject({ method: 'PATCH', url: route + '/reopen', headers, payload: body });
    assert.equal(lateRetry.statusCode, 409);
    const [final] = await sql`select status from ea_audits where id=${auditId}`; assert.equal(final.status, 'Completed');
    const [history] = await sql`select count(*)::int as n from record_versions where entity_id=${auditId}`; assert.equal(history.n, 2);
  } finally {
    await sql`update ea_audits set deleted_at=now() where id=${auditId}`;
    await sql`update ea_users set is_active=false where id in (${userId},${otherId})`;
    await app.close(); await closeDb();
  }
});
