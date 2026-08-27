import type {
  FinanceExpense,
  FinanceOverviewItem,
  FinanceOverviewPage,
  FinanceSourceApp,
  ScheduleEvent,
  SchedulerFinancialSummary,
  SchedulerInvoice,
  SchedulerInvoiceListItem,
  SchedulerInvoiceStatus,
  SchedulerFinanceTarget,
  SchedulerFinanceView,
  SchedulerInvoiceEligibilityJob,
} from '@/modules/scheduler/types/domain';

export const SCHEDULER_INVOICE_PDF_RENDERER_VERSION = 'scheduler-invoice-pdf:v3';
export const MAX_CONSOLIDATED_INVOICE_JOBS = 50;

/**
 * A 4xx response proves the API rejected the request before accepting it.
 * Network failures and 5xx responses are ambiguous, so the portal must retry
 * with the exact same idempotency key and payload.
 */
export function invoiceEmailAttemptNeedsSameIdempotencyKey(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  return !(Number.isInteger(status) && status >= 400 && status < 500);
}

export async function persistExpenseBeforeAttachment<TExpense>(input: {
  create: () => Promise<TExpense>;
  onPersisted: (expense: TExpense) => void;
  upload?: (expense: TExpense) => Promise<void>;
}): Promise<{ expense: TExpense; attachmentError: unknown | null }> {
  const expense = await input.create();
  input.onPersisted(expense);
  if (!input.upload) return { expense, attachmentError: null };
  try {
    await input.upload(expense);
    return { expense, attachmentError: null };
  } catch (attachmentError) {
    return { expense, attachmentError };
  }
}

export function toggleConsolidatedInvoiceJob(
  current: string[],
  financeId: string,
  checked: boolean,
): { financeIds: string[]; atLimit: boolean } {
  if (!checked) return { financeIds: current.filter((id) => id !== financeId), atLimit: false };
  if (current.includes(financeId)) return { financeIds: current, atLimit: false };
  if (current.length >= MAX_CONSOLIDATED_INVOICE_JOBS) {
    return { financeIds: current, atLimit: true };
  }
  return { financeIds: [...current, financeId], atLimit: false };
}

export function schedulerInvoicePdfReportVariantKey(
  invoice: Pick<SchedulerInvoiceListItem, 'id' | 'updatedAt'>,
): string {
  const invoiceId = invoice.id.trim();
  const sourceUpdatedAt = invoice.updatedAt.trim();
  if (!invoiceId || !sourceUpdatedAt) {
    throw new TypeError('invoice id and updatedAt are required for PDF provenance');
  }
  return `${SCHEDULER_INVOICE_PDF_RENDERER_VERSION}:${invoiceId}:${sourceUpdatedAt}`;
}

export function schedulerInvoicePdfFallbackFilename(
  invoice: Pick<SchedulerInvoice, 'invoiceNumber' | 'job'>,
): string {
  return invoiceFilenameFromContentDisposition(
    null,
    `invoice-${invoice.job.jobName}-${invoice.job.jobDate}-${invoice.invoiceNumber}`,
  );
}

export function isFinanceScheduleEvent(
  event: Pick<ScheduleEvent, 'sourceApp' | 'sourceType' | 'sourceId'>,
): boolean {
  if (!event.sourceId?.trim()) return false;
  return (event.sourceApp === 'ecoaudit' && event.sourceType === 'audit')
    || (event.sourceApp === 'solarsense' && event.sourceType === 'assessment')
    || (event.sourceApp === 'installhub' && event.sourceType === 'installation');
}

export function financeJobKey(job: Pick<FinanceOverviewItem, 'financeId'>): string {
  return job.financeId;
}

export function financeJobMatchesTarget(
  job: FinanceOverviewItem,
  target?: SchedulerFinanceTarget,
): boolean {
  if (!target) return false;
  if (target.financeId && job.financeId === target.financeId) return true;
  if (target.eventId && job.eventId === target.eventId) return true;
  return Boolean(
    target.sourceApp
    && target.sourceId
    && job.sourceApp === target.sourceApp
    && job.sourceId === target.sourceId,
  );
}

export function financeTargetFromPages(
  pages: FinanceOverviewPage[],
  target?: SchedulerFinanceTarget,
): FinanceOverviewItem | undefined {
  for (const page of pages) {
    const match = page.items.find((job) => financeJobMatchesTarget(job, target));
    if (match) return match;
  }
  return undefined;
}

export function financeTargetRequiresJobLookup(target?: SchedulerFinanceTarget): boolean {
  return Boolean(
    target?.financeId
    || target?.eventId
    || (target?.sourceApp && target.sourceId),
  );
}

