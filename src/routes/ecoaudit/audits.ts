import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  eaAdditionalSwitchboards,
  eaAuditEditLeases,
  eaAuditPurgeTombstones,
  eaAudits,
  eaForkliftChargers,
  eaGeneralElectricity,
  eaGeneralWater,
  eaWaterAssets,
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
  cleanupPurgedEcoauditAudit,
  dateOrNow,
  isElevated,
  optionalString,
  purgeEcoauditAuditTreeRows,
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
  resolveLegacyReopenMutation,
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
import { rememberEcoAuditClientSite } from './clientSiteMemory.js';
import {
  assertAuditReopenVersion,
  nextAuditUpdatedAt,
  parseAuditReopenPreconditions,
} from './auditVersion.js';
import {
  assertEcoAuditLeaseAuthority,
  assertEcoAuditCreateIdNotPurged,
  assertEcoAuditCopySourceEligible,
  assertEcoAuditLegacyMutationAllowed,
  assertEcoAuditProtocolCompatibility,
  acquireEcoAuditEditLease,
  bumpEcoAuditTreeRevision,
  canonicalCommandFingerprint,
  completeEcoAuditLease,
  createEcoAuditLeaseForNewAudit,
  ecoAuditCommandLeaseToken,
  ecoAuditClientInstanceId,
  ecoAuditCompletionFence,
  isEcoAuditProtocolV2,
  loadEcoAuditLease,
  lockEcoAuditForMutation,
  parseEcoAuditEditClient,
  parseEcoAuditLeaseRequest,
  parseEcoAuditWriteContext,
  presentEcoAuditLease,
  releaseEcoAuditEditLease,
  parseEcoAuditRecoveryKey,
  recoverEcoAuditEditLeaseAfterCommandReplay,
  renewEcoAuditEditLease,
  replayEcoAuditCommand,
  saveEcoAuditCommand,
  setEcoAuditRevisionHeader,
  takeOverEcoAuditEditLease,
} from './auditConcurrency.js';
import {
  loadConsistentEcoAuditTreeWithLease,
  loadEcoAuditTree,
  pinEcoAuditRecordVersion,
  presentEcoAudit,
  presentEcoAuditForRequest,
} from './auditTreeService.js';

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
  { table: eaWaterAssets, entityType: 'water_asset' },
];

