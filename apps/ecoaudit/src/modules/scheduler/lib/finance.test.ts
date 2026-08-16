import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableInvoiceExpenses,
  draftReservedAmount,
  financeJobNeedsReview,
  financeOverviewFromSummary,
  financeTargetLookupFailed,
  financeTargetFromPages,
  invoiceDraftIsDirty,
  invoiceFilenameFromContentDisposition,
  isFinanceScheduleEvent,
  marginTone,
  resolveHourOverrideValues,
  schedulerFinanceOverviewQuery,
  schedulerFinanceHref,
  schedulerInvoicePdfFallbackFilename,
  schedulerInvoicePdfReportVariantKey,
  shouldAttachHourOverrideReason,
} from './finance';
import type { FinanceOverviewItem, SchedulerFinancialSummary } from '../types/domain';

test('finance events are limited to exact mobile source pairs', () => {
  assert.equal(isFinanceScheduleEvent({ sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'a1' }), true);
  assert.equal(isFinanceScheduleEvent({ sourceApp: 'solarsense', sourceType: 'site', sourceId: 's1' }), false);
  assert.equal(isFinanceScheduleEvent({ sourceApp: 'custom', sourceType: 'custom', sourceId: null }), false);
});

test('invoice download filename prefers UTF-8 then ASCII and rejects paths', () => {
  assert.equal(
    invoiceFilenameFromContentDisposition(
      "attachment; filename=invoice-job.pdf; filename*=UTF-8''invoice-Caf%C3%A9.pdf",
      'fallback',
    ),
    'invoice-Café.pdf',
  );
  assert.equal(
    invoiceFilenameFromContentDisposition('attachment; filename="invoice-safe.pdf"', 'fallback'),
    'invoice-safe.pdf',
  );
  assert.equal(
    invoiceFilenameFromContentDisposition('attachment; filename="../private.pdf"', 'job invoice'),
    'job-invoice.pdf',
  );
  assert.equal(
    invoiceFilenameFromContentDisposition(
      null,
      'invoice-North Roof Upgrade-2026-08-15-INV-2026-0007',
    ),
    'invoice-North-Roof-Upgrade-2026-08-15-INV-2026-0007.pdf',
  );
});

test('scheduler invoice PDF identity follows the exact server revision contract', () => {
  const version = { id: 'invoice-42', updatedAt: '2026-08-16T18:15:00.000Z' };
  assert.equal(
    schedulerInvoicePdfReportVariantKey(version),
    'scheduler-invoice-pdf:v1:invoice-42:2026-08-16T18:15:00.000Z',
  );
  assert.notEqual(
    schedulerInvoicePdfReportVariantKey({ ...version, updatedAt: '2026-08-16T18:16:00.000Z' }),
    schedulerInvoicePdfReportVariantKey(version),
  );
  assert.equal(
    schedulerInvoicePdfFallbackFilename({
      invoiceNumber: 'INV-2026-0042',
      job: {
        jobName: 'Café rooftop upgrade',
        jobDate: '2026-08-15',
        sourceApp: 'solarsense',
        sourceType: 'assessment',
        sourceId: 'assessment-7',
        clientName: null,
        siteName: 'North Wing',
        siteAddress: null,
        status: 'Scheduled',
      },
    }),
    'invoice-Cafe-rooftop-upgrade-2026-08-15-INV-2026-0042.pdf',
  );
});

test('finance helpers expose stable margin cues and deep links', () => {
  assert.equal(marginTone(-1), 'danger');
  assert.equal(marginTone(10), 'warning');
  assert.equal(marginTone(20), 'success');
  assert.equal(
    schedulerFinanceHref({ sourceApp: 'installhub', sourceId: 'job 1', invoiceId: 'inv/2' }),
    '/scheduler?tab=finance&sourceApp=installhub&sourceId=job+1&invoiceId=inv%2F2',
  );
});

test('hours review uses the audited backend state even when recorded hours are zero', () => {
  const base = {
    financeId: 'f', sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'a', eventId: 'e', jobName: 'Job',
    jobDate: '2026-08-16', jobStatus: 'Draft', eventStatus: 'planned', currency: 'AUD', actualHours: 0, billableHours: 2, costHours: 2,
    billableAmount: 0, totalCost: 0, invoicedAmount: 0, unbilledAmount: 0, grossProfit: 0,
    marginPct: null, invoiceCount: 0, hasOverdueInvoice: false,
  } as const;
  assert.equal(financeJobNeedsReview({ ...base, needsHoursReview: false }), false);
  assert.equal(financeJobNeedsReview({ ...base, needsHoursReview: true }), true);
});

test('reserved and invoiced expenses are excluded from new drafts', () => {
  const expense = {
    id: 'x', financeId: 'f', eventId: null, kind: 'expense', category: 'materials', description: 'Cable',
    vendor: null, reference: null, costAmount: 10, billableAmount: null,
    effectiveBillableAmount: 10, billable: true, incurredAt: null, invoiced: false,
    invoiceId: null, reserved: false, markupPct: 0,
    createdAt: '', updatedAt: '',
  } as const;
  assert.deepEqual(availableInvoiceExpenses([expense]), [expense]);
  assert.deepEqual(availableInvoiceExpenses([{ ...expense, reserved: true }]), []);
  assert.deepEqual(availableInvoiceExpenses([{ ...expense, invoiced: true }]), []);
});

