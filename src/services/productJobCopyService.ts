import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { db } from '../db/client.js';
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
} from '../db/schema/ecoaudit.js';
import {
  ihElectricalAssets,
  ihGridSupplies,
  ihInstallations,
  ihMeasurementAssignmentChannels,
  ihMeasurementAssignments,
  ihMeterChannels,
  ihMeterDevices,
  ihSiteAssets,
  ihZones,
} from '../db/schema/installhub.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import {
  ecoPhotoFieldReferences,
  ecoPhotoValues,
  installHubElectricalPhotoFieldReferences,
  installHubMeterPhotoFieldReferences,
  installHubSiteAssetPhotoFieldReferences,
  installHubZonePhotoFieldReferences,
  linkCopiedPhotoReferences,
  reconcilePhotoCopyReferencesForParent,
  solarAssessmentPhotoFieldReferences,
  solarAssessmentPhotoValues,
  solarSitePhotoFieldReferences,
  solarSitePhotoValues,
  type CopiedPhotoEntity,
} from '../storage/photoCopyReferences.js';
import { cloneRecordForInsert } from '../routes/copyUtils.js';
import { conflict } from '../utils/errors.js';

type ProductCopyExecutor = Pick<typeof db, 'select' | 'insert'>;

type ProductIdentity = {
  createdByUserId: string;
  assignedInspectorUserId: string | null;
  inspectorName: string;
  auditDate: string;
};

type SiteProjection = {
  siteName: string;
  address: string;
  siteLocality: string | null;
  siteState: string | null;
  sitePostcode: string | null;
  siteCountryCode: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
};

const ecoEquipmentTables = [
  { table: eaMainSwitchboards, entityType: 'main_switchboard' },
  { table: eaAdditionalSwitchboards, entityType: 'additional_switchboard' },
  { table: eaHvacUnits, entityType: 'hvac_unit' },
  { table: eaLightingSystems, entityType: 'lighting_system' },
  { table: eaSolarPv, entityType: 'solar_pv' },
  { table: eaForkliftChargers, entityType: 'forklift_charger' },
  { table: eaHotWaterSystems, entityType: 'hot_water_system' },
  { table: eaGeneralWater, entityType: 'general_water' },
  { table: eaGeneralElectricity, entityType: 'general_electricity' },
] as const;

function cloneRecordWithId(
  source: Record<string, unknown>,
  id: string,
  overrides: Record<string, unknown> = {},
  blockedKeys: string[] = [],
): Record<string, unknown> {
  return {
    ...cloneRecordForInsert(source, overrides, blockedKeys),
    id,
  };
}

