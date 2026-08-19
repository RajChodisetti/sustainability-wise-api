import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadBrandLogoDataUri } from '../pdf/brandLogo.js';
import {
  buildInvoiceContentDisposition,
  buildInvoiceDownloadFilename,
  buildInvoiceHtml,
  type InvoicePdfModel,
  type InvoiceSourceApp,
  type InvoiceSourceType,
} from './invoicePdf.js';

function modelFor(
  sourceApp: InvoiceSourceApp,
  sourceType: InvoiceSourceType,
): InvoicePdfModel {
  return {
    invoiceNumber: 'INV-2026-0007',
    status: 'issued',
    currency: 'AUD',
    issueDate: '2026-08-16T01:30:00.000Z',
    dueDate: '2026-08-30T01:30:00.000Z',
    notes: 'Thank you.\nPayment within 14 days.',
    purchaseOrderReference: 'PO-1007',
    gstRate: 0.1,
    subtotalExGst: 1250,
    gstAmount: 125,
    totalIncGst: 1375,
    seller: {
      name: 'Sustainability Wise',
      abn: '12 345 678 901',
      address: 'Level 1\nSydney NSW',
      email: 'billing@sustainabilitywise.example',
    },
    billTo: {
      name: 'Client & Co',
      abn: '98 765 432 109',
      address: '1 Main Street\nSydney NSW',
      email: 'accounts@client.example',
    },
    job: {
      jobName: 'North Roof Upgrade',
      jobDate: '2026-08-15',
      sourceApp,
      sourceType,
      sourceId: 'private-internal-source-id',
      clientName: 'Client & Co',
      siteName: 'North Warehouse',
      siteAddress: '1 Main Street',
    },
    lines: [{
      description: 'Site work',
      quantity: 2,
      unitAmountExGst: 625,
      lineTotalExGst: 1250,
    }],
  };
}

describe('invoice PDF branding and source context', () => {
  it('loads the canonical Sustainability Wise PNG as a data URI', async () => {
    const logo = await loadBrandLogoDataUri();
    assert.match(logo, /^data:image\/png;base64,/);
    assert.ok(logo.length > 1_000);
    assert.equal(await loadBrandLogoDataUri(), logo);
  });

  it('renders each supported job source through the same safe template', () => {
    const cases: Array<[InvoiceSourceApp, InvoiceSourceType, RegExp]> = [
      ['ecoaudit', 'audit', /EcoAudit Pro Audit/],
      ['solarsense', 'assessment', /SolarSense Assessment/],
      ['installhub', 'installation', /Field App Complete Installation/],
    ];
    for (const [sourceApp, sourceType, label] of cases) {
      const html = buildInvoiceHtml(modelFor(sourceApp, sourceType), {
        logoDataUri: 'data:image/png;base64,ZmFrZQ==',
      });
      assert.match(html, label);
      assert.match(html, /North Roof Upgrade/);
      assert.match(html, /15 Aug 2026/);
      assert.match(html, /class="brand-logo"/);
      assert.match(html, /ABN 98 765 432 109/);
      assert.match(html, /data-pdf-page-numbers|data-page-numbers="true"/);
      assert.doesNotMatch(html, /private-internal-source-id/);
    }
  });

  it('escapes untrusted invoice content and preserves note line breaks in CSS', () => {
    const model = modelFor('ecoaudit', 'audit');
    model.job.jobName = '<img src=x onerror=alert(1)>';
    model.lines[0].description = '<script>alert(1)</script>';
    const html = buildInvoiceHtml(model);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /white-space: pre-line/);
  });

  it('keeps internal hours and rates off the invoice unless explicitly enabled', () => {
    const amountOnly = modelFor('installhub', 'installation');
    const hiddenHtml = buildInvoiceHtml(amountOnly);
    assert.doesNotMatch(hiddenHtml, />Qty</);
    assert.doesNotMatch(hiddenHtml, /Unit \(ex GST\)/);
    assert.match(hiddenHtml, /<th colspan="2">/);
    assert.doesNotMatch(hiddenHtml, /<th colspan="4">/);

    amountOnly.lines[0]!.showQuantityAndRate = true;
    const detailedHtml = buildInvoiceHtml(amountOnly);
    assert.match(detailedHtml, />Qty</);
    assert.match(detailedHtml, /Unit \(ex GST\)/);
    assert.match(detailedHtml, />2</);
    assert.match(detailedHtml, /<th colspan="4">/);
  });

  it('leaves quantity and rate blank for amount-only rows in a mixed table', () => {
    const model = modelFor('solarsense', 'assessment');
    model.lines = [
      { ...model.lines[0]!, showQuantityAndRate: true },
      {
        description: 'Adjusted labour suggestion',
        quantity: 1,
        unitAmountExGst: 987.65,
        lineTotalExGst: 987.65,
      },
    ];
    const html = buildInvoiceHtml(model);
    assert.match(html, /Adjusted labour suggestion[\s\S]*?<td class="num"><\/td>[\s\S]*?<td class="num"><\/td>/);
  });

  it('groups a consolidated invoice by job with references and job subtotals', () => {
    const model = modelFor('ecoaudit', 'audit');
    model.subtotalExGst = 1850;
    model.gstAmount = 185;
    model.totalIncGst = 2035;
    model.jobs = [
      {
        financeId: 'finance-private-1',
        job: model.job,
        reference: 'EA-2041',
        subtotalExGst: 1250,
        lines: model.lines,
      },
      {
        financeId: 'finance-private-2',
        job: {
          ...model.job,
          jobName: 'South Plant Solar Assessment',
          jobDate: '2026-08-18',
          sourceApp: 'solarsense',
          sourceType: 'assessment',
          sourceId: 'private-assessment-id',
          siteName: 'South Plant',
        },
        reference: 'SS-8830',
        subtotalExGst: 600,
        lines: [{
          description: 'Solar assessment',
          quantity: 1,
          unitAmountExGst: 600,
          lineTotalExGst: 600,
        }],
      },
    ];

    const html = buildInvoiceHtml(model, {
      logoDataUri: 'data:image/png;base64,ZmFrZQ==',
    });
    assert.match(html, /2 jobs included/);
    assert.match(html, /Job 1 of 2/);
    assert.match(html, /North Roof Upgrade/);
    assert.match(html, /Reference: EA-2041/);
    assert.match(html, /Job 2 of 2/);
    assert.match(html, /South Plant Solar Assessment/);
    assert.match(html, /Reference: SS-8830/);
    assert.match(html, /Job subtotal \(ex GST\)/);
    assert.match(html, /Consolidated subtotal \(ex GST\)/);
    assert.match(html, /display: table-header-group/);
    assert.doesNotMatch(html, /finance-private|private-assessment-id/);
  });

  it('escapes grouped job names, references, and lines', () => {
    const model = modelFor('ecoaudit', 'audit');
    model.jobs = [{
      financeId: 'finance-1',
      job: { ...model.job, jobName: '<img src=x onerror=alert(1)>' },
      reference: '<script>bad()</script>',
      subtotalExGst: model.subtotalExGst,
      lines: [{ ...model.lines[0], description: '<b>untrusted</b>' }],
    }];
    const html = buildInvoiceHtml(model);
    assert.doesNotMatch(html, /<script>|<img src=x|<b>untrusted/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.match(html, /&lt;b&gt;untrusted&lt;\/b&gt;/);
  });
});

