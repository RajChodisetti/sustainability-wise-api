import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaAudits,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaHotWaterSystems,
  eaHvacUnits,
  eaAuditWorkSessions,
  eaLightingSystems,
  eaMainSwitchboards,
  eaSolarPv,
  eaZones,
} from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import {
  assertFound,
  assertDraftMutable,
  assertAuditAccess,
  dateOrNow,
  isElevated,
  optionalString,
  purgeEcoauditAuditTree,
  requiredString,
  shouldPurgeQuery,
  type JsonRecord,
} from './helpers.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { cloneRecordForInsert, copyableBodyOverrides, copyNameWithSuffix } from '../copyUtils.js';
import {
  assertWorkSessionCheckpointAccess,
  decideWorkSessionUpdate,
  parseWorkSessionBody,
  presentWorkSession,
  workSessionBodySchema,
  workSessionResponseSchema,
} from '../workSessions.js';
import {
  resolveCompletionTiming,
  resolveReopenTiming,
  resolveSyncedAuditTiming,
} from './auditTiming.js';
import {
  ecoPhotoValues,
  ecoPhotoFieldReferences,
  linkCopiedPhotoReferences,
  reconcilePhotoCopyReferencesForParent,
  type CopiedPhotoEntity,
} from '../../storage/photoCopyReferences.js';
import { completeLinkedSchedulerEvents } from '../../services/schedulerCompletionService.js';

const equipmentTables = [
  { table: eaMainSwitchboards, entityType: 'main_switchboard' },
  { table: eaAdditionalSwitchboards, entityType: 'additional_switchboard' },
  { table: eaHvacUnits, entityType: 'hvac_unit' },
  { table: eaLightingSystems, entityType: 'lighting_system' },
  { table: eaSolarPv, entityType: 'solar_pv' },
  { table: eaForkliftChargers, entityType: 'forklift_charger' },
  { table: eaHotWaterSystems, entityType: 'hot_water_system' },
  { table: eaGeneralWater, entityType: 'general_water' },
  { table: eaGeneralElectricity, entityType: 'general_electricity' },
];

async function copyEquipmentRows(
  tx: any,
  table: any,
  sourceAuditId: string,
  targetAuditId: string,
  zoneIdMap: Map<string, string>,
  entityType: string,
  copiedEntities: CopiedPhotoEntity[],
  sourceZoneId?: string,
): Promise<void> {
  const conditions = [
    eq(table.auditId, sourceAuditId),
    isNull(table.deletedAt),
  ];
  if (sourceZoneId) conditions.push(eq(table.zoneId, sourceZoneId));

  const rows = await tx.select().from(table).where(and(...conditions));
  if (rows.length === 0) return;

  const values = rows.map((row: Record<string, unknown>) => cloneRecordForInsert(row, {
      auditId: targetAuditId,
      zoneId: zoneIdMap.get(String(row.zoneId ?? '')) ?? row.zoneId,
    }));
  await tx.insert(table).values(values);
  rows.forEach((row: Record<string, unknown>, index: number) => {
    copiedEntities.push({
      sourceEntityId: String(row.id),
      targetEntityId: String(values[index].id),
      targetEntityType: entityType,
      photoValues: ecoPhotoValues(row),
      photoReferences: ecoPhotoFieldReferences(row),
    });
  });
}

