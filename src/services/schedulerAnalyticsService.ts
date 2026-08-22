import {
  and,
  eq,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { compareSchedulerCompletionAttributionEvents } from './schedulerCompletionAttribution.js';
import { db } from '../db/client.js';
import {
  eaAudits,
  eaAuditWorkSessions,
} from '../db/schema/ecoaudit.js';
import {
  ihInstallations,
  ihInstallationWorkSessions,
} from '../db/schema/installhub.js';
import {
  globalUsers,
  portalScheduleEvents,
  schedulerInvoiceLines,
  schedulerInvoiceRefunds,
  schedulerInvoices,
  schedulerJobCompletionFacts,
  schedulerJobFinance,
  schedulerLeaveRequests,
  unifiedUsers,
} from '../db/schema/shared.js';
import {
  ssAssessmentWorkSessions,
  ssRooftopAssessments,
} from '../db/schema/solarsense.js';
import { badRequest, conflict, forbidden } from '../utils/errors.js';
import {
  assertGlobalFinanceAdmin,
  type FinanceSource,
} from './schedulerFinanceService.js';

export const DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE = 'Australia/Sydney';
export const MAX_SCHEDULER_ANALYTICS_DAYS = 366;
export const SCHEDULER_ANALYTICS_TRANSACTION_CONFIG = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;

const MAX_SESSIONS_PER_APP = 10_000;
const MAX_COMPLETIONS = 2_000;
const MAX_FINANCIAL_EVENTS = 5_000;
const MAX_INVOICE_LINES = 20_000;
const MAX_OPEN_SCHEDULE_EVENTS = 10_000;
const MAX_ATTRIBUTION_EVENTS = 20_000;
const QUERY_CHUNK_SIZE = 500;
const COMPLETION_FINANCE_CONCURRENCY = 0;
const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;

type SchedulerAnalyticsExecutor = Pick<typeof db, 'execute' | 'select'>;

type SourceApp = FinanceSource['sourceApp'];
type AttributionSource =
  | 'completion_fact'
  | 'scheduler_event'
  | 'product_assignment'
  | 'unattributed';

export type SchedulerAnalyticsInput = {
  from: unknown;
  to: unknown;
  timezone?: unknown;
};

export type SchedulerAnalyticsWindow = {
  from: string;
  to: string;
  timezone: string;
  dateKeys: string[];
  startAt: Date;
  endAt: Date;
};

export type SchedulerMoneyMetric = {
  amountExGstCents: number;
  gstAmountCents: number | null;
  totalIncGstCents: number | null;
  count: number;
};

export type SchedulerAnalyticsCurrencyMetrics = {
  currency: string;
  invoiceCreated: SchedulerMoneyMetric;
  issued: SchedulerMoneyMetric;
  paid: SchedulerMoneyMetric;
  voided: SchedulerMoneyMetric;
  refunded: SchedulerMoneyMetric;
  refundReversed: SchedulerMoneyMetric;
  netPaid: SchedulerMoneyMetric;
  completedWork: SchedulerMoneyMetric;
};

export type SchedulerAnalyticsLeaderboardRow = {
  rank: number;
  userId: string;
  fieldUserId: string;
  displayName: string;
  email: string;
  timezone: string;
  workingDaysMask: number;
  scheduledWorkingDays: number;
  approvedLeaveWorkingDays: number;
  workingDays: number;
  workingHoursOnSite: number;
  workingHoursOnSiteMilliseconds: number;
  averageWorkingHoursOnSitePerWorkingDay: number;
  completedJobs: number;
  averageDailyJobs: number;
  backlogJobs: number;
  pipelineJobs0To7Days: number;
  pipelineJobs8To30Days: number;
  revenue: SchedulerAnalyticsCurrencyMetrics[];
  attribution: {
    workingSessionCount: number;
    completionFactJobs: number;
    schedulerEventJobs: number;
    productAssignmentJobs: number;
  };
};

export type SchedulerAnalyticsDto = {
  complete: true;
  window: {
    from: string;
    to: string;
    timezone: string;
    startAtUtc: string;
    endAtUtcExclusive: string;
    dayCount: number;
  };
  financials: {
    currencies: SchedulerAnalyticsCurrencyMetrics[];
    daily: Array<{
      date: string;
      currencies: SchedulerAnalyticsCurrencyMetrics[];
    }>;
  };
  leaderboard: SchedulerAnalyticsLeaderboardRow[];
  quality: {
    sessions: {
      included: number;
      unattributed: number;
      unattributedActiveMilliseconds: number;
    };
    completedJobs: {
      total: number;
      completionFact: number;
      schedulerEvent: number;
      productAssignment: number;
      unattributed: number;
    };
    completedWorkRevenue: {
      snapshotCapturedJobs: number;
      snapshotIncompleteJobs: number;
      snapshotUnavailableJobs: number;
      historicalRevenueUnavailableJobs: number;
      undatedCompletedJobs: number;
    };
    financialAllocation: {
      zeroWeightDocuments: number;
      unattributedDocuments: number;
    };
    unattributed: {
      workingHoursOnSiteMilliseconds: number;
      completedJobs: number;
      backlogJobs: number;
      pipelineJobs0To7Days: number;
      pipelineJobs8To30Days: number;
      revenue: SchedulerAnalyticsCurrencyMetrics[];
    };
  };
  definitions: {
    workingHoursOnSite: string;
    sessionWindowRule: string;
    averageDailyJobs: string;
    completedWorkRevenue: string;
    invoiceCreated: string;
    issued: string;
    paid: string;
    voided: string;
    refunded: string;
    refundReversed: string;
    netPaid: string;
    technicianAttribution: string;
    leaderboardRanking: string;
    workingDays: string;
    backlog: string;
    pipeline0To7Days: string;
    pipeline8To30Days: string;
    currency: string;
  };
  limits: {
    maximumWindowDays: number;
    completionFinanceConcurrency: number;
  };
};

type ActiveUser = {
  id: string;
  fieldUserId: string;
  displayEmail: string;
  fullName: string | null;
  timezone: string;
  workingDaysMask: number;
};

type SessionObservation = {
  sourceApp: SourceApp;
  actorUserId: string;
  lastActiveAt: Date;
  endedAt: Date | null;
  activeMilliseconds: number;
};

type CompletionObservation = FinanceSource & {
  completedAt: Date;
  productAssignedOriginUserId: string | null;
  recordSource: 'completion_fact' | 'historical_product_fallback';
  revenueSnapshotStatus: 'captured' | 'incomplete' | 'unavailable';
  currency: string | null;
  amountExGstCents: number | null;
  gstAmountCents: number | null;
  totalIncGstCents: number | null;
  gstRateBps: number | null;
};

type SourceAttribution = {
  userId: string | null;
  source: AttributionSource;
};

type InvoiceObservation = {
  id: string;
  financeId: string;
  currency: string;
  subtotalExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
  createdAt: Date;
  issuedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
};

type RefundObservation = {
  id: string;
  invoiceId: string;
  currency: string;
  amountExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
  refundedAt: Date;
  voidedAt: Date | null;
};

type RevenueMetricName = Exclude<keyof SchedulerAnalyticsCurrencyMetrics, 'currency'>;

type MutableMetric = {
  amountExGstCents: number;
  gstAmountCents: number | null;
  totalIncGstCents: number | null;
  count: number;
};

type MutableCurrencyMetrics = SchedulerAnalyticsCurrencyMetrics;
type RevenueBook = Map<string, MutableCurrencyMetrics>;

type MutableLeaderboardRow = Omit<SchedulerAnalyticsLeaderboardRow, 'rank' | 'revenue'> & {
  rank?: number;
  revenueBook: RevenueBook;
};

function requireSafeNonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  return value;
}

function addSafeInteger(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw conflict(`${label} exceeds the supported accounting range`);
  }
  return sum;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function calendarDayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / MILLISECONDS_PER_DAY);
}

export function addCalendarDays(value: string, days: number): string {
  if (!isValidCalendarDate(value) || !Number.isInteger(days)) {
    throw badRequest('Calendar date arithmetic requires YYYY-MM-DD and whole days');
  }
  const date = new Date((calendarDayNumber(value) + days) * MILLISECONDS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

export function calendarDateKeysInclusive(from: string, to: string): string[] {
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || from > to) {
    throw badRequest('from and to must be valid ordered YYYY-MM-DD calendar dates');
  }
  const startDay = calendarDayNumber(from);
  const endDay = calendarDayNumber(to);
  return Array.from({ length: endDay - startDay + 1 }, (_, offset) => (
    new Date((startDay + offset) * MILLISECONDS_PER_DAY).toISOString().slice(0, 10)
  ));
}

export function isValidAnalyticsTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function dateKeyInTimeZone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

/** Earliest real instant belonging to a local date; handles midnight DST transitions. */
export function startOfCalendarDateInTimeZone(dateKey: string, timezone: string): Date {
  if (!isValidCalendarDate(dateKey)) throw badRequest('Date must be a valid YYYY-MM-DD value');
  if (!isValidAnalyticsTimeZone(timezone)) throw badRequest('timezone must be a valid IANA timezone');
  const target = calendarDayNumber(dateKey) * MILLISECONDS_PER_DAY;
  let low = target - (36 * MILLISECONDS_PER_HOUR);
  let high = target + (36 * MILLISECONDS_PER_HOUR);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateKeyInTimeZone(new Date(middle), timezone) < dateKey) low = middle + 1;
    else high = middle;
  }
  const result = new Date(low);
  if (dateKeyInTimeZone(result, timezone) !== dateKey) {
    throw badRequest(`Calendar date ${dateKey} does not exist in ${timezone}`);
  }
  return result;
}

