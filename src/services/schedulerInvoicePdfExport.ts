import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  pdfJobs,
  schedulerInvoices,
  storageDeletionTasks,
} from '../db/schema/shared.js';
import { publicFileUrl, type StorageApp, writeLocalFile } from '../storage/localFiles.js';
import { AppError, conflict, forbidden, notFound } from '../utils/errors.js';
import { buildInvoiceDownloadFilename } from './invoicePdf.js';
import { enqueueExportTask } from './exportJobQueue.js';
import {
  completeJob,
  failJob,
  findActiveExportJob,
  markJobRunning,
  updateJobPhase,
  type ExportJobParams,
} from './pdfJobService.js';
import {
  getSchedulerInvoice,
  getSchedulerInvoiceByFinanceId,
  getConsolidatedSchedulerInvoice,
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
import { makePdfStorageKeyFromName } from './storageNaming.js';

export const SCHEDULER_INVOICE_PDF_RENDERER_VERSION = 'scheduler-invoice-pdf:v2';

export type SchedulerInvoicePdfJobParams = ExportJobParams & {
  invoiceId: string;
  financeId: string;
  sourceUpdatedAt: string;
  reportVariantKey: string;
  rendererVersion: typeof SCHEDULER_INVOICE_PDF_RENDERER_VERSION;
};

export type QueuedSchedulerInvoicePdfExport = {
  jobId: string;
  reused: boolean;
  sourceUpdatedAt: string;
  reportVariantKey: string;
};

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
): SchedulerInvoicePdfJobParams {
  if (!Number.isSafeInteger(invoice.jobCount) || invoice.jobCount < 1) {
    throw new TypeError('invoice jobCount must be a positive safe integer');
  }
  const additionalJobCount = Math.max(0, invoice.jobCount - 1);
  const invoiceCalendarDate = additionalJobCount > 0
    ? /^(\d{4}-\d{2}-\d{2})/.exec(invoice.issueDate ?? '')?.[1]
    : undefined;
  return {
    artifactType: 'pdf',
    filename: buildInvoiceDownloadFilename({
      jobName: invoice.job.jobName,
      jobDate: invoiceCalendarDate ?? invoice.job.jobDate,
      invoiceNumber: invoice.invoiceNumber,
      additionalJobCount,
    }),
    contentType: 'application/pdf',
    invoiceId: invoice.id,
    financeId: invoice.financeId,
    sourceUpdatedAt: invoice.updatedAt,
    reportVariantKey: schedulerInvoicePdfReportVariantKey(invoice),
    rendererVersion: SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  };
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
  publishWithRevisionLock: (input: {
    user: AuthUser;
    financeId: string;
    invoiceId: string;
    sourceUpdatedAt: string;
    jobId: string;
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

      await completeJob(input.jobId, input.pdfUrl, input.storageKey, executor);
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
    storageKey: string;
    pdfUrl: string;
    buffer: Buffer;
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
  try {
    await dependencies.publishWithRevisionLock({
      user: input.user,
      financeId: input.financeId,
      invoiceId: input.invoiceId,
      sourceUpdatedAt: input.sourceUpdatedAt,
      jobId: input.jobId,
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

function isInvoiceRevisionConflict(error: unknown): boolean {
  return error instanceof AppError
    && error.statusCode === 409
    && error.detail === 'Invoice changed; refresh before continuing';
}

async function runSchedulerInvoicePdfExport(args: {
  jobId: string;
  user: AuthUser;
  financeId: string;
  invoiceId: string;
  sourceUpdatedAt: string;
}): Promise<void> {
  try {
    await markJobRunning(args.jobId, 'Loading invoice snapshot');
    const invoice = await loadSchedulerInvoiceExportSnapshot(
      args.user,
      args.financeId,
      args.invoiceId,
      args.sourceUpdatedAt,
    );

    await updateJobPhase(args.jobId, 'Rendering PDF');
    const pdf = await renderSchedulerInvoicePdf(invoice);
    await updateJobPhase(args.jobId, 'Saving PDF');
    const storageKey = makePdfStorageKeyFromName({
      app: requireStorageApp(args.user.app),
      parentName: invoice.job.jobName,
      fieldName: `scheduler-invoice-${invoice.id}`,
      sessionId: args.jobId,
      filename: pdf.filename,
    });
    await persistSchedulerInvoicePdfArtifact({
      user: args.user,
      financeId: args.financeId,
      invoiceId: args.invoiceId,
      sourceUpdatedAt: args.sourceUpdatedAt,
      jobId: args.jobId,
      storageKey,
      pdfUrl: publicFileUrl(storageKey),
      buffer: pdf.buffer,
    });
  } catch (error) {
    const stale = isInvoiceRevisionConflict(error);
    const publicMessage = stale
      ? 'Invoice changed after this PDF was queued. Start a new PDF export.'
      : 'Invoice PDF could not be created. Please try again.';
    await failJob(args.jobId, publicMessage);
    console.error('[pdf-job] Scheduler invoice export failed', {
      jobId: args.jobId,
      financeId: args.financeId,
      invoiceId: args.invoiceId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function queueSchedulerInvoicePdfForSnapshot(
  user: AuthUser,
  invoice: SchedulerInvoiceDto,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  if (invoice.updatedAt !== expectedUpdatedAt) {
    throw conflict('Invoice changed before its PDF export was queued. Refresh and try again.');
  }
  const app = requireStorageApp(user.app);
  const params = schedulerInvoicePdfJobParams(invoice);
  const jobId = randomUUID();
  const queued = await db.transaction(async (tx) => {
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

    const active = await findActiveExportJob({
      app,
      entityId: invoice.id,
      userId: user.userId,
      params,
      executor: tx,
    });
    if (active) {
      return {
        jobId: active.id,
        reused: true,
        sourceUpdatedAt: invoice.updatedAt,
        reportVariantKey: params.reportVariantKey,
      };
    }

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
    });
    return {
      jobId,
      reused: false,
      sourceUpdatedAt: invoice.updatedAt,
      reportVariantKey: params.reportVariantKey,
    };
  });

  if (!queued.reused) {
    void enqueueExportTask(() => runSchedulerInvoicePdfExport({
      jobId,
      user,
      financeId: invoice.financeId,
      invoiceId: invoice.id,
      sourceUpdatedAt: invoice.updatedAt,
    })).catch((error) => {
      console.error('[pdf-job] Scheduler invoice queue failed', {
        jobId,
        financeId: invoice.financeId,
        invoiceId: invoice.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  }
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
