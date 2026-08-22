import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  assertSchedulerRefundCapacity,
  assertSchedulerRefundGstComposition,
  isSchedulerRefundVoidReplay,
  nextSchedulerRefundRevision,
  normalizeSchedulerInvoiceRefundInput,
  schedulerRefundMoneyToCents,
  schedulerRefundRequestMatches,
} from './schedulerRefundService.js';

function isAppError(statusCode: number, detail: RegExp) {
  return (error: unknown): boolean => error instanceof AppError
    && error.statusCode === statusCode
    && detail.test(error.detail ?? '');
}

test('refund money is converted once at the integer-cent boundary', () => {
  assert.equal(schedulerRefundMoneyToCents(0, 'amount'), 0);
  assert.equal(schedulerRefundMoneyToCents(19.99, 'amount'), 1_999);
  assert.equal(schedulerRefundMoneyToCents(12.345, 'amount'), 1_235);
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '10']) {
    assert.throws(
      () => schedulerRefundMoneyToCents(value, 'amount'),
      isAppError(400, /amount must be a nonnegative number/),
    );
  }
});

test('refund input normalizes durable request fields and derives the inclusive total', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const result = normalizeSchedulerInvoiceRefundInput({
    idempotencyKey: '  provider-refund-42  ',
    expectedUpdatedAt: '2026-08-20T09:00:00.000Z',
    amountExGst: 100,
    gstAmount: 10,
    refundedAt: '2026-08-21T10:30:00.000Z',
    reason: '  Customer credit  ',
    externalReference: '  PSP-100  ',
  }, now);
  assert.deepEqual(result, {
    idempotencyKey: 'provider-refund-42',
    expectedUpdatedAt: new Date('2026-08-20T09:00:00.000Z'),
    amountExGstCents: 10_000,
    gstAmountCents: 1_000,
    totalIncGstCents: 11_000,
    refundedAt: new Date('2026-08-21T10:30:00.000Z'),
    refundedAtWasProvided: true,
    reason: 'Customer credit',
    externalReference: 'PSP-100',
  });
});

test('omitted refund time uses the transaction time and remains replayable', () => {
  const now = new Date('2026-08-21T12:00:00.000Z');
  const result = normalizeSchedulerInvoiceRefundInput({
    idempotencyKey: 'retryable',
    expectedUpdatedAt: '2026-08-20T09:00:00.000Z',
    amountExGst: 1,
    gstAmount: 0.1,
    reason: 'Adjustment',
  }, now);
  assert.equal(result.refundedAt, now);
  assert.equal(result.refundedAtWasProvided, false);
  assert.equal(schedulerRefundRequestMatches({
    amountExGstCents: 100,
    gstAmountCents: 10,
    totalIncGstCents: 110,
    refundedAt: new Date('2026-08-21T12:00:01.000Z'),
    reason: 'Adjustment',
    externalReference: null,
  }, result), true);
});

test('refund input rejects zero totals, invalid revisions, future dates, and oversized text', () => {
  const base = {
    idempotencyKey: 'key',
    expectedUpdatedAt: '2026-08-20T09:00:00.000Z',
    amountExGst: 1,
    gstAmount: 0.1,
    reason: 'Adjustment',
  };
  const now = new Date('2026-08-21T12:00:00.000Z');
  assert.throws(
    () => normalizeSchedulerInvoiceRefundInput({
      ...base,
      amountExGst: 0,
      gstAmount: 0,
    }, now),
    isAppError(400, /Refund total must be greater than zero/),
  );
  assert.throws(
    () => normalizeSchedulerInvoiceRefundInput({
      ...base,
      expectedUpdatedAt: 'not-a-date',
    }, now),
    isAppError(400, /expectedUpdatedAt must be a valid ISO datetime/),
  );
  assert.throws(
    () => normalizeSchedulerInvoiceRefundInput({
      ...base,
      refundedAt: '2026-08-21T12:00:00.001Z',
    }, now),
    isAppError(400, /refundedAt cannot be in the future/),
  );
  assert.throws(
    () => normalizeSchedulerInvoiceRefundInput({
      ...base,
      externalReference: 'x'.repeat(201),
    }, now),
    isAppError(400, /externalReference must be at most 200 characters/),
  );
});