export function financeTargetLookupFailed(input: {
  target?: SchedulerFinanceTarget;
  resolved: boolean;
  directLookupTerminal: boolean;
  exactSourceLookupTerminal: boolean;
  cursorLookupTerminal: boolean;
}): boolean {
  if (!input.target || input.resolved) return false;
  if (input.target.financeId) return input.directLookupTerminal;
  if (input.target.sourceApp && input.target.sourceId) return input.exactSourceLookupTerminal;
  if (input.target.eventId) return input.cursorLookupTerminal;
  return false;
}

export function financeOverviewFromSummary(
  summary: SchedulerFinancialSummary,
): FinanceOverviewItem {
  return {
    financeId: summary.financeId,
    sourceApp: summary.source.sourceApp,
    sourceType: summary.source.sourceType,
    sourceId: summary.source.sourceId,
    eventId: summary.event?.id ?? null,
    jobName: summary.job.jobName,
    clientName: summary.job.clientName,
    siteName: summary.job.siteName ?? '',
    siteAddress: summary.job.siteAddress,
    userNames: (summary.time.actors ?? []).map((actor) => actor.displayName || actor.userId),
    jobDate: summary.job.jobDate,
    jobStatus: summary.job.status,
    eventStatus: summary.event?.status ?? null,
    currency: summary.currency,
    actualHours: summary.time.actualHours,
    billableHours: summary.time.billableHours,
    costHours: summary.time.costHours,
    billableAmount: summary.totals.billableAmount,
    totalCost: summary.totals.totalCost,
    invoicedAmount: summary.totals.invoicedAmount,
    unbilledAmount: summary.totals.unbilledAmount,
    grossProfit: summary.totals.grossProfit,
    marginPct: summary.totals.marginPct,
    invoiceCount: summary.invoices.filter((invoice) => invoice.status !== 'void').length,
    hasOverdueInvoice: summary.invoices.some((invoice) => invoice.overdue),
    needsHoursReview: summary.time.needsHoursReview,
    invoiceReadiness: summary.invoiceReadiness,
  };
}

export function schedulerFinanceOverviewQuery(input: {
  cursor?: string | null;
  limit?: number;
  sourceApp?: FinanceSourceApp;
  sourceId?: string;
} = {}): string {
  const query = new URLSearchParams({ limit: String(input.limit ?? 100) });
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.sourceApp) query.set('sourceApp', input.sourceApp);
  if (input.sourceId) query.set('sourceId', input.sourceId);
  return query.toString();
}

export function draftReservedAmount(reservedAmount: number, invoicedAmount: number): number {
  return Math.max(0, reservedAmount - invoicedAmount);
}

export function financeAppLabel(app: FinanceSourceApp): string {
  if (app === 'ecoaudit') return 'Eco Audit';
  if (app === 'solarsense') return 'Solar Sense';
  return 'Field App';
}

export function financeJobNeedsReview(job: FinanceOverviewItem): boolean {
  // This compatibility helper intentionally represents the audited-hours flag only.
  // The broader finance queue uses financeJobExceptionKinds instead.
  return job.needsHoursReview;
}

export type FinanceExceptionKind =
  | 'overdue'
  | 'hours_review'
  | 'completed_without_invoice'
  | 'unbilled';

export type FinanceExceptionFilter = 'all' | FinanceExceptionKind;

const financeExceptionPriority: Record<FinanceExceptionKind, number> = {
  overdue: 0,
  hours_review: 1,
  completed_without_invoice: 2,
  unbilled: 3,
};

export function financeJobExceptionKinds(
  job: FinanceOverviewItem,
): FinanceExceptionKind[] {
  const kinds: FinanceExceptionKind[] = [];
  if (job.hasOverdueInvoice) kinds.push('overdue');
  if (job.needsHoursReview) kinds.push('hours_review');
  if (job.invoiceReadiness.completionSatisfied && job.invoiceCount === 0) {
    kinds.push('completed_without_invoice');
  }
  if (
    job.unbilledAmount > 0
    && (job.invoiceReadiness.completionSatisfied || job.invoiceCount > 0)
  ) {
    kinds.push('unbilled');
  }
  return kinds;
}

export function financeExceptionCounts(
  jobs: FinanceOverviewItem[],
): Record<FinanceExceptionKind, number> {
  const counts: Record<FinanceExceptionKind, number> = {
    overdue: 0,
    hours_review: 0,
    completed_without_invoice: 0,
    unbilled: 0,
  };
  for (const job of jobs) {
    for (const kind of financeJobExceptionKinds(job)) counts[kind] += 1;
  }
  return counts;
}

export function financeJobMatchesExceptionFilter(
  job: FinanceOverviewItem,
  filter: FinanceExceptionFilter,
): boolean {
  return filter === 'all' || financeJobExceptionKinds(job).includes(filter);
}

