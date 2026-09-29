import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaWaterAssets } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import {
  assertFound,
  assertAuditAccess,
  dateOrNow,
  requiredString,
  str,
  arr,
  photoMetadata,
  type JsonRecord,
} from '../helpers.js';
import {
  jsonArray,
  jsonObject,
  isWaterAssetPhotoMetadataOnlyPatch,
  assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos,
  mergeWaterAssetCustomFieldPhotoMetadata,
  requiredWaterAssetType,
} from '../waterAssetContract.js';
import { setEcoAuditRevisionHeader } from '../auditConcurrency.js';
import { mutateEcoAuditTree } from '../auditMutation.js';

async function loadAudit(id: string) {
  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return audit;
}

export async function eaWaterAssetRoutes(app: FastifyInstance): Promise<void> {
  const T = eaWaterAssets;
  const label = 'Water asset';
  const guards = [authenticate, requireApp('ecoaudit'), requireRole('inspector')];

  app.get('/audits/:auditId/water-assets', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { auditId } = req.params as { auditId: string };
    assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
    const rows = await db
      .select()
      .from(T)
      .where(and(eq(T.auditId, auditId), isNull(T.deletedAt)))
      .orderBy(asc(T.createdAt));
    return reply.send({ data: rows });
  });

  app.post('/audits/:auditId/water-assets', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { auditId } = req.params as { auditId: string };
    const body = req.body as JsonRecord;
    const zoneId = requiredString(body, 'zoneId');
    const mutation = await mutateEcoAuditTree({ auditId, zoneId, user: req.user, request: req, mutate: async (tx) => {
      const [row] = await tx.insert(T).values({
        id: randomUUID(),
        serverId: randomUUID(),
        syncStatus: 'synced',
        updatedAt: dateOrNow(body.updatedAt),
        zoneId,
        auditId,
        createdAt: dateOrNow(body.createdAt),
        assetType: requiredWaterAssetType(body.assetType),
        name: requiredString(body, 'name'),
        category: str(body.category),
        data: jsonObject(body.data),
        generalComments: str(body.generalComments),
        customFields: jsonArray(body.customFields),
        photos: arr(body.photos),
        photoDescs: photoMetadata(body.photoDescs),
      }).returning();
      return assertFound(row, label);
    } });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.status(201).send(mutation.value);
  });

  app.get('/water-assets/:id', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
    const found = assertFound(row, label);
    assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
    return reply.send(found);
  });

  app.patch('/water-assets/:id', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
    const found = assertFound(row, label);
    const body = req.body as JsonRecord;
    const photoMetadataOnly = isWaterAssetPhotoMetadataOnlyPatch(found.customFields, body);
    const changes: Partial<typeof T.$inferInsert> = {
      updatedAt: new Date(),
      syncStatus: 'synced',
    };
    if ('assetType' in body) changes.assetType = requiredWaterAssetType(body.assetType);
    if ('name' in body) changes.name = requiredString(body, 'name');
    if ('category' in body) changes.category = str(body.category);
    if ('data' in body) changes.data = jsonObject(body.data);
    if ('generalComments' in body) changes.generalComments = str(body.generalComments);
    if ('customFields' in body) {
      changes.customFields = photoMetadataOnly
        ? mergeWaterAssetCustomFieldPhotoMetadata(found.customFields, body.customFields)
        : jsonArray(body.customFields);
    }
    if ('photos' in body) changes.photos = arr(body.photos);
    if ('photoDescs' in body) changes.photoDescs = photoMetadata(body.photoDescs);
    const mutation = await mutateEcoAuditTree({
      auditId: found.auditId,
      user: req.user,
      request: req,
      completedPhotoMetadataValidation: photoMetadataOnly
        ? () => assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos(found, body)
        : undefined,
      mutate: async (tx) => {
        const [updated] = await tx.update(T).set(changes).where(and(
          eq(T.id, id),
          eq(T.auditId, found.auditId),
          isNull(T.deletedAt),
        )).returning();
        return assertFound(updated, label);
      },
    });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.send(mutation.value);
  });

  app.delete('/water-assets/:id', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
    const found = assertFound(row, label);
    const mutation = await mutateEcoAuditTree({ auditId: found.auditId, user: req.user, request: req, mutate: async (tx) => {
      const [deleted] = await tx.update(T).set({ deletedAt: new Date(), updatedAt: new Date(), syncStatus: 'synced' })
        .where(and(eq(T.id, id), eq(T.auditId, found.auditId), isNull(T.deletedAt))).returning();
      return assertFound(deleted, label);
    } });
    await releaseCopyReferencesForEntity('ecoaudit', id).catch((error) => {
      req.log.warn({ error, entityId: id }, 'EcoAudit photo reference cleanup deferred');
    });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.status(204).send();
  });
}
