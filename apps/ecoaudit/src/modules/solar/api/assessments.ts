import { request } from '@solar/api/client';
import { normalizeAssessment, unwrapList } from '@solar/lib/normalize';
import type { AssessmentInput, RooftopAssessment } from '@solar/types/domain';

function asRecord(assessment: AssessmentInput): Record<string, unknown> {
  return { ...assessment };
}

export async function listAssessments(siteId: string): Promise<RooftopAssessment[]> {
  const payload = await request<unknown>(
    'GET',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments`,
  );
  return unwrapList(payload, normalizeAssessment).map((a) => ({ ...a, siteId }));
}

export async function getAssessment(siteId: string, id: string): Promise<RooftopAssessment> {
  const payload = await request<Record<string, unknown>>(
    'GET',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments/${encodeURIComponent(id)}`,
  );
  return { ...normalizeAssessment(payload), siteId };
}

export async function createAssessment(siteId: string, input: AssessmentInput): Promise<RooftopAssessment> {
  const payload = await request<Record<string, unknown>>(
    'POST',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments`,
    { ...asRecord(input), siteId },
  );
  return { ...normalizeAssessment(payload), siteId };
}

export async function updateAssessment(
  siteId: string,
  id: string,
  input: Partial<AssessmentInput>,
): Promise<RooftopAssessment> {
  const payload = await request<Record<string, unknown>>(
    'PATCH',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments/${encodeURIComponent(id)}`,
    asRecord(input as AssessmentInput),
  );
  return { ...normalizeAssessment(payload), siteId };
}

export async function completeAssessment(siteId: string, id: string): Promise<RooftopAssessment> {
  const payload = await request<Record<string, unknown>>(
    'PATCH',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments/${encodeURIComponent(id)}/complete`,
    {},
  );
  return { ...normalizeAssessment(payload), siteId };
}

export async function deleteAssessment(siteId: string, id: string, purge = false): Promise<void> {
  await request(
    'DELETE',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/assessments/${encodeURIComponent(id)}${purge ? '?purge=true' : ''}`,
  );
}

export async function listAllAssessments(sites: { id: string; siteName: string }[]): Promise<RooftopAssessment[]> {
  const results = await Promise.all(sites.map((s) => listAssessments(s.id).catch(() => [])));
  return results.flat();
}
