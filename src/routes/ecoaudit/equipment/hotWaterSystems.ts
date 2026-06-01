import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaHotWaterSystems } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import { assertFound, assertAuditAccess, dateOrNow, requiredString, str, num, arr, type JsonRecord } from '../helpers.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

export async function eaHotWaterSystemRoutes(app: FastifyInstance): Promise<void> {
  const T = eaHotWaterSystems;
  const label = 'Hot water system';

  app.get('/audits/:auditId/hot-water-systems', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/hot-water-systems', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = req.body as JsonRecord;
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const [row] = await db.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt), zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        dhwDetailsType: requiredString(body, 'dhwDetailsType'), photo: str(body.photo), serialNumber: str(body.serialNumber),
        sizeLiters: num(body.sizeLiters), fuelType: str(body.fuelType), location: str(body.location),
        pipeInsulation: str(body.pipeInsulation), pipeInsulationThickness: str(body.pipeInsulationThickness),
        temperingValve: str(body.temperingValve), additionalPhoto: str(body.additionalPhoto),
        moreDhwSystems: str(body.moreDhwSystems), additionalComments: str(body.additionalComments),
        energyImprovementObservations: str(body.energyImprovementObservations), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
      } as any).returning();
      return reply.status(201).send(row);
    });

  app.get('/hot-water-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/hot-water-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      assertAuditAccess(assertFound(await loadAudit(assertFound(row, label).auditId), 'Audit'), req.user);
      const body = req.body as JsonRecord;
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'local' };
      if ('dhwDetailsType' in body) c.dhwDetailsType = requiredString(body, 'dhwDetailsType');
      for (const k of ['photo','serialNumber','fuelType','location','pipeInsulation','pipeInsulationThickness','temperingValve','additionalPhoto','moreDhwSystems','additionalComments','energyImprovementObservations','extraNotes']) if (k in body) c[k] = str(body[k]);
      if ('sizeLiters' in body) c.sizeLiters = num(body.sizeLiters);
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      const [updated] = await db.update(T).set(c as any).where(eq(T.id, id)).returning();
      return reply.send(assertFound(updated, label));
    });

  app.delete('/hot-water-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      assertAuditAccess(assertFound(await loadAudit(assertFound(row, label).auditId), 'Audit'), req.user);
      await db.update(T).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(T.id, id));
      return reply.status(204).send();
    });
}
