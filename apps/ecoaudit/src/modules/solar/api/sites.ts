import { request } from '@solar/api/client';
import { normalizeSite, unwrapList } from '@solar/lib/normalize';
import type { Site, SiteInput } from '@solar/types/domain';

function asRecord(site: SiteInput): Record<string, unknown> {
  return { ...site };
}

export async function listSites(): Promise<Site[]> {
  const payload = await request<unknown>('GET', '/v1/solarsense/sites/');
  return unwrapList(payload, normalizeSite);
}

export async function getSite(id: string): Promise<Site> {
  const payload = await request<Record<string, unknown>>('GET', `/v1/solarsense/sites/${encodeURIComponent(id)}`);
  return normalizeSite(payload);
}

export async function createSite(input: SiteInput): Promise<Site> {
  const payload = await request<Record<string, unknown>>('POST', '/v1/solarsense/sites/', asRecord(input));
  return normalizeSite(payload);
}

export async function updateSite(id: string, input: Partial<SiteInput>): Promise<Site> {
  const payload = await request<Record<string, unknown>>(
    'PATCH',
    `/v1/solarsense/sites/${encodeURIComponent(id)}`,
    asRecord(input as SiteInput),
  );
  return normalizeSite(payload);
}

export async function completeSite(id: string): Promise<Site> {
  const payload = await request<Record<string, unknown>>(
    'PATCH',
    `/v1/solarsense/sites/${encodeURIComponent(id)}/complete`,
    {},
  );
  return normalizeSite(payload);
}

export async function deleteSite(id: string, purge = false): Promise<void> {
  await request('DELETE', `/v1/solarsense/sites/${encodeURIComponent(id)}${purge ? '?purge=true' : ''}`);
}
