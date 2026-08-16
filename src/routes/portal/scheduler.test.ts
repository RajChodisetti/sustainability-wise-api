import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { portalSchedulerRoutes } from './scheduler.js';

const validDispatch = {
  sourceApp: 'ecoaudit',
  assigneeFieldUserId: 'field-user',
  scheduledStartAt: '2026-08-20T09:00:00.000Z',
  deadlineAt: '2026-08-22T17:00:00.000Z',
  job: {
    siteName: 'Dispatch site',
    siteAddress: '1 Test Street',
  },
};

test('scheduler dispatch route is admin-only and rejects client-owned lifecycle fields', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();

  const url = '/v1/portal/scheduler/dispatches';
  try {
    assert.equal(app.hasRoute({ method: 'POST', url }), true);

    const unauthenticated = await app.inject({ method: 'POST', url, payload: validDispatch });
    assert.equal(unauthenticated.statusCode, 401);

    const inspector = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-inspector',
          app: 'ecoaudit',
          role: 'inspector',
        })}`,
      },
      payload: validDispatch,
    });
    assert.equal(inspector.statusCode, 403);

    const wrongApp = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'fleet-admin',
          app: 'wattwatchers',
          role: 'admin',
        })}`,
      },
      payload: validDispatch,
    });
    assert.equal(wrongApp.statusCode, 403);

    const adminToken = signAccessToken({
      userId: 'eco-admin',
      app: 'ecoaudit',
      role: 'admin',
    });
    const clientStatus = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { ...validDispatch, status: 'Completed' },
    });
    assert.equal(clientStatus.statusCode, 400);

    const clientJobStatus = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validDispatch,
        job: { ...validDispatch.job, status: 'Completed' },
      },
    });
    assert.equal(clientJobStatus.statusCode, 400);

    const clientOwner = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validDispatch,
        job: { ...validDispatch.job, createdByUserId: 'spoofed-owner' },
      },
    });
    assert.equal(clientOwner.statusCode, 400);

    const invalidAuditDate = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validDispatch,
        job: { ...validDispatch.job, auditDate: '2026-02-30' },
      },
    });
    assert.equal(invalidAuditDate.statusCode, 400, invalidAuditDate.body);

    const missingProductFields = [
      { sourceApp: 'ecoaudit', job: { siteName: 'Missing address' } },
      {
        sourceApp: 'solarsense',
        job: { siteName: 'Missing roof', location: 'Test location' },
      },
      {
        sourceApp: 'installhub',
        job: { siteName: 'Missing client', siteAddress: '5 Field Street' },
      },
    ];
    for (const invalid of missingProductFields) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { ...validDispatch, ...invalid },
      });
      assert.equal(response.statusCode, 400, response.body);
    }

    const legacySolarSiteLink = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/events',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceApp: 'solarsense',
        sourceType: 'site',
        sourceId: 'legacy-site-id',
        assigneeFieldUserId: 'field-user',
        scheduledStartAt: validDispatch.scheduledStartAt,
        deadlineAt: validDispatch.deadlineAt,
      },
    });
    assert.equal(legacySolarSiteLink.statusCode, 400);
  } finally {
    await app.close();
  }
});
