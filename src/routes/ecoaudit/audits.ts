import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertAuditAccess,
  dateOrNow,
  isElevated,
  optionalString,
  purgeEcoauditAuditTree,
  requiredString,
  shouldPurgeQuery,
  type JsonRecord,
} from './helpers.js';
import { badRequest } from '../../utils/errors.js';

export async function eaAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const conditions = [isNull(eaAudits.deletedAt)];
    if (!isElevated(request.user)) {
      conditions.push(or(
        eq(eaAudits.createdByUserId, request.user.userId),
        eq(eaAudits.assignedInspectorUserId, request.user.userId),
      ) as any);
    }
    const audits = await db.select().from(eaAudits).where(and(...conditions)).orderBy(asc(eaAudits.siteName));
    return reply.send({ data: audits });
  });

  app.post('/', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const id = randomUUID();
    const createdAt = dateOrNow(body.createdAt);
    const [created] = await db.insert(eaAudits).values({
      id,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: dateOrNow(body.updatedAt),
      siteName: requiredString(body, 'siteName'),
      siteAddress: requiredString(body, 'siteAddress'),
      inspectorName: requiredString(body, 'inspectorName'),
      auditDate: typeof body.auditDate === 'string' ? body.auditDate : null,
      status: typeof body.status === 'string' ? body.status : 'Draft',
      createdByUserId: request.user.userId,
      assignedInspectorUserId: typeof body.assignedInspectorUserId === 'string' ? body.assignedInspectorUserId : null,
      startedAt: body.startedAt ? dateOrNow(body.startedAt) : null,
      completedAt: body.completedAt ? dateOrNow(body.completedAt) : null,
      createdAt,
    }).returning();
    return reply.status(201).send(created);
  });

  app.get('/:id', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    return reply.send(found);
  });

  app.patch('/:id', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as JsonRecord;
    if ('status' in body) throw badRequest('Use /complete to change status');
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    const changes: Partial<typeof eaAudits.$inferInsert> = { updatedAt: new Date(), syncStatus: 'local' };
    const sv = optionalString(body, 'siteName'); if (sv !== undefined) changes.siteName = sv ?? found.siteName;
    const sa = optionalString(body, 'siteAddress'); if (sa !== undefined) changes.siteAddress = sa ?? found.siteAddress;
    const iname = optionalString(body, 'inspectorName'); if (iname !== undefined) changes.inspectorName = iname ?? found.inspectorName;
    if ('auditDate' in body) changes.auditDate = typeof body.auditDate === 'string' ? body.auditDate : null;
    if ('assignedInspectorUserId' in body) changes.assignedInspectorUserId = typeof body.assignedInspectorUserId === 'string' ? body.assignedInspectorUserId : null;
    const [updated] = await db.update(eaAudits).set(changes).where(eq(eaAudits.id, id)).returning();
    return reply.send(assertFound(updated, 'Audit'));
  });

  app.delete('/:id', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const purge = shouldPurgeQuery(request.query as Record<string, unknown> | undefined);
    const [audit] = await db
      .select()
      .from(eaAudits)
      .where(purge ? eq(eaAudits.id, id) : and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    if (purge) {
      await purgeEcoauditAuditTree(id, found.reportPdfLocalPath);
      return reply.status(204).send();
    }
    await db.update(eaAudits).set({ deletedAt: new Date(), updatedAt: new Date(), syncStatus: 'local' }).where(eq(eaAudits.id, id));
    return reply.status(204).send();
  });

  app.patch('/:id/start', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    if (found.status === 'Completed') throw badRequest('Cannot start a completed audit');
    const now = new Date();
    const [updated] = await db.update(eaAudits).set({
      startedAt: now,
      updatedAt: now,
      syncStatus: 'local',
    }).where(eq(eaAudits.id, id)).returning();
    return reply.send(assertFound(updated, 'Audit'));
  });

  app.patch('/:id/complete', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    const now = new Date();
    const [updated] = await db.update(eaAudits).set({
      status: 'Completed',
      startedAt: found.startedAt ?? found.createdAt ?? now,
      completedAt: now,
      updatedAt: now,
      syncStatus: 'local',
    }).where(eq(eaAudits.id, id)).returning();
    return reply.send(assertFound(updated, 'Audit'));
  });
}
