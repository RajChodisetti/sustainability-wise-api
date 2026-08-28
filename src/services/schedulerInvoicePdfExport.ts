import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  pdfJobs,
  schedulerInvoices,
  storageDeletionTasks,
} from '../db/schema/shared.js';
import {
  publicFileUrl,
  sanitizeStorageSegment,
  type StorageApp,
  writeLocalFile,
} from '../storage/localFiles.js';
import { mirrorInvoicePdfToOneDrive } from '../onedrive/photoBackup.js';
import { AppError, conflict, forbidden, notFound } from '../utils/errors.js';
import { buildInvoiceDownloadFilename } from './invoicePdf.js';
import { enqueueExportTask } from './exportJobQueue.js';
import {
  completeJob,
  EXPORT_JOB_INTERRUPTION_LEASE_MS,
  type ExportJobParams,
} from './pdfJobService.js';
import {
  assertSchedulerInvoicePdfStartReady,
  getSchedulerInvoice,
  getSchedulerInvoiceByFinanceId,
  getConsolidatedSchedulerInvoice,
  assertSchedulerInvoiceJobsCompleted,
  loadSchedulerInvoiceExportSnapshot,
  renderSchedulerInvoicePdf,
  withSchedulerInvoiceExportRevisionLock,
  type SchedulerFinanceExecutor,
  type SchedulerInvoiceDto,
} from './schedulerFinanceService.js';
import {
  drainStorageDeletionTasks,
  SCHEDULER_INVOICE_PDF_UNATTACHED_REASON,
} from './storageDeletionService.js';

export const SCHEDULER_INVOICE_PDF_RENDERER_VERSION = 'scheduler-invoice-pdf:v3';

export type SchedulerInvoicePdfJobParams = ExportJobParams & {
  invoiceId: string;
  financeId: string;
  sourceUpdatedAt: string;
  reportVariantKey: string;
  rendererVersion: typeof SCHEDULER_INVOICE_PDF_RENDERER_VERSION;
  invoiceVersion: number;
};

export type QueuedSchedulerInvoicePdfExport = {
  jobId: string;
  reused: boolean;
  sourceUpdatedAt: string;
  reportVariantKey: string;
  invoiceVersion?: number;
};

export type ClaimedSchedulerInvoicePdfJob = {
  id: string;
  claimToken: string;
  app: string;
  entityId: string;
  userId: string;
  params: Record<string, unknown>;
};

export type SchedulerInvoicePdfWorker = {
  wake: () => void;
  stop: () => Promise<void>;
};

export type SchedulerInvoicePdfWorkerDependencies = {
  claimNext: () => Promise<ClaimedSchedulerInvoicePdfJob | null>;
  execute: (job: ClaimedSchedulerInvoicePdfJob) => Promise<void>;
  logCycleError: (error: unknown) => void;
};

const SCHEDULER_INVOICE_PDF_POLL_INTERVAL_MS = 5_000;
export const SCHEDULER_INVOICE_PDF_CLAIM_LEASE_MS = 2 * 60 * 1_000;
export const SCHEDULER_INVOICE_PDF_CLAIM_HEARTBEAT_MS = 30 * 1_000;
export const SCHEDULER_INVOICE_PDF_DURABLE_QUEUE_MARKER = 'scheduler_invoice_pdf:durable:v1';
let activeSchedulerInvoicePdfWorkerWake: (() => void) | null = null;

function requireStorageApp(app: AuthUser['app']): StorageApp {
  if (app === 'ecoaudit' || app === 'solarsense' || app === 'installhub') return app;
  throw forbidden('Scheduler invoice exports are unavailable for this application');
}

export function schedulerInvoicePdfReportVariantKey(
  invoice: Pick<SchedulerInvoiceDto, 'id' | 'updatedAt'>,
): string {
  const invoiceId = invoice.id.trim();
  const sourceUpdatedAt = invoice.updatedAt.trim();
  if (!invoiceId || !sourceUpdatedAt) {
    throw new TypeError('invoice id and updatedAt are required for PDF provenance');
  }
  return `${SCHEDULER_INVOICE_PDF_RENDERER_VERSION}:${invoiceId}:${sourceUpdatedAt}`;
}

