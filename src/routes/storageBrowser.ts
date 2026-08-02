import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole, type AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihFormSubmissions, ihInstallations } from '../db/schema/installhub.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { pdfJobs, photoRegistry, recordVersions } from '../db/schema/shared.js';
import {
  contentTypeForStorageKey,
  localFileExists,
  localFileSize,
  makeNamedStoragePrefix,
  signedFileUrl,
  type StoredFileListing,
} from '../storage/localFiles.js';
import { badRequest, notFound } from '../utils/errors.js';
import { assertAuditAccess } from './ecoaudit/helpers.js';
import { assertSiteAccess } from './solarsense/helpers.js';
import {
  currentNamedPrefixForEcoAudit,
  currentNamedPrefixForSolarAssessment,
  currentNamedPrefixForSolarSite,
  loadEcoAuditByIdOrName,
  loadSolarsenseAssessmentByIdOrName,
  loadSolarsenseSiteByIdOrName,
} from '../services/storageNaming.js';
import { assertInstallationAccess } from './installhub/helpers.js';
import {
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
} from '../storage/photoCopyReferences.js';

type AppName = 'ecoaudit' | 'solarsense' | 'installhub';
type EntityType = 'audit' | 'site' | 'installation';

async function loadSolarSenseSiteForAccess(siteRef: string, user: Parameters<typeof assertSiteAccess>[1]) {
  const site = await loadSolarsenseSiteByIdOrName(siteRef);
  assertSiteAccess(site, user);
  return site;
}

async function loadEcoAuditForAccess(auditRef: string, user: Parameters<typeof assertAuditAccess>[1]) {
  const audit = await loadEcoAuditByIdOrName(auditRef);
  assertAuditAccess(audit, user);
  return audit;
}

async function loadInstallHubInstallationForAccess(
  installationId: string,
  user: Parameters<typeof assertInstallationAccess>[1],
) {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(
      eq(ihInstallations.id, installationId),
      isNull(ihInstallations.deletedAt),
    ));
  if (!installation) throw notFound('Installation');
  assertInstallationAccess(installation, user);
  return installation;
}

function fileResponse(
  file: StoredFileListing,
  metadataByKey: Map<string, typeof photoRegistry.$inferSelect>,
  reportPdfKeys: Set<string>,
) {
  const metadata = metadataByKey.get(file.storageKey);
  const isReportPdf = reportPdfKeys.has(file.storageKey);
  return {
    storageKey: file.storageKey,
    downloadUrl: signedFileUrl(file.storageKey),
    contentType: metadata?.contentType ?? contentTypeForStorageKey(file.storageKey),
    sizeBytes: metadata?.fileSizeBytes ?? file.sizeBytes,
    lastModified: file.lastModified?.toISOString() ?? null,
    source: metadata ? 'photo_registry' : isReportPdf ? 'report_pdf' : 'storage',
    photoId: metadata?.id ?? null,
    parentId: metadata?.parentId ?? null,
    entityType: metadata?.entityType ?? null,
    entityId: metadata?.entityId ?? null,
    fieldName: metadata?.fieldName ?? (isReportPdf ? 'report-pdf' : null),
    originalFilename: metadata?.originalFilename ?? null,
    status: metadata?.status ?? (isReportPdf ? 'confirmed' : null),
    uploadedAt: metadata?.uploadedAt?.toISOString() ?? null,
    createdAt: metadata?.createdAt?.toISOString() ?? null,
  };
}

async function storageListingForKey(storageKey: string): Promise<StoredFileListing | null> {
  if (!(await localFileExists(storageKey))) return null;
  return {
    storageKey,
    sizeBytes: await localFileSize(storageKey),
    lastModified: null,
  };
}

