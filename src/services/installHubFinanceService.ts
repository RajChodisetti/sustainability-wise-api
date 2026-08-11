import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { ihInstallations, ihJobCostLines, ihJobFinance } from '../db/schema/installhub.js';
import { portalScheduleEvents } from '../db/schema/shared.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { assertInstallationAccess } from '../routes/installhub/helpers.js';

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

function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

function assertCanWriteFinance(user: AuthUser): void {
  if (!isElevated(user)) {
    throw forbidden('Only administrators can update job finances');
  }
}

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

function headerToDto(row: typeof ihJobFinance.$inferSelect): FinanceHeaderDto {
  return {
    installationId: row.installationId,
    pricingMode: row.pricingMode as PricingMode,
    pricedAmount: row.pricedAmount ?? null,
    currency: row.currency,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lineToDto(row: typeof ihJobCostLines.$inferSelect): CostLineDto {
  return {
    id: row.id,
    installationId: row.installationId,
    category: row.category as CostCategory,
    description: row.description,
    costAmount: row.costAmount,
    sellAmount: row.sellAmount ?? null,
    hours: row.hours ?? null,
    billable: row.billable,
    invoiced: row.invoiced,
    source: (row.source as CostLineSource) || 'manual',
    incurredAt: row.incurredAt ? row.incurredAt.toISOString() : null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
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

function autoLabourLineId(installationId: string): string {
  return `auto-labour:${installationId}`;
}

function parseInstallationStart(installation: typeof ihInstallations.$inferSelect): Date {
  // Prefer auditDate (job day) when valid; else createdAt.
  if (installation.auditDate) {
    const parsed = new Date(installation.auditDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    // auditDate is often YYYY-MM-DD
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(installation.auditDate);
    if (parts) {
      return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    }
  }
  return installation.createdAt;
}

async function syncAutoLabourLine(
  installation: typeof ihInstallations.$inferSelect,
): Promise<AutoLabourMeta> {
  const hoursPerDay = config.installhubLabour.hoursPerDay;
  const hourlyRate = config.installhubLabour.hourlyRate;
  const startAt = parseInstallationStart(installation);
  const endAt = installation.completedAt ?? new Date();
  const calc = computeAutoLabour({ startAt, endAt, hoursPerDay, hourlyRate });
  const enabled = hoursPerDay > 0 && hourlyRate >= 0;
  const meta: AutoLabourMeta = {
    enabled,
    hoursPerDay: calc.hoursPerDay,
    hourlyRate: calc.hourlyRate,
    calendarDays: calc.calendarDays,
    hours: calc.hours,
    costAmount: calc.costAmount,
    startAt: calc.startAt.toISOString(),
    endAt: calc.endAt.toISOString(),
  };

  if (!enabled) return meta;

  await ensureHeader(installation.id);
  const id = autoLabourLineId(installation.id);
  const now = new Date();
  const description =
    `Auto labour · ${calc.calendarDays} day(s) × ${calc.hoursPerDay}h × $${calc.hourlyRate}/h`;

  const [existing] = await db
    .select()
    .from(ihJobCostLines)
    .where(eq(ihJobCostLines.id, id));

  if (existing) {
    await db
      .update(ihJobCostLines)
      .set({
        category: 'labour',
        description,
        costAmount: calc.costAmount,
        sellAmount: calc.costAmount,
        hours: calc.hours,
        source: 'auto_labour',
        // preserve billable + invoiced flags set by admin
        updatedAt: now,
      })
      .where(eq(ihJobCostLines.id, id));
  } else {
    await db.insert(ihJobCostLines).values({
      id,
      installationId: installation.id,
      category: 'labour',
      description,
      costAmount: calc.costAmount,
      sellAmount: calc.costAmount,
      hours: calc.hours,
      billable: true,
      invoiced: false,
      source: 'auto_labour',
      incurredAt: calc.endAt,
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return meta;
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

async function loadInstallationOrThrow(installationId: string) {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(eq(ihInstallations.id, installationId), isNull(ihInstallations.deletedAt)));
  if (!installation) throw notFound('Installation');
  return installation;
}

async function ensureHeader(installationId: string): Promise<typeof ihJobFinance.$inferSelect> {
  const [existing] = await db
    .select()
    .from(ihJobFinance)
    .where(eq(ihJobFinance.installationId, installationId));
  if (existing) return existing;
  await db.insert(ihJobFinance).values({
    installationId,
    pricingMode: 'charge_up',
    pricedAmount: null,
    currency: 'AUD',
    notes: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  });
  const [created] = await db
    .select()
    .from(ihJobFinance)
    .where(eq(ihJobFinance.installationId, installationId));
  return created!;
}

async function scheduledHoursForInstallation(installationId: string): Promise<number> {
  const rows = await db
    .select({
      start: portalScheduleEvents.scheduledStartAt,
      end: portalScheduleEvents.scheduledEndAt,
    })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, 'installhub'),
      eq(portalScheduleEvents.sourceType, 'installation'),
      eq(portalScheduleEvents.sourceId, installationId),
      ne(portalScheduleEvents.status, 'cancelled'),
    ));
  let hours = 0;
  for (const row of rows) {
    if (!row.end) {
      hours += 1;
      continue;
    }
    hours += Math.max(0, (row.end.getTime() - row.start.getTime()) / 3_600_000);
  }
  return hours;
}

export async function getFinancialSummary(
  user: AuthUser,
  installationId: string,
): Promise<FinancialSummaryDto> {
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const headerRow = await ensureHeader(installationId);
  const autoLabour = await syncAutoLabourLine(installation);

  const lineRows = await db
    .select()
    .from(ihJobCostLines)
    .where(eq(ihJobCostLines.installationId, installationId))
    .orderBy(asc(ihJobCostLines.createdAt));

  const header = headerToDto(headerRow);
  const lines = lineRows.map(lineToDto);
  const scheduledHours = await scheduledHoursForInstallation(installationId);
  const rollup = computeFinancialSummary(header, lines, scheduledHours);

  return {
    installationId,
    installation: {
      siteName: installation.siteName,
      clientName: installation.clientName,
      siteAddress: installation.siteAddress,
      status: installation.status,
    },
    header,
    lines,
    autoLabour,
    currency: header.currency,
    ...rollup,
  };
}

export async function upsertFinanceHeader(
  user: AuthUser,
  installationId: string,
  input: HeaderInput,
): Promise<FinanceHeaderDto> {
  assertCanWriteFinance(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const pricingMode = parsePricingMode(input.pricingMode);
  const pricedAmount = parseMoney(input.pricedAmount, 'pricedAmount', true);
  const currency = (input.currency?.trim() || 'AUD').slice(0, 8);
  const notes = input.notes === undefined ? undefined : (input.notes?.trim() || null);
  const now = new Date();

  await ensureHeader(installationId);
  await db
    .update(ihJobFinance)
    .set({
      pricingMode,
      pricedAmount,
      currency,
      ...(notes !== undefined ? { notes } : {}),
      updatedByUserId: user.userId,
      updatedAt: now,
    })
    .where(eq(ihJobFinance.installationId, installationId));

  const [row] = await db
    .select()
    .from(ihJobFinance)
    .where(eq(ihJobFinance.installationId, installationId));
  return headerToDto(row!);
}

export async function createCostLine(
  user: AuthUser,
  installationId: string,
  input: LineInput,
): Promise<CostLineDto> {
  assertCanWriteFinance(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);
  await ensureHeader(installationId);

  const category = parseCategory(input.category);
  const description = input.description?.trim();
  if (!description) throw badRequest('description is required');
  const costAmount = parseMoney(input.costAmount, 'costAmount') ?? 0;
  const sellAmount = parseMoney(input.sellAmount, 'sellAmount', true);
  const hours = parseMoney(input.hours, 'hours', true);
  const now = new Date();
  const id = randomUUID();

  let incurredAt: Date | null = null;
  if (input.incurredAt) {
    incurredAt = new Date(input.incurredAt);
    if (Number.isNaN(incurredAt.getTime())) throw badRequest('incurredAt must be a valid ISO datetime');
  }

  await db.insert(ihJobCostLines).values({
    id,
    installationId,
    category,
    description: description.slice(0, 500),
    costAmount,
    sellAmount,
    hours,
    billable: input.billable !== false,
    invoiced: Boolean(input.invoiced),
    source: 'manual',
    incurredAt,
    createdByUserId: user.userId,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(ihJobCostLines).where(eq(ihJobCostLines.id, id));
  return lineToDto(row!);
}

export async function updateCostLine(
  user: AuthUser,
  installationId: string,
  lineId: string,
  input: Partial<LineInput>,
): Promise<CostLineDto> {
  assertCanWriteFinance(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const [existing] = await db
    .select()
    .from(ihJobCostLines)
    .where(and(
      eq(ihJobCostLines.id, lineId),
      eq(ihJobCostLines.installationId, installationId),
    ));
  if (!existing) throw notFound('Cost line');

  const isAuto = existing.source === 'auto_labour';
  const patch: Partial<typeof ihJobCostLines.$inferInsert> = { updatedAt: new Date() };

  if (isAuto) {
    if (input.invoiced !== undefined) patch.invoiced = Boolean(input.invoiced);
    if (input.billable !== undefined) patch.billable = Boolean(input.billable);
    if (
      input.category !== undefined
      || input.description !== undefined
      || input.costAmount !== undefined
      || input.sellAmount !== undefined
      || input.hours !== undefined
      || input.incurredAt !== undefined
    ) {
      throw badRequest(
        'Auto labour amounts are managed by the system; only invoiced/billable can be changed',
      );
    }
  } else {
    if (input.category !== undefined) patch.category = parseCategory(input.category);
    if (input.description !== undefined) {
      const d = input.description.trim();
      if (!d) throw badRequest('description is required');
      patch.description = d.slice(0, 500);
    }
    if (input.costAmount !== undefined) {
      patch.costAmount = parseMoney(input.costAmount, 'costAmount') ?? 0;
    }
    if (input.sellAmount !== undefined) {
      patch.sellAmount = parseMoney(input.sellAmount, 'sellAmount', true);
    }
    if (input.hours !== undefined) {
      patch.hours = parseMoney(input.hours, 'hours', true);
    }
    if (input.billable !== undefined) patch.billable = Boolean(input.billable);
    if (input.invoiced !== undefined) patch.invoiced = Boolean(input.invoiced);
    if (input.incurredAt !== undefined) {
      if (input.incurredAt === null || input.incurredAt === '') {
        patch.incurredAt = null;
      } else {
        const d = new Date(input.incurredAt);
        if (Number.isNaN(d.getTime())) throw badRequest('incurredAt must be a valid ISO datetime');
        patch.incurredAt = d;
      }
    }
  }

  await db.update(ihJobCostLines).set(patch).where(eq(ihJobCostLines.id, lineId));
  const [row] = await db.select().from(ihJobCostLines).where(eq(ihJobCostLines.id, lineId));
  return lineToDto(row!);
}

export async function deleteCostLine(
  user: AuthUser,
  installationId: string,
  lineId: string,
): Promise<void> {
  assertCanWriteFinance(user);
  const installation = await loadInstallationOrThrow(installationId);
  assertInstallationAccess(installation, user);

  const [existing] = await db
    .select()
    .from(ihJobCostLines)
    .where(and(
      eq(ihJobCostLines.id, lineId),
      eq(ihJobCostLines.installationId, installationId),
    ));
  if (!existing) throw notFound('Cost line');
  if (existing.source === 'auto_labour') {
    throw badRequest(
      'Auto labour lines cannot be deleted; they refresh from start→complete automatically',
    );
  }

  await db
    .delete(ihJobCostLines)
    .where(and(
      eq(ihJobCostLines.id, lineId),
      eq(ihJobCostLines.installationId, installationId),
    ));
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
    ['Auto labour days', String(summary.autoLabour.calendarDays)],
    ['Auto labour hours/day', String(summary.autoLabour.hoursPerDay)],
    ['Auto labour rate', String(summary.autoLabour.hourlyRate)],
    ['Auto labour hours', String(summary.autoLabour.hours)],
    ['Auto labour cost', String(summary.autoLabour.costAmount)],
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
