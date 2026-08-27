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

test('Scheduler meter register route is admin-only and bounds search input', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();
  const url = '/v1/portal/scheduler/meter-register';
  try {
    assert.equal(app.hasRoute({ method: 'GET', url }), true);
    const unauthenticated = await app.inject({ method: 'GET', url });
    assert.equal(unauthenticated.statusCode, 401);

    const inspector = await app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-inspector',
          app: 'ecoaudit',
          role: 'inspector',
        })}`,
      },
    });
    assert.equal(inspector.statusCode, 403, inspector.body);

    const wrongApp = await app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'fleet-admin',
          app: 'wattwatchers',
          role: 'admin',
        })}`,
      },
    });
    assert.equal(wrongApp.statusCode, 403, wrongApp.body);

    const oversizedSearch = await app.inject({
      method: 'GET',
      url: `${url}?search=${'x'.repeat(201)}`,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-admin',
          app: 'ecoaudit',
          role: 'admin',
        })}`,
      },
    });
    assert.equal(oversizedSearch.statusCode, 400, oversizedSearch.body);
  } finally {
    await app.close();
  }
});

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

    const deprecatedNonNullEnd = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validDispatch,
        scheduledEndAt: '2026-08-20T11:00:00.000Z',
        job: { ...validDispatch.job, status: 'Completed' },
      },
    });
    assert.equal(deprecatedNonNullEnd.statusCode, 400, deprecatedNonNullEnd.body);
    assert.deepEqual(deprecatedNonNullEnd.json(), clientJobStatus.json());

    const toleratedLegacyNullEnd = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validDispatch,
        scheduledEndAt: null,
        job: { ...validDispatch.job, status: 'Completed' },
      },
    });
    assert.equal(toleratedLegacyNullEnd.statusCode, 400, toleratedLegacyNullEnd.body);
    assert.deepEqual(toleratedLegacyNullEnd.json(), clientJobStatus.json());

    for (const estimatedDurationMinutes of [0, 1.5, 10081]) {
      const invalidEstimate = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { ...validDispatch, estimatedDurationMinutes },
      });
      assert.equal(invalidEstimate.statusCode, 400, invalidEstimate.body);
    }

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

    const legacySolarSiteLinkWithDeprecatedEnd = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/events',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceApp: 'solarsense',
        sourceType: 'site',
        sourceId: 'legacy-site-id',
        assigneeFieldUserId: 'field-user',
        scheduledStartAt: validDispatch.scheduledStartAt,
        scheduledEndAt: '2026-08-20T11:00:00.000Z',
        deadlineAt: validDispatch.deadlineAt,
      },
    });
    assert.equal(legacySolarSiteLinkWithDeprecatedEnd.statusCode, 400);
    assert.deepEqual(legacySolarSiteLinkWithDeprecatedEnd.json(), legacySolarSiteLink.json());
  } finally {
    await app.close();
  }
});

test('Scheduler map routes are authenticated, Australia-bound, and safely unavailable by default', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();

  const addressUrl = '/v1/portal/scheduler/address-suggestions';
  const routeUrl = '/v1/portal/scheduler/route-suggestions';
  try {
    assert.equal(app.hasRoute({ method: 'POST', url: addressUrl }), true);
    assert.equal(app.hasRoute({ method: 'POST', url: routeUrl }), true);
    assert.equal((await app.inject({
      method: 'POST',
      url: addressUrl,
      payload: { query: '10 George Street' },
    })).statusCode, 401);

    const fleetToken = signAccessToken({
      userId: 'fleet-admin',
      app: 'wattwatchers',
      role: 'admin',
    });
    assert.equal((await app.inject({
      method: 'POST',
      url: addressUrl,
      headers: { authorization: `Bearer ${fleetToken}` },
      payload: { query: '10 George Street' },
    })).statusCode, 403);

    const adminToken = signAccessToken({
      userId: 'eco-admin',
      app: 'ecoaudit',
      role: 'admin',
    });
    const unavailable = await app.inject({
      method: 'POST',
      url: addressUrl,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { postcode: '2000' },
    });
    assert.equal(unavailable.statusCode, 200, unavailable.body);
    assert.deepEqual(unavailable.json(), {
      available: false,
      provider: null,
      attribution: null,
      suggestions: [],
    });

    const outsideAustralia = await app.inject({
      method: 'POST',
      url: routeUrl,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        date: '2026-08-22',
        currentLocation: { latitude: 51.5072, longitude: -0.1276 },
      },
    });
    assert.equal(outsideAustralia.statusCode, 400, outsideAustralia.body);
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
    { method: 'GET', url: '/v1/portal/scheduler/invoices/:invoiceId/refunds' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/refunds' },
    { method: 'POST', url: '/v1/portal/scheduler/invoices/:invoiceId/refunds/:refundId/void' },
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

    const inspectorRefund = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/invoices/invoice-1/refunds',
      headers: { authorization: `Bearer ${inspectorToken}` },
      payload: {
        idempotencyKey: 'inspector-refund',
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        amountExGst: 10,
        gstAmount: 1,
        reason: 'Must not post',
      },
    });
    assert.equal(inspectorRefund.statusCode, 403, inspectorRefund.body);

    const malformedRefund = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/invoices/invoice-1/refunds',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        idempotencyKey: 'bad-refund',
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        amountExGst: -1,
        gstAmount: 0,
        reason: '',
      },
    });
    assert.equal(malformedRefund.statusCode, 400, malformedRefund.body);

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

    const missingXeroCas = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/scheduler/invoices/invoice-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { xeroInvoiceNumber: 'INV-1001' },
    });
    assert.equal(missingXeroCas.statusCode, 400, missingXeroCas.body);

    const malformedXeroDate = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/scheduler/invoices/invoice-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        xeroDate: '16/08/2026',
      },
    });
    assert.equal(malformedXeroDate.statusCode, 400, malformedXeroDate.body);

    const oversizedXeroNumber = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/scheduler/invoices/invoice-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
        xeroInvoiceNumber: 'X'.repeat(101),
      },
    });
    assert.equal(oversizedXeroNumber.statusCode, 400, oversizedXeroNumber.body);
  } finally {
    await app.close();
  }
});

test('Scheduler leave routes preserve self-service, admin review, and strict payload gates', async () => {
  const app = Fastify();
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
  try {
    for (const route of [
      { method: 'GET' as const, url: '/v1/portal/scheduler/leave-requests' },
      { method: 'POST' as const, url: '/v1/portal/scheduler/leave-requests' },
      { method: 'POST' as const, url: '/v1/portal/scheduler/leave-requests/:id/decision' },
      { method: 'POST' as const, url: '/v1/portal/scheduler/leave-requests/:id/cancel' },
    ]) {
      assert.equal(app.hasRoute(route), true, `${route.method} ${route.url}`);
    }

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/leave-requests',
      payload: {
        leaveType: 'annual',
        startDate: '2026-08-24',
        endDate: '2026-08-25',
      },
    });
    assert.equal(unauthenticated.statusCode, 401);

    const inspectorDecision = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/leave-requests/leave-1/decision',
      headers: { authorization: `Bearer ${inspectorToken}` },
      payload: {
        decision: 'approve',
        expectedUpdatedAt: '2026-08-21T12:00:00.000Z',
      },
    });
    assert.equal(inspectorDecision.statusCode, 403, inspectorDecision.body);

    const invalidDates = await app.inject({
      method: 'POST',
      url: '/v1/portal/scheduler/leave-requests',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        leaveType: 'annual',
        startDate: '21/08/2026',
        endDate: '2026-08-25',
      },
    });
    assert.equal(invalidDates.statusCode, 400, invalidDates.body);

    const invalidStatus = await app.inject({
      method: 'GET',
      url: '/v1/portal/scheduler/leave-requests?status=secret',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(invalidStatus.statusCode, 400, invalidStatus.body);
  } finally {
    await app.close();
  }
});

test('Scheduler analytics route is admin-only and requires a strict date window', async () => {
  const app = Fastify();
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
  const url = '/v1/portal/scheduler/analytics';
  try {
    assert.equal(app.hasRoute({ method: 'GET', url }), true);

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `${url}?from=2026-08-17&to=2026-08-23`,
    });
    assert.equal(unauthenticated.statusCode, 401);

    const inspector = await app.inject({
      method: 'GET',
      url: `${url}?from=2026-08-17&to=2026-08-23`,
      headers: { authorization: `Bearer ${inspectorToken}` },
    });
    assert.equal(inspector.statusCode, 403, inspector.body);

    for (const invalidUrl of [
      url,
      `${url}?from=17-08-2026&to=2026-08-23`,
      `${url}?from=2026-08-17&to=2026-08-23&timezone=${'x'.repeat(101)}`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: invalidUrl,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(response.statusCode, 400, `${invalidUrl}: ${response.body}`);
    }
  } finally {
    await app.close();
  }
});
