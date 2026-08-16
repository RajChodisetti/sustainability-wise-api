import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eaAudits, eaAuditWorkSessions } from '../db/schema/ecoaudit.js';
import { ihInstallations, ihInstallationWorkSessions } from '../db/schema/installhub.js';
import {
  globalUsers,
  portalScheduleEvents,
  schedulerInvoiceCounters,
  schedulerInvoiceLines,
  schedulerInvoices,
  schedulerJobExpenses,
  schedulerJobFinance,
  schedulerJobHourOverrides,
  unifiedUsers,
} from '../db/schema/shared.js';
import {
  ssAssessmentWorkSessions,
  ssRooftopAssessments,
  ssSites,
} from '../db/schema/solarsense.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { renderInvoicePdf, type InvoicePdfOutput } from './invoicePdf.js';

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

type FinanceExecutor = Pick<typeof db, 'delete' | 'insert' | 'select' | 'update'>;
type ScheduleEventRow = typeof portalScheduleEvents.$inferSelect;
type FinanceRow = typeof schedulerJobFinance.$inferSelect;
type ExpenseRow = typeof schedulerJobExpenses.$inferSelect;
type InvoiceRow = typeof schedulerInvoices.$inferSelect;
type InvoiceLineRow = typeof schedulerInvoiceLines.$inferSelect;

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
};

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
  createdAt: string;
  updatedAt: string;
};

export type SchedulerInvoiceLineDto = {
  id: string;
  invoiceId: string;
  sortOrder: number;
  kind: InvoiceLineKind;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  expenseId: string | null;
  category: ExpenseCategory | null;
};

export type SchedulerInvoiceListItemDto = {
  id: string;
  financeId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
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
  billToAddress: string | null;
  billToEmail: string | null;
  purchaseOrderReference: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  job: JobMetadata & FinanceSource;
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
    address: string | null;
    email: string | null;
    reference: string | null;
  };
  time: {
    scheduledHours: number;
    actualHours: number;
    actualMilliseconds: number;
    actualSource: 'active_sessions';
    actors: RecordedActorHoursDto[];
    billableHours: number;
    billableHoursOverride: number | null;
    billableHoursSource: 'actual' | 'override';
    costHours: number;
    costHoursOverride: number | null;
    costHoursSource: 'actual' | 'override';
    billableRate: number;
    costRate: number;
    labourRevenue: number;
    labourCost: number;
    /** Recorded active hours minus total non-cancelled scheduled hours. */
    hoursVariance: number;
    /** Effective customer-billable hours minus effective internal-cost hours. */
    commercialHoursVariance: number;
    overbilledHours: number;
    overrideReason: string | null;
    overrideSource: 'admin' | 'legacy_estimate' | null;
    overriddenAt: string | null;
    overriddenBy: { userId: string; displayName: string | null } | null;
    needsHoursReview: boolean;
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
  jobDate: string;
  jobStatus: string;
  eventStatus: string | null;
  currency: string;
  actualHours: number;
  billableHours: number;
  costHours: number;
  billableAmount: number;
  totalCost: number;
  invoicedAmount: number;
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
  billingAddress?: string | null;
  billingEmail?: string | null;
  billingReference?: string | null;
  billableHoursOverride?: number | null;
  costHoursOverride?: number | null;
  overrideReason?: string | null;
  billableRate?: number;
  costRate?: number;
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
  expenseId?: string | null;
  kind?: InvoiceLineKind;
};

export type QuickInvoiceInput = {
  expenseIds?: string[];
  includeLabour?: boolean;
  notes?: string | null;
};

export type UpdateDraftInvoiceInput = {
  /** Required by Scheduler HTTP routes; omitted only by the legacy Field adapter. */
  expectedUpdatedAt?: string;
  notes?: string | null;
  dueDate?: string | null;
  billToName?: string;
  billToAddress?: string | null;
  billToEmail?: string | null;
  purchaseOrderReference?: string | null;
  lines?: InvoiceLineInput[];
};

const ACTIVE_INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'issued', 'paid'];
const ISSUED_INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'paid'];

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

function assertInvoiceVersion(invoice: InvoiceRow, expectedUpdatedAt?: string): void {
  if (expectedUpdatedAt === undefined) return;
  const expected = parseDate(expectedUpdatedAt, 'expectedUpdatedAt');
  if (!expected || expected.getTime() !== invoice.updatedAt.getTime()) {
    throw conflict('Invoice changed; refresh before continuing');
  }
}