test('draft dirty detection blocks issuing stale server lines', () => {
  const original = { notes: '', dueDate: '2026-08-20', lines: [{ description: 'Labour' }] };
  assert.equal(invoiceDraftIsDirty(original, original), false);
  assert.equal(invoiceDraftIsDirty(original, { ...original, notes: 'Updated' }), true);
});

test('explicit null hour overrides are preserved for clear-all requests', () => {
  assert.deepEqual(
    resolveHourOverrideValues(
      { billableHoursOverride: 3, costHoursOverride: 2 },
      { billableHoursOverride: null, costHoursOverride: null },
    ),
    { billableHoursOverride: null, costHoursOverride: null },
  );
});

test('a migrated legacy estimate can be confirmed unchanged with a fresh audited reason', () => {
  assert.equal(shouldAttachHourOverrideReason({
    overrideSource: 'legacy_estimate',
    effectiveChanged: false,
    fullClear: false,
    reason: 'Confirmed against technician timesheet',
  }), true);
  assert.equal(shouldAttachHourOverrideReason({
    overrideSource: 'legacy_estimate',
    effectiveChanged: false,
    fullClear: false,
    reason: '   ',
  }), false);
  assert.equal(shouldAttachHourOverrideReason({
    overrideSource: 'legacy_estimate',
    effectiveChanged: true,
    fullClear: true,
    reason: 'Clearing estimate',
  }), false);
});

test('exact source overview requests keep legacy Field deep links to one filtered page', () => {
  assert.equal(
    schedulerFinanceOverviewQuery({
      limit: 1,
      sourceApp: 'installhub',
      sourceId: 'installation 42',
    }),
    'limit=1&sourceApp=installhub&sourceId=installation+42',
  );
});

test('deep-linked finance targets are found beyond the first cursor page', () => {
  const first: FinanceOverviewItem = {
    financeId: 'finance-1', sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'audit-1',
    eventId: 'event-1', jobName: 'First', jobDate: '2026-08-15', jobStatus: 'Draft',
    eventStatus: 'planned', currency: 'AUD', actualHours: 1, billableHours: 1, costHours: 1,
    billableAmount: 100, totalCost: 50, invoicedAmount: 0, unbilledAmount: 100,
    grossProfit: 50, marginPct: 50, invoiceCount: 0, hasOverdueInvoice: false,
    needsHoursReview: false,
  };
  const target: FinanceOverviewItem = {
    ...first,
    financeId: 'finance-2',
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'installation-2',
    eventId: null,
    jobName: 'Migrated installation',
  };
  const pages = [
    { items: [first], nextCursor: 'ecoaudit:audit:audit-1' },
    { items: [target], nextCursor: null },
  ];
  assert.equal(
    financeTargetFromPages(pages, { sourceApp: 'installhub', sourceId: 'installation-2' })?.financeId,
    'finance-2',
  );
  assert.equal(financeTargetFromPages([pages[0]], { financeId: 'finance-2' }), undefined);
});

test('a failed deep-link lookup never falls back to an unrelated first job', () => {
  assert.equal(financeTargetLookupFailed({
    target: { sourceApp: 'installhub', sourceId: 'missing-installation', invoiceId: 'invoice-9' },
    resolved: false,
    directLookupTerminal: false,
    exactSourceLookupTerminal: true,
    cursorLookupTerminal: false,
  }), true);
  assert.equal(financeTargetLookupFailed({
    target: { financeId: 'finance-2' },
    resolved: true,
    directLookupTerminal: true,
    exactSourceLookupTerminal: false,
    cursorLookupTerminal: false,
  }), false);
  assert.equal(financeTargetLookupFailed({
    target: { invoiceId: 'invoice-without-job' },
    resolved: false,
    directLookupTerminal: false,
    exactSourceLookupTerminal: false,
    cursorLookupTerminal: false,
  }), true);
});

test('draft-held amount excludes issued and paid invoice reservations', () => {
  assert.equal(draftReservedAmount(1_250, 900), 350);
  assert.equal(draftReservedAmount(900, 1_250), 0);
});

test('direct finance summaries produce selectable overview rows without cursor scanning', () => {
  const summary = {
    financeId: 'finance-direct',
    source: { sourceApp: 'solarsense', sourceType: 'assessment', sourceId: 'assessment-9' },
    event: null,
    job: { jobName: 'Warehouse solar', jobDate: '2026-08-16', clientName: null, siteName: 'Warehouse', siteAddress: null, status: 'Draft' },
    currency: 'AUD',
    time: { actualHours: 0, billableHours: 4, costHours: 3, needsHoursReview: false },
    totals: { billableAmount: 800, totalCost: 300, invoicedAmount: 400, unbilledAmount: 400, grossProfit: 500, marginPct: 62.5 },
    invoices: [{ status: 'issued', overdue: true }, { status: 'void', overdue: false }],
  } as unknown as SchedulerFinancialSummary;
  assert.deepEqual(financeOverviewFromSummary(summary), {
    financeId: 'finance-direct', sourceApp: 'solarsense', sourceType: 'assessment', sourceId: 'assessment-9',
    eventId: null, jobName: 'Warehouse solar', jobDate: '2026-08-16', jobStatus: 'Draft', eventStatus: null,
    currency: 'AUD', actualHours: 0, billableHours: 4, costHours: 3, billableAmount: 800, totalCost: 300,
    invoicedAmount: 400, unbilledAmount: 400, grossProfit: 500, marginPct: 62.5, invoiceCount: 1,
    hasOverdueInvoice: true, needsHoursReview: false,
  });
});
