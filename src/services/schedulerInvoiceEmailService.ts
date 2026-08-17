import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import {
  globalUsers,
  pdfJobs,
  schedulerInvoiceEmailDeliveries,
  schedulerInvoices,
  unifiedUsers,
} from '../db/schema/shared.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import {
  assertGlobalFinanceAdmin,
  getConsolidatedSchedulerInvoice,
  type SchedulerInvoiceDto,
} from './schedulerFinanceService.js';
import {
  queueSchedulerInvoicePdfByInvoiceId,
  schedulerInvoicePdfJobParams,
  type QueuedSchedulerInvoicePdfExport,
} from './schedulerInvoicePdfExport.js';

export type SchedulerInvoiceEmailStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'delivery_unknown';

export type SchedulerInvoiceEmailDeliveryDto = {
  id: string;
  invoiceId: string;
  pdfJobId: string;
  sourceUpdatedAt: string;
  attachmentFilename: string;
  recipient: string;
  subject: string;
  message: string;
  status: SchedulerInvoiceEmailStatus;
  attempts: number;
  maxAttempts: number;
  provider: 'gmail_api';
  providerMessageId: string | null;
  lastErrorCode: string | null;
  requestedByGlobalUserId: string;
  requestedByDisplayName: string | null;
  requestedByApp: 'ecoaudit' | 'solarsense' | 'installhub';
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QueueSchedulerInvoiceEmailInput = {
  expectedUpdatedAt: string;
  idempotencyKey: string;
  to?: string;
  subject?: string;
  message?: string;
};

export type SchedulerInvoiceEmailQueueDependencies = {
  queuePdf: (
    user: AuthUser,
    invoiceId: string,
    expectedUpdatedAt: string,
  ) => Promise<QueuedSchedulerInvoicePdfExport>;
};

const defaultQueueDependencies: SchedulerInvoiceEmailQueueDependencies = {
  queuePdf: queueSchedulerInvoicePdfByInvoiceId,
};

type DeliveryRow = typeof schedulerInvoiceEmailDeliveries.$inferSelect;

type NormalizedEmailRequest = {
  expectedUpdatedAt: string;
  idempotencyKey: string;
  recipient: string;
  subject: string;
  message: string;
};

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw badRequest(`${field} is required`);
  if (normalized.length > maxLength) throw badRequest(`${field} is too long`);
  return normalized;
}

export function normalizeInvoiceRecipient(value: unknown): string {
  const recipient = requireText(value, 'to', 320);
  if (
    recipient.includes('\r')
    || recipient.includes('\n')
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(recipient)
  ) {
    throw badRequest('to must be a valid email address');
  }
  return recipient;
}

function normalizeSubject(value: unknown): string {
  const subject = requireText(value, 'subject', 500);
  if (subject.includes('\r') || subject.includes('\n')) {
    throw badRequest('subject must not contain line breaks');
  }
  return subject;
}

function normalizeMessage(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('message must be a string');
  const message = value.trim();
  if (message.length > 10_000) throw badRequest('message is too long');
  return message;
}

function normalizeExpectedUpdatedAt(value: unknown): string {
  const raw = requireText(value, 'expectedUpdatedAt', 100);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest('expectedUpdatedAt must be a valid ISO datetime');
  }
  return parsed.toISOString();
}

function defaultEmailSubject(invoice: SchedulerInvoiceDto): string {
  return `Invoice ${invoice.invoiceNumber} from ${invoice.sellerName}`;
}

function defaultEmailMessage(invoice: SchedulerInvoiceDto): string {
  return [
    `Hello ${invoice.billToName},`,
    '',
    `Please find invoice ${invoice.invoiceNumber} attached.`,
    '',
    `Regards,`,
    invoice.sellerName,
  ].join('\n');
}

function normalizeNewRequest(
  invoice: SchedulerInvoiceDto,
  input: QueueSchedulerInvoiceEmailInput,
): NormalizedEmailRequest {
  return {
    expectedUpdatedAt: normalizeExpectedUpdatedAt(input.expectedUpdatedAt),
    idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 200),
    recipient: normalizeInvoiceRecipient(input.to ?? invoice.billToEmail),
    subject: normalizeSubject(input.subject ?? defaultEmailSubject(invoice)),
    message: normalizeMessage(input.message ?? defaultEmailMessage(invoice)),
  };
}

