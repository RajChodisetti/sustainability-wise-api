import { request } from '@/api/client';
import { normalizePhotoDescsRecord } from '@/lib/photoMetadata';
import type { Zone } from '@/types/domain';

type ZoneWireRecord = Zone & { photo_descs?: unknown };

function normalizeZone(record: ZoneWireRecord): Zone {
  const rest = { ...record };
  delete rest.photo_descs;
  return { ...rest, photoDescs: normalizePhotoDescsRecord(record) };
}

function normalizeZoneBody<T extends object>(body: T): T {
  const record = body as Record<string, unknown>;
  if (!('photoDescs' in record) && !('photo_descs' in record)) return body;
  const rest = { ...record };
  delete rest.photo_descs;
  return { ...rest, photoDescs: normalizePhotoDescsRecord(record) } as T;
}

export async function listZones(auditId: string): Promise<{ data: Zone[] }> {
  const response = await request<{ data: ZoneWireRecord[] }>('GET', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/zones`);
  return { ...response, data: response.data.map(normalizeZone) };
}

export async function getZone(id: string): Promise<Zone> {
  return normalizeZone(await request<ZoneWireRecord>('GET', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`));
}

export async function createZone(auditId: string, body: Partial<Zone>): Promise<Zone> {
  return normalizeZone(await request<ZoneWireRecord>('POST', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/zones`, normalizeZoneBody(body)));
}

export async function updateZone(id: string, body: Partial<Zone>): Promise<Zone> {
  return normalizeZone(await request<ZoneWireRecord>('PATCH', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`, normalizeZoneBody(body)));
}

export function deleteZone(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`);
}
