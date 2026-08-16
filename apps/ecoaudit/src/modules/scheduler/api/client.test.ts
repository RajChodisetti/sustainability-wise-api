import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadSchedulerInvoicePdfExport,
  getLatestSchedulerInvoicePdfExport,
  getSchedulerInvoicePdfExportStatus,
  issueSchedulerInvoice,
  startSchedulerInvoicePdfExport,
  updateSchedulerInvoice,
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
    reportVariantKey: 'scheduler-invoice-pdf:v1:invoice-42:2026-08-16T18:15:00.000Z',
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
    assert.match(latest?.url ?? '', /reportVariantKey=scheduler-invoice-pdf%3Av1%3Ainvoice-42/);
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