export async function copyEcoAuditForJob(
  executor: ProductCopyExecutor,
  sourceAuditId: string,
  site: SiteProjection,
  identity: ProductIdentity,
): Promise<string> {
  const [source] = await executor.select().from(eaAudits).where(and(
    eq(eaAudits.id, sourceAuditId),
    isNull(eaAudits.deletedAt),
  ));
  if (!source) throw conflict('existing_site_source_missing');

  const copiedAudit = cloneRecordForInsert(source, {
    siteName: site.siteName,
    siteAddress: site.address,
    siteLocality: site.siteLocality,
    siteState: site.siteState,
    sitePostcode: site.sitePostcode,
    siteCountryCode: site.siteCountryCode,
    siteLatitude: site.siteLatitude,
    siteLongitude: site.siteLongitude,
    inspectorName: identity.inspectorName,
    auditDate: identity.auditDate,
    status: 'Draft',
    createdByUserId: identity.createdByUserId,
    assignedInspectorUserId: identity.assignedInspectorUserId,
    reportPdfLocalPath: null,
    reportPdfRemoteUrl: null,
    startedAt: null,
    completedAt: null,
  }) as typeof eaAudits.$inferInsert;
  await executor.insert(eaAudits).values(copiedAudit);
  const targetAuditId = String(copiedAudit.id);
  const zoneIdMap = new Map<string, string>();
  const copiedEntities: CopiedPhotoEntity[] = [];
  const zones = await executor.select().from(eaZones).where(and(
    eq(eaZones.auditId, sourceAuditId),
    isNull(eaZones.deletedAt),
  ));
  for (const zone of zones) {
    const copied = cloneRecordForInsert(zone, { auditId: targetAuditId }) as typeof eaZones.$inferInsert;
    zoneIdMap.set(zone.id, String(copied.id));
    await executor.insert(eaZones).values(copied);
    copiedEntities.push({
      sourceEntityId: zone.id,
      targetEntityId: String(copied.id),
      targetEntityType: 'zone',
      photoValues: ecoPhotoValues(zone),
      photoReferences: ecoPhotoFieldReferences(zone),
    });
  }
  for (const { table, entityType } of ecoEquipmentTables) {
    const rows = await executor.select().from(table as any).where(and(
      eq((table as any).auditId, sourceAuditId),
      isNull((table as any).deletedAt),
    ));
    if (rows.length === 0) continue;
    const values = rows.map((row: Record<string, unknown>) => cloneRecordForInsert(row, {
      auditId: targetAuditId,
      zoneId: zoneIdMap.get(String(row.zoneId ?? '')) ?? row.zoneId,
    }));
    await executor.insert(table as any).values(values);
    rows.forEach((row: Record<string, unknown>, index: number) => copiedEntities.push({
      sourceEntityId: String(row.id),
      targetEntityId: String(values[index].id),
      targetEntityType: entityType,
      photoValues: ecoPhotoValues(row),
      photoReferences: ecoPhotoFieldReferences(row),
    }));
  }
  await linkCopiedPhotoReferences({
    app: 'ecoaudit',
    sourceParentId: sourceAuditId,
    targetParentId: targetAuditId,
    entities: copiedEntities,
    executor: executor as typeof db,
  });
  await reconcilePhotoCopyReferencesForParent({
    app: 'ecoaudit',
    parentId: targetAuditId,
    executor: executor as typeof db,
  });
  return targetAuditId;
}

