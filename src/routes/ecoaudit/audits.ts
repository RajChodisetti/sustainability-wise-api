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
import { badRequest } from '../../utils/errors.js';
import { cloneRecordForInsert, copyableBodyOverrides, copyNameWithSuffix } from '../copyUtils.js';
import { resolveCompletionTiming, resolveSyncedAuditTiming } from './auditTiming.js';
import {
  ecoPhotoValues,
  ecoPhotoFieldReferences,
  linkCopiedPhotoReferences,
  reconcilePhotoCopyReferencesForParent,
  type CopiedPhotoEntity,
} from '../../storage/photoCopyReferences.js';

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
      updatedAt,
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
      assignedInspectorUserId: typeof body.assignedInspectorUserId === 'string' ? body.assignedInspectorUserId : null,
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
    assertDraftMutable(found, 'Audit');
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
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, id), isNull(eaAudits.deletedAt)));
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, request.user);
    const now = new Date();
    const timing = resolveCompletionTiming(found, now);
    const [updated] = await db.update(eaAudits).set({
      status: 'Completed',
      startedAt: sql<Date>`coalesce(${eaAudits.startedAt}, ${sql.param(timing.startedAt, eaAudits.startedAt)})`,
      completedAt: sql<Date>`coalesce(${eaAudits.completedAt}, ${sql.param(timing.completedAt, eaAudits.completedAt)})`,
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
