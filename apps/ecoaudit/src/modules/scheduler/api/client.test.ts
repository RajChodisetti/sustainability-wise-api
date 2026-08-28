import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkConsolidatedSchedulerInvoiceEligibility,
  completeSchedulerJob,
  createConsolidatedSchedulerInvoice,
  createSchedulerDispatch,
  createSchedulerInventoryMeter,
  downloadSchedulerInvoicePdfExport,
  fetchSchedulerAddressSuggestions,
  fetchSchedulerClientAddressSuggestions,
  fetchSchedulerClients,
  fetchSchedulerInvoiceEmailDeliveries,
  fetchSchedulerMeterRegister,
  fetchSchedulerAnalytics,
  fetchSchedulerRouteSuggestion,
  fetchPortalAssignees,
  fetchGlobalSchedulerExpenses,
  fetchGlobalSchedulerInvoices,
  getLatestSchedulerInvoicePdfExport,
  getSchedulerInvoicePdfExportStatus,
  issueSchedulerInvoice,
  markGlobalSchedulerInvoicePaid,
  updateSchedulerInvoiceSeller,
  updateSchedulerActorBillingRateOverride,
  sendSchedulerInvoiceEmail,
  startSchedulerInvoicePdfExport,
  updateSchedulerInvoice,
  updatePortalUserBillingRate,
  updatePortalUserWorkforceProfile,
  uploadSchedulerExpenseAttachment,
  voidGlobalSchedulerInvoice,
} from './client';
import type { ExportJobStatus } from '@/types/domain';

function jwt(role: 'admin' | 'inspector', subject: string): string {
  const payload = Buffer.from(JSON.stringify({ role, sub: subject })).toString('base64url');
  return `header.${payload}.signature`;
}

