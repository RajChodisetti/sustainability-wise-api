import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eaAudits, eaAuditWorkSessions, eaUsers } from '../db/schema/ecoaudit.js';
import { ihInstallations, ihInstallationWorkSessions, ihUsers } from '../db/schema/installhub.js';
import {
  globalUsers,
  portalScheduleEvents,
  schedulerExpenseAttachments,
  schedulerInvoiceCounters,
  schedulerInvoiceJobs,
  schedulerInvoiceLines,
  schedulerInvoiceRefunds,
  schedulerInvoiceSettings,
  schedulerInvoices,
  schedulerJobActorBillingRateOverrides,
  schedulerJobExpenses,
  schedulerJobFinance,
  schedulerJobHourOverrides,
  storageDeletionTasks,
  unifiedUsers,
} from '../db/schema/shared.js';
import {
  ssAssessmentWorkSessions,
  ssRooftopAssessments,
  ssSites,
  ssUsers,
} from '../db/schema/solarsense.js';
import {
  localFileSize,
  localFileStream,
  makeLocalStorageKey,
  writeLocalFile,
} from '../storage/localFiles.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { compareLockKeys } from '../utils/lockOrder.js';
import { renderInvoicePdf, type InvoicePdfOutput } from './invoicePdf.js';
import { drainStorageDeletionTasks } from './storageDeletionService.js';
import {
  areSchedulerSourceAppsVisible,
  assertSchedulerSourceAppVisible,
  isSchedulerSourceAppVisible,
  schedulerVisibleFinanceSourceApps,
} from './schedulerVisibility.js';

export type FinanceSourceApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type FinanceSourceType = 'audit' | 'assessment' | 'installation';
export type PricingMode = 'quoted' | 'charge_up';
export type ExpenseKind = 'expense' | 'supplier_bill';
export type ExpenseCategory =
  | 'materials'
  | 'travel'
  | 'subcontractor'
  | 'equipment'
  | 'other';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
export type InvoiceLineKind = 'labour' | 'expense' | 'quoted' | 'other';

export type FinanceSource = {
  sourceApp: FinanceSourceApp;
  sourceType: FinanceSourceType;
  sourceId: string;
};

export function schedulerFinanceSourceMutexKey(source: FinanceSource): string {
  return `scheduler-finance:${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
}

export type SchedulerCompletedWorkRevenueSnapshot = {
  status: 'captured' | 'incomplete';
  currency: string;
  amountExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
  gstRateBps: number;
};

export function buildSchedulerCompletedWorkRevenueSnapshot(input: {
  currency: string;
  billableAmount: number;
  needsFinanceReview: boolean;
  gstRate: number;
}): SchedulerCompletedWorkRevenueSnapshot {
  const amountExGstCents = moneyToCents(
    input.billableAmount,
    'Completed-work revenue',
  );
  const gstRateBps = Math.round(input.gstRate * 10_000);
  if (!Number.isSafeInteger(gstRateBps) || gstRateBps < 0 || gstRateBps > 10_000) {
    throw new Error('scheduler_completed_work_gst_rate_invalid');
  }
  const totals = invoiceTotalsFromCents([amountExGstCents], gstRateBps);
  return {
    status: input.needsFinanceReview ? 'incomplete' : 'captured',
    currency: input.currency,
    amountExGstCents: totals.subtotal,
    gstAmountCents: totals.gst,
    totalIncGstCents: totals.total,
    gstRateBps,
  };
}

export type SchedulerFinanceExecutor = Pick<
  typeof db,
  'delete' | 'execute' | 'insert' | 'select' | 'update'
>;
type FinanceExecutor = SchedulerFinanceExecutor;
type ScheduleEventRow = typeof portalScheduleEvents.$inferSelect;
type FinanceRow = typeof schedulerJobFinance.$inferSelect;
type ExpenseRow = typeof schedulerJobExpenses.$inferSelect;
type ExpenseAttachmentRow = typeof schedulerExpenseAttachments.$inferSelect;
type InvoiceRow = typeof schedulerInvoices.$inferSelect;
type InvoiceJobRow = typeof schedulerInvoiceJobs.$inferSelect;
type InvoiceLineRow = typeof schedulerInvoiceLines.$inferSelect;

const CURRENT_MULTI_JOB_INVOICE_WRITER_SETTING = 'sustainability.scheduler_multi_job_writer';

async function markCurrentMultiJobInvoiceWriter(executor: FinanceExecutor): Promise<void> {
  await executor.execute(sql`
    SELECT set_config(${CURRENT_MULTI_JOB_INVOICE_WRITER_SETTING}, 'on', true)
  `);
}

type FinanceActor = {
  globalUserId: string;
  displayName: string | null;
};

type JobMetadata = {
  jobName: string;
  jobDate: string;
  clientName: string | null;
  siteName: string;
  siteAddress: string | null;
  status: string;
};

export type RecordedActorHoursDto = {
  userId: string;
  displayName: string | null;
  activeMilliseconds: number;
  hours: number;
  /** Effective rate retained for backwards-compatible consumers. */
  billingRate: number | null;
  defaultBillingRate: number | null;
  billingRateOverride: number | null;
  effectiveBillingRate: number | null;
  billingRateSource: 'job_override' | 'global_default' | 'missing';
  labourAmount: number | null;
  billingRateEditable: boolean;
};

export type SchedulerActorBillingRateResolution = {
  defaultBillingRateCents: number | null;
  billingRateOverrideCents: number | null;
  effectiveBillingRateCents: number | null;
  billingRateSource: RecordedActorHoursDto['billingRateSource'];
};

export function resolveSchedulerActorBillingRate(input: {
  defaultBillingRateCents: number | null;
  billingRateOverrideCents: number | null;
}): SchedulerActorBillingRateResolution {
  if (input.billingRateOverrideCents !== null) {
    return {
      ...input,
      effectiveBillingRateCents: input.billingRateOverrideCents,
      billingRateSource: 'job_override',
    };
  }
  if (input.defaultBillingRateCents !== null) {
    return {
      ...input,
      effectiveBillingRateCents: input.defaultBillingRateCents,
      billingRateSource: 'global_default',
    };
  }
  return {
    ...input,
    effectiveBillingRateCents: null,
    billingRateSource: 'missing',
  };
}

export function canMutateSchedulerJobActorBillingRate(input: {
  clearing: boolean;
  hasExistingOverride: boolean;
  isCurrentBillingActor: boolean;
}): boolean {
  return input.isCurrentBillingActor
    || (input.clearing && input.hasExistingOverride);
}

export type SchedulerExpenseDto = {
  id: string;
  financeId: string;
  eventId: string | null;
  kind: ExpenseKind;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  reference: string | null;
  costAmount: number;
  billableAmount: number | null;
  effectiveBillableAmount: number;
  markupPct: number | null;
  billable: boolean;
  invoiced: boolean;
  reserved: boolean;
  invoiceId: string | null;
  incurredAt: string | null;
  attachments: SchedulerExpenseAttachmentDto[];
  createdAt: string;
  updatedAt: string;
};

export type SchedulerExpenseAttachmentDto = {
  id: string;
  expenseId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  downloadUrl: string;
};

export type SchedulerExpensePortfolioItemDto = SchedulerExpenseDto & {
  source: FinanceSource;
  job: JobMetadata;
  currency: string;
};

export type SchedulerInvoiceLineDto = {
  id: string;
  invoiceId: string;
  financeId: string;
  sortOrder: number;
  kind: InvoiceLineKind;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  showQuantityAndRate: boolean;
  expenseId: string | null;
  category: ExpenseCategory | null;
};

export type SchedulerInvoiceJobDto = {
  financeId: string;
  sortOrder: number;
  source: FinanceSource;
  job: JobMetadata;
  currentStatus: string;
  billingReference: string | null;
  subtotalExGst: number;
  lines: SchedulerInvoiceLineDto[];
};

export type SchedulerInvoiceListItemDto = {
  id: string;
  financeId: string;
  financeIds: string[];
  jobCount: number;
  jobNames: string[];
  sourceApps: FinanceSourceApp[];
  billToName: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  xeroInvoiceNumber: string | null;
  xeroDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  gstRate: number;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SchedulerInvoiceDto = SchedulerInvoiceListItemDto & {
  notes: string | null;
  sellerName: string;
  sellerAbn: string | null;
  sellerAddress: string | null;
  sellerEmail: string | null;
  billToName: string;
  billToAbn: string | null;
  billToAddress: string | null;
  billToEmail: string | null;
  purchaseOrderReference: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  job: JobMetadata & FinanceSource;
  jobs: SchedulerInvoiceJobDto[];
  lines: SchedulerInvoiceLineDto[];
};

export type SchedulerFinancialSummaryDto = {
  financeId: string;
  source: FinanceSource;
  event: {
    id: string;
    title: string;
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
    status: string;
  } | null;
  job: JobMetadata;
  amountBasis: 'ex_gst';
  currency: string;
  pricing: {
    mode: PricingMode;
    quotedAmount: number | null;
    notes: string | null;
  };
  billing: {
    name: string | null;
    abn: string | null;
    address: string | null;
    email: string | null;
    reference: string | null;
  };
  invoiceReadiness: {
    completionSatisfied: boolean;
    completionBasis: 'job' | null;
    hoursSatisfied: boolean;
    hoursBasis: 'app_time' | 'admin_override' | null;
    ready: boolean;
  };
  time: {
    scheduledHours: number;
    actualHours: number;
    actualMilliseconds: number;
    actualSource: 'active_sessions';
    actors: RecordedActorHoursDto[];
    billableHours: number;
    billableHoursOverride: number | null;
    billableHoursSource: 'default_zero' | 'override';
    costHours: number;
    costHoursOverride: number | null;
    costHoursSource: 'default_zero' | 'override';
    /** Weighted canonical per-user rate; null until every billed person has a rate. */
    billableRate: number | null;
    costRate: number;
    labourRevenue: number;
    labourCost: number;
    /** Recorded active hours minus total non-cancelled scheduled hours. */
    hoursVariance: number;
    /** Effective customer-billable hours minus effective internal-cost hours. */
    commercialHoursVariance: number;
    overrideReason: string | null;
    overrideSource: 'admin' | 'legacy_estimate' | null;
    overriddenAt: string | null;
    overriddenBy: { userId: string; displayName: string | null } | null;
    needsHoursReview: boolean;
    missingBillingRateUsers: Array<{ userId: string; displayName: string | null }>;
  };
  expenses: SchedulerExpenseDto[];
  invoices: SchedulerInvoiceListItemDto[];
  totals: {
    billableAmount: number;
    labourRevenue: number;
    expenseRevenue: number;
    totalCost: number;
    labourCost: number;
    expenseCost: number;
    invoicedAmount: number;
    reservedAmount: number;
    uninvoicedAmount: number;
    unbilledAmount: number;
    unbilledQuoteBalance: number;
    grossProfit: number;
    marginPct: number | null;
  };
};

export type SchedulerFinanceOverviewItemDto = {
  financeId: string;
  eventId: string | null;
  sourceApp: FinanceSourceApp;
  sourceType: FinanceSourceType;
  sourceId: string;
  jobName: string;
  clientName: string | null;
  siteName: string;
  siteAddress: string | null;
  userNames: string[];
  jobDate: string;
  jobStatus: string;
  eventStatus: string | null;
  invoiceReadiness: SchedulerFinancialSummaryDto['invoiceReadiness'];
  currency: string;
  actualHours: number;
  billableHours: number;
  costHours: number;
  billableAmount: number;
  totalCost: number;
  invoicedAmount: number;
  reservedAmount: number;
  unbilledAmount: number;
  grossProfit: number;
  marginPct: number | null;
  invoiceCount: number;
  hasOverdueInvoice: boolean;
  needsHoursReview: boolean;
};

export type FinanceUpdateInput = {
  pricingMode?: PricingMode;
  quotedAmount?: number | null;
  currency?: string;
  notes?: string | null;
  billingName?: string | null;
  billingAbn?: string | null;
  billingAddress?: string | null;
  billingEmail?: string | null;
  billingReference?: string | null;
  billableHoursOverride?: number | null;
  costHoursOverride?: number | null;
  overrideReason?: string | null;
  costRate?: number;
};

export type SchedulerJobActorBillingRateUpdateInput = {
  /** Null clears the job override so the latest global user default applies. */
  billingRateOverride: number | null;
};

export type ExpenseInput = {
  kind: ExpenseKind;
  category: ExpenseCategory;
  description: string;
  vendor?: string | null;
  reference?: string | null;
  costAmount: number;
  billableAmount?: number | null;
  billable?: boolean;
  incurredAt?: string | null;
};

export type InvoiceLineInput = {
  id?: string;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  showQuantityAndRate?: boolean;
  expenseId?: string | null;
  kind?: InvoiceLineKind;
  /** Required for every line on a consolidated invoice; single-job adapters may omit it. */
  financeId?: string;
};

export type QuickInvoiceInput = {
  expenseIds?: string[];
  includeLabour?: boolean;
  notes?: string | null;
};

export type UpdateDraftInvoiceInput = {
  /** Required by Scheduler HTTP routes; omitted only by the legacy Field adapter. */
  expectedUpdatedAt?: string;
  /** External reconciliation metadata; editable on every non-void invoice. */
  xeroInvoiceNumber?: string | null;
  /** Xero's calendar date in YYYY-MM-DD form, kept distinct from issueDate. */
  xeroDate?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  billToName?: string;
  billToAbn?: string | null;
  billToAddress?: string | null;
  billToEmail?: string | null;
  purchaseOrderReference?: string | null;
  /** Draft-only customer-facing charges and their optional quantity/rate presentation. */
  lines?: InvoiceLineInput[];
};

export type UpdateSchedulerInvoiceSellerInput = {
  sellerAbn: string | null;
  expectedUpdatedAt?: string;
};

export type ConsolidatedBillToInput = {
  name: string;
  abn?: string | null;
  address?: string | null;
  email?: string | null;
  purchaseOrderReference?: string | null;
};

export type ConsolidatedInvoiceJobInput = {
  financeId: string;
  expenseIds?: string[];
  includeLabour?: boolean;
};

export type ConsolidatedInvoiceInput = {
  jobs: ConsolidatedInvoiceJobInput[];
  billTo?: ConsolidatedBillToInput;
  notes?: string | null;
};

export type ConsolidatedInvoiceEligibilityJobDto = {
  financeId: string;
  source: FinanceSource;
  job: JobMetadata;
  currency: string;
  pricingMode: PricingMode;
  billing: SchedulerFinancialSummaryDto['billing'];
  invoiceReadiness: SchedulerFinancialSummaryDto['invoiceReadiness'];
  availableLabourHours: number;
  billableRate: number | null;
  availableLabourAmount: number;
  availableQuotedAmount: number;
  availableExpenses: SchedulerExpenseDto[];
};

export type ConsolidatedInvoiceEligibilityDto = {
  eligible: boolean;
  commonCurrency: string | null;
  gstRate: number;
  requiresExplicitBillTo: boolean;
  issues: Array<{
    code:
      | 'mixed_currency'
      | 'billing_name_missing'
      | 'bill_to_override_required'
      | 'job_not_completed'
      | 'billing_rate_missing'
      | 'no_available_charges';
    message: string;
    financeId: string | null;
  }>;
  jobs: ConsolidatedInvoiceEligibilityJobDto[];
};

export type SchedulerInvoicePortfolioResult = {
  items: SchedulerInvoiceListItemDto[];
  nextCursor: string | null;
};

export type SchedulerExpensePortfolioResult = {
  items: SchedulerExpensePortfolioItemDto[];
  nextCursor: string | null;
};

export type SchedulerFinancePortfolioSummaryDto = {
  complete: true;
  jobCount: number;
  statusCounts: Record<'draft' | 'issued' | 'paid' | 'void' | 'overdue', number>;
  currencies: Array<{
    currency: string;
    actualHours: number;
    billableHours: number;
    costHours: number;
    billableAmount: number;
    totalCost: number;
    invoicedAmount: number;
    reservedAmount: number;
    unbilledAmount: number;
    grossProfit: number;
    marginPct: number | null;
  }>;
};

const ACTIVE_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'paid'];
const ISSUED_INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'paid'];

type InvoiceCompletionReadiness = {
  satisfied: boolean;
  basis: 'job' | null;
};

type InvoiceHoursReadiness = {
  satisfied: boolean;
  basis: 'app_time' | 'admin_override' | null;
};

type HourOverrideForReadiness = Pick<
  typeof schedulerJobHourOverrides.$inferSelect,
  'source' | 'billableMilliseconds' | 'costMilliseconds'
> | null;

export function schedulerInvoiceCompletionReadiness(input: {
  jobStatus: string | null;
  completedAt: Date | string | null;
  schedulerEventStatus?: string | null;
}): InvoiceCompletionReadiness {
  // A status-only historical row is not auditable completed-work evidence.
  if (isCompletedSchedulerJobStatus(input.jobStatus ?? '') && input.completedAt) {
    return { satisfied: true, basis: 'job' };
  }
  if (input.schedulerEventStatus === 'done') {
    return { satisfied: true, basis: 'job' };
  }
  return { satisfied: false, basis: null };
}

async function schedulerManualCompletionReadiness(
  source: FinanceSource,
  executor: FinanceExecutor = db,
): Promise<InvoiceCompletionReadiness> {
  const [event] = await executor.select({ status: portalScheduleEvents.status })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, source.sourceApp),
      eq(portalScheduleEvents.sourceType, source.sourceType),
      eq(portalScheduleEvents.sourceId, source.sourceId),
    ))
    .orderBy(desc(portalScheduleEvents.updatedAt), desc(portalScheduleEvents.createdAt))
    .limit(1);
  return schedulerInvoiceCompletionReadiness({
    jobStatus: null,
    completedAt: null,
    schedulerEventStatus: event?.status ?? null,
  });
}

async function productOrSchedulerCompletionReadiness(
  source: FinanceSource,
  input: { jobStatus: string | null; completedAt: Date | string | null },
  executor: FinanceExecutor,
): Promise<InvoiceCompletionReadiness> {
  const productCompletion = schedulerInvoiceCompletionReadiness(input);
  return productCompletion.satisfied
    ? productCompletion
    : schedulerManualCompletionReadiness(source, executor);
}

/** Zero is a valid reviewed value, but both accounting hour values must be explicit without app time. */
export function schedulerInvoiceHoursReadiness(
  activeMilliseconds: number,
  override: HourOverrideForReadiness,
): InvoiceHoursReadiness {
  if (override?.source === 'legacy_estimate') return { satisfied: false, basis: null };
  if (activeMilliseconds > 0) {
    return {
      satisfied: true,
      basis: override?.source === 'admin' ? 'admin_override' : 'app_time',
    };
  }
  if (
    override?.source === 'admin'
    && override.billableMilliseconds !== null
    && override.costMilliseconds !== null
  ) return { satisfied: true, basis: 'admin_override' };
  return { satisfied: false, basis: null };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function centsToMoney(value: number): number {
  return round(value / 100, 2);
}

function millisecondsToHours(value: number): number {
  return round(value / 3_600_000, 4);
}

function requiredNonnegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest(`${field} must be a nonnegative number`);
  }
  return value;
}

function moneyToCents(value: unknown, field: string): number {
  const parsed = requiredNonnegativeNumber(value, field);
  const cents = Math.round(parsed * 100);
  if (!Number.isSafeInteger(cents)) throw badRequest(`${field} is too large`);
  return cents;
}

function accountingCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  return value;
}

function addAccountingCents(left: number, right: number, label: string): number {
  accountingCents(left, label);
  accountingCents(right, label);
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  return total;
}

function hoursAtRateCents(hours: number, rateCents: number, label: string): number {
  if (!Number.isFinite(hours) || hours < 0 || !Number.isSafeInteger(rateCents) || rateCents < 0) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  const hourUnits = Math.round(hours * 10_000);
  if (!Number.isSafeInteger(hourUnits)) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  const exact = (
    BigInt(hourUnits) * BigInt(rateCents) + 5_000n
  ) / 10_000n;
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  return Number(exact);
}

function hoursToMilliseconds(value: unknown, field: string): number {
  const parsed = requiredNonnegativeNumber(value, field);
  const milliseconds = Math.round(parsed * 3_600_000);
  if (!Number.isSafeInteger(milliseconds)) throw badRequest(`${field} is too large`);
  return milliseconds;
}

export function billableHoursToMilliseconds(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || !Number.isInteger(value)
  ) {
    throw badRequest('billableHoursOverride must be a nonnegative integer');
  }
  const milliseconds = value * 3_600_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw badRequest('billableHoursOverride is too large');
  }
  return milliseconds;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().slice(0, maximum) || null;
}

function requireText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim().slice(0, maximum);
}

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${field} must be a valid ISO datetime`);
  return parsed;
}

export function parseSchedulerInvoiceXeroDate(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest('xeroDate must be a valid YYYY-MM-DD calendar date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest('xeroDate must be a valid YYYY-MM-DD calendar date');
  }
  return value;
}

function assertInvoiceVersion(invoice: InvoiceRow, expectedUpdatedAt?: string): void {
  if (expectedUpdatedAt === undefined) return;
  const expected = parseDate(expectedUpdatedAt, 'expectedUpdatedAt');
  if (!expected || expected.getTime() !== invoice.updatedAt.getTime()) {
    throw conflict('Invoice changed; refresh before continuing');
  }
}

function isInvoiceEmailDeliveryInProgressDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    message?: unknown;
  };
  return candidate.constraint === 'scheduler_invoice_email_void_delivery_fence'
    || candidate.constraint_name === 'scheduler_invoice_email_void_delivery_fence'
    || (
      candidate.code === '23514'
      && typeof candidate.message === 'string'
      && candidate.message.includes('scheduler_invoice_email_delivery_in_progress')
    )
    || (
      candidate.cause !== error
      && isInvoiceEmailDeliveryInProgressDatabaseError(candidate.cause)
    );
}

export function nextSchedulerInvoiceRevisionAt(
  previousUpdatedAt: Date,
  now = new Date(),
): Date {
  return new Date(Math.max(now.getTime(), previousUpdatedAt.getTime() + 1));
}

function nextInvoiceUpdatedAt(invoice: InvoiceRow, now = new Date()): Date {
  return nextSchedulerInvoiceRevisionAt(invoice.updatedAt, now);
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isSchedulerInvoiceDueDateBeforeIssueDate(
  dueDate: Date,
  issueDate: Date,
): boolean {
  return utcDateKey(dueDate) < utcDateKey(issueDate);
}

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function dateOnly(value: string | null | undefined, fallback: Date): string {
  if (value) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) {
      const candidate = match[1]!;
      const calendarDate = new Date(`${candidate}T00:00:00.000Z`);
      if (
        !Number.isNaN(calendarDate.getTime())
        && calendarDate.toISOString().slice(0, 10) === candidate
      ) return candidate;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return fallback.toISOString().slice(0, 10);
}

function isSupportedSource(
  source: Pick<FinanceSource, 'sourceApp' | 'sourceType' | 'sourceId'>,
): source is FinanceSource {
  return Boolean(source.sourceId)
    && (
      (source.sourceApp === 'ecoaudit' && source.sourceType === 'audit')
      || (source.sourceApp === 'solarsense' && source.sourceType === 'assessment')
      || (source.sourceApp === 'installhub' && source.sourceType === 'installation')
    );
}

export function isCompletedSchedulerJobStatus(status: string): boolean {
  return status.trim().toLocaleLowerCase('en-AU') === 'completed';
}

function sourceFromEvent(event: ScheduleEventRow): FinanceSource {
  const source = {
    sourceApp: event.sourceApp,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
  };
  if (!isSupportedSource(source as FinanceSource)) {
    throw badRequest('Scheduler event does not have a supported commercial source job');
  }
  assertSchedulerFinanceSourceAppVisible(source.sourceApp);
  return source as FinanceSource;
}

function schedulerVisibleCommercialSourceApps(): FinanceSourceApp[] {
  return schedulerVisibleFinanceSourceApps();
}

function isSchedulerFinanceSourceAppVisible(sourceApp: string): boolean {
  return isSchedulerSourceAppVisible(sourceApp);
}

function assertSchedulerFinanceSourceAppVisible(sourceApp: string): void {
  assertSchedulerSourceAppVisible(sourceApp);
}

function schedulerInvoiceVisibilityConditions(): SQL[] {
  const visibleApps = schedulerVisibleCommercialSourceApps();
  const hiddenApps = (['ecoaudit', 'solarsense', 'installhub'] as const)
    .filter((app) => !visibleApps.includes(app));
  if (hiddenApps.length === 0) return [];
  return [
    notInArray(schedulerInvoices.jobSourceApp, hiddenApps),
    notInArray(
      schedulerInvoices.id,
      db.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
        .from(schedulerInvoiceJobs)
        .where(inArray(schedulerInvoiceJobs.jobSourceApp, hiddenApps)),
    ),
  ];
}

function invoiceJobsAreVisible(jobs: InvoiceJobRow[]): boolean {
  return areSchedulerSourceAppsVisible(jobs.map((job) => job.jobSourceApp));
}

function assertInvoiceJobsVisible(jobs: InvoiceJobRow[]): void {
  if (!invoiceJobsAreVisible(jobs)) throw notFound('Invoice');
}

async function requireGlobalFinanceAdmin(
  user: AuthUser,
  executor: FinanceExecutor = db,
): Promise<FinanceActor> {
  if (user.role !== 'admin' || !['ecoaudit', 'solarsense', 'installhub'].includes(user.app)) {
    throw forbidden('Only global administrators can access scheduler finances');
  }
  const [actor] = await executor.select({
    globalUserId: globalUsers.id,
    fullName: globalUsers.fullName,
    displayEmail: globalUsers.displayEmail,
  }).from(unifiedUsers)
    .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
      eq(unifiedUsers.isActive, true),
      isNull(unifiedUsers.deletedAt),
      eq(globalUsers.isActive, true),
      eq(globalUsers.role, 'admin'),
    ))
    .limit(1);
  if (!actor) throw forbidden('Only active global administrators can access scheduler finances');
  return {
    globalUserId: actor.globalUserId,
    displayName: actor.fullName?.trim() || actor.displayEmail,
  };
}