export function parseSchedulerAnalyticsWindow(
  input: SchedulerAnalyticsInput,
): SchedulerAnalyticsWindow {
  if (!isValidCalendarDate(input.from)) {
    throw badRequest('from must be a valid YYYY-MM-DD calendar date');
  }
  if (!isValidCalendarDate(input.to)) {
    throw badRequest('to must be a valid YYYY-MM-DD calendar date');
  }
  if (input.from > input.to) throw badRequest('from must be on or before to');
  const timezone = input.timezone === undefined || input.timezone === null || input.timezone === ''
    ? DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE
    : typeof input.timezone === 'string'
      ? input.timezone.trim()
      : '';
  if (!isValidAnalyticsTimeZone(timezone)) {
    throw badRequest('timezone must be a valid IANA timezone');
  }
  const dayCount = calendarDayNumber(input.to) - calendarDayNumber(input.from) + 1;
  if (dayCount > MAX_SCHEDULER_ANALYTICS_DAYS) {
    throw badRequest(`Analytics windows are limited to ${MAX_SCHEDULER_ANALYTICS_DAYS} days`);
  }
  const dateKeys = calendarDateKeysInclusive(input.from, input.to);
  return {
    from: input.from,
    to: input.to,
    timezone,
    dateKeys,
    startAt: startOfCalendarDateInTimeZone(input.from, timezone),
    endAt: startOfCalendarDateInTimeZone(addCalendarDays(input.to, 1), timezone),
  };
}

export type WorkingDaySummary = {
  scheduledWorkingDays: number;
  approvedLeaveWorkingDays: number;
  workingDays: number;
};

/** Sunday is bit 1 and Saturday is bit 64, matching global_users.working_days_mask. */
export function calculateWorkingDays(input: {
  from: string;
  to: string;
  workingDaysMask: number;
  approvedLeave: ReadonlyArray<{ startDate: string; endDate: string }>;
}): WorkingDaySummary {
  if (!Number.isInteger(input.workingDaysMask)
    || input.workingDaysMask < 1
    || input.workingDaysMask > 127) {
    throw badRequest('workingDaysMask must be an integer from 1 through 127');
  }
  const dateKeys = calendarDateKeysInclusive(input.from, input.to);
  const scheduledDates = dateKeys.filter((dateKey) => {
    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
    return (input.workingDaysMask & (1 << weekday)) !== 0;
  });
  const leaveDates = new Set<string>();
  for (const leave of input.approvedLeave) {
    if (!isValidCalendarDate(leave.startDate)
      || !isValidCalendarDate(leave.endDate)
      || leave.startDate > leave.endDate) {
      throw badRequest('Approved leave must contain ordered YYYY-MM-DD dates');
    }
    for (const dateKey of scheduledDates) {
      if (dateKey >= leave.startDate && dateKey <= leave.endDate) leaveDates.add(dateKey);
    }
  }
  return {
    scheduledWorkingDays: scheduledDates.length,
    approvedLeaveWorkingDays: leaveDates.size,
    workingDays: scheduledDates.length - leaveDates.size,
  };
}

export function sessionBoundaryInstant(session: {
  endedAt: Date | null;
  lastActiveAt: Date;
}): Date {
  return session.endedAt ?? session.lastActiveAt;
}

export function localDateRangeForAnalyticsWindow(input: {
  startAt: Date;
  endAt: Date;
  timezone: string;
}): { from: string; to: string } {
  if (!isValidAnalyticsTimeZone(input.timezone)) {
    throw badRequest('timezone must be a valid IANA timezone');
  }
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw badRequest('Analytics window end must be after its start');
  }
  return {
    from: dateKeyInTimeZone(input.startAt, input.timezone),
    to: dateKeyInTimeZone(new Date(input.endAt.getTime() - 1), input.timezone),
  };
}

/** Sessions are assigned wholly to their persisted close/last-active boundary. */
export function sessionIsIncludedInWindow(
  session: { endedAt: Date | null; lastActiveAt: Date },
  startAt: Date,
  endAt: Date,
): boolean {
  const boundary = sessionBoundaryInstant(session).getTime();
  return boundary >= startAt.getTime() && boundary < endAt.getTime();
}

export type CentAllocationInput = { key: string; weight: number };

/** Largest-remainder cent allocation, with lexical keys as the stable tie breaker. */
export function allocateCentsDeterministically(
  totalCents: number,
  inputs: readonly CentAllocationInput[],
): Array<{ key: string; cents: number }> {
  requireSafeNonnegativeInteger(totalCents, 'Allocation total');
  if (inputs.length === 0) throw badRequest('At least one allocation target is required');
  const weightsByKey = new Map<string, number>();
  for (const input of inputs) {
    if (!input.key) throw badRequest('Allocation keys must be non-empty');
    requireSafeNonnegativeInteger(input.weight, 'Allocation weight');
    weightsByKey.set(
      input.key,
      addSafeInteger(weightsByKey.get(input.key) ?? 0, input.weight, 'Allocation weight'),
    );
  }
  const targets = [...weightsByKey.entries()]
    .map(([key, weight]) => ({ key, weight }))
    .sort((left, right) => left.key.localeCompare(right.key));
  let totalWeight = targets.reduce(
    (sum, target) => addSafeInteger(sum, target.weight, 'Allocation weight'),
    0,
  );
  if (totalWeight === 0) {
    for (const target of targets) target.weight = 1;
    totalWeight = targets.length;
  }
  const denominator = BigInt(totalWeight);
  const total = BigInt(totalCents);
  const rows = targets.map((target) => {
    const numerator = total * BigInt(target.weight);
    return {
      key: target.key,
      cents: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  const unallocated = totalCents - rows.reduce((sum, row) => sum + row.cents, 0);
  rows.sort((left, right) => (
    left.remainder === right.remainder
      ? left.key.localeCompare(right.key)
      : left.remainder > right.remainder ? -1 : 1
  ));
  for (let index = 0; index < unallocated; index += 1) rows[index]!.cents += 1;
  return rows
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ key, cents }) => ({ key, cents }));
}

