import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { photoRegistry, recordVersions } from '../../db/schema/shared.js';
import { deleteLocalFile } from '../../storage/localFiles.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  releaseCopyReferencesForEntity,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { forbidden, notFound, badRequest } from '../../utils/errors.js';

export type JsonRecord = Record<string, unknown>;

export function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

export function assertSiteAccess(
  site: { createdByUserId: string | null },
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (site.createdByUserId !== user.userId) throw forbidden('Site belongs to another user');
}

export function canAccessAssessment(
  site: { createdByUserId: string | null; status: string; deletedAt?: Date | string | null },
  assessment: { assignedInspectorUserId?: string | null },
  user: AuthUser,
): boolean {
  return isElevated(user)
    || site.createdByUserId === user.userId
    || (
      site.status === 'Draft'
      && !site.deletedAt
      && assessment.assignedInspectorUserId === user.userId
    );
}

export function assertAssessmentAccess(
  site: { createdByUserId: string | null; status: string; deletedAt?: Date | string | null },
  assessment: { assignedInspectorUserId?: string | null },
  user: AuthUser,
): void {
  if (!canAccessAssessment(site, assessment, user)) {
    throw forbidden('Rooftop assessment belongs to another user');
  }
}

export async function hasAssignedAssessmentAccess(
  site: { id: string; status: string; deletedAt?: Date | string | null },
  user: AuthUser,
): Promise<boolean> {
  if (site.status !== 'Draft' || site.deletedAt) return false;
  const [assigned] = await db
    .select({ id: ssRooftopAssessments.id })
    .from(ssRooftopAssessments)
    .where(and(
      eq(ssRooftopAssessments.siteId, site.id),
      eq(ssRooftopAssessments.assignedInspectorUserId, user.userId),
      isNull(ssRooftopAssessments.deletedAt),
    ))
    .limit(1);
  return Boolean(assigned);
}

export async function assertSiteContextAccess(
  site: {
    id: string;
    status: string;
    createdByUserId: string | null;
    deletedAt?: Date | string | null;
  },
  user: AuthUser,
): Promise<void> {
  if (isElevated(user) || site.createdByUserId === user.userId) return;
  if (await hasAssignedAssessmentAccess(site, user)) return;
  throw forbidden('Site belongs to another user');
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
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw badRequest(`${key} must be a number`);
  return numberValue;
}

export function optionalBoolean(body: JsonRecord, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  return Boolean(body[key]);
}

export function optionalJson<T>(body: JsonRecord, key: string, fallback: T): T | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return fallback;
  return value as T;
}

export function optionalDate(body: JsonRecord, key: string): Date | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest(`${key} must be an ISO date`);
  return date;
}

export function dateOrNow(value: unknown): Date {
  if (!value) return new Date();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function requireCompleted(records: Array<{ id?: string; status?: unknown }>, label: string): void {
  const incomplete = records.find((record) => record.status !== 'Completed');
  if (incomplete) {
    throw badRequest(`${label} ${incomplete.id ?? ''} must be Completed before sync`);
  }
}

export function assertDraftMutable(record: { status?: unknown }, label: string): void {
  if (record.status === 'Completed') {
    throw badRequest(`${label} is completed. Copy the top-level site to make changes.`);
  }
}

export function shouldPurgeQuery(query?: Record<string, unknown>): boolean {
  const value = query?.purge;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

export async function purgeSolarsenseAssessment(assessmentId: string): Promise<void> {
  await releaseCopyReferencesForEntity('solarsense', assessmentId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'solarsense', entityId: assessmentId });
  await db.delete(ssRooftopAssessments).where(eq(ssRooftopAssessments.id, assessmentId));
}

export async function purgeSolarsenseSiteTree(siteId: string, reportPdfStorageKey?: string | null): Promise<void> {
  await releaseCopyReferencesForParent('solarsense', siteId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'solarsense', parentId: siteId });

  await deleteLocalFile(reportPdfStorageKey);

  await db.delete(recordVersions).where(and(
    eq(recordVersions.app, 'solarsense'),
    eq(recordVersions.entityType, 'site'),
    eq(recordVersions.entityId, siteId),
  ));

  await db.delete(ssRooftopAssessments).where(eq(ssRooftopAssessments.siteId, siteId));
  await db.delete(ssSites).where(eq(ssSites.id, siteId));
}