function nextInvoiceUpdatedAt(invoice: InvoiceRow, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), invoice.updatedAt.getTime() + 1));
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function sourceFromEvent(event: ScheduleEventRow): FinanceSource {
  const source = {
    sourceApp: event.sourceApp,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
  };
  if (!isSupportedSource(source as FinanceSource)) {
    throw badRequest('Scheduler event does not have a supported commercial source job');
  }
  return source as FinanceSource;
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
        status: audit.status,
      };
    }
  } else if (source.sourceApp === 'solarsense') {
    const [assessment] = await executor.select({
      siteName: ssRooftopAssessments.siteName,
      buildingName: ssRooftopAssessments.buildingIdName,
      status: ssRooftopAssessments.status,
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
        status: assessment.status,
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
        status: installation.status,
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
    if (!row.end) return hours + 1;
    return hours + Math.max(0, (row.end.getTime() - row.start.getTime()) / 3_600_000);
  }, 0), 4);
}

async function recordedHoursForSource(
  source: FinanceSource,
  executor: FinanceExecutor = db,
): Promise<{ activeMilliseconds: number; actors: RecordedActorHoursDto[] }> {
  let sessions: Array<{ actorUserId: string; activeMilliseconds: number }>;
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

  const byActor = new Map<string, number>();
  for (const session of sessions) {
    const next = (byActor.get(session.actorUserId) ?? 0) + session.activeMilliseconds;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw conflict('Recorded active time exceeds the supported accounting range');
    }
    byActor.set(session.actorUserId, next);
  }
  const actorIds = [...byActor.keys()];
  const memberships = actorIds.length === 0 ? [] : await executor.select({
    originUserId: unifiedUsers.originUserId,
    fieldUserId: unifiedUsers.fieldUserId,
    globalUserId: globalUsers.id,
    fullName: globalUsers.fullName,
    displayEmail: globalUsers.displayEmail,
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
  const actors = [...byActor.entries()].map(([actorUserId, activeMilliseconds]) => {
    const membership = memberByActor.get(actorUserId);
    return {
      userId: membership?.globalUserId ?? actorUserId,
      displayName: membership
        ? membership.fullName?.trim() || membership.displayEmail
        : null,
      activeMilliseconds,
      hours: millisecondsToHours(activeMilliseconds),
    };
  }).sort((left, right) => right.activeMilliseconds - left.activeMilliseconds);
  const activeMilliseconds = actors.reduce((total, actor) => {
    const next = total + actor.activeMilliseconds;
    if (!Number.isSafeInteger(next)) {
      throw conflict('Recorded active time exceeds the supported accounting range');
    }
    return next;
  }, 0);
  return { activeMilliseconds, actors };
}

async function ensureFinance(
  source: FinanceSource,
  metadata: JobMetadata,
  executor: FinanceExecutor = db,
): Promise<FinanceRow> {
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

function invoiceListItem(row: InvoiceRow, now = new Date()): SchedulerInvoiceListItemDto {
  return {
    id: row.id,
    financeId: row.financeId,
    invoiceNumber: row.invoiceNumber,
    status: row.status as InvoiceStatus,
    currency: row.currency,
    issueDate: iso(row.issueDate),
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
    sortOrder: row.sortOrder,
    kind: row.kind as InvoiceLineKind,
    description: row.description,
    quantity: row.quantity,
    unitAmountExGst: centsToMoney(row.unitAmountExGstCents),
    lineTotalExGst: centsToMoney(row.lineTotalExGstCents),
    expenseId: row.expenseId,
    category: row.category as ExpenseCategory | null,
  };
}

type ExpenseReservation = {
  invoiceId: string;
  status: InvoiceStatus;
};

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
      eq(schedulerInvoices.financeId, financeId),
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
  reservedLabourHours: number;
  reservedQuoteCents: number;
  issuedQuoteCents: number;
}> {
  const rows = await executor.select({
    kind: schedulerInvoiceLines.kind,
    quantity: schedulerInvoiceLines.quantity,
    lineTotalCents: schedulerInvoiceLines.lineTotalExGstCents,
    status: schedulerInvoices.status,
  }).from(schedulerInvoiceLines)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceLines.invoiceId))
    .where(and(
      eq(schedulerInvoices.financeId, financeId),
      inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
    ));
  let reservedLabourUnits = 0;
  let reservedQuoteCents = 0;
  let issuedQuoteCents = 0;
  for (const row of rows) {
    if (row.kind === 'labour') {
      const units = Math.round(row.quantity * 10_000);
      if (!Number.isSafeInteger(units) || units < 0) {
        throw conflict('Reserved labour exceeds the supported accounting range');
      }
      reservedLabourUnits = addAccountingCents(
        reservedLabourUnits,
        units,
        'Reserved labour',
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
    reservedLabourHours: reservedLabourUnits / 10_000,
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
  const labourRevenueCents = hoursAtRateCents(
    input.billableHours,
    input.billableRateCents,
    'Labour revenue',
  );
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
): Promise<SchedulerFinancialSummaryDto> {
  const metadata = await loadJobMetadata(source, event, executor);
  const finance = await ensureFinance(source, metadata, executor);
  const [recorded, scheduledHours, currentOverride, expenseRows, invoiceRows] = await Promise.all([
    recordedHoursForSource(source, executor),
    scheduledHoursForSource(source, executor),
    latestHourOverride(finance.id, executor),
    executor.select().from(schedulerJobExpenses).where(and(
      eq(schedulerJobExpenses.financeId, finance.id),
      isNull(schedulerJobExpenses.deletedAt),
    )).orderBy(asc(schedulerJobExpenses.incurredAt), asc(schedulerJobExpenses.createdAt)),
    executor.select().from(schedulerInvoices).where(eq(schedulerInvoices.financeId, finance.id))
      .orderBy(desc(schedulerInvoices.createdAt)),
  ]);
  const [reservations, reserved] = await Promise.all([
    expenseReservations(finance.id, executor),
    reservationRollup(finance.id, executor),
  ]);

  const actualHours = millisecondsToHours(recorded.activeMilliseconds);
  const billableHoursOverride = currentOverride?.billableMilliseconds == null
    ? null
    : millisecondsToHours(currentOverride.billableMilliseconds);
  const costHoursOverride = currentOverride?.costMilliseconds == null
    ? null
    : millisecondsToHours(currentOverride.costMilliseconds);
  const billableHours = billableHoursOverride ?? actualHours;
  const costHours = costHoursOverride ?? actualHours;
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
  const invoicedCents = invoiceRows.filter((invoice) => (
    invoice.status === 'issued' || invoice.status === 'paid'
  )).reduce((total, invoice) => (
    addAccountingCents(total, invoice.subtotalExGstCents, 'Invoiced amount')
  ), 0);
  const reservedCents = invoiceRows.filter((invoice) => (
    invoice.status !== 'void'
  )).reduce((total, invoice) => (
    addAccountingCents(total, invoice.subtotalExGstCents, 'Reserved amount')
  ), 0);
  const totals = computeSchedulerCommercialTotals({
    pricingMode: finance.pricingMode as PricingMode,
    quotedAmountCents: finance.quotedAmountCents,
    billableHours,
    costHours,
    billableRateCents: finance.billableRateCents,
    costRateCents: finance.costRateCents,
    expenseCostCents,
    expenseRevenueCents,
    invoicedCents,
    reservedCents,
    issuedQuoteCents: reserved.issuedQuoteCents,
  });
  const effectiveEvent = event ?? await latestEventForSource(source, executor);
  const eventId = effectiveEvent?.id ?? null;
  const overrideSource = currentOverride?.source as 'admin' | 'legacy_estimate' | undefined;

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
      address: finance.billToAddress,
      email: finance.billToEmail,
      reference: finance.billingReference,
    },
    time: {
      scheduledHours,
      actualHours,
      actualMilliseconds: recorded.activeMilliseconds,
      actualSource: 'active_sessions',
      actors: recorded.actors,
      billableHours,
      billableHoursOverride,
      billableHoursSource: billableHoursOverride === null ? 'actual' : 'override',
      costHours,
      costHoursOverride,
      costHoursSource: costHoursOverride === null ? 'actual' : 'override',
      billableRate: centsToMoney(finance.billableRateCents),
      costRate: centsToMoney(finance.costRateCents),
      labourRevenue: totals.labourRevenue,
      labourCost: totals.labourCost,
      hoursVariance: round(actualHours - scheduledHours, 4),
      commercialHoursVariance: round(billableHours - costHours, 4),
      overbilledHours: round(Math.max(0, reserved.reservedLabourHours - billableHours), 4),
      overrideReason: currentOverride?.reason ?? null,
      overrideSource: overrideSource ?? null,
      overriddenAt: currentOverride?.createdAt.toISOString() ?? null,
      overriddenBy: currentOverride
        ? {
            userId: currentOverride.actorUserId,
            displayName: currentOverride.actorDisplayName,
          }
        : null,
      needsHoursReview: overrideSource === 'legacy_estimate'
        || (recorded.activeMilliseconds === 0 && !currentOverride),
    },
    expenses: expenseRows.map((expense) => expenseDto(
      expense,
      eventId,
      reservations.get(expense.id),
    )),
    invoices: invoiceRows.map((invoice) => invoiceListItem(invoice)),
    totals,
  };
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
            .where(eq(schedulerInvoices.financeId, finance.id)).limit(1),
        ]);
        if (expense || invoice) {
          throw conflict('Currency cannot change after an expense or invoice exists');
        }
      }
      patch.currency = currency;
    }
    if (input.notes !== undefined) patch.notes = optionalText(input.notes, 5_000);
    if (input.billingName !== undefined) patch.billToName = optionalText(input.billingName, 300);
    if (input.billingAddress !== undefined) {
      patch.billToAddress = optionalText(input.billingAddress, 1_000);
    }
    if (input.billingEmail !== undefined) patch.billToEmail = optionalText(input.billingEmail, 320);
    if (input.billingReference !== undefined) {
      patch.billingReference = optionalText(input.billingReference, 200);
    }
    if (input.billableRate !== undefined) {
      patch.billableRateCents = moneyToCents(input.billableRate, 'billableRate');
    }
    if (input.costRate !== undefined) patch.costRateCents = moneyToCents(input.costRate, 'costRate');

    const mergedPricingMode = (patch.pricingMode ?? finance.pricingMode) as PricingMode;
    const mergedQuotedAmount = patch.quotedAmountCents === undefined
      ? finance.quotedAmountCents
      : patch.quotedAmountCents;
    if (mergedPricingMode === 'quoted' && mergedQuotedAmount === null) {
      throw badRequest('quotedAmount is required when pricingMode is quoted');
    }
    const pricingModeChanged = mergedPricingMode !== finance.pricingMode;
    if (pricingModeChanged) {
      const [activeInvoice] = await tx.select({ id: schedulerInvoices.id })
        .from(schedulerInvoices)
        .where(and(
          eq(schedulerInvoices.financeId, finance.id),
          inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
        ))
        .limit(1);
      if (activeInvoice) {
        throw conflict('Pricing mode cannot change while a non-void invoice exists');
      }
    }
    if (mergedPricingMode === 'quoted') {
      const reserved = await reservationRollup(finance.id, tx);
      if ((mergedQuotedAmount ?? 0) < reserved.reservedQuoteCents) {
        throw conflict('Quoted amount cannot be less than reserved invoice value');
      }
    }

    const latestOverrideRecord = await latestHourOverrideRecord(finance.id, tx);
    const currentOverride = latestOverrideRecord?.action === 'set' ? latestOverrideRecord : null;
    const currentBillable = currentOverride?.billableMilliseconds ?? null;
    const currentCost = currentOverride?.costMilliseconds ?? null;
    const nextBillable = input.billableHoursOverride === undefined
      ? currentBillable
      : input.billableHoursOverride === null
        ? null
        : hoursToMilliseconds(input.billableHoursOverride, 'billableHoursOverride');
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
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const now = new Date();
    await tx.insert(schedulerJobExpenses).values({
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
    });
  });
  const [row] = await db.select().from(schedulerJobExpenses)
    .where(eq(schedulerJobExpenses.id, id));
  return expenseDto(row!, event?.id ?? null, undefined);
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
    await tx.update(schedulerJobExpenses).set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schedulerJobExpenses.id, existing.id));
  });
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

