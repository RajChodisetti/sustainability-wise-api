import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaGeneralWater } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import { assertFound, assertDraftMutable, assertAuditOwnerPatchMutable, assertAuditAccess, dateOrNow, str, arr, photoMetadata, type JsonRecord } from '../helpers.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

async function assertMutableAudit(id: string, user: Parameters<typeof assertAuditAccess>[1], patchBody?: JsonRecord) {
  const audit = assertFound(await loadAudit(id), 'Audit');
  assertAuditAccess(audit, user);
  if (patchBody) assertAuditOwnerPatchMutable(audit, patchBody, 'Audit');
  else assertDraftMutable(audit, 'Audit');
}

export async function eaGeneralWaterRoutes(app: FastifyInstance): Promise<void> {
  const T = eaGeneralWater;
  const label = 'General water item';

  app.get('/audits/:auditId/general-water', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/general-water', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = req.body as JsonRecord;
      await assertMutableAudit(auditId, req.user);
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const [row] = await db.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt), zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        question: str(body.question), answer: str(body.answer),
        photos: arr(body.photos), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
        photoDescs: photoMetadata(body.photoDescs),
      } as any).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: req.user });
      return reply.status(201).send(row);
    });

  app.get('/general-water/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/general-water/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      const body = req.body as JsonRecord;
      await assertMutableAudit(found.auditId, req.user, body);
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'local' };
      for (const k of ['question','answer','extraNotes']) if (k in body) c[k] = str(body[k]);
      if ('photos' in body) c.photos = arr(body.photos);
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      if ('photoDescs' in body) c.photoDescs = photoMetadata(body.photoDescs);
      const [updated] = await db.update(T).set(c as any).where(eq(T.id, id)).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.auditId, actor: req.user });
      return reply.send(assertFound(updated, label));
    });

  app.delete('/general-water/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      await assertMutableAudit(found.auditId, req.user);
      await db.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(T.id, id));
      await releaseCopyReferencesForEntity('ecoaudit', id);
      return reply.status(204).send();
    });
}
