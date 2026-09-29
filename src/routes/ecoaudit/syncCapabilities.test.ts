import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { config } from '../../config.js';
import { eaSyncRoutes } from './sync.js';

test('sync capability preflight is authenticated, app-scoped and read-only', async () => {
  const app = Fastify();
  await app.register(eaSyncRoutes, { prefix: '/sync' });
  try {
    assert.equal((await app.inject('/sync/capabilities')).statusCode, 401);
    const otherApp = signAccessToken({ userId: 'inspector', app: 'solarsense', role: 'inspector' });
    assert.equal((await app.inject({ url: '/sync/capabilities', headers: { authorization: `Bearer ${otherApp}` } })).statusCode, 403);
    const token = signAccessToken({ userId: 'inspector', app: 'ecoaudit', role: 'inspector' });
    const response = await app.inject({ url: '/sync/capabilities', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), { auditProtocolVersion: 2, idempotentAuditRegistration: true, ready: Boolean(config.ecoauditCommandHmacSecret) });
    assert.equal(response.body.includes(config.ecoauditCommandHmacSecret!), false);
  } finally { await app.close(); }
});