export function schedulerInvoiceEmailRequestFingerprint(input: {
  expectedUpdatedAt: string;
  recipient: string;
  subject: string;
  message: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    expectedUpdatedAt: input.expectedUpdatedAt,
    recipient: input.recipient,
    subject: input.subject,
    message: input.message,
  })).digest('hex');
}

function deliveryDto(row: DeliveryRow): SchedulerInvoiceEmailDeliveryDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    pdfJobId: row.pdfJobId,
    sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
    attachmentFilename: row.attachmentFilename,
    recipient: row.recipient,
    subject: row.subject,
    message: row.message,
    status: row.status as SchedulerInvoiceEmailStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    provider: 'gmail_api',
    providerMessageId: row.providerMessageId,
    lastErrorCode: row.lastErrorCode,
    requestedByGlobalUserId: row.requestedByGlobalUserId,
    requestedByDisplayName: row.requestedByDisplayName,
    requestedByApp: row.requestedByApp as SchedulerInvoiceEmailDeliveryDto['requestedByApp'],
    sentAt: iso(row.sentAt),
    completedAt: iso(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function emailActor(user: AuthUser): Promise<{
  globalUserId: string;
  displayName: string | null;
}> {
  await assertGlobalFinanceAdmin(user);
  const [actor] = await db.select({
    globalUserId: globalUsers.id,
    displayEmail: globalUsers.displayEmail,
    fullName: globalUsers.fullName,
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
  if (!actor) throw new AppError(403, 'Forbidden', 'Only active global administrators can send invoices');
  return {
    globalUserId: actor.globalUserId,
    displayName: actor.fullName?.trim() || actor.displayEmail,
  };
}

function assertExistingReplay(
  existing: DeliveryRow,
  input: QueueSchedulerInvoiceEmailInput,
): void {
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(input.expectedUpdatedAt);
  if (existing.sourceUpdatedAt.toISOString() !== expectedUpdatedAt) {
    throw conflict('idempotencyKey was already used for another invoice email request');
  }
  if (input.to !== undefined && normalizeInvoiceRecipient(input.to) !== existing.recipient) {
    throw conflict('idempotencyKey was already used for another invoice email request');
  }
  if (input.subject !== undefined && normalizeSubject(input.subject) !== existing.subject) {
    throw conflict('idempotencyKey was already used for another invoice email request');
  }
  if (input.message !== undefined && normalizeMessage(input.message) !== existing.message) {
    throw conflict('idempotencyKey was already used for another invoice email request');
  }
}

function assertEmailRuntimeReady(): void {
  if (
    !config.schedulerInvoiceEmail.enabled
    || !config.schedulerInvoiceEmail.configured
    || config.schedulerInvoiceEmail.deliveryMethod !== 'gmail_api'
  ) {
    throw new AppError(
      503,
      'Service unavailable',
      'Invoice email is not configured for the API runtime',
    );
  }
}

async function existingDelivery(
  invoiceId: string,
  idempotencyKey: string,
): Promise<DeliveryRow | null> {
  const [row] = await db.select().from(schedulerInvoiceEmailDeliveries).where(and(
    eq(schedulerInvoiceEmailDeliveries.invoiceId, invoiceId),
    eq(schedulerInvoiceEmailDeliveries.idempotencyKey, idempotencyKey),
  )).limit(1);
  return row ?? null;
}

export async function queueSchedulerInvoiceEmail(
  user: AuthUser,
  invoiceIdInput: string,
  input: QueueSchedulerInvoiceEmailInput,
  dependencyOverrides: Partial<SchedulerInvoiceEmailQueueDependencies> = {},
): Promise<{ delivery: SchedulerInvoiceEmailDeliveryDto; reused: boolean }> {
  const dependencies = { ...defaultQueueDependencies, ...dependencyOverrides };
  const invoiceId = requireText(invoiceIdInput, 'invoiceId', 100);
  const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 200);
  const actor = await emailActor(user);

  const replay = await existingDelivery(invoiceId, idempotencyKey);
  if (replay) {
    assertExistingReplay(replay, input);
    return { delivery: deliveryDto(replay), reused: true };
  }

  assertEmailRuntimeReady();
  const invoice = await getConsolidatedSchedulerInvoice(user, invoiceId);
  if (invoice.status !== 'issued' && invoice.status !== 'paid') {
    throw conflict('Only issued or paid invoices can be emailed');
  }
  const normalized = normalizeNewRequest(invoice, input);
  if (normalized.expectedUpdatedAt !== invoice.updatedAt) {
    throw conflict('Invoice changed; refresh before sending email');
  }
  const requestFingerprint = schedulerInvoiceEmailRequestFingerprint(normalized);
  const pdfParams = schedulerInvoicePdfJobParams(invoice);
  const queuedPdf = await dependencies.queuePdf(
    user,
    invoice.id,
    normalized.expectedUpdatedAt,
  );

  const created = await db.transaction(async (tx) => {
    const [lockedInvoice] = await tx.select({
      id: schedulerInvoices.id,
      status: schedulerInvoices.status,
      updatedAt: schedulerInvoices.updatedAt,
    }).from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, invoice.id))
      .for('update')
      .limit(1);
    if (!lockedInvoice) throw notFound('Invoice');
    if (lockedInvoice.status !== 'issued' && lockedInvoice.status !== 'paid') {
      throw conflict('Only issued or paid invoices can be emailed');
    }
    if (lockedInvoice.updatedAt.toISOString() !== normalized.expectedUpdatedAt) {
      throw conflict('Invoice changed while its email was being queued. Refresh and try again.');
    }

    const [concurrentReplay] = await tx.select().from(schedulerInvoiceEmailDeliveries)
      .where(and(
        eq(schedulerInvoiceEmailDeliveries.invoiceId, invoice.id),
        eq(schedulerInvoiceEmailDeliveries.idempotencyKey, normalized.idempotencyKey),
      ))
      .limit(1);
    if (concurrentReplay) {
      if (concurrentReplay.requestFingerprint !== requestFingerprint) {
        throw conflict('idempotencyKey was already used for another invoice email request');
      }
      return { row: concurrentReplay, reused: true };
    }

    const [pdfJob] = await tx.select({
      id: pdfJobs.id,
      entityId: pdfJobs.entityId,
      entityType: pdfJobs.entityType,
      params: pdfJobs.params,
    }).from(pdfJobs).where(eq(pdfJobs.id, queuedPdf.jobId)).limit(1);
    const params = pdfJob?.params as Record<string, unknown> | undefined;
    if (
      !pdfJob
      || pdfJob.entityType !== 'scheduler_invoice'
      || pdfJob.entityId !== invoice.id
      || params?.sourceUpdatedAt !== normalized.expectedUpdatedAt
      || params?.reportVariantKey !== queuedPdf.reportVariantKey
    ) {
      throw conflict('Invoice PDF provenance could not be verified');
    }

    const now = new Date();
    const [row] = await tx.insert(schedulerInvoiceEmailDeliveries).values({
      id: randomUUID(),
      invoiceId: invoice.id,
      pdfJobId: queuedPdf.jobId,
      sourceUpdatedAt: new Date(normalized.expectedUpdatedAt),
      attachmentFilename: pdfParams.filename,
      idempotencyKey: normalized.idempotencyKey,
      requestFingerprint,
      recipient: normalized.recipient,
      subject: normalized.subject,
      message: normalized.message,
      requestedByGlobalUserId: actor.globalUserId,
      requestedByDisplayName: actor.displayName,
      requestedByApp: user.app,
      status: 'queued',
      attempts: 0,
      maxAttempts: config.schedulerInvoiceEmail.maxAttempts,
      availableAt: now,
      provider: 'gmail_api',
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!row) throw new Error('scheduler_invoice_email_queue_failed');
    return { row, reused: false };
  });

  return { delivery: deliveryDto(created.row), reused: created.reused };
}

export async function listSchedulerInvoiceEmailDeliveries(
  user: AuthUser,
  invoiceIdInput: string,
): Promise<SchedulerInvoiceEmailDeliveryDto[]> {
  const invoiceId = requireText(invoiceIdInput, 'invoiceId', 100);
  await assertGlobalFinanceAdmin(user);
  await getConsolidatedSchedulerInvoice(user, invoiceId);
  const rows = await db.select().from(schedulerInvoiceEmailDeliveries)
    .where(eq(schedulerInvoiceEmailDeliveries.invoiceId, invoiceId))
    .orderBy(desc(schedulerInvoiceEmailDeliveries.createdAt))
    .limit(100);
  return rows.map(deliveryDto);
}
