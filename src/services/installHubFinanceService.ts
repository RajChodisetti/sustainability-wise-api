import type { AuthUser } from '../auth/middleware.js';
import { badRequest } from '../utils/errors.js';
import {
  createSchedulerExpenseByFinanceId,
  deleteSchedulerExpenseByFinanceId,
  getSchedulerFinancialSummaryForSource,
  updateSchedulerExpenseByFinanceId,
  updateSchedulerFinanceById,
  type SchedulerExpenseDto,
  type SchedulerFinancialSummaryDto,
} from './schedulerFinanceService.js';

export type PricingMode = 'quoted' | 'charge_up';
export type CostCategory = 'labour' | 'material' | 'other';
export type CostLineSource = 'manual' | 'auto_labour';

export type FinanceHeaderDto = {
  installationId: string;
  pricingMode: PricingMode;
  pricedAmount: number | null;
  currency: string;
  notes: string | null;
  updatedAt: string;
};

export type CostLineDto = {
  id: string;
  installationId: string;
  category: CostCategory;
  description: string;
  costAmount: number;
  sellAmount: number | null;
  hours: number | null;
  billable: boolean;
  invoiced: boolean;
  source: CostLineSource;
  incurredAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutoLabourMeta = {
  enabled: boolean;
  hoursPerDay: number;
  hourlyRate: number;
  calendarDays: number;
  hours: number;
  costAmount: number;
  startAt: string;
  endAt: string;
};

export type FinancialSummaryDto = {
  installationId: string;
  installation: {
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  header: FinanceHeaderDto;
  lines: CostLineDto[];
  autoLabour: AutoLabourMeta;
  /** Fergus-aligned rollups */
  billablePricedAmount: number;
  invoicedCosts: number;
  uninvoicedCosts: number;
  uninvoicableCosts: number;
  totalCurrentCosts: number;
  potentialProfit: number;
  creditApplied: number;
  billablePricedMarginPct: number | null;
  currentMarginToDatePct: number | null;
  marginBreathingRoomPct: number | null;
  invoicedBillable: number;
  uninvoicedBillable: number;
  labour: {
    cost: number;
    sell: number;
    hours: number;
    unchargedCost: number;
  };
  material: {
    cost: number;
    sell: number;
  };
  other: {
    cost: number;
    sell: number;
  };
  scheduledHours: number;
  currency: string;
};

type HeaderInput = {
  pricingMode: PricingMode;
  pricedAmount: number | null;
  currency?: string;
  notes?: string | null;
};

type LineInput = {
  category: CostCategory;
  description: string;
  costAmount: number;
  sellAmount?: number | null;
  hours?: number | null;
  billable?: boolean;
  invoiced?: boolean;
  incurredAt?: string | null;
};

function parsePricingMode(value: unknown): PricingMode {
  if (value === 'quoted' || value === 'charge_up') return value;
  throw badRequest('pricingMode must be quoted or charge_up');
}

function parseCategory(value: unknown): CostCategory {
  if (value === 'labour' || value === 'material' || value === 'other') return value;
  throw badRequest('category must be labour, material, or other');
}

function parseMoney(value: unknown, field: string, allowNull = false): number | null {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw badRequest(`${field} is required`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  return n;
}

function effectiveSell(line: { billable: boolean; costAmount: number; sellAmount: number | null }): number {
  if (!line.billable) return 0;
  if (line.sellAmount != null && Number.isFinite(line.sellAmount)) return line.sellAmount;
  return line.costAmount;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round2((numerator / denominator) * 100);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Legacy pure calculation retained for existing clients/tests only. Runtime
 * finance never calls it; recorded active sessions are authoritative.
 *
 * Inclusive calendar days from start day through end day (same day = 1).
 * Each day is billed at hoursPerDay × hourlyRate (from ENV).
 */
export function computeAutoLabour(input: {
  startAt: Date;
  endAt: Date;
  hoursPerDay: number;
  hourlyRate: number;
}): Omit<AutoLabourMeta, 'enabled' | 'startAt' | 'endAt'> & {
  startAt: Date;
  endAt: Date;
} {
  const start = startOfLocalDay(input.startAt);
  const end = startOfLocalDay(input.endAt);
  const msPerDay = 24 * 60 * 60 * 1000;
  const calendarDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1);
  const hoursPerDay = Math.max(0, input.hoursPerDay);
  const hourlyRate = Math.max(0, input.hourlyRate);
  const hours = round2(calendarDays * hoursPerDay);
  const costAmount = round2(hours * hourlyRate);
  return { calendarDays, hoursPerDay, hourlyRate, hours, costAmount, startAt: start, endAt: end };
}

/**
 * Fergus-aligned financial rollups for the MVP (no real invoice documents).
 * Quoted: priced_amount is the customer billable total; profit = priced − costs.
 * Charge-up: billable from sell (or cost as provisional sell) on billable lines.
 */
export function computeFinancialSummary(
  header: FinanceHeaderDto,
  lines: CostLineDto[],
  scheduledHours = 0,
): Omit<
  FinancialSummaryDto,
  'installationId' | 'installation' | 'header' | 'lines' | 'currency' | 'autoLabour'
> {
  const invoicedCosts = round2(
    lines.filter((l) => l.invoiced).reduce((s, l) => s + l.costAmount, 0),
  );
  const uninvoicedCosts = round2(
    lines.filter((l) => !l.invoiced && l.billable).reduce((s, l) => s + l.costAmount, 0),
  );
  const uninvoicableCosts = round2(
    lines.filter((l) => !l.billable).reduce((s, l) => s + l.costAmount, 0),
  );
  const totalCurrentCosts = round2(lines.reduce((s, l) => s + l.costAmount, 0));

  const sellBillable = lines.filter((l) => l.billable);
  const sellTotal = round2(sellBillable.reduce((s, l) => s + effectiveSell(l), 0));
  const invoicedBillable = round2(
    sellBillable.filter((l) => l.invoiced).reduce((s, l) => s + effectiveSell(l), 0),
  );

  let billablePricedAmount: number;
  let potentialProfit: number;
  let uninvoicedBillable: number;

  if (header.pricingMode === 'quoted' && header.pricedAmount != null) {
    billablePricedAmount = round2(header.pricedAmount);
    potentialProfit = round2(billablePricedAmount - totalCurrentCosts);
    uninvoicedBillable = round2(Math.max(0, billablePricedAmount - invoicedBillable));
  } else {
    billablePricedAmount = sellTotal;
    potentialProfit = round2(sellTotal - sellBillable.reduce((s, l) => s + l.costAmount, 0));
    uninvoicedBillable = round2(Math.max(0, billablePricedAmount - invoicedBillable));
  }

  const billablePricedMarginPct = pct(potentialProfit, billablePricedAmount);
  const currentMarginToDatePct = invoicedBillable > 0
    ? pct(invoicedBillable - invoicedCosts, invoicedBillable)
    : null;
  const marginBreathingRoomPct =
    billablePricedMarginPct != null && currentMarginToDatePct != null
      ? round2(currentMarginToDatePct - billablePricedMarginPct)
      : null;

  const labourLines = lines.filter((l) => l.category === 'labour');
  const materialLines = lines.filter((l) => l.category === 'material');
  const otherLines = lines.filter((l) => l.category === 'other');

  return {
    billablePricedAmount,
    invoicedCosts,
    uninvoicedCosts,
    uninvoicableCosts,
    totalCurrentCosts,
    potentialProfit,
    creditApplied: 0,
    billablePricedMarginPct,
    currentMarginToDatePct,
    marginBreathingRoomPct,
    invoicedBillable,
    uninvoicedBillable,
    labour: {
      cost: round2(labourLines.reduce((s, l) => s + l.costAmount, 0)),
      sell: round2(labourLines.filter((l) => l.billable).reduce((s, l) => s + effectiveSell(l), 0)),
      hours: round2(labourLines.reduce((s, l) => s + (l.hours ?? 0), 0)),
      unchargedCost: round2(
        labourLines.filter((l) => !l.billable).reduce((s, l) => s + l.costAmount, 0),
      ),
    },
    material: {
      cost: round2(materialLines.reduce((s, l) => s + l.costAmount, 0)),
      sell: round2(materialLines.filter((l) => l.billable).reduce((s, l) => s + effectiveSell(l), 0)),
    },
    other: {
      cost: round2(otherLines.reduce((s, l) => s + l.costAmount, 0)),
      sell: round2(otherLines.filter((l) => l.billable).reduce((s, l) => s + effectiveSell(l), 0)),
    },
    scheduledHours: round2(scheduledHours),
  };
}

export async function getFinancialSummary(
  user: AuthUser,
  installationId: string,
): Promise<FinancialSummaryDto> {
  const shared = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: installationId,
  });
  return sharedSummaryToLegacy(shared, installationId);
}

function sharedExpenseToLegacy(expense: SchedulerExpenseDto, installationId: string): CostLineDto {
  return {
    id: expense.id,
    installationId,
    category: expense.category === 'materials'
      ? 'material'
      : expense.category === 'subcontractor'
        ? 'labour'
        : 'other',
    description: expense.description,
    costAmount: expense.costAmount,
    sellAmount: expense.billableAmount,
    hours: null,
    billable: expense.billable,
    invoiced: expense.invoiced || expense.reserved,
    source: 'manual',
    incurredAt: expense.incurredAt,
    createdByUserId: null,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

function sharedSummaryToLegacy(
  shared: SchedulerFinancialSummaryDto,
  installationId: string,
): FinancialSummaryDto {
  const lines = shared.expenses.map((expense) => sharedExpenseToLegacy(expense, installationId));
  const header: FinanceHeaderDto = {
    installationId,
    pricingMode: shared.pricing.mode,
    pricedAmount: shared.pricing.quotedAmount,
    currency: shared.currency,
    notes: shared.pricing.notes,
    updatedAt: new Date().toISOString(),
  };
  const legacyEstimate = shared.time.overrideSource === 'legacy_estimate';
  const labourCost = shared.time.labourCost;
  const labourSell = shared.time.labourRevenue;
  const materialLines = lines.filter((line) => line.category === 'material');
  const otherLines = lines.filter((line) => line.category !== 'material');
  const materialCost = materialLines.reduce((sum, line) => sum + line.costAmount, 0);
  const materialSell = materialLines.reduce((sum, line) => sum + effectiveSell(line), 0);
  const otherCost = otherLines.reduce((sum, line) => sum + line.costAmount, 0);
  const otherSell = otherLines.reduce((sum, line) => sum + effectiveSell(line), 0);
  return {
    installationId,
    installation: {
      siteName: shared.job.siteName,
      clientName: shared.job.clientName ?? shared.billing.name ?? '',
      siteAddress: shared.job.siteAddress ?? '',
      status: shared.job.status,
    },
    header,
    lines,
    autoLabour: {
      enabled: legacyEstimate,
      hoursPerDay: 0,
      hourlyRate: shared.time.costRate,
      calendarDays: 0,
      hours: legacyEstimate ? shared.time.costHours : 0,
      costAmount: legacyEstimate ? labourCost : 0,
      startAt: shared.job.jobDate,
      endAt: shared.job.jobDate,
    },
    billablePricedAmount: shared.totals.billableAmount,
    invoicedCosts: shared.totals.invoicedAmount,
    uninvoicedCosts: Math.max(0, shared.totals.totalCost - shared.totals.invoicedAmount),
    uninvoicableCosts: lines.filter((line) => !line.billable)
      .reduce((sum, line) => sum + line.costAmount, 0),
    totalCurrentCosts: shared.totals.totalCost,
    potentialProfit: shared.totals.grossProfit,
    creditApplied: 0,
    billablePricedMarginPct: shared.totals.marginPct,
    currentMarginToDatePct: shared.totals.marginPct,
    marginBreathingRoomPct: shared.totals.marginPct,
    invoicedBillable: shared.totals.invoicedAmount,
    uninvoicedBillable: shared.totals.unbilledAmount,
    labour: {
      cost: labourCost,
      sell: labourSell,
      hours: shared.time.costHours,
      unchargedCost: Math.max(0, labourCost - labourSell),
    },
    material: { cost: materialCost, sell: materialSell },
    other: { cost: otherCost, sell: otherSell },
    scheduledHours: shared.time.scheduledHours,
    currency: shared.currency,
  };
}

export async function upsertFinanceHeader(
  user: AuthUser,
  installationId: string,
  input: HeaderInput,
): Promise<FinanceHeaderDto> {
  const current = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub', sourceType: 'installation', sourceId: installationId,
  });
  const updated = await updateSchedulerFinanceById(user, current.financeId, {
    pricingMode: parsePricingMode(input.pricingMode),
    quotedAmount: parseMoney(input.pricedAmount, 'pricedAmount', true),
    currency: input.currency,
    notes: input.notes,
  });
  return sharedSummaryToLegacy(updated, installationId).header;
}

export async function createCostLine(
  user: AuthUser,
  installationId: string,
  input: LineInput,
): Promise<CostLineDto> {
  if (input.hours !== undefined && input.hours !== null) {
    throw badRequest('Recorded hours are managed by the immutable active-work ledger');
  }
  if (input.invoiced) throw badRequest('Invoice state is managed by invoice lifecycle');
  const summary = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub', sourceType: 'installation', sourceId: installationId,
  });
  const category = parseCategory(input.category);
  const expense = await createSchedulerExpenseByFinanceId(user, summary.financeId, {
    kind: 'expense',
    category: category === 'material'
      ? 'materials'
      : category === 'labour' ? 'subcontractor' : 'other',
    description: input.description,
    costAmount: parseMoney(input.costAmount, 'costAmount') ?? 0,
    billableAmount: parseMoney(input.sellAmount, 'sellAmount', true),
    billable: input.billable,
    incurredAt: input.incurredAt,
  });
  return sharedExpenseToLegacy(expense, installationId);
}