export function schedulerInvoicePdfJobParams(
  invoice: Pick<
    SchedulerInvoiceDto,
    'id' | 'financeId' | 'invoiceNumber' | 'updatedAt' | 'issueDate' | 'job' | 'jobCount'
  >,
  invoiceVersion = 1,
): SchedulerInvoicePdfJobParams {
  if (!Number.isSafeInteger(invoice.jobCount) || invoice.jobCount < 1) {
    throw new TypeError('invoice jobCount must be a positive safe integer');
  }
  if (!Number.isSafeInteger(invoiceVersion) || invoiceVersion < 1) {
    throw new TypeError('invoiceVersion must be a positive safe integer');
  }
  const additionalJobCount = Math.max(0, invoice.jobCount - 1);
  const invoiceCalendarDate = additionalJobCount > 0
    ? /^(\d{4}-\d{2}-\d{2})/.exec(invoice.issueDate ?? '')?.[1]
    : undefined;
  return {
    artifactType: 'pdf',
    filename: versionedInvoiceFilename(buildInvoiceDownloadFilename({
      jobName: invoice.job.jobName,
      jobDate: invoiceCalendarDate ?? invoice.job.jobDate,
      invoiceNumber: invoice.invoiceNumber,
      additionalJobCount,
    }), invoiceVersion),
    contentType: 'application/pdf',
    invoiceId: invoice.id,
    financeId: invoice.financeId,
    sourceUpdatedAt: invoice.updatedAt,
    reportVariantKey: schedulerInvoicePdfReportVariantKey(invoice),
    rendererVersion: SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
    invoiceVersion,
  };
}

function versionedInvoiceFilename(filename: string, invoiceVersion: number): string {
  return filename.toLowerCase().endsWith('.pdf')
    ? `${filename.slice(0, -4)}-v${invoiceVersion}.pdf`
    : `${filename}-v${invoiceVersion}.pdf`;
}

class AmbiguousSchedulerInvoicePdfPublicationError extends Error {
  constructor(cause: unknown) {
    super('Invoice PDF publication outcome could not be confirmed', { cause });
    this.name = 'AmbiguousSchedulerInvoicePdfPublicationError';
  }
}

type SchedulerInvoicePdfPublicationState = {
  jobComplete: boolean;
  artifactAttached: boolean;
};

export type SchedulerInvoicePdfArtifactDependencies = {
  queueCleanupTask: (app: StorageApp, storageKey: string) => Promise<string>;
  writeFile: typeof writeLocalFile;
  mirrorFile?: typeof mirrorInvoicePdfToOneDrive;
  publishWithRevisionLock: (input: {
    user: AuthUser;
    financeId: string;
    invoiceId: string;
    sourceUpdatedAt: string;
    jobId: string;
    claimToken?: string;
    storageKey: string;
    pdfUrl: string;
    cleanupTaskId: string;
  }) => Promise<void>;
  inspectPublication: (
    jobId: string,
    storageKey: string,
  ) => Promise<SchedulerInvoicePdfPublicationState>;
  drainCleanupTask: (taskId: string) => Promise<void>;
};

async function queueSchedulerInvoicePdfCleanupTask(
  app: StorageApp,
  storageKey: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const taskId = randomUUID();
    await tx.insert(storageDeletionTasks).values({
      id: taskId,
      app,
      storageKey,
      reason: SCHEDULER_INVOICE_PDF_UNATTACHED_REASON,
    }).onConflictDoNothing({ target: storageDeletionTasks.storageKey });
    const [task] = await tx.select({ id: storageDeletionTasks.id })
      .from(storageDeletionTasks)
      .where(eq(storageDeletionTasks.storageKey, storageKey))
      .limit(1);
    if (!task) throw new Error('scheduler_invoice_pdf_cleanup_queue_failed');
    return task.id;
  });
}

