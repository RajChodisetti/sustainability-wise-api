import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import { parseSchedulerInvoiceGstRate } from '../config.js';
import {
  aggregateRecordedSessionTime,
  billableHoursToMilliseconds,
  computeSchedulerCommercialTotals,
  effectiveUserLabourBilling,
  invoiceLineTotalCents,
  isCompletedSchedulerJobStatus,
  schedulerInvoiceCompletionReadiness,
  schedulerInvoiceHoursReadiness,
  schedulerInternalHoursNeedReview,
} from './schedulerFinanceService.js';

test('invoice completion readiness follows each product lifecycle fence', () => {
  assert.deepEqual(schedulerInvoiceCompletionReadiness({
    sourceApp: 'ecoaudit', jobStatus: 'Completed',
  }), { satisfied: true, basis: 'job' });
  assert.deepEqual(schedulerInvoiceCompletionReadiness({
    sourceApp: 'installhub', jobStatus: 'Draft',
  }), { satisfied: false, basis: null });
  assert.deepEqual(schedulerInvoiceCompletionReadiness({
    sourceApp: 'solarsense', jobStatus: 'Completed',
  }), { satisfied: true, basis: 'job' });
  assert.deepEqual(schedulerInvoiceCompletionReadiness({
    sourceApp: 'solarsense', jobStatus: 'Draft',
  }), { satisfied: false, basis: null });
});

test('internal hours evidence never gates invoice readiness', () => {
  assert.deepEqual(schedulerInvoiceHoursReadiness(3_600_000, null), {
    satisfied: true,
    basis: 'app_time',
  });
  assert.deepEqual(schedulerInvoiceHoursReadiness(0, null), {
    satisfied: true,
    basis: null,
  });
  assert.deepEqual(schedulerInvoiceHoursReadiness(0, {
    source: 'admin', billableMilliseconds: 0, costMilliseconds: 0,
  }), { satisfied: true, basis: 'admin_override' });
  assert.deepEqual(schedulerInvoiceHoursReadiness(0, {
    source: 'admin', billableMilliseconds: 0, costMilliseconds: null,
  }), { satisfied: true, basis: 'admin_override' });
  assert.deepEqual(schedulerInvoiceHoursReadiness(3_600_000, {
    source: 'legacy_estimate', billableMilliseconds: 3_600_000, costMilliseconds: 3_600_000,
  }), { satisfied: true, basis: 'app_time' });
  assert.deepEqual(schedulerInvoiceHoursReadiness(0, {
    source: 'legacy_estimate', billableMilliseconds: 3_600_000, costMilliseconds: 3_600_000,
  }), { satisfied: true, basis: null });

  assert.equal(schedulerInternalHoursNeedReview(3_600_000, null), false);
  assert.equal(schedulerInternalHoursNeedReview(0, null), true);
  assert.equal(schedulerInternalHoursNeedReview(0, {
    source: 'admin', billableMilliseconds: 0, costMilliseconds: 0,
  }), false);
  assert.equal(schedulerInternalHoursNeedReview(0, {
    source: 'admin', billableMilliseconds: 0, costMilliseconds: null,
  }), true);
  assert.equal(schedulerInternalHoursNeedReview(3_600_000, {
    source: 'legacy_estimate', billableMilliseconds: 3_600_000, costMilliseconds: 3_600_000,
  }), true);
});

test('billable hour overrides accept whole nonnegative hours only', () => {
  assert.equal(billableHoursToMilliseconds(0), 0);
  assert.equal(billableHoursToMilliseconds(3), 10_800_000);
  for (const invalid of [-1, 1.25, Number.POSITIVE_INFINITY, Number.NaN, '2']) {
    assert.throws(
      () => billableHoursToMilliseconds(invalid),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 400
        && error.detail === 'billableHoursOverride must be a nonnegative integer',
    );
  }
});

test('user billing uses fixed canonical rates and proportionally editable hours', () => {
  const actors = [
    {
      userId: 'user-a',
      displayName: 'A',
      activeMilliseconds: 7_200_000,
      restingMilliseconds: 900_000,
      hours: 2,
      restingHours: 0.25,
      billingRate: 100,
      labourAmount: 200,
      billingRateEditable: true,
    },
    {
      userId: 'user-b',
      displayName: 'B',
      activeMilliseconds: 3_600_000,
      restingMilliseconds: 3_600_000,
      hours: 1,
      restingHours: 1,
      billingRate: 200,
      labourAmount: 200,
      billingRateEditable: true,
    },
  ];
  assert.deepEqual(effectiveUserLabourBilling(actors, 6), {
    labourRevenueCents: 80_000,
    weightedRateCents: 13_333,
    missingBillingRateUsers: [],
  });
});

