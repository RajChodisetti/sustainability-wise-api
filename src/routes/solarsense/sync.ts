import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertAssessmentAccess,
  assertDraftMutable,
  assertSiteContextAccess,
  assertSiteAccess,
  dateOrNow,
  isElevated,
  requiredString,
  type JsonRecord,
} from './helpers.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { saveRecordVersion } from '../recordVersions.js';
import {
  deleteLocalFile,
  localFileExists,
  publicFileUrl,
  writeLocalFile,
} from '../../storage/localFiles.js';
import { mirrorStoredPhotoToOneDrive } from '../../onedrive/photoBackup.js';
import { makePhotoStorageKeyFromNames } from '../../services/storageNaming.js';
import { resolveSyncCreatedByUserId, type SyncActor } from '../syncOwnership.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import {
  createConfiguredUploadUrl,
  requireUploadCapability,
} from '../../auth/uploadCapability.js';
import { resolveSyncedCompletion } from './completionFence.js';
import { completeLinkedSchedulerEvents } from '../../services/schedulerCompletionService.js';

async function loadAccessibleSite(siteId: string, request: { user: Parameters<typeof assertSiteAccess>[1] }) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  const found = assertFound(site, 'Site');
  await assertSiteContextAccess(found, request.user);
  return found;
}

async function loadAnyAccessibleSite(siteId: string, request: { user: Parameters<typeof assertSiteAccess>[1] }) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  const found = assertFound(site, 'Site');
  await assertSiteContextAccess(found, request.user);
  assertDraftMutable(found, 'Site');
  return found;
}

async function loadAccessibleAssessment(
  site: typeof ssSites.$inferSelect,
  assessmentId: string,
  request: { user: Parameters<typeof assertSiteAccess>[1] },
) {
  const [assessment] = await db
    .select()
    .from(ssRooftopAssessments)
    .where(and(
      eq(ssRooftopAssessments.id, assessmentId),
      eq(ssRooftopAssessments.siteId, site.id),
      isNull(ssRooftopAssessments.deletedAt),
    ));
  const found = assertFound(assessment, 'Assessment');
  assertAssessmentAccess(site, found, request.user);
  return found;
}

async function assertSyncPhotoAccess(
  siteId: string,
  assessmentId: string | null,
  request: { user: Parameters<typeof assertSiteAccess>[1] },
) {
  const site = await loadAccessibleSite(siteId, request);
  if (assessmentId) {
    await loadAccessibleAssessment(site, assessmentId, request);
  } else {
    assertSiteAccess(site, request.user);
  }
  return site;
}

async function deletePhotosForSite(siteId: string): Promise<void> {
  await releaseCopyReferencesForParent('solarsense', siteId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'solarsense', parentId: siteId });
}

async function deletePhotosForAssessment(assessmentId: string): Promise<void> {
  await releaseCopyReferencesForEntity('solarsense', assessmentId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'solarsense', entityId: assessmentId });
}

function uploadUrl(sessionId: string): string {
  return createConfiguredUploadUrl(
    `${config.publicBaseUrl}/v1/solarsense/sync/upload/${sessionId}`,
    'solarsense',
    sessionId,
  );
}

function assertUploadSessionFresh(createdAt: Date): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (Date.now() - createdAt.getTime() > maxAgeMs) {
    throw badRequest('Upload session has expired');
  }
}

function siteValuesFromPayload(
  site: JsonRecord,
  actor: SyncActor,
  receivedAt: Date,
  existing?: typeof ssSites.$inferSelect,
) {
  const id = requiredString(site, 'id');
  const serverId =
    existing?.serverId ??
    (typeof site.serverId === 'string' && site.serverId.trim() ? site.serverId.trim() : randomUUID());
  const completion = resolveSyncedCompletion({
    existing,
    incomingStatus: site.status,
    receivedAt,
    entity: 'site',
  });
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
    createdByUserId: resolveSyncCreatedByUserId({
      existingRecord: Boolean(existing),
      existingCreatedByUserId: existing?.createdByUserId,
      incomingCreatedByUserId: site.createdByUserId,
      actor,
    }),
    createdAt: dateOrNow(site.createdAt),
    ...completion,
  };
}

