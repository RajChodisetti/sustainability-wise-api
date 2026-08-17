import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkConsolidatedSchedulerInvoiceEligibility,
  createConsolidatedSchedulerInvoice,
  downloadSchedulerInvoicePdfExport,
  fetchSchedulerInvoiceEmailDeliveries,
  fetchGlobalSchedulerExpenses,
  fetchGlobalSchedulerInvoices,
  getLatestSchedulerInvoicePdfExport,
  getSchedulerInvoicePdfExportStatus,
  issueSchedulerInvoice,
  markGlobalSchedulerInvoicePaid,
  sendSchedulerInvoiceEmail,
  startSchedulerInvoicePdfExport,
  updateSchedulerInvoice,
  uploadSchedulerExpenseAttachment,
  voidGlobalSchedulerInvoice,
} from './client';
import type { ExportJobStatus } from '@/types/domain';

function jwt(role: 'admin' | 'inspector', subject: string): string {
  const payload = Buffer.from(JSON.stringify({ role, sub: subject })).toString('base64url');
  return `header.${payload}.signature`;
}

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
    reportVariantKey: 'scheduler-invoice-pdf:v2:invoice-42:2026-08-16T18:15:00.000Z',
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
      notes: 'Current intent',
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
      notes: 'Current intent',
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
    assert.match(latest?.url ?? '', /reportVariantKey=scheduler-invoice-pdf%3Av2%3Ainvoice-42/);
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
