import { loadBrandLogoDataUri } from '../pdf/brandLogo.js';
import { renderPdf } from '../pdf/renderer.js';

export type InvoiceSourceApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type InvoiceSourceType = 'audit' | 'assessment' | 'installation';

export type InvoicePdfLine = {
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  /** Customer-facing quantity/rate columns are opt-in for this line. */
  showQuantityAndRate?: boolean;
};

export type InvoicePdfJob = {
  jobName: string;
  /** Calendar date captured with the invoice as YYYY-MM-DD. */
  jobDate: string;
  sourceApp: InvoiceSourceApp;
  sourceType: InvoiceSourceType;
  sourceId: string;
  clientName: string | null;
  siteName: string | null;
  siteAddress: string | null;
};

export type InvoicePdfJobGroup = {
  /** Internal grouping key. It is never rendered into the customer PDF. */
  financeId: string;
  job: InvoicePdfJob;
  reference: string | null;
  subtotalExGst: number;
  lines: InvoicePdfLine[];
};

export type InvoicePdfModel = {
  invoiceNumber: string;
  status: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  paidAt?: string | null;
  notes: string | null;
  purchaseOrderReference?: string | null;
  gstRate: number;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  seller: {
    name: string;
    abn: string | null;
    address: string | null;
    email: string | null;
  };
  billTo?: {
    name: string | null;
    abn?: string | null;
    address: string | null;
    email: string | null;
  };
  /**
   * Immutable per-job invoice snapshots. Older one-job invoices do not have
   * this field and continue to render from `job` and `lines` below.
   */
  jobs?: InvoicePdfJobGroup[];
  job: InvoicePdfJob;
  lines: InvoicePdfLine[];
};

export type InvoicePdfOutput = {
  filename: string;
  contentDisposition: string;
  buffer: Buffer;
};

