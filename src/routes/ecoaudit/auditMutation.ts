import type { FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { eaAudits, eaZones } from '../../db/schema/ecoaudit.js';
import { conflict } from '../../utils/errors.js';
import { assertFound } from './helpers.js';
import {
  bumpEcoAuditTreeRevision,
  lockEcoAuditForMutation,
  type LockedAuditMutation,
} from './auditConcurrency.js';
import { loadEcoAuditTree, pinEcoAuditRecordVersion } from './auditTreeService.js';
import { reconcilePhotoCopyReferencesForParent } from '../../storage/photoCopyReferences.js';

export function withEcoAuditTreeRevision<T>(value: T, treeRevision: number): T {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value, treeRevision }
    : value;
}

/**
 * Run one direct child mutation under the parent aggregate row lock. Every
 * successful command advances treeRevision exactly once. The narrow completed
 * photoDescs correction path also pins a new immutable record version in the
 * same transaction.
 */
export async function mutateEcoAuditTree<T>(input: {
  auditId: string;
  user: AuthUser;
  request: FastifyRequest;
  zoneId?: string | null;
  completedPhotoMetadataValidation?: () => void;
  mutate: (executor: any, locked: LockedAuditMutation) => Promise<T>;
}): Promise<{
  value: T;
  audit: typeof eaAudits.$inferSelect;
  lease: LockedAuditMutation['lease'];
}> {
  return db.transaction(async (tx) => {
    const locked = await lockEcoAuditForMutation(tx, {
      auditId: input.auditId,
      user: input.user,
      request: input.request,
      allowCompletedWithoutLease: Boolean(input.completedPhotoMetadataValidation),
    });
    if (locked.audit.status === 'Completed') {
      input.completedPhotoMetadataValidation?.();
    }
    if (input.zoneId) {
      const [zone] = await tx.select({ auditId: eaZones.auditId }).from(eaZones).where(and(
        eq(eaZones.id, input.zoneId),
        eq(eaZones.auditId, input.auditId),
        isNull(eaZones.deletedAt),
      ));
      if (!zone) throw conflict('audit_child_scope_conflict');
    }
    const value = await input.mutate(tx, locked);
    await reconcilePhotoCopyReferencesForParent({
      app: 'ecoaudit',
      parentId: input.auditId,
      executor: tx as unknown as typeof db,
      actor: input.user,
    });
    let audit = await bumpEcoAuditTreeRevision(tx, locked);

    if (locked.audit.status === 'Completed') {
      const tree = assertFound(await loadEcoAuditTree(tx, audit.id), 'Audit');
      const recordVersionNumber = await pinEcoAuditRecordVersion({
        executor: tx,
        tree,
        userId: input.user.userId,
      });
      const [versioned] = await tx.update(eaAudits).set({
        recordVersionNumber,
      }).where(and(
        eq(eaAudits.id, audit.id),
        eq(eaAudits.treeRevision, audit.treeRevision),
      )).returning();
      audit = assertFound(versioned, 'Audit');
    }

    // Child mutation responses carry the accepted aggregate revision so the
    // caller can advance its CAS baseline without a second, racy tree read.
    const responseValue = withEcoAuditTreeRevision(value, audit.treeRevision);
    return { value: responseValue as T, audit, lease: locked.lease };
  });
}

export function isCompletedPhotoMetadataPatch(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'photoDescs';
}
