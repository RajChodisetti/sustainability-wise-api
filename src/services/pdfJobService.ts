import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pdfJobs } from '../db/schema/shared.js';

export async function markJobRunning(jobId: string, phase: string): Promise<void> {
  await db.update(pdfJobs).set({ status: 'running', phase, updatedAt: new Date() }).where(eq(pdfJobs.id, jobId));
}

export async function updateJobPhase(jobId: string, phase: string): Promise<void> {
  await db.update(pdfJobs).set({ phase, updatedAt: new Date() }).where(eq(pdfJobs.id, jobId));
}

export async function completeJob(jobId: string, pdfUrl: string, storageKey: string): Promise<void> {
  await db.update(pdfJobs).set({
    status: 'complete',
    phase: 'Complete',
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
