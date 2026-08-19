import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  availableInvoiceExpenses,
  billAttachmentValidation,
  consolidatedInvoiceJobSubtotal,
  consolidatedInvoiceJobsWithoutCharges,
  consolidatedInvoiceRecipientIssue,
  draftReservedAmount,
  financeJobNeedsReview,
  financeOverviewFromSummary,
  financeTargetLookupFailed,
  financeTargetFromPages,
  financeTargetRequiresJobLookup,
  invoiceEmailAttemptNeedsSameIdempotencyKey,
  invoiceDraftIsDirty,
  manualHoursEntryIssue,
  invoiceFilenameFromContentDisposition,
  invoiceQuantityRateForAmount,
  isFinanceScheduleEvent,
  marginTone,
  MAX_CONSOLIDATED_INVOICE_JOBS,
  persistExpenseBeforeAttachment,
  resolveHourOverrideValues,
  schedulerFinanceOverviewQuery,
  schedulerFinanceHref,
  schedulerFinanceTargetFromSearchParams,
  schedulerTabTransition,
  schedulerInvoicePdfFallbackFilename,
  schedulerInvoicePdfReportVariantKey,
  shouldAttachHourOverrideReason,
  toggleConsolidatedInvoiceJob,
} from './finance';
import type {
  FinanceExpense,
  FinanceOverviewItem,
  SchedulerFinancialSummary,
  SchedulerInvoiceEligibilityJob,
} from '../types/domain';

test('invoice email retries preserve identity only for ambiguous outcomes', () => {
  assert.equal(invoiceEmailAttemptNeedsSameIdempotencyKey(new Error('network')), true);
  assert.equal(invoiceEmailAttemptNeedsSameIdempotencyKey({ status: 503 }), true);
  assert.equal(invoiceEmailAttemptNeedsSameIdempotencyKey({ status: 409 }), false);
});

test('job and invoice selection boundaries remount stateful commercial editors', () => {
  const workspace = readFileSync(new URL('../components/SchedulerFinanceWorkspace.tsx', import.meta.url), 'utf8');
  const invoices = readFileSync(new URL('../components/SchedulerInvoicesWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /<SchedulerFinanceDetail key=\{selected\.financeId\}/);
  assert.match(invoices, /<GlobalInvoiceDetail key=\{selectedInvoiceId\}/);
});

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
    'scheduler-invoice-pdf:v2:invoice-42:2026-08-16T18:15:00.000Z',
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
    '/scheduler?tab=invoices&sourceApp=installhub&sourceId=job+1&invoiceId=inv%2F2',
  );
  assert.equal(
    schedulerFinanceHref({ view: 'invoices', sourceApp: 'installhub', sourceId: 'job 1' }),
    '/scheduler?tab=invoices&sourceApp=installhub&sourceId=job+1',
  );
  assert.equal(
    schedulerFinanceHref({ view: 'bills', financeId: 'finance 1' }),
    '/scheduler?tab=bills&financeId=finance+1',
  );
  assert.equal(schedulerFinanceHref({}), '/scheduler?tab=financial-summary');
  assert.deepEqual(
    schedulerFinanceTargetFromSearchParams(new URLSearchParams('financeId=finance-7&sourceApp=solarsense&sourceId=assessment-8')),
    { financeId: 'finance-7', eventId: undefined, sourceApp: 'solarsense', sourceId: 'assessment-8', invoiceId: undefined },
  );
  assert.equal(schedulerFinanceTargetFromSearchParams(new URLSearchParams('sourceApp=unknown')), undefined);
});

test('scheduler tab transitions keep URL and in-memory finance targets in parity', () => {
  assert.deepEqual(
    schedulerTabTransition('?tab=financial-summary&financeId=finance-7&eventId=event-7', 'calendar'),
    { href: '/scheduler?tab=calendar', financeTarget: undefined },
  );
  assert.deepEqual(
    schedulerTabTransition('?tab=calendar', 'bills'),
    { href: '/scheduler?tab=bills', financeTarget: undefined },
  );
  assert.deepEqual(
    schedulerTabTransition('?tab=invoices&financeId=finance-7&invoiceId=invoice-7', 'bills'),
    {
      href: '/scheduler?tab=bills&financeId=finance-7',
      financeTarget: {
        financeId: 'finance-7',
        eventId: undefined,
        sourceApp: undefined,
        sourceId: undefined,
        invoiceId: undefined,
      },
    },
  );
});

test('hours review uses the audited backend state even when recorded hours are zero', () => {
  const base = {
    financeId: 'f', sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'a', eventId: 'e', jobName: 'Job', siteName: 'Site',
    jobDate: '2026-08-16', jobStatus: 'Draft', eventStatus: 'planned', currency: 'AUD', actualHours: 0, billableHours: 2, costHours: 2,
    billableAmount: 0, totalCost: 0, invoicedAmount: 0, unbilledAmount: 0, grossProfit: 0,
    marginPct: null, invoiceCount: 0, hasOverdueInvoice: false,
    invoiceReadiness: {
      completionSatisfied: false, completionBasis: null,
      hoursSatisfied: false, hoursBasis: null, ready: false,
    },
  } as const;
  assert.equal(financeJobNeedsReview({ ...base, needsHoursReview: false }), false);
  assert.equal(financeJobNeedsReview({ ...base, needsHoursReview: true }), true);
});

