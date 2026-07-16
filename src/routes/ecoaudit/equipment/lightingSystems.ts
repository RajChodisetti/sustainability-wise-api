import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaLightingSystems } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import { assertFound, assertDraftMutable, assertAuditAccess, dateOrNow, requiredString, str, num, arr, photoMetadata, type JsonRecord } from '../helpers.js';
import { canonicalizeLightingSystemPayload } from '../lightingPhotoField.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

async function assertMutableAudit(id: string, user: Parameters<typeof assertAuditAccess>[1]) {
  const audit = assertFound(await loadAudit(id), 'Audit');
  assertAuditAccess(audit, user);
  assertDraftMutable(audit, 'Audit');
}

export async function eaLightingSystemRoutes(app: FastifyInstance): Promise<void> {
  const T = eaLightingSystems;
  const label = 'Lighting system';

  app.get('/audits/:auditId/lighting-systems', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/lighting-systems', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = canonicalizeLightingSystemPayload(req.body as JsonRecord);
      await assertMutableAudit(auditId, req.user);
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const [row] = await db.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt), zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        lightType: requiredString(body, 'lightType'), brandModel: str(body.brandModel), photo: str(body.photo),
        ratedWattage: num(body.ratedWattage), quantity: typeof body.quantity === 'number' ? Math.round(body.quantity) : null,
        fixturesInstalled: str(body.fixturesInstalled), fixturesPhoto: str(body.fixturesPhoto), areaLocation: str(body.areaLocation),
        controlsType: str(body.controlsType), operatingHours: str(body.operatingHours), mountingHeight: str(body.mountingHeight),
        mountingConstraintsPhoto: str(body.mountingConstraintsPhoto), circuitGrouping: str(body.circuitGrouping),
        sensorsPhoto: str(body.sensorsPhoto), accessLimitations: str(body.accessLimitations),
        switchboardControlsPhoto: str(body.switchboardControlsPhoto), energyImprovementObservations: str(body.energyImprovementObservations),
        extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
        photoDescs: photoMetadata(body.photoDescs),
      } as any).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: req.user });
      return reply.status(201).send(row);
    });

  app.get('/lighting-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/lighting-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      await assertMutableAudit(found.auditId, req.user);
      const body = canonicalizeLightingSystemPayload(req.body as JsonRecord);
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'local' };
      if ('lightType' in body) c.lightType = requiredString(body, 'lightType');
      for (const k of ['brandModel','photo','fixturesInstalled','fixturesPhoto','areaLocation','controlsType','operatingHours','mountingHeight','mountingConstraintsPhoto','circuitGrouping','sensorsPhoto','accessLimitations','switchboardControlsPhoto','energyImprovementObservations','extraNotes']) if (k in body) c[k] = str(body[k]);
      if ('ratedWattage' in body) c.ratedWattage = num(body.ratedWattage);
      if ('quantity' in body) c.quantity = typeof body.quantity === 'number' ? Math.round(body.quantity) : null;
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      if ('photoDescs' in body) c.photoDescs = photoMetadata(body.photoDescs);
      const [updated] = await db.update(T).set(c as any).where(eq(T.id, id)).returning();
      await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.auditId, actor: req.user });
      return reply.send(assertFound(updated, label));
    });

  app.delete('/lighting-systems/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
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