/** Authorization gate shared by durable Scheduler invoice export routes. */
export async function assertGlobalFinanceAdmin(user: AuthUser): Promise<void> {
  await requireGlobalFinanceAdmin(user);
}

async function loadEvent(eventId: string, executor: FinanceExecutor = db): Promise<ScheduleEventRow> {
  const [event] = await executor.select().from(portalScheduleEvents)
    .where(eq(portalScheduleEvents.id, eventId))
    .limit(1);
  if (!event) throw notFound('Schedule event');
  sourceFromEvent(event);
  return event;
}

async function latestEventForSource(
  source: FinanceSource,
  executor: FinanceExecutor = db,
): Promise<ScheduleEventRow | null> {
  const rows = await executor.select().from(portalScheduleEvents).where(and(
    eq(portalScheduleEvents.sourceApp, source.sourceApp),
    eq(portalScheduleEvents.sourceType, source.sourceType),
    eq(portalScheduleEvents.sourceId, source.sourceId),
  )).orderBy(desc(portalScheduleEvents.updatedAt), desc(portalScheduleEvents.createdAt));
  return rows.find((row) => row.status === 'planned' || row.status === 'in_progress')
    ?? rows[0]
    ?? null;
}

async function loadJobMetadata(
  source: FinanceSource,
  event: ScheduleEventRow | null,
  executor: FinanceExecutor = db,
): Promise<JobMetadata> {
  const fallbackDate = event?.scheduledStartAt ?? new Date();
  const schedulerCompleted = event?.status === 'done';
  if (source.sourceApp === 'ecoaudit') {
    const [audit] = await executor.select().from(eaAudits)
      .where(eq(eaAudits.id, source.sourceId)).limit(1);
    if (audit) {
      return {
        jobName: audit.siteName,
        jobDate: dateOnly(audit.auditDate, audit.createdAt),
        clientName: null,
        siteName: audit.siteName,
        siteAddress: audit.siteAddress,
        status: audit.deletedAt ? 'Deleted' : schedulerCompleted ? 'Completed' : audit.status,
      };
    }
  } else if (source.sourceApp === 'solarsense') {
    const [assessment] = await executor.select({
      siteName: ssRooftopAssessments.siteName,
      buildingName: ssRooftopAssessments.buildingIdName,
      status: ssRooftopAssessments.status,
      deletedAt: ssRooftopAssessments.deletedAt,
      createdAt: ssRooftopAssessments.createdAt,
      siteLocation: ssSites.location,
      assessmentDate: ssSites.dateOfAssessment,
    }).from(ssRooftopAssessments)
      .leftJoin(ssSites, eq(ssSites.id, ssRooftopAssessments.siteId))
      .where(eq(ssRooftopAssessments.id, source.sourceId))
      .limit(1);
    if (assessment) {
      return {
        jobName: `${assessment.siteName} · ${assessment.buildingName}`,
        jobDate: dateOnly(assessment.assessmentDate, assessment.createdAt),
        clientName: null,
        siteName: assessment.siteName,
        siteAddress: assessment.siteLocation,
        status: assessment.deletedAt ? 'Deleted' : schedulerCompleted ? 'Completed' : assessment.status,
      };
    }
  } else {
    const [installation] = await executor.select().from(ihInstallations)
      .where(eq(ihInstallations.id, source.sourceId)).limit(1);
    if (installation) {
      return {
        jobName: installation.siteName,
        jobDate: dateOnly(installation.auditDate, installation.createdAt),
        clientName: installation.clientName,
        siteName: installation.siteName,
        siteAddress: installation.siteAddress,
        status: installation.deletedAt ? 'Deleted' : schedulerCompleted ? 'Completed' : installation.status,
      };
    }
  }
  const [snapshot] = await executor.select({
    jobName: schedulerInvoices.jobName,
    jobDate: schedulerInvoices.jobDate,
    clientName: schedulerInvoices.jobClientName,
    siteName: schedulerInvoices.jobSiteName,
    siteAddress: schedulerInvoices.jobSiteAddress,
    status: schedulerInvoices.jobStatus,
  }).from(schedulerInvoices).where(and(
    eq(schedulerInvoices.jobSourceApp, source.sourceApp),
    eq(schedulerInvoices.jobSourceType, source.sourceType),
    eq(schedulerInvoices.jobSourceId, source.sourceId),
  )).orderBy(desc(schedulerInvoices.createdAt)).limit(1);
  if (snapshot) return snapshot;
  if (!event) {
    const [ledger] = await executor.select({ createdAt: schedulerJobFinance.createdAt })
      .from(schedulerJobFinance)
      .where(and(
        eq(schedulerJobFinance.sourceApp, source.sourceApp),
        eq(schedulerJobFinance.sourceType, source.sourceType),
        eq(schedulerJobFinance.sourceId, source.sourceId),
      ))
      .limit(1);
    if (!ledger) throw notFound('Source job');
    const sourceLabel = source.sourceApp === 'ecoaudit'
      ? 'EcoAudit audit'
      : source.sourceApp === 'solarsense'
        ? 'SolarSense assessment'
        : 'Field installation';
    const deletedJobName = `Deleted ${sourceLabel} ${source.sourceId}`;
    return {
      jobName: deletedJobName,
      jobDate: ledger.createdAt.toISOString().slice(0, 10),
      clientName: null,
      siteName: deletedJobName,
      siteAddress: null,
      status: 'Deleted',
    };
  }
  return {
    jobName: event.title,
    jobDate: fallbackDate.toISOString().slice(0, 10),
    clientName: null,
    siteName: event.title,
    siteAddress: null,
    status: event.status,
  };
}

async function sourceCompletionReadiness(
  source: FinanceSource,
  executor: FinanceExecutor = db,
  lock = false,
): Promise<InvoiceCompletionReadiness> {
  if (source.sourceApp === 'ecoaudit') {
    const rows = lock
      ? await executor.select({
          status: eaAudits.status,
          completedAt: eaAudits.completedAt,
          deletedAt: eaAudits.deletedAt,
        }).from(eaAudits)
          .where(eq(eaAudits.id, source.sourceId))
          .for('share')
          .limit(1)
      : await executor.select({
          status: eaAudits.status,
          completedAt: eaAudits.completedAt,
          deletedAt: eaAudits.deletedAt,
        }).from(eaAudits)
          .where(eq(eaAudits.id, source.sourceId))
          .limit(1);
    const audit = rows[0];
    if (!audit || audit.deletedAt) return { satisfied: false, basis: null };
    return productOrSchedulerCompletionReadiness(source, {
      jobStatus: audit.status,
      completedAt: audit.completedAt,
    }, executor);
  }

  if (source.sourceApp === 'installhub') {
    const rows = lock
      ? await executor.select({
          status: ihInstallations.status,
          completedAt: ihInstallations.completedAt,
          deletedAt: ihInstallations.deletedAt,
        }).from(ihInstallations)
          .where(eq(ihInstallations.id, source.sourceId))
          .for('share')
          .limit(1)
      : await executor.select({
          status: ihInstallations.status,
          completedAt: ihInstallations.completedAt,
          deletedAt: ihInstallations.deletedAt,
        }).from(ihInstallations)
          .where(eq(ihInstallations.id, source.sourceId))
          .limit(1);
    const installation = rows[0];
    if (!installation || installation.deletedAt) return { satisfied: false, basis: null };
    return productOrSchedulerCompletionReadiness(source, {
      jobStatus: installation.status,
      completedAt: installation.completedAt,
    }, executor);
  }

  const assessmentRows = lock
    ? await executor.select({
        status: ssRooftopAssessments.status,
        completedAt: ssRooftopAssessments.completedAt,
        deletedAt: ssRooftopAssessments.deletedAt,
      }).from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, source.sourceId))
        .for('share')
        .limit(1)
    : await executor.select({
        status: ssRooftopAssessments.status,
        completedAt: ssRooftopAssessments.completedAt,
        deletedAt: ssRooftopAssessments.deletedAt,
      }).from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, source.sourceId))
        .limit(1);
  const assessment = assessmentRows[0];
  if (!assessment || assessment.deletedAt) {
    return { satisfied: false, basis: null };
  }
  return productOrSchedulerCompletionReadiness(source, {
    jobStatus: assessment.status,
    completedAt: assessment.completedAt,
  }, executor);
}

function assertInvoiceCompletionReady(
  source: FinanceSource,
  jobName: string,
  completion: InvoiceCompletionReadiness,
): void {
  if (completion.satisfied) return;
  const instruction = source.sourceApp === 'solarsense'
    ? 'Mark the assessment complete'
    : 'Mark the job complete';
  throw conflict(
    `${jobName} must be completed before an invoice can be generated. ${instruction} before generating an invoice`,
  );
}

async function currentJobStatusForSource(
  source: FinanceSource,
  executor: FinanceExecutor = db,
  lock = false,
): Promise<string> {
  if (source.sourceApp === 'ecoaudit') {
    const query = executor.select({
      status: eaAudits.status,
      deletedAt: eaAudits.deletedAt,
    }).from(eaAudits).where(eq(eaAudits.id, source.sourceId)).limit(1);
    const [job] = lock ? await query.for('update') : await query;
    if (!job || job.deletedAt) return 'Deleted';
    if (isCompletedSchedulerJobStatus(job.status)) return job.status;
    return (await schedulerManualCompletionReadiness(source, executor)).satisfied
      ? 'Completed'
      : job.status;
  }
  if (source.sourceApp === 'solarsense') {
    const query = executor.select({
      status: ssRooftopAssessments.status,
      deletedAt: ssRooftopAssessments.deletedAt,
    }).from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, source.sourceId)).limit(1);
    const [job] = lock ? await query.for('update') : await query;
    if (!job || job.deletedAt) return 'Deleted';
    if (isCompletedSchedulerJobStatus(job.status)) return job.status;
    return (await schedulerManualCompletionReadiness(source, executor)).satisfied
      ? 'Completed'
      : job.status;
  }
  const query = executor.select({
    status: ihInstallations.status,
    deletedAt: ihInstallations.deletedAt,
  }).from(ihInstallations).where(eq(ihInstallations.id, source.sourceId)).limit(1);
  const [job] = lock ? await query.for('update') : await query;
  if (!job || job.deletedAt) return 'Deleted';
  if (isCompletedSchedulerJobStatus(job.status)) return job.status;
  return (await schedulerManualCompletionReadiness(source, executor)).satisfied
    ? 'Completed'
    : job.status;
}

function financeSourceKey(source: FinanceSource): string {
  return `${source.sourceApp}\u0000${source.sourceType}\u0000${source.sourceId}`;
}

async function lockCurrentCompletionReadiness(
  sources: FinanceSource[],
  executor: FinanceExecutor,
): Promise<Map<string, InvoiceCompletionReadiness>> {
  const uniqueSources = new Map(sources.map((source) => [financeSourceKey(source), source]));
  const readiness = new Map<string, InvoiceCompletionReadiness>();
  for (const [key, source] of [...uniqueSources.entries()].sort(([left], [right]) => (
    compareLockKeys(left, right)
  ))) {
    readiness.set(key, await sourceCompletionReadiness(source, executor, true));
  }
  return readiness;
}

async function scheduledHoursForSource(
  source: FinanceSource,
  executor: FinanceExecutor = db,
): Promise<number> {
  const rows = await executor.select({
    start: portalScheduleEvents.scheduledStartAt,
    end: portalScheduleEvents.scheduledEndAt,
  }).from(portalScheduleEvents).where(and(
    eq(portalScheduleEvents.sourceApp, source.sourceApp),
    eq(portalScheduleEvents.sourceType, source.sourceType),
    eq(portalScheduleEvents.sourceId, source.sourceId),
    ne(portalScheduleEvents.status, 'cancelled'),
  ));
  return round(rows.reduce((hours, row) => {
    if (!row.end) return hours;
    return hours + Math.max(0, (row.end.getTime() - row.start.getTime()) / 3_600_000);
  }, 0), 4);
}

export type RecordedWorkSessionTelemetry = {
  actorUserId: string;
  activeMilliseconds: number;
};

export type RecordedActorTime = {
  actorUserId: string;
  activeMilliseconds: number;
};

/**
 * Aggregates only persisted observation windows. For an open session the last
 * activity checkpoint is the observation boundary; current time and gaps
 * between separate sessions are deliberately excluded.
 */
export type ResolvedRecordedActorTime = {
  userId: string;
  displayName: string | null;
  activeMilliseconds: number;
  billingRateCents: number | null;
  billingRateEditable: boolean;
};

/** Origin and Field IDs can both identify one canonical worker after a transfer/sync. */
export function mergeResolvedRecordedActorTime(
  actors: readonly ResolvedRecordedActorTime[],
): ResolvedRecordedActorTime[] {
  const byUser = new Map<string, ResolvedRecordedActorTime>();
  for (const actor of actors) {
    const current = byUser.get(actor.userId);
    if (!current) {
      byUser.set(actor.userId, { ...actor });
      continue;
    }
    const activeMilliseconds = current.activeMilliseconds + actor.activeMilliseconds;
    if (
      !Number.isSafeInteger(activeMilliseconds)
      || activeMilliseconds < 0
      || (
        current.billingRateCents !== null
        && actor.billingRateCents !== null
        && current.billingRateCents !== actor.billingRateCents
      )
    ) {
      throw conflict('Resolved worker time exceeds the supported accounting range');
    }
    byUser.set(actor.userId, {
      userId: actor.userId,
      displayName: current.displayName ?? actor.displayName,
      activeMilliseconds,
      billingRateCents: current.billingRateCents ?? actor.billingRateCents,
      billingRateEditable: current.billingRateEditable || actor.billingRateEditable,
    });
  }
  return [...byUser.values()];
}

export function aggregateRecordedSessionTime(
  sessions: readonly RecordedWorkSessionTelemetry[],
): {
  activeMilliseconds: number;
  actors: RecordedActorTime[];
} {
  const byActor = new Map<string, number>();
  let activeMilliseconds = 0;
  for (const session of sessions) {
    const nextActorActive = (byActor.get(session.actorUserId) ?? 0)
      + session.activeMilliseconds;
    const nextActive = activeMilliseconds + session.activeMilliseconds;
    if (
      !Number.isSafeInteger(nextActorActive)
      || !Number.isSafeInteger(nextActive)
      || nextActorActive < 0
    ) {
      throw conflict('Recorded session time exceeds the supported accounting range');
    }
    byActor.set(session.actorUserId, nextActorActive);
    activeMilliseconds = nextActive;
  }
  return {
    activeMilliseconds,
    actors: [...byActor.entries()].map(([actorUserId, actorActiveMilliseconds]) => ({
      actorUserId,
      activeMilliseconds: actorActiveMilliseconds,
    })),
  };
}

async function recordedHoursForSource(
  source: FinanceSource,
  executor: FinanceExecutor = db,
): Promise<{
  activeMilliseconds: number;
  actors: RecordedActorHoursDto[];
}> {
  let sessions: RecordedWorkSessionTelemetry[];
  if (source.sourceApp === 'ecoaudit') {
    sessions = await executor.select({
      actorUserId: eaAuditWorkSessions.actorUserId,
      activeMilliseconds: eaAuditWorkSessions.activeMilliseconds,
    }).from(eaAuditWorkSessions).where(eq(eaAuditWorkSessions.auditId, source.sourceId));
  } else if (source.sourceApp === 'solarsense') {
    sessions = await executor.select({
      actorUserId: ssAssessmentWorkSessions.actorUserId,
      activeMilliseconds: ssAssessmentWorkSessions.activeMilliseconds,
    }).from(ssAssessmentWorkSessions)
      .where(eq(ssAssessmentWorkSessions.assessmentId, source.sourceId));
  } else {
    sessions = await executor.select({
      actorUserId: ihInstallationWorkSessions.actorUserId,
      activeMilliseconds: ihInstallationWorkSessions.activeMilliseconds,
    }).from(ihInstallationWorkSessions)
      .where(eq(ihInstallationWorkSessions.installationId, source.sourceId));
  }

  const recorded = aggregateRecordedSessionTime(sessions);
  const actorIds = recorded.actors.map((actor) => actor.actorUserId);
  const memberships = actorIds.length === 0 ? [] : await executor.select({
    originUserId: unifiedUsers.originUserId,
    fieldUserId: unifiedUsers.fieldUserId,
    globalUserId: globalUsers.id,
    fullName: globalUsers.fullName,
    displayEmail: globalUsers.displayEmail,
    billingRateCents: globalUsers.billingRateCents,
  }).from(unifiedUsers)
    .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
    .where(and(
      eq(unifiedUsers.originApp, source.sourceApp),
      or(
        inArray(unifiedUsers.originUserId, actorIds),
        inArray(unifiedUsers.fieldUserId, actorIds),
      ),
    ));
  const memberByActor = new Map<string, typeof memberships[number]>();
  for (const membership of memberships) {
    memberByActor.set(membership.originUserId, membership);
    memberByActor.set(membership.fieldUserId, membership);
  }
  const unresolvedActorIds = actorIds.filter((actorId) => !memberByActor.has(actorId));
  let sourceUsers: Array<{ id: string; fullName: string | null; email: string }> = [];
  if (unresolvedActorIds.length > 0) {
    if (source.sourceApp === 'ecoaudit') {
      sourceUsers = await executor.select({
        id: eaUsers.id,
        fullName: eaUsers.fullName,
        email: eaUsers.email,
      }).from(eaUsers).where(inArray(eaUsers.id, unresolvedActorIds));
    } else if (source.sourceApp === 'solarsense') {
      sourceUsers = await executor.select({
        id: ssUsers.id,
        fullName: ssUsers.fullName,
        email: ssUsers.email,
      }).from(ssUsers).where(inArray(ssUsers.id, unresolvedActorIds));
    } else {
      sourceUsers = await executor.select({
        id: ihUsers.id,
        fullName: ihUsers.fullName,
        email: ihUsers.email,
      }).from(ihUsers).where(inArray(ihUsers.id, unresolvedActorIds));
    }
  }
  const sourceUserById = new Map(sourceUsers.map((user) => [user.id, user]));
  const resolvedActors = recorded.actors.map((actorTime): ResolvedRecordedActorTime => {
    const { actorUserId, activeMilliseconds } = actorTime;
    const membership = memberByActor.get(actorUserId);
    const sourceUser = sourceUserById.get(actorUserId);
    const billingRateCents = membership?.billingRateCents ?? null;
    return {
      userId: membership?.globalUserId ?? actorUserId,
      displayName: membership
        ? membership.fullName?.trim() || membership.displayEmail
        : sourceUser?.fullName?.trim() || sourceUser?.email || null,
      activeMilliseconds,
      billingRateCents: membership?.billingRateCents ?? null,
      billingRateEditable: Boolean(membership),
    };
  });
  const actors = mergeResolvedRecordedActorTime(resolvedActors).map(
    (actorTime): RecordedActorHoursDto => {
    const {
      userId,
      displayName,
      activeMilliseconds,
      billingRateCents,
      billingRateEditable,
    } = actorTime;
    return {
      userId,
      displayName,
      activeMilliseconds,
      hours: millisecondsToHours(activeMilliseconds),
      billingRate: billingRateCents === null ? null : centsToMoney(billingRateCents),
      defaultBillingRate: billingRateCents === null ? null : centsToMoney(billingRateCents),
      billingRateOverride: null,
      effectiveBillingRate: billingRateCents === null ? null : centsToMoney(billingRateCents),
      billingRateSource: billingRateCents === null ? 'missing' : 'global_default',
      labourAmount: billingRateCents === null
        ? null
        : centsToMoney(hoursAtRateCents(
            millisecondsToHours(activeMilliseconds),
            billingRateCents,
            'Recorded labour',
          )),
      billingRateEditable,
      };
    },
  ).sort((left, right) => right.activeMilliseconds - left.activeMilliseconds);
  return {
    activeMilliseconds: recorded.activeMilliseconds,
    actors,
  };
}

async function billingActorsForSource(
  source: FinanceSource,
  recorded: {
    activeMilliseconds: number;
    actors: RecordedActorHoursDto[];
  },
  event: ScheduleEventRow | null,
  executor: FinanceExecutor,
): Promise<RecordedActorHoursDto[]> {
  if (recorded.actors.length > 0) return recorded.actors;
  let fieldUserId = event?.assigneeFieldUserId ?? null;
  let originUserId: string | null = null;
  if (!fieldUserId) {
    if (source.sourceApp === 'ecoaudit') {
      const [job] = await executor.select({
        assignedInspectorUserId: eaAudits.assignedInspectorUserId,
      }).from(eaAudits).where(eq(eaAudits.id, source.sourceId)).limit(1);
      originUserId = job?.assignedInspectorUserId ?? null;
    } else if (source.sourceApp === 'solarsense') {
      const [job] = await executor.select({
        assignedInspectorUserId: ssRooftopAssessments.assignedInspectorUserId,
      }).from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, source.sourceId))
        .limit(1);
      originUserId = job?.assignedInspectorUserId ?? null;
    } else {
      const [job] = await executor.select({
        assignedInspectorUserId: ihInstallations.assignedInspectorUserId,
      }).from(ihInstallations).where(eq(ihInstallations.id, source.sourceId)).limit(1);
      fieldUserId = job?.assignedInspectorUserId ?? null;
    }
  }
  if (!fieldUserId && !originUserId) return [];
  const [assignee] = await executor.select({
    id: globalUsers.id,
    fullName: globalUsers.fullName,
    displayEmail: globalUsers.displayEmail,
    billingRateCents: globalUsers.billingRateCents,
  }).from(unifiedUsers)
    .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
    .where(and(
      eq(unifiedUsers.originApp, source.sourceApp),
      fieldUserId
        ? eq(unifiedUsers.fieldUserId, fieldUserId)
        : eq(unifiedUsers.originUserId, originUserId!),
    ))
    .limit(1);
  if (!assignee) return [];
  return [{
    userId: assignee.id,
    displayName: assignee.fullName?.trim() || assignee.displayEmail,
    activeMilliseconds: 0,
    hours: 0,
    billingRate: assignee.billingRateCents === null
      ? null
      : centsToMoney(assignee.billingRateCents),
    defaultBillingRate: assignee.billingRateCents === null
      ? null
      : centsToMoney(assignee.billingRateCents),
    billingRateOverride: null,
    effectiveBillingRate: assignee.billingRateCents === null
      ? null
      : centsToMoney(assignee.billingRateCents),
    billingRateSource: assignee.billingRateCents === null ? 'missing' : 'global_default',
    labourAmount: assignee.billingRateCents === null ? null : 0,
    billingRateEditable: true,
  }];
}

