import { and, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pdfJobs } from '../db/schema/shared.js';

export type ExportArtifactType = 'pdf' | 'photos-zip';

export type ExportJobParams = Record<string, unknown> & {
  artifactType: ExportArtifactType;
  filename: string;
  contentType: 'application/pdf' | 'application/zip';
};

export function exportJobParams(value: unknown): Partial<ExportJobParams> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ExportJobParams>
    : {};
}

export async function markJobRunning(jobId: string, phase: string): Promise<void> {
  await db.update(pdfJobs).set({ status: 'running', phase, updatedAt: sql`LOCALTIMESTAMP` }).where(eq(pdfJobs.id, jobId));
}

export async function updateJobPhase(jobId: string, phase: string): Promise<void> {
  await db.update(pdfJobs).set({ phase, updatedAt: sql`LOCALTIMESTAMP` }).where(eq(pdfJobs.id, jobId));
}

export async function updateJobProgress(
  jobId: string,
  phase: string,
  current: number,
  total: number,
): Promise<void> {
  await db.update(pdfJobs).set({
    phase,
    progressCurrent: current,
    progressTotal: total,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(eq(pdfJobs.id, jobId));
}

type PdfJobUpdateExecutor = Pick<typeof db, 'update'>;
export const EXPORT_JOB_INTERRUPTION_LEASE_MS = 60 * 60 * 1_000;

export async function completeJob(
  jobId: string,
  pdfUrl: string,
  storageKey: string,
  executor: PdfJobUpdateExecutor = db,
): Promise<void> {
  const [completed] = await executor.update(pdfJobs).set({
    status: 'complete',
    phase: 'Ready to download',
    pdfUrl,
    storageKey,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(
    eq(pdfJobs.id, jobId),
    inArray(pdfJobs.status, ['queued', 'running']),
  )).returning({ id: pdfJobs.id });
  if (!completed) throw new Error('export_job_completion_failed');
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await db.update(pdfJobs).set({
    status: 'failed',
    phase: null,
    error,
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(eq(pdfJobs.id, jobId), ne(pdfJobs.status, 'complete'))).catch(() => {});
}

export async function findActiveExportJob(args: {
  app: string;
  entityId: string;
  userId: string;
  params: ExportJobParams;
  executor?: Pick<typeof db, 'select'>;
}): Promise<{ id: string } | null> {
  const executor = args.executor ?? db;
  const [job] = await executor
    .select({ id: pdfJobs.id })
    .from(pdfJobs)
    .where(and(
      eq(pdfJobs.app, args.app),
      eq(pdfJobs.entityId, args.entityId),
      eq(pdfJobs.userId, args.userId),
      eq(pdfJobs.params, args.params),
      inArray(pdfJobs.status, ['queued', 'running']),
    ))
    .orderBy(desc(pdfJobs.createdAt))
    .limit(1);
  return job ?? null;
}

export async function failInterruptedExportJobs(now = new Date()): Promise<void> {
  // pdf_jobs timestamps are stored without a time zone, so keep the cutoff in
  // the database session's local timestamp domain. A direct JS Date comparison
  // uses its UTC wall clock and can fail a brand-new job on non-UTC databases.
  const staleBefore = sql`(${now.toISOString()}::timestamptz AT TIME ZONE current_setting('TimeZone')) - (${EXPORT_JOB_INTERRUPTION_LEASE_MS} * INTERVAL '1 millisecond')`;
  await db.update(pdfJobs).set({
    status: 'failed',
    phase: null,
    error: 'Export was interrupted by a server restart. Please start it again.',
    updatedAt: sql`LOCALTIMESTAMP`,
  }).where(and(
    inArray(pdfJobs.status, ['queued', 'running']),
    lte(pdfJobs.updatedAt, staleBefore),
  ));
}
