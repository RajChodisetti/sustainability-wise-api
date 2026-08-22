import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedulerCompletedWorkRevenueSnapshot } from './schedulerFinanceService.js';

test('completed-work snapshot persists coherent configured GST at whole-cent precision', () => {
  assert.deepEqual(buildSchedulerCompletedWorkRevenueSnapshot({
    currency: 'AUD',
    billableAmount: 100.05,
    needsFinanceReview: false,
    gstRate: 0.1,
  }), {
    status: 'captured',
    currency: 'AUD',
    amountExGstCents: 10_005,
    gstAmountCents: 1_001,
    totalIncGstCents: 11_006,
    gstRateBps: 1_000,
  });
});

test('completed-work snapshot retains money while flagging incomplete finance evidence', () => {
  assert.deepEqual(buildSchedulerCompletedWorkRevenueSnapshot({
    currency: 'NZD',
    billableAmount: 0,
    needsFinanceReview: true,
    gstRate: 0.15,
  }), {
    status: 'incomplete',
    currency: 'NZD',
    amountExGstCents: 0,
    gstAmountCents: 0,
    totalIncGstCents: 0,
    gstRateBps: 1_500,
  });
});
