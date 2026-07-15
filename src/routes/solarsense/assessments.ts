import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { ssRooftopAssessments, ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertDraftMutable,
  assertSiteAccess,
  dateOrNow,
  optionalBoolean,
  optionalDate,
  optionalJson,
  optionalNumber,
  optionalString,
  purgeSolarsenseAssessment,
  requiredString,
  shouldPurgeQuery,
  type JsonRecord,
} from './helpers.js';
import { badRequest } from '../../utils/errors.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../storage/photoCopyReferences.js';

type AssessmentChanges = Partial<typeof ssRooftopAssessments.$inferInsert>;

async function getSite(siteId: string) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  return assertFound(site, 'Site');
}

function buildAssessmentChanges(body: JsonRecord): AssessmentChanges {
  const changes: Record<string, unknown> = {};
  const stringFields = [
    'siteId',
    'heritageStatus',
    'aerialPhotoUri',
    'roofMaterial',
    'roofFramingType',
    'roofPitchAngle',
    'roofConstructionMaterial',
    'roofCondition',
    'roofEstimatedAge',
    'roofOrientationPrimary',
    'roofShadingSources',
    'roofShadingUsablePct',
    'roofOrientationShading',
    'structuralFeasibility',
    'accessSafetyConstraints',
    'msbDetails',
    'msbPhotoUri',
    'existingGeneration',
    'electricalPitsEntry',
    'inverterSiting',
    'transformerSupplyCapacity',
    'dnspConstraints',
    'loadProfileMetering',
    'siteRepFeedback',
    'viabilityStatus',
    'dealBreakerReason',
    'ragPriority',
    'keyAssumptionsGaps',
  ] as const;
  const numberFields = [
    'roofAreaTotalM2',
    'roofAreaUsableM2',
    'pvSizeKwDc',
    'acExportKw',
    'distanceToConnectionM',
  ] as const;
  const booleanFields = ['heritageDealBreaker', 'asbestosFlag', 'structuralRiskFlag'] as const;

  if ('siteName' in body) changes.siteName = requiredString(body, 'siteName');
  if ('buildingIdName' in body) changes.buildingIdName = requiredString(body, 'buildingIdName');

  for (const field of stringFields) {
    const value = optionalString(body, field);
    if (value !== undefined) changes[field] = value;
  }
  for (const field of numberFields) {
    const value = optionalNumber(body, field);
    if (value !== undefined) changes[field] = value;
  }
  for (const field of booleanFields) {
    const value = optionalBoolean(body, field);
    if (value !== undefined) changes[field] = value;
  }

  const switchboards = optionalJson<unknown[]>(body, 'switchboards', []);
  if (switchboards !== undefined) changes.switchboards = switchboards;
  const otherConsiderations = optionalJson<unknown[]>(body, 'otherConsiderations', []);
  if (otherConsiderations !== undefined) changes.otherConsiderations = otherConsiderations;
  const additionalPhotos = optionalJson<unknown[]>(body, 'additionalPhotos', []);
  if (additionalPhotos !== undefined) changes.additionalPhotos = additionalPhotos;
  const photoMetadata = optionalJson<Record<string, unknown>>(body, 'photoMetadata', {});
  if (photoMetadata !== undefined) changes.photoMetadata = photoMetadata;

  const updatedAt = optionalDate(body, 'updatedAt');
  changes.updatedAt = updatedAt ?? new Date();
  return changes as AssessmentChanges;
}

