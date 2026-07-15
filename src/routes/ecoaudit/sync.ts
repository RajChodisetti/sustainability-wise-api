import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import {
  eaAudits, eaZones, eaMainSwitchboards, eaAdditionalSwitchboards,
  eaHvacUnits, eaLightingSystems, eaSolarPv, eaForkliftChargers,
  eaHotWaterSystems, eaGeneralWater, eaGeneralElectricity,
} from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess, dateOrNow, isElevated, requiredString, str, num, arr, type JsonRecord } from './helpers.js';
import { badRequest } from '../../utils/errors.js';
import { deleteLocalFile, localFileExists, publicFileUrl, writeLocalFile } from '../../storage/localFiles.js';
import { saveRecordVersion } from '../recordVersions.js';
import { mirrorStoredPhotoToOneDrive } from '../../onedrive/photoBackup.js';
import { loadEcoEntityName, makePhotoStorageKeyFromNames } from '../../services/storageNaming.js';
import { sanitizeEcoAuditSnapshot } from './auditSnapshot.js';
import { resolveSyncCreatedByUserId } from '../syncOwnership.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  reconcilePhotoCopyReferencesForParent,
  releaseCopyReferencesForEntity,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';

function uploadUrl(sessionId: string): string {
  return `${config.publicBaseUrl}/v1/ecoaudit/sync/upload/${sessionId}`;
}