export function applySchedulerActorBillingRateOverrides(
  actors: readonly RecordedActorHoursDto[],
  overrides: ReadonlyArray<{ globalUserId: string; billingRateCents: number }>,
): RecordedActorHoursDto[] {
  const overrideByUser = new Map(
    overrides.map((override) => [override.globalUserId, override.billingRateCents]),
  );
  return actors.map((actor) => {
    const defaultBillingRateCents = actor.defaultBillingRate === null
      ? null
      : moneyToCents(actor.defaultBillingRate, 'defaultBillingRate');
    const resolution = resolveSchedulerActorBillingRate({
      defaultBillingRateCents,
      billingRateOverrideCents: actor.billingRateEditable
        ? overrideByUser.get(actor.userId) ?? null
        : null,
    });
    const billingRateOverride = resolution.billingRateOverrideCents === null
      ? null
      : centsToMoney(resolution.billingRateOverrideCents);
    const effectiveBillingRate = resolution.effectiveBillingRateCents === null
      ? null
      : centsToMoney(resolution.effectiveBillingRateCents);
    return {
      ...actor,
      billingRate: effectiveBillingRate,
      billingRateOverride,
      effectiveBillingRate,
      billingRateSource: resolution.billingRateSource,
      labourAmount: resolution.effectiveBillingRateCents === null
        ? null
        : centsToMoney(hoursAtRateCents(
            actor.hours,
            resolution.effectiveBillingRateCents,
            'Recorded labour',
          )),
    };
  });
}

async function applyStoredSchedulerActorBillingRateOverrides(
  financeId: string,
  actors: readonly RecordedActorHoursDto[],
  executor: FinanceExecutor,
): Promise<RecordedActorHoursDto[]> {
  const globalUserIds = [...new Set(
    actors.filter((actor) => actor.billingRateEditable).map((actor) => actor.userId),
  )];
  if (globalUserIds.length === 0) return [...actors];
  const overrides = await executor.select({
    globalUserId: schedulerJobActorBillingRateOverrides.globalUserId,
    billingRateCents: schedulerJobActorBillingRateOverrides.billingRateCents,
  }).from(schedulerJobActorBillingRateOverrides).where(and(
    eq(schedulerJobActorBillingRateOverrides.financeId, financeId),
    inArray(schedulerJobActorBillingRateOverrides.globalUserId, globalUserIds),
  ));
  return applySchedulerActorBillingRateOverrides(actors, overrides);
}

export function effectiveUserLabourBilling(
  actors: ReadonlyArray<Pick<
    RecordedActorHoursDto,
    'userId' | 'displayName' | 'hours' | 'billingRate'
  >>,
  effectiveHours: number,
): {
  labourRevenueCents: number;
  weightedRateCents: number | null;
  missingBillingRateUsers: Array<{ userId: string; displayName: string | null }>;
} {
  const configuredMissingRates = actors
    .filter((actor) => actor.billingRate === null)
    .map((actor) => ({ userId: actor.userId, displayName: actor.displayName }));
  if (effectiveHours <= 0) {
    return {
      labourRevenueCents: 0,
      weightedRateCents: null,
      missingBillingRateUsers: configuredMissingRates,
    };
  }
  const recordedHours = actors.reduce((total, actor) => total + actor.hours, 0);
  const allocations = actors.length === 1 && recordedHours <= 0
    ? [{ actor: actors[0]!, hours: effectiveHours }]
    : actors
        .filter((actor) => actor.hours > 0)
        .map((actor) => ({
          actor,
          hours: recordedHours > 0 ? effectiveHours * (actor.hours / recordedHours) : 0,
        }));
  const missingBillingRateUsers = allocations.length === 0
    ? configuredMissingRates.length > 0
      ? configuredMissingRates
      : [{ userId: 'unassigned', displayName: 'Unassigned billing user' }]
    : configuredMissingRates;
  if (allocations.length === 0 || missingBillingRateUsers.length > 0) {
    return { labourRevenueCents: 0, weightedRateCents: null, missingBillingRateUsers };
  }
  const labourRevenueCents = allocations.reduce((total, { actor, hours }) => (
    addAccountingCents(
      total,
      hoursAtRateCents(hours, moneyToCents(actor.billingRate!, 'billingRate'), 'Labour revenue'),
      'Labour revenue',
    )
  ), 0);
  const weightedRateCents = effectiveHours > 0
    ? Math.round(labourRevenueCents / effectiveHours)
    : null;
  return { labourRevenueCents, weightedRateCents, missingBillingRateUsers: [] };
}

