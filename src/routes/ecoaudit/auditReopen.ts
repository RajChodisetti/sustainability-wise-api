import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { completeLinkedSchedulerEvents } from '../../services/schedulerCompletionService.js';
import { conflict } from '../../utils/errors.js';
import { assertAuditAccess, assertFound } from './helpers.js';
import { resolveReopenTiming } from './auditTiming.js';
import {
  bumpEcoAuditTreeRevision,
  canonicalCommandFingerprint,
  createEcoAuditLeaseForNewAudit,
  ecoAuditCommandLeaseToken,
  loadEcoAuditLease,
  recoverCommandLease,
  replayEcoAuditCommand,
  saveEcoAuditCommand,
  type EcoAuditLeaseRequest,
} from './auditConcurrency.js';
import { loadEcoAuditTree, pinEcoAuditRecordVersion, presentEcoAudit } from './auditTreeService.js';

export function assertEcoAuditReopenAllowed(
  audit: { status: string; treeRevision: number },
  expectedTreeRevision: number,
): void {
  if (audit.treeRevision !== expectedTreeRevision) throw conflict('audit_tree_revision_changed');
  if (audit.status !== 'Completed') throw conflict('audit_reopen_requires_completed');
}

/** Reopen the fetched completion and issue its new editing ownership atomically. */
export async function reopenCompletedEcoAudit(input: {
  auditId: string;
  user: AuthUser;
  client: EcoAuditLeaseRequest;
  idempotencyKey: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.auditId), isNull(eaAudits.deletedAt),
    )).for('update');
    const audit = assertFound(row, 'Audit');
    assertAuditAccess(audit, input.user);
    const scope = {
      auditId: audit.id,
      operation: 'reopen' as const,
      actorUserId: input.user.userId,
      clientInstanceId: input.client.clientInstanceId,
      idempotencyKey: input.idempotencyKey,
    };
    const requestFingerprint = canonicalCommandFingerprint({ ...scope, client: input.client });
    const prior = await replayEcoAuditCommand(tx, { ...scope, requestFingerprint });
    const currentLease = await loadEcoAuditLease(tx, audit.id);
    if (prior) {
      // A retry can recover only the same still-current ownership. It must
      // never reopen a later completion or rotate a subsequent editor's lease.
      const recovered = recoverCommandLease({
        audit, lease: currentLease, user: input.user, client: input.client,
        operation: 'reopen', idempotencyKey: input.idempotencyKey,
        expectedTreeRevision: Number(prior.treeRevision), expectedFence: Number(prior.editFence),
      });
      return {
        audit: presentEcoAudit(audit, recovered.lease, { userId: input.user.userId, clientInstanceId: input.client.clientInstanceId }),
        leaseToken: recovered.leaseToken, treeRevision: audit.treeRevision,
        editFence: audit.editFence, replayed: true,
      };
    }
    assertEcoAuditReopenAllowed(audit, input.client.expectedTreeRevision);
    if (currentLease) throw conflict('audit_edit_lease_held');

    // Legacy completions may not yet have a canonical version. Pin their full
    // tree before clearing the completion; existing versions remain unchanged.
    const recordVersionNumber = audit.recordVersionNumber || await pinEcoAuditRecordVersion({
      executor: tx, tree: assertFound(await loadEcoAuditTree(tx, audit.id), 'Audit'), userId: input.user.userId,
    });
    await completeLinkedSchedulerEvents(tx, {
      sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: audit.id,
    }, { observedAt: new Date(), completionProvenance: 'historical_replay' });
    const updated = await bumpEcoAuditTreeRevision(tx, {
      audit, lease: undefined, writeContext: null,
    }, {
      status: 'Draft', ...resolveReopenTiming(audit),
      editFence: audit.editFence + 1, recordVersionNumber,
      reportPdfRemoteUrl: null, reportPdfLocalPath: null,
    });
    const issued = await createEcoAuditLeaseForNewAudit(tx, {
      auditId: audit.id, actorUserId: input.user.userId, client: input.client,
      fence: updated.editFence, leaseToken: ecoAuditCommandLeaseToken(scope),
      reason: 'Reopened completed audit at tree revision ' + audit.treeRevision,
    });
    await saveEcoAuditCommand(tx, {
      ...scope, requestFingerprint,
      baseTreeRevision: audit.treeRevision, resultingTreeRevision: updated.treeRevision,
      recordVersionNumber,
      result: { auditId: audit.id, treeRevision: updated.treeRevision, editFence: updated.editFence },
    });
    return {
      audit: presentEcoAudit(updated, issued.lease, { userId: input.user.userId, clientInstanceId: input.client.clientInstanceId }),
      leaseToken: issued.leaseToken, treeRevision: updated.treeRevision,
      editFence: updated.editFence, replayed: false,
    };
  });
}
