import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import {
  globalUsers,
  pdfJobs,
  schedulerInvoiceEmailDeliveries,
  schedulerInvoices,
  unifiedUsers,
} from '../db/schema/shared.js';
import { localFileSize, localFileStream } from '../storage/localFiles.js';
import { AppError } from '../utils/errors.js';
import { assertSchedulerInvoiceVisible } from './schedulerFinanceService.js';

type DeliveryRow = typeof schedulerInvoiceEmailDeliveries.$inferSelect;

export type ClaimedSchedulerInvoiceEmail = DeliveryRow & { claimToken: string };

export type PreparedInvoiceEmail = {
  accessToken: string;
};

export type SchedulerInvoiceEmailSubmission = {
  deliveryId: string;
  recipient: string;
  subject: string;
  message: string;
  attachmentFilename: string;
  attachment: Buffer;
};

export type SchedulerInvoiceEmailTransport = {
  prepare: () => Promise<PreparedInvoiceEmail>;
  submit: (
    prepared: PreparedInvoiceEmail,
    submission: SchedulerInvoiceEmailSubmission,
  ) => Promise<{ providerMessageId: string }>;
};

class SafeRetryableEmailError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'SafeRetryableEmailError';
  }
}

class TerminalEmailError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TerminalEmailError';
  }
}

class AmbiguousEmailError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AmbiguousEmailError';
  }
}

type FetchLike = typeof fetch;

function base64Lines(value: Buffer | string): string {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'))
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') ?? '';
}

function encodedHeaderWords(value: string): string[] {
  // RFC 2047 caps each encoded-word at 75 characters. A 45-byte UTF-8
  // payload produces at most 60 base64 characters, or 72 including the
  // encoded-word wrapper. Split on Unicode code-point boundaries so a
  // multi-byte character is never corrupted.
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (chunk && chunkBytes + characterBytes > 45) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return (chunks.length > 0 ? chunks : ['']).map((part) => (
    `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`
  ));
}

function foldedEncodedHeader(name: string, value: string, suffix?: string): string[] {
  const lines = [
    `${name}:`,
    ...encodedHeaderWords(value).map((word) => ` ${word}`),
  ];
  if (suffix) lines.push(` ${suffix}`);
  return lines;
}

function safeAsciiFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n"\\;/]/g, '-')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'invoice.pdf';
}

function encodedFilename(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
}

function senderDomain(senderEmail: string): string {
  return senderEmail.split('@')[1]?.replace(/[^a-z0-9.-]/gi, '') || 'sustainabilitywise.local';
}