test('missing user rates fail closed, including while commercial hours remain zero', () => {
  const actors = [{
    userId: 'user-missing',
    displayName: 'Needs admin',
    activeMilliseconds: 0,
    restingMilliseconds: 0,
    hours: 0,
    restingHours: 0,
    billingRate: null,
    labourAmount: null,
    billingRateEditable: true,
  }];
  assert.deepEqual(effectiveUserLabourBilling(actors, 0), {
    labourRevenueCents: 0,
    weightedRateCents: null,
    missingBillingRateUsers: [{ userId: 'user-missing', displayName: 'Needs admin' }],
  });
  assert.deepEqual(effectiveUserLabourBilling(actors, 4), {
    labourRevenueCents: 0,
    weightedRateCents: null,
    missingBillingRateUsers: [{ userId: 'user-missing', displayName: 'Needs admin' }],
  });
});

test('recorded session aggregation reports only observed inactive time', () => {
  const recorded = aggregateRecordedSessionTime([
    {
      actorUserId: 'user-a',
      startedAt: new Date('2026-08-20T09:00:00.000Z'),
      lastActiveAt: new Date('2026-08-20T09:45:00.000Z'),
      endedAt: new Date('2026-08-20T09:45:00.000Z'),
      activeMilliseconds: 1_800_000,
    },
    {
      actorUserId: 'user-a',
      startedAt: new Date('2026-08-20T10:30:00.000Z'),
      lastActiveAt: new Date('2026-08-20T10:45:00.000Z'),
      endedAt: null,
      activeMilliseconds: 900_000,
    },
    {
      actorUserId: 'user-b',
      startedAt: new Date('2026-08-20T11:00:00.000Z'),
      lastActiveAt: new Date('2026-08-20T11:10:00.000Z'),
      endedAt: null,
      activeMilliseconds: 600_005,
    },
  ]);

  assert.deepEqual(recorded, {
    activeMilliseconds: 3_300_005,
    restingMilliseconds: 900_000,
    actors: [
      {
        actorUserId: 'user-a',
        activeMilliseconds: 2_700_000,
        restingMilliseconds: 900_000,
      },
      {
        actorUserId: 'user-b',
        activeMilliseconds: 600_005,
        restingMilliseconds: 0,
      },
    ],
  });
});

test('resting telemetry never changes user labour calculations', () => {
  const actor = {
    userId: 'user-a',
    displayName: 'A',
    activeMilliseconds: 3_600_000,
    hours: 1,
    billingRate: 100,
    labourAmount: 100,
    billingRateEditable: true,
  };
  const withoutResting = effectiveUserLabourBilling([{
    ...actor,
    restingMilliseconds: 0,
    restingHours: 0,
  }], 3);
  const withResting = effectiveUserLabourBilling([{
    ...actor,
    restingMilliseconds: 86_400_000,
    restingHours: 24,
  }], 3);
  assert.deepEqual(withResting, withoutResting);
});

test('non-zero billing hours without a linked user fail closed', () => {
  assert.deepEqual(effectiveUserLabourBilling([], 4), {
    labourRevenueCents: 0,
    weightedRateCents: null,
    missingBillingRateUsers: [{
      userId: 'unassigned',
      displayName: 'Unassigned billing user',
    }],
  });
});

test('invoice completion checks are case and whitespace tolerant only', () => {
  assert.equal(isCompletedSchedulerJobStatus('Completed'), true);
  assert.equal(isCompletedSchedulerJobStatus(' completed '), true);
  assert.equal(isCompletedSchedulerJobStatus('Draft'), false);
  assert.equal(isCompletedSchedulerJobStatus('done'), false);
});

test('invoice line totals use exact fixed-point arithmetic at safe-integer bounds', () => {
  assert.equal(
    invoiceLineTotalCents(10_001, 9_006_298_624_875_991),
    9_007_199_254_738_479,
  );
  assert.throws(
    () => invoiceLineTotalCents(10_001, Number.MAX_SAFE_INTEGER),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 400
      && error.detail === 'Invoice line total is too large',
  );
});

test('charge-up totals use effective labour sell, actual costs, and ex-GST expenses', () => {
  const totals = computeSchedulerCommercialTotals({
    pricingMode: 'charge_up',
    quotedAmountCents: null,
    billableHours: 4,
    costHours: 3.5,
    billableRateCents: 15_000,
    costRateCents: 7_500,
    expenseCostCents: 12_500,
    expenseRevenueCents: 18_000,
    invoicedCents: 30_000,
    reservedCents: 45_000,
    issuedQuoteCents: 0,
  });
  assert.deepEqual(totals, {
    billableAmount: 780,
    labourRevenue: 600,
    expenseRevenue: 180,
    totalCost: 387.5,
    labourCost: 262.5,
    expenseCost: 125,
    invoicedAmount: 300,
    reservedAmount: 450,
    uninvoicedAmount: 480,
    unbilledAmount: 480,
    unbilledQuoteBalance: 0,
    grossProfit: 392.5,
    marginPct: 50.32,
  });
});

