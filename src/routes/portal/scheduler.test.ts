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

test('Scheduler finance routes reject fractional billable-hour overrides at the API boundary', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/portal/scheduler/finance/test-finance-id',
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-admin',
          app: 'ecoaudit',
          role: 'admin',
        })}`,
      },
      payload: {
        billableHoursOverride: 1.25,
        costHoursOverride: 1.25,
        overrideReason: 'Fractional billable value',
      },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.body, /billableHoursOverride/);
    assert.match(response.body, /integer/);
  } finally {
    await app.close();
  }
});

test('global Scheduler finance routes are admin-only, CAS-bound, and parse private PDF uploads', async () => {
  const app = Fastify();
  app.addContentTypeParser(
    'application/pdf',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();
  const inspectorToken = signAccessToken({
    userId: 'eco-inspector',
    app: 'ecoaudit',
    role: 'inspector',
  });
  const adminToken = signAccessToken({
    userId: 'eco-admin',
    app: 'ecoaudit',
    role: 'admin',
  });
  const routeTemplates: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
    { method: 'GET', url: '/v1/portal/scheduler/finance/portfolio-summary' },
    { method: 'GET', url: '/v1/portal/scheduler/invoices' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/eligibility' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/quick' },
    { method: 'GET', url: '/v1/portal/scheduler/invoices/:invoiceId' },
    { method: 'PATCH', url: '/v1/portal/scheduler/invoices/:invoiceId' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/issue' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/void' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/mark-paid' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/pdf/jobs' },
    { method: 'GET', url: '/v1/portal/scheduler/invoices/:invoiceId/email-deliveries' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/email' },
    { method: 'GET', url: '/v1/portal/scheduler/expenses' },
    { method: 'POST', url: '/v1/portal/scheduler/expenses/:expenseId/attachments' },
    {
      method: 'GET',
      url: '/v1/portal/scheduler/expenses/:expenseId/attachments/:attachmentId/download',
    },
    {
      method: 'DELETE',
      url: '/v1/portal/scheduler/expenses/:expenseId/attachments/:attachmentId',
    },
  ];
  try {
    for (const route of routeTemplates) {
      assert.equal(app.hasRoute(route), true, `${route.method} ${route.url}`);
    }

    const invoiceList = await app.inject({
      method: 'GET',
      url: '/v1/portal/scheduler/invoices',
      headers: { authorization: `Bearer ${inspectorToken}` },
    });
    assert.equal(invoiceList.statusCode, 403);

    const pdfUpload = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/expenses/expense-1/attachments',
      headers: {
        authorization: `Bearer ${inspectorToken}`,
        'content-type': 'application/pdf',
        'x-file-name': 'supplier-bill.pdf',
      },
      payload: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    assert.equal(pdfUpload.statusCode, 403, pdfUpload.body);

    for (const suffix of ['issue', 'void', 'mark-paid', 'pdf/jobs']) {
      const missingCas = await app.inject({
        method: 'POST',
        url: `/v1/portal/scheduler/invoices/invoice-1/${suffix}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      assert.equal(missingCas.statusCode, 400, `${suffix}: ${missingCas.body}`);
    }

    const missingEmailIdempotency = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/invoices/invoice-1/email',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expectedUpdatedAt: '2026-08-16T12:00:00.000Z' },
    });
    assert.equal(missingEmailIdempotency.statusCode, 400, missingEmailIdempotency.body);

    const inspectorEmail = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/invoices/invoice-1/email',
      headers: { authorization: `Bearer ${inspectorToken}` },
      payload: {
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        idempotencyKey: 'inspector-must-not-send',
      },
    });
    assert.equal(inspectorEmail.statusCode, 403, inspectorEmail.body);

    const inspectorEmailHistory = await app.inject({
      method: 'GET',
      url: '/v1/portal/scheduler/invoices/invoice-1/email-deliveries',
      headers: { authorization: `Bearer ${inspectorToken}` },
    });
    assert.equal(inspectorEmailHistory.statusCode, 403, inspectorEmailHistory.body);

    const malformedLineEdit = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/scheduler/invoices/invoice-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        lines: [{
          kind: 'other',
          description: '',
          quantity: 0,
          unitAmountExGst: 10,
        }],
      },
    });
    assert.equal(malformedLineEdit.statusCode, 400, malformedLineEdit.body);
  } finally {
    await app.close();
  }
});
