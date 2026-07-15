import { request } from '@/api/client';
import type { Zone } from '@/types/domain';

export function listZones(auditId: string): Promise<{ data: Zone[] }> {
  return request<{ data: Zone[] }>('GET', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/zones`);
}

export function getZone(id: string): Promise<Zone> {
  return request<Zone>('GET', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`);
}

export function createZone(auditId: string, body: Partial<Zone>): Promise<Zone> {
  return request<Zone>('POST', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/zones`, body);
}

export function updateZone(id: string, body: Partial<Zone>): Promise<Zone> {
  return request<Zone>('PATCH', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`, body);
}

export function deleteZone(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/zones/${encodeURIComponent(id)}`);
}