function assessmentValuesFromPayload(
  assessment: JsonRecord,
  actor: SyncActor,
  receivedAt: Date,
  existing?: typeof ssRooftopAssessments.$inferSelect,
) {
  const id = requiredString(assessment, 'id');
  const serverId =
    existing?.serverId ??
    (typeof assessment.serverId === 'string' && assessment.serverId.trim()
      ? assessment.serverId.trim()
      : randomUUID());
  const completion = resolveSyncedCompletion({
    existing,
    incomingStatus: assessment.status,
    receivedAt,
    entity: 'assessment',
  });
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
    createdByUserId: resolveSyncCreatedByUserId({
      existingRecord: Boolean(existing),
      existingCreatedByUserId: existing?.createdByUserId,
      incomingCreatedByUserId: assessment.createdByUserId,
      actor,
    }),
    assignedInspectorUserId: existing?.assignedInspectorUserId ?? null,
    createdAt: dateOrNow(assessment.createdAt),
    ...completion,
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
    const siteId = requiredString(body, 'siteId');
    const fieldName = requiredString(body, 'fieldName');
    const assessmentId = typeof body.assessmentId === 'string' && body.assessmentId.trim()
      ? body.assessmentId.trim()
      : null;
    await assertSyncPhotoAccess(siteId, assessmentId, request);

    const [existing] = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.parentId, siteId),
        eq(photoRegistry.entityId, assessmentId ?? siteId),
        eq(photoRegistry.fieldName, fieldName),
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
      summary: 'Create a photo upload session',
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

    const assessmentId = typeof body.assessmentId === 'string' && body.assessmentId.trim()
      ? body.assessmentId.trim()
      : null;
    const site = await loadAccessibleSite(siteId, request);
    let assessment: typeof ssRooftopAssessments.$inferSelect | null = null;
    if (assessmentId) {
      assessment = await loadAccessibleAssessment(site, assessmentId, request);
    } else {
      assertSiteAccess(site, request.user);
    }

    const entityType = assessmentId ? 'rooftop_assessment' : 'site';
    const entityId = assessmentId ?? siteId;
    const [duplicate] = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.parentId, siteId),
        eq(photoRegistry.entityId, entityId),
        eq(photoRegistry.fieldName, fieldName),
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
    const storageKey = makePhotoStorageKeyFromNames({
      app: 'solarsense',
      parentName: site.siteName,
      entityType,
      entityName: assessment?.buildingIdName ?? site.siteName,
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
      summary: 'Upload photo bytes for an upload session',
    },
    onRequest: requireUploadCapability('solarsense'),
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
      await db.update(photoRegistry).set({ status: 'failed' }).where(eq(photoRegistry.id, sessionId));
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
      summary: 'Confirm an upload and expose a file URL',
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
    await assertSyncPhotoAccess(
      found.parentId,
      found.entityType === 'rooftop_assessment' ? found.entityId : null,
      request,
    );
    if (found.checksum !== checksum) throw badRequest('Checksum does not match session');
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.status === 'confirmed' && found.remoteUrl) {
      return reply.send({ remoteUrl: found.remoteUrl });
    }
    if (found.status !== 'uploaded') throw badRequest(`Upload session is ${found.status}`);
    if (!(await localFileExists(found.storageKey))) throw badRequest('Uploaded file is missing from configured storage');

    const remoteUrl = publicFileUrl(found.storageKey);
    const oneDriveBackup = found.onedriveItemId
      ? null
      : await mirrorStoredPhotoToOneDrive({
          storageKey: found.storageKey,
          contentType: found.contentType,
          logger: request.log,
        });
    await db
      .update(photoRegistry)
      .set({
        status: 'confirmed',
        remoteUrl,
        onedriveItemId: oneDriveBackup?.itemId ?? found.onedriveItemId,
        uploadedAt: new Date(),
      })
      .where(eq(photoRegistry.id, sessionId));

    return reply.send({
      remoteUrl,
      oneDriveBackup: oneDriveBackup
        ? {
            itemId: oneDriveBackup.itemId,
            path: oneDriveBackup.drivePath,
            webUrl: oneDriveBackup.webUrl,
          }
        : undefined,
    });
  });

  app.post('/push', {
    schema: {
      tags: ['SolarSense Sync'],
      summary: 'Push SolarSense sites and assessments',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as { sites?: JsonRecord[]; assessments?: JsonRecord[] };
    const sites = body.sites ?? [];
    const assessments = body.assessments ?? [];
    const receivedAt = new Date();

    const siteIds: Record<string, string> = {};
    const assessmentIds: Record<string, string> = {};
    const versionNumbers: Record<string, number> = {};

    for (const site of sites) {
      const localId = requiredString(site, 'id');
      const [existing] = await db.select().from(ssSites).where(eq(ssSites.id, localId));
      if (
        existing
        && !isElevated(request.user)
        && existing.createdByUserId !== request.user.userId
      ) {
        await assertSiteContextAccess(existing, request.user);
        assertDraftMutable(existing, 'Site');
        siteIds[localId] = existing.serverId ?? existing.id;
        continue;
      }
      if (existing) assertSiteAccess(existing, request.user);
      const values = siteValuesFromPayload(site, request.user, receivedAt, existing);
      const { id: _id, ...updateValues } = values;
      const excludedStatus = sql.raw(`excluded.${ssSites.status.name}`);
      const excludedCompletedAt = sql.raw(`excluded.${ssSites.completedAt.name}`);
      await db.transaction(async (tx) => {
        const [upserted] = await tx
          .insert(ssSites)
          .values(values)
          .onConflictDoUpdate({
            target: ssSites.id,
            set: {
              ...updateValues,
              completedAt: sql<Date | null>`case
                when ${ssSites.status} = 'Completed'
                  then coalesce(${ssSites.completedAt}, ${excludedCompletedAt})
                when ${excludedStatus} = 'Completed' then ${excludedCompletedAt}
                else null
              end`,
            },
            setWhere: sql`${ssSites.status} <> 'Completed' OR ${excludedStatus} = 'Completed'`,
          })
          .returning({ id: ssSites.id });
        if (!upserted) throw conflict('site_completed_reopen_requires_explicit_transition');
        if (!values.deletedAt && values.status === 'Completed') {
          await completeLinkedSchedulerEvents(tx, {
            sourceApp: 'solarsense',
            sourceType: 'site',
            sourceId: localId,
          }, { observedAt: receivedAt });
        }
      });
      siteIds[localId] = values.serverId;
      if (values.deletedAt) {
        await deletePhotosForSite(localId);
      }
    }

    for (const assessment of assessments) {
      const localId = requiredString(assessment, 'id');
      const siteId = requiredString(assessment, 'siteId');
      const site = await loadAnyAccessibleSite(siteId, request);

      const [existing] = await db
        .select()
        .from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, localId));
      if (existing) {
        if (existing.siteId !== siteId) throw badRequest('Assessment siteId cannot change');
        assertAssessmentAccess(site, existing, request.user);
      } else {
        assertSiteAccess(site, request.user);
      }
      const values = assessmentValuesFromPayload(
        assessment,
        request.user,
        receivedAt,
        existing,
      );
      const { id: _id, ...updateValues } = values;
      const excludedStatus = sql.raw(`excluded.${ssRooftopAssessments.status.name}`);
      const excludedCompletedAt = sql.raw(`excluded.${ssRooftopAssessments.completedAt.name}`);
      await db.transaction(async (tx) => {
        const [upserted] = await tx
          .insert(ssRooftopAssessments)
          .values(values)
          .onConflictDoUpdate({
            target: ssRooftopAssessments.id,
            set: {
              ...updateValues,
              completedAt: sql<Date | null>`case
                when ${ssRooftopAssessments.status} = 'Completed'
                  then coalesce(${ssRooftopAssessments.completedAt}, ${excludedCompletedAt})
                when ${excludedStatus} = 'Completed' then ${excludedCompletedAt}
                else null
              end`,
            },
            setWhere: sql`${ssRooftopAssessments.status} <> 'Completed' OR ${excludedStatus} = 'Completed'`,
          })
          .returning({ id: ssRooftopAssessments.id });
        if (!upserted) {
          throw conflict('assessment_completed_reopen_requires_explicit_transition');
        }
        if (!values.deletedAt && values.status === 'Completed') {
          await completeLinkedSchedulerEvents(tx, {
            sourceApp: 'solarsense',
            sourceType: 'assessment',
            sourceId: localId,
          }, { observedAt: receivedAt });
        }
      });
      assessmentIds[localId] = values.serverId;
      if (values.deletedAt) {
        await deletePhotosForAssessment(localId);
      }
    }

    const touchedSiteIds = new Set<string>([
      ...sites.map((site) => requiredString(site, 'id')),
      ...assessments
        .map((assessment) => typeof assessment.siteId === 'string' ? assessment.siteId.trim() : '')
        .filter(Boolean),
    ]);
    for (const siteId of touchedSiteIds) {
      await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });
      versionNumbers[siteId] = await saveRecordVersion({
        app: 'solarsense',
        entityType: 'site',
        entityId: siteId,
        snapshot: {
          site: sites.find((site) => typeof site.id === 'string' && site.id === siteId) ?? null,
          assessments: assessments.filter((assessment) => typeof assessment.siteId === 'string' && assessment.siteId === siteId),
        },
        userId: request.user.userId,
      });
    }

    return reply.send({ siteIds, assessmentIds, versionNumbers });
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
    const requestedSite = query.siteId
      ? await loadAccessibleSite(query.siteId, request)
      : null;

    const assignedSiteRows = !isElevated(request.user)
      ? await db
          .select({ siteId: ssRooftopAssessments.siteId })
          .from(ssRooftopAssessments)
          .innerJoin(ssSites, and(
            eq(ssSites.id, ssRooftopAssessments.siteId),
            eq(ssSites.status, 'Draft'),
            isNull(ssSites.deletedAt),
          ))
          .where(and(
            eq(ssRooftopAssessments.assignedInspectorUserId, request.user.userId),
            isNull(ssRooftopAssessments.deletedAt),
          ))
      : [];
    const assignedSiteIds = assignedSiteRows
      .map((row) => row.siteId)
      .filter((id): id is string => Boolean(id));

    const siteConditions = [gt(ssSites.updatedAt, since), isNull(ssSites.deletedAt)];
    if (query.siteId) siteConditions.push(eq(ssSites.id, query.siteId));
    if (!isElevated(request.user)) {
      siteConditions.push(or(
        eq(ssSites.createdByUserId, request.user.userId),
        assignedSiteIds.length > 0
          ? and(eq(ssSites.status, 'Draft'), inArray(ssSites.id, assignedSiteIds))
          : undefined,
      )!);
    }

    const pulledSites = await db.select().from(ssSites).where(and(...siteConditions));

    let pulledAssessments: Array<typeof ssRooftopAssessments.$inferSelect> = [];
    if (query.siteId) {
      const assessmentConditions = [
        eq(ssRooftopAssessments.siteId, query.siteId),
        gt(ssRooftopAssessments.updatedAt, since),
        isNull(ssRooftopAssessments.deletedAt),
      ];
      if (
        !isElevated(request.user)
        && requestedSite?.createdByUserId !== request.user.userId
      ) {
        assessmentConditions.push(
          eq(ssRooftopAssessments.assignedInspectorUserId, request.user.userId),
        );
      }
      pulledAssessments = await db
        .select()
        .from(ssRooftopAssessments)
        .where(and(...assessmentConditions));
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
      pulledAssessments = ownedIds.length || assignedSiteIds.length
        ? await db
            .select()
            .from(ssRooftopAssessments)
            .where(and(
              or(
                ownedIds.length > 0
                  ? inArray(ssRooftopAssessments.siteId, ownedIds)
                  : undefined,
                assignedSiteIds.length > 0
                  ? and(
                      inArray(ssRooftopAssessments.siteId, assignedSiteIds),
                      eq(ssRooftopAssessments.assignedInspectorUserId, request.user.userId),
                    )
                  : undefined,
              ),
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