/** Build one deterministic RFC 5322 message; the returned value is Gmail base64url raw. */
export function buildSchedulerInvoiceEmailRaw(
  submission: SchedulerInvoiceEmailSubmission,
  options: { fromEmail: string; fromName: string },
): string {
  const boundary = `sw-invoice-${submission.deliveryId.replace(/[^a-z0-9]/gi, '')}`;
  const asciiFilename = safeAsciiFilename(submission.attachmentFilename);
  const mime = [
    ...foldedEncodedHeader('From', options.fromName, `<${options.fromEmail}>`),
    `To: ${submission.recipient}`,
    ...foldedEncodedHeader('Subject', submission.subject),
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <scheduler-invoice-${submission.deliveryId}@${senderDomain(options.fromEmail)}>`,
    `X-Sustainability-Wise-Delivery-ID: ${submission.deliveryId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(submission.message),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${asciiFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename(submission.attachmentFilename)}`,
    '',
    base64Lines(submission.attachment),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.schedulerInvoiceEmail.requestTimeoutMs);
  timeout.unref();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function createGmailInvoiceEmailTransport(
  fetchImpl: FetchLike = fetch,
): SchedulerInvoiceEmailTransport {
  return {
    async prepare() {
      let response: Response;
      try {
        response = await fetchWithTimeout(fetchImpl, 'https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.schedulerInvoiceEmail.gmailClientId,
            client_secret: config.schedulerInvoiceEmail.gmailClientSecret,
            refresh_token: config.schedulerInvoiceEmail.gmailRefreshToken,
            grant_type: 'refresh_token',
          }),
        });
      } catch {
        // No Gmail message submission was attempted, so retry is safe.
        throw new SafeRetryableEmailError('gmail_oauth_unavailable');
      }
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new SafeRetryableEmailError('gmail_oauth_unavailable');
        }
        throw new TerminalEmailError('gmail_oauth_rejected');
      }
      const payload = await response.json().catch(() => null) as { access_token?: unknown } | null;
      if (typeof payload?.access_token !== 'string' || !payload.access_token) {
        throw new SafeRetryableEmailError('gmail_oauth_invalid_response');
      }
      return { accessToken: payload.access_token };
    },

    async submit(prepared, submission) {
      const raw = buildSchedulerInvoiceEmailRaw(submission, {
        fromEmail: config.schedulerInvoiceEmail.fromEmail,
        fromName: config.schedulerInvoice.sellerName.trim() || 'Sustainability Wise',
      });
      let response: Response;
      try {
        response = await fetchWithTimeout(
          fetchImpl,
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(config.schedulerInvoiceEmail.gmailUserId)}/messages/send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${prepared.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ raw }),
          },
        );
      } catch {
        // Gmail may have accepted the request before the connection failed.
        throw new AmbiguousEmailError('gmail_delivery_outcome_unknown');
      }
      if (!response.ok) {
        // A concrete 401/429 response means Gmail rejected this attempt before
        // accepting a message; clearing the submit marker and retrying is safe.
        if (response.status === 401 || response.status === 429) {
          throw new SafeRetryableEmailError(`gmail_send_rejected_${response.status}`);
        }
        if (response.status >= 500) {
          throw new AmbiguousEmailError('gmail_delivery_outcome_unknown');
        }
        throw new TerminalEmailError(`gmail_send_rejected_${response.status}`);
      }
      const payload = await response.json().catch(() => null) as { id?: unknown } | null;
      if (typeof payload?.id !== 'string' || !payload.id) {
        // 2xx means a message may exist; never resend solely because the
        // response body was malformed or truncated.
        throw new AmbiguousEmailError('gmail_delivery_outcome_unknown');
      }
      return { providerMessageId: payload.id };
    },
  };
}

function claimCondition(deliveryId: string, claimToken: string) {
  return and(
    eq(schedulerInvoiceEmailDeliveries.id, deliveryId),
    eq(schedulerInvoiceEmailDeliveries.status, 'processing'),
    eq(schedulerInvoiceEmailDeliveries.claimToken, claimToken),
  );
}

function retryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, attempts - 1)));
}

async function reconcileSchedulerInvoiceEmailClaims(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - config.schedulerInvoiceEmail.staleClaimMs);
  await db.transaction(async (tx) => {
    const stale = await tx.select().from(schedulerInvoiceEmailDeliveries).where(and(
      eq(schedulerInvoiceEmailDeliveries.status, 'processing'),
      lt(schedulerInvoiceEmailDeliveries.claimedAt, staleBefore),
    )).for('update', { skipLocked: true }).limit(100);
    for (const delivery of stale) {
      if (delivery.providerSubmissionStartedAt) {
        await tx.update(schedulerInvoiceEmailDeliveries).set({
          status: 'delivery_unknown',
          claimToken: null,
          claimedAt: null,
          lastErrorCode: 'worker_interrupted_after_submit_started',
          completedAt: now,
          updatedAt: now,
        }).where(eq(schedulerInvoiceEmailDeliveries.id, delivery.id));
        continue;
      }
      const exhausted = delivery.attempts >= delivery.maxAttempts;
      await tx.update(schedulerInvoiceEmailDeliveries).set({
        status: exhausted ? 'failed' : 'queued',
        claimToken: null,
        claimedAt: null,
        providerSubmissionStartedAt: null,
        availableAt: exhausted ? now : new Date(now.getTime() + retryDelayMs(delivery.attempts)),
        lastErrorCode: exhausted
          ? 'email_attempts_exhausted'
          : 'worker_interrupted_before_submit',
        completedAt: exhausted ? now : null,
        updatedAt: now,
      }).where(eq(schedulerInvoiceEmailDeliveries.id, delivery.id));
    }

    const unavailable = await tx.select({
      id: schedulerInvoiceEmailDeliveries.id,
      pdfStatus: pdfJobs.status,
    }).from(schedulerInvoiceEmailDeliveries)
      .innerJoin(pdfJobs, eq(pdfJobs.id, schedulerInvoiceEmailDeliveries.pdfJobId))
      .where(and(
        eq(schedulerInvoiceEmailDeliveries.status, 'queued'),
        eq(pdfJobs.status, 'failed'),
      ))
      .for('update', { skipLocked: true })
      .limit(100);
    if (unavailable.length > 0) {
      await tx.update(schedulerInvoiceEmailDeliveries).set({
        status: 'failed',
        claimToken: null,
        claimedAt: null,
        lastErrorCode: 'invoice_pdf_failed',
        completedAt: now,
        updatedAt: now,
      }).where(inArray(
        schedulerInvoiceEmailDeliveries.id,
        unavailable.map((row) => row.id),
      ));
    }

    await tx.update(schedulerInvoiceEmailDeliveries).set({
      status: 'failed',
      claimToken: null,
      claimedAt: null,
      lastErrorCode: 'email_attempts_exhausted',
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(schedulerInvoiceEmailDeliveries.status, 'queued'),
      sql`${schedulerInvoiceEmailDeliveries.attempts} >= ${schedulerInvoiceEmailDeliveries.maxAttempts}`,
    ));
  });
}

export async function claimDueSchedulerInvoiceEmails(
  now = new Date(),
  limit = 1,
): Promise<ClaimedSchedulerInvoiceEmail[]> {
  await reconcileSchedulerInvoiceEmailClaims(now);
  const batchSize = Math.min(20, Math.max(1, limit));
  return db.transaction(async (tx) => {
    const candidates = await tx.select({ id: schedulerInvoiceEmailDeliveries.id })
      .from(schedulerInvoiceEmailDeliveries)
      .where(and(
        eq(schedulerInvoiceEmailDeliveries.status, 'queued'),
        lte(schedulerInvoiceEmailDeliveries.availableAt, now),
        sql`${schedulerInvoiceEmailDeliveries.attempts} < ${schedulerInvoiceEmailDeliveries.maxAttempts}`,
        sql`EXISTS (
          SELECT 1 FROM pdf_jobs email_pdf
          WHERE email_pdf.id = ${schedulerInvoiceEmailDeliveries.pdfJobId}
            AND email_pdf.status = 'complete'
            AND email_pdf.storage_key IS NOT NULL
        )`,
      ))
      .orderBy(
        asc(schedulerInvoiceEmailDeliveries.availableAt),
        asc(schedulerInvoiceEmailDeliveries.createdAt),
      )
      .for('update', { skipLocked: true })
      .limit(batchSize);
    if (candidates.length === 0) return [];
    const claimToken = randomUUID();
    const rows = await tx.update(schedulerInvoiceEmailDeliveries).set({
      status: 'processing',
      claimToken,
      claimedAt: now,
      providerSubmissionStartedAt: null,
      attempts: sql`${schedulerInvoiceEmailDeliveries.attempts} + 1`,
      lastErrorCode: null,
      updatedAt: now,
    }).where(inArray(
      schedulerInvoiceEmailDeliveries.id,
      candidates.map((candidate) => candidate.id),
    )).returning();
    return rows.map((row) => ({ ...row, claimToken }));
  });
}

async function loadAttachment(delivery: ClaimedSchedulerInvoiceEmail): Promise<Buffer> {
  try {
    await assertSchedulerInvoiceVisible(delivery.invoiceId);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      throw new TerminalEmailError('invoice_hidden_by_scheduler_policy');
    }
    throw error;
  }
  const [snapshot] = await db.select({
    invoiceStatus: schedulerInvoices.status,
    requesterActive: globalUsers.isActive,
    requesterRole: globalUsers.role,
    requesterMembershipActive: sql<boolean>`EXISTS (
      SELECT 1 FROM ${unifiedUsers} requester_membership
      WHERE requester_membership.global_user_id = ${schedulerInvoiceEmailDeliveries.requestedByGlobalUserId}
        AND requester_membership.origin_app = ${schedulerInvoiceEmailDeliveries.requestedByApp}
        AND requester_membership.origin_user_id = ${pdfJobs.userId}
        AND requester_membership.is_active = true
        AND requester_membership.deleted_at IS NULL
    )`,
    pdfApp: pdfJobs.app,
    pdfEntityId: pdfJobs.entityId,
    pdfEntityType: pdfJobs.entityType,
    pdfParams: pdfJobs.params,
    pdfStatus: pdfJobs.status,
    storageKey: pdfJobs.storageKey,
  }).from(schedulerInvoiceEmailDeliveries)
    .innerJoin(schedulerInvoices, eq(schedulerInvoices.id, schedulerInvoiceEmailDeliveries.invoiceId))
    .innerJoin(globalUsers, eq(globalUsers.id, schedulerInvoiceEmailDeliveries.requestedByGlobalUserId))
    .innerJoin(pdfJobs, eq(pdfJobs.id, schedulerInvoiceEmailDeliveries.pdfJobId))
    .where(claimCondition(delivery.id, delivery.claimToken))
    .limit(1);
  if (!snapshot) throw new TerminalEmailError('email_delivery_claim_lost');
  if (snapshot.invoiceStatus !== 'issued' && snapshot.invoiceStatus !== 'paid') {
    throw new TerminalEmailError('invoice_no_longer_sendable');
  }
  if (
    !snapshot.requesterActive
    || snapshot.requesterRole !== 'admin'
    || !snapshot.requesterMembershipActive
  ) {
    throw new TerminalEmailError('requesting_admin_no_longer_active');
  }
  const params = snapshot.pdfParams as Record<string, unknown>;
  if (
    snapshot.pdfStatus !== 'complete'
    || !snapshot.storageKey
    || snapshot.pdfApp !== delivery.requestedByApp
    || snapshot.pdfEntityType !== 'scheduler_invoice'
    || snapshot.pdfEntityId !== delivery.invoiceId
    || params.sourceUpdatedAt !== delivery.sourceUpdatedAt.toISOString()
    || params.filename !== delivery.attachmentFilename
    || params.contentType !== 'application/pdf'
  ) {
    throw new TerminalEmailError('invoice_pdf_provenance_invalid');
  }

  const expectedSize = await localFileSize(snapshot.storageKey);
  if (expectedSize > config.schedulerInvoiceEmail.maxAttachmentBytes) {
    throw new TerminalEmailError('invoice_pdf_too_large_for_email');
  }
  const stream = await localFileStream(snapshot.storageKey);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > config.schedulerInvoiceEmail.maxAttachmentBytes) {
      stream.destroy();
      throw new TerminalEmailError('invoice_pdf_too_large_for_email');
    }
    chunks.push(buffer);
  }
  if (size !== expectedSize) throw new SafeRetryableEmailError('invoice_pdf_read_incomplete');
  return Buffer.concat(chunks, size);
}

async function markProviderSubmissionStarted(
  delivery: ClaimedSchedulerInvoiceEmail,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize the send boundary with invoice lifecycle changes. Migration
    // 0035's void fence covers the opposite ordering after this transaction
    // publishes the provider marker, including rolling old API writers.
    const [invoice] = await tx.select({ status: schedulerInvoices.status })
      .from(schedulerInvoices)
      .where(eq(schedulerInvoices.id, delivery.invoiceId))
      .for('update')
      .limit(1);
    if (!invoice || (invoice.status !== 'issued' && invoice.status !== 'paid')) {
      throw new TerminalEmailError('invoice_no_longer_sendable');
    }

    const [pdfOwner] = await tx.select({ userId: pdfJobs.userId })
      .from(pdfJobs)
      .where(eq(pdfJobs.id, delivery.pdfJobId))
      .limit(1);
    if (!pdfOwner) throw new TerminalEmailError('invoice_pdf_provenance_invalid');

    // Lock both authorization rows in the canonical global -> membership
    // order used by identity mutations. A revocation that committed before
    // this boundary is observed; one racing behind it cannot interleave with
    // publication of the provider marker.
    const [requester] = await tx.select({
      isActive: globalUsers.isActive,
      role: globalUsers.role,
    }).from(globalUsers)
      .where(eq(globalUsers.id, delivery.requestedByGlobalUserId))
      .for('update')
      .limit(1);
    const [membership] = await tx.select({
      isActive: unifiedUsers.isActive,
      deletedAt: unifiedUsers.deletedAt,
    }).from(unifiedUsers)
      .where(and(
        eq(unifiedUsers.globalUserId, delivery.requestedByGlobalUserId),
        eq(unifiedUsers.originApp, delivery.requestedByApp),
        eq(unifiedUsers.originUserId, pdfOwner.userId),
      ))
      .for('update')
      .limit(1);
    if (
      !requester?.isActive
      || requester.role !== 'admin'
      || !membership?.isActive
      || membership.deletedAt
    ) {
      throw new TerminalEmailError('requesting_admin_no_longer_active');
    }

    const now = new Date();
    const [updated] = await tx.update(schedulerInvoiceEmailDeliveries).set({
      providerSubmissionStartedAt: now,
      // Renew the lease at the ambiguity boundary. Attachment IO and OAuth may
      // have consumed much of the original claim, while Gmail still needs the
      // full provider-request window without another pod recovering this row.
      claimedAt: now,
      updatedAt: now,
    }).where(claimCondition(delivery.id, delivery.claimToken)).returning({
      id: schedulerInvoiceEmailDeliveries.id,
    });
    if (!updated) throw new TerminalEmailError('email_delivery_claim_lost');
  });
}

async function markSent(
  delivery: ClaimedSchedulerInvoiceEmail,
  providerMessageId: string,
): Promise<void> {
  const now = new Date();
  const [updated] = await db.update(schedulerInvoiceEmailDeliveries).set({
    status: 'sent',
    claimToken: null,
    claimedAt: null,
    providerMessageId,
    lastErrorCode: null,
    sentAt: now,
    completedAt: now,
    updatedAt: now,
  }).where(claimCondition(delivery.id, delivery.claimToken)).returning({
    id: schedulerInvoiceEmailDeliveries.id,
  });
  if (!updated) throw new AmbiguousEmailError('gmail_delivery_outcome_unknown');
}

async function markTerminal(
  delivery: ClaimedSchedulerInvoiceEmail,
  status: 'failed' | 'delivery_unknown',
  errorCode: string,
): Promise<void> {
  const now = new Date();
  await db.update(schedulerInvoiceEmailDeliveries).set({
    status,
    claimToken: null,
    claimedAt: null,
    lastErrorCode: errorCode,
    completedAt: now,
    updatedAt: now,
  }).where(claimCondition(delivery.id, delivery.claimToken));
}

async function requeueSafely(
  delivery: ClaimedSchedulerInvoiceEmail,
  errorCode: string,
): Promise<void> {
  const now = new Date();
  const exhausted = delivery.attempts >= delivery.maxAttempts;
  await db.update(schedulerInvoiceEmailDeliveries).set({
    status: exhausted ? 'failed' : 'queued',
    claimToken: null,
    claimedAt: null,
    providerSubmissionStartedAt: null,
    availableAt: exhausted ? now : new Date(now.getTime() + retryDelayMs(delivery.attempts)),
    lastErrorCode: exhausted ? 'email_attempts_exhausted' : errorCode,
    completedAt: exhausted ? now : null,
    updatedAt: now,
  }).where(claimCondition(delivery.id, delivery.claimToken));
}

export async function processClaimedSchedulerInvoiceEmail(
  delivery: ClaimedSchedulerInvoiceEmail,
  transport: SchedulerInvoiceEmailTransport = createGmailInvoiceEmailTransport(),
): Promise<void> {
  let submissionStarted = false;
  try {
    const attachment = await loadAttachment(delivery);
    const prepared = await transport.prepare();
    await markProviderSubmissionStarted(delivery);
    submissionStarted = true;
    const result = await transport.submit(prepared, {
      deliveryId: delivery.id,
      recipient: delivery.recipient,
      subject: delivery.subject,
      message: delivery.message,
      attachmentFilename: delivery.attachmentFilename,
      attachment,
    });
    await markSent(delivery, result.providerMessageId);
  } catch (error) {
    if (error instanceof SafeRetryableEmailError) {
      await requeueSafely(delivery, error.code);
      return;
    }
    if (error instanceof TerminalEmailError) {
      await markTerminal(delivery, 'failed', error.code);
      return;
    }
    const errorCode = error instanceof AmbiguousEmailError
      ? error.code
      : submissionStarted
        ? 'gmail_delivery_outcome_unknown'
        : 'invoice_email_preparation_failed';
    if (submissionStarted) {
      await markTerminal(delivery, 'delivery_unknown', errorCode);
    } else {
      await requeueSafely(delivery, errorCode);
    }
  }
}

export async function drainSchedulerInvoiceEmails(
  transport: SchedulerInvoiceEmailTransport = createGmailInvoiceEmailTransport(),
  shouldContinue: () => boolean = () => true,
): Promise<number> {
  let processed = 0;
  for (let index = 0; index < config.schedulerInvoiceEmail.claimBatchSize; index += 1) {
    if (!shouldContinue()) break;
    // A transport call can consume most of the claim lease. Stamp every new
    // claim at its actual claim time so later items in a sequential batch are
    // not immediately considered stale by another worker.
    const [delivery] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
    if (!delivery) break;
    await processClaimedSchedulerInvoiceEmail(delivery, transport);
    processed += 1;
  }
  return processed;
}

export type SchedulerInvoiceEmailWorker = {
  stop: () => Promise<void>;
};

export function startSchedulerInvoiceEmailWorker(
  transport: SchedulerInvoiceEmailTransport = createGmailInvoiceEmailTransport(),
): SchedulerInvoiceEmailWorker {
  if (!config.schedulerInvoiceEmail.enabled || !config.schedulerInvoiceEmail.configured) {
    return { stop: async () => {} };
  }
  let timer: NodeJS.Timeout | null = null;
  let active: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || active) return;
    active = drainSchedulerInvoiceEmails(transport, () => !stopped)
      .then(() => undefined)
      .catch(() => {
        // Secrets, recipients, provider payloads, and message bodies never go
        // to logs. Operators inspect the normalized durable delivery code.
        console.error('[invoice-email] worker tick failed');
      })
      .finally(() => { active = null; });
  };
  tick();
  timer = setInterval(tick, config.schedulerInvoiceEmail.pollIntervalMs);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (active) await active;
    },
  };
}
