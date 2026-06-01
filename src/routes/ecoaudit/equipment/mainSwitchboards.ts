import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaMainSwitchboards } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import { assertFound, assertAuditAccess, dateOrNow, requiredString, str, arr, type JsonRecord } from '../helpers.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

export async function eaMainSwitchboardRoutes(app: FastifyInstance): Promise<void> {
  const T = eaMainSwitchboards;
  const label = 'Main switchboard';

  app.get('/audits/:auditId/main-switchboards', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/main-switchboards', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = req.body as JsonRecord;
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const [row] = await db.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt),
        zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        name: requiredString(body, 'name'), location: str(body.location), mapLocator: str(body.mapLocator),
        siteNmi: str(body.siteNmi), photo: str(body.photo), subCircuitsDescription: str(body.subCircuitsDescription),
        comments: str(body.comments), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
      } as any).returning();
      return reply.status(201).send(row);
    });

  app.get('/main-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/main-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      assertAuditAccess(assertFound(await loadAudit(assertFound(row, label).auditId), 'Audit'), req.user);
      const body = req.body as JsonRecord;
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'local' };
      if ('name' in body) c.name = requiredString(body, 'name');
      for (const k of ['location','mapLocator','siteNmi','photo','subCircuitsDescription','comments','extraNotes']) if (k in body) c[k] = str(body[k]);
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      const [updated] = await db.update(T).set(c as any).where(eq(T.id, id)).returning();
      return reply.send(assertFound(updated, label));
    });

  app.delete('/main-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      assertAuditAccess(assertFound(await loadAudit(assertFound(row, label).auditId), 'Audit'), req.user);
      await db.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(T.id, id));
      return reply.status(204).send();
    });
}
