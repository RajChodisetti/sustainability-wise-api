import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eaAudits, eaZones } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertDraftMutable, assertAuditOwnerPatchMutable, assertAuditAccess, dateOrNow, requiredString, optionalString, optionalStringArray, photoMetadata, type JsonRecord } from './helpers.js';
import {
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
} from '../../storage/photoCopyReferences.js';

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
      .orderBy(asc(eaZones.createdAt));
    return reply.send({ data: zones });
  });

  app.post('/audits/:auditId/zones', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const body = request.body as JsonRecord;
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    const foundAudit = assertFound(audit, 'Audit');
    assertAuditAccess(foundAudit, request.user);
    assertDraftMutable(foundAudit, 'Audit');
    const id = randomUUID();
    const [created] = await db.insert(eaZones).values({
      id, serverId: randomUUID(), syncStatus: 'synced',
      updatedAt: dateOrNow(body.updatedAt),
      auditId,
      zoneName: requiredString(body, 'zoneName'),
      zoneDescription: typeof body.zoneDescription === 'string' ? body.zoneDescription : null,
      photos: Array.isArray(body.photos) ? body.photos.map(String) : [],
      photoDescs: photoMetadata(body.photoDescs),
      createdAt: dateOrNow(body.createdAt),
    }).returning();
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: auditId, actor: request.user });
    return reply.status(201).send(created);
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
    const [audit] = await db.select().from(eaAudits).where(eq(eaAudits.id, found.auditId));
    const foundAudit = assertFound(audit, 'Audit');
    assertAuditAccess(foundAudit, request.user);
    assertAuditOwnerPatchMutable(foundAudit, body, 'Audit');
    const changes: Partial<typeof eaZones.$inferInsert> = { updatedAt: new Date(), syncStatus: 'local' };
    const zn = optionalString(body, 'zoneName'); if (zn !== undefined) changes.zoneName = zn ?? found.zoneName;
    if ('zoneDescription' in body) changes.zoneDescription = optionalString(body, 'zoneDescription') ?? null;
    const photos = optionalStringArray(body, 'photos'); if (photos !== undefined) changes.photos = photos;
    if ('photoDescs' in body) changes.photoDescs = photoMetadata(body.photoDescs);
    const [updated] = await db.update(eaZones).set(changes).where(eq(eaZones.id, id)).returning();
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.auditId, actor: request.user });
    return reply.send(assertFound(updated, 'Zone'));
  });

  app.delete('/zones/:id', {
    schema: { tags: ['EcoAudit Zones'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [zone] = await db.select().from(eaZones).where(and(eq(eaZones.id, id), isNull(eaZones.deletedAt)));
    const found = assertFound(zone, 'Zone');
    const [audit] = await db.select().from(eaAudits).where(eq(eaAudits.id, found.auditId));
    const foundAudit = assertFound(audit, 'Audit');
    assertAuditAccess(foundAudit, request.user);
    assertDraftMutable(foundAudit, 'Audit');
    await db.update(eaZones).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(eaZones.id, id));
    await releaseCopyReferencesForEntity('ecoaudit', id);
    return reply.status(204).send();
  });

}
