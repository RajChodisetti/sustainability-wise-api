export type InvoicePdfLine = {
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
};

export type InvoicePdfModel = {
  invoiceNumber: string;
  status: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
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
  billTo: {
    clientName: string;
    siteName: string;
    siteAddress: string;
  };
  lines: InvoicePdfLine[];
};

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency || 'AUD',
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Professional AU tax-invoice HTML for Puppeteer → PDF. */
export function buildInvoiceHtml(model: InvoicePdfModel): string {
  const gstPct = Math.round(model.gstRate * 1000) / 10;
  const isTaxInvoice = Boolean(model.seller.abn?.trim());
  const title = isTaxInvoice ? 'Tax Invoice' : 'Invoice';

  const lineRows = model.lines.map((line) => `
    <tr>
      <td>${esc(line.description)}</td>
      <td class="num">${line.quantity}</td>
      <td class="num">${esc(money(line.unitAmountExGst, model.currency))}</td>
      <td class="num">${esc(money(line.lineTotalExGst, model.currency))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} ${esc(model.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 36px 40px;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #1a1f2c;
      font-size: 12px;
      line-height: 1.45;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 26px;
      letter-spacing: -0.02em;
    }
    .muted { color: #5b6475; }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 28px;
      padding-bottom: 18px;
      border-bottom: 2px solid #1a1f2c;
    }
    .seller strong { font-size: 15px; }
    .meta { text-align: right; }
    .meta .number { font-size: 16px; font-weight: 700; }
    .parties {
      display: flex;
      gap: 32px;
      margin-bottom: 24px;
    }
    .party { flex: 1; }
    .party h2 {
      margin: 0 0 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5b6475;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #5b6475;
      padding: 8px 6px;
      border-bottom: 1px solid #d7dce5;
    }
    td {
      padding: 10px 6px;
      border-bottom: 1px solid #eef1f6;
      vertical-align: top;
    }
    .num { text-align: right; white-space: nowrap; }
    .totals {
      width: 280px;
      margin-left: auto;
      margin-top: 16px;
    }
    .totals tr td { border: none; padding: 6px 0; }
    .totals .grand td {
      font-size: 14px;
      font-weight: 700;
      padding-top: 10px;
      border-top: 2px solid #1a1f2c;
    }
    .notes {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid #eef1f6;
    }
    .badge {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      background: #eef1f6;
      color: #5b6475;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="seller">
      <strong>${esc(model.seller.name || 'Supplier')}</strong>
      ${model.seller.abn ? `<div class="muted">ABN ${esc(model.seller.abn)}</div>` : ''}
      ${model.seller.address ? `<div class="muted">${esc(model.seller.address)}</div>` : ''}
      ${model.seller.email ? `<div class="muted">${esc(model.seller.email)}</div>` : ''}
    </div>
    <div class="meta">
      <h1>${esc(title)}</h1>
      <div class="number">${esc(model.invoiceNumber)}</div>
      <div class="muted">Issue date: ${esc(formatDate(model.issueDate))}</div>
      <div class="muted">Due date: ${esc(formatDate(model.dueDate))}</div>
      <div class="badge">${esc(model.status)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h2>Bill to</h2>
      <div><strong>${esc(model.billTo.clientName || 'Client')}</strong></div>
      <div class="muted">${esc(model.billTo.siteName)}</div>
      <div class="muted">${esc(model.billTo.siteAddress)}</div>
    </div>
    <div class="party">
      <h2>Amounts</h2>
      <div class="muted">All line amounts are exclusive of GST.</div>
      <div class="muted">GST rate: ${gstPct}%</div>
      <div class="muted">Currency: ${esc(model.currency)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit (ex GST)</th>
        <th class="num">Amount (ex GST)</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || '<tr><td colspan="4" class="muted">No lines</td></tr>'}
    </tbody>
  </table>

  <table class="totals">
    <tr>
      <td class="muted">Subtotal (ex GST)</td>
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

  ${model.notes ? `<div class="notes"><h2 style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#5b6475;margin:0 0 6px">Notes</h2><div>${esc(model.notes)}</div></div>` : ''}
</body>
</html>`;
}
