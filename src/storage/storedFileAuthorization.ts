import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import {
  ihFormSubmissions,
  ihInstallations,
} from '../db/schema/installhub.js';
import { pdfJobs } from '../db/schema/shared.js';
import { ssSites } from '../db/schema/solarsense.js';
import { assertAuditAccess } from '../routes/ecoaudit/helpers.js';
import { assertInstallationAccess } from '../routes/installhub/helpers.js';
import { assertSiteAccess } from '../routes/solarsense/helpers.js';
import { AppError, notFound } from '../utils/errors.js';
import { loadAuthorizedPhotoByReference } from './photoAuthorization.js';

function elevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

async function authorizeEcoAuditFile(
  storageKey: string,
  entityId: string | null,
  user: AuthUser,
): Promise<boolean> {
  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(
      entityId
        ? eq(eaAudits.id, entityId)
        : eq(eaAudits.reportPdfLocalPath, storageKey),
      isNull(eaAudits.deletedAt),
    ))
    .limit(1);
  if (!audit) return false;
  assertAuditAccess(audit, user);
  return true;
}

async function authorizeSolarSenseFile(
  storageKey: string,
  entityId: string | null,
  user: AuthUser,
): Promise<boolean> {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(
      entityId
        ? eq(ssSites.id, entityId)
        : eq(ssSites.reportPdfLocalPath, storageKey),
      isNull(ssSites.deletedAt),
    ))
    .limit(1);
  if (!site) return false;
  assertSiteAccess(site, user);
  return true;
}

async function installHubInstallationIdForJob(
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'installation') return entityId;
  if (entityType !== 'form_submission') return null;
  const [form] = await db
    .select({ installationId: ihFormSubmissions.installationId })
    .from(ihFormSubmissions)
    .where(and(
      eq(ihFormSubmissions.id, entityId),
      isNull(ihFormSubmissions.deletedAt),
    ))
    .limit(1);
  return form?.installationId ?? null;
}

async function authorizeInstallHubFile(
  entityType: string,
  entityId: string,
  user: AuthUser,
): Promise<boolean> {
  const installationId = await installHubInstallationIdForJob(entityType, entityId);
  if (!installationId) return false;
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(
      eq(ihInstallations.id, installationId),
      isNull(ihInstallations.deletedAt),
    ))
    .limit(1);
  if (!installation) return false;
  assertInstallationAccess(installation, user);
  return true;
}

export async function authorizeStoredFile(
  requestedStorageKey: string,
  user: AuthUser,
): Promise<string> {
  if (user.app === 'wattwatchers') throw notFound('File');

  try {
    const photo = await loadAuthorizedPhotoByReference(requestedStorageKey, user);
    return photo.storageKey;
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
  }

  const [job] = await db
    .select()
    .from(pdfJobs)
    .where(and(
      eq(pdfJobs.app, user.app),
      eq(pdfJobs.storageKey, requestedStorageKey),
      eq(pdfJobs.status, 'complete'),
    ))
    .limit(1);
  if (job) {
    if (job.userId === user.userId || elevated(user)) return requestedStorageKey;
    const accessible = user.app === 'ecoaudit'
      ? await authorizeEcoAuditFile(requestedStorageKey, job.entityId, user)
      : user.app === 'solarsense'
        ? await authorizeSolarSenseFile(requestedStorageKey, job.entityId, user)
        : await authorizeInstallHubFile(job.entityType, job.entityId, user);
    if (accessible) return requestedStorageKey;
  }

  const directReportAccessible = user.app === 'ecoaudit'
    ? await authorizeEcoAuditFile(requestedStorageKey, null, user)
    : user.app === 'solarsense'
      ? await authorizeSolarSenseFile(requestedStorageKey, null, user)
      : false;
  if (directReportAccessible) return requestedStorageKey;

  throw notFound('File');
}