export async function updateCostLine(
  user: AuthUser,
  installationId: string,
  lineId: string,
  input: Partial<LineInput>,
): Promise<CostLineDto> {
  if (input.invoiced !== undefined || input.hours !== undefined) {
    throw badRequest('Invoice state and recorded hours are managed by their dedicated ledgers');
  }
  const summary = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub', sourceType: 'installation', sourceId: installationId,
  });
  const category = input.category === undefined ? undefined : parseCategory(input.category);
  const expense = await updateSchedulerExpenseByFinanceId(user, summary.financeId, lineId, {
    ...(category === undefined ? {} : {
      category: category === 'material'
        ? 'materials' : category === 'labour' ? 'subcontractor' : 'other',
    }),
    description: input.description,
    costAmount: input.costAmount,
    billableAmount: input.sellAmount,
    billable: input.billable,
    incurredAt: input.incurredAt,
  });
  return sharedExpenseToLegacy(expense, installationId);
}

export async function deleteCostLine(
  user: AuthUser,
  installationId: string,
  lineId: string,
): Promise<void> {
  const summary = await getSchedulerFinancialSummaryForSource(user, {
    sourceApp: 'installhub', sourceType: 'installation', sourceId: installationId,
  });
  await deleteSchedulerExpenseByFinanceId(user, summary.financeId, lineId);
}

