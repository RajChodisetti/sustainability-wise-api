import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { photoRegistry, recordVersions } from '../db/schema/shared.js';
import {
  contentTypeForStorageKey,
  localFileExists,
  localFileSize,
  publicFileUrl,
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

type AppName = 'ecoaudit' | 'solarsense';
type EntityType = 'audit' | 'site';

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

function fileResponse(
  file: StoredFileListing,
  metadataByKey: Map<string, typeof photoRegistry.$inferSelect>,
  reportPdfKeys: Set<string>,
) {
  const metadata = metadataByKey.get(file.storageKey);
  const isReportPdf = reportPdfKeys.has(file.storageKey);
  return {
    storageKey: file.storageKey,
    downloadUrl: publicFileUrl(file.storageKey),
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
}) {
  const registryRows = await db
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.app, input.app),
      eq(photoRegistry.parentId, input.parentId),
      eq(photoRegistry.status, 'confirmed'),
      ...(input.entityId ? [eq(photoRegistry.entityId, input.entityId)] : []),
    ));
  const metadataByKey = new Map(
    registryRows
      .filter((row) => row.storageKey)
      .map((row) => [row.storageKey as string, row]),
  );
  const reportPdfKeys = new Set(input.reportPdfLocalPath ? [input.reportPdfLocalPath] : []);
  const keys = [
    ...registryRows.map((row) => row.storageKey).filter((key): key is string => Boolean(key)),
    ...reportPdfKeys,
  ];
  const files = (await Promise.all(keys.map(storageListingForKey)))
    .filter((file): file is StoredFileListing => Boolean(file));
  return files.map((file) => fileResponse(file, metadataByKey, reportPdfKeys));
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
    });
    return reply.send({ app: 'ecoaudit', entityType: 'audit', auditRef, auditId: audit.id, auditName: audit.siteName, prefix, files });
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
}
