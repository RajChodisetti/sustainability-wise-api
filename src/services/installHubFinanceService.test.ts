import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeAutoLabour,
  computeFinancialSummary,
  type CostLineDto,
  type FinanceHeaderDto,
} from './installHubFinanceService.js';

function header(partial: Partial<FinanceHeaderDto> = {}): FinanceHeaderDto {
  return {
    installationId: 'ih-1',
    pricingMode: 'quoted',
    pricedAmount: 1000,
    currency: 'AUD',
    notes: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

function line(partial: Partial<CostLineDto> & Pick<CostLineDto, 'id' | 'category' | 'costAmount'>): CostLineDto {
  return {
    installationId: 'ih-1',
    description: 'line',
    sellAmount: null,
    hours: null,
    billable: true,
    invoiced: false,
    source: 'manual',
    incurredAt: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('computeFinancialSummary', () => {
  it('quoted mode: potential profit = priced − total costs', () => {
    const summary = computeFinancialSummary(
      header({ pricedAmount: 500 }),
      [
        line({ id: '1', category: 'labour', costAmount: 100, hours: 2 }),
        line({ id: '2', category: 'material', costAmount: 50 }),
      ],
      3,
    );
    assert.equal(summary.billablePricedAmount, 500);
    assert.equal(summary.totalCurrentCosts, 150);
    assert.equal(summary.potentialProfit, 350);
    assert.equal(summary.uninvoicedCosts, 150);
    assert.equal(summary.invoicedCosts, 0);
    assert.equal(summary.labour.cost, 100);
    assert.equal(summary.labour.hours, 2);
    assert.equal(summary.material.cost, 50);
    assert.equal(summary.scheduledHours, 3);
    assert.equal(summary.billablePricedMarginPct, 70);
  });

  it('splits invoiced vs uninvoiced vs uninvoicable costs', () => {
    const summary = computeFinancialSummary(
      header({ pricingMode: 'charge_up', pricedAmount: null }),
      [
        line({ id: '1', category: 'labour', costAmount: 40, invoiced: true, sellAmount: 80 }),
        line({ id: '2', category: 'material', costAmount: 60, invoiced: false, sellAmount: 90 }),
        line({ id: '3', category: 'labour', costAmount: 20, billable: false }),
      ],
    );
    assert.equal(summary.invoicedCosts, 40);
    assert.equal(summary.uninvoicedCosts, 60);
    assert.equal(summary.uninvoicableCosts, 20);
    assert.equal(summary.totalCurrentCosts, 120);
    assert.equal(summary.invoicedBillable, 80);
    assert.equal(summary.billablePricedAmount, 170); // 80+90
    assert.equal(summary.potentialProfit, 70); // 170 - 100 billable costs
    assert.equal(summary.labour.unchargedCost, 20);
  });

  it('charge-up uses cost as provisional sell when sell missing', () => {
    const summary = computeFinancialSummary(
      header({ pricingMode: 'charge_up', pricedAmount: null }),
      [line({ id: '1', category: 'other', costAmount: 25, sellAmount: null })],
    );
    assert.equal(summary.billablePricedAmount, 25);
    assert.equal(summary.potentialProfit, 0);
  });
});

describe('computeAutoLabour', () => {
  it('same day counts as 1 × 8h × rate', () => {
    const day = new Date(2026, 7, 11, 9, 0, 0);
    const result = computeAutoLabour({
      startAt: day,
      endAt: day,
      hoursPerDay: 8,
      hourlyRate: 75,
    });
    assert.equal(result.calendarDays, 1);
    assert.equal(result.hours, 8);
    assert.equal(result.costAmount, 600);
  });

  it('inclusive multi-day window', () => {
    const result = computeAutoLabour({
      startAt: new Date(2026, 7, 10),
      endAt: new Date(2026, 7, 12),
      hoursPerDay: 8,
      hourlyRate: 50,
    });
    assert.equal(result.calendarDays, 3);
    assert.equal(result.hours, 24);
    assert.equal(result.costAmount, 1200);
  });
});
