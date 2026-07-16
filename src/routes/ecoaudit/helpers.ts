import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
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
  eaZones,
} from '../../db/schema/ecoaudit.js';
import { photoRegistry, recordVersions } from '../../db/schema/shared.js';
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
  await releaseCopyReferencesForParent('ecoaudit', auditId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'ecoaudit', parentId: auditId });

  await deleteLocalFile(reportPdfStorageKey);

  await db.delete(recordVersions).where(and(
    eq(recordVersions.app, 'ecoaudit'),
    eq(recordVersions.entityType, 'audit'),
    eq(recordVersions.entityId, auditId),
  ));

  await db.delete(eaMainSwitchboards).where(eq(eaMainSwitchboards.auditId, auditId));
  await db.delete(eaAdditionalSwitchboards).where(eq(eaAdditionalSwitchboards.auditId, auditId));
  await db.delete(eaHvacUnits).where(eq(eaHvacUnits.auditId, auditId));
  await db.delete(eaLightingSystems).where(eq(eaLightingSystems.auditId, auditId));
  await db.delete(eaSolarPv).where(eq(eaSolarPv.auditId, auditId));
  await db.delete(eaForkliftChargers).where(eq(eaForkliftChargers.auditId, auditId));
  await db.delete(eaHotWaterSystems).where(eq(eaHotWaterSystems.auditId, auditId));
  await db.delete(eaGeneralWater).where(eq(eaGeneralWater.auditId, auditId));
  await db.delete(eaGeneralElectricity).where(eq(eaGeneralElectricity.auditId, auditId));
  await db.delete(eaZones).where(eq(eaZones.auditId, auditId));
  await db.delete(eaAudits).where(eq(eaAudits.id, auditId));
}