test('quoted totals treat tracked labour as cost and only add explicit billable expenses', () => {
  const totals = computeSchedulerCommercialTotals({
    pricingMode: 'quoted',
    quotedAmountCents: 100_000,
    billableHours: 8,
    costHours: 6,
    billableRateCents: 20_000,
    costRateCents: 8_000,
    expenseCostCents: 10_000,
    expenseRevenueCents: 15_000,
    invoicedCents: 40_000,
    reservedCents: 55_000,
    issuedQuoteCents: 40_000,
  });
  assert.equal(totals.billableAmount, 1_150);
  assert.equal(totals.labourRevenue, 1_600);
  assert.equal(totals.totalCost, 580);
  assert.equal(totals.grossProfit, 570);
  assert.equal(totals.unbilledQuoteBalance, 600);
});

test('commercial totals fail closed before integer-cent arithmetic loses precision', () => {
  assert.throws(() => computeSchedulerCommercialTotals({
    pricingMode: 'quoted',
    quotedAmountCents: Number.MAX_SAFE_INTEGER,
    billableHours: 0,
    costHours: 0,
    billableRateCents: 0,
    costRateCents: 0,
    expenseCostCents: 0,
    expenseRevenueCents: 1,
    invoicedCents: 0,
    reservedCents: 0,
    issuedQuoteCents: 0,
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 409);
    assert.match(error.detail ?? '', /Billable amount exceeds the supported accounting range/);
    return true;
  });
});

test('Scheduler invoice GST config is bounded before it reaches integer DB columns', () => {
  assert.equal(parseSchedulerInvoiceGstRate(undefined), 0.1);
  assert.equal(parseSchedulerInvoiceGstRate('0'), 0);
  assert.equal(parseSchedulerInvoiceGstRate('1'), 1);
  for (const invalid of ['-0.01', '1.01', 'Infinity', 'not-a-number']) {
    assert.throws(
      () => parseSchedulerInvoiceGstRate(invalid),
      /SCHEDULER_INVOICE_GST_RATE must be a number between 0 and 1/,
    );
  }
});

test('legacy Field runtime adapters contain no ih finance writes or calendar-day sync path', () => {
  const finance = readFileSync(new URL('./installHubFinanceService.ts', import.meta.url), 'utf8');
  const invoices = readFileSync(new URL('./installHubInvoiceService.ts', import.meta.url), 'utf8');
  for (const source of [finance, invoices]) {
    assert.equal(/\b(?:insert|update|delete)\s*\(\s*ih(?:JobFinance|JobCostLines|Invoices|InvoiceLines)/.test(source), false);
    assert.equal(source.includes('syncAutoLabourLine'), false);
    assert.equal(source.includes('nextInvoiceNumber'), false);
  }
});

test('invoice snapshots no longer lock job settings or require migrated legacy hours', () => {
  const service = readFileSync(
    new URL('./schedulerFinanceService.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    service,
    /Pricing mode, quote, and hourly rates cannot change while a non-void invoice exists/,
  );
  assert.doesNotMatch(
    service,
    /Confirm or replace migrated legacy hours .* before issuing/,
  );
  assert.match(service, /Existing invoices are immutable commercial snapshots/);
});

test('0033 is append-only and declares the legacy review/counter migration', () => {
  const migration = readFileSync(
    new URL('../db/migrations/0033_abandoned_gressill.sql', import.meta.url),
    'utf8',
  );
  assert.equal(/\bDROP\s+(?:TABLE|COLUMN)\b/i.test(migration), false);
  assert.match(migration, /Legacy calendar-day estimate migrated for review/);
  assert.match(migration, /scheduler_invoice_counters/);
  assert.match(migration, /ON CONFLICT \("year"\) DO UPDATE/);
  assert.match(migration, /WHERE line\."source" = 'manual'/);
  assert.match(migration, /migration aborted: legacy cost line has nonfinite/);
  assert.match(migration, /active work-session time exceeds its plausible wall-clock span/);
  assert.match(
    migration,
    /cost\."source" = 'auto_labour' AND finance\."pricing_mode" = 'quoted' THEN 'quoted'/,
  );
  assert.match(migration, /auto_rate\."billable_rate_cents"/);
  assert.doesNotMatch(migration, /GREATEST\(0\.0001, line\."quantity"\)/);
  assert.match(migration, /derived legacy hourly rate is outside the supported accounting range/);
  assert.match(migration, /legacy invoiced cost line has no issued invoice snapshot/);
});