function assertUploadSessionFresh(createdAt: Date): void {
  if (Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000) throw badRequest('Upload session has expired');
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
  // POST /check-photo
  app.post('/check-photo', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const auditId = requiredString(body, 'auditId');
    const fieldName = requiredString(body, 'fieldName');
    const entityId = typeof body.entityId === 'string' && body.entityId.trim() ? body.entityId.trim() : auditId;
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    const [existing] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, auditId),
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

  // POST /create-upload-session
  app.post('/create-upload-session', {
    schema: { tags: ['EcoAudit Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const auditId = requiredString(body, 'auditId');
    const fieldName = requiredString(body, 'fieldName');
    const filename = requiredString(body, 'filename');
    const fileSizeBytes = Number(body.fileSizeBytes ?? 0);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) throw badRequest('fileSizeBytes must be a positive number');
    if (fileSizeBytes > config.storage.maxUploadBytes) throw badRequest(`File exceeds max upload size of ${config.storage.maxUploadBytes} bytes`);

    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);

    const entityId = typeof body.entityId === 'string' && body.entityId.trim() ? body.entityId.trim() : auditId;
    const entityType = typeof body.entityType === 'string' && body.entityType.trim() ? body.entityType.trim() : 'audit';

    // Check for duplicate only for the exact same record field. Other uses should still
    // create their own DB/storage entry so scoped file browsing is complete.
    const [duplicate] = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, auditId),
      eq(photoRegistry.entityId, entityId),
      eq(photoRegistry.fieldName, fieldName),
      eq(photoRegistry.status, 'confirmed'),
    ));
    if (duplicate?.remoteUrl) {
      return reply.send({ sessionId: duplicate.id, uploadUrl: null, alreadyExists: true, remoteUrl: duplicate.remoteUrl });
    }

    const sessionId = randomUUID();
    const storageKey = makePhotoStorageKeyFromNames({
      app: 'ecoaudit',
      parentName: audit.siteName,
      entityType,
      entityName: await loadEcoEntityName(audit, entityType, entityId),
      fieldName,
      sessionId,
      filename,
    });
    await db.insert(photoRegistry).values({
      id: sessionId, checksum, remoteUrl: null, onedriveItemId: null, storageKey,
      contentType: null, originalFilename: filename, app: 'ecoaudit', parentId: auditId,
      entityType, entityId, fieldName, fileSizeBytes, status: 'pending',
    });
    return reply.status(201).send({ sessionId, uploadUrl: uploadUrl(sessionId), alreadyExists: false });
  });

  // PUT /upload/:sessionId — raw bytes, no auth
  app.put('/upload/:sessionId', {
    schema: { tags: ['EcoAudit Sync'] },
    bodyLimit: config.storage.maxUploadBytes,
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw badRequest('Upload body must be raw bytes');
    const [session] = await db.select().from(photoRegistry).where(and(eq(photoRegistry.id, sessionId), eq(photoRegistry.app, 'ecoaudit')));
    const found = assertFound(session, 'Upload session');
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
    if (found.status === 'confirmed' && found.remoteUrl) return reply.send({ remoteUrl: found.remoteUrl });
    if (found.status !== 'uploaded') throw badRequest(`Upload session is ${found.status}`);
    if (!(await localFileExists(found.storageKey))) throw badRequest('Uploaded file is missing from configured storage');
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
    return reply.send({
      remoteUrl,
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
    const body = request.body as {
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
    };

    if (!body.audit) throw badRequest('audit is required');
    const auditPayload = body.audit;

    const localAuditId = requiredString(auditPayload, 'id');
    const [existingAudit] = await db.select().from(eaAudits).where(eq(eaAudits.id, localAuditId));
    if (existingAudit) assertAuditAccess(existingAudit, request.user);

    const auditServerId = existingAudit?.serverId ?? (typeof auditPayload.serverId === 'string' && auditPayload.serverId.trim() ? auditPayload.serverId : randomUUID());
    const status = str(auditPayload.status) ?? existingAudit?.status ?? 'Draft';
    const receivedAt = new Date();
    const updatedAt = auditPayload.updatedAt ? dateOrNow(auditPayload.updatedAt) : receivedAt;
    const createdAt = auditPayload.createdAt
      ? dateOrNow(auditPayload.createdAt)
      : (existingAudit?.createdAt ?? receivedAt);
    const versionSnapshot = sanitizeEcoAuditSnapshot(body);

    const auditValues = {
      id: localAuditId, serverId: auditServerId, syncStatus: 'synced',
      updatedAt,
      deletedAt: auditPayload.deletedAt ? dateOrNow(auditPayload.deletedAt) : null,
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
      assignedInspectorUserId: str(auditPayload.assignedInspectorUserId),
      createdAt,
    };
    const { id: _aid, ...auditUpdateValues } = auditValues;
    await db.insert(eaAudits).values(auditValues as any).onConflictDoUpdate({ target: eaAudits.id, set: auditUpdateValues as any });
    if (auditValues.deletedAt) {
      await deletePhotosForAudit(localAuditId);
      const versionNumber = await saveRecordVersion({
        app: 'ecoaudit',
        entityType: 'audit',
        entityId: localAuditId,
        snapshot: versionSnapshot,
        userId: request.user.userId,
      });
      return reply.send({ auditId: localAuditId, serverId: auditServerId, versionNumber });
    }

    // Upsert zones
    const photoDescs = (item: JsonRecord) =>
      item.photoDescs && typeof item.photoDescs === 'object' && !Array.isArray(item.photoDescs)
        ? item.photoDescs
        : {};

    for (const zone of (body.zones ?? [])) {
      const zoneId = requiredString(zone, 'id');
      const [existing] = await db.select().from(eaZones).where(eq(eaZones.id, zoneId));
      const serverId = existing?.serverId ?? (str(zone.serverId) ?? randomUUID());
      const vals = {
        id: zoneId, serverId, syncStatus: 'synced', updatedAt: dateOrNow(zone.updatedAt),
        deletedAt: zone.deletedAt ? dateOrNow(zone.deletedAt) : null,
        auditId: localAuditId, zoneName: requiredString(zone, 'zoneName'),
        zoneDescription: str(zone.zoneDescription),
        photos: arr(zone.photos), photoDescs: photoDescs(zone), createdAt: dateOrNow(zone.createdAt),
      };
      const { id: _zid, ...zoneUpdate } = vals;
      await db.insert(eaZones).values(vals as any).onConflictDoUpdate({ target: eaZones.id, set: zoneUpdate as any });
      if (vals.deletedAt) {
        await deletePhotosForEntity(zoneId);
      }
    }

    // Generic equipment upsert helper
    async function upsertEquipment<T extends { id: string }>(
      table: any,
      items: JsonRecord[],
      buildValues: (item: JsonRecord, existing: T | undefined) => Record<string, unknown>,
    ) {
      for (const item of items) {
        const itemId = requiredString(item, 'id');
        const [existing] = await db.select().from(table).where(eq(table.id, itemId));
        const vals = buildValues(item, existing);
        const { id: _id, ...updateVals } = vals;
        await db.insert(table).values(vals as any).onConflictDoUpdate({ target: table.id, set: updateVals as any });
        if (vals.deletedAt) {
          await deletePhotosForEntity(itemId);
        }
      }
    }

    const baseCols = (item: JsonRecord, existing: any, extra: Record<string, unknown>) => ({
      id: requiredString(item, 'id'),
      serverId: existing?.serverId ?? (str(item.serverId) ?? randomUUID()),
      syncStatus: 'synced', updatedAt: dateOrNow(item.updatedAt),
      deletedAt: item.deletedAt ? dateOrNow(item.deletedAt) : null,
      zoneId: requiredString(item, 'zoneId'), auditId: localAuditId,
      createdAt: dateOrNow(item.createdAt),
      extraNotes: str(item.extraNotes), extraPhotos: arr(item.extraPhotos),
      photoDescs: photoDescs(item),
      ...extra,
    });

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
      switchboardPhotoNotes: str(item.switchboardPhotoNotes), energyImprovementObservations: str(item.energyImprovementObservations),
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

    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: localAuditId, actor: request.user });

    const versionNumber = await saveRecordVersion({
      app: 'ecoaudit',
      entityType: 'audit',
      entityId: localAuditId,
      snapshot: versionSnapshot,
      userId: request.user.userId,
    });

    return reply.send({ auditId: localAuditId, serverId: auditServerId, versionNumber });
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
        };
    return reply.send({ audits, ...byAudit, pulledAt: new Date().toISOString() });
  });
}
