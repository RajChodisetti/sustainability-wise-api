import { request } from '@/api/client';
import type { EquipmentBase } from '@/types/domain';
import { getEquipmentConfig } from '@/lib/equipmentConfig';
import { normalizePhotoDescsRecord } from '@/lib/photoMetadata';

type EquipmentWireRecord = EquipmentBase & { photo_descs?: unknown };

function basePath(slug: string, auditId: string): string {
  return `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/${slug}`;
}

function itemPath(slug: string, id: string): string {
  return `/v1/ecoaudit/${slug}/${encodeURIComponent(id)}`;
}

function normalizeEquipmentRecord(record: EquipmentWireRecord): EquipmentBase {
  const rest = { ...record };
  delete rest.photo_descs;
  return { ...rest, photoDescs: normalizePhotoDescsRecord(record) };
}

function normalizeEquipmentBody<T extends object>(body: T): T {
  const record = body as Record<string, unknown>;
  if (!('photoDescs' in record) && !('photo_descs' in record)) return body;
  const rest = { ...record };
  delete rest.photo_descs;
  return { ...rest, photoDescs: normalizePhotoDescsRecord(record) } as T;
}

export async function listEquipment(slug: string, auditId: string): Promise<{ data: EquipmentBase[] }> {
  const response = await request<{ data: EquipmentWireRecord[] }>('GET', basePath(slug, auditId));
  return { ...response, data: response.data.map(normalizeEquipmentRecord) };
}

export async function getEquipment(slug: string, id: string): Promise<EquipmentBase> {
  return normalizeEquipmentRecord(await request<EquipmentWireRecord>('GET', itemPath(slug, id)));
}

export async function createEquipment(slug: string, auditId: string, body: Record<string, unknown>): Promise<EquipmentBase> {
  const config = getEquipmentConfig(slug);
  if (!config) throw new Error('Unknown equipment type');
  return normalizeEquipmentRecord(await request<EquipmentWireRecord>('POST', basePath(slug, auditId), normalizeEquipmentBody(body)));
}

export async function updateEquipment(slug: string, id: string, body: Record<string, unknown>): Promise<EquipmentBase> {
  return normalizeEquipmentRecord(await request<EquipmentWireRecord>('PATCH', itemPath(slug, id), normalizeEquipmentBody(body)));
}

export function deleteEquipment(slug: string, id: string): Promise<void> {
  return request<void>('DELETE', itemPath(slug, id));
}