async function copyAuditChildren(
  tx: any,
  sourceAuditId: string,
  targetAuditId: string,
): Promise<CopiedPhotoEntity[]> {
  const zoneIdMap = new Map<string, string>();
  const copiedEntities: CopiedPhotoEntity[] = [];
  const zones = await tx
    .select()
    .from(eaZones)
    .where(and(eq(eaZones.auditId, sourceAuditId), isNull(eaZones.deletedAt)));

  for (const zone of zones) {
    const values = cloneRecordForInsert(zone, { auditId: targetAuditId });
    zoneIdMap.set(zone.id, String(values.id));
    await tx.insert(eaZones).values(values as typeof eaZones.$inferInsert);
    copiedEntities.push({
      sourceEntityId: zone.id,
      targetEntityId: String(values.id),
      targetEntityType: 'zone',
      photoValues: ecoPhotoValues(zone),
      photoReferences: ecoPhotoFieldReferences(zone),
    });
  }

  for (const { table, entityType } of equipmentTables) {
    await copyEquipmentRows(
      tx,
      table,
      sourceAuditId,
      targetAuditId,
      zoneIdMap,
      entityType,
      copiedEntities,
    );
  }
  return copiedEntities;
}

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
    const status = typeof body.status === 'string' ? body.status : 'Draft';
    const receivedAt = new Date();
    const createdAt = body.createdAt ? dateOrNow(body.createdAt) : receivedAt;
    const updatedAt = body.updatedAt ? dateOrNow(body.updatedAt) : receivedAt;
    const timing = resolveSyncedAuditTiming({
      status,
      incomingStartedAt: body.startedAt ? dateOrNow(body.startedAt) : null,
      incomingCompletedAt: body.completedAt ? dateOrNow(body.completedAt) : null,
      createdAt,
      observedAt: receivedAt,
    });
    const [created] = await db.insert(eaAudits).values({
      id,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt,
      siteName: requiredString(body, 'siteName'),
      siteAddress: requiredString(body, 'siteAddress'),
      inspectorName: requiredString(body, 'inspectorName'),
      auditDate: typeof body.auditDate === 'string' ? body.auditDate : null,
      status,
      createdByUserId: request.user.userId,
      // Assignment is controlled by scheduler/admin workflows, never by an
      // inspector-supplied create payload.
      assignedInspectorUserId: null,
      ...timing,
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
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: found.id, actor: request.user });
    return reply.send(found);
  });

  app.put('/:id/active-time/sessions/:sessionId', {
    schema: {
      tags: ['EcoAudit Audits'],
      summary: 'Checkpoint active foreground time for an audit',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'sessionId'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          sessionId: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
      body: workSessionBodySchema,
      response: { 200: workSessionResponseSchema },
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id, sessionId } = request.params as { id: string; sessionId: string };
    const incoming = parseWorkSessionBody(request.body);
    const response = await db.transaction(async (tx) => {
      const [audit] = await tx
        .select()
        .from(eaAudits)
        .where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)))
        .for('update');
      const found = assertFound(audit, 'Audit');

      const [existing] = await tx
        .select()
        .from(eaAuditWorkSessions)
        .where(and(
          eq(eaAuditWorkSessions.auditId, id),
          eq(eaAuditWorkSessions.id, sessionId),
        ));
      assertWorkSessionCheckpointAccess({
        incoming,
        existing,
        actorUserId: request.user.userId,
        assertParentAccess: () => assertAuditAccess(found, request.user),
      });
      const decision = decideWorkSessionUpdate({
        incoming,
        existing,
        actorUserId: request.user.userId,
        completed: found.status === 'Completed',
        completionBoundary: found.status === 'Completed' ? found.completedAt : null,
        completedDetail: 'audit_completed_time_tracking_disabled',
      });

      if (decision.action === 'current') {
        return presentWorkSession(existing!, false);
      }
      if (decision.action === 'insert') {
        const [inserted] = await tx
          .insert(eaAuditWorkSessions)
          .values({
            id: sessionId,
            auditId: id,
            actorUserId: request.user.userId,
            ...incoming,
          })
          .returning();
        return presentWorkSession(inserted, true);
      }

      const [updated] = await tx
        .update(eaAuditWorkSessions)
        .set({ ...incoming, updatedAt: new Date() })
        .where(and(
          eq(eaAuditWorkSessions.auditId, id),
          eq(eaAuditWorkSessions.id, sessionId),
          eq(eaAuditWorkSessions.revision, existing!.revision),
        ))
        .returning();
      if (!updated) throw conflict('work_session_concurrent_update');
      return presentWorkSession(updated, true);
    });
    return reply.send(response);
  });

  app.patch('/:id', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as JsonRecord;
    if ('status' in body) throw badRequest('Use /complete or /reopen to change status');
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    assertDraftMutable(found, 'Audit');
    const changes: Partial<typeof eaAudits.$inferInsert> = { updatedAt: new Date(), syncStatus: 'local' };
    const sv = optionalString(body, 'siteName'); if (sv !== undefined) changes.siteName = sv ?? found.siteName;
    const sa = optionalString(body, 'siteAddress'); if (sa !== undefined) changes.siteAddress = sa ?? found.siteAddress;
    const iname = optionalString(body, 'inspectorName'); if (iname !== undefined) changes.inspectorName = iname ?? found.inspectorName;
    if ('auditDate' in body) changes.auditDate = typeof body.auditDate === 'string' ? body.auditDate : null;
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
    if (found.startedAt) return reply.send(found);

    const now = new Date();
    const [updated] = await db.update(eaAudits).set({
      startedAt: now,
      updatedAt: now,
      syncStatus: 'local',
    }).where(and(eq(eaAudits.id, id), isNull(eaAudits.startedAt))).returning();

    if (updated) return reply.send(updated);
    const [concurrentlyStarted] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    return reply.send(assertFound(concurrentlyStarted, 'Audit'));
  });

  app.patch('/:id/complete', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await db.transaction(async (tx) => {
      const [audit] = await tx.select().from(eaAudits).where(and(
        eq(eaAudits.id, id),
        isNull(eaAudits.deletedAt),
      )).for('update');
      const found = assertFound(audit, 'Audit');
      assertAuditAccess(found, request.user);
      const now = new Date();
      const timing = resolveCompletionTiming(found, now);
      const [completed] = await tx.update(eaAudits).set({
        status: 'Completed',
        startedAt: sql<Date>`coalesce(${eaAudits.startedAt}, ${sql.param(timing.startedAt, eaAudits.startedAt)})`,
        completedAt: sql<Date>`coalesce(${eaAudits.completedAt}, ${sql.param(timing.completedAt, eaAudits.completedAt)})`,
        updatedAt: now,
        syncStatus: 'local',
      }).where(and(
        eq(eaAudits.id, id),
        isNull(eaAudits.deletedAt),
      )).returning();
      const foundCompleted = assertFound(completed, 'Audit');
      await completeLinkedSchedulerEvents(tx, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: id,
      }, { observedAt: now });
      return foundCompleted;
    });
    return reply.send(updated);
  });

  app.patch('/:id/reopen', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    if (found.status === 'Draft') return reply.send(found);
    if (found.status !== 'Completed') throw badRequest('Only completed audits can be reopened');

    const now = new Date();
    const timing = resolveReopenTiming(found);
    const [updated] = await db.update(eaAudits).set({
      status: 'Draft',
      ...timing,
      updatedAt: now,
      syncStatus: 'local',
    }).where(eq(eaAudits.id, id)).returning();
    return reply.send(assertFound(updated, 'Audit'));
  });

  app.post('/:id/copy', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as JsonRecord;
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);

    const includeChildren = body.includeChildren !== false;
    const created = await db.transaction(async (tx) => {
      const overrides = copyableBodyOverrides(found, body, ['status', 'siteName']);
      const [copiedAudit] = await tx.insert(eaAudits).values(cloneRecordForInsert(found, {
        ...overrides,
        siteName: copyNameWithSuffix(found.siteName),
        status: 'Draft',
        createdByUserId: request.user.userId,
        reportPdfLocalPath: null,
        reportPdfRemoteUrl: null,
        startedAt: null,
        completedAt: null,
      }) as typeof eaAudits.$inferInsert).returning();
      const targetAudit = assertFound(copiedAudit, 'Copied audit');

      const copiedEntities = includeChildren
        ? await copyAuditChildren(tx, id, targetAudit.id)
        : [];
      await linkCopiedPhotoReferences({
        app: 'ecoaudit',
        sourceParentId: id,
        targetParentId: targetAudit.id,
        entities: copiedEntities,
        executor: tx as unknown as typeof db,
      });
      await reconcilePhotoCopyReferencesForParent({
        app: 'ecoaudit',
        parentId: targetAudit.id,
        executor: tx as unknown as typeof db,
        actor: request.user,
      });

      return targetAudit;
    });

    return reply.status(201).send(created);
  });
}
