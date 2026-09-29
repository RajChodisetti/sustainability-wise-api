import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import {
  eaAudits, eaZones, eaMainSwitchboards, eaAdditionalSwitchboards,
  eaHvacUnits, eaLightingSystems, eaSolarPv, eaForkliftChargers,
  eaHotWaterSystems, eaGeneralWater, eaGeneralElectricity, eaWaterAssets,
} from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess, dateOrNow, isElevated, requiredString, str, num, arr, type JsonRecord } from './helpers.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { deleteLocalFile, localFileExists, publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { saveRecordVersion } from '../recordVersions.js';
import { mirrorStoredPhotoToOneDrive } from '../../onedrive/photoBackup.js';
import { loadEcoEntityName, makePhotoStorageKeyFromNames } from '../../services/storageNaming.js';
import { resolveSyncedAuditTiming } from './auditTiming.js';
import { resolveSyncCreatedByUserId } from '../syncOwnership.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import {
  canonicalEcoAuditPhotoFieldName,
  canonicalizeLightingSystemPayload,
  ecoAuditPhotoFieldAliases,
  withLegacyLightingPhotoSyncAlias,
} from './lightingPhotoField.js';
import {
  createConfiguredUploadUrl,
  requireUploadCapability,
} from '../../auth/uploadCapability.js';
import { completeLinkedSchedulerEvents } from '../../services/schedulerCompletionService.js';
import { rememberEcoAuditClientSite } from './clientSiteMemory.js';
import { jsonArray, jsonObject, requiredWaterAssetType } from './waterAssetContract.js';
import {
  assertAuditSyncVersion,
  nextAuditUpdatedAt,
  parseExpectedAuditUpdatedAt,
} from './auditVersion.js';
import {
  assertEcoAuditLeaseAuthority,
  assertEcoAuditLegacyMutationAllowed,
  assertEcoAuditSyncTargetActive,
  bumpEcoAuditTreeRevision,
  canonicalCommandFingerprint,
  completeEcoAuditLease,
  isEcoAuditProtocolV2,
  loadEcoAuditLease,
  lockEcoAuditForMutation,
  parseEcoAuditWriteContext,
  replayEcoAuditCommand,
  saveEcoAuditCommand,
  setEcoAuditRevisionHeader,
} from './auditConcurrency.js';
import {
  loadEcoAuditTree,
  pinEcoAuditRecordVersion,
} from './auditTreeService.js';

function uploadUrl(sessionId: string): string {
  return createConfiguredUploadUrl(
    `${config.publicBaseUrl}/v1/ecoaudit/sync/upload/${sessionId}`,
    'ecoaudit',
    sessionId,
  );
}

function assertUploadSessionFresh(createdAt: Date): void {
  if (Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000) throw badRequest('Upload session has expired');
}

export function photoUploadIdentityKey(input: {
  auditId: string;
  entityId: string;
  fieldName: string;
  checksum: string;
}): string {
  return JSON.stringify(['ecoaudit', input.auditId, input.entityId, input.fieldName, input.checksum]);
}

export function resolveSyncedPhotoMetadata(
  incoming: { updatedAt: Date; photoDescs: JsonRecord },
  existing?: { updatedAt?: Date | null; photoDescs?: unknown },
): { updatedAt: Date; photoDescs: JsonRecord } {
  if (
    existing?.updatedAt
    && existing.updatedAt.getTime() > incoming.updatedAt.getTime()
  ) {
    return {
      updatedAt: existing.updatedAt,
      photoDescs:
        existing.photoDescs
        && typeof existing.photoDescs === 'object'
        && !Array.isArray(existing.photoDescs)
          ? existing.photoDescs as JsonRecord
          : {},
    };
  }
  return incoming;
}

async function deletePhotosForAudit(auditId: string): Promise<void> {
  await releaseCopyReferencesForParent('ecoaudit', auditId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'ecoaudit', parentId: auditId });
}

async function deletePhotosForEntity(entityId: string): Promise<void> {
  await releaseCopyReferencesForEntity('ecoaudit', entityId);
  await deleteOwnedPhotosUnlessReferenced({ app: 'ecoaudit', entityId });
}

