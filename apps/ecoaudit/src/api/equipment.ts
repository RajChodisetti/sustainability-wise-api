import { request } from '@/api/client';
import type { EquipmentBase } from '@/types/domain';
import { getEquipmentConfig } from '@/lib/equipmentConfig';

function basePath(slug: string, auditId: string): string {
  return `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/${slug}`;
}

function itemPath(slug: string, id: string): string {
  return `/v1/ecoaudit/${slug}/${encodeURIComponent(id)}`;
}

export function listEquipment(slug: string, auditId: string): Promise<{ data: EquipmentBase[] }> {
  return request<{ data: EquipmentBase[] }>('GET', basePath(slug, auditId));
}

export function getEquipment(slug: string, id: string): Promise<EquipmentBase> {
  return request<EquipmentBase>('GET', itemPath(slug, id));
}

export function createEquipment(slug: string, auditId: string, body: Record<string, unknown>): Promise<EquipmentBase> {
  const config = getEquipmentConfig(slug);
  if (!config) throw new Error('Unknown equipment type');
  return request<EquipmentBase>('POST', basePath(slug, auditId), body);
}

export function updateEquipment(slug: string, id: string, body: Record<string, unknown>): Promise<EquipmentBase> {
  return request<EquipmentBase>('PATCH', itemPath(slug, id), body);
}

export function deleteEquipment(slug: string, id: string): Promise<void> {
  return request<void>('DELETE', itemPath(slug, id));
}
