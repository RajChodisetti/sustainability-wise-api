import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, notInArray, or } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  ihElectricalAssets,
  ihFormSubmissions,
  ihInstallations,
  ihSiteAssets,
  ihZones,
} from '../../db/schema/installhub.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { mirrorStoredPhotoToOneDrive } from '../../onedrive/photoBackup.js';
import { saveRecordVersion } from '../recordVersions.js';
import { resolveSyncCreatedByUserId } from '../syncOwnership.js';
import { makePhotoStorageKeyFromNames } from '../../services/storageNaming.js';
import {
  deleteLocalFile,
  localFileExists,
  publicFileUrl,
  writeLocalFile,
} from '../../storage/localFiles.js';
import { badRequest, forbidden } from '../../utils/errors.js';
import {
  assertFound,
  assertInstallationAccess,
  dateOrNow,
  isElevated,
  jsonArray,
  jsonObject,
  optionalDate,
  optionalString,
  requiredString,
  type JsonRecord,
} from './helpers.js';
import { validateInstallHubFormContract } from './formContract.js';
import { reconcilePhotoCopyReferencesForParent } from '../../storage/photoCopyReferences.js';
import {
  createConfiguredUploadUrl,
  requireUploadCapability,
} from '../../auth/uploadCapability.js';

type PushBody = {
  syncStage?: 'metadata' | 'complete';
  installation?: JsonRecord;
  zones?: JsonRecord[];
  electricalAssets?: JsonRecord[];
  siteAssets?: JsonRecord[];
  formSubmissions?: JsonRecord[];
};

export function parseInstallHubSyncStage(
  value: unknown,
): PushBody['syncStage'] {
  if (value === undefined) return undefined;
  if (value === 'metadata' || value === 'complete') return value;
  throw badRequest('syncStage must be metadata or complete');
}

export function installHubSyncCreatesRecordVersion(
  syncStage: PushBody['syncStage'],
): boolean {
  return syncStage !== 'metadata';
}

function uploadUrl(sessionId: string): string {
  return createConfiguredUploadUrl(
    `${config.publicBaseUrl}/v1/installhub/sync/upload/${sessionId}`,
    'installhub',
    sessionId,
  );
}

function assertUploadSessionFresh(createdAt: Date): void {
  if (Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000) {
    throw badRequest('Upload session has expired');
  }
}

function requireParentId(item: JsonRecord, installationId: string): void {
  const parentId = requiredString(item, 'installationId');
  if (parentId !== installationId) throw badRequest('Child installationId does not match installation');
}

