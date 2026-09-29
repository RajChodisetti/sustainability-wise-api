import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { eaAudits, eaAdditionalSwitchboards } from '../../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../../auth/middleware.js';
import {
  releaseCopyReferencesForEntity,
} from '../../../storage/photoCopyReferences.js';
import { assertFound, assertAuditAccess, dateOrNow, requiredString, str, arr, photoMetadata, type JsonRecord } from '../helpers.js';
import { setEcoAuditRevisionHeader } from '../auditConcurrency.js';
import { isCompletedPhotoMetadataPatch, mutateEcoAuditTree } from '../auditMutation.js';
import { assertCompletedPhotoMetadataReferencesExistingPhotos } from '../completedPhotoMetadata.js';

async function loadAudit(id: string) {
  const [a] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
  return a;
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
      const zoneId = typeof body.zoneId === 'string' ? body.zoneId : assertFound(null, 'zoneId');
      const mutation = await mutateEcoAuditTree({ auditId, zoneId, user: req.user, request: req, mutate: async (tx) => {
        const [row] = await tx.insert(T).values({
        id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced', updatedAt: dateOrNow(body.updatedAt),
        zoneId, auditId, createdAt: dateOrNow(body.createdAt),
        name: requiredString(body, 'name'), location: str(body.location), mapLocator: str(body.mapLocator),
        type: str(body.type), photo: str(body.photo), subCircuitsDescription: str(body.subCircuitsDescription),
        comments: str(body.comments), extraNotes: str(body.extraNotes), extraPhotos: arr(body.extraPhotos),
        photoDescs: photoMetadata(body.photoDescs),
        } as any).returning();
        return assertFound(row, label);
      } });
      setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
      return reply.status(201).send(mutation.value);
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
      const body = req.body as JsonRecord;
      const c: Record<string, unknown> = { updatedAt: new Date(), syncStatus: 'synced' };
      if ('name' in body) c.name = requiredString(body, 'name');
      for (const k of ['location','mapLocator','type','photo','subCircuitsDescription','comments','extraNotes']) if (k in body) c[k] = str(body[k]);
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

  app.delete('/additional-switchboards/:id', { schema: { tags: ['EcoAudit Equipment'] }, preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')] },
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
