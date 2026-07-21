import { and, desc, eq, inArray } from 'drizzle-orm';
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
  await db.update(pdfJobs).set({ status: 'running', phase, updatedAt: new Date() }).where(eq(pdfJobs.id, jobId));
}

export async function updateJobPhase(jobId: string, phase: string): Promise<void> {
  await db.update(pdfJobs).set({ phase, updatedAt: new Date() }).where(eq(pdfJobs.id, jobId));
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
    updatedAt: new Date(),
  }).where(eq(pdfJobs.id, jobId));
}

export async function completeJob(jobId: string, pdfUrl: string, storageKey: string): Promise<void> {
  await db.update(pdfJobs).set({
    status: 'complete',
    phase: 'Ready to download',
    pdfUrl,
    storageKey,
    updatedAt: new Date(),
  }).where(eq(pdfJobs.id, jobId));
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await db.update(pdfJobs).set({
    status: 'failed',
    phase: null,
    error,
    updatedAt: new Date(),
  }).where(eq(pdfJobs.id, jobId)).catch(() => {});
}

export async function findActiveExportJob(args: {
  app: string;
  entityId: string;
  userId: string;
  params: ExportJobParams;
}): Promise<{ id: string } | null> {
  const [job] = await db
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

export async function failInterruptedExportJobs(): Promise<void> {
  await db.update(pdfJobs).set({
    status: 'failed',
    phase: null,
    error: 'Export was interrupted by a server restart. Please start it again.',
    updatedAt: new Date(),
  }).where(inArray(pdfJobs.status, ['queued', 'running']));
}