async function publishSchedulerInvoicePdfWithRevisionLock(input: {
  user: AuthUser;
  financeId: string;
  invoiceId: string;
  sourceUpdatedAt: string;
  jobId: string;
  claimToken?: string;
  storageKey: string;
  pdfUrl: string;
  cleanupTaskId: string;
}): Promise<void> {
  await withSchedulerInvoiceExportRevisionLock(
    input.user,
    input.financeId,
    input.invoiceId,
    input.sourceUpdatedAt,
    async (executor: SchedulerFinanceExecutor) => {
      const [cleanupTask] = await executor.select({ id: storageDeletionTasks.id })
        .from(storageDeletionTasks)
        .where(and(
          eq(storageDeletionTasks.id, input.cleanupTaskId),
          eq(storageDeletionTasks.storageKey, input.storageKey),
        ))
        .for('update')
        .limit(1);
      if (!cleanupTask) throw new Error('scheduler_invoice_pdf_cleanup_guard_missing');

      await completeJob(
        input.jobId,
        input.pdfUrl,
        input.storageKey,
        executor,
        input.claimToken,
      );
      const [released] = await executor.delete(storageDeletionTasks)
        .where(and(
          eq(storageDeletionTasks.id, input.cleanupTaskId),
          eq(storageDeletionTasks.storageKey, input.storageKey),
        ))
        .returning({ id: storageDeletionTasks.id });
      if (!released) throw new Error('scheduler_invoice_pdf_cleanup_guard_release_failed');
    },
  );
}

async function inspectSchedulerInvoicePdfPublication(
  jobId: string,
  storageKey: string,
): Promise<SchedulerInvoicePdfPublicationState> {
  const [job] = await db.select({
    status: pdfJobs.status,
    storageKey: pdfJobs.storageKey,
  }).from(pdfJobs).where(eq(pdfJobs.id, jobId)).limit(1);
  return {
    jobComplete: job?.status === 'complete',
    artifactAttached: job?.status === 'complete' && job.storageKey === storageKey,
  };
}

const artifactDependencies: SchedulerInvoicePdfArtifactDependencies = {
  queueCleanupTask: queueSchedulerInvoicePdfCleanupTask,
  writeFile: writeLocalFile,
  mirrorFile: mirrorInvoicePdfToOneDrive,
  publishWithRevisionLock: publishSchedulerInvoicePdfWithRevisionLock,
  inspectPublication: inspectSchedulerInvoicePdfPublication,
  async drainCleanupTask(taskId) {
    await drainStorageDeletionTasks({ ids: [taskId] });
  },
};

/**
 * The cleanup task is durable before storage is touched. Completion and removal
 * of that task commit atomically while the exact invoice revision is locked.
 */
export async function persistSchedulerInvoicePdfArtifact(
  input: {
    user: AuthUser;
    financeId: string;
    invoiceId: string;
    sourceUpdatedAt: string;
    jobId: string;
    claimToken?: string;
    storageKey: string;
    pdfUrl: string;
    buffer: Buffer;
    clientName?: string;
    filename?: string;
  },
  dependencyOverrides: Partial<SchedulerInvoicePdfArtifactDependencies> = {},
): Promise<void> {
  const dependencies: SchedulerInvoicePdfArtifactDependencies = {
    ...artifactDependencies,
    ...dependencyOverrides,
  };
  let cleanupTaskId = await dependencies.queueCleanupTask(
    requireStorageApp(input.user.app),
    input.storageKey,
  );
  try {
    await dependencies.writeFile(input.storageKey, input.buffer);
  } catch (error) {
    // Reassert the task in case a concurrent startup drain raced the write.
    cleanupTaskId = await dependencies.queueCleanupTask(
      requireStorageApp(input.user.app),
      input.storageKey,
    );
    await dependencies.drainCleanupTask(cleanupTaskId).catch(() => undefined);
    throw error;
  }

  // A second assertion closes a drain/write overlap before publication.
  cleanupTaskId = await dependencies.queueCleanupTask(
    requireStorageApp(input.user.app),
    input.storageKey,
  );
  if (input.clientName && input.filename) {
    await dependencies.mirrorFile?.({
      clientName: input.clientName,
      filename: input.filename,
      body: input.buffer,
    });
  }
  try {
    await dependencies.publishWithRevisionLock({
      user: input.user,
      financeId: input.financeId,
      invoiceId: input.invoiceId,
      sourceUpdatedAt: input.sourceUpdatedAt,
      jobId: input.jobId,
      claimToken: input.claimToken,
      storageKey: input.storageKey,
      pdfUrl: input.pdfUrl,
      cleanupTaskId,
    });
  } catch (error) {
    let publication: SchedulerInvoicePdfPublicationState;
    try {
      publication = await dependencies.inspectPublication(input.jobId, input.storageKey);
    } catch (inspectionError) {
      // The final transaction may have committed despite a lost acknowledgement.
      // Retain the outbox task: if completion committed it was atomically removed;
      // if it rolled back startup reconciliation can safely drain it.
      throw new AmbiguousSchedulerInvoicePdfPublicationError(inspectionError);
    }
    if (publication.artifactAttached) return;
    await dependencies.drainCleanupTask(cleanupTaskId).catch(() => undefined);
    throw error;
  }
}