export function rankLeaderboardRows<T extends {
  userId: string;
  displayName: string;
  completedJobs: number;
  workingHoursOnSiteMilliseconds: number;
}>(rows: readonly T[]): Array<T & { rank: number }> {
  return [...rows]
    .sort((left, right) => (
      right.completedJobs - left.completedJobs
      || right.workingHoursOnSiteMilliseconds - left.workingHoursOnSiteMilliseconds
      || left.displayName.localeCompare(right.displayName)
      || left.userId.localeCompare(right.userId)
    ))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function emptyMoneyMetric(gstKnown = true): SchedulerMoneyMetric {
  return {
    amountExGstCents: 0,
    gstAmountCents: gstKnown ? 0 : null,
    totalIncGstCents: gstKnown ? 0 : null,
    count: 0,
  };
}

function emptyCurrencyMetrics(currency: string): MutableCurrencyMetrics {
  return {
    currency,
    invoiceCreated: emptyMoneyMetric(),
    issued: emptyMoneyMetric(),
    paid: emptyMoneyMetric(),
    voided: emptyMoneyMetric(),
    refunded: emptyMoneyMetric(),
    refundReversed: emptyMoneyMetric(),
    netPaid: emptyMoneyMetric(),
    completedWork: emptyMoneyMetric(false),
  };
}

function metricFor(book: RevenueBook, currencyInput: string): MutableCurrencyMetrics {
  const currency = currencyInput.trim().toUpperCase();
  if (!currency) throw conflict('Analytics encountered an empty currency');
  const existing = book.get(currency);
  if (existing) return existing;
  const created = emptyCurrencyMetrics(currency);
  book.set(currency, created);
  return created;
}

function addMetric(
  book: RevenueBook,
  currency: string,
  name: RevenueMetricName,
  value: {
    amountExGstCents: number;
    gstAmountCents: number | null;
    totalIncGstCents: number | null;
    count: number;
  },
  sign = 1,
): void {
  const metric = metricFor(book, currency)[name] as MutableMetric;
  requireSafeNonnegativeInteger(value.amountExGstCents, `${name} amount`);
  metric.amountExGstCents = addSafeInteger(
    metric.amountExGstCents,
    value.amountExGstCents * sign,
    `${name} amount`,
  );
  if (value.gstAmountCents === null || value.totalIncGstCents === null) {
    metric.gstAmountCents = null;
    metric.totalIncGstCents = null;
  } else {
    requireSafeNonnegativeInteger(value.gstAmountCents, `${name} GST`);
    requireSafeNonnegativeInteger(value.totalIncGstCents, `${name} total`);
    if (metric.gstAmountCents === null || metric.totalIncGstCents === null) {
      // A first known contribution initializes a metric whose empty state used
      // null to mean "GST not known yet". Once a real unknown-GST contribution
      // exists, aggregated GST must remain unknown.
      if (metric.count === 0) {
        metric.gstAmountCents = 0;
        metric.totalIncGstCents = 0;
      } else {
        metric.count = addSafeInteger(metric.count, value.count, `${name} count`);
        return;
      }
    }
    metric.gstAmountCents = addSafeInteger(
      metric.gstAmountCents,
      value.gstAmountCents * sign,
      `${name} GST`,
    );
    metric.totalIncGstCents = addSafeInteger(
      metric.totalIncGstCents,
      value.totalIncGstCents * sign,
      `${name} total`,
    );
  }
  // Counts describe contributing lifecycle records. They stay positive even
  // when a refund subtracts money from the net-paid basis.
  metric.count = addSafeInteger(metric.count, value.count, `${name} count`);
}

function sortedBook(book: RevenueBook): SchedulerAnalyticsCurrencyMetrics[] {
  return [...book.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function assertBounded<T>(rows: readonly T[], maximum: number, label: string): void {
  if (rows.length > maximum) {
    throw conflict(`${label} exceeds the supported analytics query limit`);
  }
}

function chunks<T>(values: readonly T[], size = QUERY_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function schedulerAnalyticsSourceKey(source: {
  sourceApp: string;
  sourceType: string;
  sourceId: string;
}): string {
  return `${source.sourceApp}:${source.sourceType}:${source.sourceId}`;
}

const sourceKey = schedulerAnalyticsSourceKey;

export function schedulerCommercialSourceTypeForApp(
  sourceApp: SourceApp,
): 'audit' | 'assessment' | 'installation' {
  if (sourceApp === 'ecoaudit') return 'audit';
  if (sourceApp === 'solarsense') return 'assessment';
  return 'installation';
}

export function schedulerProductAssignmentIdentity(
  sourceApp: SourceApp,
  assignedUserId: string,
): { kind: 'field_user_id' | 'origin_user_id'; lookupKey: string } {
  return sourceApp === 'installhub'
    ? { kind: 'field_user_id', lookupKey: assignedUserId }
    : { kind: 'origin_user_id', lookupKey: `${sourceApp}:${assignedUserId}` };
}

function displayName(user: ActiveUser): string {
  return user.fullName?.trim() || user.displayEmail;
}

async function loadSessions(
  executor: SchedulerAnalyticsExecutor,
  window: SchedulerAnalyticsWindow,
): Promise<SessionObservation[]> {
  const auditBoundary = sql<Date>`COALESCE(${eaAuditWorkSessions.endedAt}, ${eaAuditWorkSessions.lastActiveAt})`;
  const assessmentBoundary = sql<Date>`COALESCE(${ssAssessmentWorkSessions.endedAt}, ${ssAssessmentWorkSessions.lastActiveAt})`;
  const installationBoundary = sql<Date>`COALESCE(${ihInstallationWorkSessions.endedAt}, ${ihInstallationWorkSessions.lastActiveAt})`;
  const [audits, assessments, installations] = await Promise.all([
    executor.select({
      actorUserId: eaAuditWorkSessions.actorUserId,
      lastActiveAt: eaAuditWorkSessions.lastActiveAt,
      endedAt: eaAuditWorkSessions.endedAt,
      activeMilliseconds: eaAuditWorkSessions.activeMilliseconds,
    }).from(eaAuditWorkSessions).where(and(
      gte(auditBoundary, sql.param(window.startAt, eaAuditWorkSessions.lastActiveAt)),
      lt(auditBoundary, sql.param(window.endAt, eaAuditWorkSessions.lastActiveAt)),
    )).limit(MAX_SESSIONS_PER_APP + 1),
    executor.select({
      actorUserId: ssAssessmentWorkSessions.actorUserId,
      lastActiveAt: ssAssessmentWorkSessions.lastActiveAt,
      endedAt: ssAssessmentWorkSessions.endedAt,
      activeMilliseconds: ssAssessmentWorkSessions.activeMilliseconds,
    }).from(ssAssessmentWorkSessions).where(and(
      gte(assessmentBoundary, sql.param(window.startAt, ssAssessmentWorkSessions.lastActiveAt)),
      lt(assessmentBoundary, sql.param(window.endAt, ssAssessmentWorkSessions.lastActiveAt)),
    )).limit(MAX_SESSIONS_PER_APP + 1),
    executor.select({
      actorUserId: ihInstallationWorkSessions.actorUserId,
      lastActiveAt: ihInstallationWorkSessions.lastActiveAt,
      endedAt: ihInstallationWorkSessions.endedAt,
      activeMilliseconds: ihInstallationWorkSessions.activeMilliseconds,
    }).from(ihInstallationWorkSessions).where(and(
      gte(installationBoundary, sql.param(window.startAt, ihInstallationWorkSessions.lastActiveAt)),
      lt(installationBoundary, sql.param(window.endAt, ihInstallationWorkSessions.lastActiveAt)),
    )).limit(MAX_SESSIONS_PER_APP + 1),
  ]);
  assertBounded(audits, MAX_SESSIONS_PER_APP, 'EcoAudit work sessions');
  assertBounded(assessments, MAX_SESSIONS_PER_APP, 'SolarSense work sessions');
  assertBounded(installations, MAX_SESSIONS_PER_APP, 'InstallHub work sessions');
  return [
    ...audits.map((row) => ({ ...row, sourceApp: 'ecoaudit' as const })),
    ...assessments.map((row) => ({ ...row, sourceApp: 'solarsense' as const })),
    ...installations.map((row) => ({ ...row, sourceApp: 'installhub' as const })),
  ];
}

async function loadCompletions(
  executor: SchedulerAnalyticsExecutor,
  window: SchedulerAnalyticsWindow,
): Promise<CompletionObservation[]> {
  const result = await executor.execute(sql`
    SELECT
      fact.source_app AS "sourceApp",
      fact.source_type AS "sourceType",
      fact.source_id AS "sourceId",
      fact.completed_at AS "completedAt",
      NULL::text AS "productAssignedOriginUserId",
      'completion_fact'::text AS "recordSource",
      fact.revenue_snapshot_status AS "revenueSnapshotStatus",
      fact.currency AS "currency",
      fact.amount_ex_gst_cents AS "amountExGstCents",
      fact.gst_amount_cents AS "gstAmountCents",
      fact.total_inc_gst_cents AS "totalIncGstCents",
      fact.gst_rate_bps AS "gstRateBps"
    FROM scheduler_job_completion_facts fact
    WHERE fact.completed_at >= ${sql.param(window.startAt, schedulerJobCompletionFacts.completedAt)}
      AND fact.completed_at < ${sql.param(window.endAt, schedulerJobCompletionFacts.completedAt)}
    UNION ALL
    SELECT
      'ecoaudit', 'audit', product.id, product.completed_at,
      product.assigned_inspector_user_id,
      'historical_product_fallback', 'unavailable',
      NULL::text, NULL::bigint, NULL::bigint, NULL::bigint, NULL::integer
    FROM ea_audits product
    WHERE product.completed_at >= ${sql.param(window.startAt, eaAudits.completedAt)}
      AND product.completed_at < ${sql.param(window.endAt, eaAudits.completedAt)}
      AND product.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM scheduler_job_completion_facts fact
        WHERE fact.source_app = 'ecoaudit'
          AND fact.source_type = 'audit'
          AND fact.source_id = product.id
      )
    UNION ALL
    SELECT
      'solarsense', 'assessment', product.id, product.completed_at,
      product.assigned_inspector_user_id,
      'historical_product_fallback', 'unavailable',
      NULL::text, NULL::bigint, NULL::bigint, NULL::bigint, NULL::integer
    FROM ss_rooftop_assessments product
    WHERE product.completed_at >= ${sql.param(window.startAt, ssRooftopAssessments.completedAt)}
      AND product.completed_at < ${sql.param(window.endAt, ssRooftopAssessments.completedAt)}
      AND product.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM scheduler_job_completion_facts fact
        WHERE fact.source_app = 'solarsense'
          AND fact.source_type = 'assessment'
          AND fact.source_id = product.id
      )
    UNION ALL
    SELECT
      'installhub', 'installation', product.id, product.completed_at,
      product.assigned_inspector_user_id,
      'historical_product_fallback', 'unavailable',
      NULL::text, NULL::bigint, NULL::bigint, NULL::bigint, NULL::integer
    FROM ih_installations product
    WHERE product.completed_at >= ${sql.param(window.startAt, ihInstallations.completedAt)}
      AND product.completed_at < ${sql.param(window.endAt, ihInstallations.completedAt)}
      AND product.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM scheduler_job_completion_facts fact
        WHERE fact.source_app = 'installhub'
          AND fact.source_type = 'installation'
          AND fact.source_id = product.id
      )
    ORDER BY "completedAt", "sourceApp", "sourceType", "sourceId"
    LIMIT ${MAX_COMPLETIONS + 1}
  `);
  const rawRows = result as unknown as Array<Record<string, unknown>>;
  assertBounded(rawRows, MAX_COMPLETIONS, 'Completed jobs');
  return rawRows.map((fact): CompletionObservation => {
    const sourceApp = fact.sourceApp;
    const sourceType = fact.sourceType;
    const supported = (sourceApp === 'ecoaudit' && sourceType === 'audit')
      || (sourceApp === 'solarsense' && sourceType === 'assessment')
      || (sourceApp === 'installhub' && sourceType === 'installation');
    if (!supported) throw conflict('Completion fact has an unsupported source identity');
    if (fact.revenueSnapshotStatus !== 'captured'
      && fact.revenueSnapshotStatus !== 'incomplete'
      && fact.revenueSnapshotStatus !== 'unavailable') {
      throw conflict('Completion fact has an unsupported revenue snapshot status');
    }
    const completedAt = fact.completedAt instanceof Date
      ? fact.completedAt
      : new Date(String(fact.completedAt));
    if (Number.isNaN(completedAt.getTime())) {
      throw conflict('Completion fact has an invalid completion instant');
    }
    const nullableInteger = (value: unknown, label: string): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = typeof value === 'number' ? value : Number(value);
      return requireSafeNonnegativeInteger(parsed, label);
    };
    return {
      sourceApp,
      sourceType,
      sourceId: String(fact.sourceId),
      completedAt,
      productAssignedOriginUserId: fact.productAssignedOriginUserId === null
        ? null
        : String(fact.productAssignedOriginUserId),
      recordSource: fact.recordSource === 'completion_fact'
        ? 'completion_fact'
        : 'historical_product_fallback',
      revenueSnapshotStatus: fact.revenueSnapshotStatus,
      currency: fact.currency === null ? null : String(fact.currency),
      amountExGstCents: nullableInteger(fact.amountExGstCents, 'Completed-work revenue'),
      gstAmountCents: nullableInteger(fact.gstAmountCents, 'Completed-work GST'),
      totalIncGstCents: nullableInteger(fact.totalIncGstCents, 'Completed-work total'),
      gstRateBps: nullableInteger(fact.gstRateBps, 'Completed-work GST rate'),
    } as CompletionObservation;
  });
}

async function loadUndatedCompletedJobCount(
  executor: SchedulerAnalyticsExecutor,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT count(*)::integer AS "count"
    FROM (
      SELECT product.id
      FROM ea_audits product
      WHERE product.status = 'Completed'
        AND product.completed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM scheduler_job_completion_facts fact
          WHERE fact.source_app = 'ecoaudit'
            AND fact.source_type = 'audit'
            AND fact.source_id = product.id
        )
      UNION ALL
      SELECT product.id
      FROM ss_rooftop_assessments product
      WHERE product.status = 'Completed'
        AND product.completed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM scheduler_job_completion_facts fact
          WHERE fact.source_app = 'solarsense'
            AND fact.source_type = 'assessment'
            AND fact.source_id = product.id
        )
      UNION ALL
      SELECT product.id
      FROM ih_installations product
      WHERE product.status = 'Completed'
        AND product.completed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM scheduler_job_completion_facts fact
          WHERE fact.source_app = 'installhub'
            AND fact.source_type = 'installation'
            AND fact.source_id = product.id
        )
    ) undated
  `);
  const [row] = result as unknown as Array<{ count: number | string }>;
  const count = Number(row?.count ?? 0);
  return requireSafeNonnegativeInteger(count, 'Undated completed jobs');
}

async function loadInvoiceEvents(
  executor: SchedulerAnalyticsExecutor,
  window: SchedulerAnalyticsWindow,
): Promise<InvoiceObservation[]> {
  const rows = await executor.select({
    id: schedulerInvoices.id,
    financeId: schedulerInvoices.financeId,
    currency: schedulerInvoices.currency,
    subtotalExGstCents: schedulerInvoices.subtotalExGstCents,
    gstAmountCents: schedulerInvoices.gstAmountCents,
    totalIncGstCents: schedulerInvoices.totalIncGstCents,
    createdAt: schedulerInvoices.createdAt,
    issuedAt: schedulerInvoices.issuedAt,
    paidAt: schedulerInvoices.paidAt,
    voidedAt: schedulerInvoices.voidedAt,
  }).from(schedulerInvoices).where(or(
    and(gte(schedulerInvoices.createdAt, window.startAt), lt(schedulerInvoices.createdAt, window.endAt)),
    and(gte(schedulerInvoices.issuedAt, window.startAt), lt(schedulerInvoices.issuedAt, window.endAt)),
    and(gte(schedulerInvoices.paidAt, window.startAt), lt(schedulerInvoices.paidAt, window.endAt)),
    and(gte(schedulerInvoices.voidedAt, window.startAt), lt(schedulerInvoices.voidedAt, window.endAt)),
  )).limit(MAX_FINANCIAL_EVENTS + 1);
  assertBounded(rows, MAX_FINANCIAL_EVENTS, 'Invoice events');
  return rows;
}

async function loadRefundEvents(
  executor: SchedulerAnalyticsExecutor,
  window: SchedulerAnalyticsWindow,
): Promise<RefundObservation[]> {
  const rows = await executor.select({
    id: schedulerInvoiceRefunds.id,
    invoiceId: schedulerInvoiceRefunds.invoiceId,
    currency: schedulerInvoiceRefunds.currency,
    amountExGstCents: schedulerInvoiceRefunds.amountExGstCents,
    gstAmountCents: schedulerInvoiceRefunds.gstAmountCents,
    totalIncGstCents: schedulerInvoiceRefunds.totalIncGstCents,
    refundedAt: schedulerInvoiceRefunds.refundedAt,
    voidedAt: schedulerInvoiceRefunds.voidedAt,
  }).from(schedulerInvoiceRefunds).where(or(
    and(
      gte(schedulerInvoiceRefunds.refundedAt, window.startAt),
      lt(schedulerInvoiceRefunds.refundedAt, window.endAt),
    ),
    and(
      gte(schedulerInvoiceRefunds.voidedAt, window.startAt),
      lt(schedulerInvoiceRefunds.voidedAt, window.endAt),
    ),
  )).limit(MAX_FINANCIAL_EVENTS + 1);
  assertBounded(rows, MAX_FINANCIAL_EVENTS, 'Refund events');
  return rows;
}

async function loadReferencedInvoices(
  executor: SchedulerAnalyticsExecutor,
  invoiceIds: readonly string[],
): Promise<InvoiceObservation[]> {
  const result: InvoiceObservation[] = [];
  for (const ids of chunks([...new Set(invoiceIds)])) {
    if (ids.length === 0) continue;
    result.push(...await executor.select({
      id: schedulerInvoices.id,
      financeId: schedulerInvoices.financeId,
      currency: schedulerInvoices.currency,
      subtotalExGstCents: schedulerInvoices.subtotalExGstCents,
      gstAmountCents: schedulerInvoices.gstAmountCents,
      totalIncGstCents: schedulerInvoices.totalIncGstCents,
      createdAt: schedulerInvoices.createdAt,
      issuedAt: schedulerInvoices.issuedAt,
      paidAt: schedulerInvoices.paidAt,
      voidedAt: schedulerInvoices.voidedAt,
    }).from(schedulerInvoices).where(inArray(schedulerInvoices.id, ids)));
  }
  return result;
}

async function loadInvoiceLines(
  executor: SchedulerAnalyticsExecutor,
  invoiceIds: readonly string[],
): Promise<Array<{
  invoiceId: string;
  financeId: string;
  lineTotalExGstCents: number;
}>> {
  const result: Array<{
    invoiceId: string;
    financeId: string;
    lineTotalExGstCents: number;
  }> = [];
  for (const ids of chunks([...new Set(invoiceIds)])) {
    if (ids.length === 0) continue;
    result.push(...await executor.select({
      invoiceId: schedulerInvoiceLines.invoiceId,
      financeId: schedulerInvoiceLines.financeId,
      lineTotalExGstCents: schedulerInvoiceLines.lineTotalExGstCents,
    }).from(schedulerInvoiceLines).where(inArray(schedulerInvoiceLines.invoiceId, ids)));
    assertBounded(result, MAX_INVOICE_LINES, 'Invoice lines');
  }
  return result;
}

async function loadFinanceSources(
  executor: SchedulerAnalyticsExecutor,
  financeIds: readonly string[],
): Promise<Map<string, FinanceSource>> {
  const result = new Map<string, FinanceSource>();
  for (const ids of chunks([...new Set(financeIds)])) {
    if (ids.length === 0) continue;
    const rows = await executor.select({
      id: schedulerJobFinance.id,
      sourceApp: schedulerJobFinance.sourceApp,
      sourceType: schedulerJobFinance.sourceType,
      sourceId: schedulerJobFinance.sourceId,
    }).from(schedulerJobFinance).where(inArray(schedulerJobFinance.id, ids));
    for (const row of rows) {
      if ((row.sourceApp === 'ecoaudit' && row.sourceType === 'audit')
        || (row.sourceApp === 'solarsense' && row.sourceType === 'assessment')
        || (row.sourceApp === 'installhub' && row.sourceType === 'installation')) {
        result.set(row.id, row as FinanceSource & { id: string });
      }
    }
  }
  return result;
}

async function loadOpenScheduleEvents(
  executor: SchedulerAnalyticsExecutor,
  window: SchedulerAnalyticsWindow,
): Promise<{
  anchorStart: Date;
  pipeline8Start: Date;
  pipeline31End: Date;
  events: Array<{ assigneeFieldUserId: string; scheduledStartAt: Date }>;
}> {
  const anchorDate = addCalendarDays(window.to, 1);
  const anchorStart = startOfCalendarDateInTimeZone(anchorDate, window.timezone);
  const pipeline8Start = startOfCalendarDateInTimeZone(
    addCalendarDays(window.to, 8),
    window.timezone,
  );
  const pipeline31End = startOfCalendarDateInTimeZone(
    addCalendarDays(window.to, 31),
    window.timezone,
  );
  const events = await executor.select({
    assigneeFieldUserId: portalScheduleEvents.assigneeFieldUserId,
    scheduledStartAt: portalScheduleEvents.scheduledStartAt,
  }).from(portalScheduleEvents).where(and(
    inArray(portalScheduleEvents.status, ['planned', 'in_progress']),
    lt(portalScheduleEvents.scheduledStartAt, pipeline31End),
    or(
      and(
        eq(portalScheduleEvents.sourceApp, 'ecoaudit'),
        eq(portalScheduleEvents.sourceType, 'audit'),
      ),
      and(
        eq(portalScheduleEvents.sourceApp, 'solarsense'),
        eq(portalScheduleEvents.sourceType, 'assessment'),
      ),
      and(
        eq(portalScheduleEvents.sourceApp, 'installhub'),
        eq(portalScheduleEvents.sourceType, 'installation'),
      ),
    ),
  )).limit(MAX_OPEN_SCHEDULE_EVENTS + 1);
  assertBounded(events, MAX_OPEN_SCHEDULE_EVENTS, 'Open Scheduler jobs');
  return { anchorStart, pipeline8Start, pipeline31End, events };
}

async function loadOriginIdentityMap(
  executor: SchedulerAnalyticsExecutor,
  originIdsByApp: Map<SourceApp, Set<string>>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const [app, originIds] of originIdsByApp) {
    for (const ids of chunks([...originIds])) {
      if (ids.length === 0) continue;
      const rows = await executor.select({
        originUserId: unifiedUsers.originUserId,
        globalUserId: unifiedUsers.globalUserId,
      }).from(unifiedUsers).where(and(
        eq(unifiedUsers.originApp, app),
        inArray(unifiedUsers.originUserId, ids),
      ));
      for (const row of rows) result.set(`${app}:${row.originUserId}`, row.globalUserId);
    }
  }
  return result;
}

async function loadSourceAttributions(
  executor: SchedulerAnalyticsExecutor,
  sources: readonly FinanceSource[],
): Promise<Map<string, SourceAttribution>> {
  const uniqueSources = new Map(sources.map((source) => [sourceKey(source), source]));
  const byApp = new Map<SourceApp, FinanceSource[]>();
  for (const source of uniqueSources.values()) {
    const rows = byApp.get(source.sourceApp) ?? [];
    rows.push(source);
    byApp.set(source.sourceApp, rows);
  }

  const factBySource = new Map<string, { primaryGlobalUserId: string | null }>();
  const eventBySource = new Map<string, {
    id: string;
    fieldUserId: string;
    status: string;
    updatedAt: Date;
  }>();
  const productAssignmentBySource = new Map<string, string | null>();
  const installhubFieldAssignmentBySource = new Map<string, string | null>();
  const originIdsByApp = new Map<SourceApp, Set<string>>();
  let attributionEventCount = 0;

  for (const [app, appSources] of byApp) {
    const expectedSourceType = schedulerCommercialSourceTypeForApp(app);
    const ids = [...new Set(appSources.map((source) => source.sourceId))];
    for (const idChunk of chunks(ids)) {
      const [facts, events] = await Promise.all([
        executor.select({
          sourceApp: schedulerJobCompletionFacts.sourceApp,
          sourceType: schedulerJobCompletionFacts.sourceType,
          sourceId: schedulerJobCompletionFacts.sourceId,
          primaryGlobalUserId: schedulerJobCompletionFacts.primaryGlobalUserId,
        }).from(schedulerJobCompletionFacts).where(and(
          eq(schedulerJobCompletionFacts.sourceApp, app),
          eq(schedulerJobCompletionFacts.sourceType, expectedSourceType),
          inArray(schedulerJobCompletionFacts.sourceId, idChunk),
        )),
        executor.select({
          id: portalScheduleEvents.id,
          sourceApp: portalScheduleEvents.sourceApp,
          sourceType: portalScheduleEvents.sourceType,
          sourceId: portalScheduleEvents.sourceId,
          fieldUserId: portalScheduleEvents.assigneeFieldUserId,
          status: portalScheduleEvents.status,
          updatedAt: portalScheduleEvents.updatedAt,
        }).from(portalScheduleEvents).where(and(
          eq(portalScheduleEvents.sourceApp, app),
          eq(portalScheduleEvents.sourceType, expectedSourceType),
          inArray(portalScheduleEvents.sourceId, idChunk),
          ne(portalScheduleEvents.status, 'cancelled'),
        )).limit(MAX_ATTRIBUTION_EVENTS + 1),
      ]);
      assertBounded(events, MAX_ATTRIBUTION_EVENTS, 'Scheduler attribution events');
      attributionEventCount += events.length;
      if (attributionEventCount > MAX_ATTRIBUTION_EVENTS) {
        throw conflict('Scheduler attribution events exceed the supported analytics query limit');
      }
      for (const fact of facts) {
        if (fact.sourceId === null) continue;
        factBySource.set(sourceKey(fact as FinanceSource), {
          primaryGlobalUserId: fact.primaryGlobalUserId,
        });
      }
      for (const event of events) {
        if (event.sourceId === null) continue;
        const key = sourceKey(event as FinanceSource);
        const current = eventBySource.get(key);
        if (!current || compareSchedulerCompletionAttributionEvents(event, current) < 0) {
          eventBySource.set(key, {
            id: event.id,
            fieldUserId: event.fieldUserId,
            status: event.status,
            updatedAt: event.updatedAt,
          });
        }
      }
    }

    if (app === 'ecoaudit') {
      for (const idChunk of chunks(ids)) {
        const rows = await executor.select({
          id: eaAudits.id,
          assignedOriginUserId: eaAudits.assignedInspectorUserId,
        }).from(eaAudits).where(inArray(eaAudits.id, idChunk));
        for (const row of rows) {
          const key = sourceKey({ sourceApp: app, sourceType: 'audit', sourceId: row.id });
          productAssignmentBySource.set(key, row.assignedOriginUserId);
          if (row.assignedOriginUserId) {
            const originIds = originIdsByApp.get(app) ?? new Set<string>();
            originIds.add(row.assignedOriginUserId);
            originIdsByApp.set(app, originIds);
          }
        }
      }
    } else if (app === 'solarsense') {
      for (const idChunk of chunks(ids)) {
        const rows = await executor.select({
          id: ssRooftopAssessments.id,
          assignedOriginUserId: ssRooftopAssessments.assignedInspectorUserId,
        }).from(ssRooftopAssessments).where(inArray(ssRooftopAssessments.id, idChunk));
        for (const row of rows) {
          const key = sourceKey({ sourceApp: app, sourceType: 'assessment', sourceId: row.id });
          productAssignmentBySource.set(key, row.assignedOriginUserId);
          if (row.assignedOriginUserId) {
            const originIds = originIdsByApp.get(app) ?? new Set<string>();
            originIds.add(row.assignedOriginUserId);
            originIdsByApp.set(app, originIds);
          }
        }
      }
    } else {
      for (const idChunk of chunks(ids)) {
        const rows = await executor.select({
          id: ihInstallations.id,
          assignedOriginUserId: ihInstallations.assignedInspectorUserId,
        }).from(ihInstallations).where(inArray(ihInstallations.id, idChunk));
        for (const row of rows) {
          const key = sourceKey({ sourceApp: app, sourceType: 'installation', sourceId: row.id });
          installhubFieldAssignmentBySource.set(key, row.assignedOriginUserId);
        }
      }
    }
  }

  const originIdentity = await loadOriginIdentityMap(executor, originIdsByApp);
  const fieldUserIds = [...new Set([
    ...[...eventBySource.values()].map((event) => event.fieldUserId),
    ...[...installhubFieldAssignmentBySource.values()].filter(
      (fieldUserId): fieldUserId is string => Boolean(fieldUserId),
    ),
  ])];
  const globalByField = new Map<string, string>();
  for (const fieldChunk of chunks(fieldUserIds)) {
    if (fieldChunk.length === 0) continue;
    const rows = await executor.select({
      id: globalUsers.id,
      fieldUserId: globalUsers.fieldUserId,
    }).from(globalUsers).where(inArray(globalUsers.fieldUserId, fieldChunk));
    for (const row of rows) globalByField.set(row.fieldUserId, row.id);
  }

  const result = new Map<string, SourceAttribution>();
  for (const source of uniqueSources.values()) {
    const key = sourceKey(source);
    const fact = factBySource.get(key);
    if (fact) {
      // Fact presence is authoritative even when first completion was
      // unattributed. Never let a later mutable assignment rewrite history.
      result.set(key, {
        userId: fact.primaryGlobalUserId,
        source: 'completion_fact',
      });
      continue;
    }
    const event = eventBySource.get(key);
    const eventUserId = event ? globalByField.get(event.fieldUserId) : undefined;
    if (eventUserId) {
      result.set(key, { userId: eventUserId, source: 'scheduler_event' });
      continue;
    }
    const productOriginId = productAssignmentBySource.get(key);
    const installhubFieldUserId = installhubFieldAssignmentBySource.get(key);
    const assignedUserId = source.sourceApp === 'installhub'
      ? installhubFieldUserId
      : productOriginId;
    const assignmentIdentity = assignedUserId
      ? schedulerProductAssignmentIdentity(source.sourceApp, assignedUserId)
      : null;
    const productUserId = assignmentIdentity?.kind === 'field_user_id'
      ? globalByField.get(assignmentIdentity.lookupKey)
      : assignmentIdentity
        ? originIdentity.get(assignmentIdentity.lookupKey)
        : undefined;
    result.set(key, productUserId
      ? { userId: productUserId, source: 'product_assignment' }
      : { userId: null, source: 'unattributed' });
  }
  return result;
}

function invoiceMetricValue(invoice: InvoiceObservation): {
  amountExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
  count: number;
} {
  return {
    amountExGstCents: requireSafeNonnegativeInteger(invoice.subtotalExGstCents, 'Invoice subtotal'),
    gstAmountCents: requireSafeNonnegativeInteger(invoice.gstAmountCents, 'Invoice GST'),
    totalIncGstCents: requireSafeNonnegativeInteger(invoice.totalIncGstCents, 'Invoice total'),
    count: 1,
  };
}

function refundMetricValue(refund: RefundObservation): {
  amountExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
  count: number;
} {
  return {
    amountExGstCents: requireSafeNonnegativeInteger(refund.amountExGstCents, 'Refund subtotal'),
    gstAmountCents: requireSafeNonnegativeInteger(refund.gstAmountCents, 'Refund GST'),
    totalIncGstCents: requireSafeNonnegativeInteger(refund.totalIncGstCents, 'Refund total'),
    count: 1,
  };
}

function instantIsInWindow(instant: Date | null, window: SchedulerAnalyticsWindow): instant is Date {
  return instant !== null
    && instant.getTime() >= window.startAt.getTime()
    && instant.getTime() < window.endAt.getTime();
}

function addMetricToDate(
  dailyBooks: Map<string, RevenueBook>,
  instant: Date,
  timezone: string,
  currency: string,
  name: RevenueMetricName,
  value: Parameters<typeof addMetric>[3],
  sign = 1,
): void {
  const dateKey = dateKeyInTimeZone(instant, timezone);
  const book = dailyBooks.get(dateKey) ?? new Map<string, MutableCurrencyMetrics>();
  addMetric(book, currency, name, value, sign);
  dailyBooks.set(dateKey, book);
}

function allocationWeightsForInvoice(
  invoice: InvoiceObservation,
  linesByInvoice: Map<string, Array<{ financeId: string; lineTotalExGstCents: number }>>,
): CentAllocationInput[] {
  const lines = linesByInvoice.get(invoice.id) ?? [];
  if (lines.length === 0) {
    return [{
      key: invoice.financeId,
      weight: requireSafeNonnegativeInteger(invoice.subtotalExGstCents, 'Invoice subtotal'),
    }];
  }
  return lines.map((line) => ({
    key: line.financeId,
    weight: requireSafeNonnegativeInteger(line.lineTotalExGstCents, 'Invoice line total'),
  }));
}

export function allocateMoneyMetricDeterministically(
  value: Parameters<typeof addMetric>[3],
  weights: readonly CentAllocationInput[],
): Map<string, Parameters<typeof addMetric>[3]> {
  const exGst = allocateCentsDeterministically(value.amountExGstCents, weights);
  const gst = value.gstAmountCents === null
    ? null
    : allocateCentsDeterministically(value.gstAmountCents, weights);
  if ((value.gstAmountCents === null) !== (value.totalIncGstCents === null)) {
    throw conflict('Allocated money must provide both GST and inclusive total or neither');
  }
  if (value.gstAmountCents !== null
    && value.totalIncGstCents !== value.amountExGstCents + value.gstAmountCents) {
    throw conflict('Allocated money components do not equal the inclusive total');
  }
  return new Map(exGst.map((entry, index) => [entry.key, {
    amountExGstCents: entry.cents,
    gstAmountCents: gst?.[index]?.cents ?? null,
    totalIncGstCents: gst === null ? null : entry.cents + gst[index]!.cents,
    // A document can span people; each allocated row carries a fractional
    // document conceptually, but integer API counts cannot represent that.
    // Count it once on the lexical first allocation target, preserving totals.
    count: index === 0 ? value.count : 0,
  }]));
}

/**
 * Existing-Scheduler admin analytics. Date inputs are inclusive local calendar
 * dates and all returned money remains separated by persisted currency.
 */
export async function getSchedulerAnalytics(
  user: AuthUser,
  input: SchedulerAnalyticsInput,
): Promise<SchedulerAnalyticsDto> {
  if (user.authType !== 'jwt') throw forbidden('scheduler_analytics_jwt_required');
  await assertGlobalFinanceAdmin(user);
  const window = parseSchedulerAnalyticsWindow(input);

  return db.transaction(async (executor) => {
    const [
      activeUsers,
      sessions,
      completions,
      invoiceEvents,
      refundEvents,
      openWork,
      undatedCompletedJobs,
    ] = await Promise.all([
      executor.select({
      id: globalUsers.id,
      fieldUserId: globalUsers.fieldUserId,
      displayEmail: globalUsers.displayEmail,
      fullName: globalUsers.fullName,
      timezone: globalUsers.timezone,
      workingDaysMask: globalUsers.workingDaysMask,
    }).from(globalUsers).where(eq(globalUsers.isActive, true)),
      loadSessions(executor, window),
      loadCompletions(executor, window),
      loadInvoiceEvents(executor, window),
      loadRefundEvents(executor, window),
      loadOpenScheduleEvents(executor, window),
      loadUndatedCompletedJobCount(executor),
    ]);

  const refundInvoiceIds = [...new Set(refundEvents.map((refund) => refund.invoiceId))];
  const knownInvoices = new Map(invoiceEvents.map((invoice) => [invoice.id, invoice]));
  const missingInvoiceIds = refundInvoiceIds.filter((id) => !knownInvoices.has(id));
  for (const invoice of await loadReferencedInvoices(executor, missingInvoiceIds)) {
    knownInvoices.set(invoice.id, invoice);
  }
  if (knownInvoices.size > MAX_FINANCIAL_EVENTS * 2) {
    throw conflict('Referenced invoices exceed the supported analytics query limit');
  }
  const invoiceLines = await loadInvoiceLines(executor, [...knownInvoices.keys()]);
  const linesByInvoice = new Map<string, Array<{ financeId: string; lineTotalExGstCents: number }>>();
  for (const line of invoiceLines) {
    const lines = linesByInvoice.get(line.invoiceId) ?? [];
    lines.push(line);
    linesByInvoice.set(line.invoiceId, lines);
  }
  const financeIds = [
    ...invoiceLines.map((line) => line.financeId),
    ...[...knownInvoices.values()].map((invoice) => invoice.financeId),
  ];
  const financeSources = await loadFinanceSources(executor, financeIds);
  const attributionSources = [
    ...completions,
    ...financeSources.values(),
  ];
  const sourceAttributions = await loadSourceAttributions(executor, attributionSources);

  const approvedLeaves = await executor.select({
    globalUserId: schedulerLeaveRequests.globalUserId,
    startDate: schedulerLeaveRequests.startDate,
    endDate: schedulerLeaveRequests.endDate,
  }).from(schedulerLeaveRequests).where(and(
    eq(schedulerLeaveRequests.status, 'approved'),
    gte(schedulerLeaveRequests.endDate, addCalendarDays(window.from, -2)),
    lt(schedulerLeaveRequests.startDate, addCalendarDays(window.to, 3)),
  ));
  const leaveByUser = new Map<string, Array<{ startDate: string; endDate: string }>>();
  for (const leave of approvedLeaves) {
    const rows = leaveByUser.get(leave.globalUserId) ?? [];
    rows.push({ startDate: leave.startDate, endDate: leave.endDate });
    leaveByUser.set(leave.globalUserId, rows);
  }

  const leaderboardByUser = new Map<string, MutableLeaderboardRow>();
  const activeUserByFieldId = new Map(activeUsers.map((user) => [user.fieldUserId, user]));
  for (const activeUser of activeUsers) {
    const localWindow = localDateRangeForAnalyticsWindow({
      startAt: window.startAt,
      endAt: window.endAt,
      timezone: activeUser.timezone,
    });
    const workingDays = calculateWorkingDays({
      from: localWindow.from,
      to: localWindow.to,
      workingDaysMask: activeUser.workingDaysMask,
      approvedLeave: leaveByUser.get(activeUser.id) ?? [],
    });
    leaderboardByUser.set(activeUser.id, {
      userId: activeUser.id,
      fieldUserId: activeUser.fieldUserId,
      displayName: displayName(activeUser),
      email: activeUser.displayEmail,
      timezone: activeUser.timezone,
      workingDaysMask: activeUser.workingDaysMask,
      ...workingDays,
      workingHoursOnSite: 0,
      workingHoursOnSiteMilliseconds: 0,
      averageWorkingHoursOnSitePerWorkingDay: 0,
      completedJobs: 0,
      averageDailyJobs: 0,
      backlogJobs: 0,
      pipelineJobs0To7Days: 0,
      pipelineJobs8To30Days: 0,
      attribution: {
        workingSessionCount: 0,
        completionFactJobs: 0,
        schedulerEventJobs: 0,
        productAssignmentJobs: 0,
      },
      revenueBook: new Map(),
    });
  }

  const unattributedRevenue: RevenueBook = new Map();
  const overallRevenue: RevenueBook = new Map();
  const dailyBooks = new Map<string, RevenueBook>();
  const quality = {
    sessionCount: 0,
    unattributedSessionCount: 0,
    unattributedActiveMilliseconds: 0,
    completionFact: 0,
    schedulerEvent: 0,
    productAssignment: 0,
    unattributedCompletion: 0,
    snapshotCapturedJobs: 0,
    snapshotIncompleteJobs: 0,
    snapshotUnavailableJobs: 0,
    historicalRevenueUnavailableJobs: 0,
    zeroWeightDocuments: new Set<string>(),
    unattributedDocuments: new Set<string>(),
    unattributedCompletedJobs: 0,
    unattributedBacklog: 0,
    unattributedPipeline0To7: 0,
    unattributedPipeline8To30: 0,
  };

  const sessionOriginIds = new Map<SourceApp, Set<string>>();
  for (const session of sessions) {
    const ids = sessionOriginIds.get(session.sourceApp) ?? new Set<string>();
    ids.add(session.actorUserId);
    sessionOriginIds.set(session.sourceApp, ids);
  }
  const sessionIdentity = await loadOriginIdentityMap(executor, sessionOriginIds);
  for (const session of sessions) {
    quality.sessionCount += 1;
    requireSafeNonnegativeInteger(session.activeMilliseconds, 'Working hours on site');
    const userId = sessionIdentity.get(`${session.sourceApp}:${session.actorUserId}`);
    const row = userId ? leaderboardByUser.get(userId) : undefined;
    if (!row) {
      quality.unattributedSessionCount += 1;
      quality.unattributedActiveMilliseconds = addSafeInteger(
        quality.unattributedActiveMilliseconds,
        session.activeMilliseconds,
        'Unattributed working hours on site',
      );
      continue;
    }
    row.workingHoursOnSiteMilliseconds = addSafeInteger(
      row.workingHoursOnSiteMilliseconds,
      session.activeMilliseconds,
      'Working hours on site',
    );
    row.attribution.workingSessionCount += 1;
  }

  for (const event of openWork.events) {
    const user = activeUserByFieldId.get(event.assigneeFieldUserId);
    const row = user ? leaderboardByUser.get(user.id) : undefined;
    const eventTime = event.scheduledStartAt.getTime();
    const bucket = eventTime < openWork.anchorStart.getTime()
      ? 'backlog'
      : eventTime < openWork.pipeline8Start.getTime()
        ? 'pipeline0To7'
        : 'pipeline8To30';
    if (!row) {
      if (bucket === 'backlog') quality.unattributedBacklog += 1;
      else if (bucket === 'pipeline0To7') quality.unattributedPipeline0To7 += 1;
      else quality.unattributedPipeline8To30 += 1;
    } else if (bucket === 'backlog') row.backlogJobs += 1;
    else if (bucket === 'pipeline0To7') row.pipelineJobs0To7Days += 1;
    else row.pipelineJobs8To30Days += 1;
  }

  for (const completion of completions) {
    const attribution = sourceAttributions.get(sourceKey(completion))
      ?? { userId: null, source: 'unattributed' as const };
    const row = attribution.userId ? leaderboardByUser.get(attribution.userId) : undefined;
    let currency: string | null = null;
    let metric: Parameters<typeof addMetric>[3] | null = null;
    if (completion.recordSource === 'completion_fact') {
      if (completion.revenueSnapshotStatus === 'unavailable') {
        quality.snapshotUnavailableJobs += 1;
      } else {
        const values = [
          completion.amountExGstCents,
          completion.gstAmountCents,
          completion.totalIncGstCents,
          completion.gstRateBps,
        ];
        if (!completion.currency || values.some((value) => value === null)) {
          throw conflict('Completion fact revenue snapshot is incomplete');
        }
        const amountExGstCents = requireSafeNonnegativeInteger(
          completion.amountExGstCents!,
          'Completed-work revenue',
        );
        const gstAmountCents = requireSafeNonnegativeInteger(
          completion.gstAmountCents!,
          'Completed-work GST',
        );
        const totalIncGstCents = requireSafeNonnegativeInteger(
          completion.totalIncGstCents!,
          'Completed-work total',
        );
        const gstRateBps = requireSafeNonnegativeInteger(
          completion.gstRateBps!,
          'Completed-work GST rate',
        );
        const expectedGst = Number((
          BigInt(amountExGstCents) * BigInt(gstRateBps) + 5_000n
        ) / 10_000n);
        if (gstRateBps > 10_000
          || gstAmountCents !== expectedGst
          || totalIncGstCents !== amountExGstCents + gstAmountCents) {
          throw conflict('Completion fact revenue snapshot is incoherent');
        }
        currency = completion.currency;
        metric = {
          amountExGstCents,
          gstAmountCents,
          totalIncGstCents,
          count: 1,
        };
        if (completion.revenueSnapshotStatus === 'captured') {
          quality.snapshotCapturedJobs += 1;
        } else {
          quality.snapshotIncompleteJobs += 1;
        }
      }
    } else {
      // Analytics GET is read-only. A legacy product without a fact requires
      // an explicit backfill rather than creating or borrowing today's ledger.
      quality.historicalRevenueUnavailableJobs += 1;
    }
    if (metric && currency) {
      addMetric(overallRevenue, currency, 'completedWork', metric);
      addMetricToDate(
        dailyBooks,
        completion.completedAt,
        window.timezone,
        currency,
        'completedWork',
        metric,
      );
    }
    if (row) {
      row.completedJobs += 1;
      if (metric && currency) addMetric(row.revenueBook, currency, 'completedWork', metric);
      if (attribution.source === 'completion_fact') {
        row.attribution.completionFactJobs += 1;
        quality.completionFact += 1;
      } else if (attribution.source === 'scheduler_event') {
        row.attribution.schedulerEventJobs += 1;
        quality.schedulerEvent += 1;
      } else if (attribution.source === 'product_assignment') {
        row.attribution.productAssignmentJobs += 1;
        quality.productAssignment += 1;
      }
    } else {
      quality.unattributedCompletion += 1;
      quality.unattributedCompletedJobs += 1;
      if (metric && currency) addMetric(unattributedRevenue, currency, 'completedWork', metric);
    }
  }

  const applyAllocatedDocumentMetric = (
    documentId: string,
    invoice: InvoiceObservation,
    currency: string,
    name: RevenueMetricName,
    value: Parameters<typeof addMetric>[3],
    sign = 1,
  ): void => {
    const weights = allocationWeightsForInvoice(invoice, linesByInvoice);
    if (weights.every((weight) => weight.weight === 0)) {
      quality.zeroWeightDocuments.add(documentId);
    }
    const allocations = allocateMoneyMetricDeterministically(value, weights);
    for (const [financeId, allocated] of allocations) {
      const source = financeSources.get(financeId);
      const attribution = source ? sourceAttributions.get(sourceKey(source)) : undefined;
      const row = attribution?.userId ? leaderboardByUser.get(attribution.userId) : undefined;
      if (row) addMetric(row.revenueBook, currency, name, allocated, sign);
      else {
        quality.unattributedDocuments.add(documentId);
        addMetric(unattributedRevenue, currency, name, allocated, sign);
      }
    }
  };

  for (const invoice of invoiceEvents) {
    const value = invoiceMetricValue(invoice);
    const events: Array<{ name: RevenueMetricName; instant: Date; netPaidSign?: number }> = [];
    if (instantIsInWindow(invoice.createdAt, window)) {
      events.push({ name: 'invoiceCreated', instant: invoice.createdAt });
    }
    if (instantIsInWindow(invoice.issuedAt, window)) {
      events.push({ name: 'issued', instant: invoice.issuedAt });
    }
    if (instantIsInWindow(invoice.paidAt, window)) {
      events.push({ name: 'paid', instant: invoice.paidAt });
      events.push({ name: 'netPaid', instant: invoice.paidAt, netPaidSign: 1 });
    }
    if (instantIsInWindow(invoice.voidedAt, window)) {
      events.push({ name: 'voided', instant: invoice.voidedAt });
    }
    for (const event of events) {
      const sign = event.netPaidSign ?? 1;
      addMetric(overallRevenue, invoice.currency, event.name, value, sign);
      addMetricToDate(
        dailyBooks,
        event.instant,
        window.timezone,
        invoice.currency,
        event.name,
        value,
        sign,
      );
      applyAllocatedDocumentMetric(invoice.id, invoice, invoice.currency, event.name, value, sign);
    }
  }

  for (const refund of refundEvents) {
    const invoice = knownInvoices.get(refund.invoiceId);
    if (!invoice) throw conflict('Refund analytics cannot resolve its invoice');
    if (invoice.currency.trim().toUpperCase() !== refund.currency.trim().toUpperCase()) {
      throw conflict('Refund currency does not match its invoice');
    }
    const value = refundMetricValue(refund);
    if (instantIsInWindow(refund.refundedAt, window)) {
      addMetric(overallRevenue, refund.currency, 'refunded', value);
      addMetric(overallRevenue, refund.currency, 'netPaid', value, -1);
      addMetricToDate(
        dailyBooks,
        refund.refundedAt,
        window.timezone,
        refund.currency,
        'refunded',
        value,
      );
      addMetricToDate(
        dailyBooks,
        refund.refundedAt,
        window.timezone,
        refund.currency,
        'netPaid',
        value,
        -1,
      );
      applyAllocatedDocumentMetric(refund.id, invoice, refund.currency, 'refunded', value);
      applyAllocatedDocumentMetric(refund.id, invoice, refund.currency, 'netPaid', value, -1);
    }
    if (instantIsInWindow(refund.voidedAt, window)) {
      addMetric(overallRevenue, refund.currency, 'refundReversed', value);
      addMetric(overallRevenue, refund.currency, 'netPaid', value);
      addMetricToDate(
        dailyBooks,
        refund.voidedAt,
        window.timezone,
        refund.currency,
        'refundReversed',
        value,
      );
      addMetricToDate(
        dailyBooks,
        refund.voidedAt,
        window.timezone,
        refund.currency,
        'netPaid',
        value,
      );
      applyAllocatedDocumentMetric(refund.id, invoice, refund.currency, 'refundReversed', value);
      applyAllocatedDocumentMetric(refund.id, invoice, refund.currency, 'netPaid', value);
    }
  }

  for (const row of leaderboardByUser.values()) {
    row.workingHoursOnSite = round(row.workingHoursOnSiteMilliseconds / MILLISECONDS_PER_HOUR);
    row.averageWorkingHoursOnSitePerWorkingDay = row.workingDays > 0
      ? round(row.workingHoursOnSite / row.workingDays)
      : 0;
    row.averageDailyJobs = row.workingDays > 0
      ? round(row.completedJobs / row.workingDays)
      : 0;
  }

  const ranked = rankLeaderboardRows([...leaderboardByUser.values()]);
  const leaderboard: SchedulerAnalyticsLeaderboardRow[] = ranked.map((row) => {
    const { revenueBook, ...plainRow } = row;
    return { ...plainRow, revenue: sortedBook(revenueBook) };
  });

  return {
    complete: true,
    window: {
      from: window.from,
      to: window.to,
      timezone: window.timezone,
      startAtUtc: window.startAt.toISOString(),
      endAtUtcExclusive: window.endAt.toISOString(),
      dayCount: window.dateKeys.length,
    },
    financials: {
      currencies: sortedBook(overallRevenue),
      daily: window.dateKeys.map((date) => ({
        date,
        currencies: sortedBook(dailyBooks.get(date) ?? new Map()),
      })),
    },
    leaderboard,
    quality: {
      sessions: {
        included: quality.sessionCount,
        unattributed: quality.unattributedSessionCount,
        unattributedActiveMilliseconds: quality.unattributedActiveMilliseconds,
      },
      completedJobs: {
        total: completions.length,
        completionFact: quality.completionFact,
        schedulerEvent: quality.schedulerEvent,
        productAssignment: quality.productAssignment,
        unattributed: quality.unattributedCompletion,
      },
      completedWorkRevenue: {
        snapshotCapturedJobs: quality.snapshotCapturedJobs,
        snapshotIncompleteJobs: quality.snapshotIncompleteJobs,
        snapshotUnavailableJobs: quality.snapshotUnavailableJobs,
        historicalRevenueUnavailableJobs: quality.historicalRevenueUnavailableJobs,
        undatedCompletedJobs,
      },
      financialAllocation: {
        zeroWeightDocuments: quality.zeroWeightDocuments.size,
        unattributedDocuments: quality.unattributedDocuments.size,
      },
      unattributed: {
        workingHoursOnSiteMilliseconds: quality.unattributedActiveMilliseconds,
        completedJobs: quality.unattributedCompletedJobs,
        backlogJobs: quality.unattributedBacklog,
        pipelineJobs0To7Days: quality.unattributedPipeline0To7,
        pipelineJobs8To30Days: quality.unattributedPipeline8To30,
        revenue: sortedBook(unattributedRevenue),
      },
    },
    definitions: {
      workingHoursOnSite: 'Persisted app-active milliseconds from all product work sessions; this is the approved Working hours on site label.',
      sessionWindowRule: 'A session is counted in full when endedAt, or lastActiveAt while open, is at or after the window start and before its exclusive end. Sessions are not prorated because persisted activeMilliseconds has no per-interval breakdown.',
      averageDailyJobs: 'Completed jobs divided by the user working days remaining after approved leave; zero when no working days are available.',
      completedWorkRevenue: 'First authoritative completion persists immutable snapshot status, currency, ex-GST/GST/inc-GST at the configured GST rate, and capture time. Legally accepted late sessions affect working-hours analytics only and do not rewrite completed-work revenue. Incomplete snapshots remain explicit; any revenue restatement requires a future explicit audited workflow. Unavailable facts and legacy products with no fact contribute jobs but omit revenue; analytics never creates or borrows a current ledger for historical work. quality.completedWorkRevenue.undatedCompletedJobs counts retained Completed product rows with no fact or completion timestamp; they cannot be placed in any selected window and no timestamp is invented.',
      invoiceCreated: 'Invoice snapshot value for invoices created in the selected window, including drafts.',
      issued: 'Invoice snapshot value when issuedAt falls in the selected window.',
      paid: 'Invoice snapshot value when paidAt falls in the selected window.',
      voided: 'Positive invoice snapshot value when voidedAt falls in the selected window; it is reported separately and does not rewrite earlier lifecycle events.',
      refunded: 'Positive posted-refund value when refundedAt falls in the selected window, even if that refund is reversed later.',
      refundReversed: 'Positive refund value when the audited refund reversal voidedAt falls in the selected window.',
      netPaid: 'Paid invoice value minus refund postings plus refund reversals occurring inside this window. It can be negative for a window containing refunds but no corresponding payment.',
      technicianAttribution: 'Hours use the work-session actor. A completion fact is final even when its user is null; only jobs with no fact use a non-cancelled Scheduler assignee (planned/in-progress first, then newest updatedAt, then lexical event ID) and then product assignment. Unresolved and inactive-user values remain in quality.unattributed.',
      leaderboardRanking: 'Active canonical users rank by completed jobs, then Working hours on site, then display name and user ID. Revenue is not a rank input because currencies are never converted or combined.',
      workingDays: 'For each user, the report UTC interval is converted to that user saved timezone and its inclusive local date range. The weekly mask (Sunday bit 1 through Saturday bit 64) is applied to those local dates, minus distinct approved leave labels that would otherwise be working days.',
      backlog: `Current-state count of supported commercial EcoAudit audits, SolarSense assessments, and InstallHub installations that are still planned or in progress when this report runs and are scheduled on or before ${window.to} in ${window.timezone}. Historical backlog status is not reconstructable from current Scheduler rows. Custom and legacy Solar site rows are excluded.`,
      pipeline0To7Days: `Current-state count of supported commercial jobs still planned or in progress when this report runs and scheduled from ${addCalendarDays(window.to, 1)} through ${addCalendarDays(window.to, 7)} inclusive in ${window.timezone}; it is not a historical status snapshot.`,
      pipeline8To30Days: `Current-state count of supported commercial jobs still planned or in progress when this report runs and scheduled from ${addCalendarDays(window.to, 8)} through ${addCalendarDays(window.to, 30)} inclusive in ${window.timezone}; it is not a historical status snapshot.`,
      currency: 'Currencies are never converted or combined. Invoice and refund amounts are allocated to finance jobs by line ex-GST weights with deterministic whole-cent remainders.',
    },
    limits: {
      maximumWindowDays: MAX_SCHEDULER_ANALYTICS_DAYS,
      completionFinanceConcurrency: COMPLETION_FINANCE_CONCURRENCY,
    },
  };
  }, SCHEDULER_ANALYTICS_TRANSACTION_CONFIG);
}
