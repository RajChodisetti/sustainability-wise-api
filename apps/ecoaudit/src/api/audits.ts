import { request } from '@/api/client';
import type { Audit } from '@/types/domain';

export function listAudits(): Promise<{ data: Audit[] }> {
  return request<{ data: Audit[] }>('GET', '/v1/ecoaudit/audits');
}

export function getAudit(id: string): Promise<Audit> {
  return request<Audit>('GET', `/v1/ecoaudit/audits/${encodeURIComponent(id)}`);
}

export function createAudit(body: Partial<Audit>): Promise<Audit> {
  return request<Audit>('POST', '/v1/ecoaudit/audits', body);
}

export function updateAudit(id: string, body: Partial<Audit>): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}`, body);
}

export function startAudit(id: string): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/start`);
}

export function completeAudit(id: string): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/complete`);
}

export function reopenAudit(id: string): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/reopen`);
}

export function deleteAudit(id: string, purge = false): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/audits/${encodeURIComponent(id)}${purge ? '?purge=true' : ''}`);
}
