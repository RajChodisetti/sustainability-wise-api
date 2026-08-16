import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  schedulerInvoicePdfJobParams,
  schedulerInvoicePdfReportVariantKey,
} from './schedulerInvoicePdfExport.js';

const invoice = {
  id: 'invoice-42',
  financeId: 'finance-9',
  invoiceNumber: 'INV-2026-0042',
  updatedAt: '2026-08-16T18:15:00.000Z',
  job: {
    jobName: 'Café rooftop upgrade',
    jobDate: '2026-08-15',
    clientName: 'Private Client',
    siteName: 'North Wing',
    siteAddress: 'Not persisted in export params',
    status: 'Scheduled',
    sourceApp: 'solarsense' as const,
    sourceType: 'assessment' as const,
    sourceId: 'assessment-7',
  },
};

test('scheduler invoice PDF params pin identity, revision, variant, and branded filename', () => {
  const params = schedulerInvoicePdfJobParams(invoice);
  assert.deepEqual(params, {
    artifactType: 'pdf',
    filename: 'invoice-Café-rooftop-upgrade-2026-08-15-INV-2026-0042.pdf',
    contentType: 'application/pdf',
    invoiceId: 'invoice-42',
    financeId: 'finance-9',
    sourceUpdatedAt: '2026-08-16T18:15:00.000Z',
    reportVariantKey: 'scheduler-invoice-pdf:v1:invoice-42:2026-08-16T18:15:00.000Z',
    rendererVersion: SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  });
  assert.equal('clientName' in params, false);
  assert.equal('siteAddress' in params, false);
});

test('invoice lifecycle mutations produce a new latest/dedupe variant', () => {
  const original = schedulerInvoicePdfReportVariantKey(invoice);
  const changed = schedulerInvoicePdfReportVariantKey({
    ...invoice,
    updatedAt: '2026-08-16T18:16:00.000Z',
  });
  assert.notEqual(changed, original);
  assert.equal(
    schedulerInvoicePdfReportVariantKey({ ...invoice }),
    original,
    'event and finance aliases derive the same version identity',
  );
});

test('invoice PDF provenance rejects blank identities', () => {
  assert.throws(
    () => schedulerInvoicePdfReportVariantKey({ id: ' ', updatedAt: invoice.updatedAt }),
    /invoice id and updatedAt are required/,
  );
});
