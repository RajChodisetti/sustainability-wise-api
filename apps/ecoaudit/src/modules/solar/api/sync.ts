import { request } from '@solar/api/client';
import { API_DISPLAY_URL, API_URL } from '@solar/lib/config';

export type RemoteSiteSummary = {
  id: string;
  siteName: string;
  location: string | null;
  dateOfAssessment: string | null;
  status: string;
  updatedAt: string;
};

export type PullResult = {
  sites: unknown[];
  assessments: unknown[];
  pulledAt: string;
};

export async function testCloudConnection(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API_URL || API_DISPLAY_URL}/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function pullSync(since = '1970-01-01T00:00:00.000Z', siteId?: string): Promise<PullResult> {
  const params = new URLSearchParams({ since });
  if (siteId) params.set('siteId', siteId);
  return request<PullResult>('GET', `/v1/solarsense/sync/pull?${params}`);
}

export async function listRemoteSites(): Promise<RemoteSiteSummary[]> {
  const payload = await request<{ data?: RemoteSiteSummary[] } | RemoteSiteSummary[]>('GET', '/v1/solarsense/sites/');
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}
