import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { photoRegistry, recordVersions } from '../db/schema/shared.js';
import {
  contentTypeForStorageKey,
  listStoredFiles,
  makeStoragePrefix,
  publicFileUrl,
  type StoredFileListing,
} from '../storage/localFiles.js';
import { badRequest, notFound } from '../utils/errors.js';
import { assertAuditAccess } from './ecoaudit/helpers.js';
import { assertSiteAccess } from './solarsense/helpers.js';

type AppName = 'ecoaudit' | 'solarsense';
type EntityType = 'audit' | 'site';

async function loadSolarSenseSiteForAccess(siteId: string, user: Parameters<typeof assertSiteAccess>[1]) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  if (!site) throw notFound('Site');
  assertSiteAccess(site, user);
  return site;
}

async function loadEcoAuditForAccess(auditId: string, user: Parameters<typeof assertAuditAccess>[1]) {
  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
  if (!audit) throw notFound('Audit');
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

async function listFilesForPrefix(input: {
  app: AppName;
  prefix: string;
  parentId: string;
  entityId?: string;
  reportPdfLocalPath?: string | null;
}) {
  const [files, registryRows] = await Promise.all([
    listStoredFiles(input.prefix),
    db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, input.app),
        eq(photoRegistry.parentId, input.parentId),
        ...(input.entityId ? [eq(photoRegistry.entityId, input.entityId)] : []),
      )),
  ]);
  const metadataByKey = new Map(
    registryRows
      .filter((row) => row.storageKey)
      .map((row) => [row.storageKey as string, row]),
  );
  const reportPdfKeys = new Set(input.reportPdfLocalPath ? [input.reportPdfLocalPath] : []);
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
    const { siteId } = request.params as { siteId: string };
    const site = await loadSolarSenseSiteForAccess(siteId, request.user);
    const prefix = makeStoragePrefix({ app: 'solarsense', parentId: siteId });
    const files = await listFilesForPrefix({
      app: 'solarsense',
      prefix,
      parentId: siteId,
      reportPdfLocalPath: site.reportPdfLocalPath,
    });
    return reply.send({ app: 'solarsense', entityType: 'site', siteId, prefix, files });
  });

  app.get('/v1/solarsense/assessments/:assessmentId/files', {
    schema: {
      tags: ['Files'],
      summary: 'List stored SolarSense files for an assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { assessmentId } = request.params as { assessmentId: string };
    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(eq(ssRooftopAssessments.id, assessmentId), isNull(ssRooftopAssessments.deletedAt)));
    if (!assessment?.siteId) throw notFound('Assessment');
    await loadSolarSenseSiteForAccess(assessment.siteId, request.user);
    const prefix = makeStoragePrefix({
      app: 'solarsense',
      parentId: assessment.siteId,
      entityType: 'rooftop_assessment',
      entityId: assessmentId,
    });
    const files = await listFilesForPrefix({
      app: 'solarsense',
      prefix,
      parentId: assessment.siteId,
      entityId: assessmentId,
    });
    return reply.send({
      app: 'solarsense',
      entityType: 'assessment',
      siteId: assessment.siteId,
      assessmentId,
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
    const { auditId } = request.params as { auditId: string };
    const audit = await loadEcoAuditForAccess(auditId, request.user);
    const prefix = makeStoragePrefix({ app: 'ecoaudit', parentId: auditId });
    const files = await listFilesForPrefix({
      app: 'ecoaudit',
      prefix,
      parentId: auditId,
      reportPdfLocalPath: audit.reportPdfLocalPath,
    });
    return reply.send({ app: 'ecoaudit', entityType: 'audit', auditId, prefix, files });
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