export function financialSummaryToCsv(summary: FinancialSummaryDto): string {
  const rows: string[][] = [
    ['Field', 'Value'],
    ['Installation', summary.installation.siteName],
    ['Client', summary.installation.clientName],
    ['Pricing mode', summary.header.pricingMode],
    ['Currency', summary.currency],
    ['Billable/Priced Amount', String(summary.billablePricedAmount)],
    ['Invoiced Costs', String(summary.invoicedCosts)],
    ['Uninvoiced Costs', String(summary.uninvoicedCosts)],
    ['Uninvoicable Costs', String(summary.uninvoicableCosts)],
    ['Total Current Costs', String(summary.totalCurrentCosts)],
    ['Potential Profit', String(summary.potentialProfit)],
    ['Invoiced Billable', String(summary.invoicedBillable)],
    ['Uninvoiced Billable', String(summary.uninvoicedBillable)],
    ['Billable/Priced Margin %', summary.billablePricedMarginPct == null ? '' : String(summary.billablePricedMarginPct)],
    ['Current Margin to Date %', summary.currentMarginToDatePct == null ? '' : String(summary.currentMarginToDatePct)],
    ['Labour Cost', String(summary.labour.cost)],
    ['Labour Hours', String(summary.labour.hours)],
    ['Material Cost', String(summary.material.cost)],
    ['Scheduled Hours', String(summary.scheduledHours)],
    ['Migrated legacy estimate days', String(summary.autoLabour.calendarDays)],
    ['Migrated legacy estimate hours/day', String(summary.autoLabour.hoursPerDay)],
    ['Migrated legacy estimate rate', String(summary.autoLabour.hourlyRate)],
    ['Migrated legacy estimate hours', String(summary.autoLabour.hours)],
    ['Migrated legacy estimate cost', String(summary.autoLabour.costAmount)],
    [],
    ['Cost lines'],
    ['Id', 'Source', 'Category', 'Description', 'Cost', 'Sell', 'Hours', 'Billable', 'Invoiced'],
    ...summary.lines.map((l) => [
      l.id,
      l.source,
      l.category,
      l.description,
      String(l.costAmount),
      l.sellAmount == null ? '' : String(l.sellAmount),
      l.hours == null ? '' : String(l.hours),
      String(l.billable),
      String(l.invoiced),
    ]),
  ];
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
