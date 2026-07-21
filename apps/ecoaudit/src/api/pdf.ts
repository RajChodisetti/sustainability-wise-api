import { request, requestBinary } from '@/api/client';
import type { ExportArtifactType, ExportJobStatus, PdfJobStatus } from '@/types/domain';

export function startReportPdfJob(
  auditId: string,
  options?: { mode?: 'by-equipment' | 'by-zone'; zoneIds?: string[] },
): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(
    'POST',
    `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/report/pdf/jobs`,
    options ?? {},
  );
}

export function getExportJobStatus(jobId: string): Promise<ExportJobStatus> {
  return request<ExportJobStatus>('GET', `/v1/export/jobs/${encodeURIComponent(jobId)}`);
}

export function getPdfJobStatus(jobId: string): Promise<PdfJobStatus> {
  return getExportJobStatus(jobId);
}

export async function getLatestExportJob(
  entityId: string,
  artifactType: ExportArtifactType,
): Promise<ExportJobStatus | null> {
  const result = await request<{ job: ExportJobStatus | null }>(
    'GET',
    `/v1/export/jobs/latest?entityId=${encodeURIComponent(entityId)}&artifactType=${encodeURIComponent(artifactType)}`,
  );
  return result.job;
}

export async function downloadExportJob(jobId: string, contentType: string): Promise<Blob> {
  const buffer = await requestBinary('GET', `/v1/export/jobs/${encodeURIComponent(jobId)}/download`);
  return new Blob([buffer], { type: contentType });
}

export async function downloadPdfJob(jobId: string): Promise<Blob> {
  return downloadExportJob(jobId, 'application/pdf');
}

export async function generateReportPdfSync(
  auditId: string,
  options?: { mode?: 'by-equipment' | 'by-zone'; zoneIds?: string[] },
): Promise<Blob> {
  const buffer = await requestBinary(
    'POST',
    `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/report/pdf`,
    options ?? {},
  );
  return new Blob([buffer], { type: 'application/pdf' });
}

export async function pollPdfJob(
  jobId: string,
  onProgress?: (status: PdfJobStatus) => void,
  intervalMs = 1500,
  maxAttempts = Number.POSITIVE_INFINITY,
): Promise<PdfJobStatus> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await getPdfJobStatus(jobId);
    onProgress?.(status);
    if (status.status === 'complete') return status;
    if (status.status === 'failed') throw new Error(status.error ?? 'PDF generation failed.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('PDF generation is still in progress.');
}