function commandUuid(...parts: string[]): string {
  const bytes = Buffer.from(createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ecoAuditCopyBodyOverrides(
  source: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  // Assignment is an authorization boundary. A caller may not grant another
  // user access by smuggling an assignee into an otherwise valid copy request,
  // and the source assignee must not silently retain access to the new copy.
  return {
    ...copyableBodyOverrides(source, body, [
      'status',
      'siteName',
      'assignedInspectorUserId',
    ]),
    assignedInspectorUserId: null,
  };
}

type EcoAuditCompletionCommandResponse = {
  audit: Record<string, unknown>;
  treeRevision: number;
  editFence: number;
  recordVersionNumber: number;
  editLease: null;
  replayed: false;
};

/** Return the durable wire result without consulting a later audit head. */
export function exactEcoAuditCompletionReplay(
  stored: Record<string, unknown>,
): EcoAuditCompletionCommandResponse {
  if (
    !stored.audit
    || typeof stored.audit !== 'object'
    || !Number.isSafeInteger(stored.treeRevision)
    || !Number.isSafeInteger(stored.editFence)
    || !Number.isSafeInteger(stored.recordVersionNumber)
    || stored.editLease !== null
    || stored.replayed !== false
  ) {
    throw conflict('audit_completion_replay_invalid');
  }
  return stored as EcoAuditCompletionCommandResponse;
}

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
    const { audits, leases } = await db.transaction(async (tx) => {
      const snapshotAudits = await tx.select().from(eaAudits)
        .where(and(...conditions))
        .orderBy(asc(eaAudits.siteName));
      const snapshotLeases = snapshotAudits.length
        ? await tx.select().from(eaAuditEditLeases).where(inArray(
            eaAuditEditLeases.auditId,
            snapshotAudits.map((audit) => audit.id),
          ))
        : [];
      return { audits: snapshotAudits, leases: snapshotLeases };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const leasesByAudit = new Map(leases.map((lease) => [lease.auditId, lease]));
    const clientInstanceId = ecoAuditClientInstanceId(request);
    return reply.send({
      data: audits.map((audit) => presentEcoAudit(audit, leasesByAudit.get(audit.id), {
        userId: request.user.userId,
        clientInstanceId,
      })),
    });
  });

  app.post('/', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    assertEcoAuditProtocolCompatibility(request);
    const protocolV2 = isEcoAuditProtocolV2(request);
    const editClient = protocolV2 ? parseEcoAuditEditClient(body.editClient) : null;
    const idempotencyKey = protocolV2
      ? parseEcoAuditRecoveryKey(body.idempotencyKey)
      : '';
    const suppliedAuditId = typeof body.id === 'string' ? body.id.trim() : '';
    if (protocolV2 && suppliedAuditId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(suppliedAuditId)) {
      throw badRequest('id must be a UUID when supplied');
    }
    const id = protocolV2
      ? suppliedAuditId || commandUuid('ecoaudit-create', request.user.userId, editClient!.clientInstanceId, idempotencyKey)
      : randomUUID();
    const status = protocolV2
      ? 'Draft'
      : typeof body.status === 'string' ? body.status : 'Draft';
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
    const requestFingerprint = protocolV2 ? canonicalCommandFingerprint({
      operation: 'create',
      body: { ...body, idempotencyKey: undefined },
    }) : '';
    const created = await db.transaction(async (tx) => {
      if (protocolV2) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecoaudit:create:${id}`}))`);
        const [purgeTombstone] = await tx.select({ auditId: eaAuditPurgeTombstones.auditId })
          .from(eaAuditPurgeTombstones)
          .where(eq(eaAuditPurgeTombstones.auditId, id));
        assertEcoAuditCreateIdNotPurged(purgeTombstone);
        const [existing] = await tx.select().from(eaAudits).where(eq(eaAudits.id, id));
        if (existing) {
          const replay = await replayEcoAuditCommand(tx, {
            auditId: id,
            operation: 'create',
            actorUserId: request.user.userId,
            clientInstanceId: editClient!.clientInstanceId,
            idempotencyKey,
            requestFingerprint,
          });
          if (!replay) throw conflict('idempotency_key_reused');
          return {
            audit: existing,
            clientId: null,
            clientSiteId: null,
            lease: undefined,
            leaseToken: undefined,
            replayResult: replay,
            replay: true as const,
          };
        }
      }
      const [inserted] = await tx.insert(eaAudits).values({
        id,
        serverId: randomUUID(),
        syncStatus: 'synced',
        updatedAt,
        siteName: requiredString(body, 'siteName'),
        siteAddress: requiredString(body, 'siteAddress'),
        inspectorName: requiredString(body, 'inspectorName'),
        auditDate: typeof body.auditDate === 'string' ? body.auditDate : null,
        status,
        treeRevision: protocolV2 ? 1 : 1,
        recordVersionNumber: 0,
        editFence: protocolV2 ? 1 : 0,
        createdByUserId: request.user.userId,
        // Assignment is controlled by scheduler/admin workflows, never by an
        // inspector-supplied create payload.
        assignedInspectorUserId: null,
        ...timing,
        createdAt,
      }).returning();
      const foundCreated = assertFound(inserted, 'Audit');
      const remembered = await rememberEcoAuditClientSite(tx, body, foundCreated);
      if (status === 'Completed') {
        await completeLinkedSchedulerEvents(tx, {
          sourceApp: 'ecoaudit',
          sourceType: 'audit',
          sourceId: id,
        }, {
          observedAt: receivedAt,
          completionProvenance: 'offline_transition',
        });
      }
      if (!protocolV2) return {
        ...remembered,
        lease: undefined,
        leaseToken: undefined,
        replay: false as const,
      };
      const lease = await createEcoAuditLeaseForNewAudit(tx, {
        auditId: id,
        actorUserId: request.user.userId,
        client: editClient!,
        fence: 1,
        leaseToken: ecoAuditCommandLeaseToken({
          auditId: id,
          operation: 'create',
          actorUserId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
          idempotencyKey,
        }),
      });
      const result = {
        auditId: id,
        treeRevision: 1,
        editFence: 1,
      };
      await saveEcoAuditCommand(tx, {
        auditId: id,
        operation: 'create',
        actorUserId: request.user.userId,
        clientInstanceId: editClient!.clientInstanceId,
        idempotencyKey,
        requestFingerprint,
        baseTreeRevision: 0,
        resultingTreeRevision: 1,
        recordVersionNumber: 0,
        result,
      });
      return { ...remembered, ...lease, replay: false as const };
    });
    if (protocolV2 && created.replay) {
      const recovered = await recoverEcoAuditEditLeaseAfterCommandReplay({
        auditId: id,
        user: request.user,
        client: editClient!,
        operation: 'create',
        idempotencyKey,
        expectedTreeRevision: Number(created.replayResult.treeRevision),
        expectedFence: Number(created.replayResult.editFence),
      });
      setEcoAuditRevisionHeader(reply, recovered.treeRevision);
      return reply.send({
        audit: presentEcoAudit(recovered.audit, recovered.lease, {
          userId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
        }),
        treeRevision: recovered.treeRevision,
        editFence: recovered.editFence,
        leaseToken: recovered.leaseToken,
        editLease: recovered.editLease,
        replayed: true,
      });
    }
    if (protocolV2) {
      setEcoAuditRevisionHeader(reply, created.audit.treeRevision);
      return reply.status(201).send({
        audit: presentEcoAudit(created.audit, created.lease, {
          userId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
        }),
        treeRevision: created.audit.treeRevision,
        editFence: created.audit.editFence,
        leaseToken: created.leaseToken,
        editLease: presentEcoAuditLease(created.lease, {
          userId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
        }),
        replayed: false,
      });
    }
    return reply.status(201).send({
      ...created.audit,
      clientId: created.clientId,
      clientSiteId: created.clientSiteId,
    });
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
    return reply.send(await presentEcoAuditForRequest(db, found, request.user, request));
  });

  app.get('/:id/tree', {
    schema: {
      tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { knownTreeRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } },
      },
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { knownTreeRevision } = request.query as { knownTreeRevision?: number };
    const snapshot = await loadConsistentEcoAuditTreeWithLease(id, knownTreeRevision);
    const tree = snapshot.tree;
    const found = assertFound(tree, 'Audit');
    assertAuditAccess(found.audit, request.user);
    setEcoAuditRevisionHeader(reply, found.audit.treeRevision);
    return reply
      .header('Cache-Control', 'private, no-store')
      .send({
        ...found,
        audit: presentEcoAudit(found.audit, snapshot.lease, {
          userId: request.user.userId,
          clientInstanceId: ecoAuditClientInstanceId(request),
        }),
        treeRevision: found.audit.treeRevision,
        recordVersionNumber: found.audit.recordVersionNumber,
        pulledAt: new Date().toISOString(),
      });
  });

  app.post('/:id/edit-lease', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    if (!isEcoAuditProtocolV2(request)) throw conflict('ecoaudit_client_upgrade_required');
    const { id } = request.params as { id: string };
    const leaseBody = request.body as Record<string, unknown>;
    const idempotencyKey = parseEcoAuditRecoveryKey(
      leaseBody.idempotencyKey ?? request.headers['idempotency-key'],
    );
    const result = await acquireEcoAuditEditLease({
      auditId: id,
      user: request.user,
      lease: parseEcoAuditLeaseRequest(leaseBody),
      idempotencyKey,
    });
    setEcoAuditRevisionHeader(reply, result.treeRevision);
    return reply.header('Cache-Control', 'private, no-store').send(result);
  });

  app.put('/:id/edit-lease', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await renewEcoAuditEditLease({
      auditId: id,
      user: request.user,
      request,
    });
    setEcoAuditRevisionHeader(reply, result.treeRevision);
    return reply.header('Cache-Control', 'private, no-store').send(result);
  });

  app.delete('/:id/edit-lease', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await releaseEcoAuditEditLease({
      auditId: id,
      user: request.user,
      request,
    });
    return reply.status(204).send();
  });

  app.post('/:id/edit-lease/takeover', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    if (!isEcoAuditProtocolV2(request)) throw conflict('ecoaudit_client_upgrade_required');
    const { id } = request.params as { id: string };
    const body = request.body as JsonRecord;
    const result = await takeOverEcoAuditEditLease({
      auditId: id,
      user: request.user,
      lease: parseEcoAuditLeaseRequest(body),
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    setEcoAuditRevisionHeader(reply, result.treeRevision);
    return reply.header('Cache-Control', 'private, no-store').send(result);
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
    const updated = await db.transaction(async (tx) => {
      const locked = await lockEcoAuditForMutation(tx, {
        auditId: id,
        user: request.user,
        request,
      });
      const found = locked.audit;
      const changes: Partial<typeof eaAudits.$inferInsert> = {
      };
      const sv = optionalString(body, 'siteName');
      if (sv !== undefined) changes.siteName = sv ?? found.siteName;
      const sa = optionalString(body, 'siteAddress');
      if (sa !== undefined) changes.siteAddress = sa ?? found.siteAddress;
      const iname = optionalString(body, 'inspectorName');
      if (iname !== undefined) changes.inspectorName = iname ?? found.inspectorName;
      if ('auditDate' in body) {
        changes.auditDate = typeof body.auditDate === 'string' ? body.auditDate : null;
      }
      const [baseUpdated] = await tx.update(eaAudits).set(changes)
        .where(eq(eaAudits.id, id)).returning();
      const remembered = await rememberEcoAuditClientSite(
        tx,
        body,
        assertFound(baseUpdated, 'Audit'),
      );
      const audit = await bumpEcoAuditTreeRevision(tx, locked);
      return {
        audit,
        lease: locked.lease,
        clientId: remembered.clientId,
        clientSiteId: remembered.clientSiteId,
      };
    });
    setEcoAuditRevisionHeader(reply, updated.audit.treeRevision);
    return reply.send({
      ...presentEcoAudit(updated.audit, updated.lease, {
        userId: request.user.userId,
        clientInstanceId: ecoAuditClientInstanceId(request),
      }),
      clientId: updated.clientId,
      clientSiteId: updated.clientSiteId,
    });
  });

  app.delete('/:id', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const purge = shouldPurgeQuery(request.query as Record<string, unknown> | undefined);
    if (purge) {
      const purged = await db.transaction(async (tx) => {
        const locked = await lockEcoAuditForMutation(tx, {
          auditId: id,
          user: request.user,
          request,
        });
        await tx.insert(eaAuditPurgeTombstones).values({
          auditId: locked.audit.id,
          purgedByUserId: request.user.userId,
          lastTreeRevision: locked.audit.treeRevision,
          lastEditFence: locked.audit.editFence,
          purgedAt: new Date(),
        });
        await purgeEcoauditAuditTreeRows(tx, id);
        return locked.audit;
      });
      await cleanupPurgedEcoauditAudit(id, purged.reportPdfLocalPath);
      return reply.status(204).send();
    }
    const deleted = await db.transaction(async (tx) => {
      const locked = await lockEcoAuditForMutation(tx, {
        auditId: id,
        user: request.user,
        request,
      });
      const deletedAudit = await bumpEcoAuditTreeRevision(tx, locked, {
        deletedAt: new Date(),
        // A delayed request must remain fenced even after the lease row is
        // removed. Legacy, never-claimed records retain their old semantics.
        ...(locked.lease ? { editFence: locked.audit.editFence + 1 } : {}),
      });
      if (locked.lease) {
        await tx.delete(eaAuditEditLeases).where(and(
          eq(eaAuditEditLeases.auditId, locked.audit.id),
          eq(eaAuditEditLeases.fence, locked.lease.fence),
        ));
      }
      return deletedAudit;
    });
    setEcoAuditRevisionHeader(reply, deleted.treeRevision);
    return reply.status(204).send();
  });

  app.patch('/:id/start', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await db.transaction(async (tx) => {
      const locked = await lockEcoAuditForMutation(tx, {
        auditId: id,
        user: request.user,
        request,
      });
      const audit = locked.audit.startedAt
        ? locked.audit
        : await bumpEcoAuditTreeRevision(tx, locked, { startedAt: new Date() });
      return { audit, lease: locked.lease };
    });
    setEcoAuditRevisionHeader(reply, result.audit.treeRevision);
    return reply.send(presentEcoAudit(result.audit, result.lease, {
      userId: request.user.userId,
      clientInstanceId: ecoAuditClientInstanceId(request),
    }));
  });

  app.patch('/:id/complete', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const writeContext = parseEcoAuditWriteContext(request, {
      requireIdempotencyKey: isEcoAuditProtocolV2(request),
    });
    const requestFingerprint = canonicalCommandFingerprint({
      operation: 'complete',
      body: request.body ?? {},
    });
    const result = await db.transaction(async (tx) => {
      const [audit] = await tx.select().from(eaAudits).where(and(
        eq(eaAudits.id, id),
        isNull(eaAudits.deletedAt),
      )).for('update');
      const found = assertFound(audit, 'Audit');
      assertAuditAccess(found, request.user);
      const lease = await loadEcoAuditLease(tx, id);
      if (writeContext) {
        const replay = await replayEcoAuditCommand(tx, {
          auditId: id,
          operation: 'complete',
          actorUserId: request.user.userId,
          clientInstanceId: writeContext.clientInstanceId,
          idempotencyKey: writeContext.idempotencyKey!,
          requestFingerprint,
        });
        if (replay) {
          const response = exactEcoAuditCompletionReplay(replay);
          return {
            audit: null,
            response,
            treeRevision: response.treeRevision,
          };
        }
      }
      const now = new Date();
      if (found.status === 'Completed') {
        if (writeContext) throw conflict('audit_already_completed');
        assertEcoAuditLegacyMutationAllowed(found, lease);
        await completeLinkedSchedulerEvents(tx, {
          sourceApp: 'ecoaudit',
          sourceType: 'audit',
          sourceId: id,
        }, {
          observedAt: now,
          completionProvenance: 'historical_replay',
        });
        return {
          audit: found,
          response: null,
          treeRevision: found.treeRevision,
        };
      }
      if (writeContext) {
        assertEcoAuditLeaseAuthority({
          audit: found,
          lease,
          user: request.user,
          context: writeContext,
        });
      } else {
        assertEcoAuditLegacyMutationAllowed(found, lease);
      }
      const timing = resolveCompletionTiming(found, now);
      const resultingFence = ecoAuditCompletionFence(found.editFence, Boolean(writeContext));
      const completed = await bumpEcoAuditTreeRevision(tx, {
        audit: found,
        lease,
        writeContext,
      }, {
        status: 'Completed',
        startedAt: found.startedAt ?? timing.startedAt,
        completedAt: found.completedAt ?? timing.completedAt,
        editFence: resultingFence,
      });
      await completeEcoAuditLease(tx, {
        audit: found,
        lease,
        actorUserId: request.user.userId,
        resultingFence,
      });
      const completedTree = assertFound(
        await loadEcoAuditTree(tx, id),
        'Audit',
      );
      const recordVersionNumber = await pinEcoAuditRecordVersion({
        executor: tx,
        tree: completedTree,
        userId: request.user.userId,
      });
      const [versioned] = await tx.update(eaAudits).set({
        recordVersionNumber,
      }).where(and(
        eq(eaAudits.id, id),
        eq(eaAudits.treeRevision, completed.treeRevision),
      )).returning();
      const finalAudit = assertFound(versioned, 'Audit');
      await completeLinkedSchedulerEvents(tx, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: id,
      }, {
        observedAt: now,
        completionProvenance: 'direct_transition',
      });
      if (writeContext) {
        const response: EcoAuditCompletionCommandResponse = {
          audit: presentEcoAudit(finalAudit, undefined, {
            userId: request.user.userId,
            clientInstanceId: writeContext.clientInstanceId,
          }) as unknown as Record<string, unknown>,
          treeRevision: finalAudit.treeRevision,
          editFence: finalAudit.editFence,
          recordVersionNumber,
          editLease: null,
          replayed: false,
        };
        await saveEcoAuditCommand(tx, {
          auditId: id,
          operation: 'complete',
          actorUserId: request.user.userId,
          clientInstanceId: writeContext.clientInstanceId,
          idempotencyKey: writeContext.idempotencyKey!,
          requestFingerprint,
          baseTreeRevision: writeContext.baseTreeRevision,
          resultingTreeRevision: finalAudit.treeRevision,
          recordVersionNumber,
          result: response,
        });
        return {
          audit: null,
          response,
          treeRevision: finalAudit.treeRevision,
        };
      }
      return {
        audit: finalAudit,
        response: null,
        treeRevision: finalAudit.treeRevision,
      };
    });
    setEcoAuditRevisionHeader(reply, result.treeRevision);
    if (!writeContext) return reply.send(result.audit);
    return reply.send(result.response);
  });

  app.patch('/:id/reopen', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (isEcoAuditProtocolV2(request)) {
      throw conflict('audit_completed_copy_required');
    }
    assertEcoAuditProtocolCompatibility(request);
    const preconditions = parseAuditReopenPreconditions(request.body);
    const updated = await db.transaction(async (tx) => {
      const [audit] = await tx.select().from(eaAudits).where(and(
        eq(eaAudits.id, id),
        isNull(eaAudits.deletedAt),
      )).for('update');
      const found = assertFound(audit, 'Audit');
      assertAuditAccess(found, request.user);
      const lease = await loadEcoAuditLease(tx, id);
      assertEcoAuditLegacyMutationAllowed(found, lease);
      assertAuditReopenVersion(found, preconditions);
      if (found.status === 'Draft') return found;
      if (found.status !== 'Completed') throw badRequest('Only completed audits can be reopened');
      if (!found.completedAt) throw conflict('completion_timestamp_missing');

      const now = nextAuditUpdatedAt(found.updatedAt);
      await completeLinkedSchedulerEvents(tx, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: id,
      }, {
        observedAt: now,
        completionProvenance: 'historical_replay',
      });
      return bumpEcoAuditTreeRevision(tx, {
        audit: found,
        lease: undefined,
        writeContext: null,
      }, resolveLegacyReopenMutation(found));
    });
    setEcoAuditRevisionHeader(reply, updated.treeRevision);
    return reply.send(updated);
  });

  app.post('/:id/copy', {
    schema: { tags: ['EcoAudit Audits'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as JsonRecord;
    assertEcoAuditProtocolCompatibility(request);
    const protocolV2 = isEcoAuditProtocolV2(request);
    const editClient = protocolV2 ? parseEcoAuditEditClient(body.editClient) : null;
    const idempotencyKey = protocolV2
      ? parseEcoAuditRecoveryKey(body.idempotencyKey)
      : '';
    const purpose = body.purpose === 'independent' ? 'independent' : 'amendment';
    const expectedTreeRevision = Number(body.expectedTreeRevision);
    if (protocolV2 && (
      !Number.isSafeInteger(expectedTreeRevision)
      || expectedTreeRevision < 0
    )) {
      throw badRequest('expectedTreeRevision must be a non-negative integer');
    }
    const includeChildren = body.includeChildren !== false;
    const targetId = protocolV2
      ? commandUuid('ecoaudit-copy', id, request.user.userId, editClient!.clientInstanceId, idempotencyKey)
      : randomUUID();
    const requestFingerprint = canonicalCommandFingerprint({
      operation: 'copy',
      sourceAuditId: id,
      purpose,
      includeChildren,
      expectedTreeRevision: protocolV2 ? expectedTreeRevision : undefined,
      body,
    });
    const created = await db.transaction(async (tx) => {
      if (protocolV2) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecoaudit:copy:${id}:${idempotencyKey}`}))`);
      }
      const [source] = await tx.select().from(eaAudits).where(and(
        eq(eaAudits.id, id),
        isNull(eaAudits.deletedAt),
      )).for('update');
      const found = assertFound(source, 'Audit');
      assertAuditAccess(found, request.user);
      const sourceLease = await loadEcoAuditLease(tx, id);
      if (protocolV2) {
        const replay = await replayEcoAuditCommand(tx, {
          auditId: id,
          operation: 'copy',
          actorUserId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
          idempotencyKey,
          requestFingerprint,
        });
        if (replay) {
          return {
            replay: true as const,
            targetAuditId: String(replay.targetAuditId ?? targetId),
            sourceRecordVersionNumber: Number(
              replay.sourceRecordVersionNumber ?? found.recordVersionNumber,
            ),
            treeRevision: Number(replay.treeRevision),
            editFence: Number(replay.editFence),
          };
        }
      }
      assertEcoAuditCopySourceEligible(found, sourceLease, {
        protocolV2,
        expectedTreeRevision,
      });

      let sourceRecordVersionNumber = found.recordVersionNumber;
      if (protocolV2 && sourceRecordVersionNumber < 1) {
        const sourceTree = assertFound(await loadEcoAuditTree(tx, id), 'Audit');
        sourceRecordVersionNumber = await pinEcoAuditRecordVersion({
          executor: tx,
          tree: sourceTree,
          userId: request.user.userId,
        });
        await tx.update(eaAudits).set({
          recordVersionNumber: sourceRecordVersionNumber,
        }).where(eq(eaAudits.id, id));
      }
      const overrides = ecoAuditCopyBodyOverrides(found, body);
      const cloned = cloneRecordForInsert(found, {
        ...overrides,
        siteName: copyNameWithSuffix(found.siteName),
        status: 'Draft',
        createdByUserId: request.user.userId,
        reportPdfLocalPath: null,
        reportPdfRemoteUrl: null,
        startedAt: null,
        completedAt: null,
      });
      const [copiedAudit] = await tx.insert(eaAudits).values({
        ...cloned,
        id: targetId,
        treeRevision: 1,
        recordVersionNumber: 0,
        editFence: protocolV2 ? 1 : 0,
        copiedFromAuditId: protocolV2 ? found.id : null,
        copiedFromRecordVersionNumber: protocolV2 ? sourceRecordVersionNumber : null,
        lineageRootAuditId: protocolV2 ? found.lineageRootAuditId ?? found.id : null,
        copyPurpose: protocolV2 ? purpose : null,
      } as typeof eaAudits.$inferInsert).returning();
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
      if (!protocolV2) {
        return {
          replay: false as const,
          audit: targetAudit,
          lease: undefined,
          leaseToken: undefined,
          sourceRecordVersionNumber,
        };
      }
      const lease = await createEcoAuditLeaseForNewAudit(tx, {
        auditId: targetAudit.id,
        actorUserId: request.user.userId,
        client: editClient!,
        fence: 1,
        leaseToken: ecoAuditCommandLeaseToken({
          auditId: targetAudit.id,
          operation: 'copy',
          actorUserId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
          idempotencyKey,
        }),
      });
      await saveEcoAuditCommand(tx, {
        auditId: id,
        operation: 'copy',
        actorUserId: request.user.userId,
        clientInstanceId: editClient!.clientInstanceId,
        idempotencyKey,
        requestFingerprint,
        baseTreeRevision: expectedTreeRevision,
        resultingTreeRevision: targetAudit.treeRevision,
        recordVersionNumber: sourceRecordVersionNumber,
        result: {
          sourceAuditId: id,
          targetAuditId: targetAudit.id,
          sourceRecordVersionNumber,
          treeRevision: targetAudit.treeRevision,
          editFence: targetAudit.editFence,
        },
      });
      return {
        replay: false as const,
        audit: targetAudit,
        ...lease,
        sourceRecordVersionNumber,
      };
    });
    if (!protocolV2) return reply.status(201).send(created.audit);
    if (created.replay) {
      const [target] = await db.select().from(eaAudits).where(and(
        eq(eaAudits.id, created.targetAuditId),
        isNull(eaAudits.deletedAt),
      ));
      const targetAudit = assertFound(target, 'Copied audit');
      const recovered = await recoverEcoAuditEditLeaseAfterCommandReplay({
        auditId: targetAudit.id,
        user: request.user,
        client: editClient!,
        operation: 'copy',
        idempotencyKey,
        expectedTreeRevision: created.treeRevision,
        expectedFence: created.editFence,
      });
      setEcoAuditRevisionHeader(reply, recovered.treeRevision);
      return reply.send({
        audit: presentEcoAudit(recovered.audit, recovered.lease, {
          userId: request.user.userId,
          clientInstanceId: editClient!.clientInstanceId,
        }),
        sourceAuditId: id,
        sourceRecordVersionNumber: created.sourceRecordVersionNumber,
        treeRevision: recovered.treeRevision,
        editFence: recovered.editFence,
        leaseToken: recovered.leaseToken,
        editLease: recovered.editLease,
        replayed: true,
      });
    }
    setEcoAuditRevisionHeader(reply, created.audit.treeRevision);
    return reply.status(201).send({
      audit: presentEcoAudit(created.audit, created.lease, {
        userId: request.user.userId,
        clientInstanceId: editClient!.clientInstanceId,
      }),
      sourceAuditId: id,
      sourceRecordVersionNumber: created.sourceRecordVersionNumber,
      treeRevision: created.audit.treeRevision,
      editFence: created.audit.editFence,
      leaseToken: created.leaseToken,
      editLease: presentEcoAuditLease(created.lease, {
        userId: request.user.userId,
        clientInstanceId: editClient!.clientInstanceId,
      }),
      replayed: false,
    });
  });
}
