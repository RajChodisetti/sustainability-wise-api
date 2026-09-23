import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaWaterAssets } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import {
  assertFound,
  assertDraftMutable,
  assertAuditOwnerPatchMutable,
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
  requiredWaterAssetType,
} from '../waterAssetContract.js';

async function loadAudit(id: string) {
  const [audit] = await db
    .select()
    .from(eaAudits)
    .where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return audit;
}

async function assertMutableAudit(
  id: string,
  user: Parameters<typeof assertAuditAccess>[1],
  patchBody?: JsonRecord,
) {
  const audit = assertFound(await loadAudit(id), 'Audit');
  assertAuditAccess(audit, user);
  if (patchBody) assertAuditOwnerPatchMutable(audit, patchBody, 'Audit');
  else assertDraftMutable(audit, 'Audit');
}

async function assertWaterAssetPatchMutable(
  auditId: string,
  user: Parameters<typeof assertAuditAccess>[1],
  body: JsonRecord,
  existingCustomFields: unknown,
): Promise<void> {
  const audit = assertFound(await loadAudit(auditId), 'Audit');
  assertAuditAccess(audit, user);
  if (audit.status !== 'Completed') return;

  if (isWaterAssetPhotoMetadataOnlyPatch(existingCustomFields, body)) return;

  assertAuditOwnerPatchMutable(audit, body, 'Audit');
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
    await assertMutableAudit(auditId, req.user);
    const zoneId = requiredString(body, 'zoneId');
    const [row] = await db.insert(T).values({
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
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: req.user });
    return reply.status(201).send(row);
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
    await assertWaterAssetPatchMutable(found.auditId, req.user, body, found.customFields);
    const changes: Partial<typeof T.$inferInsert> = {
      updatedAt: new Date(),
      syncStatus: 'local',
    };
    if ('assetType' in body) changes.assetType = requiredWaterAssetType(body.assetType);
    if ('name' in body) changes.name = requiredString(body, 'name');
    if ('category' in body) changes.category = str(body.category);
    if ('data' in body) changes.data = jsonObject(body.data);
    if ('generalComments' in body) changes.generalComments = str(body.generalComments);
    if ('customFields' in body) changes.customFields = jsonArray(body.customFields);
    if ('photos' in body) changes.photos = arr(body.photos);
    if ('photoDescs' in body) changes.photoDescs = photoMetadata(body.photoDescs);
    const [updated] = await db.update(T).set(changes).where(eq(T.id, id)).returning();
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.auditId, actor: req.user });
    return reply.send(assertFound(updated, label));
  });

  app.delete('/water-assets/:id', {
    schema: { tags: ['EcoAudit Equipment'] },
    preHandler: guards,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
    const found = assertFound(row, label);
    await assertMutableAudit(found.auditId, req.user);
    await db.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(T.id, id));
    await releaseCopyReferencesForEntity('ecoaudit', id);
    return reply.status(204).send();
  });
}