test('cumulative posted refunds can reach but never exceed each invoice component', () => {
  const invoice = {
    amountExGstCents: 10_000,
    gstAmountCents: 1_000,
    totalIncGstCents: 11_000,
  };
  assert.doesNotThrow(() => assertSchedulerRefundCapacity(invoice, [{
    amountExGstCents: 4_000,
    gstAmountCents: 400,
    totalIncGstCents: 4_400,
  }], {
    amountExGstCents: 6_000,
    gstAmountCents: 600,
    totalIncGstCents: 6_600,
  }));
  assert.throws(() => assertSchedulerRefundCapacity(invoice, [{
    amountExGstCents: 4_000,
    gstAmountCents: 400,
    totalIncGstCents: 4_400,
  }], {
    amountExGstCents: 6_001,
    gstAmountCents: 599,
    totalIncGstCents: 6_600,
  }), isAppError(409, /Refund exceeds the remaining invoice balance/));
});

test('partial refunds preserve the invoice GST rate and final rounding remainder', () => {
  const invoice = {
    amountExGstCents: 5,
    gstAmountCents: 1,
    totalIncGstCents: 6,
    gstRateBps: 1_000,
  };
  assert.doesNotThrow(() => assertSchedulerRefundGstComposition(invoice, [], {
    amountExGstCents: 4,
    gstAmountCents: 0,
    totalIncGstCents: 4,
  }));
  assert.doesNotThrow(() => assertSchedulerRefundGstComposition(invoice, [{
    amountExGstCents: 4,
    gstAmountCents: 0,
    totalIncGstCents: 4,
  }], {
    amountExGstCents: 1,
    gstAmountCents: 1,
    totalIncGstCents: 2,
  }));
  assert.throws(() => assertSchedulerRefundGstComposition({
    amountExGstCents: 10_000,
    gstAmountCents: 1_000,
    totalIncGstCents: 11_000,
    gstRateBps: 1_000,
  }, [], {
    amountExGstCents: 2_000,
    gstAmountCents: 300,
    totalIncGstCents: 2_300,
  }), isAppError(400, /GST must match the invoice GST rate/));
  assert.throws(() => assertSchedulerRefundGstComposition(invoice, [], {
    amountExGstCents: 0,
    gstAmountCents: 1,
    totalIncGstCents: 1,
  }), isAppError(400, /amountExGst must be greater than zero/));
});

test('idempotency replay compares every client-controlled persisted field', () => {
  const input = normalizeSchedulerInvoiceRefundInput({
    idempotencyKey: 'same-key',
    expectedUpdatedAt: '2026-08-20T09:00:00.000Z',
    amountExGst: 50,
    gstAmount: 5,
    refundedAt: '2026-08-21T10:30:00.000Z',
    reason: 'Credit',
    externalReference: 'PSP-1',
  }, new Date('2026-08-21T12:00:00.000Z'));
  const row = {
    amountExGstCents: 5_000,
    gstAmountCents: 500,
    totalIncGstCents: 5_500,
    refundedAt: new Date('2026-08-21T10:30:00.000Z'),
    reason: 'Credit',
    externalReference: 'PSP-1',
  };
  assert.equal(schedulerRefundRequestMatches(row, input), true);
  assert.equal(schedulerRefundRequestMatches({ ...row, reason: 'Different' }, input), false);
  assert.equal(schedulerRefundRequestMatches({
    ...row,
    refundedAt: new Date('2026-08-21T10:30:01.000Z'),
  }, input), false);
  assert.equal(schedulerRefundRequestMatches({ ...row, gstAmountCents: 499 }, input), false);
});

test('refund revisions are strictly monotonic under same-millisecond updates', () => {
  const current = new Date('2026-08-21T12:00:00.100Z');
  assert.equal(
    nextSchedulerRefundRevision(current, new Date('2026-08-21T12:00:00.050Z')).toISOString(),
    '2026-08-21T12:00:00.101Z',
  );
  assert.equal(
    nextSchedulerRefundRevision(current, new Date('2026-08-21T12:00:01.000Z')).toISOString(),
    '2026-08-21T12:00:01.000Z',
  );
});

test('void retry is idempotent only for the same persisted audit reason', () => {
  assert.equal(isSchedulerRefundVoidReplay({
    status: 'voided',
    voidReason: 'Duplicate refund',
  }, 'Duplicate refund'), true);
  assert.equal(isSchedulerRefundVoidReplay({
    status: 'posted',
    voidReason: null,
  }, 'Duplicate refund'), false);
  assert.throws(() => isSchedulerRefundVoidReplay({
    status: 'voided',
    voidReason: 'Duplicate refund',
  }, 'Customer changed their mind'), isAppError(409, /different reason/));
});
