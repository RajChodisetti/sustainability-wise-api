import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { installhubInvoiceRoutes } from '../installhub/invoices.js';
import { portalSchedulerRoutes } from './scheduler.js';

test('scheduler invoice PDF routes are durable admin-only jobs for both route identities', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();

  const routes = [
    {
      template: '/v1/portal/scheduler/events/:id/invoices/:invoiceId/pdf/jobs',
      url: '/v1/portal/scheduler/events/event-1/invoices/invoice-1/pdf/jobs',
    },
    {
      template: '/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/pdf/jobs',
      url: '/v1/portal/scheduler/finance/finance-1/invoices/invoice-1/pdf/jobs',
    },
  ];
  const payload = { expectedUpdatedAt: '2026-08-16T12:00:00.000Z' };

  try {
    for (const { template, url } of routes) {
      assert.equal(app.hasRoute({ method: 'POST', url: template }), true, template);

      const unauthenticated = await app.inject({ method: 'POST', url, payload });
      assert.equal(unauthenticated.statusCode, 401, url);

      const nonAdmin = await app.inject({
        method: 'POST',
        url,
        headers: {
          authorization: `Bearer ${signAccessToken({
            userId: 'eco-inspector',
            app: 'ecoaudit',
            role: 'inspector',
          })}`,
        },
        payload,
      });
      assert.equal(nonAdmin.statusCode, 403, url);
    }
    assert.equal(app.hasRoute({
      method: 'GET',
      url: '/v1/portal/scheduler/events/:id/invoices/:invoiceId/pdf',
    }), false);
    assert.equal(app.hasRoute({
      method: 'GET',
      url: '/v1/portal/scheduler/finance/:financeId/invoices/:invoiceId/pdf',
    }), false);
  } finally {
    await app.close();
  }
});

test('legacy Field invoice PDF remains a direct authenticated download', async () => {
  const app = Fastify();
  await app.register(installhubInvoiceRoutes, { prefix: '/v1/installhub/installations' });
  await app.ready();

  const template = '/v1/installhub/installations/:installationId/invoices/:invoiceId/pdf';
  const url = '/v1/installhub/installations/installation-1/invoices/invoice-1/pdf';
  try {
    assert.equal(app.hasRoute({ method: 'GET', url: template }), true);
    const unauthenticated = await app.inject({ method: 'GET', url });
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    await app.close();
  }
});