function schedulerInvoicePdfClaimableCondition() {
  const legacyCutoff = sql`LOCALTIMESTAMP - (${EXPORT_JOB_INTERRUPTION_LEASE_MS} * INTERVAL '1 millisecond')`;
  return and(
    eq(pdfJobs.entityType, 'scheduler_invoice'),
    or(
      and(
        eq(pdfJobs.status, 'queued'),
        or(
          eq(pdfJobs.claimToken, SCHEDULER_INVOICE_PDF_DURABLE_QUEUE_MARKER),
          and(isNull(pdfJobs.claimToken), lte(pdfJobs.updatedAt, legacyCutoff)),
        ),
      ),
      and(
        eq(pdfJobs.status, 'running'),
        or(
          lte(pdfJobs.claimExpiresAt, sql`LOCALTIMESTAMP`),
          and(isNull(pdfJobs.claimExpiresAt), lte(pdfJobs.updatedAt, legacyCutoff)),
        ),
      ),
    ),
  );
}

/**
 * Claims the oldest eligible Scheduler invoice PDF. Durable-marker queued jobs
 * are immediate; tokenless rolling-old jobs wait through the legacy grace; an
 * expired running lease is reclaimed in-place. UPDATE ... RETURNING is the
 * ownership CAS across API processes.
 */