export function selectedVisibleFinanceJob(
  visibleJobs: FinanceOverviewItem[],
  selectedFinanceId: string | null,
): FinanceOverviewItem | null {
  if (!selectedFinanceId) return null;
  return visibleJobs.find((job) => financeJobKey(job) === selectedFinanceId) ?? null;
}

export function compareFinanceExceptionJobs(
  left: FinanceOverviewItem,
  right: FinanceOverviewItem,
): number {
  const priority = (job: FinanceOverviewItem) => {
    const kinds = financeJobExceptionKinds(job);
    return kinds.length
      ? Math.min(...kinds.map((kind) => financeExceptionPriority[kind]))
      : Number.POSITIVE_INFINITY;
  };
  return priority(left) - priority(right)
    || right.jobDate.localeCompare(left.jobDate)
    || left.financeId.localeCompare(right.financeId);
}

export function availableInvoiceExpenses(expenses: FinanceExpense[]): FinanceExpense[] {
  return expenses.filter((expense) => expense.billable && !expense.invoiced && !expense.reserved);
}

export function invoiceDraftIsDirty(initial: unknown, current: unknown): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

export function invoiceQuantityRateForAmount(input: {
  amountExGst: string;
  quantity: string;
  unitAmountExGst: string;
}): { quantity: string; unitAmountExGst: string } {
  const amountText = input.amountExGst.trim();
  const quantityText = input.quantity.trim();
  const unitAmountText = input.unitAmountExGst.trim();
  const amount = amountText ? Number(amountText) : Number.NaN;
  const quantity = quantityText ? Number(quantityText) : Number.NaN;
  const unitAmount = unitAmountText ? Number(unitAmountText) : Number.NaN;
  const existingTotal = quantity * unitAmount;
  const existingBreakdownMatches = Number.isFinite(amount)
    && amount >= 0
    && Number.isFinite(quantity)
    && quantity > 0
    && Number.isFinite(unitAmount)
    && unitAmount >= 0
    && Math.round(existingTotal * 100) === Math.round(amount * 100);

  if (existingBreakdownMatches) {
    return {
      quantity: input.quantity,
      unitAmountExGst: input.unitAmountExGst,
    };
  }
  return {
    quantity: '1',
    unitAmountExGst: Number.isFinite(amount) ? String(amount) : '',
  };
}

export function resolveHourOverrideValues(
  current: { billableHoursOverride: number | null; costHoursOverride: number | null },
  explicit?: { billableHoursOverride: number | null; costHoursOverride: number | null },
): { billableHoursOverride: number | null; costHoursOverride: number | null } {
  return explicit ?? current;
}

export function manualHoursEntryIssue(input: {
  actualHours: number;
  billableHoursOverride: number | null;
  costHoursOverride: number | null;
}): string | null {
  if (input.actualHours > 0) return null;
  if (input.billableHoursOverride !== null && input.costHoursOverride !== null) return null;
  return 'No app time was recorded. Enter both billing hours and cost hours for accurate internal reporting.';
}

export function shouldAttachHourOverrideReason(input: {
  overrideSource: SchedulerFinancialSummary['time']['overrideSource'];
  effectiveChanged: boolean;
  fullClear: boolean;
  reason: string;
}): boolean {
  if (input.fullClear) return false;
  if (input.effectiveChanged) return true;
  return input.overrideSource === 'legacy_estimate' && Boolean(input.reason.trim());
}

export function summaryNeedsHoursReview(summary: SchedulerFinancialSummary): boolean {
  return summary.time.needsHoursReview;
}

export function marginTone(value: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (value == null) return 'neutral';
  if (value < 0) return 'danger';
  if (value < 20) return 'warning';
  return 'success';
}

export function invoiceStatusLabel(status: SchedulerInvoiceStatus): string {
  if (status === 'draft') return 'Draft';
  if (status === 'issued') return 'Issued';
  if (status === 'paid') return 'Paid';
  return 'Void';
}

function decodeQuotedFilename(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, '');
  if (!trimmed || /[\r\n/\\]/.test(trimmed)) return null;
  return trimmed;
}

export function invoiceFilenameFromContentDisposition(
  contentDisposition: string | null,
  fallback: string,
): string {
  if (contentDisposition) {
    const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
    if (utf8) {
      try {
        const decoded = decodeQuotedFilename(decodeURIComponent(utf8.trim().replace(/^"|"$/g, '')));
        if (decoded) return decoded;
      } catch {
        // Fall through to the ASCII filename or safe fallback.
      }
    }
    const ascii = /filename\s*=\s*("[^"]*"|[^;]+)/i.exec(contentDisposition)?.[1];
    const decoded = ascii ? decodeQuotedFilename(ascii) : null;
    if (decoded) return decoded;
  }

  const safeFallback = fallback
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
  return `${safeFallback || 'invoice'}.pdf`.replace(/\.pdf\.pdf$/i, '.pdf');
}

