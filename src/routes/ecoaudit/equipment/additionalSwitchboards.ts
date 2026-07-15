import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaAdditionalSwitchboards } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import { assertFound, assertDraftMutable, assertAuditAccess, dateOrNow, requiredString, str, arr, type JsonRecord } from '../helpers.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

async function assertMutableAudit(id: string, user: Parameters<typeof assertAuditAccess>[1]) {
  const audit = assertFound(await loadAudit(id), 'Audit');
  assertAuditAccess(audit, user);
  assertDraftMutable(audit, 'Audit');
}

export async function eaAdditionalSwitchboardRoutes(app: FastifyInstance): Promise<void> {
  const T = eaAdditionalSwitchboards;
  const label = 'Additional switchboard';

  app.get('/audits/:auditId/additional-switchboards', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/additional-switchboards', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = req.body as JsonRecord;
      await assertMutableAudit(auditId, req.user);
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const [row] = await db.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt),
        zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        name: requiredString(body, 'name'), location: str(body.location), mapLocator: str(body.mapLocator),
        type: str(body.type), photo: str(body.photo), subCircuitsDescription: str(body.subCircuitsDescription),
        comments: str(body.comments), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
      } as any).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: req.user });
      return reply.status(201).send(row);
    });

  app.get('/additional-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/additional-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      await assertMutableAudit(found.auditId, req.user);
      const body = req.body as JsonRecord;
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'local' };
      if ('name' in body) c.name = requiredString(body, 'name');
      for (const k of ['location','mapLocator','type','photo','subCircuitsDescription','comments','extraNotes']) if (k in body) c[k] = str(body[k]);
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      const [updated] = await db.update(T).set(c as any).where(eq(T.id, id)).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.auditId, actor: req.user });
      return reply.send(assertFound(updated, label));
    });

  app.delete('/additional-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
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
