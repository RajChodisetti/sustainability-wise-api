import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  ssAssessmentWorkSessions,
  ssRooftopAssessments,
  ssSites,
} from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertAssessmentAccess,
  assertDraftMutable,
  assertSiteAccess,
  isElevated,
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
import { badRequest, conflict } from '../../utils/errors.js';
import {
  assertWorkSessionCheckpointAccess,
  decideWorkSessionUpdate,
  parseWorkSessionBody,
  presentWorkSession,
  workSessionBodySchema,
  workSessionResponseSchema,
} from '../workSessions.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../storage/photoCopyReferences.js';
import {
  completionAtFirstObservation,
  parseSolarLifecycleStatus,
  resolveSolarCompletionFence,
} from './completionFence.js';

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
    const ownsSite = isElevated(request.user) || site.createdByUserId === request.user.userId;
    if (!ownsSite) assertDraftMutable(site, 'Site');
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });

    const conditions = [
      eq(ssRooftopAssessments.siteId, siteId),
      isNull(ssRooftopAssessments.deletedAt),
    ];
    if (!ownsSite) {
      conditions.push(eq(ssRooftopAssessments.assignedInspectorUserId, request.user.userId));
    }
    const assessments = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(...conditions))
      .orderBy(asc(ssRooftopAssessments.createdAt));

    if (!ownsSite && assessments.length === 0) {
      assertSiteAccess(site, request.user);
    }

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
    const receivedAt = new Date();
    const changes = buildAssessmentChanges({ ...body, siteId });
    const status = parseSolarLifecycleStatus(body.status);

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
        status,
        completedAt: completionAtFirstObservation(status, receivedAt),
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
    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));

    const foundAssessment = assertFound(assessment, 'Assessment');
    if (!isElevated(request.user) && site.createdByUserId !== request.user.userId) {
      assertDraftMutable(site, 'Site');
    }
    assertAssessmentAccess(site, foundAssessment, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: siteId, actor: request.user });
    return reply.send(foundAssessment);
  });

  app.put('/sites/:siteId/assessments/:id/active-time/sessions/:sessionId', {
    schema: {
      tags: ['SolarSense Assessments'],
      summary: 'Checkpoint active foreground time for a rooftop assessment',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['siteId', 'id', 'sessionId'],
        additionalProperties: false,
        properties: {
          siteId: { type: 'string', minLength: 1 },
          id: { type: 'string', minLength: 1 },
          sessionId: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
      body: workSessionBodySchema,
      response: { 200: workSessionResponseSchema },
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId, id, sessionId } = request.params as {
      siteId: string;
      id: string;
      sessionId: string;
    };
    const incoming = parseWorkSessionBody(request.body);
    const response = await db.transaction(async (tx) => {
      const [site] = await tx
        .select()
        .from(ssSites)
        .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)))
        .for('update');
      const foundSite = assertFound(site, 'Site');

      const [assessment] = await tx
        .select()
        .from(ssRooftopAssessments)
        .where(and(
          eq(ssRooftopAssessments.id, id),
          eq(ssRooftopAssessments.siteId, siteId),
          isNull(ssRooftopAssessments.deletedAt),
        ))
        .for('update');
      const foundAssessment = assertFound(assessment, 'Assessment');

      const [existing] = await tx
        .select()
        .from(ssAssessmentWorkSessions)
        .where(and(
          eq(ssAssessmentWorkSessions.assessmentId, id),
          eq(ssAssessmentWorkSessions.id, sessionId),
        ));
      assertWorkSessionCheckpointAccess({
        incoming,
        existing,
        actorUserId: request.user.userId,
        assertParentAccess: () => assertAssessmentAccess(
          foundSite,
          foundAssessment,
          request.user,
        ),
      });
      const completionFence = resolveSolarCompletionFence(foundSite, foundAssessment);
      const decision = decideWorkSessionUpdate({
        incoming,
        existing,
        actorUserId: request.user.userId,
        completed: completionFence.completed,
        completionBoundary: completionFence.completionBoundary,
        completedDetail: 'assessment_completed_time_tracking_disabled',
      });

      if (decision.action === 'current') {
        return presentWorkSession(existing!, false);
      }
      if (decision.action === 'insert') {
        const [inserted] = await tx
          .insert(ssAssessmentWorkSessions)
          .values({
            id: sessionId,
            assessmentId: id,
            actorUserId: request.user.userId,
            ...incoming,
          })
          .returning();
        return presentWorkSession(inserted, true);
      }

      const [updated] = await tx
        .update(ssAssessmentWorkSessions)
        .set({ ...incoming, updatedAt: new Date() })
        .where(and(
          eq(ssAssessmentWorkSessions.assessmentId, id),
          eq(ssAssessmentWorkSessions.id, sessionId),
          eq(ssAssessmentWorkSessions.revision, existing!.revision),
        ))
        .returning();
      if (!updated) throw conflict('work_session_concurrent_update');
      return presentWorkSession(updated, true);
    });
    return reply.send(response);
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
    assertDraftMutable(site, 'Site');

    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));
    const foundAssessment = assertFound(assessment, 'Assessment');
    assertAssessmentAccess(site, foundAssessment, request.user);
    assertDraftMutable(foundAssessment, 'Assessment');

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
      const foundAssessment = assertFound(assessment, 'Assessment');
      assertAssessmentAccess(site, foundAssessment, request.user);
      assertDraftMutable(foundAssessment, 'Assessment');
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
    const foundAssessment = assertFound(assessment, 'Assessment');
    assertAssessmentAccess(site, foundAssessment, request.user);
    assertDraftMutable(foundAssessment, 'Assessment');

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
    assertDraftMutable(site, 'Site');
    const completedAt = new Date();

    const [assessment] = await db
      .select()
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        isNull(ssRooftopAssessments.deletedAt),
      ));
    const foundAssessment = assertFound(assessment, 'Assessment');
    assertAssessmentAccess(site, foundAssessment, request.user);
    assertDraftMutable(foundAssessment, 'Assessment');

    const [updated] = await db
      .update(ssRooftopAssessments)
      .set({
        status: 'Completed',
        completedAt: sql<Date>`coalesce(
          ${ssRooftopAssessments.completedAt},
          ${sql.param(completedAt, ssRooftopAssessments.completedAt)}
        )`,
        updatedAt: completedAt,
        syncStatus: 'local',
      })
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.siteId, siteId),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .returning();

    return reply.send(assertFound(updated, 'Assessment'));
  });

}