describe('invoice PDF download naming', () => {
  it('includes the job name, snapshotted job date, and invoice number', () => {
    assert.equal(buildInvoiceDownloadFilename({
      jobName: 'North Roof Upgrade',
      jobDate: '2026-08-15',
      invoiceNumber: 'INV-2026-0007',
    }), 'invoice-North-Roof-Upgrade-2026-08-15-INV-2026-0007.pdf');
  });

  it('uses the first job, job count, invoice date, and number for a consolidated invoice', () => {
    assert.equal(buildInvoiceDownloadFilename({
      jobName: 'North Roof Upgrade',
      jobDate: '2026-08-16',
      invoiceNumber: 'INV-2026-0007',
      additionalJobCount: 2,
    }), 'invoice-North-Roof-Upgrade-and-2-more-2026-08-16-INV-2026-0007.pdf');
  });

  it('emits an ASCII fallback and UTF-8 filename without header injection', () => {
    const filename = buildInvoiceDownloadFilename({
      jobName: 'Café / Solar\r\n"quote"',
      jobDate: '2026-08-15',
      invoiceNumber: '../INV:7',
    });
    assert.equal(filename, 'invoice-Café-Solar-quote-2026-08-15-INV-7.pdf');
    const disposition = buildInvoiceContentDisposition(filename);
    assert.equal(
      disposition,
      'attachment; filename="invoice-Cafe-Solar-quote-2026-08-15-INV-7.pdf"; '
        + "filename*=UTF-8''invoice-Caf%C3%A9-Solar-quote-2026-08-15-INV-7.pdf",
    );
    assert.doesNotMatch(disposition, /\r|\n/);
  });

  it('bounds long UTF-8 job names while retaining date and invoice identity', () => {
    const filename = buildInvoiceDownloadFilename({
      jobName: '屋根'.repeat(200),
      jobDate: '2026-08-15',
      invoiceNumber: 'INV-2026-0007',
    });
    assert.ok(Buffer.byteLength(filename, 'utf8') <= 180);
    assert.match(filename, /-2026-08-15-INV-2026-0007\.pdf$/);
    assert.doesNotThrow(() => buildInvoiceContentDisposition(filename));
  });

  it('keeps the ASCII fallback bounded without dropping its date and invoice tail', () => {
    const filename = buildInvoiceDownloadFilename({
      jobName: '½'.repeat(48),
      jobDate: '2026-08-15',
      invoiceNumber: 'INV-2026-0007',
    });
    const disposition = buildInvoiceContentDisposition(filename);
    const fallback = /filename="([^"]+)"/.exec(disposition)?.[1];
    assert.ok(fallback);
    assert.ok(Buffer.byteLength(fallback, 'ascii') <= 180);
    assert.match(fallback, /-2026-08-15-INV-2026-0007\.pdf$/);
  });

  it('rejects invalid calendar dates and unsafe direct disposition values', () => {
    assert.throws(() => buildInvoiceDownloadFilename({
      jobName: 'Roof',
      jobDate: '2026-02-30',
      invoiceNumber: 'INV-1',
    }), /jobDate must be a valid YYYY-MM-DD calendar date/);
    assert.throws(
      () => buildInvoiceContentDisposition('invoice.pdf\r\nX-Evil: true'),
      /safe PDF filename/,
    );
    assert.throws(() => buildInvoiceDownloadFilename({
      jobName: 'Roof',
      jobDate: '2026-02-28',
      invoiceNumber: 'INV-1',
      additionalJobCount: -1,
    }), /additionalJobCount/);
  });
});
