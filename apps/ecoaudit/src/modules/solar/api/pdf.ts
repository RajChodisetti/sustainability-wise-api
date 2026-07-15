import { request, requestBinary } from '@solar/api/client';
import { API_DISPLAY_URL, API_URL } from '@solar/lib/config';

export type PdfJobStatus = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  phase: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  pdfUrl: string | null;
  error: string | null;
};

export function startSitePackPdfJob(
  siteId: string,
  assessmentIds?: string[],
  options?: Record<string, unknown>,
): Promise<{ jobId: string }> {
  return request<{ jobId: string }>('POST', `/v1/solarsense/sites/${encodeURIComponent(siteId)}/site-pack/pdf/jobs`, {
    assessmentIds: assessmentIds?.length ? assessmentIds : undefined,
    options,
  });
}

export function getPdfJobStatus(jobId: string): Promise<PdfJobStatus> {
  return request<PdfJobStatus>('GET', `/v1/pdf/jobs/${encodeURIComponent(jobId)}`);
}

export async function downloadPdfJob(jobId: string): Promise<Blob> {
  const buffer = await requestBinary('GET', `/v1/pdf/jobs/${encodeURIComponent(jobId)}/download`);
  return new Blob([buffer], { type: 'application/pdf' });
}

export async function generateSitePackPdfSync(siteId: string, assessmentIds?: string[]): Promise<Blob> {
  const buffer = await requestBinary('POST', `/v1/solarsense/sites/${encodeURIComponent(siteId)}/site-pack/pdf`, {
    assessmentIds: assessmentIds?.length ? assessmentIds : undefined,
  });
  return new Blob([buffer], { type: 'application/pdf' });
}

export async function pollPdfJob(
  jobId: string,
  onProgress?: (status: PdfJobStatus) => void,
  intervalMs = 1500,
  maxAttempts = 120,
): Promise<PdfJobStatus> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await getPdfJobStatus(jobId);
    onProgress?.(status);
    if (status.status === 'complete') return status;
    if (status.status === 'failed') throw new Error(status.error ?? 'PDF generation failed.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('PDF generation timed out.');
}

export function resolvePdfUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${API_URL || API_DISPLAY_URL}${url}`;
  return `${API_URL || API_DISPLAY_URL}/v1/files/${encodeURIComponent(url)}`;
}