function invoiceSellerSnapshot() {
  return {
    sellerName: config.schedulerInvoice.sellerName.trim() || 'Sustainability Wise',
    sellerAbn: optionalText(config.schedulerInvoice.sellerAbn, 100),
    sellerAddress: optionalText(config.schedulerInvoice.sellerAddress, 1_000),
    sellerEmail: optionalText(config.schedulerInvoice.sellerEmail, 320),
  };
}

function invoiceDto(row: InvoiceRow, lines: InvoiceLineRow[]): SchedulerInvoiceDto {
  return {
    ...invoiceListItem(row),
    notes: row.notes,
    sellerName: row.sellerName,
    sellerAbn: row.sellerAbn,
    sellerAddress: row.sellerAddress,
    sellerEmail: row.sellerEmail,
    billToName: row.billToName,
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
    lines: lines.map(invoiceLineDto),
  };
}

async function loadInvoiceDto(
  financeId: string,
  invoiceId: string,
  executor: FinanceExecutor = db,
): Promise<SchedulerInvoiceDto> {
  const [invoice] = await executor.select().from(schedulerInvoices).where(and(
    eq(schedulerInvoices.id, invoiceId),
    eq(schedulerInvoices.financeId, financeId),
  )).limit(1);
  if (!invoice) throw notFound('Invoice');
  const lines = await executor.select().from(schedulerInvoiceLines)
    .where(eq(schedulerInvoiceLines.invoiceId, invoice.id))
    .orderBy(asc(schedulerInvoiceLines.sortOrder), asc(schedulerInvoiceLines.createdAt));
  return invoiceDto(invoice, lines);
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
  const event = await latestEventForSource(source, executor);
  const metadata = await loadJobMetadata(source, event, executor);
  return { finance, source, event, metadata };
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

async function replaceDraftLines(
  finance: FinanceRow,
  invoice: InvoiceRow,
  inputs: InvoiceLineInput[],
  executor: FinanceExecutor,
  updatedAt = nextInvoiceUpdatedAt(invoice),
): Promise<void> {
  if (!Array.isArray(inputs) || inputs.length > 250) {
    throw badRequest('lines must contain at most 250 invoice lines');
  }
  const currentOverride = await latestHourOverride(finance.id, executor);
  const recorded = await recordedHoursForSource({
    sourceApp: finance.sourceApp as FinanceSourceApp,
    sourceType: finance.sourceType as FinanceSourceType,
    sourceId: finance.sourceId,
  }, executor);
  const effectiveBillableHours = currentOverride?.billableMilliseconds == null
    ? recorded.activeMilliseconds / 3_600_000
    : currentOverride.billableMilliseconds / 3_600_000;

  const activeRows = await executor.select({
    invoiceId: schedulerInvoices.id,
    kind: schedulerInvoiceLines.kind,
    quantity: schedulerInvoiceLines.quantity,
    lineTotalCents: schedulerInvoiceLines.lineTotalExGstCents,
    expenseId: schedulerInvoiceLines.expenseId,
  }).from(schedulerInvoiceLines)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceLines.invoiceId))
    .where(and(
      eq(schedulerInvoices.financeId, finance.id),
      inArray(schedulerInvoices.status, ACTIVE_INVOICE_STATUSES),
      ne(schedulerInvoices.id, invoice.id),
    ));
  const reservedExpenseIds = new Set(activeRows.flatMap((row) => (
    row.expenseId ? [row.expenseId] : []
  )));
  let otherReservedLabourUnits = 0;
  let otherReservedQuoteCents = 0;
  for (const row of activeRows) {
    if (row.kind === 'labour') {
      const units = Math.round(row.quantity * 10_000);
      if (!Number.isSafeInteger(units) || units < 0) {
        throw conflict('Reserved labour exceeds the supported accounting range');
      }
      otherReservedLabourUnits = addAccountingCents(
        otherReservedLabourUnits,
        units,
        'Reserved labour',
      );
    }
    if (row.kind === 'quoted') {
      otherReservedQuoteCents = addAccountingCents(
        otherReservedQuoteCents,
        row.lineTotalCents,
        'Reserved quote value',
      );
    }
  }

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
      eq(schedulerJobExpenses.financeId, finance.id),
      inArray(schedulerJobExpenses.id, requestedExpenseIds),
      isNull(schedulerJobExpenses.deletedAt),
    ));
  const expenseById = new Map(expenseRows.map((row) => [row.id, row]));

  let invoiceLabourUnits = 0;
  let invoiceQuoteCents = 0;
  const values: Array<typeof schedulerInvoiceLines.$inferInsert> = [];
  const ids = new Set<string>();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]!;
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
    const lineTotalCents = Math.round(quantity * unitAmountCents);
    if (!Number.isSafeInteger(lineTotalCents)) {
      throw badRequest(`lines[${index}] total is too large`);
    }
    let category: string | null = null;
    if (kind === 'expense') {
      const expense = expenseById.get(expenseId!);
      if (!expense) throw badRequest(`Expense ${expenseId} is not part of this job`);
      if (!expense.billable) throw badRequest(`Expense ${expenseId} is not billable`);
      if (expense.invoiced) throw conflict(`Expense ${expenseId} is already invoiced`);
      if (reservedExpenseIds.has(expense.id)) {
        throw conflict(`Expense ${expense.id} is already reserved by another invoice`);
      }
      const expectedCents = expense.billableAmountCents ?? expense.costAmountCents;
      if (quantity !== 1 || lineTotalCents !== expectedCents) {
        throw badRequest('Linked expense lines must use quantity 1 and the expense billable amount');
      }
      category = expense.category;
    } else if (kind === 'labour') {
      invoiceLabourUnits = addAccountingCents(
        invoiceLabourUnits,
        quantityUnits,
        'Invoice labour',
      );
    } else if (kind === 'quoted') {
      invoiceQuoteCents = addAccountingCents(
        invoiceQuoteCents,
        lineTotalCents,
        'Invoice quoted value',
      );
    }
    const id = optionalText(input.id, 100) ?? randomUUID();
    if (ids.has(id)) throw badRequest('Invoice line ids must be unique');
    ids.add(id);
    values.push({
      id,
      invoiceId: invoice.id,
      sortOrder: index,
      kind,
      description: requireText(input.description, `lines[${index}].description`, 500),
      quantity,
      unitAmountExGstCents: unitAmountCents,
      lineTotalExGstCents: lineTotalCents,
      expenseId,
      category,
      createdAt: new Date(),
    });
  }
  const effectiveBillableUnits = Math.round(effectiveBillableHours * 10_000);
  if (!Number.isSafeInteger(effectiveBillableUnits) || effectiveBillableUnits < 0) {
    throw conflict('Effective billable hours exceed the supported accounting range');
  }
  const totalReservedLabourUnits = addAccountingCents(
    otherReservedLabourUnits,
    invoiceLabourUnits,
    'Reserved labour',
  );
  if (totalReservedLabourUnits > effectiveBillableUnits) {
    throw conflict('Invoice labour exceeds the job’s effective billable hours');
  }
  const totalReservedQuoteCents = addAccountingCents(
    otherReservedQuoteCents,
    invoiceQuoteCents,
    'Reserved quote value',
  );
  if (
    finance.pricingMode === 'quoted'
    && totalReservedQuoteCents > (finance.quotedAmountCents ?? 0)
  ) {
    throw conflict('Quoted invoice lines exceed the job’s quoted amount');
  }
  const gstRateBps = invoice.gstRateBps;
  const totals = invoiceTotalsFromCents(
    values.map((value) => value.lineTotalExGstCents ?? 0),
    gstRateBps,
  );
  if (values.length === 0 || totals.subtotal <= 0) {
    throw badRequest('An invoice must contain at least one positive-value line');
  }
  await executor.delete(schedulerInvoiceLines)
    .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
  await executor.insert(schedulerInvoiceLines).values(values);
  await executor.update(schedulerInvoices).set({
    subtotalExGstCents: totals.subtotal,
    gstAmountCents: totals.gst,
    totalIncGstCents: totals.total,
    updatedAt,
  }).where(and(
    eq(schedulerInvoices.id, invoice.id),
    eq(schedulerInvoices.status, 'draft'),
  ));
}

