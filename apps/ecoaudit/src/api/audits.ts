import { request } from '@/api/client';
import {
  auditClientHeaders,
  auditWriteHeaders,
  type PendingAuditAcquireCommand,
  type PendingAuditCopyCommand,
  type PendingAuditCreateCommand,
} from '@/lib/auditProtocol';
import type { Audit, AuditEditLease, AuditTree, AuditWriteGuard } from '@/types/domain';

export type AuditLeaseResult = {
  audit?: Audit;
  treeRevision: number;
  editFence: number;
  leaseToken: string;
  editLease: AuditEditLease;
};

export type AuditLeaseHeartbeatResult = {
  auditId: string;
  treeRevision: number;
  editFence: number;
  editLease: AuditEditLease;
};

export type CreateAuditResult = AuditLeaseResult & { audit: Audit };

export type AuditAmendmentResult = CreateAuditResult & {
  sourceAuditId: string;
  sourceRecordVersionNumber: number;
};

function assertValidLeaseResult(
  result: AuditLeaseResult,
  clientInstanceId: string,
  requireAudit: boolean,
): void {
  if (
    !Number.isSafeInteger(result.treeRevision)
    || result.treeRevision < 0
    || !Number.isSafeInteger(result.editFence)
    || result.editFence < 1
    || typeof result.leaseToken !== 'string'
    || !result.leaseToken
    || !result.editLease
    || result.editLease.clientInstanceId !== clientInstanceId
    || result.editLease.fence !== result.editFence
    || result.editLease.ownedByCaller !== true
    || (requireAudit && (!result.audit || typeof result.audit.id !== 'string' || !result.audit.id))
  ) {
    throw new Error('The API returned an invalid protected editing response. The saved command was kept for a safe retry.');
  }
}

function normalizeAudit(audit: Audit, fallbackRevision?: number, fallbackFence?: number): Audit {
  return {
    ...audit,
    treeRevision: Number.isSafeInteger(audit.treeRevision)
      ? audit.treeRevision
      : Number.isSafeInteger(fallbackRevision) ? fallbackRevision! : 0,
    editFence: Number.isSafeInteger(audit.editFence)
      ? audit.editFence
      : Number.isSafeInteger(fallbackFence) ? fallbackFence : audit.editLease?.fence,
  };
}

export async function listAudits(): Promise<{ data: Audit[] }> {
  const response = await request<{ data: Audit[] }>(
    'GET',
    '/v1/ecoaudit/audits',
    undefined,
    { headers: auditClientHeaders() },
  );
  return { ...response, data: response.data.map((audit) => normalizeAudit(audit)) };
}

export async function getAudit(id: string): Promise<Audit> {
  return normalizeAudit(await request<Audit>(
    'GET',
    `/v1/ecoaudit/audits/${encodeURIComponent(id)}`,
    undefined,
    { headers: auditClientHeaders() },
  ));
}

export async function getAuditTree(id: string): Promise<AuditTree> {
  const response = await request<AuditTree>(
    'GET',
    `/v1/ecoaudit/audits/${encodeURIComponent(id)}/tree`,
    undefined,
    { headers: auditClientHeaders() },
  );
  return { ...response, audit: normalizeAudit(response.audit, response.treeRevision) };
}

export async function createAudit(
  command: PendingAuditCreateCommand,
): Promise<CreateAuditResult> {
  const response = await request<CreateAuditResult>(
    'POST',
    '/v1/ecoaudit/audits',
    command.body,
    {
      headers: {
        ...auditClientHeaders(command.clientInstanceId),
        'Idempotency-Key': command.idempotencyKey,
      },
    },
  );
  assertValidLeaseResult(response, command.clientInstanceId, true);
  return { ...response, audit: normalizeAudit(response.audit, response.treeRevision, response.editFence) };
}

export function updateAudit(id: string, body: Partial<Audit>, guard: AuditWriteGuard): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}`, body, {
    headers: auditWriteHeaders(guard),
  });
}

export function startAudit(id: string, guard: AuditWriteGuard): Promise<Audit> {
  return request<Audit>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/start`, undefined, {
    headers: auditWriteHeaders(guard),
  });
}

export async function completeAudit(id: string, guard: AuditWriteGuard, idempotencyKey: string): Promise<Audit> {
  const response = await request<{
    audit: Audit;
    treeRevision: number;
    editFence: number;
    recordVersionNumber: number;
  }>('PATCH', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/complete`, undefined, {
    headers: auditWriteHeaders(guard, idempotencyKey),
  });
  return normalizeAudit(response.audit, response.treeRevision, response.editFence);
}

export function deleteAudit(id: string, guard: AuditWriteGuard): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/audits/${encodeURIComponent(id)}`, undefined, {
    headers: auditWriteHeaders(guard),
  });
}

export async function acquireAuditEditLease(
  command: PendingAuditAcquireCommand,
): Promise<AuditLeaseResult> {
  const response = await request<AuditLeaseResult>(
    'POST',
    `/v1/ecoaudit/audits/${encodeURIComponent(command.auditId)}/edit-lease`,
    command.body,
    {
      headers: {
        ...auditClientHeaders(command.clientInstanceId),
        'Idempotency-Key': command.idempotencyKey,
      },
    },
  );
  assertValidLeaseResult(response, command.clientInstanceId, false);
  return response;
}

export function releaseAuditEditLease(id: string, guard: AuditWriteGuard): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/audits/${encodeURIComponent(id)}/edit-lease`, undefined, {
    headers: auditWriteHeaders(guard),
  });
}

export function renewAuditEditLease(
  id: string,
  guard: AuditWriteGuard,
): Promise<AuditLeaseHeartbeatResult> {
  return request<AuditLeaseHeartbeatResult>(
    'PUT',
    `/v1/ecoaudit/audits/${encodeURIComponent(id)}/edit-lease`,
    undefined,
    { headers: auditWriteHeaders(guard) },
  );
}

export async function createAuditAmendment(
  command: PendingAuditCopyCommand,
): Promise<AuditAmendmentResult> {
  const response = await request<AuditAmendmentResult>(
    'POST',
    `/v1/ecoaudit/audits/${encodeURIComponent(command.sourceAuditId)}/copy`,
    command.body,
    {
      headers: {
        ...auditClientHeaders(command.clientInstanceId),
        'X-EcoAudit-Base-Tree-Revision': String(command.body.expectedTreeRevision),
        'Idempotency-Key': command.idempotencyKey,
      },
    },
  );
  assertValidLeaseResult(response, command.clientInstanceId, true);
  return { ...response, audit: normalizeAudit(response.audit, response.treeRevision, response.editFence) };
}
