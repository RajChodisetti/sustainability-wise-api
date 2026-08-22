import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  globalUsers,
  schedulerInvoiceRefunds,
  schedulerInvoices,
  unifiedUsers,
} from '../db/schema/shared.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { assertSchedulerInvoiceVisible } from './schedulerFinanceService.js';

export type SchedulerInvoiceRefundStatus = 'posted' | 'voided';

export type SchedulerInvoiceRefundDto = {
  id: string;
  invoiceId: string;
  idempotencyKey: string;
  status: SchedulerInvoiceRefundStatus;
  currency: string;
  amountExGst: number;
  gstAmount: number;
  totalIncGst: number;
  refundedAt: string;
  reason: string;
  externalReference: string | null;
  createdByUserId: string;
  createdByDisplayName: string | null;
  voidedByUserId: string | null;
  voidedByDisplayName: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostSchedulerInvoiceRefundInput = {
  idempotencyKey: string;
  expectedUpdatedAt: string;
  amountExGst: number;
  gstAmount: number;
  refundedAt?: string | null;
  reason: string;
  externalReference?: string | null;
};

export type VoidSchedulerInvoiceRefundInput = {
  expectedUpdatedAt: string;
  reason: string;
};

export type SchedulerRefundAmountsCents = {
  amountExGstCents: number;
  gstAmountCents: number;
  totalIncGstCents: number;
};

export type NormalizedSchedulerInvoiceRefundInput = SchedulerRefundAmountsCents & {
  idempotencyKey: string;
  expectedUpdatedAt: Date;
  refundedAt: Date;
  refundedAtWasProvided: boolean;
  reason: string;
  externalReference: string | null;
};

type RefundRow = typeof schedulerInvoiceRefunds.$inferSelect;
type InvoiceRow = typeof schedulerInvoices.$inferSelect;
type RefundActor = {
  globalUserId: string;
  displayName: string | null;
};

function requireBoundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw badRequest(`${field} must be at most ${maximum} characters`);
  }
  return normalized;
}

function optionalBoundedText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw badRequest(`${field} must be at most ${maximum} characters`);
  }
  return normalized;
}

function parseRequiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${field} must be a valid ISO datetime`);
  }
  return parsed;
}

/** Converts API money values to the integer-cent accounting boundary. */
export function schedulerRefundMoneyToCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest(`${field} must be a nonnegative number`);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) throw badRequest(`${field} is too large`);
  return cents;
}

function assertSafeNonnegativeCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw conflict(`${field} exceeds the supported accounting range`);
  }
}

function addSafeCents(left: number, right: number, field: string): number {
  assertSafeNonnegativeCents(left, field);
  assertSafeNonnegativeCents(right, field);
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw conflict(`${field} exceeds the supported accounting range`);
  }
  return result;
}

export function normalizeSchedulerInvoiceRefundInput(
  input: PostSchedulerInvoiceRefundInput,
  now = new Date(),
): NormalizedSchedulerInvoiceRefundInput {
  const amountExGstCents = schedulerRefundMoneyToCents(
    input.amountExGst,
    'amountExGst',
  );
  const gstAmountCents = schedulerRefundMoneyToCents(input.gstAmount, 'gstAmount');
  const totalIncGstCents = addSafeCents(
    amountExGstCents,
    gstAmountCents,
    'Refund total',
  );
  if (totalIncGstCents <= 0) {
    throw badRequest('Refund total must be greater than zero');
  }
  const refundedAtWasProvided = input.refundedAt !== undefined && input.refundedAt !== null;
  const refundedAt = refundedAtWasProvided
    ? parseRequiredDate(input.refundedAt, 'refundedAt')
    : now;
  if (refundedAt.getTime() > now.getTime()) {
    throw badRequest('refundedAt cannot be in the future');
  }
  return {
    idempotencyKey: requireBoundedText(input.idempotencyKey, 'idempotencyKey', 200),
    expectedUpdatedAt: parseRequiredDate(input.expectedUpdatedAt, 'expectedUpdatedAt'),
    amountExGstCents,
    gstAmountCents,
    totalIncGstCents,
    refundedAt,
    refundedAtWasProvided,
    reason: requireBoundedText(input.reason, 'reason', 2_000),
    externalReference: optionalBoundedText(
      input.externalReference,
      'externalReference',
      200,
    ),
  };
}

/** Ensures posted refunds cannot exceed any component of the immutable invoice snapshot. */
export function assertSchedulerRefundCapacity(
  invoice: SchedulerRefundAmountsCents,
  postedRefunds: SchedulerRefundAmountsCents[],
  requested: SchedulerRefundAmountsCents,
): void {
  assertSafeNonnegativeCents(invoice.amountExGstCents, 'Invoice ex-GST total');
  assertSafeNonnegativeCents(invoice.gstAmountCents, 'Invoice GST total');
  assertSafeNonnegativeCents(invoice.totalIncGstCents, 'Invoice total');
  const posted = postedRefunds.reduce<SchedulerRefundAmountsCents>((aggregate, row) => ({
    amountExGstCents: addSafeCents(
      aggregate.amountExGstCents,
      row.amountExGstCents,
      'Posted refund ex-GST total',
    ),
    gstAmountCents: addSafeCents(
      aggregate.gstAmountCents,
      row.gstAmountCents,
      'Posted refund GST total',
    ),
    totalIncGstCents: addSafeCents(
      aggregate.totalIncGstCents,
      row.totalIncGstCents,
      'Posted refund total',
    ),
  }), { amountExGstCents: 0, gstAmountCents: 0, totalIncGstCents: 0 });
  const next = {
    amountExGstCents: addSafeCents(
      posted.amountExGstCents,
      requested.amountExGstCents,
      'Refund ex-GST total',
    ),
    gstAmountCents: addSafeCents(
      posted.gstAmountCents,
      requested.gstAmountCents,
      'Refund GST total',
    ),
    totalIncGstCents: addSafeCents(
      posted.totalIncGstCents,
      requested.totalIncGstCents,
      'Refund total',
    ),
  };
  if (
    next.amountExGstCents > invoice.amountExGstCents
    || next.gstAmountCents > invoice.gstAmountCents
    || next.totalIncGstCents > invoice.totalIncGstCents
  ) {
    throw conflict('Refund exceeds the remaining invoice balance');
  }
}

/** Keeps every partial refund on the invoice's snapshotted GST basis. */
export function assertSchedulerRefundGstComposition(
  invoice: SchedulerRefundAmountsCents & { gstRateBps: number },
  postedRefunds: SchedulerRefundAmountsCents[],
  requested: SchedulerRefundAmountsCents,
): void {
  if (!Number.isInteger(invoice.gstRateBps)
    || invoice.gstRateBps < 0
    || invoice.gstRateBps > 10_000) {
    throw conflict('Invoice GST rate is outside the supported range');
  }
  const posted = postedRefunds.reduce((aggregate, row) => ({
    amountExGstCents: addSafeCents(
      aggregate.amountExGstCents,
      row.amountExGstCents,
      'Posted refund ex-GST total',
    ),
    gstAmountCents: addSafeCents(
      aggregate.gstAmountCents,
      row.gstAmountCents,
      'Posted refund GST total',
    ),
    totalIncGstCents: addSafeCents(
      aggregate.totalIncGstCents,
      row.totalIncGstCents,
      'Posted refund total',
    ),
  }), { amountExGstCents: 0, gstAmountCents: 0, totalIncGstCents: 0 });
  const remainingExGstCents = invoice.amountExGstCents - posted.amountExGstCents;
  const remainingGstCents = invoice.gstAmountCents - posted.gstAmountCents;
  if (remainingExGstCents < 0 || remainingGstCents < 0) {
    throw conflict('Posted refunds exceed the invoice components');
  }
  if (requested.amountExGstCents <= 0) {
    throw badRequest('Refund amountExGst must be greater than zero');
  }
  const expectedGstCents = requested.amountExGstCents === remainingExGstCents
    ? remainingGstCents
    : Number((
        BigInt(requested.amountExGstCents) * BigInt(invoice.gstRateBps) + 5_000n
      ) / 10_000n);
  if (requested.gstAmountCents !== expectedGstCents) {
    throw badRequest('Refund GST must match the invoice GST rate and remaining balance');
  }
}

/** A replay is exact when every client-controlled persisted value is unchanged. */
export function schedulerRefundRequestMatches(
  row: Pick<
    RefundRow,
    | 'amountExGstCents'
    | 'gstAmountCents'
    | 'totalIncGstCents'
    | 'refundedAt'
    | 'reason'
    | 'externalReference'
  >,
  input: NormalizedSchedulerInvoiceRefundInput,
): boolean {
  return row.amountExGstCents === input.amountExGstCents
    && row.gstAmountCents === input.gstAmountCents
    && row.totalIncGstCents === input.totalIncGstCents
    && (!input.refundedAtWasProvided || row.refundedAt.getTime() === input.refundedAt.getTime())
    && row.reason === input.reason
    && row.externalReference === input.externalReference;
}

export function nextSchedulerRefundRevision(current: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), current.getTime() + 1));
}

/**
 * Treats a retry of the same terminal void intent as a successful replay.
 * A different reason is a different audit event and must never be silently
 * accepted after the original void has committed.
 */
export function isSchedulerRefundVoidReplay(
  refund: Pick<RefundRow, 'status' | 'voidReason'>,
  reason: string,
): boolean {
  if (refund.status !== 'voided') return false;
  if (refund.voidReason !== reason) {
    throw conflict('Refund was already voided with a different reason');
  }
  return true;
}

export function schedulerInvoiceRefundDto(row: RefundRow): SchedulerInvoiceRefundDto {
  if (row.status !== 'posted' && row.status !== 'voided') {
    throw conflict('Refund has an unsupported status');
  }
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    currency: row.currency,
    amountExGst: row.amountExGstCents / 100,
    gstAmount: row.gstAmountCents / 100,
    totalIncGst: row.totalIncGstCents / 100,
    refundedAt: row.refundedAt.toISOString(),
    reason: row.reason,
    externalReference: row.externalReference,
    createdByUserId: row.createdByGlobalUserId,
    createdByDisplayName: row.createdByDisplayName,
    voidedByUserId: row.voidedByGlobalUserId,
    voidedByDisplayName: row.voidedByDisplayName,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireGlobalRefundAdmin(user: AuthUser): Promise<RefundActor> {
  if (user.role !== 'admin' || !['ecoaudit', 'solarsense', 'installhub'].includes(user.app)) {
    throw forbidden('Only global administrators can access scheduler finances');
  }
  const [actor] = await db.select({
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
  if (!actor) {
    throw forbidden('Only active global administrators can access scheduler finances');
  }
  return {
    globalUserId: actor.globalUserId,
    displayName: actor.fullName?.trim() || actor.displayEmail,
  };
}

function assertInvoiceRevision(invoice: InvoiceRow, expectedUpdatedAt: Date): void {
  if (invoice.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw conflict('Invoice changed; refresh before continuing');
  }
}

function assertRefundRevision(refund: RefundRow, expectedUpdatedAt: Date): void {
  if (refund.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw conflict('Refund changed; refresh before continuing');
  }
}

export async function listSchedulerInvoiceRefunds(
  user: AuthUser,
  invoiceId: string,
): Promise<SchedulerInvoiceRefundDto[]> {
  await requireGlobalRefundAdmin(user);
  await assertSchedulerInvoiceVisible(invoiceId);
  const rows = await db.select().from(schedulerInvoiceRefunds)
    .where(eq(schedulerInvoiceRefunds.invoiceId, invoiceId))
    .orderBy(
      desc(schedulerInvoiceRefunds.refundedAt),
      desc(schedulerInvoiceRefunds.createdAt),
      desc(schedulerInvoiceRefunds.id),
    );
  return rows.map(schedulerInvoiceRefundDto);
}

export async function postSchedulerInvoiceRefund(
  user: AuthUser,
  invoiceId: string,
  input: PostSchedulerInvoiceRefundInput,
): Promise<SchedulerInvoiceRefundDto> {
  const actor = await requireGlobalRefundAdmin(user);
  const now = new Date();
  const normalized = normalizeSchedulerInvoiceRefundInput(input, now);
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId))
      .for('update')
      .limit(1);
    if (!invoice) throw notFound('Invoice');
    await assertSchedulerInvoiceVisible(invoice.id, tx);

    const [existing] = await tx.select().from(schedulerInvoiceRefunds).where(and(
      eq(schedulerInvoiceRefunds.invoiceId, invoice.id),
      eq(schedulerInvoiceRefunds.idempotencyKey, normalized.idempotencyKey),
    )).limit(1);
    if (existing) {
      if (!schedulerRefundRequestMatches(existing, normalized)) {
        throw conflict('idempotencyKey was already used for a different refund request');
      }
      return schedulerInvoiceRefundDto(existing);
    }

    assertInvoiceRevision(invoice, normalized.expectedUpdatedAt);
    if (invoice.status !== 'issued' && invoice.status !== 'paid') {
      throw conflict('Only issued or paid invoices can be refunded');
    }
    const issuedBoundary = invoice.issuedAt ?? invoice.issueDate;
    if (issuedBoundary && normalized.refundedAt.getTime() < issuedBoundary.getTime()) {
      throw badRequest('refundedAt cannot be before the invoice was issued');
    }

    const postedRefunds = await tx.select({
      amountExGstCents: schedulerInvoiceRefunds.amountExGstCents,
      gstAmountCents: schedulerInvoiceRefunds.gstAmountCents,
      totalIncGstCents: schedulerInvoiceRefunds.totalIncGstCents,
    }).from(schedulerInvoiceRefunds).where(and(
      eq(schedulerInvoiceRefunds.invoiceId, invoice.id),
      eq(schedulerInvoiceRefunds.status, 'posted'),
    ));
    assertSchedulerRefundGstComposition({
      amountExGstCents: invoice.subtotalExGstCents,
      gstAmountCents: invoice.gstAmountCents,
      totalIncGstCents: invoice.totalIncGstCents,
      gstRateBps: invoice.gstRateBps,
    }, postedRefunds, normalized);
    assertSchedulerRefundCapacity({
      amountExGstCents: invoice.subtotalExGstCents,
      gstAmountCents: invoice.gstAmountCents,
      totalIncGstCents: invoice.totalIncGstCents,
    }, postedRefunds, normalized);

    const [created] = await tx.insert(schedulerInvoiceRefunds).values({
      id: randomUUID(),
      invoiceId: invoice.id,
      idempotencyKey: normalized.idempotencyKey,
      status: 'posted',
      currency: invoice.currency,
      amountExGstCents: normalized.amountExGstCents,
      gstAmountCents: normalized.gstAmountCents,
      totalIncGstCents: normalized.totalIncGstCents,
      refundedAt: normalized.refundedAt,
      reason: normalized.reason,
      externalReference: normalized.externalReference,
      createdByGlobalUserId: actor.globalUserId,
      createdByDisplayName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new Error('scheduler_refund_insert_failed');

    const invoiceUpdatedAt = nextSchedulerRefundRevision(invoice.updatedAt, now);
    const updatedInvoices = await tx.update(schedulerInvoices).set({
      updatedAt: invoiceUpdatedAt,
    }).where(and(
      eq(schedulerInvoices.id, invoice.id),
      eq(schedulerInvoices.updatedAt, invoice.updatedAt),
    )).returning({ id: schedulerInvoices.id });
    if (updatedInvoices.length !== 1) {
      throw conflict('Invoice changed; refresh before continuing');
    }
    return schedulerInvoiceRefundDto(created);
  });
}

export async function voidSchedulerInvoiceRefund(
  user: AuthUser,
  invoiceId: string,
  refundId: string,
  input: VoidSchedulerInvoiceRefundInput,
): Promise<SchedulerInvoiceRefundDto> {
  const actor = await requireGlobalRefundAdmin(user);
  const expectedUpdatedAt = parseRequiredDate(input.expectedUpdatedAt, 'expectedUpdatedAt');
  const reason = requireBoundedText(input.reason, 'reason', 2_000);
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoiceId))
      .for('update')
      .limit(1);
    if (!invoice) throw notFound('Invoice');
    await assertSchedulerInvoiceVisible(invoice.id, tx);
    const [refund] = await tx.select().from(schedulerInvoiceRefunds).where(and(
      eq(schedulerInvoiceRefunds.id, refundId),
      eq(schedulerInvoiceRefunds.invoiceId, invoice.id),
    )).for('update').limit(1);
    if (!refund) throw notFound('Refund');
    if (isSchedulerRefundVoidReplay(refund, reason)) {
      return schedulerInvoiceRefundDto(refund);
    }
    assertRefundRevision(refund, expectedUpdatedAt);
    if (refund.status !== 'posted') throw conflict('Only posted refunds can be voided');

    const now = new Date();
    const updatedAt = nextSchedulerRefundRevision(refund.updatedAt, now);
    const [updated] = await tx.update(schedulerInvoiceRefunds).set({
      status: 'voided',
      voidedByGlobalUserId: actor.globalUserId,
      voidedByDisplayName: actor.displayName,
      voidReason: reason,
      voidedAt: now,
      updatedAt,
    }).where(and(
      eq(schedulerInvoiceRefunds.id, refund.id),
      eq(schedulerInvoiceRefunds.status, 'posted'),
      eq(schedulerInvoiceRefunds.updatedAt, refund.updatedAt),
    )).returning();
    if (!updated) throw conflict('Refund changed; refresh before continuing');
    return schedulerInvoiceRefundDto(updated);
  });
}