export async function copySolarAssessmentForJob(
  executor: ProductCopyExecutor,
  sourceAssessmentId: string,
  site: SiteProjection,
  buildingName: string,
  identity: ProductIdentity,
): Promise<string> {
  const [sourceAssessment] = await executor.select().from(ssRooftopAssessments).where(and(
    eq(ssRooftopAssessments.id, sourceAssessmentId),
    isNull(ssRooftopAssessments.deletedAt),
  ));
  if (!sourceAssessment) throw conflict('existing_site_source_missing');
  const [sourceSite] = sourceAssessment.siteId
    ? await executor.select().from(ssSites).where(and(
      eq(ssSites.id, sourceAssessment.siteId),
      isNull(ssSites.deletedAt),
    ))
    : [];
  const targetSiteId = randomUUID();
  const targetAssessmentId = randomUUID();
  const now = new Date();
  const siteValues = sourceSite
    ? cloneRecordWithId(sourceSite, targetSiteId, {
      siteName: site.siteName,
      location: site.address,
      siteLocality: site.siteLocality,
      siteState: site.siteState,
      sitePostcode: site.sitePostcode,
      siteCountryCode: site.siteCountryCode,
      siteLatitude: site.siteLatitude,
      siteLongitude: site.siteLongitude,
      dateOfAssessment: identity.auditDate,
      status: 'Draft',
      completedAt: null,
      createdByUserId: identity.createdByUserId,
      reportPdfLocalPath: null,
      reportPdfRemoteUrl: null,
    })
    : {
      id: targetSiteId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      siteName: site.siteName,
      location: site.address,
      siteLocality: site.siteLocality,
      siteState: site.siteState,
      sitePostcode: site.sitePostcode,
      siteCountryCode: site.siteCountryCode,
      siteLatitude: site.siteLatitude,
      siteLongitude: site.siteLongitude,
      dateOfAssessment: identity.auditDate,
      createdByUserId: identity.createdByUserId,
      createdAt: now,
      status: 'Draft',
      completedAt: null,
    };
  await executor.insert(ssSites).values(siteValues as typeof ssSites.$inferInsert);
  const assessmentValues = cloneRecordWithId(sourceAssessment, targetAssessmentId, {
    siteId: targetSiteId,
    siteName: site.siteName,
    buildingIdName: buildingName,
    status: 'Draft',
    completedAt: null,
    createdByUserId: identity.createdByUserId,
    assignedInspectorUserId: identity.assignedInspectorUserId,
  }) as typeof ssRooftopAssessments.$inferInsert;
  await executor.insert(ssRooftopAssessments).values(assessmentValues);
  const entities: CopiedPhotoEntity[] = [
    ...(sourceSite ? [{
      sourceEntityId: sourceSite.id,
      targetEntityId: targetSiteId,
      targetEntityType: 'site',
      photoValues: solarSitePhotoValues(sourceSite),
      photoReferences: solarSitePhotoFieldReferences(sourceSite),
    }] : []),
    {
      sourceEntityId: sourceAssessment.id,
      targetEntityId: targetAssessmentId,
      targetEntityType: 'rooftop_assessment',
      photoValues: solarAssessmentPhotoValues(sourceAssessment),
      photoReferences: solarAssessmentPhotoFieldReferences(sourceAssessment),
    },
  ];
  await linkCopiedPhotoReferences({
    app: 'solarsense',
    sourceParentId: sourceSite?.id ?? sourceAssessmentId,
    targetParentId: targetSiteId,
    entities,
    executor: executor as typeof db,
  });
  await reconcilePhotoCopyReferencesForParent({
    app: 'solarsense',
    parentId: targetSiteId,
    executor: executor as typeof db,
  });
  return targetAssessmentId;
}

function idMap<T extends { id: string }>(rows: readonly T[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, randomUUID()]));
}

function mapped(map: Map<string, string>, value: string | null): string | null {
  return value === null ? null : map.get(value) ?? value;
}