export async function eaSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get('/capabilities', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.send({
      auditProtocolVersion: 2,
      idempotentAuditRegistration: true,
      ready: Boolean(config.ecoauditCommandHmacSecret),
    });
  });

  // POST /check-photo
  app.post('/check-photo', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const auditId = requiredString(body, 'auditId');
    const fieldName = canonicalEcoAuditPhotoFieldName(requiredString(body, 'fieldName'));
    const fieldNames = ecoAuditPhotoFieldAliases(fieldName);
    const entityId = typeof body.entityId === 'string' && body.entityId.trim() ? body.entityId.trim() : auditId;
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    const [existing] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, auditId),
      eq(photoRegistry.entityId, entityId),
      inArray(photoRegistry.fieldName, fieldNames),
      eq(photoRegistry.status, 'confirmed'),
    ));
    return reply.send({
      exists: Boolean(existing),
      remoteUrl: existing?.remoteUrl,
      fileSizeBytes: existing?.fileSizeBytes,
      photoId: existing?.id,
    });
  });

  // POST /create-upload-session
  app.post('/create-upload-session', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const auditId = requiredString(body, 'auditId');
    const fieldName = canonicalEcoAuditPhotoFieldName(requiredString(body, 'fieldName'));
    const fieldNames = ecoAuditPhotoFieldAliases(fieldName);
    const filename = requiredString(body, 'filename');
    const fileSizeBytes = Number(body.fileSizeBytes ?? 0);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) throw badRequest('fileSizeBytes must be a positive number');
    if (fileSizeBytes > config.storage.maxUploadBytes) throw badRequest(`File exceeds max upload size of ${config.storage.maxUploadBytes} bytes`);

    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);

    const entityId = typeof body.entityId === 'string' && body.entityId.trim() ? body.entityId.trim() : auditId;
    const entityType = typeof body.entityType === 'string' && body.entityType.trim() ? body.entityType.trim() : 'audit';

    const entityName = await loadEcoEntityName(audit, entityType, entityId);
    const session = await db.transaction(async (tx) => {
      const locked = await lockEcoAuditForMutation(tx, {
        auditId,
        user: request.user,
        request,
      });
      // The prior check-then-insert raced when two sync cycles started together.
      // A database advisory lock serializes this exact upload identity across all
      // API processes without preventing the same bytes being used in another field.
      const identity = photoUploadIdentityKey({ auditId, entityId, fieldName, checksum });
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity}))`);
      const matches = await tx.select().from(photoRegistry).where(and(
        eq(photoRegistry.app, 'ecoaudit'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.parentId, auditId),
        eq(photoRegistry.entityId, entityId),
        inArray(photoRegistry.fieldName, fieldNames),
      ));
      const confirmed = matches.find((candidate) => candidate.status === 'confirmed' && candidate.remoteUrl);
      if (confirmed?.remoteUrl) return {
        row: confirmed,
        alreadyExists: true,
        treeRevision: locked.audit.treeRevision,
      };
      const active = matches.find((candidate) =>
        (candidate.status === 'pending' || candidate.status === 'uploaded')
        && Date.now() - candidate.createdAt.getTime() <= 24 * 60 * 60 * 1000,
      );
      if (active) return {
        row: active,
        alreadyExists: false,
        treeRevision: locked.audit.treeRevision,
      };

      const sessionId = randomUUID();
      const storageKey = makePhotoStorageKeyFromNames({
        app: 'ecoaudit',
        parentName: audit.siteName,
        entityType,
        entityName,
        fieldName,
        sessionId,
        filename,
      });
      const [created] = await tx.insert(photoRegistry).values({
        id: sessionId, checksum, remoteUrl: null, onedriveItemId: null, storageKey,
        contentType: null, originalFilename: filename, app: 'ecoaudit', parentId: auditId,
        entityType, entityId, fieldName, fileSizeBytes, status: 'pending',
      }).returning();
      if (!created) throw new Error('Photo upload session was not created');
      return {
        row: created,
        alreadyExists: false,
        treeRevision: locked.audit.treeRevision,
      };
    });
    setEcoAuditRevisionHeader(reply, session.treeRevision);
    if (session.alreadyExists && session.row.remoteUrl) {
      return reply.send({
        sessionId: session.row.id,
        uploadUrl: null,
        alreadyExists: true,
        remoteUrl: session.row.remoteUrl,
        treeRevision: session.treeRevision,
      });
    }
    return reply.status(201).send({
      sessionId: session.row.id,
      uploadUrl: uploadUrl(session.row.id),
      alreadyExists: false,
      treeRevision: session.treeRevision,
    });
  });

  // PUT /upload/:sessionId — raw bytes, no auth
  app.put('/upload/:sessionId', {
    schema: { tags: ['EcoAudit Sync'] },
    onRequest: requireUploadCapability('ecoaudit'),
    bodyLimit: config.storage.maxUploadBytes,
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw badRequest('Upload body must be raw bytes');
    const [session] = await db.select().from(photoRegistry).where(and(eq(photoRegistry.id, sessionId), eq(photoRegistry.app, 'ecoaudit')));
    const found = assertFound(session, 'Upload session');
    if (found.status === 'uploaded' || found.status === 'confirmed') {
      return reply.send({ ok: true, checksum: found.checksum, fileSizeBytes: found.fileSizeBytes });
    }
    if (found.status !== 'pending') throw badRequest(`Upload session is ${found.status}`);
    assertUploadSessionFresh(found.createdAt);
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.fileSizeBytes && body.length !== found.fileSizeBytes) throw badRequest('Uploaded file size does not match session');

    const written = await writeLocalFile(found.storageKey, body);
    if (written.checksum !== found.checksum) {
      await deleteLocalFile(found.storageKey);
      await db.update(photoRegistry).set({ status: 'failed' }).where(eq(photoRegistry.id, sessionId));
      throw badRequest('Uploaded checksum does not match session');
    }
    const contentType = String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
    await db.update(photoRegistry).set({ status: 'uploaded', fileSizeBytes: written.size, contentType, uploadedAt: new Date() }).where(eq(photoRegistry.id, sessionId));
    return reply.send({ ok: true, checksum: written.checksum, fileSizeBytes: written.size });
  });

  // POST /confirm-upload
  app.post('/confirm-upload', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const sessionId = requiredString(body, 'sessionId');
    const checksum = requiredString(body, 'checksum');
    const [session] = await db.select().from(photoRegistry).where(and(eq(photoRegistry.id, sessionId), eq(photoRegistry.app, 'ecoaudit')));
    const found = assertFound(session, 'Upload session');
    if (found.checksum !== checksum) throw badRequest('Checksum does not match session');
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.status === 'confirmed' && found.remoteUrl) {
      const [audit] = await db.select()
        .from(eaAudits)
        .where(and(eq(eaAudits.id, found.parentId), isNull(eaAudits.deletedAt)));
      assertAuditAccess(assertFound(audit, 'Audit'), request.user);
      if (audit) setEcoAuditRevisionHeader(reply, audit.treeRevision);
      return reply.send({
        remoteUrl: found.remoteUrl,
        treeRevision: audit?.treeRevision,
      });
    }
    if (found.status !== 'uploaded') throw badRequest(`Upload session is ${found.status}`);
    if (!(await localFileExists(found.storageKey))) throw badRequest('Uploaded file is missing from configured storage');
    const remoteUrl = publicFileUrl(found.storageKey);
    const confirmed = await db.transaction(async (tx) => {
      const locked = await lockEcoAuditForMutation(tx, {
        auditId: found.parentId,
        user: request.user,
        request,
      });
      const [updated] = await tx.update(photoRegistry).set({
        status: 'confirmed',
        remoteUrl,
        uploadedAt: new Date(),
      }).where(and(
        eq(photoRegistry.id, sessionId),
        eq(photoRegistry.status, 'uploaded'),
      )).returning();
      return {
        photo: assertFound(updated, 'Upload session'),
        treeRevision: locked.audit.treeRevision,
      };
    });
    let oneDriveBackup: Awaited<ReturnType<typeof mirrorStoredPhotoToOneDrive>> = null;
    if (!found.onedriveItemId) {
      try {
        oneDriveBackup = await mirrorStoredPhotoToOneDrive({
          storageKey: found.storageKey,
          contentType: found.contentType,
          logger: request.log,
        });
        if (oneDriveBackup) {
          await db.update(photoRegistry).set({
            onedriveItemId: oneDriveBackup.itemId,
          }).where(and(
            eq(photoRegistry.id, sessionId),
            eq(photoRegistry.status, 'confirmed'),
          ));
        }
      } catch (error) {
        // The canonical local confirmation already committed. Backup is an
        // independent best-effort projection and must not make the client
        // retry a successful command against a now-stale authority baseline.
        request.log.warn({ error, sessionId }, 'EcoAudit OneDrive photo backup deferred');
        oneDriveBackup = null;
      }
    }
    setEcoAuditRevisionHeader(reply, confirmed.treeRevision);
    return reply.send({
      remoteUrl: confirmed.photo.remoteUrl,
      treeRevision: confirmed.treeRevision,
      oneDriveBackup: oneDriveBackup
        ? {
            itemId: oneDriveBackup.itemId,
            path: oneDriveBackup.drivePath,
            webUrl: oneDriveBackup.webUrl,
          }
        : undefined,
    });
  });

  // POST /push — push audit with all its data
  app.post('/push', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const rawBody = request.body as {
      audit?: JsonRecord;
      zones?: JsonRecord[];
      mainSwitchboards?: JsonRecord[];
      additionalSwitchboards?: JsonRecord[];
      hvacUnits?: JsonRecord[];
      lightingSystems?: JsonRecord[];
      solarPv?: JsonRecord[];
      forkliftChargers?: JsonRecord[];
      hotWaterSystems?: JsonRecord[];
      generalWater?: JsonRecord[];
      generalElectricity?: JsonRecord[];
      waterAssets?: JsonRecord[];
      expectedAuditUpdatedAt?: unknown;
      syncStage?: unknown;
    };
    const protocolV2 = isEcoAuditProtocolV2(request);
    const writeContext = parseEcoAuditWriteContext(request, {
      requireIdempotencyKey: protocolV2,
    });
    const syncStage = protocolV2
      ? rawBody.syncStage === 'draft' || rawBody.syncStage === 'complete'
        ? rawBody.syncStage
        : null
      : null;
    if (protocolV2 && !syncStage) {
      throw badRequest('syncStage must be draft or complete');
    }
    const expectedAuditUpdatedAt = parseExpectedAuditUpdatedAt(
      rawBody.expectedAuditUpdatedAt,
      !protocolV2 && Object.prototype.hasOwnProperty.call(rawBody, 'expectedAuditUpdatedAt'),
    );
    const {
      expectedAuditUpdatedAt: _expectedAuditUpdatedAt,
      syncStage: _syncStage,
      ...snapshotBody
    } = rawBody;
    const body = {
      ...snapshotBody,
      lightingSystems: rawBody.lightingSystems?.map(canonicalizeLightingSystemPayload),
    };

    if (!body.audit) throw badRequest('audit is required');
    const auditPayload = body.audit;

    const localAuditId = requiredString(auditPayload, 'id');
    const requestFingerprint = protocolV2 ? canonicalCommandFingerprint({
      operation: `sync:${syncStage}`,
      body,
    }) : '';
    const receivedAt = new Date();
    const mutation = await db.transaction(async (tx) => {
      const [existingAudit] = await tx.select().from(eaAudits)
        .where(eq(eaAudits.id, localAuditId))
        .for('update');
      if (existingAudit) {
        assertAuditAccess(existingAudit, request.user);
        assertEcoAuditSyncTargetActive(existingAudit, protocolV2);
      } else if (protocolV2) {
        // V2 callers create the server audit (and its first lease) through
        // POST /audits before pushing an aggregate snapshot.
        throw conflict('audit_edit_lease_required');
      }
      const activeLease = existingAudit
        ? await loadEcoAuditLease(tx, localAuditId)
        : undefined;
      if (protocolV2 && existingAudit && writeContext) {
        const replay = await replayEcoAuditCommand(tx, {
          auditId: localAuditId,
          operation: `sync:${syncStage}`,
          actorUserId: request.user.userId,
          clientInstanceId: writeContext.clientInstanceId,
          idempotencyKey: writeContext.idempotencyKey!,
          requestFingerprint,
        });
        if (replay) return { replayed: true as const, result: replay };
        if (existingAudit.status === 'Completed') {
          throw conflict('audit_completed_copy_required');
        }
        assertEcoAuditLeaseAuthority({
          audit: existingAudit,
          lease: activeLease,
          user: request.user,
          context: writeContext,
        });
      } else if (existingAudit) {
        assertEcoAuditLegacyMutationAllowed(existingAudit, activeLease);
      }
      assertAuditSyncVersion(existingAudit, expectedAuditUpdatedAt);
      const auditServerId = existingAudit?.serverId
        ?? (typeof auditPayload.serverId === 'string' && auditPayload.serverId.trim()
          ? auditPayload.serverId
          : randomUUID());
      const status = protocolV2
        ? syncStage === 'complete' ? 'Completed' : 'Draft'
        : str(auditPayload.status) ?? existingAudit?.status ?? 'Draft';
      const incomingUpdatedAt = auditPayload.updatedAt ? dateOrNow(auditPayload.updatedAt) : receivedAt;
      const updatedAt = existingAudit && (protocolV2 || expectedAuditUpdatedAt)
        ? nextAuditUpdatedAt(existingAudit.updatedAt, incomingUpdatedAt)
        : incomingUpdatedAt;
      const createdAt = auditPayload.createdAt
        ? dateOrNow(auditPayload.createdAt)
        : (existingAudit?.createdAt ?? receivedAt);
      const timing = resolveSyncedAuditTiming({
        status,
        incomingStartedAt: auditPayload.startedAt ? dateOrNow(auditPayload.startedAt) : null,
        incomingCompletedAt: auditPayload.completedAt ? dateOrNow(auditPayload.completedAt) : null,
        existingStatus: existingAudit?.status,
        existingStartedAt: existingAudit?.startedAt,
        existingCompletedAt: existingAudit?.completedAt,
        createdAt,
        observedAt: receivedAt,
      });
      const values = {
        id: localAuditId, serverId: auditServerId, syncStatus: 'synced',
        updatedAt,
        deletedAt: protocolV2
          ? null
          : auditPayload.deletedAt ? dateOrNow(auditPayload.deletedAt) : null,
        siteName: requiredString(auditPayload, 'siteName'),
        siteAddress: requiredString(auditPayload, 'siteAddress'),
        inspectorName: requiredString(auditPayload, 'inspectorName'),
        auditDate: typeof auditPayload.auditDate === 'string' ? auditPayload.auditDate : null,
        status,
        createdByUserId: resolveSyncCreatedByUserId({
          existingRecord: Boolean(existingAudit),
          existingCreatedByUserId: existingAudit?.createdByUserId,
          incomingCreatedByUserId: auditPayload.createdByUserId,
          actor: request.user,
        }),
        // Preserve the locked server-side Scheduler assignment. A stale mobile
        // copy must not undo a concurrent reassign or cancellation.
        assignedInspectorUserId: existingAudit?.assignedInspectorUserId ?? null,
        treeRevision: (existingAudit?.treeRevision ?? 0) + 1,
        recordVersionNumber: existingAudit?.recordVersionNumber ?? 0,
        editFence: existingAudit?.editFence ?? 0,
        ...timing,
        createdAt,
      };
      const { id: _aid, treeRevision: _treeRevision, ...auditUpdateValues } = values;
      let upsertedAudit: typeof eaAudits.$inferSelect | undefined;
      if (protocolV2 && existingAudit && writeContext) {
        upsertedAudit = await bumpEcoAuditTreeRevision(tx, {
          audit: existingAudit,
          lease: activeLease,
          writeContext,
        }, {
          ...auditUpdateValues,
          ...(syncStage === 'complete'
            ? { editFence: existingAudit.editFence + 1 }
            : {}),
        });
      } else {
        const excludedStatus = sql.raw(`excluded.${eaAudits.status.name}`);
        const excludedCompletedAt = sql.raw(`excluded.${eaAudits.completedAt.name}`);
        [upsertedAudit] = await tx
          .insert(eaAudits)
          .values(values as any)
          .onConflictDoUpdate({
            target: eaAudits.id,
            set: {
              ...auditUpdateValues,
              treeRevision: values.treeRevision,
              completedAt: sql<Date | null>`case
                when ${eaAudits.status} = 'Completed'
                  then coalesce(${eaAudits.completedAt}, ${excludedCompletedAt})
                when ${excludedStatus} = 'Completed' then ${excludedCompletedAt}
                else null
              end`,
            } as any,
            setWhere: sql`${eaAudits.status} <> 'Completed' OR ${excludedStatus} = 'Completed'`,
          })
          .returning();
      }
      if (!upsertedAudit) {
        throw conflict('audit_completed_reopen_requires_explicit_transition');
      }
      const remembered = await rememberEcoAuditClientSite(tx, auditPayload, upsertedAudit);
      if (values.status === 'Completed') {
        await completeLinkedSchedulerEvents(tx, {
          sourceApp: 'ecoaudit',
          sourceType: 'audit',
          sourceId: localAuditId,
        }, {
          observedAt: receivedAt,
          completionProvenance: !existingAudit || existingAudit.status !== 'Completed'
            ? 'offline_transition'
            : 'historical_replay',
        });
      }
      const auditValues = {
        serverId: remembered.audit.serverId ?? auditServerId,
        deletedAt: remembered.audit.deletedAt,
        clientId: remembered.clientId,
        clientSiteId: remembered.clientSiteId,
        clientName: remembered.audit.clientName,
        updatedAt: remembered.audit.updatedAt,
      };
      if (auditValues.deletedAt) {
        const legacyVersionNumber = !protocolV2
          ? await saveRecordVersion({
              app: 'ecoaudit',
              entityType: 'audit',
              entityId: localAuditId,
              snapshot: body,
              userId: request.user.userId,
              executor: tx,
            })
          : undefined;
        return {
          replayed: false as const,
          auditValues,
          deletedEntityIds: [] as string[],
          legacyVersionNumber,
        };
      }

      const deletedEntityIds: string[] = [];

      // Keep the parent row lock until every tree row is written. This makes
      // the reopen-token check and the full-tree replacement one transaction.
      const photoDescs = (item: JsonRecord): JsonRecord =>
        item.photoDescs && typeof item.photoDescs === 'object' && !Array.isArray(item.photoDescs)
          ? item.photoDescs as JsonRecord
          : {};

    for (const zone of (body.zones ?? [])) {
      const zoneId = requiredString(zone, 'id');
      const [existing] = await tx.select().from(eaZones).where(eq(eaZones.id, zoneId));
      if (existing && existing.auditId !== localAuditId) {
        throw conflict('audit_child_scope_conflict');
      }
      const serverId = existing?.serverId ?? (str(zone.serverId) ?? randomUUID());
      const resolvedPhotoMetadata = resolveSyncedPhotoMetadata({
        updatedAt: dateOrNow(zone.updatedAt),
        photoDescs: photoDescs(zone),
      }, existing);
      const vals = {
        id: zoneId, serverId, syncStatus: 'synced', updatedAt: resolvedPhotoMetadata.updatedAt,
        deletedAt: zone.deletedAt ? dateOrNow(zone.deletedAt) : null,
        auditId: localAuditId, zoneName: requiredString(zone, 'zoneName'),
        zoneDescription: str(zone.zoneDescription),
        photos: arr(zone.photos), photoDescs: resolvedPhotoMetadata.photoDescs, createdAt: dateOrNow(zone.createdAt),
      };
      const { id: _zid, ...zoneUpdate } = vals;
      await tx.insert(eaZones).values(vals as any).onConflictDoUpdate({ target: eaZones.id, set: zoneUpdate as any });
      if (vals.deletedAt) {
        deletedEntityIds.push(zoneId);
      }
    }

    const scopedZones = await tx.select({ id: eaZones.id }).from(eaZones).where(and(
      eq(eaZones.auditId, localAuditId),
      isNull(eaZones.deletedAt),
    ));
    const scopedZoneIds = new Set(scopedZones.map((zone) => zone.id));

    // Generic equipment upsert helper
    async function upsertEquipment<T extends { id: string }>(
      table: any,
      items: JsonRecord[],
      buildValues: (item: JsonRecord, existing: T | undefined) => Record<string, unknown>,
    ) {
      for (const item of items) {
        const itemId = requiredString(item, 'id');
        const [existing] = await tx.select().from(table).where(eq(table.id, itemId));
        if (existing && existing.auditId !== localAuditId) {
          throw conflict('audit_child_scope_conflict');
        }
        const vals = buildValues(item, existing);
        if (!scopedZoneIds.has(String(vals.zoneId ?? ''))) {
          throw conflict('audit_child_scope_conflict');
        }
        const { id: _id, ...updateVals } = vals;
        await tx.insert(table).values(vals as any).onConflictDoUpdate({ target: table.id, set: updateVals as any });
        if (vals.deletedAt) {
          deletedEntityIds.push(itemId);
        }
      }
    }

    const baseCols = (item: JsonRecord, existing: any, extra: Record<string, unknown>) => {
      const resolvedPhotoMetadata = resolveSyncedPhotoMetadata({
        updatedAt: dateOrNow(item.updatedAt),
        photoDescs: photoDescs(item),
      }, existing);
      return {
        id: requiredString(item, 'id'),
        serverId: existing?.serverId ?? (str(item.serverId) ?? randomUUID()),
        syncStatus: 'synced', updatedAt: resolvedPhotoMetadata.updatedAt,
        deletedAt: item.deletedAt ? dateOrNow(item.deletedAt) : null,
        zoneId: requiredString(item, 'zoneId'), auditId: localAuditId,
        createdAt: dateOrNow(item.createdAt),
        extraNotes: str(item.extraNotes), extraPhotos: arr(item.extraPhotos),
        photoDescs: resolvedPhotoMetadata.photoDescs,
        ...extra,
      };
    };

    await upsertEquipment(eaMainSwitchboards, body.mainSwitchboards ?? [], (item, ex) => baseCols(item, ex, {
      name: requiredString(item, 'name'), location: str(item.location), mapLocator: str(item.mapLocator),
      siteNmi: str(item.siteNmi), photo: str(item.photo), subCircuitsDescription: str(item.subCircuitsDescription), comments: str(item.comments),
    }));

    await upsertEquipment(eaAdditionalSwitchboards, body.additionalSwitchboards ?? [], (item, ex) => baseCols(item, ex, {
      name: requiredString(item, 'name'), location: str(item.location), mapLocator: str(item.mapLocator),
      type: str(item.type), photo: str(item.photo), subCircuitsDescription: str(item.subCircuitsDescription), comments: str(item.comments),
    }));

    await upsertEquipment(eaHvacUnits, body.hvacUnits ?? [], (item, ex) => baseCols(item, ex, {
      unitName: requiredString(item, 'unitName'), make: str(item.make), photo: str(item.photo), location: str(item.location), type: str(item.type),
      model: str(item.model), serialNumber: str(item.serialNumber), heatingCapacityKw: num(item.heatingCapacityKw), coolingCapacityKw: num(item.coolingCapacityKw),
      powerSupplyPhase: str(item.powerSupplyPhase), nameplatePhotos: str(item.nameplatePhotos), indoorUnitModel: str(item.indoorUnitModel),
      indoorUnitSerial: str(item.indoorUnitSerial), indoorUnitNameplatePhoto: str(item.indoorUnitNameplatePhoto),
      controllerType: str(item.controllerType), controllerModel: str(item.controllerModel), controllerPhoto: str(item.controllerPhoto),
      temperatureSensorType: str(item.temperatureSensorType), systemCoverage: str(item.systemCoverage), energyImprovementObservations: str(item.energyImprovementObservations),
    }));

    await upsertEquipment(eaLightingSystems, body.lightingSystems ?? [], (item, ex) => baseCols(item, ex, {
      lightType: requiredString(item, 'lightType'), brandModel: str(item.brandModel), photo: str(item.photo),
      ratedWattage: num(item.ratedWattage), quantity: typeof item.quantity === 'number' ? Math.round(item.quantity) : null,
      fixturesInstalled: str(item.fixturesInstalled), fixturesPhoto: str(item.fixturesPhoto), areaLocation: str(item.areaLocation),
      controlsType: str(item.controlsType), operatingHours: str(item.operatingHours), mountingHeight: str(item.mountingHeight),
      mountingConstraintsPhoto: str(item.mountingConstraintsPhoto), circuitGrouping: str(item.circuitGrouping),
      sensorsPhoto: str(item.sensorsPhoto), accessLimitations: str(item.accessLimitations),
      switchboardControlsPhoto: str(item.switchboardControlsPhoto), energyImprovementObservations: str(item.energyImprovementObservations),
    }));

    await upsertEquipment(eaSolarPv, body.solarPv ?? [], (item, ex) => baseCols(item, ex, {
      systemSizeKw: num(item.systemSizeKw), roofPhoto: str(item.roofPhoto), inverterBrandModel: str(item.inverterBrandModel),
      inverterLocation: str(item.inverterLocation), inverterLabelPhoto: str(item.inverterLabelPhoto),
      powerSupplyToPv: str(item.powerSupplyToPv), electricityMeterPhoto: str(item.electricityMeterPhoto),
      availableRoofSpace: str(item.availableRoofSpace), roofSpaceAmount: str(item.roofSpaceAmount),
      additionalSolarSpacePhoto: str(item.additionalSolarSpacePhoto), suitableSwitchboard: str(item.suitableSwitchboard),
      switchboardPhoto: str(item.switchboardPhoto), switchboardLocation: str(item.switchboardLocation),
      cableDistance: str(item.cableDistance), cableRouteDescription: str(item.cableRouteDescription), energyImprovementObservations: str(item.energyImprovementObservations),
    }));

    await upsertEquipment(eaForkliftChargers, body.forkliftChargers ?? [], (item, ex) => baseCols(item, ex, {
      chargerType: requiredString(item, 'chargerType'), chargerPhoto: str(item.chargerPhoto), brandModel: str(item.brandModel), rating: str(item.rating),
      chargerLabelPhoto: str(item.chargerLabelPhoto), powerSupply: str(item.powerSupply), electricConnectionPhoto: str(item.electricConnectionPhoto),
      location: str(item.location), quantity: typeof item.quantity === 'number' ? Math.round(item.quantity) : null,
      chargerSpacePhoto: str(item.chargerSpacePhoto), connectionDescription: str(item.connectionDescription),
      socketConnectionPhoto: str(item.socketConnectionPhoto), localIsolator: str(item.localIsolator),
      circuitIdentifiable: str(item.circuitIdentifiable), distanceToSwitchboard: str(item.distanceToSwitchboard),
      spaceForAdditional: str(item.spaceForAdditional), hardwiredSocket: str(item.hardwiredSocket),
      schedulingOpportunity: str(item.schedulingOpportunity), energyImprovementObservations: str(item.energyImprovementObservations),
    }));

    await upsertEquipment(eaHotWaterSystems, body.hotWaterSystems ?? [], (item, ex) => baseCols(item, ex, {
      dhwDetailsType: requiredString(item, 'dhwDetailsType'), photo: str(item.photo), serialNumber: str(item.serialNumber),
      sizeLiters: num(item.sizeLiters), fuelType: str(item.fuelType), location: str(item.location),
      pipeInsulation: str(item.pipeInsulation), pipeInsulationThickness: str(item.pipeInsulationThickness),
      temperingValve: str(item.temperingValve), additionalPhoto: str(item.additionalPhoto),
      moreDhwSystems: str(item.moreDhwSystems), additionalComments: str(item.additionalComments), energyImprovementObservations: str(item.energyImprovementObservations),
    }));

    await upsertEquipment(eaGeneralWater, body.generalWater ?? [], (item, ex) => baseCols(item, ex, {
      question: str(item.question), answer: str(item.answer), photos: arr(item.photos),
    }));

    await upsertEquipment(eaGeneralElectricity, body.generalElectricity ?? [], (item, ex) => baseCols(item, ex, {
      question: str(item.question), answer: str(item.answer), photos: arr(item.photos),
    }));

    await upsertEquipment(eaWaterAssets, body.waterAssets ?? [], (item, ex) => {
      const existing = ex as typeof eaWaterAssets.$inferSelect | undefined;
      const resolvedPhotoMetadata = resolveSyncedPhotoMetadata({
        updatedAt: dateOrNow(item.updatedAt),
        photoDescs: photoDescs(item),
      }, existing);
      return {
        id: requiredString(item, 'id'),
        serverId: existing?.serverId ?? (str(item.serverId) ?? randomUUID()),
        syncStatus: 'synced',
        updatedAt: resolvedPhotoMetadata.updatedAt,
        deletedAt: item.deletedAt ? dateOrNow(item.deletedAt) : null,
        zoneId: requiredString(item, 'zoneId'),
        auditId: localAuditId,
        assetType: requiredWaterAssetType(item.assetType),
        name: requiredString(item, 'name'),
        category: str(item.category),
        data: jsonObject(item.data),
        generalComments: str(item.generalComments),
        customFields: jsonArray(item.customFields),
        photos: arr(item.photos),
        photoDescs: resolvedPhotoMetadata.photoDescs,
        createdAt: dateOrNow(item.createdAt),
      };
    });

      await reconcilePhotoCopyReferencesForParent({
        app: 'ecoaudit',
        parentId: localAuditId,
        executor: tx as unknown as typeof db,
        actor: request.user,
      });

      if (!protocolV2 || !writeContext || !existingAudit) {
        const legacyVersionNumber = !protocolV2
          ? await saveRecordVersion({
              app: 'ecoaudit',
              entityType: 'audit',
              entityId: localAuditId,
              snapshot: body,
              userId: request.user.userId,
              executor: tx,
            })
          : undefined;
        return {
          replayed: false as const,
          auditValues,
          deletedEntityIds,
          legacyVersionNumber,
        };
      }

      let finalAudit = remembered.audit;
      let recordVersionNumber = finalAudit.recordVersionNumber;
      if (syncStage === 'complete') {
        await completeEcoAuditLease(tx, {
          audit: existingAudit,
          lease: activeLease,
          actorUserId: request.user.userId,
          resultingFence: finalAudit.editFence,
        });
        const completedTree = assertFound(
          await loadEcoAuditTree(tx, localAuditId),
          'Audit',
        );
        recordVersionNumber = await pinEcoAuditRecordVersion({
          executor: tx,
          tree: completedTree,
          userId: request.user.userId,
        });
        const [versioned] = await tx.update(eaAudits).set({
          recordVersionNumber,
        }).where(and(
          eq(eaAudits.id, localAuditId),
          eq(eaAudits.treeRevision, finalAudit.treeRevision),
        )).returning();
        finalAudit = assertFound(versioned, 'Audit');
      }
      const result = {
        auditId: localAuditId,
        serverId: auditValues.serverId,
        clientId: auditValues.clientId,
        clientSiteId: auditValues.clientSiteId,
        clientName: auditValues.clientName,
        updatedAt: finalAudit.updatedAt,
        treeRevision: finalAudit.treeRevision,
        editFence: finalAudit.editFence,
        recordVersionNumber,
        status: finalAudit.status,
        editLease: syncStage === 'complete' ? null : undefined,
      };
      await saveEcoAuditCommand(tx, {
        auditId: localAuditId,
        operation: `sync:${syncStage}`,
        actorUserId: request.user.userId,
        clientInstanceId: writeContext.clientInstanceId,
        idempotencyKey: writeContext.idempotencyKey!,
        requestFingerprint,
        baseTreeRevision: writeContext.baseTreeRevision,
        resultingTreeRevision: finalAudit.treeRevision,
        recordVersionNumber,
        result,
      });
      return {
        replayed: false as const,
        auditValues,
        deletedEntityIds,
        protocolResult: result,
      };
    });

    if (mutation.replayed) {
      const revision = Number(mutation.result.treeRevision ?? 0);
      setEcoAuditRevisionHeader(reply, revision);
      return reply.send({ ...mutation.result, replayed: true });
    }
    const { auditValues, deletedEntityIds } = mutation;
    if (auditValues.deletedAt) {
      await deletePhotosForAudit(localAuditId).catch((error) => {
        request.log.warn({ error, auditId: localAuditId }, 'EcoAudit photo cleanup deferred');
      });
    } else {
      for (const entityId of deletedEntityIds) {
        await deletePhotosForEntity(entityId).catch((error) => {
          request.log.warn({ error, auditId: localAuditId, entityId }, 'EcoAudit photo cleanup deferred');
        });
      }
    }

    if (protocolV2 && mutation.protocolResult) {
      setEcoAuditRevisionHeader(reply, mutation.protocolResult.treeRevision);
      return reply.send({ ...mutation.protocolResult, replayed: false });
    }

    return reply.send({
      auditId: localAuditId,
      serverId: auditValues.serverId,
      clientId: auditValues.clientId,
      clientSiteId: auditValues.clientSiteId,
      clientName: auditValues.clientName,
      updatedAt: auditValues.updatedAt,
      versionNumber: mutation.legacyVersionNumber,
    });
  });

  // GET /pull
  app.get('/pull', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const query = request.query as { since?: string; auditId?: string };
    const since = query.since ? new Date(query.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw badRequest('since must be an ISO date');

    const conds = [gt(eaAudits.updatedAt, since), isNull(eaAudits.deletedAt)];
    if (!isElevated(request.user)) {
      conds.push(or(
        eq(eaAudits.createdByUserId, request.user.userId),
        eq(eaAudits.assignedInspectorUserId, request.user.userId),
      ) as any);
    }
    if (query.auditId) conds.push(eq(eaAudits.id, query.auditId) as any);

    const audits = await db.select().from(eaAudits).where(and(...(conds as any)));
    const auditIds = audits.map((audit) => audit.id);
    const byAudit = auditIds.length
      ? {
          zones: await db.select().from(eaZones).where(and(inArray(eaZones.auditId, auditIds), isNull(eaZones.deletedAt))),
          mainSwitchboards: await db.select().from(eaMainSwitchboards).where(and(inArray(eaMainSwitchboards.auditId, auditIds), isNull(eaMainSwitchboards.deletedAt))),
          additionalSwitchboards: await db.select().from(eaAdditionalSwitchboards).where(and(inArray(eaAdditionalSwitchboards.auditId, auditIds), isNull(eaAdditionalSwitchboards.deletedAt))),
          hvacUnits: await db.select().from(eaHvacUnits).where(and(inArray(eaHvacUnits.auditId, auditIds), isNull(eaHvacUnits.deletedAt))),
          lightingSystems: await db.select().from(eaLightingSystems).where(and(inArray(eaLightingSystems.auditId, auditIds), isNull(eaLightingSystems.deletedAt))),
          solarPv: await db.select().from(eaSolarPv).where(and(inArray(eaSolarPv.auditId, auditIds), isNull(eaSolarPv.deletedAt))),
          forkliftChargers: await db.select().from(eaForkliftChargers).where(and(inArray(eaForkliftChargers.auditId, auditIds), isNull(eaForkliftChargers.deletedAt))),
          hotWaterSystems: await db.select().from(eaHotWaterSystems).where(and(inArray(eaHotWaterSystems.auditId, auditIds), isNull(eaHotWaterSystems.deletedAt))),
          generalWater: await db.select().from(eaGeneralWater).where(and(inArray(eaGeneralWater.auditId, auditIds), isNull(eaGeneralWater.deletedAt))),
          generalElectricity: await db.select().from(eaGeneralElectricity).where(and(inArray(eaGeneralElectricity.auditId, auditIds), isNull(eaGeneralElectricity.deletedAt))),
          waterAssets: await db.select().from(eaWaterAssets).where(and(inArray(eaWaterAssets.auditId, auditIds), isNull(eaWaterAssets.deletedAt))),
        }
      : {
          zones: [],
          mainSwitchboards: [],
          additionalSwitchboards: [],
          hvacUnits: [],
          lightingSystems: [],
          solarPv: [],
          forkliftChargers: [],
          hotWaterSystems: [],
          generalWater: [],
          generalElectricity: [],
          waterAssets: [],
        };
    return reply.send({
      audits,
      ...byAudit,
      // Old installed app versions import the legacy property into their
      // existing SQLite column. The canonical property remains authoritative.
      lightingSystems: byAudit.lightingSystems.map(withLegacyLightingPhotoSyncAlias),
      pulledAt: new Date().toISOString(),
    });
  });
}