async function ensureFinance(
  source: FinanceSource,
  metadata: JobMetadata,
  executor: FinanceExecutor = db,
  options: { allowDeletedSource?: boolean } = {},
): Promise<FinanceRow> {
  // A plain database executor would release an advisory transaction lock at
  // the end of each statement. Wrap the complete check/insert/read sequence so
  // hard purge and finance creation share one durable source-identity mutex.
  if (executor === db) {
    return db.transaction((tx) => ensureFinance(source, metadata, tx, options));
  }
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      ${schedulerFinanceSourceMutexKey(source)},
      0
    ))
  `);
  const [existing] = await executor.select().from(schedulerJobFinance).where(and(
    eq(schedulerJobFinance.sourceApp, source.sourceApp),
    eq(schedulerJobFinance.sourceType, source.sourceType),
    eq(schedulerJobFinance.sourceId, source.sourceId),
  )).limit(1);
  if (existing) return existing;

  const activeSource = source.sourceApp === 'ecoaudit'
    ? await executor.select({ id: eaAudits.id }).from(eaAudits).where(
        options.allowDeletedSource
          ? eq(eaAudits.id, source.sourceId)
          : and(eq(eaAudits.id, source.sourceId), isNull(eaAudits.deletedAt)),
      ).limit(1)
    : source.sourceApp === 'solarsense'
      ? await executor.select({ id: ssRooftopAssessments.id }).from(ssRooftopAssessments).where(
          options.allowDeletedSource
            ? eq(ssRooftopAssessments.id, source.sourceId)
            : and(
                eq(ssRooftopAssessments.id, source.sourceId),
                isNull(ssRooftopAssessments.deletedAt),
              ),
        ).limit(1)
      : await executor.select({ id: ihInstallations.id }).from(ihInstallations).where(
          options.allowDeletedSource
            ? eq(ihInstallations.id, source.sourceId)
            : and(eq(ihInstallations.id, source.sourceId), isNull(ihInstallations.deletedAt)),
        ).limit(1);
  if (!activeSource[0]) throw notFound('Source job');

  const now = new Date();
  await executor.insert(schedulerJobFinance).values({
    id: randomUUID(),
    sourceApp: source.sourceApp,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    pricingMode: 'charge_up',
    quotedAmountCents: null,
    currency: 'AUD',
    notes: null,
    billToName: metadata.clientName ?? metadata.siteName,
    billToAbn: null,
    billToAddress: metadata.siteAddress,
    billToEmail: null,
    billingReference: null,
    billableRateCents: moneyToCents(
      config.schedulerFinance.defaultBillableRate,
      'defaultBillableRate',
    ),
    costRateCents: moneyToCents(config.schedulerFinance.defaultCostRate, 'defaultCostRate'),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({
    target: [
      schedulerJobFinance.sourceApp,
      schedulerJobFinance.sourceType,
      schedulerJobFinance.sourceId,
    ],
  });
  const [finance] = await executor.select().from(schedulerJobFinance).where(and(
    eq(schedulerJobFinance.sourceApp, source.sourceApp),
    eq(schedulerJobFinance.sourceType, source.sourceType),
    eq(schedulerJobFinance.sourceId, source.sourceId),
  )).limit(1);
  if (!finance) throw new Error('scheduler_finance_create_failed');
  return finance;
}

async function latestHourOverrideRecord(
  financeId: string,
  executor: FinanceExecutor = db,
) {
  const [latest] = await executor.select().from(schedulerJobHourOverrides)
    .where(eq(schedulerJobHourOverrides.financeId, financeId))
    .orderBy(desc(schedulerJobHourOverrides.revision))
    .limit(1);
  return latest ?? null;
}

async function latestHourOverride(
  financeId: string,
  executor: FinanceExecutor = db,
) {
  const latest = await latestHourOverrideRecord(financeId, executor);
  return latest?.action === 'set' ? latest : null;
}

function legacyInvoiceJobRow(row: InvoiceRow): InvoiceJobRow {
  return {
    invoiceId: row.id,
    financeId: row.financeId,
    sortOrder: 0,
    billingReference: row.purchaseOrderReference,
    jobSiteName: row.jobSiteName,
    jobSiteAddress: row.jobSiteAddress,
    jobName: row.jobName,
    jobDate: row.jobDate,
    jobClientName: row.jobClientName,
    jobStatus: row.jobStatus,
    jobSourceApp: row.jobSourceApp,
    jobSourceType: row.jobSourceType,
    jobSourceId: row.jobSourceId,
    createdAt: row.createdAt,
  };
}

function invoiceListItem(
  row: InvoiceRow,
  jobRows: InvoiceJobRow[] = [legacyInvoiceJobRow(row)],
  now = new Date(),
): SchedulerInvoiceListItemDto {
  const orderedJobs = [...jobRows].sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    id: row.id,
    financeId: row.financeId,
    financeIds: orderedJobs.map((job) => job.financeId),
    jobCount: orderedJobs.length,
    jobNames: orderedJobs.map((job) => job.jobName),
    sourceApps: [...new Set(orderedJobs.map((job) => job.jobSourceApp as FinanceSourceApp))],
    billToName: row.billToName,
    invoiceNumber: row.invoiceNumber,
    status: row.status as InvoiceStatus,
    currency: row.currency,
    issueDate: iso(row.issueDate),
    xeroInvoiceNumber: row.xeroInvoiceNumber,
    xeroDate: row.xeroDate,
    dueDate: iso(row.dueDate),
    paidAt: iso(row.paidAt),
    subtotalExGst: centsToMoney(row.subtotalExGstCents),
    gstAmount: centsToMoney(row.gstAmountCents),
    totalIncGst: centsToMoney(row.totalIncGstCents),
    gstRate: row.gstRateBps / 10_000,
    overdue: row.status === 'issued'
      && Boolean(row.dueDate && utcDateKey(row.dueDate) < utcDateKey(now)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function invoiceLineDto(row: InvoiceLineRow): SchedulerInvoiceLineDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    financeId: row.financeId,
    sortOrder: row.sortOrder,
    kind: row.kind as InvoiceLineKind,
    description: row.description,
    quantity: row.quantity,
    unitAmountExGst: centsToMoney(row.unitAmountExGstCents),
    lineTotalExGst: centsToMoney(row.lineTotalExGstCents),
    showQuantityAndRate: row.showQuantityAndRate,
    expenseId: row.expenseId,
    category: row.category as ExpenseCategory | null,
  };
}

type ExpenseReservation = {
  invoiceId: string;
  status: InvoiceStatus;
};

function expenseAttachmentMutationIsBlocked(
  expense: Pick<ExpenseRow, 'invoiced'>,
  reservation: ExpenseReservation | undefined,
): boolean {
  return expense.invoiced || Boolean(reservation && reservation.status !== 'draft');
}

async function expenseReservations(
  financeId: string,
  executor: FinanceExecutor = db,
): Promise<Map<string, ExpenseReservation>> {
  const rows = await executor.select({
    expenseId: schedulerInvoiceLines.expenseId,
    invoiceId: schedulerInvoices.id,
    status: schedulerInvoices.status,
  }).from(schedulerInvoiceLines)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceLines.invoiceId))
    .where(and(
      eq(schedulerInvoiceLines.financeId, financeId),
      inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
    ));
  const result = new Map<string, ExpenseReservation>();
  for (const row of rows) {
    if (!row.expenseId) continue;
    const existing = result.get(row.expenseId);
    if (!existing || (
      existing.status === 'draft'
      && (row.status === 'issued' || row.status === 'paid')
    )) {
      result.set(row.expenseId, {
        invoiceId: row.invoiceId,
        status: row.status as InvoiceStatus,
      });
    }
  }
  return result;
}

function expenseDto(
  row: ExpenseRow,
  eventId: string | null,
  reservation: ExpenseReservation | undefined,
  attachments: ExpenseAttachmentRow[] = [],
): SchedulerExpenseDto {
  const effectiveBillableCents = row.billable
    ? row.billableAmountCents ?? row.costAmountCents
    : 0;
  const markupPct = row.billable && row.costAmountCents > 0
    ? round(((effectiveBillableCents - row.costAmountCents) / row.costAmountCents) * 100, 2)
    : null;
  return {
    id: row.id,
    financeId: row.financeId,
    eventId,
    kind: row.kind as ExpenseKind,
    category: row.category as ExpenseCategory,
    description: row.description,
    vendor: row.vendor,
    reference: row.reference,
    costAmount: centsToMoney(row.costAmountCents),
    billableAmount: row.billableAmountCents === null
      ? null
      : centsToMoney(row.billableAmountCents),
    effectiveBillableAmount: centsToMoney(effectiveBillableCents),
    markupPct,
    billable: row.billable,
    invoiced: row.invoiced || reservation?.status === 'issued' || reservation?.status === 'paid',
    reserved: Boolean(reservation),
    invoiceId: reservation?.invoiceId ?? null,
    incurredAt: iso(row.incurredAt),
    attachments: attachments.filter((attachment) => attachment.status === 'confirmed')
      .map(expenseAttachmentDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function expenseAttachmentDto(row: ExpenseAttachmentRow): SchedulerExpenseAttachmentDto {
  if (row.status !== 'confirmed' || !row.sha256) {
    throw new Error('scheduler_expense_attachment_not_confirmed');
  }
  return {
    id: row.id,
    expenseId: row.expenseId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
    downloadUrl: `/v1/portal/scheduler/expenses/${encodeURIComponent(row.expenseId)}/attachments/${encodeURIComponent(row.id)}/download`,
  };
}

function parsePricingMode(value: unknown): PricingMode {
  if (value === 'quoted' || value === 'charge_up') return value;
  throw badRequest('pricingMode must be quoted or charge_up');
}

function parseExpenseKind(value: unknown): ExpenseKind {
  if (value === 'expense' || value === 'supplier_bill') return value;
  throw badRequest('kind must be expense or supplier_bill');
}

function parseExpenseCategory(value: unknown): ExpenseCategory {
  if (
    value === 'materials'
    || value === 'travel'
    || value === 'subcontractor'
    || value === 'equipment'
    || value === 'other'
  ) return value;
  throw badRequest(
    'category must be materials, travel, subcontractor, equipment, or other',
  );
}

async function reservationRollup(
  financeId: string,
  executor: FinanceExecutor = db,
): Promise<{
  reservedLabourCents: number;
  reservedQuoteCents: number;
  issuedQuoteCents: number;
}> {
  const rows = await executor.select({
    kind: schedulerInvoiceLines.kind,
    lineTotalCents: schedulerInvoiceLines.lineTotalExGstCents,
    status: schedulerInvoices.status,
  }).from(schedulerInvoiceLines)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceLines.invoiceId))
    .where(and(
      eq(schedulerInvoiceLines.financeId, financeId),
      inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
    ));
  let reservedLabourCents = 0;
  let reservedQuoteCents = 0;
  let issuedQuoteCents = 0;
  for (const row of rows) {
    if (row.kind === 'labour') {
      reservedLabourCents = addAccountingCents(
        reservedLabourCents,
        row.lineTotalCents,
        'Reserved labour value',
      );
    }
    if (row.kind === 'quoted') {
      reservedQuoteCents = addAccountingCents(
        reservedQuoteCents,
        row.lineTotalCents,
        'Reserved quote value',
      );
      if (row.status === 'issued' || row.status === 'paid') {
        issuedQuoteCents = addAccountingCents(
          issuedQuoteCents,
          row.lineTotalCents,
          'Issued quote value',
        );
      }
    }
  }
  return {
    reservedLabourCents,
    reservedQuoteCents,
    issuedQuoteCents,
  };
}

export function computeSchedulerCommercialTotals(input: {
  pricingMode: PricingMode;
  quotedAmountCents: number | null;
  billableHours: number;
  costHours: number;
  billableRateCents: number;
  /** Canonical per-user labour result. Falls back to the legacy job rate for adapters/tests. */
  labourRevenueCents?: number;
  costRateCents: number;
  expenseCostCents: number;
  expenseRevenueCents: number;
  invoicedCents: number;
  reservedCents: number;
  issuedQuoteCents: number;
}): SchedulerFinancialSummaryDto['totals'] & {
  labourRevenue: number;
  labourCost: number;
  expenseRevenue: number;
  expenseCost: number;
} {
  const labourRevenueCents = input.labourRevenueCents === undefined
    ? hoursAtRateCents(
        input.billableHours,
        input.billableRateCents,
        'Labour revenue',
      )
    : accountingCents(input.labourRevenueCents, 'Labour revenue');
  const labourCostCents = hoursAtRateCents(
    input.costHours,
    input.costRateCents,
    'Labour cost',
  );
  const baseRevenueCents = input.pricingMode === 'quoted'
    ? accountingCents(input.quotedAmountCents ?? 0, 'Quoted amount')
    : labourRevenueCents;
  const billableCents = addAccountingCents(
    baseRevenueCents,
    input.expenseRevenueCents,
    'Billable amount',
  );
  const totalCostCents = addAccountingCents(
    labourCostCents,
    input.expenseCostCents,
    'Total cost',
  );
  accountingCents(input.invoicedCents, 'Invoiced amount');
  accountingCents(input.reservedCents, 'Reserved amount');
  accountingCents(input.issuedQuoteCents, 'Issued quote value');
  const grossProfitCents = billableCents - totalCostCents;
  const marginPct = billableCents > 0
    ? round((grossProfitCents / billableCents) * 100, 2)
    : null;
  const unbilledCents = Math.max(0, billableCents - input.invoicedCents);
  const unbilledQuoteCents = input.pricingMode === 'quoted'
    ? Math.max(0, (input.quotedAmountCents ?? 0) - input.issuedQuoteCents)
    : 0;
  return {
    billableAmount: centsToMoney(billableCents),
    labourRevenue: centsToMoney(labourRevenueCents),
    expenseRevenue: centsToMoney(input.expenseRevenueCents),
    totalCost: centsToMoney(totalCostCents),
    labourCost: centsToMoney(labourCostCents),
    expenseCost: centsToMoney(input.expenseCostCents),
    invoicedAmount: centsToMoney(input.invoicedCents),
    reservedAmount: centsToMoney(input.reservedCents),
    uninvoicedAmount: centsToMoney(unbilledCents),
    unbilledAmount: centsToMoney(unbilledCents),
    unbilledQuoteBalance: centsToMoney(unbilledQuoteCents),
    grossProfit: centsToMoney(grossProfitCents),
    marginPct,
  };
}

async function buildFinancialSummary(
  source: FinanceSource,
  event: ScheduleEventRow | null,
  executor: FinanceExecutor = db,
  options: { allowHiddenSourceForCompletionCapture?: boolean } = {},
): Promise<SchedulerFinancialSummaryDto> {
  if (!options.allowHiddenSourceForCompletionCapture) {
    assertSchedulerFinanceSourceAppVisible(source.sourceApp);
  }
  const metadata = await loadJobMetadata(source, event, executor);
  const finance = await ensureFinance(source, metadata, executor);
  const [
    recorded,
    scheduledHours,
    currentOverride,
    completionReadiness,
    expenseRows,
    invoiceJobRefs,
  ] = await Promise.all([
    recordedHoursForSource(source, executor),
    scheduledHoursForSource(source, executor),
    latestHourOverride(finance.id, executor),
    sourceCompletionReadiness(source, executor),
    executor.select().from(schedulerJobExpenses).where(and(
      eq(schedulerJobExpenses.financeId, finance.id),
      isNull(schedulerJobExpenses.deletedAt),
    )).orderBy(asc(schedulerJobExpenses.incurredAt), asc(schedulerJobExpenses.createdAt)),
    executor.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
      .from(schedulerInvoiceJobs)
      .where(eq(schedulerInvoiceJobs.financeId, finance.id)),
  ]);
  const participatingInvoiceIds = invoiceJobRefs.map((row) => row.invoiceId);
  const invoiceRows = await executor.select().from(schedulerInvoices).where(and(
    participatingInvoiceIds.length > 0
      ? or(
          eq(schedulerInvoices.financeId, finance.id),
          inArray(schedulerInvoices.id, participatingInvoiceIds),
        )
      : eq(schedulerInvoices.financeId, finance.id),
    ...schedulerInvoiceVisibilityConditions(),
  )).orderBy(desc(schedulerInvoices.createdAt));
  const financeInvoiceLines = invoiceRows.length === 0 ? [] : await executor.select({
    invoiceId: schedulerInvoiceLines.invoiceId,
    lineTotalCents: schedulerInvoiceLines.lineTotalExGstCents,
  }).from(schedulerInvoiceLines).where(and(
    eq(schedulerInvoiceLines.financeId, finance.id),
    inArray(schedulerInvoiceLines.invoiceId, invoiceRows.map((row) => row.id)),
  ));
  const [reservations, reserved] = await Promise.all([
    expenseReservations(finance.id, executor),
    reservationRollup(finance.id, executor),
  ]);
  const attachmentRows = expenseRows.length === 0 ? [] : await executor.select()
    .from(schedulerExpenseAttachments)
    .where(and(
      inArray(schedulerExpenseAttachments.expenseId, expenseRows.map((row) => row.id)),
      eq(schedulerExpenseAttachments.status, 'confirmed'),
    ))
    .orderBy(asc(schedulerExpenseAttachments.createdAt));
  const attachmentsByExpense = new Map<string, ExpenseAttachmentRow[]>();
  for (const attachment of attachmentRows) {
    const rows = attachmentsByExpense.get(attachment.expenseId) ?? [];
    rows.push(attachment);
    attachmentsByExpense.set(attachment.expenseId, rows);
  }

  const actualHours = millisecondsToHours(recorded.activeMilliseconds);
  const billableHoursOverride = currentOverride?.billableMilliseconds == null
    ? null
    : millisecondsToHours(currentOverride.billableMilliseconds);
  const costHoursOverride = currentOverride?.costMilliseconds == null
    ? null
    : millisecondsToHours(currentOverride.costMilliseconds);
  // App-recorded time is evidence and an editable suggestion. It must never
  // silently become the commercial quantity used by internal calculations.
  const billableHours = billableHoursOverride ?? 0;
  const costHours = costHoursOverride ?? 0;
  const effectiveEvent = event ?? await latestEventForSource(source, executor);
  const baseBillingActors = await billingActorsForSource(
    source,
    recorded,
    effectiveEvent,
    executor,
  );
  const billingActors = await applyStoredSchedulerActorBillingRateOverrides(
    finance.id,
    baseBillingActors,
    executor,
  );
  const userLabourBilling = effectiveUserLabourBilling(billingActors, billableHours);
  const expenseCostCents = expenseRows.reduce((total, expense) => (
    addAccountingCents(total, expense.costAmountCents, 'Expense cost')
  ), 0);
  const expenseRevenueCents = expenseRows.reduce((total, expense) => (
    addAccountingCents(
      total,
      expense.billable ? expense.billableAmountCents ?? expense.costAmountCents : 0,
      'Expense revenue',
    )
  ), 0);
  const invoiceById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
  const invoicedCents = financeInvoiceLines.filter((line) => {
    const status = invoiceById.get(line.invoiceId)?.status;
    return status === 'issued' || status === 'paid';
  }).reduce((total, line) => (
    addAccountingCents(total, line.lineTotalCents, 'Invoiced amount')
  ), 0);
  const reservedCents = financeInvoiceLines.filter((line) => (
    invoiceById.get(line.invoiceId)?.status !== 'void'
  )).reduce((total, line) => (
    addAccountingCents(total, line.lineTotalCents, 'Reserved amount')
  ), 0);
  const totals = computeSchedulerCommercialTotals({
    pricingMode: finance.pricingMode as PricingMode,
    quotedAmountCents: finance.quotedAmountCents,
    billableHours,
    costHours,
    billableRateCents: finance.billableRateCents,
    labourRevenueCents: userLabourBilling.labourRevenueCents,
    costRateCents: finance.costRateCents,
    expenseCostCents,
    expenseRevenueCents,
    invoicedCents,
    reservedCents,
    issuedQuoteCents: reserved.issuedQuoteCents,
  });
  const eventId = effectiveEvent?.id ?? null;
  const overrideSource = currentOverride?.source as 'admin' | 'legacy_estimate' | undefined;
  const hoursReadiness = schedulerInvoiceHoursReadiness(
    recorded.activeMilliseconds,
    currentOverride,
  );

  return {
    financeId: finance.id,
    source,
    event: effectiveEvent ? {
      id: effectiveEvent.id,
      title: effectiveEvent.title,
      sourceApp: source.sourceApp,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      status: effectiveEvent.status,
    } : null,
    job: metadata,
    amountBasis: 'ex_gst',
    currency: finance.currency,
    pricing: {
      mode: finance.pricingMode as PricingMode,
      quotedAmount: finance.quotedAmountCents === null
        ? null
        : centsToMoney(finance.quotedAmountCents),
      notes: finance.notes,
    },
    billing: {
      name: finance.billToName,
      abn: finance.billToAbn,
      address: finance.billToAddress,
      email: finance.billToEmail,
      reference: finance.billingReference,
    },
    invoiceReadiness: {
      completionSatisfied: completionReadiness.satisfied,
      completionBasis: completionReadiness.basis,
      hoursSatisfied: hoursReadiness.satisfied,
      hoursBasis: hoursReadiness.basis,
      ready: completionReadiness.satisfied,
    },
    time: {
      scheduledHours,
      actualHours,
      actualMilliseconds: recorded.activeMilliseconds,
      actualSource: 'active_sessions',
      actors: billingActors,
      billableHours,
      billableHoursOverride,
      billableHoursSource: billableHoursOverride === null ? 'default_zero' : 'override',
      costHours,
      costHoursOverride,
      costHoursSource: costHoursOverride === null ? 'default_zero' : 'override',
      billableRate: userLabourBilling.weightedRateCents === null
        ? null
        : centsToMoney(userLabourBilling.weightedRateCents),
      costRate: centsToMoney(finance.costRateCents),
      labourRevenue: totals.labourRevenue,
      labourCost: totals.labourCost,
      hoursVariance: round(actualHours - scheduledHours, 4),
      commercialHoursVariance: round(billableHours - costHours, 4),
      overrideReason: currentOverride?.reason ?? null,
      overrideSource: overrideSource ?? null,
      overriddenAt: currentOverride?.createdAt.toISOString() ?? null,
      overriddenBy: currentOverride
        ? {
            userId: currentOverride.actorUserId,
            displayName: currentOverride.actorDisplayName,
          }
        : null,
      needsHoursReview: !hoursReadiness.satisfied
        || userLabourBilling.missingBillingRateUsers.length > 0,
      missingBillingRateUsers: userLabourBilling.missingBillingRateUsers,
    },
    expenses: expenseRows.map((expense) => expenseDto(
      expense,
      eventId,
      reservations.get(expense.id),
      attachmentsByExpense.get(expense.id),
    )),
    invoices: await invoiceListItems(invoiceRows, executor),
    totals,
  };
}

/**
 * Captures the commercial ledger as it exists at the first completion
 * boundary. The supplied executor keeps finance creation/reads and the
 * completion fact in one transaction. `incomplete` retains a coherent numeric
 * snapshot while signalling that the underlying hours/rates still needed
 * finance review at capture time.
 */
export async function captureSchedulerCompletedWorkRevenue(
  source: FinanceSource,
  executor: SchedulerFinanceExecutor,
): Promise<SchedulerCompletedWorkRevenueSnapshot> {
  const event = await latestEventForSource(source, executor);
  const metadata = await loadJobMetadata(source, event, executor);
  // An accepted completion can arrive in the same offline payload as a soft
  // delete. Soft delete is operational visibility, not erasure of commercial
  // history, so this first-completion path may create the retained ledger even
  // though ordinary finance entry points continue to reject deleted sources.
  const ensuredFinance = await ensureFinance(source, metadata, executor, {
    allowDeletedSource: true,
  });
  // Every finance, expense, and invoice amount mutator takes this parent-row
  // lock before changing child rows. Holding it across the summary prevents a
  // READ COMMITTED capture from mixing two commercial ledger revisions.
  const [lockedFinance] = await executor.select({ id: schedulerJobFinance.id })
    .from(schedulerJobFinance)
    .where(eq(schedulerJobFinance.id, ensuredFinance.id))
    .for('update')
    .limit(1);
  if (!lockedFinance) throw conflict('Job finance changed during completion capture');
  const summary = await buildFinancialSummary(
    source,
    event,
    executor,
    { allowHiddenSourceForCompletionCapture: true },
  );
  return buildSchedulerCompletedWorkRevenueSnapshot({
    currency: summary.currency,
    billableAmount: summary.totals.billableAmount,
    needsFinanceReview: summary.time.needsHoursReview,
    gstRate: config.schedulerInvoice.gstRate,
  });
}

export async function getSchedulerFinancialSummary(
  user: AuthUser,
  eventId: string,
): Promise<SchedulerFinancialSummaryDto> {
  await requireGlobalFinanceAdmin(user);
  const event = await loadEvent(eventId);
  return buildFinancialSummary(sourceFromEvent(event), event);
}

/** Compatibility entry point for the legacy Field finance routes. */
export async function getSchedulerFinancialSummaryForSource(
  user: AuthUser,
  source: FinanceSource,
): Promise<SchedulerFinancialSummaryDto> {
  await requireGlobalFinanceAdmin(user);
  if (!isSupportedSource(source)) throw badRequest('Unsupported commercial source job');
  return buildFinancialSummary(source, await latestEventForSource(source));
}

export async function getSchedulerFinancialSummaryById(
  user: AuthUser,
  financeId: string,
): Promise<SchedulerFinancialSummaryDto> {
  await requireGlobalFinanceAdmin(user);
  const context = await financeById(financeId);
  return buildFinancialSummary(context.source, context.event);
}

async function updateSchedulerFinanceForContext(
  actor: FinanceActor,
  context: FinanceContext,
  input: FinanceUpdateInput,
): Promise<SchedulerFinancialSummaryDto> {
  const { event, source } = context;

  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const patch: Partial<typeof schedulerJobFinance.$inferInsert> = {
      updatedByUserId: actor.globalUserId,
      updatedByDisplayName: actor.displayName,
      updatedAt: new Date(),
    };
    if (input.pricingMode !== undefined) patch.pricingMode = parsePricingMode(input.pricingMode);
    if (input.quotedAmount !== undefined) {
      patch.quotedAmountCents = input.quotedAmount === null
        ? null
        : moneyToCents(input.quotedAmount, 'quotedAmount');
    }
    if (input.currency !== undefined) {
      const currency = requireText(input.currency, 'currency', 8).toUpperCase();
      if (currency !== finance.currency.trim().toUpperCase()) {
        const [[expense], [invoice]] = await Promise.all([
          tx.select({ id: schedulerJobExpenses.id }).from(schedulerJobExpenses)
            .where(eq(schedulerJobExpenses.financeId, finance.id)).limit(1),
          tx.select({ id: schedulerInvoices.id }).from(schedulerInvoices)
            .where(or(
              eq(schedulerInvoices.financeId, finance.id),
              inArray(
                schedulerInvoices.id,
                tx.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
                  .from(schedulerInvoiceJobs)
                  .where(eq(schedulerInvoiceJobs.financeId, finance.id)),
              ),
            )).limit(1),
        ]);
        if (expense || invoice) {
          throw conflict('Currency cannot change after an expense or invoice exists');
        }
      }
      patch.currency = currency;
    }
    if (input.notes !== undefined) patch.notes = optionalText(input.notes, 5_000);
    if (input.billingName !== undefined) patch.billToName = optionalText(input.billingName, 300);
    if (input.billingAbn !== undefined) patch.billToAbn = optionalText(input.billingAbn, 100);
    if (input.billingAddress !== undefined) {
      patch.billToAddress = optionalText(input.billingAddress, 1_000);
    }
    if (input.billingEmail !== undefined) patch.billToEmail = optionalText(input.billingEmail, 320);
    if (input.billingReference !== undefined) {
      patch.billingReference = optionalText(input.billingReference, 200);
    }
    if (input.costRate !== undefined) patch.costRateCents = moneyToCents(input.costRate, 'costRate');

    const mergedPricingMode = (patch.pricingMode ?? finance.pricingMode) as PricingMode;
    const mergedQuotedAmount = patch.quotedAmountCents === undefined
      ? finance.quotedAmountCents
      : patch.quotedAmountCents;
    if (mergedPricingMode === 'quoted' && mergedQuotedAmount === null) {
      throw badRequest('quotedAmount is required when pricingMode is quoted');
    }
    // Invoice revisions do not rewrite the job's current commercial settings.
    // Stored PDF versions retain the values that were issued at each point in time.

    const latestOverrideRecord = await latestHourOverrideRecord(finance.id, tx);
    const currentOverride = latestOverrideRecord?.action === 'set' ? latestOverrideRecord : null;
    const currentBillable = currentOverride?.billableMilliseconds ?? null;
    const currentCost = currentOverride?.costMilliseconds ?? null;
    const nextBillable = input.billableHoursOverride === undefined
      ? currentBillable
      : input.billableHoursOverride === null
        ? null
        : billableHoursToMilliseconds(input.billableHoursOverride);
    const nextCost = input.costHoursOverride === undefined
      ? currentCost
      : input.costHoursOverride === null
        ? null
        : hoursToMilliseconds(input.costHoursOverride, 'costHoursOverride');
    const overrideChanged = nextBillable !== currentBillable || nextCost !== currentCost;
    const confirmsLegacyEstimate = currentOverride?.source === 'legacy_estimate'
      && (nextBillable !== null || nextCost !== null)
      && Boolean(optionalText(input.overrideReason, 1_000));
    if (overrideChanged || confirmsLegacyEstimate) {
      const clearing = nextBillable === null && nextCost === null;
      const reason = clearing
        ? optionalText(input.overrideReason, 1_000) ?? 'Cleared hour override'
        : requireText(input.overrideReason, 'overrideReason', 1_000);
      await tx.insert(schedulerJobHourOverrides).values({
        id: randomUUID(),
        financeId: finance.id,
        revision: (latestOverrideRecord?.revision ?? 0) + 1,
        action: clearing ? 'clear' : 'set',
        source: 'admin',
        billableMilliseconds: nextBillable,
        costMilliseconds: nextCost,
        reason,
        actorUserId: actor.globalUserId,
        actorDisplayName: actor.displayName,
        createdAt: new Date(),
      });
    }
    await tx.update(schedulerJobFinance).set(patch)
      .where(eq(schedulerJobFinance.id, finance.id));
  });
  return buildFinancialSummary(source, event);
}

export async function updateSchedulerFinance(
  user: AuthUser,
  eventId: string,
  input: FinanceUpdateInput,
): Promise<SchedulerFinancialSummaryDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return updateSchedulerFinanceForContext(actor, await financeForEvent(eventId), input);
}

export async function updateSchedulerFinanceById(
  user: AuthUser,
  financeId: string,
  input: FinanceUpdateInput,
): Promise<SchedulerFinancialSummaryDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return updateSchedulerFinanceForContext(actor, await financeById(financeId), input);
}

export async function updateSchedulerJobActorBillingRateByFinanceId(
  user: AuthUser,
  financeId: string,
  globalUserId: string,
  input: SchedulerJobActorBillingRateUpdateInput,
): Promise<SchedulerFinancialSummaryDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  const context = await financeById(financeId);
  const billingRateOverrideCents = input.billingRateOverride === null
    ? null
    : moneyToCents(input.billingRateOverride, 'billingRateOverride');

  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id))
      .for('update')
      .limit(1);
    if (!finance) throw notFound('Job finance');

    const recorded = await recordedHoursForSource(context.source, tx);
    const event = await latestEventForSource(context.source, tx);
    const billingActors = await billingActorsForSource(
      context.source,
      recorded,
      event,
      tx,
    );
    const targetActor = billingActors.find((candidate) => (
      candidate.userId === globalUserId && candidate.billingRateEditable
    ));
    const [existingOverride] = await tx.select({
      globalUserId: schedulerJobActorBillingRateOverrides.globalUserId,
    }).from(schedulerJobActorBillingRateOverrides).where(and(
      eq(schedulerJobActorBillingRateOverrides.financeId, finance.id),
      eq(schedulerJobActorBillingRateOverrides.globalUserId, globalUserId),
    )).limit(1);
    if (!canMutateSchedulerJobActorBillingRate({
      clearing: billingRateOverrideCents === null,
      hasExistingOverride: Boolean(existingOverride),
      isCurrentBillingActor: Boolean(targetActor),
    })) {
      throw notFound('Job billing actor');
    }

    const now = new Date();
    if (billingRateOverrideCents === null) {
      await tx.delete(schedulerJobActorBillingRateOverrides).where(and(
        eq(schedulerJobActorBillingRateOverrides.financeId, finance.id),
        eq(schedulerJobActorBillingRateOverrides.globalUserId, globalUserId),
      ));
    } else {
      await tx.insert(schedulerJobActorBillingRateOverrides).values({
        financeId: finance.id,
        globalUserId,
        billingRateCents: billingRateOverrideCents,
        updatedByGlobalUserId: actor.globalUserId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          schedulerJobActorBillingRateOverrides.financeId,
          schedulerJobActorBillingRateOverrides.globalUserId,
        ],
        set: {
          billingRateCents: billingRateOverrideCents,
          updatedByGlobalUserId: actor.globalUserId,
          updatedAt: now,
        },
      });
    }
    await tx.update(schedulerJobFinance).set({
      updatedByUserId: actor.globalUserId,
      updatedByDisplayName: actor.displayName,
      updatedAt: now,
    }).where(eq(schedulerJobFinance.id, finance.id));
  });

  return buildFinancialSummary(context.source, context.event);
}

/**
 * A create-expense request identifies a job, not an invoice. Auto-reserve the
 * new charge only when that job belongs to exactly one draft, so a consolidated
 * or parallel-draft workflow can never receive a charge by guesswork.
 *
 * The caller holds the finance row lock. Invoice creation, editing, issue, and
 * void take the same lock, so the candidate set and appended snapshot cannot
 * cross a lifecycle transition.
 */
async function appendBillableExpenseToSingleDraft(
  expense: ExpenseRow,
  executor: FinanceExecutor,
): Promise<ExpenseReservation | undefined> {
  if (!expense.billable || expense.invoiced || expense.deletedAt) return undefined;
  const candidates = await executor.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
    .from(schedulerInvoiceJobs)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceJobs.invoiceId))
    .where(and(
      eq(schedulerInvoiceJobs.financeId, expense.financeId),
      eq(schedulerInvoices.status, 'draft'),
    ))
    .orderBy(desc(schedulerInvoices.updatedAt), desc(schedulerInvoices.createdAt));
  if (candidates.length !== 1) return undefined;

  const invoiceId = candidates[0]!.invoiceId;
  const [invoice] = await executor.select().from(schedulerInvoices)
    .where(and(
      eq(schedulerInvoices.id, invoiceId),
      eq(schedulerInvoices.status, 'draft'),
    ))
    .for('update')
    .limit(1);
  if (!invoice) return undefined;
  const [membership] = await executor.select({ financeId: schedulerInvoiceJobs.financeId })
    .from(schedulerInvoiceJobs)
    .where(and(
      eq(schedulerInvoiceJobs.invoiceId, invoice.id),
      eq(schedulerInvoiceJobs.financeId, expense.financeId),
    ))
    .limit(1);
  if (!membership) return undefined;

  const existingLines = await executor.select({
    sortOrder: schedulerInvoiceLines.sortOrder,
    lineTotalExGstCents: schedulerInvoiceLines.lineTotalExGstCents,
  }).from(schedulerInvoiceLines)
    .where(eq(schedulerInvoiceLines.invoiceId, invoice.id))
    .orderBy(asc(schedulerInvoiceLines.sortOrder));
  // Preserve the public draft-edit limit and leave the expense available for
  // an explicit administrator choice when the draft is already full.
  if (existingLines.length >= 250) return undefined;

  const amountCents = expense.billableAmountCents ?? expense.costAmountCents;
  await executor.insert(schedulerInvoiceLines).values({
    id: randomUUID(),
    invoiceId: invoice.id,
    financeId: expense.financeId,
    sortOrder: (existingLines.at(-1)?.sortOrder ?? -1) + 1,
    kind: 'expense',
    description: expense.description,
    quantity: 1,
    unitAmountExGstCents: amountCents,
    lineTotalExGstCents: amountCents,
    showQuantityAndRate: false,
    expenseId: expense.id,
    category: expense.category,
    createdAt: new Date(),
  });
  const totals = invoiceTotalsFromCents([
    ...existingLines.map((line) => line.lineTotalExGstCents),
    amountCents,
  ], invoice.gstRateBps);
  await executor.update(schedulerInvoices).set({
    subtotalExGstCents: totals.subtotal,
    gstAmountCents: totals.gst,
    totalIncGstCents: totals.total,
    updatedAt: nextInvoiceUpdatedAt(invoice),
  }).where(and(
    eq(schedulerInvoices.id, invoice.id),
    eq(schedulerInvoices.status, 'draft'),
  ));
  return { invoiceId: invoice.id, status: 'draft' };
}

async function createSchedulerExpenseForContext(
  actor: FinanceActor,
  context: FinanceContext,
  input: ExpenseInput,
): Promise<SchedulerExpenseDto> {
  const { event } = context;
  const kind = parseExpenseKind(input.kind);
  const category = parseExpenseCategory(input.category);
  const description = requireText(input.description, 'description', 500);
  const billable = input.billable !== false;
  const id = randomUUID();
  const { created, reservation } = await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const now = new Date();
    const [created] = await tx.insert(schedulerJobExpenses).values({
      id,
      financeId: finance.id,
      kind,
      category,
      description,
      vendor: optionalText(input.vendor, 300),
      reference: optionalText(input.reference, 200),
      costAmountCents: moneyToCents(input.costAmount, 'costAmount'),
      billableAmountCents: billable && input.billableAmount != null
        ? moneyToCents(input.billableAmount, 'billableAmount')
        : null,
      billable,
      invoiced: false,
      incurredAt: parseDate(input.incurredAt, 'incurredAt'),
      createdByUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new Error('scheduler_expense_create_failed');
    const reservation = await appendBillableExpenseToSingleDraft(created, tx);
    return { created, reservation };
  });
  return expenseDto(created, event?.id ?? null, reservation);
}

export async function createSchedulerExpense(
  user: AuthUser,
  eventId: string,
  input: ExpenseInput,
): Promise<SchedulerExpenseDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return createSchedulerExpenseForContext(actor, await financeForEvent(eventId), input);
}

export async function createSchedulerExpenseByFinanceId(
  user: AuthUser,
  financeId: string,
  input: ExpenseInput,
): Promise<SchedulerExpenseDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return createSchedulerExpenseForContext(actor, await financeById(financeId), input);
}

async function updateSchedulerExpenseForContext(
  context: FinanceContext,
  expenseId: string,
  input: Partial<ExpenseInput>,
): Promise<SchedulerExpenseDto> {
  const { event } = context;
  let updated!: ExpenseRow;
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [existing] = await tx.select().from(schedulerJobExpenses).where(and(
      eq(schedulerJobExpenses.id, expenseId),
      eq(schedulerJobExpenses.financeId, finance.id),
      isNull(schedulerJobExpenses.deletedAt),
    )).for('update').limit(1);
    if (!existing) throw notFound('Expense');
    const reservations = await expenseReservations(finance.id, tx);
    if (existing.invoiced || reservations.has(existing.id)) {
      throw conflict('Reserved or invoiced expenses cannot be edited; void the invoice first');
    }
    const patch: Partial<typeof schedulerJobExpenses.$inferInsert> = { updatedAt: new Date() };
    if (input.kind !== undefined) patch.kind = parseExpenseKind(input.kind);
    if (input.category !== undefined) patch.category = parseExpenseCategory(input.category);
    if (input.description !== undefined) {
      patch.description = requireText(input.description, 'description', 500);
    }
    if (input.vendor !== undefined) patch.vendor = optionalText(input.vendor, 300);
    if (input.reference !== undefined) patch.reference = optionalText(input.reference, 200);
    if (input.costAmount !== undefined) {
      patch.costAmountCents = moneyToCents(input.costAmount, 'costAmount');
    }
    const nextBillable = input.billable ?? existing.billable;
    if (input.billable !== undefined) patch.billable = input.billable;
    if (!nextBillable) patch.billableAmountCents = null;
    else if (input.billableAmount !== undefined) {
      patch.billableAmountCents = input.billableAmount === null
        ? null
        : moneyToCents(input.billableAmount, 'billableAmount');
    }
    if (input.incurredAt !== undefined) {
      patch.incurredAt = parseDate(input.incurredAt, 'incurredAt');
    }
    [updated] = await tx.update(schedulerJobExpenses).set(patch)
      .where(eq(schedulerJobExpenses.id, existing.id)).returning();
  });
  return expenseDto(updated, event?.id ?? null, undefined);
}

export async function updateSchedulerExpense(
  user: AuthUser,
  eventId: string,
  expenseId: string,
  input: Partial<ExpenseInput>,
): Promise<SchedulerExpenseDto> {
  await requireGlobalFinanceAdmin(user);
  return updateSchedulerExpenseForContext(await financeForEvent(eventId), expenseId, input);
}

export async function updateSchedulerExpenseByFinanceId(
  user: AuthUser,
  financeId: string,
  expenseId: string,
  input: Partial<ExpenseInput>,
): Promise<SchedulerExpenseDto> {
  await requireGlobalFinanceAdmin(user);
  return updateSchedulerExpenseForContext(await financeById(financeId), expenseId, input);
}

async function deleteSchedulerExpenseForContext(
  context: FinanceContext,
  expenseId: string,
): Promise<void> {
  const { event } = context;
  const cleanupTaskIds: string[] = [];
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [existing] = await tx.select().from(schedulerJobExpenses).where(and(
      eq(schedulerJobExpenses.id, expenseId),
      eq(schedulerJobExpenses.financeId, finance.id),
      isNull(schedulerJobExpenses.deletedAt),
    )).for('update').limit(1);
    if (!existing) throw notFound('Expense');
    const reservations = await expenseReservations(finance.id, tx);
    if (existing.invoiced || reservations.has(existing.id)) {
      throw conflict('Reserved or invoiced expenses cannot be deleted; void the invoice first');
    }
    const attachments = await tx.select().from(schedulerExpenseAttachments)
      .where(eq(schedulerExpenseAttachments.expenseId, existing.id))
      .for('update');
    for (const attachment of attachments) {
      cleanupTaskIds.push(await queueExpenseAttachmentDeletion(attachment, tx));
    }
    await tx.update(schedulerJobExpenses).set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schedulerJobExpenses.id, existing.id));
  });
  if (cleanupTaskIds.length > 0) {
    await drainStorageDeletionTasks({ ids: cleanupTaskIds });
  }
}

export async function deleteSchedulerExpense(
  user: AuthUser,
  eventId: string,
  expenseId: string,
): Promise<void> {
  await requireGlobalFinanceAdmin(user);
  return deleteSchedulerExpenseForContext(await financeForEvent(eventId), expenseId);
}

export async function deleteSchedulerExpenseByFinanceId(
  user: AuthUser,
  financeId: string,
  expenseId: string,
): Promise<void> {
  await requireGlobalFinanceAdmin(user);
  return deleteSchedulerExpenseForContext(await financeById(financeId), expenseId);
}

export function normalizeSchedulerSellerAbn(value: string | null | undefined): string | null {
  const normalized = optionalText(value, 100);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');
  if (digits.length !== 11) throw badRequest('Seller ABN must contain exactly 11 digits');
  return digits;
}

async function invoiceSellerSnapshot(executor: FinanceExecutor = db) {
  const [stored] = await executor.select({ sellerAbn: schedulerInvoiceSettings.sellerAbn })
    .from(schedulerInvoiceSettings)
    .where(eq(schedulerInvoiceSettings.companyKey, config.businessDirectory.companyKey))
    .limit(1);
  return {
    sellerName: config.schedulerInvoice.sellerName.trim() || 'Sustainability Wise',
    sellerAbn: normalizeSchedulerSellerAbn(stored?.sellerAbn ?? config.schedulerInvoice.sellerAbn),
    sellerAddress: optionalText(config.schedulerInvoice.sellerAddress, 1_000),
    sellerEmail: optionalText(config.schedulerInvoice.sellerEmail, 320),
  };
}

export async function updateSchedulerInvoiceSeller(
  user: AuthUser,
  invoiceId: string,
  input: UpdateSchedulerInvoiceSellerInput,
): Promise<SchedulerInvoiceDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  const sellerAbn = normalizeSchedulerSellerAbn(input.sellerAbn);
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId))
      .for('update')
      .limit(1);
    if (!invoice) throw notFound('Invoice');
    await invoiceJobsForRow(invoice, tx);
    if (invoice.status === 'void') throw conflict('Void invoices cannot be edited');
    assertInvoiceVersion(invoice, input.expectedUpdatedAt);
    const now = new Date();
    await tx.insert(schedulerInvoiceSettings).values({
      companyKey: config.businessDirectory.companyKey,
      sellerAbn,
      updatedByGlobalUserId: actor.globalUserId,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schedulerInvoiceSettings.companyKey,
      set: { sellerAbn, updatedByGlobalUserId: actor.globalUserId, updatedAt: now },
    });
    await tx.update(schedulerInvoices).set({
      sellerAbn,
      updatedAt: nextInvoiceUpdatedAt(invoice, now),
    }).where(eq(schedulerInvoices.id, invoice.id));
  });
  return loadInvoiceDto(null, invoiceId);
}

function invoiceDto(
  row: InvoiceRow,
  lines: InvoiceLineRow[],
  jobRows: InvoiceJobRow[] = [legacyInvoiceJobRow(row)],
  currentJobStatuses: ReadonlyMap<string, string> = new Map(),
): SchedulerInvoiceDto {
  const orderedJobs = [...jobRows].sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    ...invoiceListItem(row, orderedJobs),
    notes: row.notes,
    sellerName: row.sellerName,
    sellerAbn: row.sellerAbn,
    sellerAddress: row.sellerAddress,
    sellerEmail: row.sellerEmail,
    billToName: row.billToName,
    billToAbn: row.billToAbn,
    billToAddress: row.billToAddress,
    billToEmail: row.billToEmail,
    purchaseOrderReference: row.purchaseOrderReference,
    createdByUserId: row.createdByUserId,
    createdByDisplayName: row.createdByDisplayName,
    issuedAt: iso(row.issuedAt),
    voidedAt: iso(row.voidedAt),
    job: {
      jobName: row.jobName,
      jobDate: row.jobDate,
      clientName: row.jobClientName,
      siteName: row.jobSiteName,
      siteAddress: row.jobSiteAddress,
      status: row.jobStatus,
      sourceApp: row.jobSourceApp as FinanceSourceApp,
      sourceType: row.jobSourceType as FinanceSourceType,
      sourceId: row.jobSourceId,
    },
    jobs: orderedJobs.map((invoiceJob) => {
      const rawJobLines = lines.filter((line) => line.financeId === invoiceJob.financeId);
      const jobSubtotalCents = rawJobLines.reduce((total, line) => (
        addAccountingCents(total, line.lineTotalExGstCents, 'Job subtotal')
      ), 0);
      const jobLines = rawJobLines.map(invoiceLineDto);
      return {
        financeId: invoiceJob.financeId,
        sortOrder: invoiceJob.sortOrder,
        source: {
          sourceApp: invoiceJob.jobSourceApp as FinanceSourceApp,
          sourceType: invoiceJob.jobSourceType as FinanceSourceType,
          sourceId: invoiceJob.jobSourceId,
        },
        job: {
          jobName: invoiceJob.jobName,
          jobDate: invoiceJob.jobDate,
          clientName: invoiceJob.jobClientName,
          siteName: invoiceJob.jobSiteName,
          siteAddress: invoiceJob.jobSiteAddress,
          status: invoiceJob.jobStatus,
        },
        currentStatus: currentJobStatuses.get(invoiceJob.financeId) ?? invoiceJob.jobStatus,
        billingReference: invoiceJob.billingReference,
        subtotalExGst: centsToMoney(jobSubtotalCents),
        lines: jobLines,
      };
    }),
    lines: lines.map(invoiceLineDto),
  };
}

async function loadInvoiceDto(
  financeId: string | null,
  invoiceId: string,
  executor: FinanceExecutor = db,
): Promise<SchedulerInvoiceDto> {
  const [invoice] = await executor.select().from(schedulerInvoices)
    .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
  if (!invoice) throw notFound('Invoice');
  const jobs = await invoiceJobsForRow(invoice, executor);
  if (financeId && !jobs.some((job) => job.financeId === financeId)) throw notFound('Invoice');
  const lines = await executor.select().from(schedulerInvoiceLines)
    .where(eq(schedulerInvoiceLines.invoiceId, invoice.id))
    .orderBy(asc(schedulerInvoiceLines.sortOrder), asc(schedulerInvoiceLines.createdAt));
  const currentJobStatuses = new Map<string, string>();
  for (const job of jobs) {
    currentJobStatuses.set(job.financeId, await currentJobStatusForSource({
      sourceApp: job.jobSourceApp as FinanceSourceApp,
      sourceType: job.jobSourceType as FinanceSourceType,
      sourceId: job.jobSourceId,
    }, executor));
  }
  return invoiceDto(invoice, lines, jobs, currentJobStatuses);
}

async function invoiceListItems(
  rows: InvoiceRow[],
  executor: FinanceExecutor = db,
): Promise<SchedulerInvoiceListItemDto[]> {
  if (rows.length === 0) return [];
  const jobs = await executor.select().from(schedulerInvoiceJobs)
    .where(inArray(schedulerInvoiceJobs.invoiceId, rows.map((row) => row.id)))
    .orderBy(asc(schedulerInvoiceJobs.sortOrder));
  const jobsByInvoice = new Map<string, InvoiceJobRow[]>();
  for (const job of jobs) {
    const grouped = jobsByInvoice.get(job.invoiceId) ?? [];
    grouped.push(job);
    jobsByInvoice.set(job.invoiceId, grouped);
  }
  return rows.flatMap((row) => {
    const invoiceJobs = jobsByInvoice.get(row.id) ?? [legacyInvoiceJobRow(row)];
    return invoiceJobsAreVisible(invoiceJobs) ? [invoiceListItem(row, invoiceJobs)] : [];
  });
}

async function financeForEvent(
  eventId: string,
  executor: FinanceExecutor = db,
): Promise<{
  event: ScheduleEventRow;
  source: FinanceSource;
  metadata: JobMetadata;
  finance: FinanceRow;
}> {
  const event = await loadEvent(eventId, executor);
  const source = sourceFromEvent(event);
  const metadata = await loadJobMetadata(source, event, executor);
  const finance = await ensureFinance(source, metadata, executor);
  return { event, source, metadata, finance };
}

type FinanceContext = {
  event: ScheduleEventRow | null;
  source: FinanceSource;
  metadata: JobMetadata;
  finance: FinanceRow;
};

async function financeById(
  financeId: string,
  executor: FinanceExecutor = db,
): Promise<FinanceContext> {
  const [finance] = await executor.select().from(schedulerJobFinance)
    .where(eq(schedulerJobFinance.id, financeId)).limit(1);
  if (!finance) throw notFound('Job finance');
  const source = {
    sourceApp: finance.sourceApp,
    sourceType: finance.sourceType,
    sourceId: finance.sourceId,
  } as FinanceSource;
  if (!isSupportedSource(source)) throw badRequest('Unsupported commercial source job');
  assertSchedulerFinanceSourceAppVisible(source.sourceApp);
  const event = await latestEventForSource(source, executor);
  const metadata = await loadJobMetadata(source, event, executor);
  return { finance, source, event, metadata };
}

async function invoiceJobsForRow(
  invoice: InvoiceRow,
  executor: FinanceExecutor = db,
): Promise<InvoiceJobRow[]> {
  const rows = await executor.select().from(schedulerInvoiceJobs)
    .where(eq(schedulerInvoiceJobs.invoiceId, invoice.id))
    .orderBy(asc(schedulerInvoiceJobs.sortOrder));
  const jobs = rows.length > 0 ? rows : [legacyInvoiceJobRow(invoice)];
  assertInvoiceJobsVisible(jobs);
  return jobs;
}

/** Shared by generic export status/download routes that only know the invoice ID. */
export async function assertSchedulerInvoiceVisible(
  invoiceId: string,
  executor: FinanceExecutor = db,
): Promise<void> {
  const [invoice] = await executor.select().from(schedulerInvoices)
    .where(eq(schedulerInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw notFound('Invoice');
  await invoiceJobsForRow(invoice, executor);
}

async function lockInvoiceFinances(
  invoice: InvoiceRow,
  executor: FinanceExecutor,
): Promise<{ jobs: InvoiceJobRow[]; finances: FinanceRow[] }> {
  const jobs = await invoiceJobsForRow(invoice, executor);
  const financeIds = [...new Set(jobs.map((job) => job.financeId))].sort();
  const finances = await executor.select().from(schedulerJobFinance)
    .where(inArray(schedulerJobFinance.id, financeIds))
    .orderBy(asc(schedulerJobFinance.id))
    .for('update');
  if (finances.length !== financeIds.length) throw conflict('An invoice job ledger is missing');
  return { jobs, finances };
}

function assertInvoiceFinanceMembership(jobs: InvoiceJobRow[], financeId: string): void {
  if (!jobs.some((job) => job.financeId === financeId)) throw notFound('Invoice');
}

async function assertDraftInvoiceReady(
  invoice: InvoiceRow,
  executor: FinanceExecutor,
): Promise<void> {
  if (invoice.status !== 'draft') return;
  const candidateJobs = await invoiceJobsForRow(invoice, executor);
  const candidateSources = candidateJobs.map((job) => ({
    sourceApp: job.jobSourceApp,
    sourceType: job.jobSourceType,
    sourceId: job.jobSourceId,
  } as FinanceSource));
  const completionBySource = await lockCurrentCompletionReadiness(candidateSources, executor);
  const { jobs, finances } = await lockInvoiceFinances(invoice, executor);
  const candidateSourceByFinanceId = new Map(candidateJobs.map((job, index) => (
    [job.financeId, financeSourceKey(candidateSources[index]!)]
  )));
  if (
    jobs.length !== candidateJobs.length
    || jobs.some((job) => candidateSourceByFinanceId.get(job.financeId) !== financeSourceKey({
      sourceApp: job.jobSourceApp,
      sourceType: job.jobSourceType,
      sourceId: job.jobSourceId,
    } as FinanceSource))
  ) throw conflict('Invoice jobs changed; retry export');
  const jobByFinance = new Map(jobs.map((job) => [job.financeId, job]));
  for (const finance of finances) {
    const source = {
      sourceApp: finance.sourceApp,
      sourceType: finance.sourceType,
      sourceId: finance.sourceId,
    } as FinanceSource;
    assertInvoiceCompletionReady(
      source,
      jobByFinance.get(finance.id)?.jobName ?? finance.id,
      completionBySource.get(financeSourceKey(source))
        ?? { satisfied: false, basis: null },
    );
  }
}

/**
 * Draft invoice PDFs are customer-facing generation, so queueing must use the
 * same live completion fence as draft creation and issue. Internal hour review
 * state never blocks a customer-authored invoice or its PDF.
 * Issued/paid/void snapshots stay exportable independently of later source edits.
 */
export async function assertSchedulerInvoicePdfStartReady(
  invoiceId: string,
  executor: SchedulerFinanceExecutor,
): Promise<void> {
  const [invoice] = await executor.select().from(schedulerInvoices)
    .where(eq(schedulerInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw notFound('Invoice');
  await invoiceJobsForRow(invoice, executor);
  await assertDraftInvoiceReady(invoice, executor);
}

function normalizedPartyValue(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-AU') ?? '';
}

function billingPartyKey(finance: FinanceRow): string {
  return [
    finance.billToName,
    finance.billToAbn,
    finance.billToAddress,
    finance.billToEmail,
  ].map(normalizedPartyValue).join('\u001f');
}

async function allocateInvoiceNumber(
  now: Date,
  executor: FinanceExecutor,
): Promise<string> {
  const year = now.getUTCFullYear();
  const [counter] = await executor.insert(schedulerInvoiceCounters).values({
    year,
    lastValue: 1,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: schedulerInvoiceCounters.year,
    set: {
      lastValue: sql`${schedulerInvoiceCounters.lastValue} + 1`,
      updatedAt: now,
    },
  }).returning({ lastValue: schedulerInvoiceCounters.lastValue });
  if (!counter || !Number.isSafeInteger(counter.lastValue)) {
    throw new Error('scheduler_invoice_number_allocation_failed');
  }
  return `INV-${year}-${String(counter.lastValue).padStart(4, '0')}`;
}

function invoiceTotalsFromCents(
  lineTotalCents: number[],
  gstRateBps: number,
): { subtotal: number; gst: number; total: number } {
  const subtotal = lineTotalCents.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next)) throw badRequest('Invoice subtotal is too large');
    return next;
  }, 0);
  if (!Number.isSafeInteger(gstRateBps) || gstRateBps < 0) {
    throw badRequest('Invoice GST rate is invalid');
  }
  const gstExact = (
    BigInt(subtotal) * BigInt(gstRateBps) + 5_000n
  ) / 10_000n;
  if (gstExact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw badRequest('Invoice GST amount is too large');
  }
  const gst = Number(gstExact);
  const total = subtotal + gst;
  if (!Number.isSafeInteger(total)) throw badRequest('Invoice total is too large');
  return { subtotal, gst, total };
}

export function invoiceLineTotalCents(
  quantityUnits: number,
  unitAmountCents: number,
): number {
  if (
    !Number.isSafeInteger(quantityUnits)
    || quantityUnits <= 0
    || !Number.isSafeInteger(unitAmountCents)
    || unitAmountCents < 0
  ) {
    throw badRequest('Invoice line values exceed the supported accounting range');
  }
  const exact = (
    BigInt(quantityUnits) * BigInt(unitAmountCents) + 5_000n
  ) / 10_000n;
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw badRequest('Invoice line total is too large');
  }
  return Number(exact);
}

async function replaceDraftLines(
  finances: FinanceRow | FinanceRow[],
  invoice: InvoiceRow,
  inputs: InvoiceLineInput[],
  executor: FinanceExecutor,
  updatedAt = nextInvoiceUpdatedAt(invoice),
): Promise<void> {
  if (!Array.isArray(inputs) || inputs.length > 250) {
    throw badRequest('lines must contain at most 250 invoice lines');
  }
  const financeRows = Array.isArray(finances) ? finances : [finances];
  if (financeRows.length === 0) throw badRequest('Invoice must include at least one job');
  const financeById = new Map(financeRows.map((finance) => [finance.id, finance]));
  const financeIds = [...financeById.keys()];
  const currentLines = await executor.select().from(schedulerInvoiceLines)
    .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
  const currentExpenseIds = new Set(currentLines.flatMap((line) => (
    line.expenseId ? [line.expenseId] : []
  )));

  const activeRows = await executor.select({
    expenseId: schedulerInvoiceLines.expenseId,
  }).from(schedulerInvoiceLines)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceLines.invoiceId))
    .where(and(
      inArray(schedulerInvoiceLines.financeId, financeIds),
      inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
      ne(schedulerInvoices.id, invoice.id),
    ));
  const reservedExpenseIds = new Set(activeRows.flatMap((row) => (
    row.expenseId ? [row.expenseId] : []
  )));

  const requestedExpenseIds = inputs.flatMap((input) => (
    typeof input.expenseId === 'string' && input.expenseId.trim()
      ? [input.expenseId.trim()]
      : []
  ));
  if (new Set(requestedExpenseIds).size !== requestedExpenseIds.length) {
    throw badRequest('An expense can appear only once on an invoice');
  }
  const requestedLineIds = inputs.flatMap((input) => (
    typeof input.id === 'string' && input.id.trim() ? [input.id.trim()] : []
  ));
  if (new Set(requestedLineIds).size !== requestedLineIds.length) {
    throw badRequest('Invoice line ids must be unique');
  }
  const existingLineOwners = requestedLineIds.length === 0 ? [] : await executor.select({
    id: schedulerInvoiceLines.id,
    invoiceId: schedulerInvoiceLines.invoiceId,
  }).from(schedulerInvoiceLines).where(inArray(schedulerInvoiceLines.id, requestedLineIds));
  if (existingLineOwners.some((line) => line.invoiceId !== invoice.id)) {
    throw conflict('Invoice line ids cannot be reused from another invoice');
  }
  const expenseRows = requestedExpenseIds.length === 0 ? [] : await executor.select()
    .from(schedulerJobExpenses).where(and(
      inArray(schedulerJobExpenses.financeId, financeIds),
      inArray(schedulerJobExpenses.id, requestedExpenseIds),
      isNull(schedulerJobExpenses.deletedAt),
    ));
  const expenseById = new Map(expenseRows.map((row) => [row.id, row]));

  const values: Array<typeof schedulerInvoiceLines.$inferInsert> = [];
  const ids = new Set<string>();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]!;
    const financeId = financeRows.length === 1
      ? optionalText(input.financeId, 100) ?? financeRows[0]!.id
      : requireText(input.financeId, `lines[${index}].financeId`, 100);
    const finance = financeById.get(financeId);
    if (!finance) throw badRequest(`lines[${index}].financeId is not part of this invoice`);
    const expenseId = optionalText(input.expenseId, 100);
    const kind = input.kind ?? (expenseId ? 'expense' : 'other');
    if (!['labour', 'expense', 'quoted', 'other'].includes(kind)) {
      throw badRequest('Invoice line kind must be labour, expense, quoted, or other');
    }
    if ((kind === 'expense') !== Boolean(expenseId)) {
      throw badRequest('Expense invoice lines must have an expenseId, and other lines must not');
    }
    const rawQuantity = requiredNonnegativeNumber(input.quantity, `lines[${index}].quantity`);
    const quantityUnits = Math.round(rawQuantity * 10_000);
    if (quantityUnits <= 0) {
      throw badRequest(`lines[${index}].quantity must be at least 0.0001`);
    }
    if (!Number.isSafeInteger(quantityUnits)) {
      throw badRequest(`lines[${index}].quantity is too large`);
    }
    const quantity = quantityUnits / 10_000;
    const unitAmountCents = moneyToCents(
      input.unitAmountExGst,
      `lines[${index}].unitAmountExGst`,
    );
    const lineTotalCents = invoiceLineTotalCents(quantityUnits, unitAmountCents);
    const description = requireText(input.description, `lines[${index}].description`, 500);
    const id = optionalText(input.id, 100) ?? randomUUID();
    if (ids.has(id)) throw badRequest('Invoice line ids must be unique');
    ids.add(id);
    let category: string | null = null;
    if (kind === 'expense') {
      const expense = expenseById.get(expenseId!);
      if (!expense || expense.financeId !== financeId) {
        throw badRequest(`Expense ${expenseId} is not part of the selected job`);
      }
      if (!expense.billable) throw badRequest(`Expense ${expenseId} is not billable`);
      if (expense.invoiced && !currentExpenseIds.has(expense.id)) {
        throw conflict(`Expense ${expenseId} is already invoiced`);
      }
      if (reservedExpenseIds.has(expense.id)) {
        throw conflict(`Expense ${expense.id} is already reserved by another invoice`);
      }
      category = expense.category;
    }
    values.push({
      id,
      invoiceId: invoice.id,
      financeId,
      sortOrder: index,
      kind,
      description,
      quantity,
      unitAmountExGstCents: unitAmountCents,
      lineTotalExGstCents: lineTotalCents,
      showQuantityAndRate: input.showQuantityAndRate === true,
      expenseId,
      category,
      createdAt: new Date(),
    });
  }
  const totals = invoiceTotalsFromCents(
    values.map((value) => value.lineTotalExGstCents ?? 0),
    invoice.gstRateBps,
  );
  if (currentLines.length > 0) {
    await executor.delete(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
  }
  if (values.length > 0) {
    await executor.insert(schedulerInvoiceLines).values(values);
  }
  if (invoice.status === 'issued') {
    const requestedExpenseIdSet = new Set(requestedExpenseIds);
    const removedExpenseIds = [...currentExpenseIds].filter((expenseId) => (
      !requestedExpenseIdSet.has(expenseId) && !reservedExpenseIds.has(expenseId)
    ));
    if (removedExpenseIds.length > 0) {
      await executor.update(schedulerJobExpenses).set({
        invoiced: false,
        updatedAt: new Date(),
      }).where(inArray(schedulerJobExpenses.id, removedExpenseIds));
    }
    if (requestedExpenseIds.length > 0) {
      await executor.update(schedulerJobExpenses).set({
        invoiced: true,
        updatedAt: new Date(),
      }).where(inArray(schedulerJobExpenses.id, requestedExpenseIds));
    }
  }
  await executor.update(schedulerInvoices).set({
    subtotalExGstCents: totals.subtotal,
    gstAmountCents: totals.gst,
    totalIncGstCents: totals.total,
    updatedAt,
  }).where(and(
    eq(schedulerInvoices.id, invoice.id),
    inArray(schedulerInvoices.status, ['draft', 'issued']),
  ));
}

export async function listSchedulerInvoices(
  user: AuthUser,
  eventId: string,
): Promise<SchedulerInvoiceListItemDto[]> {
  await requireGlobalFinanceAdmin(user);
  const { finance } = await financeForEvent(eventId);
  return listInvoicesForFinance(finance.id);
}

export async function listSchedulerInvoicesByFinanceId(
  user: AuthUser,
  financeId: string,
): Promise<SchedulerInvoiceListItemDto[]> {
  await requireGlobalFinanceAdmin(user);
  const context = await financeById(financeId);
  return listInvoicesForFinance(context.finance.id);
}

async function listInvoicesForFinance(
  financeId: string,
  executor: FinanceExecutor = db,
): Promise<SchedulerInvoiceListItemDto[]> {
  const refs = await executor.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
    .from(schedulerInvoiceJobs)
    .where(eq(schedulerInvoiceJobs.financeId, financeId));
  const ids = refs.map((row) => row.invoiceId);
  const rows = await executor.select().from(schedulerInvoices)
    .where(and(
      ids.length > 0
      ? or(eq(schedulerInvoices.financeId, financeId), inArray(schedulerInvoices.id, ids))
      : eq(schedulerInvoices.financeId, financeId),
      ...schedulerInvoiceVisibilityConditions(),
    ))
    .orderBy(desc(schedulerInvoices.createdAt));
  return invoiceListItems(rows, executor);
}

export async function getSchedulerInvoice(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  const { finance } = await financeForEvent(eventId);
  return loadInvoiceDto(finance.id, invoiceId);
}

export async function getSchedulerInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  const context = await financeById(financeId);
  return loadInvoiceDto(context.finance.id, invoiceId);
}

async function createQuickSchedulerInvoiceForContext(
  actor: FinanceActor,
  context: FinanceContext,
  input: QuickInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  const invoiceId = randomUUID();
  await db.transaction(async (tx) => {
    const completionBySource = await lockCurrentCompletionReadiness([context.source], tx);
    assertInvoiceCompletionReady(
      context.source,
      context.metadata.jobName,
      completionBySource.get(financeSourceKey(context.source))
        ?? { satisfied: false, basis: null },
    );
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    if (financeSourceKey({
      sourceApp: finance.sourceApp,
      sourceType: finance.sourceType,
      sourceId: finance.sourceId,
    } as FinanceSource) !== financeSourceKey(context.source)) {
      throw conflict('The selected job changed; retry invoice creation');
    }
    const metadata = await loadJobMetadata(context.source, context.event, tx);
    const [summary, reserved] = await Promise.all([
      buildFinancialSummary(context.source, context.event, tx),
      reservationRollup(finance.id, tx),
    ]);
    const reservations = await expenseReservations(finance.id, tx);
    const requestedExpenseIds = input.expenseIds === undefined
      ? null
      : [...new Set(input.expenseIds.map((id) => requireText(id, 'expenseId', 100)))];
    if (requestedExpenseIds && requestedExpenseIds.length !== input.expenseIds!.length) {
      throw badRequest('expenseIds must be unique');
    }
    const allExpenses = await tx.select().from(schedulerJobExpenses).where(and(
      eq(schedulerJobExpenses.financeId, finance.id),
      isNull(schedulerJobExpenses.deletedAt),
    )).orderBy(asc(schedulerJobExpenses.incurredAt), asc(schedulerJobExpenses.createdAt));
    const selectedExpenses = allExpenses.filter((expense) => (
      expense.billable
      && !expense.invoiced
      && !reservations.has(expense.id)
      && (requestedExpenseIds === null || requestedExpenseIds.includes(expense.id))
    ));
    if (requestedExpenseIds) {
      const selected = new Set(selectedExpenses.map((expense) => expense.id));
      const unavailable = requestedExpenseIds.find((id) => !selected.has(id));
      if (unavailable) {
        throw conflict(
          `Expense ${unavailable} is missing, non-billable, invoiced, or already reserved`,
        );
      }
    }
    const now = new Date();
    const invoiceNumber = await allocateInvoiceNumber(now, tx);
    const billToName = finance.billToName?.trim();
    if (!billToName) throw badRequest('Set a billing name before creating an invoice');
    const gstRateBps = Math.round(config.schedulerInvoice.gstRate * 10_000);
    if (!Number.isSafeInteger(gstRateBps) || gstRateBps < 0 || gstRateBps > 10_000) {
      throw new Error('scheduler_invoice_gst_rate_invalid');
    }
    const seller = await invoiceSellerSnapshot(tx);
    await tx.insert(schedulerInvoices).values({
      id: invoiceId,
      financeId: finance.id,
      invoiceNumber,
      status: 'draft',
      currency: finance.currency,
      dueDate: null,
      subtotalExGstCents: 0,
      gstAmountCents: 0,
      totalIncGstCents: 0,
      gstRateBps,
      notes: optionalText(input.notes, 5_000),
      ...seller,
      billToName,
      billToAbn: finance.billToAbn,
      billToAddress: finance.billToAddress,
      billToEmail: finance.billToEmail,
      purchaseOrderReference: finance.billingReference,
      jobSiteName: metadata.siteName,
      jobSiteAddress: metadata.siteAddress,
      jobName: metadata.jobName,
      jobDate: metadata.jobDate,
      jobClientName: metadata.clientName,
      jobStatus: metadata.status,
      jobSourceApp: context.source.sourceApp,
      jobSourceType: context.source.sourceType,
      jobSourceId: context.source.sourceId,
      createdByUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schedulerInvoiceJobs).values({
      invoiceId,
      financeId: finance.id,
      sortOrder: 0,
      billingReference: finance.billingReference,
      jobSiteName: metadata.siteName,
      jobSiteAddress: metadata.siteAddress,
      jobName: metadata.jobName,
      jobDate: metadata.jobDate,
      jobClientName: metadata.clientName,
      jobStatus: metadata.status,
      jobSourceApp: context.source.sourceApp,
      jobSourceType: context.source.sourceType,
      jobSourceId: context.source.sourceId,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [schedulerInvoiceJobs.invoiceId, schedulerInvoiceJobs.financeId],
      set: {
        sortOrder: sql`excluded.sort_order`,
        billingReference: sql`excluded.billing_reference`,
        jobSiteName: sql`excluded.job_site_name`,
        jobSiteAddress: sql`excluded.job_site_address`,
        jobName: sql`excluded.job_name`,
        jobDate: sql`excluded.job_date`,
        jobClientName: sql`excluded.job_client_name`,
        jobStatus: sql`excluded.job_status`,
        jobSourceApp: sql`excluded.job_source_app`,
        jobSourceType: sql`excluded.job_source_type`,
        jobSourceId: sql`excluded.job_source_id`,
      },
    });
    const lines: InvoiceLineInput[] = [];
    if (input.includeLabour !== false) {
      if (finance.pricingMode === 'quoted') {
        const remainingCents = Math.max(
          0,
          (finance.quotedAmountCents ?? 0) - reserved.reservedQuoteCents,
        );
        if (remainingCents > 0) {
          lines.push({
            kind: 'quoted',
            description: `Quoted ${metadata.jobName}`,
            quantity: 1,
            unitAmountExGst: centsToMoney(remainingCents),
            showQuantityAndRate: false,
          });
        }
      } else {
        const remainingCents = Math.max(
          0,
          moneyToCents(summary.time.labourRevenue, 'Labour suggestion')
            - reserved.reservedLabourCents,
        );
        if (remainingCents > 0) {
          lines.push({
            kind: 'labour',
            description: 'Labour suggestion',
            quantity: 1,
            unitAmountExGst: centsToMoney(remainingCents),
            showQuantityAndRate: false,
          });
        }
      }
    }
    for (const expense of selectedExpenses) {
      lines.push({
        kind: 'expense',
        description: expense.description,
        quantity: 1,
        unitAmountExGst: centsToMoney(
          expense.billableAmountCents ?? expense.costAmountCents,
        ),
        showQuantityAndRate: false,
        expenseId: expense.id,
      });
    }
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
    await replaceDraftLines(finance, invoice!, lines, tx);
  });
  return loadInvoiceDto(context.finance.id, invoiceId);
}

export async function createQuickSchedulerInvoice(
  user: AuthUser,
  eventId: string,
  input: QuickInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return createQuickSchedulerInvoiceForContext(actor, await financeForEvent(eventId), input);
}

export async function createQuickSchedulerInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  input: QuickInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  return createQuickSchedulerInvoiceForContext(actor, await financeById(financeId), input);
}

function validateConsolidatedJobs(
  input: ConsolidatedInvoiceInput,
): Array<ConsolidatedInvoiceJobInput & { financeId: string }> {
  if (!Array.isArray(input.jobs) || input.jobs.length < 1 || input.jobs.length > 50) {
    throw badRequest('jobs must contain between 1 and 50 selected jobs');
  }
  const jobs = input.jobs.map((job, index) => ({
    ...job,
    financeId: requireText(job.financeId, `jobs[${index}].financeId`, 100),
  }));
  if (new Set(jobs.map((job) => job.financeId)).size !== jobs.length) {
    throw badRequest('Each financeId can appear only once');
  }
  const expenseIds = jobs.flatMap((job) => job.expenseIds ?? []);
  if (new Set(expenseIds).size !== expenseIds.length) {
    throw badRequest('Each expenseId can appear only once');
  }
  return jobs;
}

export async function getConsolidatedInvoiceEligibility(
  user: AuthUser,
  financeIdsInput: string[],
): Promise<ConsolidatedInvoiceEligibilityDto> {
  await requireGlobalFinanceAdmin(user);
  if (!Array.isArray(financeIdsInput) || financeIdsInput.length < 1 || financeIdsInput.length > 50) {
    throw badRequest('financeIds must contain between 1 and 50 jobs');
  }
  const financeIds = financeIdsInput.map((id, index) => requireText(
    id,
    `financeIds[${index}]`,
    100,
  ));
  if (new Set(financeIds).size !== financeIds.length) {
    throw badRequest('financeIds must be unique');
  }
  const contexts: FinanceContext[] = [];
  for (const financeId of financeIds) contexts.push(await financeById(financeId));
  const summaries: SchedulerFinancialSummaryDto[] = [];
  for (const context of contexts) {
    summaries.push(await buildFinancialSummary(context.source, context.event));
  }
  const currencies = [...new Set(summaries.map((summary) => summary.currency))];
  const billingPartyKeys = new Set(contexts.map((context) => billingPartyKey(context.finance)));
  const issues: ConsolidatedInvoiceEligibilityDto['issues'] = [];
  if (currencies.length !== 1) issues.push({
    code: 'mixed_currency',
    message: 'Selected jobs must use the same currency',
    financeId: null,
  });
  summaries.forEach((summary) => {
    if (!summary.invoiceReadiness.completionSatisfied) issues.push({
      code: 'job_not_completed',
      message: summary.source.sourceApp === 'solarsense'
        ? 'Mark this assessment complete before generating an invoice'
        : 'Mark this job complete before generating an invoice',
      financeId: summary.financeId,
    });
    if (!summary.billing.name?.trim()) issues.push({
      code: 'billing_name_missing',
      message: 'This job needs a billing name or an explicit consolidated bill-to snapshot',
      financeId: summary.financeId,
    });
    if (summary.time.missingBillingRateUsers.length > 0) issues.push({
      code: 'billing_rate_missing',
      message: `Ask an admin to set a billing rate for ${summary.time.missingBillingRateUsers
        .map((entry) => entry.displayName ?? entry.userId).join(', ')}`,
      financeId: summary.financeId,
    });
  });
  if (billingPartyKeys.size > 1) issues.push({
    code: 'bill_to_override_required',
    message: 'Selected jobs have different billing parties; enter one consolidated bill-to snapshot',
    financeId: null,
  });
  const jobs: ConsolidatedInvoiceEligibilityJobDto[] = [];
  for (let index = 0; index < contexts.length; index += 1) {
    const context = contexts[index]!;
    const summary = summaries[index]!;
    const reservations = await reservationRollup(context.finance.id);
    const availableLabourCents = context.finance.pricingMode === 'charge_up'
      ? Math.max(
          0,
          moneyToCents(summary.time.labourRevenue, 'Available labour')
            - reservations.reservedLabourCents,
        )
      : 0;
    const availableLabourHours = availableLabourCents > 0
      ? summary.time.billableHours
      : 0;
    const availableQuotedCents = context.finance.pricingMode === 'quoted'
      ? Math.max(0, (context.finance.quotedAmountCents ?? 0) - reservations.reservedQuoteCents)
      : 0;
    const availableExpenses = summary.expenses.filter((expense) => (
      expense.billable && !expense.invoiced && !expense.reserved
    ));
    const availableLabourAmount = centsToMoney(availableLabourCents);
    jobs.push({
      financeId: context.finance.id,
      source: context.source,
      job: context.metadata,
      currency: context.finance.currency,
      pricingMode: context.finance.pricingMode as PricingMode,
      billing: summary.billing,
      invoiceReadiness: summary.invoiceReadiness,
      availableLabourHours,
      billableRate: summary.time.billableRate,
      availableLabourAmount,
      availableQuotedAmount: centsToMoney(availableQuotedCents),
      availableExpenses,
    });
    if (
      availableLabourAmount <= 0
      && availableQuotedCents <= 0
      && !availableExpenses.some((expense) => expense.effectiveBillableAmount > 0)
    ) issues.push({
      code: 'no_available_charges',
      message: 'This job has no positive unreserved charges to invoice',
      financeId: context.finance.id,
    });
  }
  return {
    eligible: !issues.some((issue) => (
      issue.code === 'mixed_currency'
      || issue.code === 'job_not_completed'
      || issue.code === 'no_available_charges'
    )),
    commonCurrency: currencies.length === 1 ? currencies[0]! : null,
    gstRate: config.schedulerInvoice.gstRate,
    requiresExplicitBillTo: billingPartyKeys.size > 1
      || summaries.some((summary) => !summary.billing.name?.trim()),
    issues,
    jobs,
  };
}

export async function createConsolidatedSchedulerInvoice(
  user: AuthUser,
  input: ConsolidatedInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  const requestedJobs = validateConsolidatedJobs(input);
  const invoiceId = randomUUID();
  await db.transaction(async (tx) => {
    const sortedFinanceIds = requestedJobs.map((job) => job.financeId).sort();
    const candidateFinances = await tx.select().from(schedulerJobFinance)
      .where(inArray(schedulerJobFinance.id, sortedFinanceIds))
      .orderBy(asc(schedulerJobFinance.id));
    if (candidateFinances.length !== sortedFinanceIds.length) throw notFound('Job finance');
    const candidateSources = candidateFinances.map((finance) => ({
      sourceApp: finance.sourceApp,
      sourceType: finance.sourceType,
      sourceId: finance.sourceId,
    } as FinanceSource));
    if (candidateSources.some((source) => !isSupportedSource(source))) {
      throw badRequest('Unsupported commercial source job');
    }
    for (const source of candidateSources) {
      assertSchedulerFinanceSourceAppVisible(source.sourceApp);
    }
    const candidateSourceByFinanceId = new Map(candidateFinances.map((finance, index) => (
      [finance.id, financeSourceKey(candidateSources[index]!)]
    )));
    const completionBySource = await lockCurrentCompletionReadiness(candidateSources, tx);
    const lockedFinances = await tx.select().from(schedulerJobFinance)
      .where(inArray(schedulerJobFinance.id, sortedFinanceIds))
      .orderBy(asc(schedulerJobFinance.id))
      .for('update');
    if (lockedFinances.length !== sortedFinanceIds.length) throw notFound('Job finance');
    if (lockedFinances.some((finance) => candidateSourceByFinanceId.get(finance.id) !== (
      financeSourceKey({
        sourceApp: finance.sourceApp,
        sourceType: finance.sourceType,
        sourceId: finance.sourceId,
      } as FinanceSource)
    ))) throw conflict('A selected job changed; retry invoice creation');
    const financeById = new Map(lockedFinances.map((finance) => [finance.id, finance]));
    const orderedFinances = requestedJobs.map((job) => financeById.get(job.financeId)!);
    const currencies = [...new Set(orderedFinances.map((finance) => finance.currency))];
    if (currencies.length !== 1) throw conflict('Selected jobs must use the same currency');
    const partyKeys = new Set(orderedFinances.map(billingPartyKey));
    if (partyKeys.size > 1 && !input.billTo) {
      throw badRequest('Selected jobs have different billing parties; provide an explicit billTo snapshot');
    }
    const anchor = orderedFinances[0]!;
    const billToName = input.billTo
      ? requireText(input.billTo.name, 'billTo.name', 300)
      : anchor.billToName?.trim();
    if (!billToName) throw badRequest('Set a billing name before creating an invoice');
    const contexts: FinanceContext[] = [];
    for (const finance of orderedFinances) {
      const source = {
        sourceApp: finance.sourceApp,
        sourceType: finance.sourceType,
        sourceId: finance.sourceId,
      } as FinanceSource;
      if (!isSupportedSource(source)) throw badRequest('Unsupported commercial source job');
      assertSchedulerFinanceSourceAppVisible(source.sourceApp);
      const event = await latestEventForSource(source, tx);
      const metadata = await loadJobMetadata(source, event, tx);
      assertInvoiceCompletionReady(
        source,
        metadata.jobName,
        completionBySource.get(financeSourceKey(source))
          ?? { satisfied: false, basis: null },
      );
      contexts.push({
        finance,
        source,
        event,
        metadata,
      });
    }
    const now = new Date();
    const invoiceNumber = await allocateInvoiceNumber(now, tx);
    const gstRateBps = Math.round(config.schedulerInvoice.gstRate * 10_000);
    if (!Number.isSafeInteger(gstRateBps) || gstRateBps < 0 || gstRateBps > 10_000) {
      throw new Error('scheduler_invoice_gst_rate_invalid');
    }
    const primary = contexts[0]!;
    const explicitBillTo = input.billTo;
    const seller = await invoiceSellerSnapshot(tx);
    await tx.insert(schedulerInvoices).values({
      id: invoiceId,
      financeId: primary.finance.id,
      invoiceNumber,
      status: 'draft',
      currency: primary.finance.currency,
      dueDate: null,
      subtotalExGstCents: 0,
      gstAmountCents: 0,
      totalIncGstCents: 0,
      gstRateBps,
      notes: optionalText(input.notes, 5_000),
      ...seller,
      billToName,
      billToAbn: explicitBillTo
        ? optionalText(explicitBillTo.abn, 100)
        : anchor.billToAbn,
      billToAddress: explicitBillTo
        ? optionalText(explicitBillTo.address, 1_000)
        : anchor.billToAddress,
      billToEmail: explicitBillTo
        ? optionalText(explicitBillTo.email, 320)
        : anchor.billToEmail,
      purchaseOrderReference: explicitBillTo
        ? optionalText(explicitBillTo.purchaseOrderReference, 200)
        : anchor.billingReference,
      jobSiteName: primary.metadata.siteName,
      jobSiteAddress: primary.metadata.siteAddress,
      jobName: primary.metadata.jobName,
      jobDate: primary.metadata.jobDate,
      jobClientName: primary.metadata.clientName,
      jobStatus: primary.metadata.status,
      jobSourceApp: primary.source.sourceApp,
      jobSourceType: primary.source.sourceType,
      jobSourceId: primary.source.sourceId,
      createdByUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schedulerInvoiceJobs).values(contexts.map((context, index) => ({
      invoiceId,
      financeId: context.finance.id,
      sortOrder: index,
      billingReference: context.finance.billingReference,
      jobSiteName: context.metadata.siteName,
      jobSiteAddress: context.metadata.siteAddress,
      jobName: context.metadata.jobName,
      jobDate: context.metadata.jobDate,
      jobClientName: context.metadata.clientName,
      jobStatus: context.metadata.status,
      jobSourceApp: context.source.sourceApp,
      jobSourceType: context.source.sourceType,
      jobSourceId: context.source.sourceId,
      createdAt: now,
    }))).onConflictDoUpdate({
      target: [schedulerInvoiceJobs.invoiceId, schedulerInvoiceJobs.financeId],
      set: {
        sortOrder: sql`excluded.sort_order`,
        billingReference: sql`excluded.billing_reference`,
        jobSiteName: sql`excluded.job_site_name`,
        jobSiteAddress: sql`excluded.job_site_address`,
        jobName: sql`excluded.job_name`,
        jobDate: sql`excluded.job_date`,
        jobClientName: sql`excluded.job_client_name`,
        jobStatus: sql`excluded.job_status`,
        jobSourceApp: sql`excluded.job_source_app`,
        jobSourceType: sql`excluded.job_source_type`,
        jobSourceId: sql`excluded.job_source_id`,
      },
    });
    const lines: InvoiceLineInput[] = [];
    for (let index = 0; index < contexts.length; index += 1) {
      const context = contexts[index]!;
      const request = requestedJobs[index]!;
      const [summary, reserved] = await Promise.all([
        buildFinancialSummary(context.source, context.event, tx),
        reservationRollup(context.finance.id, tx),
      ]);
      if (request.includeLabour !== false) {
        if (context.finance.pricingMode === 'quoted') {
          const remainingCents = Math.max(
            0,
            (context.finance.quotedAmountCents ?? 0) - reserved.reservedQuoteCents,
          );
          if (remainingCents > 0) lines.push({
            financeId: context.finance.id,
            kind: 'quoted',
            description: `Quoted ${context.metadata.jobName}`,
            quantity: 1,
            unitAmountExGst: centsToMoney(remainingCents),
            showQuantityAndRate: false,
          });
        } else {
          const remainingCents = Math.max(
            0,
            moneyToCents(summary.time.labourRevenue, 'Labour suggestion')
              - reserved.reservedLabourCents,
          );
          if (remainingCents > 0) lines.push({
            financeId: context.finance.id,
            kind: 'labour',
            description: `Labour suggestion — ${context.metadata.jobName}`,
            quantity: 1,
            unitAmountExGst: centsToMoney(remainingCents),
            showQuantityAndRate: false,
          });
        }
      }
      const requestedExpenseIds = request.expenseIds === undefined
        ? null
        : request.expenseIds.map((id) => requireText(id, 'expenseId', 100));
      if (requestedExpenseIds && new Set(requestedExpenseIds).size !== requestedExpenseIds.length) {
        throw badRequest('expenseIds must be unique');
      }
      const reservations = await expenseReservations(context.finance.id, tx);
      const expenses = await tx.select().from(schedulerJobExpenses).where(and(
        eq(schedulerJobExpenses.financeId, context.finance.id),
        isNull(schedulerJobExpenses.deletedAt),
      )).orderBy(asc(schedulerJobExpenses.incurredAt), asc(schedulerJobExpenses.createdAt));
      const selected = expenses.filter((expense) => (
        expense.billable
        && !expense.invoiced
        && !reservations.has(expense.id)
        && (requestedExpenseIds === null || requestedExpenseIds.includes(expense.id))
      ));
      if (requestedExpenseIds) {
        const selectedIds = new Set(selected.map((expense) => expense.id));
        const unavailable = requestedExpenseIds.find((id) => !selectedIds.has(id));
        if (unavailable) throw conflict(
          `Expense ${unavailable} is missing, non-billable, invoiced, or already reserved`,
        );
      }
      for (const expense of selected) lines.push({
        financeId: context.finance.id,
        kind: 'expense',
        description: expense.description,
        quantity: 1,
        unitAmountExGst: centsToMoney(expense.billableAmountCents ?? expense.costAmountCents),
        showQuantityAndRate: false,
        expenseId: expense.id,
      });
    }
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
    await replaceDraftLines(lockedFinances, invoice!, lines, tx);
  });
  return loadInvoiceDto(null, invoiceId);
}

async function updateSchedulerDraftInvoiceForContext(
  context: FinanceContext | null,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [unlockedInvoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
    if (!unlockedInvoice) throw notFound('Invoice');
    const { jobs, finances } = await lockInvoiceFinances(unlockedInvoice, tx);
    if (context) assertInvoiceFinanceMembership(jobs, context.finance.id);
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'void') throw conflict('Void invoices cannot be edited');
    const updatesInvoiceContent = input.notes !== undefined
      || input.dueDate !== undefined
      || input.billToName !== undefined
      || input.billToAbn !== undefined
      || input.billToAddress !== undefined
      || input.billToEmail !== undefined
      || input.purchaseOrderReference !== undefined
      || input.lines !== undefined;
    if (invoice.status === 'paid' && updatesInvoiceContent) {
      throw conflict('Paid invoice content cannot be edited');
    }
    if (invoice.status === 'issued' && updatesInvoiceContent) {
      const [postedRefund] = await tx.select({ id: schedulerInvoiceRefunds.id })
        .from(schedulerInvoiceRefunds)
        .where(and(
          eq(schedulerInvoiceRefunds.invoiceId, invoice.id),
          eq(schedulerInvoiceRefunds.status, 'posted'),
        ))
        .limit(1);
      if (postedRefund) throw conflict('Reverse posted refunds before revising this invoice');
    }
    assertInvoiceVersion(invoice, input.expectedUpdatedAt);
    const mutationUpdatedAt = nextInvoiceUpdatedAt(invoice);
    const patch: Partial<typeof schedulerInvoices.$inferInsert> = {};
    if (input.xeroInvoiceNumber !== undefined) {
      patch.xeroInvoiceNumber = optionalText(input.xeroInvoiceNumber, 100);
    }
    if (input.xeroDate !== undefined) {
      patch.xeroDate = parseSchedulerInvoiceXeroDate(input.xeroDate);
    }
    if (input.notes !== undefined) patch.notes = optionalText(input.notes, 5_000);
    if (input.dueDate !== undefined) patch.dueDate = parseDate(input.dueDate, 'dueDate');
    if (input.billToName !== undefined) {
      patch.billToName = requireText(input.billToName, 'billToName', 300);
    }
    if (input.billToAbn !== undefined) {
      patch.billToAbn = optionalText(input.billToAbn, 100);
    }
    if (input.billToAddress !== undefined) {
      patch.billToAddress = optionalText(input.billToAddress, 1_000);
    }
    if (input.billToEmail !== undefined) {
      patch.billToEmail = optionalText(input.billToEmail, 320);
    }
    if (input.purchaseOrderReference !== undefined) {
      patch.purchaseOrderReference = optionalText(input.purchaseOrderReference, 200);
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = mutationUpdatedAt;
      await tx.update(schedulerInvoices).set(patch).where(eq(schedulerInvoices.id, invoice.id));
    }
    if (input.lines !== undefined) {
      await replaceDraftLines(finances, invoice, input.lines, tx, mutationUpdatedAt);
    }
  });
  return loadInvoiceDto(context?.finance.id ?? null, invoiceId);
}

export async function updateSchedulerDraftInvoice(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return updateSchedulerDraftInvoiceForContext(
    await financeForEvent(eventId),
    invoiceId,
    input,
  );
}

export async function updateSchedulerDraftInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return updateSchedulerDraftInvoiceForContext(await financeById(financeId), invoiceId, input);
}

export async function updateConsolidatedSchedulerDraftInvoice(
  user: AuthUser,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return updateSchedulerDraftInvoiceForContext(null, invoiceId, input);
}

async function issueSchedulerInvoiceForContext(
  context: FinanceContext | null,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [unlockedInvoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
    if (!unlockedInvoice) throw notFound('Invoice');
    const candidateJobs = await invoiceJobsForRow(unlockedInvoice, tx);
    const candidateSources = candidateJobs.map((job) => ({
      sourceApp: job.jobSourceApp,
      sourceType: job.jobSourceType,
      sourceId: job.jobSourceId,
    } as FinanceSource));
    const candidateSourceByFinanceId = new Map(candidateJobs.map((job, index) => (
      [job.financeId, financeSourceKey(candidateSources[index]!)]
    )));
    const completionBySource = await lockCurrentCompletionReadiness(candidateSources, tx);
    const { jobs, finances } = await lockInvoiceFinances(unlockedInvoice, tx);
    if (
      jobs.length !== candidateJobs.length
      || jobs.some((job) => candidateSourceByFinanceId.get(job.financeId) !== financeSourceKey({
        sourceApp: job.jobSourceApp,
        sourceType: job.jobSourceType,
        sourceId: job.jobSourceId,
      } as FinanceSource))
    ) throw conflict('Invoice jobs changed; refresh before issuing');
    if (context) assertInvoiceFinanceMembership(jobs, context.finance.id);
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status !== 'draft' && invoice.status !== 'issued') {
      throw conflict('Only draft or issued invoices can be issued');
    }
    assertInvoiceVersion(invoice, expectedUpdatedAt);
    let lines = await tx.select().from(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
    if (lines.length === 0 || invoice.subtotalExGstCents <= 0) {
      throw conflict('Invoice must contain at least one positive-value line');
    }
    for (const job of jobs) {
      const jobSubtotalCents = lines.filter((line) => line.financeId === job.financeId)
        .reduce((total, line) => addAccountingCents(
          total,
          line.lineTotalExGstCents,
          'Invoice job subtotal',
        ), 0);
      if (jobSubtotalCents <= 0) {
        throw conflict(`Every invoice job must contain a positive-value line (${job.financeId})`);
      }
    }
    const invoiceJobByFinance = new Map(jobs.map((job) => [job.financeId, job]));
    for (const finance of finances) {
      const source = {
        sourceApp: finance.sourceApp,
        sourceType: finance.sourceType,
        sourceId: finance.sourceId,
      } as FinanceSource;
      const jobName = invoiceJobByFinance.get(finance.id)?.jobName ?? finance.id;
      assertInvoiceCompletionReady(
        source,
        jobName,
        completionBySource.get(financeSourceKey(source))
          ?? { satisfied: false, basis: null },
      );
    }
    const transitionAt = new Date();
    const normalizationUpdatedAt = nextInvoiceUpdatedAt(invoice, transitionAt);
    await replaceDraftLines(finances, invoice, lines.map((line) => ({
      id: line.id,
      financeId: line.financeId,
      kind: line.kind as InvoiceLineKind,
      description: line.description,
      quantity: line.quantity,
      unitAmountExGst: centsToMoney(line.unitAmountExGstCents),
      showQuantityAndRate: line.showQuantityAndRate,
      expenseId: line.expenseId,
    })), tx, normalizationUpdatedAt);
    lines = await tx.select().from(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
    if (
      invoice.dueDate
      && isSchedulerInvoiceDueDateBeforeIssueDate(invoice.dueDate, transitionAt)
    ) {
      throw conflict('Invoice due date cannot be before its issue date');
    }
    const seller = await invoiceSellerSnapshot(tx);
    if (invoice.gstRateBps > 0 && !seller.sellerAbn) {
      throw conflict('Configure the seller ABN before issuing an invoice with GST');
    }
    const metadataByFinance = new Map<string, JobMetadata>();
    for (const job of jobs) {
      const source = {
        sourceApp: job.jobSourceApp,
        sourceType: job.jobSourceType,
        sourceId: job.jobSourceId,
      } as FinanceSource;
      const event = await latestEventForSource(source, tx);
      const metadata = await loadJobMetadata(source, event, tx);
      assertInvoiceCompletionReady(
        source,
        metadata.jobName,
        completionBySource.get(financeSourceKey(source))
          ?? { satisfied: false, basis: null },
      );
      metadataByFinance.set(job.financeId, metadata);
      await tx.update(schedulerInvoiceJobs).set({
        billingReference: finances.find((finance) => finance.id === job.financeId)?.billingReference
          ?? job.billingReference,
        jobSiteName: metadata.siteName,
        jobSiteAddress: metadata.siteAddress,
        jobName: metadata.jobName,
        jobDate: metadata.jobDate,
        jobClientName: metadata.clientName,
        jobStatus: metadata.status,
      }).where(and(
        eq(schedulerInvoiceJobs.invoiceId, invoice.id),
        eq(schedulerInvoiceJobs.financeId, job.financeId),
      ));
    }
    const primaryMetadata = metadataByFinance.get(invoice.financeId)
      ?? metadataByFinance.values().next().value as JobMetadata | undefined;
    if (!primaryMetadata) throw conflict('Invoice has no job snapshot');
    const issuedUpdatedAt = nextSchedulerInvoiceRevisionAt(normalizationUpdatedAt);
    await markCurrentMultiJobInvoiceWriter(tx);
    const [issuedInvoice] = await tx.update(schedulerInvoices).set({
      status: 'issued',
      issueDate: invoice.issueDate ?? transitionAt,
      issuedAt: invoice.issuedAt ?? transitionAt,
      dueDate: invoice.dueDate
        ?? new Date(transitionAt.getTime() + config.schedulerInvoice.dueDays * 86_400_000),
      ...seller,
      jobSiteName: primaryMetadata.siteName,
      jobSiteAddress: primaryMetadata.siteAddress,
      jobName: primaryMetadata.jobName,
      jobDate: primaryMetadata.jobDate,
      jobClientName: primaryMetadata.clientName,
      jobStatus: primaryMetadata.status,
      updatedAt: issuedUpdatedAt,
    }).where(and(
      eq(schedulerInvoices.id, invoice.id),
      inArray(schedulerInvoices.status, ['draft', 'issued']),
      eq(schedulerInvoices.updatedAt, normalizationUpdatedAt),
    )).returning({ id: schedulerInvoices.id });
    if (!issuedInvoice) throw conflict('Invoice changed; refresh before issuing');
    const expenseIds = lines.flatMap((line) => line.expenseId ? [line.expenseId] : []);
    if (expenseIds.length > 0) {
      await tx.update(schedulerJobExpenses).set({ invoiced: true, updatedAt: transitionAt })
        .where(inArray(schedulerJobExpenses.id, expenseIds));
    }
  });
  return loadInvoiceDto(context?.finance.id ?? null, invoiceId);
}

export async function issueSchedulerInvoice(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return issueSchedulerInvoiceForContext(
    await financeForEvent(eventId),
    invoiceId,
    expectedUpdatedAt,
  );
}

export async function issueSchedulerInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return issueSchedulerInvoiceForContext(
    await financeById(financeId),
    invoiceId,
    expectedUpdatedAt,
  );
}

export async function issueConsolidatedSchedulerInvoice(
  user: AuthUser,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return issueSchedulerInvoiceForContext(null, invoiceId, expectedUpdatedAt);
}

async function voidSchedulerInvoiceForContext(
  context: FinanceContext | null,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  try {
    await db.transaction(async (tx) => {
      const [unlockedInvoice] = await tx.select().from(schedulerInvoices)
        .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
      if (!unlockedInvoice) throw notFound('Invoice');
      const { jobs } = await lockInvoiceFinances(unlockedInvoice, tx);
      if (context) assertInvoiceFinanceMembership(jobs, context.finance.id);
      const [invoice] = await tx.select().from(schedulerInvoices)
        .where(eq(schedulerInvoices.id, invoiceId)).for('update').limit(1);
      if (!invoice) throw notFound('Invoice');
      assertInvoiceVersion(invoice, expectedUpdatedAt);
      if (invoice.status === 'void') return;
      if (invoice.status === 'paid') throw conflict('Paid invoices cannot be voided');
      const [postedRefund] = await tx.select({ id: schedulerInvoiceRefunds.id })
        .from(schedulerInvoiceRefunds)
        .where(and(
          eq(schedulerInvoiceRefunds.invoiceId, invoice.id),
          eq(schedulerInvoiceRefunds.status, 'posted'),
        ))
        .limit(1);
      if (postedRefund) {
        throw conflict('Void or reverse every posted refund before voiding this invoice');
      }
      const lines = await tx.select().from(schedulerInvoiceLines)
        .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
      const now = new Date();
      const updatedAt = nextInvoiceUpdatedAt(invoice, now);
      await markCurrentMultiJobInvoiceWriter(tx);
      await tx.update(schedulerInvoices).set({
        status: 'void',
        voidedAt: now,
        updatedAt,
      }).where(eq(schedulerInvoices.id, invoice.id));
      const expenseIds = lines.flatMap((line) => line.expenseId ? [line.expenseId] : []);
      if (expenseIds.length > 0) {
        await tx.update(schedulerJobExpenses).set({ invoiced: false, updatedAt: now })
          .where(inArray(schedulerJobExpenses.id, expenseIds));
      }
    });
  } catch (error) {
    if (isInvoiceEmailDeliveryInProgressDatabaseError(error)) {
      throw conflict('Invoice email delivery is in progress; wait for it to finish before voiding');
    }
    throw error;
  }
  return loadInvoiceDto(context?.finance.id ?? null, invoiceId);
}

export async function voidSchedulerInvoice(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return voidSchedulerInvoiceForContext(await financeForEvent(eventId), invoiceId, expectedUpdatedAt);
}

export async function voidSchedulerInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return voidSchedulerInvoiceForContext(await financeById(financeId), invoiceId, expectedUpdatedAt);
}

export async function voidConsolidatedSchedulerInvoice(
  user: AuthUser,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return voidSchedulerInvoiceForContext(null, invoiceId, expectedUpdatedAt);
}

async function markSchedulerInvoicePaidForContext(
  context: FinanceContext | null,
  invoiceId: string,
  paidAtInput?: string | null,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [unlockedInvoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).limit(1);
    if (!unlockedInvoice) throw notFound('Invoice');
    const { jobs } = await lockInvoiceFinances(unlockedInvoice, tx);
    if (context) assertInvoiceFinanceMembership(jobs, context.finance.id);
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId)).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    assertInvoiceVersion(invoice, expectedUpdatedAt);
    if (invoice.status === 'paid') return;
    if (invoice.status !== 'issued') throw conflict('Only issued invoices can be marked paid');
    const transitionAt = new Date();
    const paidAt = paidAtInput === undefined || paidAtInput === null
      ? transitionAt
      : parseDate(paidAtInput, 'paidAt')!;
    if (paidAt.getTime() > transitionAt.getTime()) {
      throw badRequest('paidAt cannot be in the future');
    }
    const issuedBoundary = invoice.issuedAt ?? invoice.issueDate;
    if (issuedBoundary && paidAt.getTime() < issuedBoundary.getTime()) {
      throw badRequest('paidAt cannot be before the invoice was issued');
    }
    await markCurrentMultiJobInvoiceWriter(tx);
    await tx.update(schedulerInvoices).set({
      status: 'paid',
      paidAt,
      updatedAt: nextInvoiceUpdatedAt(invoice, transitionAt),
    }).where(eq(schedulerInvoices.id, invoice.id));
  });
  return loadInvoiceDto(context?.finance.id ?? null, invoiceId);
}

export async function markSchedulerInvoicePaid(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  paidAt?: string | null,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return markSchedulerInvoicePaidForContext(
    await financeForEvent(eventId),
    invoiceId,
    paidAt,
    expectedUpdatedAt,
  );
}

export async function markSchedulerInvoicePaidByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  paidAt?: string | null,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return markSchedulerInvoicePaidForContext(
    await financeById(financeId),
    invoiceId,
    paidAt,
    expectedUpdatedAt,
  );
}

export async function markConsolidatedSchedulerInvoicePaid(
  user: AuthUser,
  invoiceId: string,
  paidAt?: string | null,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return markSchedulerInvoicePaidForContext(null, invoiceId, paidAt, expectedUpdatedAt);
}

export async function getConsolidatedSchedulerInvoice(
  user: AuthUser,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return loadInvoiceDto(null, invoiceId);
}

/** Consistent, revision-pinned invoice DTO for an asynchronous export render. */
export async function loadSchedulerInvoiceExportSnapshot(
  user: AuthUser,
  financeId: string | null,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<SchedulerInvoiceDto> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    await requireGlobalFinanceAdmin(user, tx);
    // Preserve the source -> finance -> invoice lock order used by invoice mutations.
    await assertSchedulerInvoicePdfStartReady(invoiceId, tx);
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId))
      .for('share')
      .limit(1);
    if (!invoice) throw notFound('Invoice');
    const jobs = await invoiceJobsForRow(invoice, tx);
    if (financeId) assertInvoiceFinanceMembership(jobs, financeId);
    assertInvoiceVersion(invoice, expectedUpdatedAt);
    return loadInvoiceDto(financeId, invoice.id, tx);
  });
}

/**
 * Performs the final export publication while holding the invoice revision.
 * The callback must complete the durable job using the supplied executor.
 */
export async function withSchedulerInvoiceExportRevisionLock<T>(
  user: AuthUser,
  financeId: string | null,
  invoiceId: string,
  expectedUpdatedAt: string,
  callback: (executor: SchedulerFinanceExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await requireGlobalFinanceAdmin(user, tx);
    // Preserve the source -> finance -> invoice lock order used by invoice mutations.
    await assertSchedulerInvoicePdfStartReady(invoiceId, tx);
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId))
      .for('update')
      .limit(1);
    if (!invoice) throw notFound('Invoice');
    const jobs = await invoiceJobsForRow(invoice, tx);
    if (financeId) assertInvoiceFinanceMembership(jobs, financeId);
    assertInvoiceVersion(invoice, expectedUpdatedAt);
    return callback(tx);
  });
}

type PortfolioCursor = { createdAt: Date; id: string };

function encodePortfolioCursor(value: PortfolioCursor): string {
  return Buffer.from(JSON.stringify({
    createdAt: value.createdAt.toISOString(),
    id: value.id,
  }), 'utf8').toString('base64url');
}

function decodePortfolioCursor(value: string | undefined): PortfolioCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('invalid');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw badRequest('cursor is invalid');
  }
}

export async function listSchedulerInvoicePortfolio(
  user: AuthUser,
  options: {
    limit?: number;
    cursor?: string;
    status?: InvoiceStatus;
    sourceApp?: FinanceSourceApp;
    financeId?: string;
    search?: string;
  } = {},
): Promise<SchedulerInvoicePortfolioResult> {
  await requireGlobalFinanceAdmin(user);
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const cursor = decodePortfolioCursor(options.cursor);
  const conditions: SQL[] = [...schedulerInvoiceVisibilityConditions()];
  if (options.status) conditions.push(eq(schedulerInvoices.status, options.status));
  if (cursor) {
    const cursorCondition = or(
      lt(schedulerInvoices.createdAt, cursor.createdAt),
      and(eq(schedulerInvoices.createdAt, cursor.createdAt), lt(schedulerInvoices.id, cursor.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }
  if (options.financeId) conditions.push(inArray(
    schedulerInvoices.id,
    db.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
      .from(schedulerInvoiceJobs)
      .where(eq(schedulerInvoiceJobs.financeId, options.financeId)),
  ));
  if (options.sourceApp) conditions.push(inArray(
    schedulerInvoices.id,
    db.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
      .from(schedulerInvoiceJobs)
      .where(eq(schedulerInvoiceJobs.jobSourceApp, options.sourceApp)),
  ));
  const search = optionalText(options.search, 200);
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const searchCondition = or(
      ilike(schedulerInvoices.invoiceNumber, pattern),
      ilike(schedulerInvoices.billToName, pattern),
      inArray(
        schedulerInvoices.id,
        db.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
          .from(schedulerInvoiceJobs)
          .where(or(
            ilike(schedulerInvoiceJobs.jobName, pattern),
            ilike(schedulerInvoiceJobs.jobSiteName, pattern),
            ilike(schedulerInvoiceJobs.jobSourceId, pattern),
          )),
      ),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const rows = await db.select().from(schedulerInvoices)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schedulerInvoices.createdAt), desc(schedulerInvoices.id))
    .limit(limit + 1);
  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = await invoiceListItems(page);
  const last = page.at(-1);
  return {
    items,
    nextCursor: hasNextPage && last
      ? encodePortfolioCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

export async function listSchedulerExpensePortfolio(
  user: AuthUser,
  options: {
    limit?: number;
    cursor?: string;
    kind?: ExpenseKind;
    sourceApp?: FinanceSourceApp;
    financeId?: string;
    search?: string;
  } = {},
): Promise<SchedulerExpensePortfolioResult> {
  await requireGlobalFinanceAdmin(user);
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const cursor = decodePortfolioCursor(options.cursor);
  const conditions = [
    isNull(schedulerJobExpenses.deletedAt),
    inArray(schedulerJobFinance.sourceApp, schedulerVisibleCommercialSourceApps()),
  ];
  if (options.kind) conditions.push(eq(schedulerJobExpenses.kind, options.kind));
  if (options.financeId) conditions.push(eq(schedulerJobExpenses.financeId, options.financeId));
  if (options.sourceApp) conditions.push(eq(schedulerJobFinance.sourceApp, options.sourceApp));
  if (cursor) {
    const cursorCondition = or(
      lt(schedulerJobExpenses.createdAt, cursor.createdAt),
      and(
        eq(schedulerJobExpenses.createdAt, cursor.createdAt),
        lt(schedulerJobExpenses.id, cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }
  const search = optionalText(options.search, 200);
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const searchCondition = or(
      ilike(schedulerJobExpenses.description, pattern),
      ilike(schedulerJobExpenses.vendor, pattern),
      ilike(schedulerJobExpenses.reference, pattern),
      ilike(schedulerJobFinance.sourceId, pattern),
      and(
        eq(schedulerJobFinance.sourceApp, 'ecoaudit'),
        inArray(
          schedulerJobFinance.sourceId,
          db.select({ id: eaAudits.id }).from(eaAudits).where(or(
            ilike(eaAudits.siteName, pattern),
            ilike(eaAudits.siteAddress, pattern),
            ilike(eaAudits.inspectorName, pattern),
          )),
        ),
      ),
      and(
        eq(schedulerJobFinance.sourceApp, 'solarsense'),
        inArray(
          schedulerJobFinance.sourceId,
          db.select({ id: ssRooftopAssessments.id })
            .from(ssRooftopAssessments)
            .leftJoin(ssSites, eq(ssSites.id, ssRooftopAssessments.siteId))
            .where(or(
              ilike(ssRooftopAssessments.siteName, pattern),
              ilike(ssRooftopAssessments.buildingIdName, pattern),
              ilike(ssSites.location, pattern),
            )),
        ),
      ),
      and(
        eq(schedulerJobFinance.sourceApp, 'installhub'),
        inArray(
          schedulerJobFinance.sourceId,
          db.select({ id: ihInstallations.id }).from(ihInstallations).where(or(
            ilike(ihInstallations.siteName, pattern),
            ilike(ihInstallations.clientName, pattern),
            ilike(ihInstallations.siteAddress, pattern),
          )),
        ),
      ),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const rows = await db.select({
    expense: schedulerJobExpenses,
    finance: schedulerJobFinance,
  }).from(schedulerJobExpenses)
    .innerJoin(schedulerJobFinance, eq(schedulerJobFinance.id, schedulerJobExpenses.financeId))
    .where(and(...conditions))
    .orderBy(desc(schedulerJobExpenses.createdAt), desc(schedulerJobExpenses.id))
    .limit(limit + 1);
  const hasNextPage = rows.length > limit;
  const page = rows.slice(0, limit);
  const expenseIds = page.map((row) => row.expense.id);
  const attachmentRows = expenseIds.length === 0 ? [] : await db.select()
    .from(schedulerExpenseAttachments)
    .where(and(
      inArray(schedulerExpenseAttachments.expenseId, expenseIds),
      eq(schedulerExpenseAttachments.status, 'confirmed'),
    )).orderBy(asc(schedulerExpenseAttachments.createdAt));
  const attachmentsByExpense = new Map<string, ExpenseAttachmentRow[]>();
  for (const attachment of attachmentRows) {
    const grouped = attachmentsByExpense.get(attachment.expenseId) ?? [];
    grouped.push(attachment);
    attachmentsByExpense.set(attachment.expenseId, grouped);
  }
  const reservationsByFinance = new Map<string, Map<string, ExpenseReservation>>();
  const items: SchedulerExpensePortfolioItemDto[] = [];
  for (const row of page) {
    let reservations = reservationsByFinance.get(row.finance.id);
    if (!reservations) {
      reservations = await expenseReservations(row.finance.id);
      reservationsByFinance.set(row.finance.id, reservations);
    }
    const source = {
      sourceApp: row.finance.sourceApp,
      sourceType: row.finance.sourceType,
      sourceId: row.finance.sourceId,
    } as FinanceSource;
    const event = await latestEventForSource(source);
    items.push({
      ...expenseDto(
        row.expense,
        event?.id ?? null,
        reservations.get(row.expense.id),
        attachmentsByExpense.get(row.expense.id),
      ),
      source,
      job: await loadJobMetadata(source, event),
      currency: row.finance.currency,
    });
  }
  const last = page.at(-1)?.expense;
  return {
    items,
    nextCursor: hasNextPage && last
      ? encodePortfolioCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

const BILL_ATTACHMENT_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

async function assertSchedulerExpenseVisible(
  expenseId: string,
  executor: FinanceExecutor = db,
): Promise<void> {
  const [row] = await executor.select({ sourceApp: schedulerJobFinance.sourceApp })
    .from(schedulerJobExpenses)
    .innerJoin(schedulerJobFinance, eq(schedulerJobFinance.id, schedulerJobExpenses.financeId))
    .where(and(
      eq(schedulerJobExpenses.id, expenseId),
      isNull(schedulerJobExpenses.deletedAt),
    ))
    .limit(1);
  if (!row) throw notFound('Expense');
  assertSchedulerFinanceSourceAppVisible(row.sourceApp);
}

function detectedBillAttachmentType(body: Buffer): string | null {
  if (body.length >= 5 && body.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    body.length >= 8
    && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';
  if (
    body.length >= 12
    && body.subarray(0, 4).toString('ascii') === 'RIFF'
    && body.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

function safeAttachmentFilename(value: unknown, contentType: string): string {
  if (typeof value !== 'string') throw badRequest('x-file-name header is required');
  const basename = value.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!basename) throw badRequest('x-file-name header is required');
  const extension = BILL_ATTACHMENT_TYPES.get(contentType)!;
  const stripped = basename.replace(/\.[a-z0-9]{1,10}$/i, '').trim() || 'bill';
  const maximumBaseLength = 200 - extension.length;
  return `${stripped.slice(0, maximumBaseLength)}${extension}`;
}

async function queueAttachmentStorageKeyDeletion(
  storageKey: string,
  executor: FinanceExecutor = db,
): Promise<string> {
  const taskId = randomUUID();
  await executor.insert(storageDeletionTasks).values({
    id: taskId,
    app: 'scheduler',
    storageKey,
    reason: 'scheduler_expense_attachment_delete',
  }).onConflictDoNothing({ target: storageDeletionTasks.storageKey });
  const [task] = await executor.select({ id: storageDeletionTasks.id })
    .from(storageDeletionTasks)
    .where(eq(storageDeletionTasks.storageKey, storageKey))
    .limit(1);
  if (!task) throw new Error('scheduler_expense_attachment_cleanup_queue_failed');
  return task.id;
}

async function queueExpenseAttachmentDeletion(
  attachment: ExpenseAttachmentRow,
  executor: FinanceExecutor = db,
): Promise<string> {
  const taskId = await queueAttachmentStorageKeyDeletion(attachment.storageKey, executor);
  await executor.delete(schedulerExpenseAttachments)
    .where(eq(schedulerExpenseAttachments.id, attachment.id));
  return taskId;
}

/** Startup/periodic repair after a one-hour lease, avoiding another release lane's live upload. */
export async function reconcilePendingSchedulerExpenseAttachments(
  options: {
    now?: Date;
    /** Deterministic confirm-vs-sweep concurrency seam for the PG regression. */
    afterCandidateSelected?: (attachmentId: string) => Promise<void>;
  } = {},
): Promise<number> {
  const taskIds: string[] = [];
  let reconciled = 0;
  // These columns are PostgreSQL `timestamp without time zone`; use the
  // database clock so a non-UTC server session cannot make a fresh upload look
  // hours old. Tests may pin an instant, converted through the session zone.
  const reconciliationClock = options.now
    ? sql`(${options.now.toISOString()}::timestamptz AT TIME ZONE current_setting('TimeZone'))`
    : sql`now()`;
  const stalePendingCondition = and(
    eq(schedulerExpenseAttachments.status, 'pending'),
    sql`${schedulerExpenseAttachments.createdAt} < ${reconciliationClock} - interval '1 hour'`,
  );
  while (true) {
    const pending = await db.select().from(schedulerExpenseAttachments)
      .where(stalePendingCondition)
      .orderBy(asc(schedulerExpenseAttachments.createdAt))
      .limit(1_000);
    if (pending.length === 0) break;
    for (const attachment of pending) {
      await options.afterCandidateSelected?.(attachment.id);
      const taskId = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(schedulerExpenseAttachments)
          .where(and(
            eq(schedulerExpenseAttachments.id, attachment.id),
            stalePendingCondition,
          )).for('update').limit(1);
        return locked ? queueExpenseAttachmentDeletion(locked, tx) : null;
      });
      if (taskId) {
        taskIds.push(taskId);
        reconciled += 1;
      }
    }
  }
  if (taskIds.length > 0) await drainStorageDeletionTasks({ ids: taskIds });
  return reconciled;
}

export async function uploadSchedulerExpenseAttachment(
  user: AuthUser,
  expenseIdInput: string,
  input: { filename: unknown; contentType?: unknown; body: unknown },
  dependencies: {
    writeFile?: typeof writeLocalFile;
    /** Deterministic concurrency seam used by the real-Postgres regression. */
    afterPendingPersisted?: () => Promise<void>;
    /** Simulates an acknowledgement failure after the confirm transaction commits. */
    afterConfirmationCommitted?: () => Promise<void>;
    /** Simulates an unavailable status read while handling an upload failure. */
    beforeFailureInspection?: () => Promise<void>;
  } = {},
): Promise<SchedulerExpenseAttachmentDto> {
  const actor = await requireGlobalFinanceAdmin(user);
  const expenseId = requireText(expenseIdInput, 'expenseId', 100);
  await assertSchedulerExpenseVisible(expenseId);
  if (!Buffer.isBuffer(input.body) || input.body.length === 0) {
    throw badRequest('Bill attachment must contain file bytes');
  }
  const body = input.body;
  if (body.length > config.schedulerFinance.billAttachmentMaxBytes) {
    throw badRequest(
      `Bill attachment exceeds ${config.schedulerFinance.billAttachmentMaxBytes} bytes`,
    );
  }
  const detectedContentType = detectedBillAttachmentType(body);
  if (!detectedContentType) {
    throw badRequest('Bill attachment must be a PDF, JPEG, PNG, or WebP file');
  }
  const declaredContentType = typeof input.contentType === 'string'
    ? input.contentType.split(';', 1)[0]!.trim().toLowerCase()
    : null;
  if (declaredContentType && declaredContentType !== detectedContentType) {
    throw badRequest('Bill attachment content type does not match its bytes');
  }
  const filename = safeAttachmentFilename(input.filename, detectedContentType);
  const attachmentId = randomUUID();
  let storageKey = '';
  await db.transaction(async (tx) => {
    const [locator] = await tx.select({ financeId: schedulerJobExpenses.financeId })
      .from(schedulerJobExpenses)
      .where(eq(schedulerJobExpenses.id, expenseId)).limit(1);
    if (!locator) throw notFound('Expense');
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, locator.financeId)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    assertSchedulerFinanceSourceAppVisible(finance.sourceApp);
    const [expense] = await tx.select().from(schedulerJobExpenses)
      .where(and(
        eq(schedulerJobExpenses.id, expenseId),
        eq(schedulerJobExpenses.financeId, finance.id),
        isNull(schedulerJobExpenses.deletedAt),
      )).for('update').limit(1);
    if (!expense) throw notFound('Expense');
    const reservations = await expenseReservations(finance.id, tx);
    if (expenseAttachmentMutationIsBlocked(expense, reservations.get(expense.id))) {
      throw conflict('Attachments cannot be added after an expense is invoiced');
    }
    storageKey = makeLocalStorageKey({
      app: finance.sourceApp as FinanceSourceApp,
      parentId: finance.sourceId,
      entityType: 'scheduler-expense',
      entityId: expense.id,
      fieldName: 'bill-attachment',
      sessionId: attachmentId,
      filename,
    });
    await tx.insert(schedulerExpenseAttachments).values({
      id: attachmentId,
      expenseId: expense.id,
      status: 'pending',
      filename,
      contentType: detectedContentType,
      sizeBytes: body.length,
      sha256: null,
      storageKey,
      createdByUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: new Date(),
      confirmedAt: null,
    });
  });
  try {
    await dependencies.afterPendingPersisted?.();
    const written = await (dependencies.writeFile ?? writeLocalFile)(storageKey, body);
    const now = new Date();
    const confirmed = await db.transaction(async (tx) => {
      const [locator] = await tx.select({ financeId: schedulerJobExpenses.financeId })
        .from(schedulerJobExpenses)
        .where(eq(schedulerJobExpenses.id, expenseId))
        .limit(1);
      if (!locator) throw notFound('Expense');
      const [finance] = await tx.select().from(schedulerJobFinance)
        .where(eq(schedulerJobFinance.id, locator.financeId))
        .for('update')
        .limit(1);
      if (!finance) throw notFound('Job finance');
      assertSchedulerFinanceSourceAppVisible(finance.sourceApp);
      const [expense] = await tx.select().from(schedulerJobExpenses)
        .where(and(
          eq(schedulerJobExpenses.id, expenseId),
          eq(schedulerJobExpenses.financeId, finance.id),
          isNull(schedulerJobExpenses.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!expense) throw notFound('Expense');
      const [pending] = await tx.select().from(schedulerExpenseAttachments)
        .where(and(
          eq(schedulerExpenseAttachments.id, attachmentId),
          eq(schedulerExpenseAttachments.status, 'pending'),
        ))
        .for('update')
        .limit(1);
      if (!pending) throw conflict('Bill attachment confirmation failed');
      const reservations = await expenseReservations(finance.id, tx);
      if (expenseAttachmentMutationIsBlocked(expense, reservations.get(expense.id))) {
        throw conflict('Attachments cannot be added after an expense is invoiced');
      }
      const [row] = await tx.update(schedulerExpenseAttachments).set({
        status: 'confirmed',
        sizeBytes: written.size,
        sha256: written.checksum,
        confirmedAt: now,
      }).where(and(
        eq(schedulerExpenseAttachments.id, attachmentId),
        eq(schedulerExpenseAttachments.status, 'pending'),
      )).returning();
      return row ?? null;
    });
    if (!confirmed) throw conflict('Bill attachment confirmation failed');
    await dependencies.afterConfirmationCommitted?.();
    return expenseAttachmentDto(confirmed);
  } catch (error) {
    // Cleanup is conditional on a successful, locked status read. An unknown
    // database state may mean confirmation committed but its response failed;
    // deleting in that case would destroy valid accounting evidence.
    let taskId: string | null = null;
    try {
      await dependencies.beforeFailureInspection?.();
      taskId = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(schedulerExpenseAttachments)
          .where(eq(schedulerExpenseAttachments.id, attachmentId))
          .for('update')
          .limit(1);
        if (row?.status === 'confirmed') return null;
        if (row) return queueExpenseAttachmentDeletion(row, tx);
        return queueAttachmentStorageKeyDeletion(storageKey, tx);
      });
    } catch {
      // Startup/hourly reconciliation owns unknown-state recovery.
    }
    if (taskId) await drainStorageDeletionTasks({ ids: [taskId] }).catch(() => undefined);
    throw error;
  }
}

async function loadConfirmedExpenseAttachment(
  expenseIdInput: string,
  attachmentIdInput: string,
): Promise<ExpenseAttachmentRow> {
  const expenseId = requireText(expenseIdInput, 'expenseId', 100);
  const attachmentId = requireText(attachmentIdInput, 'attachmentId', 100);
  const [attachment] = await db.select().from(schedulerExpenseAttachments)
    .where(and(
      eq(schedulerExpenseAttachments.id, attachmentId),
      eq(schedulerExpenseAttachments.expenseId, expenseId),
      eq(schedulerExpenseAttachments.status, 'confirmed'),
    )).limit(1);
  if (!attachment) throw notFound('Bill attachment');
  return attachment;
}

export async function downloadSchedulerExpenseAttachment(
  user: AuthUser,
  expenseId: string,
  attachmentId: string,
): Promise<{
  stream: Awaited<ReturnType<typeof localFileStream>>;
  sizeBytes: number;
  filename: string;
  contentType: string;
}> {
  await requireGlobalFinanceAdmin(user);
  await assertSchedulerExpenseVisible(requireText(expenseId, 'expenseId', 100));
  const attachment = await loadConfirmedExpenseAttachment(expenseId, attachmentId);
  const storedSize = await localFileSize(attachment.storageKey);
  if (storedSize !== attachment.sizeBytes) throw conflict('Bill attachment storage is incomplete');
  return {
    stream: await localFileStream(attachment.storageKey),
    sizeBytes: attachment.sizeBytes,
    filename: attachment.filename,
    contentType: attachment.contentType,
  };
}

export async function deleteSchedulerExpenseAttachment(
  user: AuthUser,
  expenseIdInput: string,
  attachmentIdInput: string,
): Promise<void> {
  await requireGlobalFinanceAdmin(user);
  const expenseId = requireText(expenseIdInput, 'expenseId', 100);
  const attachmentId = requireText(attachmentIdInput, 'attachmentId', 100);
  let taskId: string | null = null;
  await db.transaction(async (tx) => {
    const [expense] = await tx.select().from(schedulerJobExpenses)
      .where(eq(schedulerJobExpenses.id, expenseId)).limit(1);
    if (!expense) throw notFound('Expense');
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, expense.financeId)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    assertSchedulerFinanceSourceAppVisible(finance.sourceApp);
    const [row] = await tx.select().from(schedulerExpenseAttachments).where(and(
      eq(schedulerExpenseAttachments.id, attachmentId),
      eq(schedulerExpenseAttachments.expenseId, expense.id),
      eq(schedulerExpenseAttachments.status, 'confirmed'),
    )).for('update').limit(1);
    if (!row) throw notFound('Bill attachment');
    const reservations = await expenseReservations(finance.id, tx);
    if (expenseAttachmentMutationIsBlocked(expense, reservations.get(expense.id))) {
      throw conflict('Attachments for invoiced expenses cannot be deleted');
    }
    taskId = await queueExpenseAttachmentDeletion(row, tx);
  });
  if (taskId) await drainStorageDeletionTasks({ ids: [taskId] });
}

export async function getSchedulerInvoicePdf(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
): Promise<InvoicePdfOutput> {
  const invoice = await getSchedulerInvoice(user, eventId, invoiceId);
  if (invoice.status === 'draft') await assertSchedulerInvoiceJobsCompleted(invoice);
  return renderSchedulerInvoicePdf(invoice);
}

export async function getSchedulerInvoicePdfByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
): Promise<InvoicePdfOutput> {
  const invoice = await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId);
  if (invoice.status === 'draft') await assertSchedulerInvoiceJobsCompleted(invoice);
  return renderSchedulerInvoicePdf(invoice);
}

export async function assertSchedulerInvoiceJobsCompleted(
  invoice: Pick<SchedulerInvoiceDto, 'jobs'>,
  executor: FinanceExecutor = db,
): Promise<void> {
  for (const group of invoice.jobs) {
    assertInvoiceCompletionReady(
      group.source,
      group.job.jobName,
      await sourceCompletionReadiness(group.source, executor),
    );
  }
}

export function renderSchedulerInvoicePdf(
  invoice: SchedulerInvoiceDto,
  generatedAt = new Date().toISOString(),
): Promise<InvoicePdfOutput> {
  return renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    invoiceDate: generatedAt,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    notes: invoice.notes,
    purchaseOrderReference: invoice.purchaseOrderReference,
    gstRate: invoice.gstRate,
    subtotalExGst: invoice.subtotalExGst,
    gstAmount: invoice.gstAmount,
    totalIncGst: invoice.totalIncGst,
    seller: {
      name: invoice.sellerName,
      abn: invoice.sellerAbn,
      address: invoice.sellerAddress,
      email: invoice.sellerEmail,
    },
    billTo: {
      name: invoice.billToName,
      abn: invoice.billToAbn,
      address: invoice.billToAddress,
      email: invoice.billToEmail,
    },
    job: {
      jobName: invoice.job.jobName,
      jobDate: invoice.job.jobDate,
      sourceApp: invoice.job.sourceApp,
      sourceType: invoice.job.sourceType,
      sourceId: invoice.job.sourceId,
      clientName: invoice.job.clientName,
      siteName: invoice.job.siteName,
      siteAddress: invoice.job.siteAddress,
    },
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitAmountExGst: line.unitAmountExGst,
      lineTotalExGst: line.lineTotalExGst,
      showQuantityAndRate: line.showQuantityAndRate,
    })),
    jobs: invoice.jobs.map((group) => ({
      financeId: group.financeId,
      job: {
        jobName: group.job.jobName,
        jobDate: group.job.jobDate,
        sourceApp: group.source.sourceApp,
        sourceType: group.source.sourceType,
        sourceId: group.source.sourceId,
        clientName: group.job.clientName,
        siteName: group.job.siteName,
        siteAddress: group.job.siteAddress,
      },
      reference: group.billingReference,
      subtotalExGst: group.subtotalExGst,
      lines: group.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitAmountExGst: line.unitAmountExGst,
        lineTotalExGst: line.lineTotalExGst,
        showQuantityAndRate: line.showQuantityAndRate,
      })),
    })),
  });
}

export async function listSchedulerFinanceOverview(
  user: AuthUser,
  options: {
    limit?: number;
    cursor?: string;
    sourceApp?: FinanceSourceApp;
    sourceId?: string;
  } = {},
): Promise<{ items: SchedulerFinanceOverviewItemDto[]; nextCursor: string | null }> {
  await requireGlobalFinanceAdmin(user);
  const visibleApps = schedulerVisibleCommercialSourceApps();
  const [eventRows, financeRows, auditRows, assessmentRows, installationRows] = await Promise.all([
    db.select().from(portalScheduleEvents).where(and(
      inArray(portalScheduleEvents.sourceApp, visibleApps),
      inArray(portalScheduleEvents.sourceType, ['audit', 'assessment', 'installation']),
    )).orderBy(desc(portalScheduleEvents.updatedAt)),
    db.select().from(schedulerJobFinance)
      .where(inArray(schedulerJobFinance.sourceApp, visibleApps))
      .orderBy(desc(schedulerJobFinance.updatedAt)),
    db.select({ id: eaAudits.id }).from(eaAudits).where(isNull(eaAudits.deletedAt)),
    db.select({ id: ssRooftopAssessments.id }).from(ssRooftopAssessments)
      .where(isNull(ssRooftopAssessments.deletedAt)),
    db.select({ id: ihInstallations.id }).from(ihInstallations)
      .where(isNull(ihInstallations.deletedAt)),
  ]);
  const sourceMap = new Map<string, { source: FinanceSource; event: ScheduleEventRow | null }>();
  for (const event of eventRows) {
    let source: FinanceSource;
    try {
      source = sourceFromEvent(event);
    } catch {
      continue;
    }
    const key = `${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
    if (!sourceMap.has(key)) sourceMap.set(key, { source, event });
  }
  for (const finance of financeRows) {
    const source = {
      sourceApp: finance.sourceApp,
      sourceType: finance.sourceType,
      sourceId: finance.sourceId,
    } as FinanceSource;
    if (!isSupportedSource(source)) continue;
    const key = `${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
    if (!sourceMap.has(key)) sourceMap.set(key, { source, event: null });
  }
  for (const source of [
    ...auditRows.map((row) => ({
      sourceApp: 'ecoaudit' as const,
      sourceType: 'audit' as const,
      sourceId: row.id,
    })),
    ...assessmentRows.map((row) => ({
      sourceApp: 'solarsense' as const,
      sourceType: 'assessment' as const,
      sourceId: row.id,
    })),
    ...installationRows.map((row) => ({
      sourceApp: 'installhub' as const,
      sourceType: 'installation' as const,
      sourceId: row.id,
    })),
  ]) {
    if (!isSchedulerFinanceSourceAppVisible(source.sourceApp)) continue;
    const key = `${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
    if (!sourceMap.has(key)) sourceMap.set(key, { source, event: null });
  }
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const candidates = [...sourceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([, entry]) => isSchedulerFinanceSourceAppVisible(entry.source.sourceApp))
    .filter(([, entry]) => !options.sourceApp || entry.source.sourceApp === options.sourceApp)
    .filter(([, entry]) => !options.sourceId || entry.source.sourceId === options.sourceId)
    .filter(([key]) => !options.cursor || key > options.cursor)
    .slice(0, limit + 1);
  const hasNextPage = candidates.length > limit;
  const page = candidates.slice(0, limit);
  const summaries: SchedulerFinancialSummaryDto[] = [];
  for (const [, entry] of page) {
    try {
      summaries.push(await buildFinancialSummary(entry.source, entry.event));
    } catch (error) {
      // A source/event may disappear before its first ledger row is created.
      // Existing ledgers use deterministic deleted-job metadata and remain readable.
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
  }
  const items = summaries.map((summary) => ({
    financeId: summary.financeId,
    eventId: summary.event?.id ?? null,
    sourceApp: summary.source.sourceApp,
    sourceType: summary.source.sourceType,
    sourceId: summary.source.sourceId,
    jobName: summary.job.jobName,
    clientName: summary.job.clientName,
    siteName: summary.job.siteName,
    siteAddress: summary.job.siteAddress,
    userNames: summary.time.actors.map((actor) => actor.displayName || actor.userId),
    jobDate: summary.job.jobDate,
    jobStatus: summary.job.status,
    eventStatus: summary.event?.status ?? null,
    invoiceReadiness: summary.invoiceReadiness,
    currency: summary.currency,
    actualHours: summary.time.actualHours,
    billableHours: summary.time.billableHours,
    costHours: summary.time.costHours,
    billableAmount: summary.totals.billableAmount,
    totalCost: summary.totals.totalCost,
    invoicedAmount: summary.totals.invoicedAmount,
    reservedAmount: summary.totals.reservedAmount,
    unbilledAmount: summary.totals.unbilledAmount,
    grossProfit: summary.totals.grossProfit,
    marginPct: summary.totals.marginPct,
    invoiceCount: summary.invoices.filter((invoice) => invoice.status !== 'void').length,
    hasOverdueInvoice: summary.invoices.some((invoice) => invoice.overdue),
    needsHoursReview: summary.time.needsHoursReview,
  })).sort((left, right) => right.jobDate.localeCompare(left.jobDate));
  return {
    items,
    nextCursor: hasNextPage && page.length > 0 ? page[page.length - 1]![0] : null,
  };
}

/** Exact portfolio totals fetched in bounded pages; money is never returned from a partial set. */
export async function getSchedulerFinancePortfolioSummary(
  user: AuthUser,
  options: {
    sourceApp?: FinanceSourceApp;
    sourceId?: string;
    currency?: string;
  } = {},
): Promise<SchedulerFinancePortfolioSummaryDto> {
  await requireGlobalFinanceAdmin(user);
  const currencyFilter = options.currency
    ? requireText(options.currency, 'currency', 8).toUpperCase()
    : null;
  const allItems: SchedulerFinanceOverviewItemDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await listSchedulerFinanceOverview(user, {
      limit: 100,
      cursor,
      sourceApp: options.sourceApp,
      sourceId: options.sourceId,
    });
    allItems.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const selectedItems = currencyFilter
    ? allItems.filter((item) => item.currency === currencyFilter)
    : allItems;
  const byCurrency = new Map<string, {
    currency: string;
    actualHours: number;
    billableHours: number;
    costHours: number;
    billableAmountCents: number;
    totalCostCents: number;
    invoicedAmountCents: number;
    reservedAmountCents: number;
    unbilledAmountCents: number;
    grossProfitCents: number;
  }>();
  for (const item of selectedItems) {
    const aggregate = byCurrency.get(item.currency) ?? {
      currency: item.currency,
      actualHours: 0,
      billableHours: 0,
      costHours: 0,
      billableAmountCents: 0,
      totalCostCents: 0,
      invoicedAmountCents: 0,
      reservedAmountCents: 0,
      unbilledAmountCents: 0,
      grossProfitCents: 0,
    };
    aggregate.actualHours += item.actualHours;
    aggregate.billableHours += item.billableHours;
    aggregate.costHours += item.costHours;
    aggregate.billableAmountCents = addAccountingCents(
      aggregate.billableAmountCents,
      moneyToCents(item.billableAmount, 'billableAmount'),
      'Portfolio billable amount',
    );
    aggregate.totalCostCents = addAccountingCents(
      aggregate.totalCostCents,
      moneyToCents(item.totalCost, 'totalCost'),
      'Portfolio total cost',
    );
    aggregate.invoicedAmountCents = addAccountingCents(
      aggregate.invoicedAmountCents,
      moneyToCents(item.invoicedAmount, 'invoicedAmount'),
      'Portfolio invoiced amount',
    );
    aggregate.reservedAmountCents = addAccountingCents(
      aggregate.reservedAmountCents,
      moneyToCents(item.reservedAmount, 'reservedAmount'),
      'Portfolio reserved amount',
    );
    aggregate.unbilledAmountCents = addAccountingCents(
      aggregate.unbilledAmountCents,
      moneyToCents(item.unbilledAmount, 'unbilledAmount'),
      'Portfolio unbilled amount',
    );
    const itemGrossProfitCents = Math.round(item.grossProfit * 100);
    if (!Number.isSafeInteger(itemGrossProfitCents)) {
      throw conflict('Portfolio gross profit exceeds the supported accounting range');
    }
    const nextGrossProfit = aggregate.grossProfitCents + itemGrossProfitCents;
    if (!Number.isSafeInteger(nextGrossProfit)) {
      throw conflict('Portfolio gross profit exceeds the supported accounting range');
    }
    aggregate.grossProfitCents = nextGrossProfit;
    byCurrency.set(item.currency, aggregate);
  }
  const invoiceConditions: SQL[] = [...schedulerInvoiceVisibilityConditions()];
  if (currencyFilter) invoiceConditions.push(eq(schedulerInvoices.currency, currencyFilter));
  if (options.sourceApp || options.sourceId) {
    const membershipConditions = [];
    if (options.sourceApp) {
      membershipConditions.push(eq(schedulerInvoiceJobs.jobSourceApp, options.sourceApp));
    }
    if (options.sourceId) {
      membershipConditions.push(eq(schedulerInvoiceJobs.jobSourceId, options.sourceId));
    }
    invoiceConditions.push(inArray(
      schedulerInvoices.id,
      db.select({ invoiceId: schedulerInvoiceJobs.invoiceId })
        .from(schedulerInvoiceJobs)
        .where(and(...membershipConditions)),
    ));
  }
  const invoiceCounts = await db.select({
    status: schedulerInvoices.status,
    count: sql<number>`count(*)::int`,
    overdue: sql<number>`count(*) FILTER (
      WHERE ${schedulerInvoices.status} = 'issued'
      AND ${schedulerInvoices.dueDate} < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
    )::int`,
  }).from(schedulerInvoices)
    .where(invoiceConditions.length > 0 ? and(...invoiceConditions) : undefined)
    .groupBy(schedulerInvoices.status);
  const statusCounts = { draft: 0, issued: 0, paid: 0, void: 0, overdue: 0 };
  for (const row of invoiceCounts) {
    if (row.status === 'draft' || row.status === 'issued' || row.status === 'paid' || row.status === 'void') {
      statusCounts[row.status] = Number(row.count);
    }
    statusCounts.overdue += Number(row.overdue);
  }
  return {
    complete: true,
    jobCount: selectedItems.length,
    statusCounts,
    currencies: [...byCurrency.values()].map((entry) => ({
      ...entry,
      actualHours: round(entry.actualHours, 4),
      billableHours: round(entry.billableHours, 4),
      costHours: round(entry.costHours, 4),
      billableAmount: centsToMoney(entry.billableAmountCents),
      totalCost: centsToMoney(entry.totalCostCents),
      invoicedAmount: centsToMoney(entry.invoicedAmountCents),
      reservedAmount: centsToMoney(entry.reservedAmountCents),
      unbilledAmount: centsToMoney(entry.unbilledAmountCents),
      grossProfit: round(entry.grossProfitCents / 100, 2),
      marginPct: entry.billableAmountCents > 0
        ? round((entry.grossProfitCents / entry.billableAmountCents) * 100, 2)
        : null,
    })).sort((left, right) => left.currency.localeCompare(right.currency)),
  };
}