async function listFilesForRecords(input: {
  app: AppName;
  parentId: string;
  entityId?: string;
  reportPdfLocalPath?: string | null;
  reportPdfStorageKeys?: string[];
  actor: AuthUser;
}) {
  await reconcilePhotoCopyReferencesForParent({
    app: input.app,
    parentId: input.parentId,
    actor: input.actor,
  });
  const registryRows = (await loadPhotosForParent({
    app: input.app,
    parentId: input.parentId,
  })).filter((row) => !input.entityId || row.entityId === input.entityId);
  const metadataByKey = new Map(
    registryRows
      .filter((row) => row.storageKey)
      .map((row) => [row.storageKey as string, row]),
  );
  const reportPdfKeys = new Set([
    ...(input.reportPdfLocalPath ? [input.reportPdfLocalPath] : []),
    ...(input.reportPdfStorageKeys ?? []),
  ]);
  const keys = [...new Set([
    ...registryRows.map((row) => row.storageKey).filter((key): key is string => Boolean(key)),
    ...reportPdfKeys,
  ])];
  const files = (await Promise.all(keys.map(storageListingForKey)))
    .filter((file): file is StoredFileListing => Boolean(file));
  return files.map((file) => fileResponse(file, metadataByKey, reportPdfKeys));
}

async function completedInstallHubReportStorageKeys(
  installationId: string,
): Promise<string[]> {
  const forms = await db
    .select({ id: ihFormSubmissions.id })
    .from(ihFormSubmissions)
    .where(and(
      eq(ihFormSubmissions.installationId, installationId),
      isNull(ihFormSubmissions.deletedAt),
    ));
  const entityIds = [installationId, ...forms.map((form) => form.id)];
  const jobs = await db
    .select({ storageKey: pdfJobs.storageKey })
    .from(pdfJobs)
    .where(and(
      eq(pdfJobs.app, 'installhub'),
      eq(pdfJobs.status, 'complete'),
      isNotNull(pdfJobs.storageKey),
      inArray(pdfJobs.entityId, entityIds),
    ))
    .orderBy(desc(pdfJobs.createdAt));
  return jobs
    .map((job) => job.storageKey)
    .filter((storageKey): storageKey is string => Boolean(storageKey));
}

async function listVersions(app: AppName, entityType: EntityType, entityId: string) {
  return db
    .select({
      id: recordVersions.id,
      versionNumber: recordVersions.versionNumber,
      createdByUserId: recordVersions.createdByUserId,
      createdAt: recordVersions.createdAt,
    })
    .from(recordVersions)
    .where(and(
      eq(recordVersions.app, app),
      eq(recordVersions.entityType, entityType),
      eq(recordVersions.entityId, entityId),
    ))
    .orderBy(desc(recordVersions.versionNumber));
}

async function getVersion(app: AppName, entityType: EntityType, entityId: string, versionNumber: number) {
  const [version] = await db
    .select()
    .from(recordVersions)
    .where(and(
      eq(recordVersions.app, app),
      eq(recordVersions.entityType, entityType),
      eq(recordVersions.entityId, entityId),
      eq(recordVersions.versionNumber, versionNumber),
    ));
  if (!version) throw notFound('Version');
  return version;
}

function parseVersionNumber(raw: string): number {
  const versionNumber = Number(raw);
  if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
    throw badRequest('versionNumber must be a positive integer');
  }
  return versionNumber;
}