test('reserved and invoiced expenses are excluded from new drafts', () => {
  const expense: FinanceExpense = {
    id: 'x', financeId: 'f', eventId: null, kind: 'expense', category: 'materials', description: 'Cable',
    vendor: null, reference: null, costAmount: 10, billableAmount: null,
    effectiveBillableAmount: 10, billable: true, incurredAt: null, invoiced: false,
    invoiceId: null, reserved: false, markupPct: 0,
    attachments: [],
    createdAt: '', updatedAt: '',
  };
  assert.deepEqual(availableInvoiceExpenses([expense]), [expense]);
  assert.deepEqual(availableInvoiceExpenses([{ ...expense, reserved: true }]), []);
  assert.deepEqual(availableInvoiceExpenses([{ ...expense, invoiced: true }]), []);
});

test('consolidated invoice previews use quote balance for quoted jobs and labour for charge-up', () => {
  const base: Omit<SchedulerInvoiceEligibilityJob, 'pricingMode'> = {
    financeId: 'finance-1',
    source: { sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'audit-1' },
    job: { jobName: 'Audit', jobDate: '2026-08-16', clientName: 'Client', siteName: 'Site', siteAddress: null, status: 'complete' },
    currency: 'AUD',
    billing: { name: 'Client', address: null, email: null, abn: null, reference: null },
    invoiceReadiness: {
      completionSatisfied: true,
      completionBasis: 'job',
      hoursSatisfied: true,
      hoursBasis: 'app_time',
      ready: true,
    },
    availableLabourHours: 2,
    billableRate: 150,
    availableLabourAmount: 300,
    availableQuotedAmount: 725,
    availableExpenses: [],
  };
  assert.equal(
    consolidatedInvoiceJobSubtotal({ ...base, pricingMode: 'quoted' }, { includeLabour: true, expenseIds: [] }),
    725,
  );
  assert.equal(
    consolidatedInvoiceJobSubtotal({ ...base, pricingMode: 'charge_up' }, { includeLabour: true, expenseIds: [] }),
    300,
  );
  const quoted = { ...base, pricingMode: 'quoted' as const };
  const empty = { ...base, financeId: 'finance-2', pricingMode: 'charge_up' as const, availableLabourAmount: 0 };
  assert.deepEqual(
    consolidatedInvoiceJobsWithoutCharges([quoted, empty], {
      'finance-1': { includeLabour: true, expenseIds: [] },
      'finance-2': { includeLabour: false, expenseIds: [] },
    }).map((job) => job.financeId),
    ['finance-2'],
  );
});