export async function listSchedulerInvoices(
  user: AuthUser,
  eventId: string,
): Promise<SchedulerInvoiceListItemDto[]> {
  await requireGlobalFinanceAdmin(user);
  const { finance } = await financeForEvent(eventId);
  const rows = await db.select().from(schedulerInvoices)
    .where(eq(schedulerInvoices.financeId, finance.id))
    .orderBy(desc(schedulerInvoices.createdAt));
  return rows.map((row) => invoiceListItem(row));
}

export async function listSchedulerInvoicesByFinanceId(
  user: AuthUser,
  financeId: string,
): Promise<SchedulerInvoiceListItemDto[]> {
  await requireGlobalFinanceAdmin(user);
  const context = await financeById(financeId);
  const rows = await db.select().from(schedulerInvoices)
    .where(eq(schedulerInvoices.financeId, context.finance.id))
    .orderBy(desc(schedulerInvoices.createdAt));
  return rows.map((row) => invoiceListItem(row));
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
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [recorded, currentOverride, reserved] = await Promise.all([
      recordedHoursForSource(context.source, tx),
      latestHourOverride(finance.id, tx),
      reservationRollup(finance.id, tx),
    ]);
    const effectiveBillableHours = currentOverride?.billableMilliseconds == null
      ? recorded.activeMilliseconds / 3_600_000
      : currentOverride.billableMilliseconds / 3_600_000;
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
    const seller = invoiceSellerSnapshot();
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
      billToAddress: finance.billToAddress,
      billToEmail: finance.billToEmail,
      purchaseOrderReference: finance.billingReference,
      jobSiteName: context.metadata.siteName,
      jobSiteAddress: context.metadata.siteAddress,
      jobName: context.metadata.jobName,
      jobDate: context.metadata.jobDate,
      jobClientName: context.metadata.clientName,
      jobStatus: context.metadata.status,
      jobSourceApp: context.source.sourceApp,
      jobSourceType: context.source.sourceType,
      jobSourceId: context.source.sourceId,
      createdByUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: now,
      updatedAt: now,
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
            description: `Quoted ${context.metadata.jobName}`,
            quantity: 1,
            unitAmountExGst: centsToMoney(remainingCents),
          });
        }
      } else {
        const remainingHours = round(Math.max(
          0,
          effectiveBillableHours - reserved.reservedLabourHours,
        ), 4);
        if (remainingHours > 0 && finance.billableRateCents > 0) {
          lines.push({
            kind: 'labour',
            description: 'Recorded labour',
            quantity: remainingHours,
            unitAmountExGst: centsToMoney(finance.billableRateCents),
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

async function updateSchedulerDraftInvoiceForContext(
  context: FinanceContext,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [invoice] = await tx.select().from(schedulerInvoices).where(and(
      eq(schedulerInvoices.id, invoiceId),
      eq(schedulerInvoices.financeId, finance.id),
    )).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status !== 'draft') throw conflict('Only draft invoices can be edited');
    assertInvoiceVersion(invoice, input.expectedUpdatedAt);
    const mutationUpdatedAt = nextInvoiceUpdatedAt(invoice);
    const patch: Partial<typeof schedulerInvoices.$inferInsert> = {};
    if (input.notes !== undefined) patch.notes = optionalText(input.notes, 5_000);
    if (input.dueDate !== undefined) patch.dueDate = parseDate(input.dueDate, 'dueDate');
    if (input.billToName !== undefined) {
      patch.billToName = requireText(input.billToName, 'billToName', 300);
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
      await replaceDraftLines(finance, invoice, input.lines, tx, mutationUpdatedAt);
    }
  });
  return loadInvoiceDto(context.finance.id, invoiceId);
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

async function issueSchedulerInvoiceForContext(
  context: FinanceContext,
  invoiceId: string,
  expectedUpdatedAt?: string,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [invoice] = await tx.select().from(schedulerInvoices).where(and(
      eq(schedulerInvoices.id, invoiceId),
      eq(schedulerInvoices.financeId, finance.id),
    )).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status !== 'draft') throw conflict('Only draft invoices can be issued');
    assertInvoiceVersion(invoice, expectedUpdatedAt);
    let lines = await tx.select().from(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
    if (lines.length === 0 || invoice.subtotalExGstCents <= 0) {
      throw conflict('Invoice must contain at least one positive-value line');
    }
    const currentOverride = await latestHourOverride(finance.id, tx);
    if (
      currentOverride?.source === 'legacy_estimate'
      && lines.some((line) => line.kind === 'labour')
    ) {
      throw conflict('Confirm or replace migrated legacy hours before issuing labour');
    }
    const transitionAt = new Date();
    const updatedAt = nextInvoiceUpdatedAt(invoice, transitionAt);
    await replaceDraftLines(finance, invoice, lines.map((line) => ({
      id: line.id,
      kind: line.kind as InvoiceLineKind,
      description: line.description,
      quantity: line.quantity,
      unitAmountExGst: centsToMoney(line.unitAmountExGstCents),
      expenseId: line.expenseId,
    })), tx, updatedAt);
    lines = await tx.select().from(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
    if (
      invoice.dueDate
      && utcDateKey(invoice.dueDate) < utcDateKey(transitionAt)
    ) {
      throw conflict('Invoice due date cannot be before its issue date');
    }
    const metadata = await loadJobMetadata(context.source, context.event, tx);
    const seller = invoiceSellerSnapshot();
    await tx.update(schedulerInvoices).set({
      status: 'issued',
      issueDate: transitionAt,
      issuedAt: transitionAt,
      dueDate: invoice.dueDate
        ?? new Date(transitionAt.getTime() + config.schedulerInvoice.dueDays * 86_400_000),
      ...seller,
      jobSiteName: metadata.siteName,
      jobSiteAddress: metadata.siteAddress,
      jobName: metadata.jobName,
      jobDate: metadata.jobDate,
      jobClientName: metadata.clientName,
      jobStatus: metadata.status,
      updatedAt,
    }).where(and(
      eq(schedulerInvoices.id, invoice.id),
      eq(schedulerInvoices.status, 'draft'),
    ));
    const expenseIds = lines.flatMap((line) => line.expenseId ? [line.expenseId] : []);
    if (expenseIds.length > 0) {
      await tx.update(schedulerJobExpenses).set({ invoiced: true, updatedAt: transitionAt })
        .where(inArray(schedulerJobExpenses.id, expenseIds));
    }
  });
  return loadInvoiceDto(context.finance.id, invoiceId);
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

async function voidSchedulerInvoiceForContext(
  context: FinanceContext,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [invoice] = await tx.select().from(schedulerInvoices).where(and(
      eq(schedulerInvoices.id, invoiceId),
      eq(schedulerInvoices.financeId, finance.id),
    )).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'void') return;
    if (invoice.status === 'paid') throw conflict('Paid invoices cannot be voided');
    const lines = await tx.select().from(schedulerInvoiceLines)
      .where(eq(schedulerInvoiceLines.invoiceId, invoice.id));
    const now = new Date();
    const updatedAt = nextInvoiceUpdatedAt(invoice, now);
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
  return loadInvoiceDto(context.finance.id, invoiceId);
}

export async function voidSchedulerInvoice(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return voidSchedulerInvoiceForContext(await financeForEvent(eventId), invoiceId);
}

export async function voidSchedulerInvoiceByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return voidSchedulerInvoiceForContext(await financeById(financeId), invoiceId);
}