export async function claimNextSchedulerInvoicePdfJob(
): Promise<ClaimedSchedulerInvoicePdfJob | null> {
  const [candidate] = await db.select({ id: pdfJobs.id })
    .from(pdfJobs)
    .where(schedulerInvoicePdfClaimableCondition())
    .orderBy(asc(pdfJobs.createdAt), asc(pdfJobs.id))
    .limit(1);
  if (!candidate) return null;

  const claimToken = randomUUID();
  const [claimed] = await db.update(pdfJobs).set({
    status: 'running',
    phase: 'Loading invoice snapshot',
    claimToken,
    claimExpiresAt: sql`LOCALTIMESTAMP + (${SCHEDULER_INVOICE_PDF_CLAIM_LEASE_MS} * INTERVAL '1 millisecond')`,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(
    eq(pdfJobs.id, candidate.id),
    schedulerInvoicePdfClaimableCondition(),
  )).returning({
    id: pdfJobs.id,
    claimToken: pdfJobs.claimToken,
    app: pdfJobs.app,
    entityId: pdfJobs.entityId,
    userId: pdfJobs.userId,
    params: pdfJobs.params,
  });
  if (!claimed || claimed.claimToken !== claimToken) return null;
  return { ...claimed, claimToken };
}

async function renewSchedulerInvoicePdfClaim(job: ClaimedSchedulerInvoicePdfJob): Promise<boolean> {
  const [renewed] = await db.update(pdfJobs).set({
    claimExpiresAt: sql`LOCALTIMESTAMP + (${SCHEDULER_INVOICE_PDF_CLAIM_LEASE_MS} * INTERVAL '1 millisecond')`,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(
    eq(pdfJobs.id, job.id),
    eq(pdfJobs.status, 'running'),
    eq(pdfJobs.claimToken, job.claimToken),
  )).returning({ id: pdfJobs.id });
  return Boolean(renewed);
}

async function updateSchedulerInvoicePdfClaimPhase(
  job: Pick<ClaimedSchedulerInvoicePdfJob, 'id' | 'claimToken'>,
  phase: string,
): Promise<void> {
  const [updated] = await db.update(pdfJobs).set({
    phase,
    claimExpiresAt: sql`LOCALTIMESTAMP + (${SCHEDULER_INVOICE_PDF_CLAIM_LEASE_MS} * INTERVAL '1 millisecond')`,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(
    eq(pdfJobs.id, job.id),
    eq(pdfJobs.status, 'running'),
    eq(pdfJobs.claimToken, job.claimToken),
  )).returning({ id: pdfJobs.id });
  if (!updated) throw new Error('scheduler_invoice_pdf_claim_lost');
}

async function failClaimedSchedulerInvoicePdfJob(
  job: Pick<ClaimedSchedulerInvoicePdfJob, 'id' | 'claimToken'>,
  error: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('app.scheduler_invoice_pdf_worker_write', '1', true)
    `);
    await tx.update(pdfJobs).set({
      status: 'failed',
      phase: null,
      claimToken: null,
      claimExpiresAt: null,
      error,
      updatedAt: sql`LOCALTIMESTAMP`,
    }).where(and(
      eq(pdfJobs.id, job.id),
      eq(pdfJobs.status, 'running'),
      eq(pdfJobs.claimToken, job.claimToken),
    ));
  }).catch(() => {});
}

function requiredClaimParam(
  params: Record<string, unknown>,
  key: keyof SchedulerInvoicePdfJobParams,
): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`scheduler_invoice_pdf_claim_invalid_${key}`);
  }
  return value;
}

function schedulerInvoicePdfExecutionArgs(job: ClaimedSchedulerInvoicePdfJob): {
  jobId: string;
  claimToken: string;
  user: AuthUser;
  financeId: string;
  invoiceId: string;
  sourceUpdatedAt: string;
  invoiceVersion: number;
} {
  const app = requireStorageApp(job.app as AuthUser['app']);
  const invoiceId = requiredClaimParam(job.params, 'invoiceId');
  const financeId = requiredClaimParam(job.params, 'financeId');
  const sourceUpdatedAt = requiredClaimParam(job.params, 'sourceUpdatedAt');
  const filename = requiredClaimParam(job.params, 'filename');
  const reportVariantKey = requiredClaimParam(job.params, 'reportVariantKey');
  const invoiceVersion = job.params.invoiceVersion ?? 1;
  if (
    job.params.artifactType !== 'pdf'
    || job.params.contentType !== 'application/pdf'
    || job.params.rendererVersion !== SCHEDULER_INVOICE_PDF_RENDERER_VERSION
    || invoiceId !== job.entityId
    || reportVariantKey !== schedulerInvoicePdfReportVariantKey({
      id: invoiceId,
      updatedAt: sourceUpdatedAt,
    })
    || !filename.toLowerCase().endsWith('.pdf')
    || !Number.isSafeInteger(invoiceVersion)
    || Number(invoiceVersion) < 1
  ) {
    throw new Error('scheduler_invoice_pdf_claim_invalid_provenance');
  }
  return {
    jobId: job.id,
    claimToken: job.claimToken,
    user: {
      userId: job.userId,
      app,
      role: 'admin',
      authType: 'jwt',
    },
    financeId,
    invoiceId,
    sourceUpdatedAt,
    invoiceVersion: Number(invoiceVersion),
  };
}

function isInvoiceRevisionConflict(error: unknown): boolean {
  return error instanceof AppError
    && error.statusCode === 409
    && error.detail === 'Invoice changed; refresh before continuing';
}

async function runSchedulerInvoicePdfExport(args: {
  jobId: string;
  claimToken: string;
  user: AuthUser;
  financeId: string;
  invoiceId: string;
  sourceUpdatedAt: string;
  invoiceVersion: number;
}): Promise<void> {
  const claim = { id: args.jobId, claimToken: args.claimToken };
  try {
    await updateSchedulerInvoicePdfClaimPhase(claim, 'Loading invoice snapshot');
    const invoice = await loadSchedulerInvoiceExportSnapshot(
      args.user,
      args.financeId,
      args.invoiceId,
      args.sourceUpdatedAt,
    );
    if (invoice.status === 'draft') await assertSchedulerInvoiceJobsCompleted(invoice);

    await updateSchedulerInvoicePdfClaimPhase(claim, 'Rendering PDF');
    const pdf = await renderSchedulerInvoicePdf(invoice);
    await updateSchedulerInvoicePdfClaimPhase(claim, 'Saving PDF');
    const clientName = invoice.billToName || invoice.job.clientName || 'Unassigned client';
    const filename = versionedInvoiceFilename(pdf.filename, args.invoiceVersion);
    const storageKey = [
      requireStorageApp(args.user.app),
      'invoices',
      sanitizeStorageSegment(clientName),
      sanitizeStorageSegment(filename),
    ].join('/');
    await persistSchedulerInvoicePdfArtifact({
      user: args.user,
      financeId: args.financeId,
      invoiceId: args.invoiceId,
      sourceUpdatedAt: args.sourceUpdatedAt,
      jobId: args.jobId,
      claimToken: args.claimToken,
      storageKey,
      pdfUrl: publicFileUrl(storageKey),
      buffer: pdf.buffer,
      clientName,
      filename,
    });
  } catch (error) {
    const stale = isInvoiceRevisionConflict(error);
    const publicMessage = stale
      ? 'Invoice changed after this PDF was queued. Start a new PDF export.'
      : 'Invoice PDF could not be created. Please try again.';
    await failClaimedSchedulerInvoicePdfJob(claim, publicMessage);
    console.error('[pdf-job] Scheduler invoice export failed', {
      jobId: args.jobId,
      financeId: args.financeId,
      invoiceId: args.invoiceId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

export async function executeClaimedSchedulerInvoicePdfJob(
  job: ClaimedSchedulerInvoicePdfJob,
): Promise<void> {
  let args: Parameters<typeof runSchedulerInvoicePdfExport>[0];
  try {
    args = schedulerInvoicePdfExecutionArgs(job);
  } catch (error) {
    await failClaimedSchedulerInvoicePdfJob(
      job,
      'Invoice PDF job data is invalid. Start a new PDF export.',
    );
    console.error('[pdf-job] Scheduler invoice claim was invalid', {
      jobId: job.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return;
  }
  let heartbeat: Promise<void> | null = null;
  const heartbeatTimer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = renewSchedulerInvoicePdfClaim(job)
      .then(() => undefined)
      .catch((error) => {
        console.error('[pdf-job] Scheduler invoice claim heartbeat failed', {
          jobId: job.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      })
      .finally(() => { heartbeat = null; });
  }, SCHEDULER_INVOICE_PDF_CLAIM_HEARTBEAT_MS);
  heartbeatTimer.unref();
  try {
    await runSchedulerInvoicePdfExport(args);
  } finally {
    clearInterval(heartbeatTimer);
    await heartbeat;
  }
}

const schedulerInvoicePdfWorkerDependencies: SchedulerInvoicePdfWorkerDependencies = {
  claimNext: claimNextSchedulerInvoicePdfJob,
  execute: executeClaimedSchedulerInvoicePdfJob,
  logCycleError(error) {
    console.error('[pdf-job] Scheduler invoice worker cycle failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  },
};

/**
 * Polls the durable pdf_jobs table and drains claims serially in this process.
 * Database compare-and-set claims prevent duplicate execution across processes.
 */
export function startSchedulerInvoicePdfWorker(options: {
  pollIntervalMs?: number;
  dependencies?: Partial<SchedulerInvoicePdfWorkerDependencies>;
} = {}): SchedulerInvoicePdfWorker {
  if (activeSchedulerInvoicePdfWorkerWake) {
    throw new Error('scheduler_invoice_pdf_worker_already_started');
  }
  const pollIntervalMs = options.pollIntervalMs ?? SCHEDULER_INVOICE_PDF_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new TypeError('pollIntervalMs must be a positive safe integer');
  }
  const dependencies: SchedulerInvoicePdfWorkerDependencies = {
    ...schedulerInvoicePdfWorkerDependencies,
    ...options.dependencies,
  };
  let stopping = false;
  let rerunRequested = false;
  let currentRun: Promise<void> | null = null;

  const wake = () => {
    if (stopping) return;
    rerunRequested = true;
    if (currentRun) return;
    currentRun = (async () => {
      do {
        rerunRequested = false;
        while (!stopping) {
          const processed = await enqueueExportTask(async () => {
            // Do not acquire ownership merely to leave the job running behind
            // another expensive in-process export during shutdown.
            if (stopping) return false;
            const job = await dependencies.claimNext();
            if (!job) return false;
            // A stop requested after the claim still waits for this execution
            // so shutdown never abandons a job it changed to running.
            await dependencies.execute(job);
            return true;
          });
          if (!processed) break;
        }
      } while (rerunRequested && !stopping);
    })().catch((error) => dependencies.logCycleError(error)).finally(() => {
      currentRun = null;
      if (rerunRequested && !stopping) queueMicrotask(wake);
    });
  };

  activeSchedulerInvoicePdfWorkerWake = wake;
  const timer = setInterval(wake, pollIntervalMs);
  timer.unref();
  wake();

  return {
    wake,
    async stop() {
      if (stopping) {
        await currentRun;
        return;
      }
      stopping = true;
      clearInterval(timer);
      if (activeSchedulerInvoicePdfWorkerWake === wake) {
        activeSchedulerInvoicePdfWorkerWake = null;
      }
      await currentRun;
    },
  };
}

function wakeSchedulerInvoicePdfWorker(): void {
  activeSchedulerInvoicePdfWorkerWake?.();
}

async function queueSchedulerInvoicePdfForSnapshot(
  user: AuthUser,
  invoice: SchedulerInvoiceDto,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  if (invoice.updatedAt !== expectedUpdatedAt) {
    throw conflict('Invoice changed before its PDF export was queued. Refresh and try again.');
  }
  if (invoice.status === 'draft') await assertSchedulerInvoiceJobsCompleted(invoice);
  const app = requireStorageApp(user.app);
  const jobId = randomUUID();
  const queued = await db.transaction(async (tx) => {
    // Draft readiness locks finance/source rows before the invoice row, matching
    // invoice mutation lock order and avoiding a queue/issue deadlock.
    await assertSchedulerInvoicePdfStartReady(invoice.id, tx);
    const [lockedInvoice] = await tx
      .select({
        id: schedulerInvoices.id,
        financeId: schedulerInvoices.financeId,
        updatedAt: schedulerInvoices.updatedAt,
      })
      .from(schedulerInvoices)
      .where(and(
        eq(schedulerInvoices.id, invoice.id),
        eq(schedulerInvoices.financeId, invoice.financeId),
      ))
      .for('update')
      .limit(1);
    if (!lockedInvoice) throw notFound('Invoice');
    if (lockedInvoice.updatedAt.toISOString() !== invoice.updatedAt) {
      throw conflict('Invoice changed while its PDF export was being queued. Refresh and try again.');
    }
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(
        ${`scheduler-invoice-artifact:${invoice.financeId}`},
        0
      ))
    `);
    const [prior] = await tx.select({ count: count() }).from(pdfJobs).where(and(
      eq(pdfJobs.entityType, 'scheduler_invoice'),
      sql`${pdfJobs.params} ->> 'financeId' = ${invoice.financeId}`,
      inArray(pdfJobs.status, ['queued', 'running', 'complete']),
    ));
    const invoiceVersion = Number(prior?.count ?? 0) + 1;
    const params = schedulerInvoicePdfJobParams(invoice, invoiceVersion);
    await tx.insert(pdfJobs).values({
      id: jobId,
      // Scheduler is cross-product, but generic export access is deliberately
      // bound to the exact portal credential that created the job. Storage uses
      // the same namespace so start, latest, status, and download cannot drift.
      app,
      entityId: invoice.id,
      entityType: 'scheduler_invoice',
      userId: user.userId,
      params,
      status: 'queued',
      phase: 'Queued',
      // Distinguishes durable-worker rows from fresh tokenless rows created by
      // a rolling old process that may already be dispatching in memory.
      claimToken: SCHEDULER_INVOICE_PDF_DURABLE_QUEUE_MARKER,
    });
    return {
      jobId,
      reused: false,
      sourceUpdatedAt: invoice.updatedAt,
      reportVariantKey: params.reportVariantKey,
      invoiceVersion,
    };
  });

  wakeSchedulerInvoicePdfWorker();
  return queued;
}

export async function queueSchedulerInvoicePdfByFinanceId(
  user: AuthUser,
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  const invoice = await getSchedulerInvoiceByFinanceId(user, financeId, invoiceId);
  return queueSchedulerInvoicePdfForSnapshot(user, invoice, expectedUpdatedAt);
}

export async function queueSchedulerInvoicePdfByEventId(
  user: AuthUser,
  eventId: string,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  const invoice = await getSchedulerInvoice(user, eventId, invoiceId);
  return queueSchedulerInvoicePdfForSnapshot(user, invoice, expectedUpdatedAt);
}

export async function queueSchedulerInvoicePdfByInvoiceId(
  user: AuthUser,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  const invoice = await getConsolidatedSchedulerInvoice(user, invoiceId);
  return queueSchedulerInvoicePdfForSnapshot(user, invoice, expectedUpdatedAt);
}
