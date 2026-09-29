import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaHvacUnits } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import { assertFound, assertAuditAccess, dateOrNow, requiredString, str, num, arr, photoMetadata, type JsonRecord } from '../helpers.js';
import { setEcoAuditRevisionHeader } from '../auditConcurrency.js';
import { isCompletedPhotoMetadataPatch, mutateEcoAuditTree } from '../auditMutation.js';
import { assertCompletedPhotoMetadataReferencesExistingPhotos } from '../completedPhotoMetadata.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
}

export async function eaHvacUnitRoutes(app: FastifyInstance): Promise<void> {
  const T = eaHvacUnits;
  const label = 'HVAC unit';

  app.get('/audits/:auditId/hvac-units', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      assertAuditAccess(assertFound(await loadAudit(auditId), 'Audit'), req.user);
      return reply.send({ data: await db.select().from(T).where(and(eq(T.auditId, auditId), isNull(T.deletedAt))).orderBy(asc(T.createdAt)) });
    });

  app.post('/audits/:auditId/hvac-units', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { auditId } = req.params as { auditId: string };
      const body = req.body as JsonRecord;
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const mutation = await mutateEcoAuditTree({ auditId, zoneId, user: req.user, request: req, mutate: async (tx) => {
        const [row] = await tx.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt), zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        unitName: requiredString(body, 'unitName'), make: str(body.make), photo: str(body.photo), location: str(body.location), type: str(body.type),
        model: str(body.model), serialNumber: str(body.serialNumber), heatingCapacityKw: num(body.heatingCapacityKw), coolingCapacityKw: num(body.coolingCapacityKw),
        powerSupplyPhase: str(body.powerSupplyPhase), nameplatePhotos: str(body.nameplatePhotos), indoorUnitModel: str(body.indoorUnitModel),
        indoorUnitSerial: str(body.indoorUnitSerial), indoorUnitNameplatePhoto: str(body.indoorUnitNameplatePhoto),
        controllerType: str(body.controllerType), controllerModel: str(body.controllerModel), controllerPhoto: str(body.controllerPhoto),
        temperatureSensorType: str(body.temperatureSensorType), systemCoverage: str(body.systemCoverage),
        energyImprovementObservations: str(body.energyImprovementObservations), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
        photoDescs: photoMetadata(body.photoDescs),
        } as any).returning();
        return assertFound(row, label);
      } });
      setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
      return reply.status(201).send(mutation.value);
    });

  app.get('/hvac-units/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      assertAuditAccess(assertFound(await loadAudit(found.auditId), 'Audit'), req.user);
      return reply.send(found);
    });

  app.patch('/hvac-units/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db.select().from(T).where(and(eq(T.id, id), isNull(T.deletedAt)));
      const found = assertFound(row, label);
      const body = req.body as JsonRecord;
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'synced' };
      if ('unitName' in body) c.unitName = requiredString(body, 'unitName');
      for (const k of ['make','photo','location','type','model','serialNumber','powerSupplyPhase','nameplatePhotos','indoorUnitModel','indoorUnitSerial','indoorUnitNameplatePhoto','controllerType','controllerModel','controllerPhoto','temperatureSensorType','systemCoverage','energyImprovementObservations','extraNotes']) if (k in body) c[k] = str(body[k]);
      for (const k of ['heatingCapacityKw','coolingCapacityKw']) if (k in body) c[k] = num(body[k]);
      if ('extraPhotos' in body) c.extraPhotos = arr(body.extraPhotos);
      if ('photoDescs' in body) c.photoDescs = photoMetadata(body.photoDescs);
      const mutation = await mutateEcoAuditTree({ auditId: found.auditId, user: req.user, request: req,
        completedPhotoMetadataValidation: isCompletedPhotoMetadataPatch(body)
          ? () => assertCompletedPhotoMetadataReferencesExistingPhotos(found, body.photoDescs)
          : undefined,
        mutate: async (tx) => {
          const [updated] = await tx.update(T).set(c as any).where(and(eq(T.id, id), eq(T.auditId, found.auditId), isNull(T.deletedAt))).returning();
          return assertFound(updated, label);
        } });
      setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
      return reply.send(mutation.value);
    });

  app.delete('/hvac-units/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
    async (req, reply) => {
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