async function markSchedulerInvoicePaidForContext(
  context: FinanceContext,
  invoiceId: string,
  paidAtInput?: string | null,
): Promise<SchedulerInvoiceDto> {
  await db.transaction(async (tx) => {
    const [finance] = await tx.select().from(schedulerJobFinance)
      .where(eq(schedulerJobFinance.id, context.finance.id)).for('update').limit(1);
    if (!finance) throw notFound('Job finance');
    const [invoice] = await tx.select().from(schedulerInvoices).where(and(
      eq(schedulerInvoices.id, invoiceId),
      eq(schedulerInvoices.financeId, finance.id),
    )).for('update').limit(1);
    if (!invoice) throw notFound('Invoice');
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
    await tx.update(schedulerInvoices).set({
      status: 'paid',
      paidAt,
      updatedAt: nextInvoiceUpdatedAt(invoice, transitionAt),
    }).where(eq(schedulerInvoices.id, invoice.id));
  });
  return loadInvoiceDto(context.finance.id, invoiceId);
}

export async function markSchedulerInvoicePaid(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  paidAt?: string | null,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return markSchedulerInvoicePaidForContext(await financeForEvent(eventId), invoiceId, paidAt);
}

export async function markSchedulerInvoicePaidByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  paidAt?: string | null,
): Promise<SchedulerInvoiceDto> {
  await requireGlobalFinanceAdmin(user);
  return markSchedulerInvoicePaidForContext(await financeById(financeId), invoiceId, paidAt);
}