export async function solarsenseAssessmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sites/:siteId/assessments', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'List rooftop assessments for a site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });

    const assessments = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(eq(ssRooftopAssessments.siteId, siteId), isNull(ssRooftopAssessments.deletedAt)))
      .orderBy(asc(ssRooftopAssessments.createdAt));

    return reply.send({ data: assessments });
  });

  app.post('/sites/:siteId/assessments', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Create rooftop assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    assertDraftMutable(site, 'Site');

    const body = request.body as JsonRecord;
    const id = randomUUID();
    const changes = buildAssessmentChanges({ ...body, siteId });

    const [created] = await db
      .insert(ssRooftopAssessments)
      .values({
        id,
        serverId: randomUUID(),
        syncStatus: 'synced',
        updatedAt: dateOrNow(body.updatedAt),
        deletedAt: null,
        siteId,
        siteName: changes.siteName ?? site.siteName,
        buildingIdName: changes.buildingIdName ?? requiredString(body, 'buildingIdName'),
        heritageStatus: changes.heritageStatus ?? null,
        heritageDealBreaker: changes.heritageDealBreaker ?? false,
        aerialPhotoUri: changes.aerialPhotoUri ?? null,
        roofAreaTotalM2: changes.roofAreaTotalM2 ?? null,
        roofMaterial: changes.roofMaterial ?? null,
        roofFramingType: changes.roofFramingType ?? null,
        roofPitchAngle: changes.roofPitchAngle ?? null,
        roofConstructionMaterial: changes.roofConstructionMaterial ?? null,
        asbestosFlag: changes.asbestosFlag ?? false,
        roofCondition: changes.roofCondition ?? null,
        roofEstimatedAge: changes.roofEstimatedAge ?? null,
        roofOrientationPrimary: changes.roofOrientationPrimary ?? null,
        roofShadingSources: changes.roofShadingSources ?? null,
        roofShadingUsablePct: changes.roofShadingUsablePct ?? null,
        roofOrientationShading: changes.roofOrientationShading ?? null,
        structuralFeasibility: changes.structuralFeasibility ?? null,
        structuralRiskFlag: changes.structuralRiskFlag ?? false,
        roofAreaUsableM2: changes.roofAreaUsableM2 ?? null,
        pvSizeKwDc: changes.pvSizeKwDc ?? null,
        acExportKw: changes.acExportKw ?? null,
        accessSafetyConstraints: changes.accessSafetyConstraints ?? null,
        switchboards: changes.switchboards ?? [],
        msbDetails: changes.msbDetails ?? null,
        msbPhotoUri: changes.msbPhotoUri ?? null,
        existingGeneration: changes.existingGeneration ?? null,
        distanceToConnectionM: changes.distanceToConnectionM ?? null,
        electricalPitsEntry: changes.electricalPitsEntry ?? null,
        inverterSiting: changes.inverterSiting ?? null,
        transformerSupplyCapacity: changes.transformerSupplyCapacity ?? null,
        dnspConstraints: changes.dnspConstraints ?? null,
        loadProfileMetering: changes.loadProfileMetering ?? null,
        otherConsiderations: changes.otherConsiderations ?? [],
        siteRepFeedback: changes.siteRepFeedback ?? null,
        viabilityStatus: changes.viabilityStatus ?? null,
        dealBreakerReason: changes.dealBreakerReason ?? null,
        ragPriority: changes.ragPriority ?? null,
        keyAssumptionsGaps: changes.keyAssumptionsGaps ?? null,
        additionalPhotos: changes.additionalPhotos ?? [],
        photoMetadata: changes.photoMetadata ?? {},
        createdByUserId: request.user.userId,
        createdAt: dateOrNow(body.createdAt),
        status: typeof body.status === 'string' ? body.status : 'Draft',
      })
      .returning();

    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });
    return reply.status(201).send(created);
  });

  app.get('/sites/:siteId/assessments/:id', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Get rooftop assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, id } = request.params as { siteId: string; id: string };
    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });

    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));

    return reply.send(assertFound(assessment, 'Assessment'));
  });

  app.patch('/sites/:siteId/assessments/:id', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Update rooftop assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, id } = request.params as { siteId: string; id: string };
    const body = request.body as JsonRecord;
    if ('status' in body) throw badRequest('Use /complete to change status');

    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    assertDraftMutable(site, 'Site');

    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));
    assertDraftMutable(assertFound(assessment, 'Assessment'), 'Assessment');

    const [updated] = await db
      .update(ssRooftopAssessments)
      .set({ ...buildAssessmentChanges({ ...body, siteId }), syncStatus: 'local' })
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .returning();

    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });
    return reply.send(assertFound(updated, 'Assessment'));
  });

  app.delete('/sites/:siteId/assessments/:id', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Soft-delete rooftop assessment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, id } = request.params as { siteId: string; id: string };
    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    assertDraftMutable(site, 'Site');
    const purge = shouldPurgeQuery(request.query as Record<string, unknown> | undefined);
    if (purge) {
      const [assessment] = await db
        .select()
        .from(ssRooftopAssessments)
        .where(and(
          eq(ssRooftopAssessments.id, id),
          eq(ssRooftopAssessments.siteId, siteId),
        ));
      assertFound(assessment, 'Assessment');
      assertDraftMutable(assessment, 'Assessment');
      await purgeSolarsenseAssessment(id);
      return reply.status(204).send();
    }

    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));
    assertDraftMutable(assertFound(assessment, 'Assessment'), 'Assessment');

    const [updated] = await db
      .update(ssRooftopAssessments)
      .set({ deletedAt: new Date(), updatedAt: new Date(), syncStatus: 'local' })
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .returning({ id: ssRooftopAssessments.id });

    assertFound(updated, 'Assessment');
    await releaseCopyReferencesForEntity('solarsense', id);
    return reply.status(204).send();
  });

  app.patch('/sites/:siteId/assessments/:id/complete', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Mark rooftop assessment Completed',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, id } = request.params as { siteId: string; id: string };
    const site = await getSite(siteId);
    assertSiteAccess(site, request.user);
    assertDraftMutable(site, 'Site');

    const [updated] = await db
      .update(ssRooftopAssessments)
      .set({ status: 'Completed', updatedAt: new Date(), syncStatus: 'local' })
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .returning();

    return reply.send(assertFound(updated, 'Assessment'));
  });

}
