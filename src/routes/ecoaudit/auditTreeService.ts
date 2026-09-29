import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaAudits,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaHotWaterSystems,
  eaHvacUnits,
  eaLightingSystems,
  eaMainSwitchboards,
  eaSolarPv,
  eaWaterAssets,
  eaZones,
} from '../../db/schema/ecoaudit.js';
import { saveRecordVersion } from '../recordVersions.js';
import {
  ecoAuditClientInstanceId,
  loadEcoAuditLease,
  presentEcoAuditLease,
} from './auditConcurrency.js';
import type { AuthUser } from '../../auth/middleware.js';
import type { FastifyRequest } from 'fastify';
import { loadCurrentPhotosForParent } from '../../storage/photoCopyReferences.js';

export type EcoAuditTree = Awaited<ReturnType<typeof loadEcoAuditTree>>;

export async function loadEcoAuditTree(executor: any, auditId: string) {
  const [audit] = await executor.select().from(eaAudits).where(and(
    eq(eaAudits.id, auditId),
    isNull(eaAudits.deletedAt),
  ));
  if (!audit) return null;
  const active = <T extends { auditId: any; deletedAt: any; createdAt: any; id: any }>(table: T) => (
    executor.select().from(table).where(and(
      eq(table.auditId, auditId),
      isNull(table.deletedAt),
    )).orderBy(asc(table.createdAt), asc(table.id))
  );
  const [
    zones,
    mainSwitchboards,
    additionalSwitchboards,
    hvacUnits,
    lightingSystems,
    solarPv,
    forkliftChargers,
    hotWaterSystems,
    generalWater,
    generalElectricity,
    waterAssets,
  ] = await Promise.all([
    active(eaZones),
    active(eaMainSwitchboards),
    active(eaAdditionalSwitchboards),
    active(eaHvacUnits),
    active(eaLightingSystems),
    active(eaSolarPv),
    active(eaForkliftChargers),
    active(eaHotWaterSystems),
    active(eaGeneralWater),
    active(eaGeneralElectricity),
    active(eaWaterAssets),
  ]);
  return {
    audit,
    zones,
    mainSwitchboards,
    additionalSwitchboards,
    hvacUnits,
    lightingSystems,
    solarPv,
    forkliftChargers,
    hotWaterSystems,
    generalWater,
    generalElectricity,
    waterAssets,
  };
}

export async function loadConsistentEcoAuditTree(auditId: string) {
  return db.transaction(
    (tx) => loadEcoAuditTree(tx, auditId),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/**
 * Read the aggregate and its ownership row from one MVCC snapshot. Reading the
 * lease after the tree transaction can otherwise pair a pre-acquire revision
 * with a post-acquire lease (or a completed audit with a stale lease).
 */
export async function loadEcoAuditRefreshTree(executor: any, auditId: string, knownTreeRevision?: number) {
  if (knownTreeRevision !== undefined) {
    const [audit] = await executor.select().from(eaAudits).where(and(
      eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt),
    ));
    if (!audit) return null;
    if (audit.treeRevision === knownTreeRevision) return { audit, treeUnchanged: true as const };
  }
  return loadEcoAuditTree(executor, auditId);
}

export async function loadConsistentEcoAuditTreeWithLease(auditId: string, knownTreeRevision?: number) {
  return db.transaction(async (tx) => {
    const tree = await loadEcoAuditRefreshTree(tx, auditId, knownTreeRevision);
    const lease = tree ? await loadEcoAuditLease(tx, auditId) : undefined;
    return { tree, lease };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export function presentEcoAudit(
  audit: typeof eaAudits.$inferSelect,
  lease: Awaited<ReturnType<typeof loadEcoAuditLease>>,
  caller?: { userId: string; clientInstanceId?: string },
) {
  return {
    ...audit,
    // The v2 wire contract uses source* while the database names retain the
    // more explicit copied_from_* provenance.
    sourceAuditId: audit.copiedFromAuditId,
    sourceRecordVersionNumber: audit.copiedFromRecordVersionNumber,
    lineageRootAuditId: audit.lineageRootAuditId ?? audit.id,
    editLease: presentEcoAuditLease(lease, caller),
  };
}

export async function presentEcoAuditForRequest(
  executor: any,
  audit: typeof eaAudits.$inferSelect,
  user: AuthUser,
  request: FastifyRequest,
) {
  const lease = await loadEcoAuditLease(executor, audit.id);
  return presentEcoAudit(audit, lease, {
    userId: user.userId,
    clientInstanceId: ecoAuditClientInstanceId(request),
  });
}

function versionSnapshot(tree: NonNullable<EcoAuditTree>): unknown {
  // Convert Date instances and Drizzle row objects into the exact JSON value
  // persisted in record_versions before hashing/comparison.
  return JSON.parse(JSON.stringify(tree));
}

export async function pinEcoAuditRecordVersion(input: {
  executor: any;
  tree: NonNullable<EcoAuditTree>;
  userId: string;
}): Promise<number> {
  const photos = await loadCurrentPhotosForParent({
    app: 'ecoaudit',
    parentId: input.tree.audit.id,
    executor: input.executor,
    includeUnconfirmed: false,
  });
  return saveRecordVersion({
    app: 'ecoaudit',
    entityType: 'audit',
    entityId: input.tree.audit.id,
    snapshot: {
      ...(versionSnapshot(input.tree) as Record<string, unknown>),
      mediaManifest: photos.map((photo) => ({
        id: photo.id,
        checksum: photo.checksum,
        entityType: photo.entityType,
        entityId: photo.entityId,
        fieldName: photo.fieldName,
        contentType: photo.contentType,
        fileSizeBytes: photo.fileSizeBytes,
      })),
    },
    userId: input.userId,
    executor: input.executor,
  });
}