export async function getSchedulerInvoicePdf(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
): Promise<InvoicePdfOutput> {
  const invoice = await getSchedulerInvoice(user, eventId, invoiceId);
  return renderSchedulerInvoicePdf(invoice);
}

export async function getSchedulerInvoicePdfByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
): Promise<InvoicePdfOutput> {
  const invoice = await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId);
  return renderSchedulerInvoicePdf(invoice);
}

export function renderSchedulerInvoicePdf(invoice: SchedulerInvoiceDto): Promise<InvoicePdfOutput> {
  return renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
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
  const [eventRows, financeRows, auditRows, assessmentRows, installationRows] = await Promise.all([
    db.select().from(portalScheduleEvents).where(and(
      inArray(portalScheduleEvents.sourceApp, ['ecoaudit', 'solarsense', 'installhub']),
      inArray(portalScheduleEvents.sourceType, ['audit', 'assessment', 'installation']),
    )).orderBy(desc(portalScheduleEvents.updatedAt)),
    db.select().from(schedulerJobFinance).orderBy(desc(schedulerJobFinance.updatedAt)),
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
    const key = `${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
    if (!sourceMap.has(key)) sourceMap.set(key, { source, event: null });
  }
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const candidates = [...sourceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
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
  })).sort((left, right) => right.jobDate.localeCompare(left.jobDate));
  return {
    items,
    nextCursor: hasNextPage && page.length > 0 ? page[page.length - 1]![0] : null,
  };
}
