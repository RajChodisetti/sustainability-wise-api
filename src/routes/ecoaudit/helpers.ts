import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaAuditWorkSessions,
  eaAudits,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaHotWaterSystems,
  eaHvacUnits,
  eaLightingSystems,
  eaMainSwitchboards,
  eaSolarPv,
  eaZones,
} from '../../db/schema/ecoaudit.js';
import { photoRegistry, recordVersions } from '../../db/schema/shared.js';
import { assertNoSchedulerCommercialEvidenceBeforePurge } from '../../services/schedulerCommercialRetentionService.js';
import { deleteLocalFile } from '../../storage/localFiles.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { forbidden, notFound, badRequest } from '../../utils/errors.js';

export type JsonRecord = Record<string, unknown>;

export function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

export function assertAuditAccess(
  audit: { createdByUserId: string | null; assignedInspectorUserId?: string | null },
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (audit.createdByUserId === user.userId || audit.assignedInspectorUserId === user.userId) return;
  throw forbidden('Audit belongs to another user');
}

export function assertZoneAccess(
  zone: { auditId: string },
  auditOwnerUserId: string | null,
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (auditOwnerUserId !== user.userId) throw forbidden('Zone belongs to another user');
}

export function assertSelfOrAdmin(targetUserId: string, user: AuthUser): void {
  if (user.role === 'admin' || targetUserId === user.userId) return;
  throw forbidden('Cannot access another user');
}

export function assertFound<T>(value: T | undefined | null, resource: string): T {
  if (!value) throw notFound(resource);
  return value;
}

export function requiredString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${key} is required`);
  }
  return value.trim();
}

export function optionalString(body: JsonRecord, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

export function optionalNumber(body: JsonRecord, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${key} must be a number`);
  return n;
}

export function optionalStringArray(body: JsonRecord, key: string): string[] | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

export function optionalJson<T>(body: JsonRecord, key: string, fallback: T): T | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return fallback;
  return value as T;
}

export function dateOrNow(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function requireCompleted(records: Array<{ id?: string; status?: unknown }>, label: string): void {
  const bad = records.find(r => r.status !== 'Completed');
  if (bad) throw badRequest(`${label} ${bad.id ?? ''} must be Completed before sync`);
}

export function assertDraftMutable(record: { status?: unknown }, label: string): void {
  if (record.status === 'Completed') {
    throw badRequest(`${label} is completed. Copy the top-level audit to make changes.`);
  }
}

/**
 * Completed audits remain immutable except for their canonical PDF photo
 * metadata. This keeps post-sync caption/size corrections narrow while
 * preventing a metadata PATCH from being used to smuggle business-field edits.
 */
export function assertAuditOwnerPatchMutable(
  record: { status?: unknown },
  body: JsonRecord,
  label: string,
): void {
  if (record.status !== 'Completed') return;
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === 'photoDescs') return;
  assertDraftMutable(record, label);
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

export function photoMetadata(v: unknown): Record<string, { name?: string; largeInPdf?: boolean }> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};

  const output: Record<string, { name?: string; largeInPdf?: boolean }> = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!key || key.length > 160) continue;

    const value = typeof raw === 'string'
      ? { name: raw }
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : null;
    if (!value) continue;

    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
    const largeInPdf = value.largeInPdf === true;
    if (!name && !largeInPdf) continue;
    output[key] = {
      ...(name ? { name } : {}),
      ...(largeInPdf ? { largeInPdf: true } : {}),
    };
  }
  return output;
}

export function shouldPurgeQuery(query?: Record<string, unknown>): boolean {
  const value = query?.purge;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

export async function purgeEcoauditAuditTree(auditId: string, reportPdfStorageKey?: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [audit] = await tx.select({ id: eaAudits.id })
      .from(eaAudits)
      .where(eq(eaAudits.id, auditId))
      .for('update')
      .limit(1);
    if (!audit) throw badRequest('Audit was already purged');

    await assertNoSchedulerCommercialEvidenceBeforePurge(tx, {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: audit.id,
    });

    await tx.delete(recordVersions).where(and(
      eq(recordVersions.app, 'ecoaudit'),
      eq(recordVersions.entityType, 'audit'),
      eq(recordVersions.entityId, audit.id),
    ));
    await tx.delete(eaMainSwitchboards).where(eq(eaMainSwitchboards.auditId, audit.id));
    await tx.delete(eaAdditionalSwitchboards).where(eq(eaAdditionalSwitchboards.auditId, audit.id));
    await tx.delete(eaHvacUnits).where(eq(eaHvacUnits.auditId, audit.id));
    await tx.delete(eaLightingSystems).where(eq(eaLightingSystems.auditId, audit.id));
    await tx.delete(eaSolarPv).where(eq(eaSolarPv.auditId, audit.id));
    await tx.delete(eaForkliftChargers).where(eq(eaForkliftChargers.auditId, audit.id));
    await tx.delete(eaHotWaterSystems).where(eq(eaHotWaterSystems.auditId, audit.id));
    await tx.delete(eaGeneralWater).where(eq(eaGeneralWater.auditId, audit.id));
    await tx.delete(eaGeneralElectricity).where(eq(eaGeneralElectricity.auditId, audit.id));
    await tx.delete(eaZones).where(eq(eaZones.auditId, audit.id));
    await tx.delete(eaAuditWorkSessions).where(eq(eaAuditWorkSessions.auditId, audit.id));
    await tx.delete(eaAudits).where(eq(eaAudits.id, audit.id));
  });

  await releaseCopyReferencesForParent('ecoaudit', auditId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'ecoaudit', parentId: auditId });
  await deleteLocalFile(reportPdfStorageKey);
}
