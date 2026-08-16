import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { pdfJobs, schedulerInvoices } from '../db/schema/shared.js';
import { publicFileUrl, type StorageApp, writeLocalFile } from '../storage/localFiles.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
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
  renderSchedulerInvoicePdf,
  type SchedulerInvoiceDto,
} from './schedulerFinanceService.js';
import { makePdfStorageKeyFromName } from './storageNaming.js';

export const SCHEDULER_INVOICE_PDF_RENDERER_VERSION = 'scheduler-invoice-pdf:v1';

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
  invoice: Pick<SchedulerInvoiceDto, 'id' | 'financeId' | 'invoiceNumber' | 'updatedAt' | 'job'>,
): SchedulerInvoicePdfJobParams {
  return {
    artifactType: 'pdf',
    filename: buildInvoiceDownloadFilename({
      jobName: invoice.job.jobName,
      jobDate: invoice.job.jobDate,
      invoiceNumber: invoice.invoiceNumber,
    }),
    contentType: 'application/pdf',
    invoiceId: invoice.id,
    financeId: invoice.financeId,
    sourceUpdatedAt: invoice.updatedAt,
    reportVariantKey: schedulerInvoicePdfReportVariantKey(invoice),
    rendererVersion: SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  };
}

class StaleSchedulerInvoicePdfError extends Error {}

async function runSchedulerInvoicePdfExport(args: {
  jobId: string;
  user: AuthUser;
  financeId: string;
  invoiceId: string;
  sourceUpdatedAt: string;
}): Promise<void> {
  try {
    await markJobRunning(args.jobId, 'Loading invoice snapshot');
    const invoice = await getSchedulerInvoiceByFinanceId(
      args.user,
      args.financeId,
      args.invoiceId,
    );
    if (invoice.updatedAt !== args.sourceUpdatedAt) {
      throw new StaleSchedulerInvoicePdfError(
        'Invoice changed after this PDF was queued. Start a new PDF export.',
      );
    }

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
    await writeLocalFile(storageKey, pdf.buffer);

    // The artifact must be durable before the job can advertise completion.
    await completeJob(args.jobId, publicFileUrl(storageKey), storageKey);
  } catch (error) {
    const publicMessage = error instanceof StaleSchedulerInvoicePdfError
      ? error.message
      : 'Invoice PDF could not be created. Please try again.';
    await failJob(args.jobId, publicMessage);
    console.error('[pdf-job] Scheduler invoice export failed', {
      jobId: args.jobId,
      financeId: args.financeId,
      invoiceId: args.invoiceId,
      error: error instanceof Error ? error.message : String(error),
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

    const now = new Date();
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
      createdAt: now,
      updatedAt: now,
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
        error: error instanceof Error ? error.message : String(error),
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