export async function storageBrowserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/solarsense/sites/:siteId/files', {
    schema: {
      tags: ['Files'],
      summary: 'List stored SolarSense files for a site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId: siteRef } = request.params as { siteId: string };
    const site = await loadSolarSenseSiteForAccess(siteRef, request.user);
    const prefix = currentNamedPrefixForSolarSite(site);
    const files = await listFilesForRecords({
      app: 'solarsense',
      parentId: site.id,
      reportPdfLocalPath: site.reportPdfLocalPath,
      actor: request.user,
    });
    return reply.send({ app: 'solarsense', entityType: 'site', siteRef, siteId: site.id, siteName: site.siteName, prefix, files });
  });

  app.get('/v1/solarsense/assessments/:assessmentId/files', {
    schema: {
      tags: ['Files'],
      summary: 'List stored SolarSense files for an assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { assessmentId: assessmentRef } = request.params as { assessmentId: string };
    const assessment = await loadSolarsenseAssessmentByIdOrName(assessmentRef);
    if (!assessment?.siteId) throw notFound('Assessment');
    const site = await loadSolarSenseSiteForAccess(assessment.siteId, request.user);
    const prefix = currentNamedPrefixForSolarAssessment(site, assessment);
    const files = await listFilesForRecords({
      app: 'solarsense',
      parentId: assessment.siteId,
      entityId: assessment.id,
      actor: request.user,
    });
    return reply.send({
      app: 'solarsense',
      entityType: 'assessment',
      siteId: assessment.siteId,
      siteName: site.siteName,
      assessmentRef,
      assessmentId: assessment.id,
      assessmentName: assessment.buildingIdName,
      prefix,
      files,
    });
  });

  app.get('/v1/ecoaudit/audits/:auditId/files', {
    schema: {
      tags: ['Files'],
      summary: 'List stored EcoAudit files for an audit',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditForAccess(auditRef, request.user);
    const prefix = currentNamedPrefixForEcoAudit(audit);
    const files = await listFilesForRecords({
      app: 'ecoaudit',
      parentId: audit.id,
      reportPdfLocalPath: audit.reportPdfLocalPath,
      actor: request.user,
    });
    return reply.send({ app: 'ecoaudit', entityType: 'audit', auditRef, auditId: audit.id, auditName: audit.siteName, prefix, files });
  });

  app.get('/v1/installhub/installations/:installationId/files', {
    schema: {
      tags: ['Files'],
      summary: 'List stored Field App Complete files for an installation',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const installation = await loadInstallHubInstallationForAccess(
      installationId,
      request.user,
    );
    const reportPdfStorageKeys = await completedInstallHubReportStorageKeys(
      installation.id,
    );
    const prefix = makeNamedStoragePrefix({
      app: 'installhub',
      parentName: installation.siteName,
    });
    const files = await listFilesForRecords({
      app: 'installhub',
      parentId: installation.id,
      reportPdfStorageKeys,
      actor: request.user,
    });
    return reply.send({
      app: 'installhub',
      entityType: 'installation',
      installationId: installation.id,
      installationName: installation.siteName,
      prefix,
      files,
    });
  });

  app.get('/v1/solarsense/sites/:siteId/versions', {
    schema: { tags: ['Files'], summary: 'List SolarSense site versions', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    await loadSolarSenseSiteForAccess(siteId, request.user);
    return reply.send({ app: 'solarsense', entityType: 'site', entityId: siteId, versions: await listVersions('solarsense', 'site', siteId) });
  });

  app.get('/v1/solarsense/sites/:siteId/versions/:versionNumber', {
    schema: { tags: ['Files'], summary: 'Get a SolarSense site version', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, versionNumber } = request.params as { siteId: string; versionNumber: string };
    await loadSolarSenseSiteForAccess(siteId, request.user);
    return reply.send(await getVersion('solarsense', 'site', siteId, parseVersionNumber(versionNumber)));
  });

  app.get('/v1/ecoaudit/audits/:auditId/versions', {
    schema: { tags: ['Files'], summary: 'List EcoAudit audit versions', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    await loadEcoAuditForAccess(auditId, request.user);
    return reply.send({ app: 'ecoaudit', entityType: 'audit', entityId: auditId, versions: await listVersions('ecoaudit', 'audit', auditId) });
  });

  app.get('/v1/ecoaudit/audits/:auditId/versions/:versionNumber', {
    schema: { tags: ['Files'], summary: 'Get an EcoAudit audit version', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId, versionNumber } = request.params as { auditId: string; versionNumber: string };
    await loadEcoAuditForAccess(auditId, request.user);
    return reply.send(await getVersion('ecoaudit', 'audit', auditId, parseVersionNumber(versionNumber)));
  });

  app.get('/v1/installhub/installations/:installationId/versions', {
    schema: {
      tags: ['Files'],
      summary: 'List Field App Complete installation versions',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await loadInstallHubInstallationForAccess(installationId, request.user);
    return reply.send({
      app: 'installhub',
      entityType: 'installation',
      entityId: installationId,
      versions: await listVersions('installhub', 'installation', installationId),
    });
  });

  app.get('/v1/installhub/installations/:installationId/versions/:versionNumber', {
    schema: {
      tags: ['Files'],
      summary: 'Get a Field App Complete installation version',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const { installationId, versionNumber } = request.params as {
      installationId: string;
      versionNumber: string;
    };
    await loadInstallHubInstallationForAccess(installationId, request.user);
    return reply.send(await getVersion(
      'installhub',
      'installation',
      installationId,
      parseVersionNumber(versionNumber),
    ));
  });
}