test('client memory and mixed address lookup stay on authenticated portal routes', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'scheduler-admin');
  const values = new Map<string, string>([['ea_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{
    url: string;
    method?: string;
    body: string;
    authorization: string | null;
  }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body ?? ''),
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    return String(input).includes('client-address-suggestions')
      ? Response.json({
          available: true,
          provider: 'geoapify',
          attribution: 'Geoapify',
          storedSuggestions: [],
          providerSuggestions: [],
          suggestions: [],
        })
      : Response.json({ companyScope: 'current', clients: [] });
  };

  try {
    await fetchSchedulerClients({ q: 'ABC Energy', limit: 20 });
    await fetchSchedulerClientAddressSuggestions({
      clientId: 'client-1',
      query: '10 George',
      limit: 8,
    });
    assert.equal(requests.length, 2);
    const directoryUrl = new URL(requests[0]?.url ?? '', 'http://portal.test');
    assert.equal(directoryUrl.pathname, '/v1/portal/scheduler/clients');
    assert.deepEqual(Object.fromEntries(directoryUrl.searchParams), {
      q: 'ABC Energy',
      limit: '20',
    });
    assert.equal(
      new URL(requests[1]?.url ?? '', 'http://portal.test').pathname,
      '/v1/portal/scheduler/client-address-suggestions',
    );
    assert.deepEqual(JSON.parse(requests[1]?.body ?? ''), {
      clientId: 'client-1',
      query: '10 George',
      limit: 8,
    });
    assert.equal(requests[0]?.authorization, `Bearer ${admin}`);
    assert.equal(requests[1]?.authorization, `Bearer ${admin}`);
    assert.equal(requests.some((request) => request.url.includes('apiKey=')), false);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Scheduler meter inventory lists non-installed stock and registers meter-only company stock', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'inventory-admin');
  const values = new Map<string, string>([['ih_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; method?: string; body: string }> = [];
  const meter = {
    inventoryMeterId: 'meter-1',
    deviceId: 'WW-001',
    deviceModel: 'OTHER' as const,
    customManufacturerName: 'Acme',
    customModelName: 'M100',
    notes: 'New stock',
    status: 'company' as const,
    custodianUserId: null,
    custodianName: null,
    custodianEmail: null,
    revision: 1,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body ?? ''),
    });
    return init?.method === 'POST'
      ? Response.json(meter, { status: 201 })
      : Response.json({ items: [meter], total: 1, truncated: false });
  };

  try {
    assert.equal((await fetchSchedulerMeterRegister('Acme & user')).total, 1);
    assert.equal((await createSchedulerInventoryMeter({
      deviceId: 'WW-001',
      deviceModel: 'OTHER',
      customManufacturerName: 'Acme',
      customModelName: 'M100',
      notes: 'New stock',
    })).status, 'company');

    const listUrl = new URL(requests[0]?.url ?? '', 'http://portal.test');
    assert.equal(listUrl.pathname, '/v1/portal/scheduler/meter-register');
    assert.equal(listUrl.searchParams.get('search'), 'Acme & user');
    assert.equal(requests[0]?.method, 'GET');
    assert.equal(requests[1]?.method, 'POST');
    assert.equal(new URL(requests[1]?.url ?? '', 'http://portal.test').pathname, '/v1/portal/scheduler/meter-register');
    assert.deepEqual(JSON.parse(requests[1]?.body ?? ''), {
      deviceId: 'WW-001',
      deviceModel: 'OTHER',
      customManufacturerName: 'Acme',
      customModelName: 'M100',
      notes: 'New stock',
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Scheduler completion client uses the cross-product admin endpoint and idempotency body', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'scheduler-admin');
  const values = new Map<string, string>([['ea_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{
    url: string;
    method?: string;
    body: string;
    authorization: string | null;
  }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body ?? ''),
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    return Response.json({ completed: true });
  };

  try {
    assert.deepEqual(await completeSchedulerJob({
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: 'field job/1',
      idempotencyKey: 'completion-attempt-1',
    }), { completed: true });
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.equal(
      new URL(request.url, 'http://portal.test').pathname,
      '/v1/portal/scheduler/jobs/installhub/installation/field%20job%2F1/complete',
    );
    assert.deepEqual(JSON.parse(request.body), {
      idempotencyKey: 'completion-attempt-1',
    });
    assert.equal(request.authorization, `Bearer ${admin}`);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('scheduler analytics preserves the inclusive window and selects an administrator credential', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const ecoInspector = jwt('inspector', 'eco-inspector');
  const solarAdmin = jwt('admin', 'solar-admin');
  const values = new Map<string, string>([
    ['ea_web_jwt', ecoInspector],
    ['ss_web_jwt', solarAdmin],
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    return Response.json({ complete: true });
  };

  try {
    await fetchSchedulerAnalytics({
      from: '2026-08-17',
      to: '2026-08-23',
      timezone: 'Australia/Sydney',
    });
    assert.equal(requests[0]?.authorization, `Bearer ${solarAdmin}`);
    const url = new URL(requests[0]?.url ?? '', 'http://portal.test');
    assert.equal(url.pathname, '/v1/portal/scheduler/analytics');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      from: '2026-08-17',
      to: '2026-08-23',
      timezone: 'Australia/Sydney',
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('address, route, and dispatch clients keep private job inputs in authenticated POST bodies', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const inspector = jwt('inspector', 'field-user');
  const admin = jwt('admin', 'scheduler-admin');
  const values = new Map<string, string>([
    ['ea_web_jwt', inspector],
    ['ss_web_jwt', admin],
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; authorization: string | null; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('Authorization'),
      body: String(init?.body ?? ''),
    });
    if (String(input).endsWith('/address-suggestions')) {
      return Response.json({ available: false, provider: null, attribution: null, suggestions: [] });
    }
    return Response.json({
      date: '2026-08-24',
      timezone: 'Australia/Sydney',
      assigneeFieldUserId: 'field-user',
      currentLocation: { latitude: -33.86, longitude: 151.21 },
      jobs: [],
      unroutableJobs: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      optimization: 'straight_line_distance',
      googleMapsUrl: null,
      warnings: [],
    });
  };

  try {
    await fetchSchedulerAddressSuggestions({ query: '10 George Street', limit: 8 });
    await fetchSchedulerRouteSuggestion({
      date: '2026-08-24',
      currentLocation: {
        latitude: -33.86,
        longitude: 151.21,
        accuracyMeters: 20,
        capturedAt: '2026-08-23T23:00:00.000Z',
      },
    });
    await createSchedulerDispatch({
      sourceApp: 'installhub',
      assigneeFieldUserId: 'field-user',
      scheduledStartAt: '2026-08-24T00:00:00.000Z',
      deadlineAt: '2026-08-26T07:00:00.000Z',
      job: {
        clientName: 'Delivery partner',
        customerName: 'Example Customer',
        siteName: 'North warehouse',
        siteAddress: '10 Example Street, Newcastle NSW 2300',
        electricityNmi: '41020000000',
        maas: null,
        serviceType: 'New installation',
        meteringSolutionType: 'Whole-site monitoring',
        plannedMeterType: '6-channel meter',
        siteContactName: 'Site contact',
        siteContactPhone: '0400 000 000',
        siteContactEmail: 'site@example.test',
        fergusJobNumber: 'FERGUS-42',
        quoteNumber: 'QUOTE-7',
        jobComments: 'Coordinate with facilities.',
        accessInformation: 'Report to reception.',
        warrantyDevice: false,
        monitoringInstalled: null,
        hardwareInstalled: true,
        solarCapacityKw: 24.5,
        additionalMonitoringRequired: false,
        additionalMonitoringHardware: 'None',
        auditDate: '2026-08-24',
        address: {
          freeform: '10 Example Street',
          locality: 'Newcastle',
          state: 'NSW',
          postcode: '2300',
          countryCode: 'AU',
        },
      },
    });
    assert.equal(requests.length, 3);
    assert.equal(new URL(requests[0]?.url ?? '', 'http://portal.test').search, '');
    assert.deepEqual(JSON.parse(requests[0]?.body ?? ''), {
      query: '10 George Street',
      limit: 8,
    });
    assert.deepEqual(JSON.parse(requests[1]?.body ?? ''), {
      date: '2026-08-24',
      currentLocation: {
        latitude: -33.86,
        longitude: 151.21,
        accuracyMeters: 20,
        capturedAt: '2026-08-23T23:00:00.000Z',
      },
    });
    assert.equal(requests[0]?.authorization, `Bearer ${inspector}`);
    assert.equal(requests[1]?.authorization, `Bearer ${inspector}`);
    assert.equal(requests[2]?.authorization, `Bearer ${admin}`);
    assert.equal(new URL(requests[2]?.url ?? '', 'http://portal.test').pathname, '/v1/portal/scheduler/dispatches');
    assert.deepEqual(JSON.parse(requests[2]?.body ?? ''), {
      sourceApp: 'installhub',
      assigneeFieldUserId: 'field-user',
      scheduledStartAt: '2026-08-24T00:00:00.000Z',
      deadlineAt: '2026-08-26T07:00:00.000Z',
      job: {
        clientName: 'Delivery partner',
        customerName: 'Example Customer',
        siteName: 'North warehouse',
        siteAddress: '10 Example Street, Newcastle NSW 2300',
        electricityNmi: '41020000000',
        maas: null,
        serviceType: 'New installation',
        meteringSolutionType: 'Whole-site monitoring',
        plannedMeterType: '6-channel meter',
        siteContactName: 'Site contact',
        siteContactPhone: '0400 000 000',
        siteContactEmail: 'site@example.test',
        fergusJobNumber: 'FERGUS-42',
        quoteNumber: 'QUOTE-7',
        jobComments: 'Coordinate with facilities.',
        accessInformation: 'Report to reception.',
        warrantyDevice: false,
        monitoringInstalled: null,
        hardwareInstalled: true,
        solarCapacityKw: 24.5,
        additionalMonitoringRequired: false,
        additionalMonitoringHardware: 'None',
        auditDate: '2026-08-24',
        address: {
          freeform: '10 Example Street',
          locality: 'Newcastle',
          state: 'NSW',
          postcode: '2300',
          countryCode: 'AU',
        },
      },
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('an explicit admin-planned route selects an administrator credential in mixed-role sessions', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const ecoInspector = jwt('inspector', 'eco-inspector');
  const solarAdmin = jwt('admin', 'solar-admin');
  const values = new Map<string, string>([
    ['ea_web_jwt', ecoInspector],
    ['ss_web_jwt', solarAdmin],
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  let authorization: string | null = null;
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get('Authorization');
    return Response.json({
      date: '2026-08-24',
      timezone: 'Australia/Perth',
      assigneeFieldUserId: 'field-user',
      currentLocation: { latitude: -31.95, longitude: 115.86 },
      jobs: [],
      unroutableJobs: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      optimization: 'straight_line_distance',
      googleMapsUrl: null,
      warnings: [],
    });
  };

  try {
    await fetchSchedulerRouteSuggestion({
      date: '2026-08-24',
      assigneeFieldUserId: 'field-user',
      currentLocation: { latitude: -31.95, longitude: 115.86 },
    });
    assert.equal(authorization, `Bearer ${solarAdmin}`);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('scheduler invoice export start/latest/status/download stay on one selected admin credential', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const ecoInspector = jwt('inspector', 'eco-inspector');
  const solarAdmin = jwt('admin', 'solar-admin');
  const fieldAdmin = jwt('admin', 'field-admin');
  const values = new Map<string, string>([
    ['ea_web_jwt', ecoInspector],
    ['ss_web_jwt', solarAdmin],
    ['ih_web_jwt', fieldAdmin],
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });

  const status: ExportJobStatus = {
    id: 'job-1',
    status: 'complete',
    phase: 'Ready to download',
    progressCurrent: null,
    progressTotal: null,
    pdfUrl: null,
    error: null,
    artifactType: 'pdf',
    filename: 'invoice-Café-job-2026-08-16-INV-42.pdf',
    contentType: 'application/pdf',
    recordVersionNumber: null,
    recordVersionPayloadHash: null,
    reportSource: null,
    detailMode: null,
    reportVariantKey: 'scheduler-invoice-pdf:v4:invoice-42:2026-08-16T18:15:00.000Z',
    createdAt: '2026-08-16T18:15:01.000Z',
    updatedAt: '2026-08-16T18:15:02.000Z',
  };
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    body: string | null;
  }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url.endsWith('/download')) {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }
    if (url.includes('/latest?')) {
      return Response.json({ job: status });
    }
    if (url.endsWith('/pdf/jobs')) {
      return Response.json({
        jobId: status.id,
        reused: false,
        sourceUpdatedAt: '2026-08-16T18:15:00.000Z',
        reportVariantKey: status.reportVariantKey,
      }, { status: 202 });
    }
    return Response.json(status);
  };

  try {
    await updateSchedulerInvoice('finance/9', 'invoice/42', {
      expectedUpdatedAt: '2026-08-16T18:15:00.000Z',
      xeroInvoiceNumber: 'XERO-9001',
      xeroDate: '2026-08-17',
      notes: 'Current intent',
      lines: [{
        id: 'line/1',
        financeId: 'finance/9',
        kind: 'labour',
        description: 'Adjusted labour charge',
        quantity: 1,
        unitAmountExGst: 425,
        showQuantityAndRate: false,
        expenseId: null,
      }],
    });
    await issueSchedulerInvoice(
      'finance/9',
      'invoice/42',
      '2026-08-16T18:15:00.000Z',
    );
    await startSchedulerInvoicePdfExport(
      'finance/9',
      'invoice/42',
      '2026-08-16T18:15:00.000Z',
    );
    await getLatestSchedulerInvoicePdfExport('invoice/42', status.reportVariantKey!);
    await getSchedulerInvoicePdfExportStatus(status.id);
    const blob = await downloadSchedulerInvoicePdfExport(status);

    assert.equal(blob.type, 'application/pdf');
    assert.equal(requests.length, 6);
    assert.deepEqual(new Set(requests.map((request) => request.authorization)), new Set([
      `Bearer ${solarAdmin}`,
    ]));
    const update = requests.find((request) => request.method === 'PATCH');
    assert.deepEqual(JSON.parse(update?.body ?? ''), {
      expectedUpdatedAt: '2026-08-16T18:15:00.000Z',
      xeroInvoiceNumber: 'XERO-9001',
      xeroDate: '2026-08-17',
      notes: 'Current intent',
      lines: [{
        id: 'line/1',
        financeId: 'finance/9',
        kind: 'labour',
        description: 'Adjusted labour charge',
        quantity: 1,
        unitAmountExGst: 425,
        showQuantityAndRate: false,
        expenseId: null,
      }],
    });
    const issue = requests.find((request) => request.url.endsWith('/issue'));
    assert.deepEqual(JSON.parse(issue?.body ?? ''), {
      expectedUpdatedAt: '2026-08-16T18:15:00.000Z',
    });
    const start = requests.find((request) => request.url.endsWith('/pdf/jobs'));
    assert.equal(start?.method, 'POST');
    assert.deepEqual(JSON.parse(start?.body ?? ''), {
      expectedUpdatedAt: '2026-08-16T18:15:00.000Z',
    });
    assert.match(start?.url ?? '', /\/scheduler\/finance\/finance%2F9\/invoices\/invoice%2F42\/pdf\/jobs$/);
    const latest = requests.find((request) => request.url.includes('/latest?'));
    assert.match(latest?.url ?? '', /\/v1\/export\/jobs\/latest\?.*entityId=invoice%2F42/);
    assert.match(latest?.url ?? '', /reportVariantKey=scheduler-invoice-pdf%3Av4%3Ainvoice-42/);
    assert.equal(requests.some((request) => /\/v1\/export\/jobs\/job-1$/.test(request.url)), true);
    assert.equal(requests.some((request) => request.url.endsWith('/job-1/download')), true);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('global finance clients preserve server filters, consolidated CAS, and raw private bill uploads', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'portfolio-admin');
  const values = new Map<string, string>([['ea_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: BodyInit | null | undefined;
  }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    if (url.endsWith('/attachments')) {
      return Response.json({
        id: 'attachment-1',
        expenseId: 'expense/1',
        filename: 'supplier bill.pdf',
        contentType: 'application/pdf',
        sizeBytes: 16,
        sha256: 'a'.repeat(64),
        createdAt: '2026-08-16T00:00:00.000Z',
        downloadUrl: '/private',
      }, { status: 201 });
    }
    if (url.endsWith('/eligibility')) {
      return Response.json({ eligible: true, commonCurrency: 'AUD', gstRate: 0.1, requiresExplicitBillTo: false, issues: [], jobs: [] });
    }
    if (url.endsWith('/quick')) {
      return Response.json({ id: 'invoice-1', financeId: 'finance-1', financeIds: ['finance-1', 'finance-2'] }, { status: 201 });
    }
    if (url.endsWith('/void') || url.endsWith('/mark-paid')) {
      return Response.json({ id: 'invoice-1', financeId: 'finance-1', financeIds: ['finance-1', 'finance-2'] });
    }
    if (url.endsWith('/email-deliveries')) {
      return Response.json({ items: [] });
    }
    if (url.endsWith('/email')) {
      return Response.json({
        delivery: {
          id: 'delivery-1',
          invoiceId: 'invoice/1',
          status: 'queued',
        },
        reused: false,
      }, { status: 202 });
    }
    return Response.json({ items: [], nextCursor: null });
  };

  try {
    await fetchGlobalSchedulerInvoices({
      limit: 100,
      status: 'issued',
      sourceApp: 'solarsense',
      search: 'Acme roof',
    });
    await fetchGlobalSchedulerExpenses({
      limit: 100,
      kind: 'supplier_bill',
      sourceApp: 'installhub',
      search: 'Cable Co',
    });
    await checkConsolidatedSchedulerInvoiceEligibility(['finance-1', 'finance-2']);
    await createConsolidatedSchedulerInvoice({
      jobs: [
        { financeId: 'finance-1', includeLabour: true, expenseIds: ['expense-1'] },
        { financeId: 'finance-2', includeLabour: false, expenseIds: ['expense-2'] },
      ],
      billTo: { name: 'Acme Pty Ltd', abn: '11 222 333 444' },
    });
    await voidGlobalSchedulerInvoice('invoice/1', '2026-08-16T01:00:00.000Z');
    await markGlobalSchedulerInvoicePaid('invoice/1', '2026-08-16T02:00:00.000Z');
    await updateSchedulerInvoiceSeller(
      'invoice/1',
      '12 345 678 901',
      '2026-08-16T02:00:00.000Z',
    );
    await fetchSchedulerInvoiceEmailDeliveries('invoice/1');
    await sendSchedulerInvoiceEmail('invoice/1', {
      expectedUpdatedAt: '2026-08-16T02:00:00.000Z',
      idempotencyKey: 'email-request-1',
      to: 'accounts@example.test',
      subject: 'Invoice INV-1',
      message: 'Please find the invoice attached.',
    });
    const file = Object.assign(
      new Blob(['%PDF-1.7\ncontent'], { type: 'application/pdf' }),
      { name: 'supplier bill.pdf', lastModified: 0 },
    ) as File;
    await uploadSchedulerExpenseAttachment('expense/1', file);

    const invoiceList = requests.find((request) => request.url.includes('/scheduler/invoices?'));
    assert.match(invoiceList?.url ?? '', /status=issued/);
    assert.match(invoiceList?.url ?? '', /sourceApp=solarsense/);
    assert.match(invoiceList?.url ?? '', /search=Acme\+roof/);
    const expenseList = requests.find((request) => request.url.includes('/scheduler/expenses?'));
    assert.match(expenseList?.url ?? '', /kind=supplier_bill/);
    assert.match(expenseList?.url ?? '', /sourceApp=installhub/);
    assert.match(expenseList?.url ?? '', /search=Cable\+Co/);
    const eligibility = requests.find((request) => request.url.endsWith('/eligibility'));
    assert.deepEqual(JSON.parse(String(eligibility?.body)), { financeIds: ['finance-1', 'finance-2'] });
    const quick = requests.find((request) => request.url.endsWith('/quick'));
    assert.equal(JSON.parse(String(quick?.body)).jobs.length, 2);
    const voidRequest = requests.find((request) => request.url.endsWith('/void'));
    assert.deepEqual(JSON.parse(String(voidRequest?.body)), { expectedUpdatedAt: '2026-08-16T01:00:00.000Z' });
    const paidRequest = requests.find((request) => request.url.endsWith('/mark-paid'));
    assert.deepEqual(JSON.parse(String(paidRequest?.body)), { expectedUpdatedAt: '2026-08-16T02:00:00.000Z' });
    const sellerRequest = requests.find((request) => request.url.endsWith('/seller'));
    assert.equal(sellerRequest?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(sellerRequest?.body)), {
      sellerAbn: '12 345 678 901',
      expectedUpdatedAt: '2026-08-16T02:00:00.000Z',
    });
    const emailHistory = requests.find((request) => request.url.endsWith('/email-deliveries'));
    assert.equal(emailHistory?.method, 'GET');
    assert.equal(emailHistory?.headers.get('Authorization'), `Bearer ${admin}`);
    const emailRequest = requests.find((request) => request.url.endsWith('/email'));
    assert.equal(emailRequest?.method, 'POST');
    assert.deepEqual(JSON.parse(String(emailRequest?.body)), {
      expectedUpdatedAt: '2026-08-16T02:00:00.000Z',
      idempotencyKey: 'email-request-1',
      to: 'accounts@example.test',
      subject: 'Invoice INV-1',
      message: 'Please find the invoice attached.',
    });
    const upload = requests.find((request) => request.url.endsWith('/attachments'));
    assert.equal(upload?.headers.get('Authorization'), `Bearer ${admin}`);
    assert.equal(upload?.headers.get('Content-Type'), 'application/octet-stream');
    assert.equal(upload?.headers.get('x-file-content-type'), 'application/pdf');
    assert.equal(upload?.headers.get('x-file-name'), 'supplier bill.pdf');
    assert.equal(upload?.body, file);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('portal assignees retain canonical user ids and billing-rate updates use that identity', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'directory-admin');
  const values = new Map<string, string>([['ea_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : null;
    requests.push({ url, method, body });
    if (method === 'PATCH' && url.endsWith('/billing-rate')) {
      return Response.json({ globalUserId: 'global/user 1', billingRate: 185.5 });
    }
    if (method === 'PATCH' && url.endsWith('/workforce-profile')) {
      return Response.json({
        globalUserId: 'global/user 1',
        timezone: 'Australia/Brisbane',
        workingDaysMask: 30,
        updatedAt: '2026-08-21T02:00:00.000Z',
      });
    }
    return Response.json({
      data: [{
        key: 'global/user 1',
        fullName: 'Alex Auditor',
        displayEmail: 'alex@example.test',
        billingRate: 175,
        timezone: 'Australia/Sydney',
        workingDaysMask: 62,
        updatedAt: '2026-08-21T01:00:00.000Z',
        memberships: [{
          app: 'ecoaudit',
          userId: 'eco-1',
          fieldUserId: 'field-1',
          role: 'admin',
          isActive: true,
        }],
      }],
    });
  };

  try {
    const users = await fetchPortalAssignees();
    assert.equal(users[0]?.key, 'global/user 1');
    assert.equal(users[0]?.billingRate, 175);
    assert.equal(users[0]?.timezone, 'Australia/Sydney');
    assert.equal(users[0]?.workingDaysMask, 62);

    const updated = await updatePortalUserBillingRate(users[0]!.key, 185.5);
    assert.deepEqual(updated, { globalUserId: 'global/user 1', billingRate: 185.5 });
    const billingPatch = requests.find((request) => request.url.endsWith('/billing-rate'));
    assert.match(billingPatch?.url ?? '', /\/v1\/portal\/users\/global%2Fuser%201\/billing-rate$/);
    assert.deepEqual(JSON.parse(billingPatch?.body ?? ''), { billingRate: 185.5 });

    const workforce = await updatePortalUserWorkforceProfile(users[0]!.key, {
      timezone: 'Australia/Brisbane',
      workingDaysMask: 30,
      expectedUpdatedAt: users[0]!.updatedAt,
    });
    assert.equal(workforce.updatedAt, '2026-08-21T02:00:00.000Z');
    const workforcePatch = requests.find((request) => request.url.endsWith('/workforce-profile'));
    assert.match(workforcePatch?.url ?? '', /\/v1\/portal\/users\/global%2Fuser%201\/workforce-profile$/);
    assert.deepEqual(JSON.parse(workforcePatch?.body ?? ''), {
      timezone: 'Australia/Brisbane',
      workingDaysMask: 30,
      expectedUpdatedAt: '2026-08-21T01:00:00.000Z',
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('job actor billing-rate overrides encode both identities and send only the override field', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  const admin = jwt('admin', 'finance-admin');
  const values = new Map<string, string>([['ea_web_jwt', admin]]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Response.json({ financeId: 'finance/id 1' });
  };

  try {
    await updateSchedulerActorBillingRateOverride('finance/id 1', 'global/user 1', 212.75);
    await updateSchedulerActorBillingRateOverride('finance/id 1', 'global/user 1', null);

    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, 'PATCH');
      assert.match(
        request.url,
        /\/v1\/portal\/scheduler\/finance\/finance%2Fid%201\/actors\/global%2Fuser%201\/billing-rate$/,
      );
    }
    assert.deepEqual(JSON.parse(requests[0]?.body ?? ''), { billingRateOverride: 212.75 });
    assert.deepEqual(JSON.parse(requests[1]?.body ?? ''), { billingRateOverride: null });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