test('bill attachments enforce the exact supported formats and 10 MiB boundary', () => {
  assert.equal(billAttachmentValidation({ name: 'bill.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 }), null);
  assert.equal(billAttachmentValidation({ name: 'bill.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }), 'Bill attachments must be 10 MB or smaller.');
  assert.equal(billAttachmentValidation({ name: 'bill.txt', type: 'text/plain', size: 100 }), 'Upload a PDF, JPEG, PNG, or WebP bill.');
});

test('a persisted bill closes before a failed initial attachment can be retried', async () => {
  const sequence: string[] = [];
  let createCount = 0;
  const result = await persistExpenseBeforeAttachment({
    create: async () => {
      createCount += 1;
      sequence.push('bill-persisted');
      return { id: 'expense-1' };
    },
    onPersisted: () => sequence.push('form-closed'),
    upload: async () => {
      sequence.push('attachment-started');
      throw new Error('upload unavailable');
    },
  });
  assert.equal(createCount, 1);
  assert.deepEqual(sequence, ['bill-persisted', 'form-closed', 'attachment-started']);
  assert.equal(result.expense.id, 'expense-1');
  assert.match(String(result.attachmentError), /upload unavailable/);
});

test('invoice recipient validation requires an identity name without over-requiring address or ABN', () => {
  assert.equal(consolidatedInvoiceRecipientIssue({ name: '   ' }), 'Enter the invoice recipient name.');
  assert.equal(consolidatedInvoiceRecipientIssue({ name: 'Example Customer Pty Ltd' }), null);
});

test('consolidated invoice job selection prevents a 51st job before the API call', () => {
  const fifty = Array.from({ length: MAX_CONSOLIDATED_INVOICE_JOBS }, (_, index) => `finance-${index}`);
  assert.deepEqual(toggleConsolidatedInvoiceJob(fifty, 'finance-50', true), {
    financeIds: fifty,
    atLimit: true,
  });
  assert.deepEqual(toggleConsolidatedInvoiceJob(fifty, 'finance-0', false), {
    financeIds: fifty.slice(1),
    atLimit: false,
  });
});

test('draft dirty detection blocks issuing stale invoice metadata', () => {
  const original = { notes: '', dueDate: '2026-08-20', billToName: 'Example Customer' };
  assert.equal(invoiceDraftIsDirty(original, original), false);
  assert.equal(invoiceDraftIsDirty(original, { ...original, notes: 'Updated' }), true);
});

test('invoice quantity and rate toggles preserve the current amount without discarding an unchanged breakdown', () => {
  assert.deepEqual(invoiceQuantityRateForAmount({
    amountExGst: '125',
    quantity: '2',
    unitAmountExGst: '50',
  }), {
    quantity: '1',
    unitAmountExGst: '125',
  });
  assert.deepEqual(invoiceQuantityRateForAmount({
    amountExGst: '100.00',
    quantity: '2.00',
    unitAmountExGst: '50.00',
  }), {
    quantity: '2.00',
    unitAmountExGst: '50.00',
  });
  assert.deepEqual(invoiceQuantityRateForAmount({
    amountExGst: '',
    quantity: '2',
    unitAmountExGst: '50',
  }), {
    quantity: '1',
    unitAmountExGst: '',
  });
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

test('jobs without app time require both audited accounting hour values', () => {
  assert.equal(manualHoursEntryIssue({
    actualHours: 0,
    billableHoursOverride: null,
    costHoursOverride: null,
  }), 'No app time was recorded. Enter both billable hours and cost hours before invoicing this job.');
  assert.equal(manualHoursEntryIssue({
    actualHours: 0,
    billableHoursOverride: 0,
    costHoursOverride: 0,
  }), null);
  assert.equal(manualHoursEntryIssue({
    actualHours: 1.25,
    billableHoursOverride: null,
    costHoursOverride: null,
  }), null);
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
    eventId: 'event-1', jobName: 'First', siteName: 'First site', jobDate: '2026-08-15', jobStatus: 'Draft',
    eventStatus: 'planned', currency: 'AUD', actualHours: 1, billableHours: 1, costHours: 1,
    billableAmount: 100, totalCost: 50, invoicedAmount: 0, unbilledAmount: 100,
    grossProfit: 50, marginPct: 50, invoiceCount: 0, hasOverdueInvoice: false,
    needsHoursReview: false,
    invoiceReadiness: {
      completionSatisfied: false, completionBasis: null,
      hoursSatisfied: true, hoursBasis: 'app_time', ready: false,
    },
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
  assert.equal(financeTargetRequiresJobLookup({ invoiceId: 'invoice-without-job' }), false);
  assert.equal(financeTargetRequiresJobLookup({ financeId: 'finance-2' }), true);
  assert.equal(financeTargetRequiresJobLookup({ sourceApp: 'installhub', sourceId: 'installation-2' }), true);
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
    target: { financeId: 'missing-finance' },
    resolved: false,
    directLookupTerminal: false,
    exactSourceLookupTerminal: false,
    cursorLookupTerminal: false,
  }), false);
  assert.equal(financeTargetLookupFailed({
    target: { financeId: 'missing-finance' },
    resolved: false,
    directLookupTerminal: true,
    exactSourceLookupTerminal: false,
    cursorLookupTerminal: false,
  }), true);
  assert.equal(financeTargetLookupFailed({
    target: { invoiceId: 'invoice-without-job' },
    resolved: false,
    directLookupTerminal: false,
    exactSourceLookupTerminal: false,
    cursorLookupTerminal: false,
  }), false);
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
    invoiceReadiness: {
      completionSatisfied: false, completionBasis: null,
      hoursSatisfied: true, hoursBasis: 'admin_override', ready: false,
    },
    time: { actualHours: 0, billableHours: 4, costHours: 3, needsHoursReview: false },
    totals: { billableAmount: 800, totalCost: 300, invoicedAmount: 400, unbilledAmount: 400, grossProfit: 500, marginPct: 62.5 },
    invoices: [{ status: 'issued', overdue: true }, { status: 'void', overdue: false }],
  } as unknown as SchedulerFinancialSummary;
  assert.deepEqual(financeOverviewFromSummary(summary), {
    financeId: 'finance-direct', sourceApp: 'solarsense', sourceType: 'assessment', sourceId: 'assessment-9',
    eventId: null, jobName: 'Warehouse solar', siteName: 'Warehouse', jobDate: '2026-08-16', jobStatus: 'Draft', eventStatus: null,
    currency: 'AUD', actualHours: 0, billableHours: 4, costHours: 3, billableAmount: 800, totalCost: 300,
    invoicedAmount: 400, unbilledAmount: 400, grossProfit: 500, marginPct: 62.5, invoiceCount: 1,
    hasOverdueInvoice: true, needsHoursReview: false,
    invoiceReadiness: {
      completionSatisfied: false, completionBasis: null,
      hoursSatisfied: true, hoursBasis: 'admin_override', ready: false,
    },
  });
});
