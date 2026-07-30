import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { eaAuditRoutes } from './audits.js';

test('reopen is an authenticated EcoAudit inspector route', async () => {
  const app = Fastify();
  await app.register(eaAuditRoutes, { prefix: '/audits' });
  await app.ready();

  try {
    assert.equal(app.hasRoute({
      method: 'PATCH',
      url: '/audits/:id/reopen',
    }), true);

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
  } finally {
    await app.close();
  }
});