export function schedulerFinanceHref(input: {
  financeId?: string;
  eventId?: string;
  sourceApp?: FinanceSourceApp;
  sourceId?: string;
  invoiceId?: string;
  view?: SchedulerFinanceView;
}): string {
  const params = new URLSearchParams({
    tab: input.view ?? (input.invoiceId ? 'invoices' : 'financial-summary'),
  });
  if (input.financeId) params.set('financeId', input.financeId);
  if (input.eventId) params.set('eventId', input.eventId);
  if (input.sourceApp) params.set('sourceApp', input.sourceApp);
  if (input.sourceId) params.set('sourceId', input.sourceId);
  if (input.invoiceId) params.set('invoiceId', input.invoiceId);
  return `/scheduler?${params.toString()}`;
}

export function schedulerFinanceTargetFromSearchParams(
  params: Pick<URLSearchParams, 'get'>,
): SchedulerFinanceTarget | undefined {
  const sourceAppValue = params.get('sourceApp')?.trim();
  const sourceApp = sourceAppValue === 'ecoaudit'
    || sourceAppValue === 'solarsense'
    || sourceAppValue === 'installhub'
    ? sourceAppValue
    : undefined;
  const target: SchedulerFinanceTarget = {
    financeId: params.get('financeId')?.trim() || undefined,
    eventId: params.get('eventId')?.trim() || undefined,
    sourceApp,
    sourceId: params.get('sourceId')?.trim() || undefined,
    invoiceId: params.get('invoiceId')?.trim() || undefined,
  };
  return target.financeId
    || target.eventId
    || target.sourceApp
    || target.sourceId
    || target.invoiceId
    ? target
    : undefined;
}

export function schedulerTabTransition(
  currentSearch: string,
  nextTab:
    | 'overview'
    | 'calendar'
    | 'my-route'
    | 'deadlines'
    | 'team-performance'
    | 'leave'
    | 'inventory'
    | 'finance-analytics'
    | SchedulerFinanceView,
): { href: string; financeTarget?: SchedulerFinanceTarget } {
  const params = new URLSearchParams(currentSearch);
  params.set('tab', nextTab);
  const financeTab = nextTab === 'financial-summary' || nextTab === 'bills' || nextTab === 'invoices';
  if (!financeTab) {
    params.delete('eventId');
    params.delete('financeId');
    params.delete('sourceApp');
    params.delete('sourceId');
    params.delete('invoiceId');
  } else if (nextTab !== 'invoices') {
    params.delete('invoiceId');
  }
  return {
    href: `/scheduler?${params.toString()}`,
    financeTarget: financeTab ? schedulerFinanceTargetFromSearchParams(params) : undefined,
  };
}

export type SchedulerTabLinkActivation = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function schedulerTabLinkShouldActivateInPlace(
  event: SchedulerTabLinkActivation,
): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}

export function consolidatedInvoiceJobSubtotal(
  job: SchedulerInvoiceEligibilityJob,
  selection: { includeLabour: boolean; expenseIds: string[] },
): number {
  const labour = selection.includeLabour
    ? job.pricingMode === 'quoted'
      ? job.availableQuotedAmount
      : job.availableLabourAmount ?? 0
    : 0;
  const expenses = job.availableExpenses
    .filter((expense) => selection.expenseIds.includes(expense.id))
    .reduce((sum, expense) => sum + expense.effectiveBillableAmount, 0);
  return Math.round((labour + expenses + Number.EPSILON) * 100) / 100;
}

export function consolidatedInvoiceJobsWithoutCharges(
  jobs: SchedulerInvoiceEligibilityJob[],
  selections: Record<string, { includeLabour: boolean; expenseIds: string[] }>,
): SchedulerInvoiceEligibilityJob[] {
  return jobs.filter((job) => consolidatedInvoiceJobSubtotal(
    job,
    selections[job.financeId] ?? { includeLabour: false, expenseIds: [] },
  ) <= 0);
}

export function consolidatedInvoiceRecipientIssue(input: { name: string }): string | null {
  if (!input.name.trim()) return 'Enter the invoice recipient name.';
  return null;
}

const billAttachmentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function billAttachmentValidation(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!billAttachmentTypes.has(file.type)) {
    return 'Upload a PDF, JPEG, PNG, or WebP bill.';
  }
  if (file.size <= 0) return 'The selected bill file is empty.';
  if (file.size > 10 * 1024 * 1024) return 'Bill attachments must be 10 MB or smaller.';
  if (!file.name.trim()) return 'The selected bill needs a filename.';
  return null;
}
