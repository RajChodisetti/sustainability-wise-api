import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertSiteAccess,
  dateOrNow,
  isElevated,
  requireCompleted,
  requiredString,
  type JsonRecord,
} from './helpers.js';
import { badRequest } from '../../utils/errors.js';
import {
  deleteLocalFile,
  localFileExists,
  makeLocalStorageKey,
  publicFileUrl,
  writeLocalFile,
} from '../../storage/localFiles.js';

async function loadAccessibleSite(siteId: string, request: { user: Parameters<typeof assertSiteAccess>[1] }) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  const found = assertFound(site, 'Site');
  assertSiteAccess(found, request.user);
  return found;
}

function statusMustBeCompleted(record: { status: string }, label: string): void {
  if (record.status !== 'Completed') throw badRequest(`${label} must be Completed before sync`);
}

function uploadUrl(sessionId: string): string {
  return `${config.publicBaseUrl}/v1/solarsense/sync/upload/${sessionId}`;
}

function assertUploadSessionFresh(createdAt: Date): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (Date.now() - createdAt.getTime() > maxAgeMs) {
    throw badRequest('Upload session has expired');
  }
}

function siteValuesFromPayload(site: JsonRecord, userId: string, existing?: typeof ssSites.$inferSelect) {
  const id = requiredString(site, 'id');
  const serverId =
    existing?.serverId ??
    (typeof site.serverId === 'string' && site.serverId.trim() ? site.serverId.trim() : randomUUID());
  return {
    id,
    serverId,
    syncStatus: 'synced',
    updatedAt: dateOrNow(site.updatedAt),
    deletedAt: site.deletedAt ? dateOrNow(site.deletedAt) : null,
    siteName: requiredString(site, 'siteName'),
    location: typeof site.location === 'string' ? site.location : null,
    dateOfAssessment: typeof site.dateOfAssessment === 'string' ? site.dateOfAssessment : null,
    documentClassification: typeof site.documentClassification === 'string' ? site.documentClassification : null,
    electricalInfrastructureSummary: typeof site.electricalInfrastructureSummary === 'string' ? site.electricalInfrastructureSummary : null,
    knownConstraints: typeof site.knownConstraints === 'string' ? site.knownConstraints : null,
    loadProfileMeteringSummary: typeof site.loadProfileMeteringSummary === 'string' ? site.loadProfileMeteringSummary : null,
    ppaAssetDemarcation: typeof site.ppaAssetDemarcation === 'string' ? site.ppaAssetDemarcation : null,
    appendixNotes: typeof site.appendixNotes === 'string' ? site.appendixNotes : null,
    appendixItems: Array.isArray(site.appendixItems) ? site.appendixItems : [],
    reportPdfLocalPath: typeof site.reportPdfLocalPath === 'string' ? site.reportPdfLocalPath : null,
    reportPdfRemoteUrl: typeof site.reportPdfRemoteUrl === 'string' ? site.reportPdfRemoteUrl : null,
    createdByUserId: existing?.createdByUserId ?? (typeof site.createdByUserId === 'string' ? site.createdByUserId : userId),
    createdAt: dateOrNow(site.createdAt),
    status: 'Completed',
  };
}