export function installationValuesFromPayload(
  payload: JsonRecord,
  actor: { userId: string; role: string },
  existing?: typeof ihInstallations.$inferSelect,
) {
  const id = requiredString(payload, 'id');
  return {
    id,
    serverId: existing?.serverId ?? optionalString(payload, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(payload.updatedAt),
    deletedAt: optionalDate(payload.deletedAt),
    clientName: requiredString(payload, 'clientName'),
    siteName: requiredString(payload, 'siteName'),
    siteAddress: requiredString(payload, 'siteAddress'),
    inspectorName: requiredString(payload, 'inspectorName'),
    auditDate: requiredString(payload, 'auditDate'),
    status: optionalString(payload, 'status') ?? existing?.status ?? 'Draft',
    createdByUserId: resolveSyncCreatedByUserId({
      existingRecord: Boolean(existing),
      existingCreatedByUserId: existing?.createdByUserId,
      incomingCreatedByUserId: payload.createdByUserId,
      actor,
    }),
    assignedInspectorUserId: existing?.assignedInspectorUserId ?? null,
    createdAt: payload.createdAt ? dateOrNow(payload.createdAt) : (existing?.createdAt ?? new Date()),
  };
}

async function loadAccessibleInstallation(
  installationId: string,
  request: { user: Parameters<typeof assertInstallationAccess>[1] },
) {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(and(eq(ihInstallations.id, installationId), isNull(ihInstallations.deletedAt)));
  const found = assertFound(installation, 'Installation');
  assertInstallationAccess(found, request.user);
  return found;
}

async function loadUploadEntity(
  installationId: string,
  entityType: string,
  entityId: string,
): Promise<{ name: string }> {
  if (entityType === 'installation' && entityId === installationId) {
    const [row] = await db.select().from(ihInstallations).where(eq(ihInstallations.id, installationId));
    return { name: assertFound(row, 'Installation').siteName };
  }
  if (entityType === 'zone') {
    const [row] = await db.select().from(ihZones).where(and(
      eq(ihZones.id, entityId),
      eq(ihZones.installationId, installationId),
      isNull(ihZones.deletedAt),
    ));
    return { name: assertFound(row, 'Zone').zoneName };
  }
  if (entityType === 'electrical_asset') {
    const [row] = await db.select().from(ihElectricalAssets).where(and(
      eq(ihElectricalAssets.id, entityId),
      eq(ihElectricalAssets.installationId, installationId),
      isNull(ihElectricalAssets.deletedAt),
    ));
    return { name: assertFound(row, 'Electrical asset').assetName };
  }
  if (entityType === 'site_asset') {
    const [row] = await db.select().from(ihSiteAssets).where(and(
      eq(ihSiteAssets.id, entityId),
      eq(ihSiteAssets.installationId, installationId),
      isNull(ihSiteAssets.deletedAt),
    ));
    return { name: assertFound(row, 'Site asset').assetName };
  }
  if (entityType === 'form_submission') {
    const [row] = await db.select().from(ihFormSubmissions).where(and(
      eq(ihFormSubmissions.id, entityId),
      eq(ihFormSubmissions.installationId, installationId),
      isNull(ihFormSubmissions.deletedAt),
    ));
    const form = assertFound(row, 'Form submission');
    return { name: `${form.formType}-${form.id}` };
  }
  throw badRequest('Unsupported upload entityType');
}

function zoneValues(item: JsonRecord, installationId: string, existing?: typeof ihZones.$inferSelect) {
  requireParentId(item, installationId);
  return {
    id: requiredString(item, 'id'),
    serverId: existing?.serverId ?? optionalString(item, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(item.updatedAt),
    deletedAt: optionalDate(item.deletedAt),
    installationId,
    zoneName: requiredString(item, 'zoneName'),
    zoneDescription: optionalString(item, 'zoneDescription') ?? '',
    photos: jsonArray<string>(item.photos),
    createdAt: item.createdAt ? dateOrNow(item.createdAt) : (existing?.createdAt ?? new Date()),
  };
}

function electricalAssetValues(
  item: JsonRecord,
  installationId: string,
  existing?: typeof ihElectricalAssets.$inferSelect,
) {
  requireParentId(item, installationId);
  return {
    id: requiredString(item, 'id'),
    serverId: existing?.serverId ?? optionalString(item, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(item.updatedAt),
    deletedAt: optionalDate(item.deletedAt),
    installationId,
    zoneId: requiredString(item, 'zoneId'),
    assetName: requiredString(item, 'assetName'),
    displayCode: requiredString(item, 'displayCode'),
    assetType: requiredString(item, 'assetType'),
    electricalParentId: optionalString(item, 'electricalParentId'),
    electricalParentTbc: Boolean(item.electricalParentTbc),
    locationDescription: optionalString(item, 'locationDescription'),
    phase: optionalString(item, 'phase'),
    amperageRating: optionalString(item, 'amperageRating'),
    siteNmi: optionalString(item, 'siteNmi'),
    photo: optionalString(item, 'photo'),
    extraPhotos: jsonArray<string>(item.extraPhotos),
    meterPresent: Boolean(item.meterPresent),
    meters: jsonArray(item.meters),
    subCircuitsDescription: optionalString(item, 'subCircuitsDescription'),
    comments: optionalString(item, 'comments'),
    createdAt: item.createdAt ? dateOrNow(item.createdAt) : (existing?.createdAt ?? new Date()),
  };
}

function siteAssetValues(
  item: JsonRecord,
  installationId: string,
  existing?: typeof ihSiteAssets.$inferSelect,
) {
  requireParentId(item, installationId);
  return {
    id: requiredString(item, 'id'),
    serverId: existing?.serverId ?? optionalString(item, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(item.updatedAt),
    deletedAt: optionalDate(item.deletedAt),
    installationId,
    zoneId: requiredString(item, 'zoneId'),
    assetName: requiredString(item, 'assetName'),
    assetType: requiredString(item, 'assetType'),
    electricalBoardId: optionalString(item, 'electricalBoardId'),
    electricalBoardTbc: Boolean(item.electricalBoardTbc),
    locationDescription: optionalString(item, 'locationDescription'),
    locationPhoto: optionalString(item, 'locationPhoto'),
    displayCode: optionalString(item, 'displayCode'),
    meterPresent: Boolean(item.meterPresent),
    meterSwitchboardId: optionalString(item, 'meterSwitchboardId'),
    meterSwitchboardTbc: Boolean(item.meterSwitchboardTbc),
    meterChannels: jsonArray(item.meterChannels),
    comments: optionalString(item, 'comments'),
    extraPhotos: jsonArray<string>(item.extraPhotos),
    createdAt: item.createdAt ? dateOrNow(item.createdAt) : (existing?.createdAt ?? new Date()),
  };
}

export function formValues(
  item: JsonRecord,
  installationId: string,
  existing?: typeof ihFormSubmissions.$inferSelect,
  syncStage?: PushBody['syncStage'],
) {
  requireParentId(item, installationId);
  const schemaVersion = Number(item.schemaVersion ?? 1);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw badRequest('schemaVersion must be a positive integer');
  }
  const formType = requiredString(item, 'formType');
  const status = optionalString(item, 'status') ?? existing?.status ?? 'Draft';
  const answers = jsonObject(item.answers);
  if (
    schemaVersion >= 2
    && item.attachments !== undefined
    && !Array.isArray(item.attachments)
  ) {
    throw badRequest('attachments must be an array');
  }
  const attachments = jsonArray(item.attachments);
  validateInstallHubFormContract({
    formType,
    schemaVersion,
    status,
    answers,
    attachments,
    syncStage,
  });
  return {
    id: requiredString(item, 'id'),
    serverId: existing?.serverId ?? optionalString(item, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(item.updatedAt),
    deletedAt: optionalDate(item.deletedAt),
    installationId,
    formType,
    schemaVersion,
    status,
    zoneId: optionalString(item, 'zoneId'),
    boardId: optionalString(item, 'boardId'),
    meterId: optionalString(item, 'meterId'),
    siteAssetId: optionalString(item, 'siteAssetId'),
    answers: answers as Record<string, string>,
    attachments,
    completedAt: optionalDate(item.completedAt),
    supersedesId: optionalString(item, 'supersedesId'),
    createdAt: item.createdAt ? dateOrNow(item.createdAt) : (existing?.createdAt ?? new Date()),
  };
}

export async function installhubSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/check-photo', {
    schema: { tags: ['InstallHub Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const installationId = requiredString(body, 'installationId');
    const entityType = requiredString(body, 'entityType');
    const entityId = requiredString(body, 'entityId');
    const fieldName = requiredString(body, 'fieldName');
    await loadAccessibleInstallation(installationId, request);
    await loadUploadEntity(installationId, entityType, entityId);

    const [existing] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'installhub'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, installationId),
      eq(photoRegistry.entityType, entityType),
      eq(photoRegistry.entityId, entityId),
      eq(photoRegistry.fieldName, fieldName),
      eq(photoRegistry.status, 'confirmed'),
    ));
    return reply.send({
      exists: Boolean(existing),
      remoteUrl: existing?.remoteUrl,
      fileSizeBytes: existing?.fileSizeBytes,
      photoId: existing?.id,
    });
  });

  app.post('/create-upload-session', {
    schema: { tags: ['InstallHub Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const installationId = requiredString(body, 'installationId');
    const entityType = requiredString(body, 'entityType');
    const entityId = requiredString(body, 'entityId');
    const fieldName = requiredString(body, 'fieldName');
    const filename = requiredString(body, 'filename');
    const fileSizeBytes = Number(body.fileSizeBytes);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      throw badRequest('fileSizeBytes must be a positive number');
    }
    if (fileSizeBytes > config.storage.maxUploadBytes) {
      throw badRequest(`File exceeds max upload size of ${config.storage.maxUploadBytes} bytes`);
    }

    const installation = await loadAccessibleInstallation(installationId, request);
    const entity = await loadUploadEntity(installationId, entityType, entityId);
    const [duplicate] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'installhub'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, installationId),
      eq(photoRegistry.entityType, entityType),
      eq(photoRegistry.entityId, entityId),
      eq(photoRegistry.fieldName, fieldName),
      eq(photoRegistry.status, 'confirmed'),
    ));
    if (duplicate?.remoteUrl) {
      return reply.send({
        sessionId: duplicate.id,
        uploadUrl: null,
        alreadyExists: true,
        remoteUrl: duplicate.remoteUrl,
      });
    }

    const sessionId = randomUUID();
    const storageKey = makePhotoStorageKeyFromNames({
      app: 'installhub',
      parentName: installation.siteName,
      entityType,
      entityName: entity.name,
      fieldName,
      sessionId,
      filename,
    });
    await db.insert(photoRegistry).values({
      id: sessionId,
      checksum,
      storageKey,
      originalFilename: filename,
      app: 'installhub',
      parentId: installationId,
      entityType,
      entityId,
      fieldName,
      fileSizeBytes,
      status: 'pending',
    });
    return reply.status(201).send({
      sessionId,
      uploadUrl: uploadUrl(sessionId),
      alreadyExists: false,
    });
  });

  app.put('/upload/:sessionId', {
    schema: { tags: ['InstallHub Sync'] },
    onRequest: requireUploadCapability('installhub'),
    bodyLimit: config.storage.maxUploadBytes,
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!Buffer.isBuffer(request.body)) throw badRequest('Upload body must be raw bytes');
    const body = request.body;
    const [session] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.id, sessionId),
      eq(photoRegistry.app, 'installhub'),
    ));
    const found = assertFound(session, 'Upload session');
    if (found.status !== 'pending') throw badRequest(`Upload session is ${found.status}`);
    assertUploadSessionFresh(found.createdAt);
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.fileSizeBytes && found.fileSizeBytes !== body.length) {
      throw badRequest('Uploaded file size does not match session');
    }
    const written = await writeLocalFile(found.storageKey, body);
    if (written.checksum !== found.checksum) {
      await deleteLocalFile(found.storageKey);
      await db.update(photoRegistry).set({ status: 'failed' }).where(eq(photoRegistry.id, sessionId));
      throw badRequest('Uploaded checksum does not match session');
    }
    await db.update(photoRegistry).set({
      status: 'uploaded',
      fileSizeBytes: written.size,
      contentType: String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0],
      uploadedAt: new Date(),
    }).where(eq(photoRegistry.id, sessionId));
    return reply.send({ ok: true, checksum: written.checksum, fileSizeBytes: written.size });
  });

  app.post('/confirm-upload', {
    schema: { tags: ['InstallHub Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const sessionId = requiredString(body, 'sessionId');
    const checksum = requiredString(body, 'checksum');
    const [session] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.id, sessionId),
      eq(photoRegistry.app, 'installhub'),
    ));
    const found = assertFound(session, 'Upload session');
    await loadAccessibleInstallation(found.parentId, request);
    await loadUploadEntity(found.parentId, found.entityType, found.entityId);
    if (found.checksum !== checksum) throw badRequest('Checksum does not match session');
    if (!found.storageKey) throw badRequest('Upload session has no storage key');
    if (found.status === 'confirmed' && found.remoteUrl) {
      return reply.send({ remoteUrl: found.remoteUrl });
    }
    if (found.status !== 'uploaded') throw badRequest(`Upload session is ${found.status}`);
    if (!(await localFileExists(found.storageKey))) throw badRequest('Uploaded file is missing');

    const remoteUrl = publicFileUrl(found.storageKey);
    const oneDriveBackup = found.onedriveItemId
      ? null
      : await mirrorStoredPhotoToOneDrive({
          storageKey: found.storageKey,
          contentType: found.contentType,
          logger: request.log,
        });
    await db.update(photoRegistry).set({
      status: 'confirmed',
      remoteUrl,
      onedriveItemId: oneDriveBackup?.itemId ?? found.onedriveItemId,
      uploadedAt: new Date(),
    }).where(eq(photoRegistry.id, sessionId));
    return reply.send({ remoteUrl });
  });

  app.post('/push', {
    schema: { tags: ['InstallHub Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as PushBody;
    const syncStage = parseInstallHubSyncStage(body.syncStage);
    if (!body.installation) throw badRequest('installation is required');
    if (
      !Array.isArray(body.zones) ||
      !Array.isArray(body.electricalAssets) ||
      !Array.isArray(body.siteAssets) ||
      !Array.isArray(body.formSubmissions)
    ) {
      throw badRequest('zones, electricalAssets, siteAssets and formSubmissions must be arrays');
    }
    const zones = body.zones;
    const electricalAssets = body.electricalAssets;
    const siteAssets = body.siteAssets;
    const formSubmissions = body.formSubmissions;
    const installationId = requiredString(body.installation, 'id');
    const [existingInstallation] = await db
      .select()
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    if (existingInstallation) assertInstallationAccess(existingInstallation, request.user);
    const installationValues = installationValuesFromPayload(
      body.installation,
      request.user,
      existingInstallation,
    );

    const zoneIds = new Set(zones.map((item) => {
      requireParentId(item, installationId);
      return requiredString(item, 'id');
    }));
    const electricalAssetIds = new Set(
      electricalAssets.map((item) => requiredString(item, 'id')),
    );
    const siteAssetIds = new Set(
      siteAssets.map((item) => requiredString(item, 'id')),
    );
    const formSubmissionIds = new Set(
      formSubmissions.map((item) => requiredString(item, 'id')),
    );
    const meterBoardById = new Map<string, string>();
    for (const item of [...electricalAssets, ...siteAssets]) {
      requireParentId(item, installationId);
      if (!zoneIds.has(requiredString(item, 'zoneId'))) {
        throw badRequest('Asset zoneId is not present in this installation payload');
      }
    }
    for (const board of electricalAssets) {
      const boardId = requiredString(board, 'id');
      for (const meter of jsonArray<JsonRecord>(board.meters)) {
        const meterId = requiredString(meter, 'id');
        if (meterBoardById.has(meterId)) {
          throw badRequest(`Meter ${meterId} appears under more than one board`);
        }
        meterBoardById.set(meterId, boardId);
      }
    }
    for (const form of formSubmissions) {
      requireParentId(form, installationId);
      const zoneId = optionalString(form, 'zoneId');
      const boardId = optionalString(form, 'boardId');
      const siteAssetId = optionalString(form, 'siteAssetId');
      const meterId = optionalString(form, 'meterId');
      const supersedesId = optionalString(form, 'supersedesId');
      if (zoneId && !zoneIds.has(zoneId)) {
        throw badRequest(`Form ${requiredString(form, 'id')} has an invalid zoneId`);
      }
      if (boardId && !electricalAssetIds.has(boardId)) {
        throw badRequest(`Form ${requiredString(form, 'id')} has an invalid boardId`);
      }
      if (siteAssetId && !siteAssetIds.has(siteAssetId)) {
        throw badRequest(`Form ${requiredString(form, 'id')} has an invalid siteAssetId`);
      }
      if (meterId) {
        const meterBoardId = meterBoardById.get(meterId);
        if (!meterBoardId || (boardId && meterBoardId !== boardId)) {
          throw badRequest(`Form ${requiredString(form, 'id')} has an invalid meterId`);
        }
      }
      if (
        supersedesId &&
        (supersedesId === requiredString(form, 'id') ||
          !formSubmissionIds.has(supersedesId))
      ) {
        throw badRequest(`Form ${requiredString(form, 'id')} has an invalid supersedesId`);
      }
    }

    const serverIds = {
      installationId: installationValues.serverId,
      zoneIds: {} as Record<string, string>,
      electricalAssetIds: {} as Record<string, string>,
      siteAssetIds: {} as Record<string, string>,
      formSubmissionIds: {} as Record<string, string>,
    };

    await db.transaction(async (tx) => {
      const { id: _installationId, ...installationUpdate } = installationValues;
      await tx.insert(ihInstallations).values(installationValues).onConflictDoUpdate({
        target: ihInstallations.id,
        set: installationUpdate,
      });

      for (const item of zones) {
        const id = requiredString(item, 'id');
        const [existing] = await tx.select().from(ihZones).where(eq(ihZones.id, id));
        if (existing && existing.installationId !== installationId) throw forbidden('Zone belongs to another installation');
        const values = zoneValues(item, installationId, existing);
        const { id: _id, ...update } = values;
        await tx.insert(ihZones).values(values).onConflictDoUpdate({ target: ihZones.id, set: update });
        serverIds.zoneIds[id] = values.serverId;
      }

      for (const item of electricalAssets) {
        const id = requiredString(item, 'id');
        const [existing] = await tx.select().from(ihElectricalAssets).where(eq(ihElectricalAssets.id, id));
        if (existing && existing.installationId !== installationId) {
          throw forbidden('Electrical asset belongs to another installation');
        }
        const values = electricalAssetValues(item, installationId, existing);
        const { id: _id, ...update } = values;
        await tx.insert(ihElectricalAssets).values(values).onConflictDoUpdate({
          target: ihElectricalAssets.id,
          set: update,
        });
        serverIds.electricalAssetIds[id] = values.serverId;
      }

      for (const item of siteAssets) {
        const id = requiredString(item, 'id');
        const [existing] = await tx.select().from(ihSiteAssets).where(eq(ihSiteAssets.id, id));
        if (existing && existing.installationId !== installationId) {
          throw forbidden('Site asset belongs to another installation');
        }
        const values = siteAssetValues(item, installationId, existing);
        const { id: _id, ...update } = values;
        await tx.insert(ihSiteAssets).values(values).onConflictDoUpdate({
          target: ihSiteAssets.id,
          set: update,
        });
        serverIds.siteAssetIds[id] = values.serverId;
      }

      for (const item of formSubmissions) {
        const id = requiredString(item, 'id');
        const [existing] = await tx.select().from(ihFormSubmissions).where(eq(ihFormSubmissions.id, id));
        if (existing && existing.installationId !== installationId) {
          throw forbidden('Form submission belongs to another installation');
        }
        const values = formValues(item, installationId, existing, syncStage);
        const { id: _id, ...update } = values;
        await tx.insert(ihFormSubmissions).values(values).onConflictDoUpdate({
          target: ihFormSubmissions.id,
          set: update,
        });
        serverIds.formSubmissionIds[id] = values.serverId;
      }

      const deletedAt = new Date();
      const electricalIds = electricalAssets.map((item) => requiredString(item, 'id'));
      const siteAssetIds = siteAssets.map((item) => requiredString(item, 'id'));
      const formIds = formSubmissions.map((item) => requiredString(item, 'id'));
      await tx.update(ihZones).set({ deletedAt, syncStatus: 'synced', updatedAt: deletedAt }).where(
        zoneIds.size
          ? and(eq(ihZones.installationId, installationId), notInArray(ihZones.id, [...zoneIds]))
          : eq(ihZones.installationId, installationId),
      );
      await tx.update(ihElectricalAssets).set({ deletedAt, syncStatus: 'synced', updatedAt: deletedAt }).where(
        electricalIds.length
          ? and(
              eq(ihElectricalAssets.installationId, installationId),
              notInArray(ihElectricalAssets.id, electricalIds),
            )
          : eq(ihElectricalAssets.installationId, installationId),
      );
      await tx.update(ihSiteAssets).set({ deletedAt, syncStatus: 'synced', updatedAt: deletedAt }).where(
        siteAssetIds.length
          ? and(eq(ihSiteAssets.installationId, installationId), notInArray(ihSiteAssets.id, siteAssetIds))
          : eq(ihSiteAssets.installationId, installationId),
      );
      await tx.update(ihFormSubmissions).set({ deletedAt, syncStatus: 'synced', updatedAt: deletedAt }).where(
        formIds.length
          ? and(
              eq(ihFormSubmissions.installationId, installationId),
              notInArray(ihFormSubmissions.id, formIds),
            )
          : eq(ihFormSubmissions.installationId, installationId),
      );
    });

    await reconcilePhotoCopyReferencesForParent({
      app: 'installhub',
      parentId: installationId,
      actor: request.user,
    });

    const versionNumber = installHubSyncCreatesRecordVersion(syncStage)
      ? await saveRecordVersion({
          app: 'installhub',
          entityType: 'installation',
          entityId: installationId,
          snapshot: body,
          userId: request.user.userId,
        })
      : null;
    return reply.send({ ...serverIds, versionNumber });
  });

  app.get('/pull', {
    schema: { tags: ['InstallHub Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const query = request.query as { since?: string; installationId?: string };
    const since = query.since ? new Date(query.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw badRequest('since must be an ISO date');
    if (query.installationId) await loadAccessibleInstallation(query.installationId, request);

    const conditions = [gt(ihInstallations.updatedAt, since), isNull(ihInstallations.deletedAt)];
    if (query.installationId) conditions.push(eq(ihInstallations.id, query.installationId));
    if (!isElevated(request.user)) {
      conditions.push(or(
        eq(ihInstallations.createdByUserId, request.user.userId),
        eq(ihInstallations.assignedInspectorUserId, request.user.userId),
      )!);
    }
    const installations = await db.select().from(ihInstallations).where(and(...conditions));
    const trees = await Promise.all(installations.map(async (installation) => ({
      installation,
      zones: await db.select().from(ihZones).where(and(
        eq(ihZones.installationId, installation.id),
        isNull(ihZones.deletedAt),
      )),
      electricalAssets: await db.select().from(ihElectricalAssets).where(and(
        eq(ihElectricalAssets.installationId, installation.id),
        isNull(ihElectricalAssets.deletedAt),
      )),
      siteAssets: await db.select().from(ihSiteAssets).where(and(
        eq(ihSiteAssets.installationId, installation.id),
        isNull(ihSiteAssets.deletedAt),
      )),
      formSubmissions: await db.select().from(ihFormSubmissions).where(and(
        eq(ihFormSubmissions.installationId, installation.id),
        isNull(ihFormSubmissions.deletedAt),
      )),
    })));
    return reply.send({ installations: trees, pulledAt: new Date().toISOString() });
  });
}
