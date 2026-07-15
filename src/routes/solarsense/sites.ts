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
  isElevated,
  optionalDate,
  optionalJson,
  optionalString,
  purgeSolarsenseSiteTree,
  requiredString,
  shouldPurgeQuery,
  type JsonRecord,
} from './helpers.js';
import { badRequest } from '../../utils/errors.js';
import { cloneRecordForInsert, copyableBodyOverrides, copyNameWithSuffix } from '../copyUtils.js';
import {
  reconcilePhotoCopyReferencesForParent,
  linkCopiedPhotoReferences,
  solarAssessmentPhotoValues,
  solarAssessmentPhotoFieldReferences,
  solarSitePhotoValues,
  solarSitePhotoFieldReferences,
  type CopiedPhotoEntity,
} from '../../storage/photoCopyReferences.js';

type SiteChanges = Partial<typeof ssSites.$inferInsert>;

function buildSiteChanges(body: JsonRecord): SiteChanges {
  const changes: SiteChanges = {};
  const stringFields = [
    'location',
    'dateOfAssessment',
    'documentClassification',
    'electricalInfrastructureSummary',
    'knownConstraints',
    'loadProfileMeteringSummary',
    'ppaAssetDemarcation',
    'appendixNotes',
    'reportPdfLocalPath',
    'reportPdfRemoteUrl',
  ] as const;

  if ('siteName' in body) changes.siteName = requiredString(body, 'siteName');
  for (const field of stringFields) {
    const value = optionalString(body, field);
    if (value !== undefined) changes[field] = value;
  }

  const appendixItems = optionalJson<unknown[]>(body, 'appendixItems', []);
  if (appendixItems !== undefined) changes.appendixItems = appendixItems;

  const updatedAt = optionalDate(body, 'updatedAt');
  changes.updatedAt = updatedAt ?? new Date();
  return changes;
}