function assessmentValuesFromPayload(
  assessment: JsonRecord,
  userId: string,
  existing?: typeof ssRooftopAssessments.$inferSelect,
) {
  const id = requiredString(assessment, 'id');
  const serverId =
    existing?.serverId ??
    (typeof assessment.serverId === 'string' && assessment.serverId.trim()
      ? assessment.serverId.trim()
      : randomUUID());
  const num = (key: string) => {
    const value = assessment[key];
    if (value === null || value === undefined || value === '') return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  const str = (key: string) => typeof assessment[key] === 'string' ? String(assessment[key]) : null;
  const bool = (key: string) => Boolean(assessment[key]);

  return {
    id,
    serverId,
    syncStatus: 'synced',
    updatedAt: dateOrNow(assessment.updatedAt),
    deletedAt: assessment.deletedAt ? dateOrNow(assessment.deletedAt) : null,
    siteId: str('siteId'),
    siteName: requiredString(assessment, 'siteName'),
    buildingIdName: requiredString(assessment, 'buildingIdName'),
    heritageStatus: str('heritageStatus'),
    heritageDealBreaker: bool('heritageDealBreaker'),
    aerialPhotoUri: str('aerialPhotoUri'),
    roofAreaTotalM2: num('roofAreaTotalM2'),
    roofMaterial: str('roofMaterial'),
    roofFramingType: str('roofFramingType'),
    roofPitchAngle: str('roofPitchAngle'),
    roofConstructionMaterial: str('roofConstructionMaterial'),
    asbestosFlag: bool('asbestosFlag'),
    roofCondition: str('roofCondition'),
    roofEstimatedAge: str('roofEstimatedAge'),
    roofOrientationPrimary: str('roofOrientationPrimary'),
    roofShadingSources: str('roofShadingSources'),
    roofShadingUsablePct: str('roofShadingUsablePct'),
    roofOrientationShading: str('roofOrientationShading'),
    structuralFeasibility: str('structuralFeasibility'),
    structuralRiskFlag: bool('structuralRiskFlag'),
    roofAreaUsableM2: num('roofAreaUsableM2'),
    pvSizeKwDc: num('pvSizeKwDc'),
    acExportKw: num('acExportKw'),
    accessSafetyConstraints: str('accessSafetyConstraints'),
    switchboards: Array.isArray(assessment.switchboards) ? assessment.switchboards : [],
    msbDetails: str('msbDetails'),
    msbPhotoUri: str('msbPhotoUri'),
    existingGeneration: str('existingGeneration'),
    distanceToConnectionM: num('distanceToConnectionM'),
    electricalPitsEntry: str('electricalPitsEntry'),
    inverterSiting: str('inverterSiting'),
    transformerSupplyCapacity: str('transformerSupplyCapacity'),
    dnspConstraints: str('dnspConstraints'),
    loadProfileMetering: str('loadProfileMetering'),
    otherConsiderations: Array.isArray(assessment.otherConsiderations) ? assessment.otherConsiderations : [],
    siteRepFeedback: str('siteRepFeedback'),
    viabilityStatus: str('viabilityStatus'),
    dealBreakerReason: str('dealBreakerReason'),
    ragPriority: str('ragPriority'),
    keyAssumptionsGaps: str('keyAssumptionsGaps'),
    additionalPhotos: Array.isArray(assessment.additionalPhotos) ? assessment.additionalPhotos : [],
    photoMetadata: assessment.photoMetadata && typeof assessment.photoMetadata === 'object' ? assessment.photoMetadata : {},
    createdByUserId: existing?.createdByUserId ?? (typeof assessment.createdByUserId === 'string' ? assessment.createdByUserId : userId),
    createdAt: dateOrNow(assessment.createdAt),
    status: 'Completed',
  };
}

export async function solarsenseSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/check-photo', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Check whether a SolarSense photo checksum already exists',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');

    const [existing] = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.status, 'confirmed'),
      ));

    return reply.send({
      exists: Boolean(existing),
      remoteUrl: existing?.remoteUrl,
      fileSizeBytes: existing?.fileSizeBytes,
      photoId: existing?.id,
    });
  });

  app.post('/create-upload-session', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Create a VM-local photo upload session',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const siteId = requiredString(body, 'siteId');
    const fieldName = requiredString(body, 'fieldName');
    const filename = requiredString(body, 'filename');
    const fileSizeBytes = Number(body.fileSizeBytes ?? 0);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      throw badRequest('fileSizeBytes must be a positive number');
    }
    if (fileSizeBytes > config.storage.maxUploadBytes) {
      throw badRequest(`File exceeds max upload size of ${config.storage.maxUploadBytes} bytes`);
    }

    const site = await loadAccessibleSite(siteId, request);
    statusMustBeCompleted(site, 'Site');

    const assessmentId = typeof body.assessmentId === 'string' && body.assessmentId.trim()
      ? body.assessmentId.trim()
      : null;
    if (assessmentId) {
      const [assessment] = await db
        .select()
        .from(ssRooftopAssessments)
        .where(and(
          eq(ssRooftopAssessments.id, assessmentId),
          eq(ssRooftopAssessments.siteId, siteId),
          isNull(ssRooftopAssessments.deletedAt),
        ));
      statusMustBeCompleted(assertFound(assessment, 'Assessment'), 'Assessment');
    }

    const [duplicate] = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.status, 'confirmed'),
      ));
    if (duplicate?.remoteUrl) {
      return reply.send({
        sessionId: duplicate.id,
        uploadUrl: null,
        alreadyExists: true,
        remoteUrl: duplicate.remoteUrl,
      });
    }

    const sessionId = randomUUID();
    const entityType = assessmentId ? 'rooftop_assessment' : 'site';
    const entityId = assessmentId ?? siteId;
    const storageKey = makeLocalStorageKey({
      app: 'solarsense',
      parentId: siteId,
      entityType,
      entityId,
      fieldName,
      sessionId,
      filename,
    });

    await db.insert(photoRegistry).values({
      id: sessionId,
      checksum,
      remoteUrl: null,
      onedriveItemId: null,
      storageKey,
      contentType: null,
      originalFilename: filename,
      app: 'solarsense',
      parentId: siteId,
      entityType,
      entityId,
      fieldName,
      fileSizeBytes,
      status: 'pending',
    });

    return reply.status(201).send({
      sessionId,
      uploadUrl: uploadUrl(sessionId),
      alreadyExists: false,
    });
  });

  app.put('/upload/:sessionId', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Upload photo bytes for a VM-local upload session',
    },
    bodyLimit: config.storage.maxUploadBytes,
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw badRequest('Upload body must be raw bytes');

    const [session] = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.id, sessionId),
        eq(photoRegistry.app, 'solarsense'),
      ));
    const found = assertFound(session, 'Upload session');
    if (found.status !== 'pending') throw badRequest(`Upload session is ${found.status}`);
    assertUploadSessionFresh(found.createdAt);
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.fileSizeBytes && body.length !== found.fileSizeBytes) {
      throw badRequest('Uploaded file size does not match session');
    }

    const written = await writeLocalFile(found.storageKey, body);
    if (written.checksum !== found.checksum) {
      await deleteLocalFile(found.storageKey);
      throw badRequest('Uploaded checksum does not match session');
    }

    const contentType = String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
    await db
      .update(photoRegistry)
      .set({
        status: 'uploaded',
        fileSizeBytes: written.size,
        contentType,
        uploadedAt: new Date(),
      })
      .where(eq(photoRegistry.id, sessionId));

    return reply.send({ ok: true, checksum: written.checksum, fileSizeBytes: written.size });
  });

  app.post('/confirm-upload', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Confirm a VM-local upload and expose a file URL',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const sessionId = requiredString(body, 'sessionId');
    const checksum = requiredString(body, 'checksum');

    const [session] = await db
      .select()
      .from(photoRegistry)
      .where(and(eq(photoRegistry.id, sessionId), eq(photoRegistry.app, 'solarsense')));
    const found = assertFound(session, 'Upload session');
    if (found.checksum !== checksum) throw badRequest('Checksum does not match session');
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.status === 'confirmed' && found.remoteUrl) {
      return reply.send({ remoteUrl: found.remoteUrl });
    }
    if (found.status !== 'uploaded') throw badRequest(`Upload session is ${found.status}`);
    if (!(await localFileExists(found.storageKey))) throw badRequest('Uploaded file is missing from local storage');

    const remoteUrl = publicFileUrl(found.storageKey);
    await db
      .update(photoRegistry)
      .set({
        status: 'confirmed',
        remoteUrl,
        uploadedAt: new Date(),
      })
      .where(eq(photoRegistry.id, sessionId));

    return reply.send({ remoteUrl });
  });

  app.post('/push', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Push completed SolarSense sites and assessments',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as { sites?: JsonRecord[]; assessments?: JsonRecord[] };
    const sites = body.sites ?? [];
    const assessments = body.assessments ?? [];
    requireCompleted(sites, 'Site');
    requireCompleted(assessments, 'Assessment');

    const siteIds: Record<string, string> = {};
    const assessmentIds: Record<string, string> = {};

    for (const site of sites) {
      const localId = requiredString(site, 'id');
      const [existing] = await db.select().from(ssSites).where(eq(ssSites.id, localId));
      if (existing) assertSiteAccess(existing, request.user);
      const values = siteValuesFromPayload(site, request.user.userId, existing);
      const { id: _id, ...updateValues } = values;
      await db
        .insert(ssSites)
        .values(values)
        .onConflictDoUpdate({
          target: ssSites.id,
          set: updateValues,
        });
      siteIds[localId] = values.serverId;
    }

    for (const assessment of assessments) {
      const localId = requiredString(assessment, 'id');
      const siteId = requiredString(assessment, 'siteId');
      const site = await loadAccessibleSite(siteId, request);
      statusMustBeCompleted(site, 'Site');

      const [existing] = await db
        .select()
        .from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, localId));
      const values = assessmentValuesFromPayload(assessment, request.user.userId, existing);
      const { id: _id, ...updateValues } = values;
      await db
        .insert(ssRooftopAssessments)
        .values(values)
        .onConflictDoUpdate({
          target: ssRooftopAssessments.id,
          set: updateValues,
        });
      assessmentIds[localId] = values.serverId;
    }

    return reply.send({ siteIds, assessmentIds });
  });

  app.get('/pull', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Pull changed SolarSense records',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const query = request.query as { since?: string; siteId?: string };
    const since = query.since ? new Date(query.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw badRequest('since must be an ISO date');
    if (query.siteId) await loadAccessibleSite(query.siteId, request);

    const siteConditions = [gt(ssSites.updatedAt, since), isNull(ssSites.deletedAt)];
    if (query.siteId) siteConditions.push(eq(ssSites.id, query.siteId));
    if (!isElevated(request.user)) siteConditions.push(eq(ssSites.createdByUserId, request.user.userId));

    const pulledSites = await db.select().from(ssSites).where(and(...siteConditions));

    let pulledAssessments: Array<typeof ssRooftopAssessments.$inferSelect> = [];
    if (query.siteId) {
      pulledAssessments = await db
        .select()
        .from(ssRooftopAssessments)
        .where(and(
          eq(ssRooftopAssessments.siteId, query.siteId),
          gt(ssRooftopAssessments.updatedAt, since),
          isNull(ssRooftopAssessments.deletedAt),
        ));
    } else if (isElevated(request.user)) {
      pulledAssessments = await db
        .select()
        .from(ssRooftopAssessments)
        .where(and(gt(ssRooftopAssessments.updatedAt, since), isNull(ssRooftopAssessments.deletedAt)));
    } else {
      const ownedSites = await db
        .select({ id: ssSites.id })
        .from(ssSites)
        .where(and(eq(ssSites.createdByUserId, request.user.userId), isNull(ssSites.deletedAt)));
      const ownedIds = ownedSites.map((site) => site.id);
      pulledAssessments = ownedIds.length
        ? await db
            .select()
            .from(ssRooftopAssessments)
            .where(and(
              inArray(ssRooftopAssessments.siteId, ownedIds),
              gt(ssRooftopAssessments.updatedAt, since),
              isNull(ssRooftopAssessments.deletedAt),
            ))
        : [];
    }

    return reply.send({
      sites: pulledSites,
      assessments: pulledAssessments,
      pulledAt: new Date().toISOString(),
    });
  });
}
