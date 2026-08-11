import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeGstTotals,
  costLineToInvoiceAmounts,
} from './installHubInvoiceService.js';
import { buildInvoiceHtml } from './installHubInvoicePdf.js';

describe('computeGstTotals', () => {
  it('applies 10% GST on subtotal', () => {
    const totals = computeGstTotals([100, 50], 0.1);
    assert.equal(totals.subtotalExGst, 150);
    assert.equal(totals.gstAmount, 15);
    assert.equal(totals.totalIncGst, 165);
    assert.equal(totals.gstRate, 0.1);
  });

  it('rounds to cents', () => {
    const totals = computeGstTotals([10.11], 0.1);
    assert.equal(totals.subtotalExGst, 10.11);
    assert.equal(totals.gstAmount, 1.01);
    assert.equal(totals.totalIncGst, 11.12);
  });
});

describe('costLineToInvoiceAmounts', () => {
  it('splits hours into qty × unit from sell total', () => {
    const amounts = costLineToInvoiceAmounts({
      hours: 8,
      costAmount: 600,
      sellAmount: 800,
      billable: true,
    });
    assert.equal(amounts.quantity, 8);
    assert.equal(amounts.unitAmountExGst, 100);
    assert.equal(amounts.lineTotalExGst, 800);
  });

  it('uses quantity 1 when hours missing', () => {
    const amounts = costLineToInvoiceAmounts({
      hours: null,
      costAmount: 250,
      sellAmount: null,
      billable: true,
    });
    assert.equal(amounts.quantity, 1);
    assert.equal(amounts.unitAmountExGst, 250);
    assert.equal(amounts.lineTotalExGst, 250);
  });
});

describe('buildInvoiceHtml', () => {
  it('renders tax invoice with GST totals', () => {
    const html = buildInvoiceHtml({
      invoiceNumber: 'INV-2026-0001',
      status: 'issued',
      currency: 'AUD',
      issueDate: '2026-08-11T00:00:00.000Z',
      dueDate: '2026-08-25T00:00:00.000Z',
      notes: 'Thanks',
      gstRate: 0.1,
      subtotalExGst: 100,
      gstAmount: 10,
      totalIncGst: 110,
      seller: {
        name: 'Sustainability Wise',
        abn: '12 345 678 901',
        address: 'Sydney',
        email: 'billing@example.com',
      },
      billTo: {
        clientName: 'Acme',
        siteName: 'Warehouse',
        siteAddress: '1 Main St',
      },
      lines: [{
        description: 'Labour',
        quantity: 2,
        unitAmountExGst: 50,
        lineTotalExGst: 100,
      }],
    });
    assert.match(html, /Tax Invoice/);
    assert.match(html, /INV-2026-0001/);
    assert.match(html, /ABN 12 345 678 901/);
    assert.match(html, /Labour/);
  });
});
