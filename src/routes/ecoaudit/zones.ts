import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eaAudits, eaZones } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess, dateOrNow, requiredString, optionalString, optionalStringArray, photoMetadata, type JsonRecord } from './helpers.js';
import {
  releaseCopyReferencesForEntity,
} from '../../storage/photoCopyReferences.js';
import { setEcoAuditRevisionHeader } from './auditConcurrency.js';
import { isCompletedPhotoMetadataPatch, mutateEcoAuditTree } from './auditMutation.js';
import { assertCompletedPhotoMetadataReferencesExistingPhotos } from './completedPhotoMetadata.js';

export async function eaZoneRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audits/:auditId/zones', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    const zones = await db.select().from(eaZones)
      .where(and(eq(eaZones.auditId, auditId), isNull(eaZones.deletedAt)))
      .orderBy(asc(eaZones.createdAt), asc(eaZones.id));
    return reply.send({ data: zones });
  });

  app.post('/audits/:auditId/zones', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const body = request.body as JsonRecord;
    const mutation = await mutateEcoAuditTree({
      auditId,
      user: request.user,
      request,
      mutate: async (tx) => {
        const [created] = await tx.insert(eaZones).values({
          id: randomUUID(), serverId: randomUUID(), syncStatus: 'synced',
          updatedAt: dateOrNow(body.updatedAt),
          auditId,
          zoneName: requiredString(body, 'zoneName'),
          zoneDescription: typeof body.zoneDescription === 'string' ? body.zoneDescription : null,
          photos: Array.isArray(body.photos) ? body.photos.map(String) : [],
          photoDescs: photoMetadata(body.photoDescs),
          createdAt: dateOrNow(body.createdAt),
        }).returning();
        return assertFound(created, 'Zone');
      },
    });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.status(201).send(mutation.value);
  });

  app.get('/zones/:id', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [zone] = await db.select().from(eaZones).where(and(eq(eaZones.id, id), isNull(eaZones.deletedAt)));
    const found = assertFound(zone, 'Zone');
    const [audit] = await db.select().from(eaAudits).where(eq(eaAudits.id, found.auditId));
    const foundAudit = assertFound(audit, 'Audit');
    assertAuditAccess(foundAudit, request.user);
    return reply.send(found);
  });

  app.patch('/zones/:id', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as JsonRecord;
    const [zone] = await db.select().from(eaZones).where(and(eq(eaZones.id, id), isNull(eaZones.deletedAt)));
    const found = assertFound(zone, 'Zone');
    const changes: Partial<typeof eaZones.$inferInsert> = { updatedAt: new Date(), syncStatus: 'synced' };
    const zn = optionalString(body, 'zoneName'); if (zn !== undefined) changes.zoneName = zn ?? found.zoneName;
    if ('zoneDescription' in body) changes.zoneDescription = optionalString(body, 'zoneDescription') ?? null;
    const photos = optionalStringArray(body, 'photos'); if (photos !== undefined) changes.photos = photos;
    if ('photoDescs' in body) changes.photoDescs = photoMetadata(body.photoDescs);
    const mutation = await mutateEcoAuditTree({
      auditId: found.auditId,
      user: request.user,
      request,
      completedPhotoMetadataValidation: isCompletedPhotoMetadataPatch(body)
        ? () => assertCompletedPhotoMetadataReferencesExistingPhotos(found, body.photoDescs)
        : undefined,
      mutate: async (tx) => {
        const [updated] = await tx.update(eaZones).set(changes).where(and(
          eq(eaZones.id, id),
          eq(eaZones.auditId, found.auditId),
          isNull(eaZones.deletedAt),
        )).returning();
        return assertFound(updated, 'Zone');
      },
    });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.send(mutation.value);
  });

  app.delete('/zones/:id', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [zone] = await db.select().from(eaZones).where(and(eq(eaZones.id, id), isNull(eaZones.deletedAt)));
    const found = assertFound(zone, 'Zone');
    const mutation = await mutateEcoAuditTree({
      auditId: found.auditId,
      user: request.user,
      request,
      mutate: async (tx) => {
        const [deleted] = await tx.update(eaZones).set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          syncStatus: 'synced',
        }).where(and(
          eq(eaZones.id, id),
          eq(eaZones.auditId, found.auditId),
          isNull(eaZones.deletedAt),
        )).returning();
        return assertFound(deleted, 'Zone');
      },
    });
    await releaseCopyReferencesForEntity('ecoaudit', id).catch((error) => {
      request.log.warn({ error, zoneId: id }, 'EcoAudit photo reference cleanup deferred');
    });
    setEcoAuditRevisionHeader(reply, mutation.audit.treeRevision);
    return reply.status(204).send();
  });

}