export async function solarsenseSiteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'List SolarSense sites',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const conditions = [isNull(ssSites.deletedAt)];
    if (!isElevated(request.user)) {
      conditions.push(eq(ssSites.createdByUserId, request.user.userId));
    }

    const sites = await db
      .select()
      .from(ssSites)
      .where(and(...conditions))
      .orderBy(asc(ssSites.siteName));

    return reply.send({ data: sites });
  });

  app.post('/', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Create SolarSense site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const id = randomUUID();
    const now = new Date();
    const changes = buildSiteChanges(body);

    const [created] = await db
      .insert(ssSites)
      .values({
        id,
        serverId: randomUUID(),
        syncStatus: 'synced',
        updatedAt: dateOrNow(body.updatedAt),
        deletedAt: null,
        siteName: changes.siteName ?? requiredString(body, 'siteName'),
        location: changes.location ?? null,
        dateOfAssessment: changes.dateOfAssessment ?? null,
        documentClassification: changes.documentClassification ?? null,
        electricalInfrastructureSummary: changes.electricalInfrastructureSummary ?? null,
        knownConstraints: changes.knownConstraints ?? null,
        loadProfileMeteringSummary: changes.loadProfileMeteringSummary ?? null,
        ppaAssetDemarcation: changes.ppaAssetDemarcation ?? null,
        appendixNotes: changes.appendixNotes ?? null,
        appendixItems: changes.appendixItems ?? [],
        reportPdfLocalPath: changes.reportPdfLocalPath ?? null,
        reportPdfRemoteUrl: changes.reportPdfRemoteUrl ?? null,
        createdByUserId: request.user.userId,
        createdAt: dateOrNow(body.createdAt ?? now.toISOString()),
        status: typeof body.status === 'string' ? body.status : 'Draft',
      })
      .returning();

    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: created.id, actor: request.user });
    return reply.status(201).send(created);
  });

  app.get('/:id', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Get SolarSense site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, id), isNull(ssSites.deletedAt)));

    const found = assertFound(site, 'Site');
    assertSiteAccess(found, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: found.id, actor: request.user });
    return reply.send(found);
  });

  app.patch('/:id', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Update SolarSense site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as JsonRecord;
    if ('status' in body) throw badRequest('Use /complete to change status');

    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, id), isNull(ssSites.deletedAt)));

    const found = assertFound(site, 'Site');
    assertSiteAccess(found, request.user);
    assertDraftMutable(found, 'Site');

    const [updated] = await db
      .update(ssSites)
      .set({ ...buildSiteChanges(body), syncStatus: 'local' })
      .where(eq(ssSites.id, id))
      .returning();

    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: id, actor: request.user });
    return reply.send(assertFound(updated, 'Site'));
  });

  app.delete('/:id', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Soft-delete SolarSense site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const purge = shouldPurgeQuery(request.query as Record<string, unknown> | undefined);
    const [site] = await db
      .select()
      .from(ssSites)
      .where(purge ? eq(ssSites.id, id) : and(eq(ssSites.id, id), isNull(ssSites.deletedAt)));

    const found = assertFound(site, 'Site');
    assertSiteAccess(found, request.user);
    if (purge) {
      await purgeSolarsenseSiteTree(id, found.reportPdfLocalPath);
      return reply.status(204).send();
    }

    await db
      .update(ssSites)
      .set({ deletedAt: new Date(), updatedAt: new Date(), syncStatus: 'local' })
      .where(eq(ssSites.id, id));

    return reply.status(204).send();
  });

  app.patch('/:id/complete', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Mark SolarSense site Completed',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, id), isNull(ssSites.deletedAt)));

    const found = assertFound(site, 'Site');
    assertSiteAccess(found, request.user);

    const [updated] = await db
      .update(ssSites)
      .set({ status: 'Completed', updatedAt: new Date(), syncStatus: 'local' })
      .where(eq(ssSites.id, id))
      .returning();

    return reply.send(assertFound(updated, 'Site'));
  });

  app.post('/:id/copy', {
    schema: {
      tags: ['SolarSense Sites'],
      summary: 'Copy SolarSense site with assessments',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as JsonRecord;
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, id), isNull(ssSites.deletedAt)));

    const found = assertFound(site, 'Site');
    assertSiteAccess(found, request.user);

    const includeAssessments = body.includeAssessments !== false;
    const created = await db.transaction(async (tx) => {
      const overrides = copyableBodyOverrides(found, body, ['status', 'siteName']);
      const [copiedSite] = await tx
        .insert(ssSites)
        .values(cloneRecordForInsert(found, {
          ...overrides,
          siteName: copyNameWithSuffix(found.siteName),
          status: 'Draft',
          createdByUserId: request.user.userId,
          reportPdfLocalPath: null,
          reportPdfRemoteUrl: null,
        }) as typeof ssSites.$inferInsert)
        .returning();

      const targetSite = assertFound(copiedSite, 'Copied site');
      const copiedEntities: CopiedPhotoEntity[] = [{
        sourceEntityId: found.id,
        targetEntityId: targetSite.id,
        targetEntityType: 'site',
        photoValues: solarSitePhotoValues(found),
        photoReferences: solarSitePhotoFieldReferences(found),
      }];
      if (includeAssessments) {
        const assessments = await tx
          .select()
          .from(ssRooftopAssessments)
          .where(and(eq(ssRooftopAssessments.siteId, id), isNull(ssRooftopAssessments.deletedAt)));

        if (assessments.length > 0) {
          const copiedAssessments = assessments.map((assessment) => cloneRecordForInsert(assessment, {
              siteId: targetSite.id,
              siteName: targetSite.siteName,
              status: 'Draft',
              createdByUserId: request.user.userId,
            }) as typeof ssRooftopAssessments.$inferInsert);
          await tx.insert(ssRooftopAssessments).values(copiedAssessments);
          assessments.forEach((assessment, index) => {
            copiedEntities.push({
              sourceEntityId: assessment.id,
              targetEntityId: String(copiedAssessments[index].id),
              targetEntityType: 'rooftop_assessment',
              photoValues: solarAssessmentPhotoValues(assessment),
              photoReferences: solarAssessmentPhotoFieldReferences(assessment),
            });
          });
        }
      }

      await linkCopiedPhotoReferences({
        app: 'solarsense',
        sourceParentId: id,
        targetParentId: targetSite.id,
        entities: copiedEntities,
        executor: tx as unknown as typeof db,
      });
      await reconcilePhotoCopyReferencesForParent({
        app: 'solarsense',
        parentId: targetSite.id,
        executor: tx as unknown as typeof db,
        actor: request.user,
      });

      return targetSite;
    });

    return reply.status(201).send(created);
  });
}