const MAX_JOB_FILENAME_BYTES = 96;
const MAX_INVOICE_NUMBER_FILENAME_BYTES = 48;
const MAX_DOWNLOAD_FILENAME_BYTES = 180;

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency || 'AUD',
    }).format(amount);
  } catch {
    return `${currency || 'AUD'} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const calendarDate = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(iso)?.[1];
  const d = calendarDate
    ? new Date(`${calendarDate}T00:00:00.000Z`)
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function sourceProductLabel(sourceApp: InvoiceSourceApp): string {
  if (sourceApp === 'ecoaudit') return 'EcoAudit Pro';
  if (sourceApp === 'solarsense') return 'SolarSense';
  return 'Field App Complete';
}

function sourceTypeLabel(sourceType: InvoiceSourceType): string {
  return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
}

function safeFilenameSegment(value: string, fallback: string): string {
  const safe = value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return safe || fallback;
}

function truncateUtf8Segment(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result.replace(/^[-_.]+|[-_.]+$/g, '');
}

function assertJobDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError('jobDate must be a valid YYYY-MM-DD calendar date');
  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError('jobDate must be a valid YYYY-MM-DD calendar date');
  }
  return value;
}

/**
 * Produce a bounded, path-safe UTF-8 name while retaining the job, date, and
 * invoice identity requested by the user.
 */
export function buildInvoiceDownloadFilename(input: {
  jobName: string;
  jobDate: string;
  invoiceNumber: string;
  additionalJobCount?: number;
}): string {
  const jobDate = assertJobDate(input.jobDate.trim());
  const initialJobName = truncateUtf8Segment(
    safeFilenameSegment(input.jobName.trim(), 'job'),
    MAX_JOB_FILENAME_BYTES,
  ) || 'job';
  const invoiceNumber = truncateUtf8Segment(
    safeFilenameSegment(input.invoiceNumber.trim(), 'invoice'),
    MAX_INVOICE_NUMBER_FILENAME_BYTES,
  ) || 'invoice';
  const additionalJobCount = input.additionalJobCount ?? 0;
  if (!Number.isSafeInteger(additionalJobCount) || additionalJobCount < 0) {
    throw new TypeError('additionalJobCount must be a non-negative safe integer');
  }
  const jobCountMarker = additionalJobCount > 0
    ? `-and-${additionalJobCount}-more`
    : '';
  const fixedTail = `${jobCountMarker}-${jobDate}-${invoiceNumber}.pdf`;
  const jobNameBudget = MAX_DOWNLOAD_FILENAME_BYTES
    - Buffer.byteLength('invoice-', 'utf8')
    - Buffer.byteLength(fixedTail, 'utf8');
  if (jobNameBudget < 1) {
    throw new Error('Invoice identity leaves no room for a safe filename');
  }
  const jobName = truncateUtf8Segment(initialJobName, jobNameBudget) || 'job';
  const filename = `invoice-${jobName}${fixedTail}`;
  if (Buffer.byteLength(filename, 'utf8') > MAX_DOWNLOAD_FILENAME_BYTES) {
    throw new Error('Generated invoice filename exceeds the safe byte limit');
  }
  return filename;
}

function asciiFilenameFallback(filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  const extension = '.pdf';
  let stem = ascii.toLowerCase().endsWith(extension)
    ? ascii.slice(0, -extension.length)
    : ascii;
  stem = stem.replace(/^[-_.]+|[-_.]+$/g, '') || 'invoice';

  const stemBudget = MAX_DOWNLOAD_FILENAME_BYTES - extension.length;
  if (stem.length > stemBudget) {
    // Unicode compatibility decomposition can expand an otherwise bounded
    // UTF-8 name. Retain both its human job prefix and its date/invoice tail.
    const tailBudget = Math.min(72, Math.floor(stemBudget / 2));
    const headBudget = stemBudget - tailBudget - 1;
    const head = stem.slice(0, headBudget).replace(/[-_.]+$/g, '');
    const tail = stem.slice(-tailBudget).replace(/^[-_.]+/g, '');
    stem = `${head || 'invoice'}-${tail}`.slice(0, stemBudget);
  }

  return `${stem}${extension}`;
}

/** RFC 6266 / RFC 5987 attachment value with injection-safe fallbacks. */
export function buildInvoiceContentDisposition(filename: string): string {
  const canonical = filename.normalize('NFC');
  if (
    !canonical.toLowerCase().endsWith('.pdf')
    || Buffer.byteLength(canonical, 'utf8') > MAX_DOWNLOAD_FILENAME_BYTES
    || /[\u0000-\u001F\u007F/\\]/.test(canonical)
  ) {
    throw new TypeError('filename must be a bounded, safe PDF filename');
  }
  const fallback = asciiFilenameFallback(canonical);
  const encoded = encodeURIComponent(canonical)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Professional AU tax-invoice HTML for Puppeteer to render as A4 PDF. */
export function buildInvoiceHtml(
  model: InvoicePdfModel,
  options: { logoDataUri?: string } = {},
): string {
  const gstPct = Math.round(model.gstRate * 1000) / 10;
  const isTaxInvoice = Boolean(model.seller.abn?.trim());
  const title = isTaxInvoice ? 'Tax Invoice' : 'Invoice';
  const jobGroups: InvoicePdfJobGroup[] = model.jobs?.length
    ? model.jobs
    : [{
        financeId: '',
        job: model.job,
        reference: null,
        subtotalExGst: model.subtotalExGst,
        lines: model.lines,
      }];
  const primaryJob = jobGroups[0]?.job ?? model.job;
  const primaryJobDate = assertJobDate(primaryJob.jobDate.trim());
  const isMultiJob = jobGroups.length > 1;
  const clientName = model.billTo?.name?.trim()
    || primaryJob.clientName?.trim()
    || 'Client';
  const billToAddress = model.billTo?.address?.trim();
  const billToEmail = model.billTo?.email?.trim();
  const billToAbn = model.billTo?.abn?.trim();
  const groupedJobTables = jobGroups.map((group, index) => {
    const jobDate = assertJobDate(group.job.jobDate.trim());
    const productLabel = sourceProductLabel(group.job.sourceApp);
    const jobTypeLabel = sourceTypeLabel(group.job.sourceType);
    const siteName = group.job.siteName?.trim();
    const siteAddress = group.job.siteAddress?.trim();
    const reference = group.reference?.trim();
    const showQuantityAndRate = group.lines.some((line) => line.showQuantityAndRate === true);
    const columnCount = showQuantityAndRate ? 4 : 2;
    const lineRows = group.lines.map((line) => `
        <tr>
          <td class="description">${esc(line.description)}</td>
          ${showQuantityAndRate ? `
          <td class="num">${line.showQuantityAndRate ? line.quantity : ''}</td>
          <td class="num">${line.showQuantityAndRate
            ? esc(money(line.unitAmountExGst, model.currency))
            : ''}</td>` : ''}
          <td class="num">${esc(money(line.lineTotalExGst, model.currency))}</td>
        </tr>
    `).join('');

    return `
    <section class="job-section">
      <table class="job-table">
        <thead>
          <tr class="job-heading-row">
            <th colspan="${columnCount}">
              <div class="job-heading">
                <div>
                  <span class="job-index">Job ${index + 1} of ${jobGroups.length}</span>
                  <span class="job-name">${esc(group.job.jobName || siteName || 'Job')}</span>
                </div>
                <div class="job-context">
                  <span>${esc(productLabel)} ${esc(jobTypeLabel)}</span>
                  <span>Job date: ${esc(formatDate(jobDate))}</span>
                  <span>Job ID: ${reference ? esc(reference) : esc(group.job.sourceId)}</span>
                </div>
                ${siteName && siteName !== group.job.jobName ? `<div class="job-site">Site: ${esc(siteName)}</div>` : ''}
                ${siteAddress ? `<div class="job-site seller-address">${esc(siteAddress)}</div>` : ''}
              </div>
            </th>
          </tr>
          <tr class="column-headings">
            <th>Description</th>
            ${showQuantityAndRate ? `
            <th class="num">Qty</th>
            <th class="num">Unit (ex GST)</th>` : ''}
            <th class="num">Amount (ex GST)</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows || `<tr><td colspan="${columnCount}" class="muted">No lines</td></tr>`}
          <tr class="job-subtotal">
            <td colspan="${columnCount - 1}">Job subtotal (ex GST)</td>
            <td class="num">${esc(money(group.subtotalExGst, model.currency))}</td>
          </tr>
        </tbody>
      </table>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} ${esc(model.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body {
      margin: 0;
      padding: 32px 40px 44px;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #142f70;
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    h1 {
      margin: 0 0 4px;
      color: #142f70;
      font-size: 26px;
      letter-spacing: -0.02em;
    }
    .muted { color: #5b6475; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      margin-bottom: 24px;
      padding-bottom: 18px;
      border-bottom: 2px solid #142f70;
    }
    .identity { min-width: 220px; max-width: 46%; }
    .brand-logo {
      display: block;
      width: 190px;
      max-height: 76px;
      object-fit: contain;
      object-position: left center;
      margin: 0 0 12px;
    }
    .seller { margin-bottom: 14px; }
    .seller strong { color: #1a1f2c; font-size: 14px; }
    .seller-address, .notes-body { white-space: pre-line; }
    .meta { min-width: 250px; max-width: 48%; text-align: right; }
    .meta .number { color: #1a1f2c; font-size: 16px; font-weight: 700; }
    .details {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 18px;
      margin-bottom: 22px;
    }
    .detail-card {
      min-width: 0;
      padding: 14px 16px;
      border-top: 3px solid #142f70;
      background: #f8fafc;
      break-inside: avoid;
    }
    .detail-card h2, .notes h2 {
      margin: 0 0 7px;
      color: #5b6475;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .job-title { color: #1a1f2c; font-size: 14px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      padding: 8px 6px;
      border-bottom: 1px solid #cbd5e1;
      color: #5b6475;
      font-size: 10px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td {
      padding: 10px 6px;
      border-bottom: 1px solid #eef1f6;
      color: #1a1f2c;
      vertical-align: top;
    }
    .description { white-space: pre-line; }
    .num { text-align: right; white-space: nowrap; }
    .job-section { margin-top: 18px; }
    .job-table { border: 1px solid #cbd5e1; }
    .job-heading-row th {
      padding: 10px 12px;
      border-bottom: 1px solid #aab8cc;
      background: #e8eef8;
      text-align: left;
      text-transform: none;
      letter-spacing: normal;
    }
    .job-heading { color: #1a1f2c; }
    .job-index {
      display: inline-block;
      margin-right: 8px;
      color: #5b6475;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .job-name { color: #142f70; font-size: 16px; font-weight: 700; }
    .job-context {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 14px;
      margin-top: 3px;
      color: #5b6475;
      font-size: 9px;
      font-weight: 400;
    }
    .job-site { margin-top: 2px; color: #5b6475; font-size: 10px; font-weight: 400; }
    .column-headings th { background: #f8fafc; }
    .job-subtotal td {
      padding-top: 9px;
      padding-bottom: 9px;
      border-top: 1px solid #aab8cc;
      border-bottom: none;
      background: #f8fafc;
      color: #142f70;
      font-weight: 700;
      text-align: right;
    }
    .totals {
      width: 280px;
      margin: 20px 0 0 auto;
      break-inside: avoid;
    }
    .totals tr td { border: none; padding: 6px 0; }
    .totals .grand td {
      padding-top: 10px;
      border-top: 2px solid #142f70;
      color: #142f70;
      font-size: 14px;
      font-weight: 700;
    }
    .notes {
      margin-top: 24px;
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      break-inside: avoid;
    }
    .badge {
      display: inline-block;
      margin-top: 7px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #e0ecff;
      color: #142f70;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <template data-pdf-header data-brand="SUSTAINABILITY WISE" data-title="${esc(title)} ${esc(model.invoiceNumber)}"></template>
  <template data-pdf-footer data-left="SUSTAINABILITY WISE" data-right="${esc(model.invoiceNumber)}" data-page-numbers="true"></template>
  <div class="header">
    <div class="identity">
      ${options.logoDataUri ? `<img class="brand-logo" src="${esc(options.logoDataUri)}" alt="Sustainability Wise" />` : ''}
      ${!options.logoDataUri ? `<div class="seller"><strong>${esc(model.seller.name || 'Supplier')}</strong></div>` : ''}
    </div>
    <div class="meta">
      <div class="seller">
        <strong>${esc(model.seller.name || 'Supplier')}</strong>
        ${model.seller.abn ? `<div class="muted">ABN ${esc(model.seller.abn)}</div>` : ''}
        ${model.seller.address ? `<div class="muted seller-address">${esc(model.seller.address)}</div>` : ''}
        ${model.seller.email ? `<div class="muted">${esc(model.seller.email)}</div>` : ''}
      </div>
      <h1>${esc(title)}</h1>
      <div class="number">${esc(model.invoiceNumber)}</div>
      <div class="muted">Issue date: ${esc(formatDate(model.issueDate))}</div>
      <div class="muted">Due date: ${esc(formatDate(model.dueDate))}</div>
      ${model.paidAt ? `<div class="muted">Paid: ${esc(formatDate(model.paidAt))}</div>` : ''}
      <div class="badge">${esc(model.status)}</div>
    </div>
  </div>

  <div class="details">
    <section class="detail-card">
      <h2>Bill to</h2>
      <div><strong>${esc(clientName)}</strong></div>
      ${billToAbn ? `<div class="muted">ABN ${esc(billToAbn)}</div>` : ''}
      ${billToAddress ? `<div class="muted seller-address">${esc(billToAddress)}</div>` : ''}
      ${billToEmail ? `<div class="muted">${esc(billToEmail)}</div>` : ''}
      <div class="muted">Customer reference: ${esc(model.purchaseOrderReference?.trim() || primaryJob.sourceId)}</div>
    </section>
    <section class="detail-card">
      <h2>${isMultiJob ? 'Invoice scope' : 'Job summary'}</h2>
      <div class="job-title">${isMultiJob
        ? `${jobGroups.length} jobs included`
        : esc(primaryJob.jobName || primaryJob.siteName || 'Job')}</div>
      <div class="muted">${isMultiJob
        ? `Detailed by job below · First job date: ${esc(formatDate(primaryJobDate))}`
        : `${esc(sourceProductLabel(primaryJob.sourceApp))} ${esc(sourceTypeLabel(primaryJob.sourceType))}`}</div>
      ${!isMultiJob ? `<div class="muted">Job date: ${esc(formatDate(primaryJobDate))}</div>` : ''}
      <div class="muted">Job ID: ${esc(primaryJob.sourceId)}</div>
      <div class="muted">Currency: ${esc(model.currency || 'AUD')}</div>
    </section>
  </div>

  ${groupedJobTables}

  <table class="totals">
    <tr>
      <td class="muted">Consolidated subtotal (ex GST)</td>
      <td class="num">${esc(money(model.subtotalExGst, model.currency))}</td>
    </tr>
    <tr>
      <td class="muted">GST (${gstPct}%)</td>
      <td class="num">${esc(money(model.gstAmount, model.currency))}</td>
    </tr>
    <tr class="grand">
      <td>Total (inc GST)</td>
      <td class="num">${esc(money(model.totalIncGst, model.currency))}</td>
    </tr>
  </table>

  ${model.notes ? `<section class="notes"><h2>Notes</h2><div class="notes-body">${esc(model.notes)}</div></section>` : ''}
</body>
</html>`;
}

/** Shared output path for EcoAudit, SolarSense, and Field App Complete jobs. */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<InvoicePdfOutput> {
  const logoDataUri = await loadBrandLogoDataUri();
  const buffer = await renderPdf(buildInvoiceHtml(model, { logoDataUri }));
  const filename = buildInvoiceDownloadFilename({
    jobName: model.jobs?.[0]?.job.jobName ?? model.job.jobName,
    jobDate: model.jobs && model.jobs.length > 1
      ? (/^(\d{4}-\d{2}-\d{2})/.exec(model.issueDate ?? '')?.[1]
        ?? model.jobs[0].job.jobDate)
      : (model.jobs?.[0]?.job.jobDate ?? model.job.jobDate),
    invoiceNumber: model.invoiceNumber,
    additionalJobCount: Math.max(0, (model.jobs?.length ?? 1) - 1),
  });
  return {
    filename,
    contentDisposition: buildInvoiceContentDisposition(filename),
    buffer,
  };
}