export async function copyFieldInstallationForJob(
  executor: ProductCopyExecutor,
  sourceInstallationId: string,
  site: SiteProjection & {
    clientName: string;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    accessInformation: string | null;
    timezone: string;
  },
  identity: ProductIdentity,
  planning: {
    customerName: string | null;
    maas: boolean | null;
    workType: string | null;
    meteringSolutionType: string | null;
    plannedMeterType: string | null;
    customJobNumber: string | null;
    jobComments: string | null;
    nmi: string | null;
  },
): Promise<string> {
  const [source] = await executor.select().from(ihInstallations).where(and(
    eq(ihInstallations.id, sourceInstallationId),
    isNull(ihInstallations.deletedAt),
  ));
  if (!source) throw conflict('existing_site_source_missing');
  const [gridSupplies, zones, boards, siteAssets, meters, channels, assignments, assignmentChannels] = await Promise.all([
    executor.select().from(ihGridSupplies).where(and(eq(ihGridSupplies.installationId, sourceInstallationId), isNull(ihGridSupplies.deletedAt))),
    executor.select().from(ihZones).where(and(eq(ihZones.installationId, sourceInstallationId), isNull(ihZones.deletedAt))),
    executor.select().from(ihElectricalAssets).where(and(eq(ihElectricalAssets.installationId, sourceInstallationId), isNull(ihElectricalAssets.deletedAt))),
    executor.select().from(ihSiteAssets).where(and(eq(ihSiteAssets.installationId, sourceInstallationId), isNull(ihSiteAssets.deletedAt))),
    executor.select().from(ihMeterDevices).where(and(eq(ihMeterDevices.installationId, sourceInstallationId), isNull(ihMeterDevices.deletedAt))),
    executor.select().from(ihMeterChannels).where(and(eq(ihMeterChannels.installationId, sourceInstallationId), isNull(ihMeterChannels.deletedAt))),
    executor.select().from(ihMeasurementAssignments).where(and(eq(ihMeasurementAssignments.installationId, sourceInstallationId), isNull(ihMeasurementAssignments.deletedAt))),
    executor.select().from(ihMeasurementAssignmentChannels).where(eq(ihMeasurementAssignmentChannels.installationId, sourceInstallationId)),
  ]);
  const installationId = randomUUID();
  const gridMap = idMap(gridSupplies);
  const zoneMap = idMap(zones);
  const boardMap = idMap(boards);
  const siteAssetMap = idMap(siteAssets);
  const meterMap = idMap(meters);
  const channelMap = idMap(channels);
  const assignmentMap = idMap(assignments);
  const assignmentChannelMap = idMap(assignmentChannels);
  const copiedEntities: CopiedPhotoEntity[] = [];

  await executor.insert(ihInstallations).values(cloneRecordWithId(source, installationId, {
    externalKey: `ih_${randomUUID()}`,
    clientName: site.clientName,
    customerName: planning.customerName,
    maas: planning.maas,
    serviceType: planning.workType,
    meteringSolutionType: planning.meteringSolutionType,
    plannedMeterType: planning.plannedMeterType,
    customJobNumber: planning.customJobNumber,
    siteName: site.siteName,
    siteAddress: site.address,
    siteLocality: site.siteLocality,
    siteState: site.siteState,
    sitePostcode: site.sitePostcode,
    siteCountryCode: site.siteCountryCode,
    siteLatitude: site.siteLatitude,
    siteLongitude: site.siteLongitude,
    timezone: site.timezone,
    siteContactName: site.contactName,
    siteContactPhone: site.contactPhone,
    siteContactEmail: site.contactEmail,
    accessInformation: site.accessInformation,
    jobComments: planning.jobComments,
    inspectorName: identity.inspectorName,
    auditDate: identity.auditDate,
    status: 'Draft',
    createdByUserId: identity.createdByUserId,
    assignedInspectorUserId: identity.assignedInspectorUserId,
    treeRevision: 1,
    recordVersionNumber: 0,
    electricalMapLayout: null,
    electricalMapLayoutRevision: 0,
    electricalMapLayoutUpdatedAt: null,
    completedAt: null,
    completedByUserId: null,
    completedFromRevision: null,
    completionNotes: null,
    reopenedAt: null,
    reopenedByUserId: null,
    reopenedFromVersionNumber: null,
    reopenReason: null,
  }, ['externalKey']) as typeof ihInstallations.$inferInsert);

  if (gridSupplies.length > 0) {
    await executor.insert(ihGridSupplies).values(gridSupplies.map((row) => cloneRecordWithId(row, gridMap.get(row.id)!, {
      installationId,
      externalKey: null,
      nmi: row.isDefault && planning.nmi !== null ? planning.nmi : row.nmi,
    }, ['externalKey']) as typeof ihGridSupplies.$inferInsert));
  }
  if (zones.length > 0) {
    const values = zones.map((row) => cloneRecordWithId(row, zoneMap.get(row.id)!, {
      installationId,
    }) as typeof ihZones.$inferInsert);
    await executor.insert(ihZones).values(values);
    zones.forEach((row, index) => copiedEntities.push({
      sourceEntityId: row.id, targetEntityId: String(values[index].id), targetEntityType: 'zone',
      photoValues: [row.photos], photoReferences: installHubZonePhotoFieldReferences(row),
    }));
  }
  if (boards.length > 0) {
    const values = boards.map((row) => cloneRecordWithId(row, boardMap.get(row.id)!, {
      installationId,
      zoneId: mapped(zoneMap, row.zoneId),
      gridSupplyId: mapped(gridMap, row.gridSupplyId),
      electricalParentId: mapped(boardMap, row.electricalParentId),
    }) as typeof ihElectricalAssets.$inferInsert);
    await executor.insert(ihElectricalAssets).values(values);
    boards.forEach((row, index) => copiedEntities.push({
      sourceEntityId: row.id, targetEntityId: String(values[index].id), targetEntityType: 'electrical_asset',
      photoValues: [row.photo, row.extraPhotos, row.meters], photoReferences: installHubElectricalPhotoFieldReferences(row),
    }));
  }
  if (siteAssets.length > 0) {
    const values = siteAssets.map((row) => cloneRecordWithId(row, siteAssetMap.get(row.id)!, {
      installationId,
      zoneId: mapped(zoneMap, row.zoneId),
      gridSupplyId: mapped(gridMap, row.gridSupplyId),
      electricalBoardId: mapped(boardMap, row.electricalBoardId),
      meterSwitchboardId: mapped(boardMap, row.meterSwitchboardId),
      measurementAssignmentIds: row.measurementAssignmentIds.map((id) => assignmentMap.get(id) ?? id),
    }) as typeof ihSiteAssets.$inferInsert);
    await executor.insert(ihSiteAssets).values(values);
    siteAssets.forEach((row, index) => copiedEntities.push({
      sourceEntityId: row.id, targetEntityId: String(values[index].id), targetEntityType: 'site_asset',
      photoValues: [row.locationPhoto, row.extraPhotos], photoReferences: installHubSiteAssetPhotoFieldReferences(row),
    }));
  }
  if (meters.length > 0) {
    const values = meters.map((row) => cloneRecordWithId(row, meterMap.get(row.id)!, {
      installationId,
      installedOnBoardId: mapped(boardMap, row.installedOnBoardId),
    }) as typeof ihMeterDevices.$inferInsert);
    await executor.insert(ihMeterDevices).values(values);
    meters.forEach((row, index) => copiedEntities.push({
      sourceEntityId: row.id, targetEntityId: String(values[index].id), targetEntityType: 'meter_device',
      photoValues: [row.wwPhotos], photoReferences: installHubMeterPhotoFieldReferences(row),
    }));
  }
  if (channels.length > 0) {
    await executor.insert(ihMeterChannels).values(channels.map((row) => cloneRecordWithId(row, channelMap.get(row.id)!, {
      installationId, meterId: mapped(meterMap, row.meterId),
    }) as typeof ihMeterChannels.$inferInsert));
  }
  if (assignments.length > 0) {
    await executor.insert(ihMeasurementAssignments).values(assignments.map((row) => cloneRecordWithId(row, assignmentMap.get(row.id)!, {
      installationId,
      meterId: mapped(meterMap, row.meterId),
      targetBoardId: mapped(boardMap, row.targetBoardId),
      targetSiteAssetId: mapped(siteAssetMap, row.targetSiteAssetId),
      targetGridSupplyId: mapped(gridMap, row.targetGridSupplyId),
    }) as typeof ihMeasurementAssignments.$inferInsert));
  }
  if (assignmentChannels.length > 0) {
    await executor.insert(ihMeasurementAssignmentChannels).values(assignmentChannels.map((row) => ({
      ...row,
      id: assignmentChannelMap.get(row.id)!,
      installationId,
      assignmentId: assignmentMap.get(row.assignmentId) ?? row.assignmentId,
      meterId: meterMap.get(row.meterId) ?? row.meterId,
      channelId: channelMap.get(row.channelId) ?? row.channelId,
      createdAt: new Date(),
    })));
  }
  await linkCopiedPhotoReferences({
    app: 'installhub',
    sourceParentId: sourceInstallationId,
    targetParentId: installationId,
    entities: copiedEntities,
    executor: executor as typeof db,
  });
  await reconcilePhotoCopyReferencesForParent({
    app: 'installhub',
    parentId: installationId,
    executor: executor as typeof db,
  });
  return installationId;
}
