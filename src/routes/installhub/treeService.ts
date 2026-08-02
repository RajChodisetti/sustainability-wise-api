import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne, notInArray, or, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  ihDisplayCodeClaims,
  ihElectricalAssets,
  ihFormSubmissions,
  ihGridSupplies,
  ihInstallations,
  ihMeasurementAssignmentChannels,
  ihMeasurementAssignments,
  ihMeterChannels,
  ihMeterDevices,
  ihSiteAssets,
  ihZones,
} from '../../db/schema/installhub.js';
import { recordVersions } from '../../db/schema/shared.js';
import { AppError, conflict } from '../../utils/errors.js';
import {
  installHubElectricalPhotoFieldReferences,
  installHubFormPhotoFieldReferences,
  installHubMeterPhotoFieldReferences,
  installHubSiteAssetPhotoFieldReferences,
  installHubZonePhotoFieldReferences,
  collectImmutablePhotoIds,
  loadPhotosForParent,
  type CopiedPhotoEntity,
  type PhotoRow,
} from '../../storage/photoCopyReferences.js';
import {
  INSTALLATION_CANONICALIZER_VERSION,
  INSTALLATION_TAXONOMY_VERSION,
  INSTALLATION_VALIDATOR_VERSION,
  DISPLAY_CODE_RULE_VERSION,
  VIRTUAL_METER_FORMULA_VERSION,
  CanonicalInputError,
  allocateDisplayCodes,
  canonicalPayloadHash,
  canonicalOrderInstallationTree,
  deriveVirtualMeterDefinitions,
  installationReadiness,
  normalizeInstallationTreeV2,
  stableStringify,
  type CanonicalBoard,
  type CanonicalFormSubmission,
  type CanonicalInstallationTree,
  type CanonicalSiteAsset,
  type DisplayCodeClaim,
  type ElectricalSource,
  type MeasurementAssignment,
  type MeterDevice,
  type ReadinessIssue,
} from './canonical.js';
import {
  INSTALLATION_CONTROLLED_LABEL_CATALOG,
  buildAllAssetsView,
  buildElectricalTreeView,
  buildInstallationMappingExport,
  buildMeteringView,
} from './canonicalViews.js';
import { validateInstallHubFormContract } from './formContract.js';
import { classifyLegacyMeterLoadType } from './legacyBackfill.js';

// Drizzle transactions expose the same query builder surface used here. This
// narrow structural type keeps every lifecycle write on the caller's tx.
export type InstallHubExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sourceFromRows(input: {
  sourceKind: string;
  gridSupplyId: string | null;
  parentBoardId: string | null;
}): ElectricalSource {
  if (input.sourceKind === 'GRID' && input.gridSupplyId) {
    return { kind: 'GRID', gridSupplyId: input.gridSupplyId };
  }
  if (input.sourceKind === 'BOARD' && input.parentBoardId) {
    return { kind: 'BOARD', boardId: input.parentBoardId };
  }
  return { kind: 'TBC' };
}

function targetFromRow(row: typeof ihMeasurementAssignments.$inferSelect): MeasurementAssignment['target'] {
  if (row.targetKind === 'BOARD' && row.targetBoardId) {
    return { kind: 'BOARD', boardId: row.targetBoardId };
  }
  if (row.targetKind === 'SITE_ASSET' && row.targetSiteAssetId) {
    return { kind: 'SITE_ASSET', siteAssetId: row.targetSiteAssetId };
  }
  if (row.targetKind === 'GRID_BOUNDARY' && row.targetGridSupplyId) {
    return { kind: 'GRID_BOUNDARY', gridSupplyId: row.targetGridSupplyId };
  }
  return { kind: 'TBC' };
}

export async function loadCanonicalInstallationTree(
  installationId: string,
  executor: InstallHubExecutor = db,
  includeDeleted = false,
): Promise<CanonicalInstallationTree | null> {
  const [installation] = await executor
    .select()
    .from(ihInstallations)
    .where(includeDeleted
      ? eq(ihInstallations.id, installationId)
      : and(eq(ihInstallations.id, installationId), isNull(ihInstallations.deletedAt)));
  if (!installation) return null;
  const active = <T extends { installationId: unknown; deletedAt: unknown }>(
    table: T,
  ) => includeDeleted
    ? eq(table.installationId as never, installationId)
    : and(
        eq(table.installationId as never, installationId),
        isNull(table.deletedAt as never),
      );

  const [
    gridRows,
    zoneRows,
    boardRows,
    assetRows,
    meterRows,
    channelRows,
    assignmentRows,
    assignmentChannelRows,
    formRows,
  ] = await Promise.all([
    executor.select().from(ihGridSupplies).where(active(ihGridSupplies)),
    executor.select().from(ihZones).where(active(ihZones)),
    executor.select().from(ihElectricalAssets).where(active(ihElectricalAssets)),
    executor.select().from(ihSiteAssets).where(active(ihSiteAssets)),
    executor.select().from(ihMeterDevices).where(active(ihMeterDevices)),
    executor.select().from(ihMeterChannels).where(active(ihMeterChannels)),
    executor.select().from(ihMeasurementAssignments).where(active(ihMeasurementAssignments)),
    executor.select().from(ihMeasurementAssignmentChannels)
      .where(eq(ihMeasurementAssignmentChannels.installationId, installationId)),
    executor.select().from(ihFormSubmissions).where(active(ihFormSubmissions)),
  ]);

  const channelsByMeter = new Map<string, typeof channelRows>();
  for (const channel of channelRows) {
    const channels = channelsByMeter.get(channel.meterId) ?? [];
    channels.push(channel);
    channelsByMeter.set(channel.meterId, channels);
  }
  const channelIdsByAssignment = new Map<string, typeof assignmentChannelRows>();
  for (const row of assignmentChannelRows) {
    const rows = channelIdsByAssignment.get(row.assignmentId) ?? [];
    rows.push(row);
    channelIdsByAssignment.set(row.assignmentId, rows);
  }

  const tree: CanonicalInstallationTree = {
    treeSchemaVersion: 2,
    installation: {
      id: installation.id,
      externalKey: installation.externalKey,
      siteCode: installation.siteCode,
      timezone: installation.timezone,
      clientName: installation.clientName,
      siteName: installation.siteName,
      siteAddress: installation.siteAddress,
      inspectorName: installation.inspectorName,
      auditDate: installation.auditDate,
      status: installation.status === 'Completed' ? 'Completed' : 'Draft',
      treeSchemaVersion: 2,
      treeRevision: installation.treeRevision,
      recordVersionNumber: installation.recordVersionNumber,
      createdByUserId: installation.createdByUserId,
      assignedInspectorUserId: installation.assignedInspectorUserId,
      completedAt: iso(installation.completedAt),
      completedByUserId: installation.completedByUserId,
      completedFromRevision: installation.completedFromRevision,
      reopenedAt: iso(installation.reopenedAt),
      reopenedByUserId: installation.reopenedByUserId,
      reopenedFromVersionNumber: installation.reopenedFromVersionNumber,
      reopenReason: installation.reopenReason,
      createdAt: iso(installation.createdAt),
      updatedAt: iso(installation.updatedAt),
      deletedAt: iso(installation.deletedAt),
    },
    gridSupplies: gridRows.map((row) => ({
      id: row.id,
      installationId: row.installationId,
      name: row.name,
      isDefault: row.isDefault,
      nmi: row.nmi,
      externalKey: row.externalKey,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    zones: zoneRows.map((row) => ({
      id: row.id,
      installationId: row.installationId,
      zoneName: row.zoneName,
      zoneDescription: row.zoneDescription,
      photos: row.photos,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    electricalAssets: boardRows.map((row): CanonicalBoard => ({
      id: row.id,
      installationId: row.installationId,
      zoneId: row.zoneId,
      assetName: row.assetName,
      typeCode: row.typeCode as CanonicalBoard['typeCode'],
      customTypeName: row.customTypeName,
      displayCode: {
        value: row.displayCode,
        generatedValue: row.generatedDisplayCode ?? row.displayCode,
        isOverridden: row.displayCodeOverridden,
        ruleVersion: row.displayCodeRuleVersion,
        ...(row.displayCodeOverrideReason ? { overrideReason: row.displayCodeOverrideReason } : {}),
      },
      electricalSource: sourceFromRows({
        sourceKind: row.sourceKind,
        gridSupplyId: row.gridSupplyId,
        parentBoardId: row.electricalParentId,
      }),
      locationDescription: row.locationDescription,
      phase: row.phase,
      amperageRating: row.amperageRating,
      siteNmi: row.siteNmi,
      photo: row.photo,
      extraPhotos: row.extraPhotos,
      meterPresent: row.meterPresent,
      subCircuitsDescription: row.subCircuitsDescription,
      comments: row.comments,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    siteAssets: assetRows.map((row): CanonicalSiteAsset => ({
      id: row.id,
      installationId: row.installationId,
      zoneId: row.zoneId,
      assetName: row.assetName,
      typeCode: row.typeCode as CanonicalSiteAsset['typeCode'],
      customTypeName: row.customTypeName,
      displayCode: {
        value: row.displayCode ?? '',
        generatedValue: row.generatedDisplayCode ?? row.displayCode ?? '',
        isOverridden: row.displayCodeOverridden,
        ruleVersion: row.displayCodeRuleVersion,
        ...(row.displayCodeOverrideReason ? { overrideReason: row.displayCodeOverrideReason } : {}),
      },
      electricalSource: sourceFromRows({
        sourceKind: row.sourceKind,
        gridSupplyId: row.gridSupplyId,
        parentBoardId: row.electricalBoardId,
      }),
      meteringState: row.meteringStateKind === 'METERED'
        ? { kind: 'METERED', measurementAssignmentIds: row.measurementAssignmentIds }
        : row.meteringStateKind === 'UNMETERED'
          ? { kind: 'UNMETERED' }
          : { kind: 'TBC' },
      locationDescription: row.locationDescription,
      locationPhoto: row.locationPhoto,
      meterPresent: row.meterPresent,
      comments: row.comments,
      extraPhotos: row.extraPhotos,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    meterDevices: meterRows.map((row): MeterDevice => ({
      id: row.id,
      installationId: row.installationId,
      installedOnBoardId: row.installedOnBoardId,
      deviceFamily: row.deviceFamily as MeterDevice['deviceFamily'],
      deviceModel: row.deviceModel as MeterDevice['deviceModel'],
      customManufacturerName: row.customManufacturerName,
      customModelName: row.customModelName,
      deviceNumber: row.deviceNumber,
      serialNumber: row.serialNumber,
      displayName: {
        value: row.displayCode ?? row.deviceNumber ?? row.serialNumber,
        generatedValue: row.generatedDisplayCode ?? row.displayCode ?? row.deviceNumber ?? row.serialNumber,
        isOverridden: row.displayCodeOverridden,
        ruleVersion: row.displayCodeRuleVersion,
        ...(row.displayCodeOverrideReason ? { overrideReason: row.displayCodeOverrideReason } : {}),
      },
      channels: (channelsByMeter.get(row.id) ?? []).map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        phaseLabel: channel.phaseLabel,
        purpose: channel.purpose as MeterDevice['channels'][number]['purpose'],
        loadTypeCode: channel.loadTypeCode as MeterDevice['channels'][number]['loadTypeCode'],
        customLoadTypeName: channel.customLoadTypeName,
        sensorRating: channel.sensorRating,
        description: channel.description,
        capabilities: channel.capabilities,
        createdAt: iso(channel.createdAt),
        updatedAt: iso(channel.updatedAt),
        deletedAt: iso(channel.deletedAt),
      })).sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)),
      commissioningData: row.commissioningData as MeterDevice['commissioningData'] ?? undefined,
      wwPhotos: row.wwPhotos,
      notes: row.notes,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    measurementAssignments: assignmentRows.map((row): MeasurementAssignment => ({
      id: row.id,
      installationId: row.installationId,
      meterId: row.meterId,
      channelIds: (channelIdsByAssignment.get(row.id) ?? [])
        .sort((left, right) => left.position - right.position)
        .map((item) => item.channelId),
      phaseMode: row.phaseMode as MeasurementAssignment['phaseMode'],
      target: targetFromRow(row),
      direction: row.direction as MeasurementAssignment['direction'],
      status: row.status as MeasurementAssignment['status'],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    formSubmissions: formRows.map((row): CanonicalFormSubmission => ({
      id: row.id,
      installationId: row.installationId,
      formType: row.formType,
      schemaVersion: row.schemaVersion,
      status: row.status,
      zoneId: row.zoneId,
      boardId: row.boardId,
      meterId: row.meterId,
      siteAssetId: row.siteAssetId,
      answers: row.answers,
      attachments: row.attachments,
      completedAt: iso(row.completedAt),
      supersedesId: row.supersedesId,
      historicalMeterRemoved: row.historicalMeterRemoved,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      deletedAt: iso(row.deletedAt),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    serverDerived: { virtualMeterDefinitions: [] },
  };
  tree.serverDerived.virtualMeterDefinitions = deriveVirtualMeterDefinitions(tree);
  return tree;
}

function boardTypeLabel(code: string, custom: string | null | undefined): string {
  return custom ?? ({
    MSB: 'MSB',
    MSSB: 'MSSB',
    DB: 'DB',
    HVAC_DB: 'HVAC-DB',
    LX_DB: 'LX-DB',
    PV_DB: 'PV-DB',
    MCC: 'MCC',
  }[code] ?? 'Other');
}

function assetTypeLabel(code: string, custom: string | null | undefined): string {
  return custom ?? ({
    PV: 'Solar / PV',
    HVAC: 'HVAC',
    LIGHTING: 'Lighting',
    EV_CHARGER: 'EV Charger',
    VEHICLE_HOIST: 'Vehicle Hoist',
    FORKLIFT: 'Forklift',
    EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
    POWER_OUTLET: 'Power Outlet',
    HEATER_GEYSER: 'Heater / Geyser',
  }[code] ?? 'Other');
}

const METER_LOAD_TYPE_LABEL_BY_CODE: Record<string, string> = {
  PV: 'Solar PV',
  HVAC: 'HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Vehicle Hoist',
  FORKLIFT: 'Forklift Charger',
  EXHAUST_FAN_SYSTEM: 'Exhaust Fan System',
  POWER_OUTLET: 'General Power',
  HEATER_GEYSER: 'Hot Water',
};

function meterChannelLoadTypeLabel(channel: MeterDevice['channels'][number]): string {
  if (channel.purpose === 'MAIN_SUPPLY') return 'Mains Supply';
  if (channel.purpose === 'SPARE') return 'Not Used';
  if (channel.loadTypeCode === 'OTHER') return channel.customLoadTypeName?.trim() || 'Other';
  return METER_LOAD_TYPE_LABEL_BY_CODE[channel.loadTypeCode ?? ''] ?? 'Not Used';
}

/**
 * Schema-v1 compatibility view. Canonical tables remain the sole v2 write
 * authority; array order is deterministic and never used as meter identity.
 */
export function projectLegacyInstallationTree(tree: CanonicalInstallationTree) {
  const metersByBoard = new Map<string, MeterDevice[]>();
  for (const meter of tree.meterDevices) {
    const meters = metersByBoard.get(meter.installedOnBoardId) ?? [];
    meters.push(meter);
    metersByBoard.set(meter.installedOnBoardId, meters);
  }
  return {
    treeSchemaVersion: 2,
    treeRevision: tree.installation.treeRevision,
    recordVersionNumber: tree.installation.recordVersionNumber,
    installation: tree.installation,
    gridSupplies: tree.gridSupplies,
    zones: tree.zones,
    electricalAssets: tree.electricalAssets.map((board) => ({
      ...board,
      assetType: boardTypeLabel(board.typeCode, board.customTypeName),
      displayCodeMeta: board.displayCode,
      displayCode: board.displayCode.value,
      electricalParentId: board.electricalSource.kind === 'BOARD' ? board.electricalSource.boardId : null,
      electricalParentTbc: board.electricalSource.kind === 'TBC',
      gridSupplyId: board.electricalSource.kind === 'GRID' ? board.electricalSource.gridSupplyId : null,
      sourceKind: board.electricalSource.kind,
      meters: (metersByBoard.get(board.id) ?? [])
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((meter) => ({
          id: meter.id,
          deviceName: meter.displayName.value,
          deviceType: meter.deviceModel === 'OTHER' ? 'Other' : meter.deviceModel,
          deviceId: meter.serialNumber,
          deviceNumber: meter.deviceNumber,
          deviceFamily: meter.deviceFamily,
          customManufacturerName: meter.customManufacturerName,
          customModelName: meter.customModelName,
          displayName: meter.displayName,
          deviceNameOverridden: meter.displayName.isOverridden,
          classification: meter.commissioningData?.classification ?? null,
          coverage: meter.commissioningData?.coverage ?? null,
          wwPrestart: meter.commissioningData?.prestart ?? {},
          wwSwitchboard: meter.commissioningData?.switchboard ?? {},
          wwVerification: meter.commissioningData?.verification ?? {},
          wwCommissioning: meter.commissioningData?.commissioning ?? {},
          notes: meter.notes,
          wwChannels: meter.channels.map((channel) => ({
            id: channel.id,
            ordinal: channel.ordinal,
            purpose: channel.purpose,
            phaseLabel: channel.phaseLabel,
            loadType: meterChannelLoadTypeLabel(channel),
            customLoadTypeName: channel.customLoadTypeName,
            rogowskiSize: channel.sensorRating,
            description: channel.description,
            capabilities: channel.capabilities,
          })),
          wwPhotos: meter.wwPhotos ?? {},
        })),
    })),
    siteAssets: tree.siteAssets.map((asset) => ({
      ...asset,
      assetType: assetTypeLabel(asset.typeCode, asset.customTypeName),
      displayCodeMeta: asset.displayCode,
      displayCode: asset.displayCode.value,
      electricalBoardId: asset.electricalSource.kind === 'BOARD' ? asset.electricalSource.boardId : null,
      electricalBoardTbc: asset.electricalSource.kind === 'TBC',
      gridSupplyId: asset.electricalSource.kind === 'GRID' ? asset.electricalSource.gridSupplyId : null,
      sourceKind: asset.electricalSource.kind,
      meteringStateKind: asset.meteringState.kind,
      measurementAssignmentIds: asset.meteringState.kind === 'METERED'
        ? asset.meteringState.measurementAssignmentIds
        : [],
    })),
    meterDevices: tree.meterDevices,
    measurementAssignments: tree.measurementAssignments,
    formSubmissions: tree.formSubmissions,
    serverDerived: tree.serverDerived,
  };
}

function formFingerprint(form: CanonicalFormSubmission): string {
  return stableStringify({
    formType: form.formType,
    schemaVersion: form.schemaVersion,
    status: form.status,
    zoneId: form.zoneId ?? null,
    boardId: form.boardId ?? null,
    meterId: form.meterId ?? null,
    siteAssetId: form.siteAssetId ?? null,
    answers: form.answers,
    attachments: form.attachments,
    completedAt: form.completedAt ?? null,
    supersedesId: form.supersedesId ?? null,
  });
}

function retainedFormFingerprint(form: CanonicalFormSubmission): string {
  const attachments = form.attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return attachment;
    const record = structuredClone(attachment as Record<string, unknown>);
    if (typeof record.uri === 'string') {
      const ids = [...collectImmutablePhotoIds(record.uri)];
      if (ids.length === 1) record.uri = `urn:installhub:photo:${ids[0]}`;
    }
    return record;
  });
  return stableStringify({
    formType: form.formType,
    schemaVersion: form.schemaVersion,
    status: form.status,
    zoneId: form.zoneId ?? null,
    boardId: form.boardId ?? null,
    meterId: form.meterId ?? null,
    siteAssetId: form.siteAssetId ?? null,
    answers: form.answers,
    attachments,
    completedAt: form.completedAt ?? null,
    supersedesId: form.supersedesId ?? null,
  });
}

export function assertCompletedFormsImmutable(input: {
  existing: CanonicalFormSubmission[];
  incoming: CanonicalFormSubmission[];
  allowOmittedFormIds?: ReadonlySet<string>;
}): void {
  const incomingById = new Map(input.incoming.map((form) => [form.id, form]));
  for (const existing of input.existing) {
    if (existing.status !== 'Completed') continue;
    const incoming = incomingById.get(existing.id);
    if (!incoming && input.allowOmittedFormIds?.has(existing.id)) continue;
    if (!incoming || formFingerprint(existing) !== formFingerprint(incoming)) {
      throw new Error(`COMPLETED_FORM_IMMUTABLE:${existing.id}`);
    }
  }
}

/**
 * Mobile metadata intentionally stages every local Completed form as Draft so
 * only the final pass can commission a new form. Once that exact form is
 * already immutable on the server, restore the existing Completed row when
 * all other retained semantics match. Any changed answer, link, or evidence
 * remains Draft and is rejected by the immutable-form fence below.
 */
export function retainCompletedFormsDuringMetadata(input: {
  existing: CanonicalFormSubmission[];
  incoming: CanonicalFormSubmission[];
}): CanonicalFormSubmission[] {
  const existingById = new Map(input.existing.map((form) => [form.id, form]));
  return input.incoming.map((form) => {
    const existing = existingById.get(form.id);
    if (!existing || existing.status !== 'Completed' || form.status !== 'Draft') {
      return form;
    }
    const restored: CanonicalFormSubmission = {
      ...form,
      status: 'Completed',
      completedAt: existing.completedAt,
    };
    return retainedFormFingerprint(existing) === retainedFormFingerprint(restored)
      ? existing
      : form;
  });
}

function commissionedMeterFingerprint(meter: MeterDevice | undefined): string {
  if (!meter) return 'deleted';
  return stableStringify({
    deviceFamily: meter.deviceFamily,
    deviceModel: meter.deviceModel,
    customManufacturerName: meter.customManufacturerName ?? null,
    customModelName: meter.customModelName ?? null,
    deviceNumber: meter.deviceNumber ?? null,
    serialNumber: meter.serialNumber,
    channels: meter.channels.map((channel) => ({
      id: channel.id,
      ordinal: channel.ordinal,
      phaseLabel: channel.phaseLabel ?? null,
      purpose: channel.purpose,
      loadTypeCode: channel.loadTypeCode ?? null,
      customLoadTypeName: channel.customLoadTypeName ?? null,
      sensorRating: channel.sensorRating ?? null,
      capabilities: channel.capabilities ?? {},
    })).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

const WW_LOAD_TYPE_CODES: Record<string, MeterDevice['channels'][number]['loadTypeCode']> = {
  HVAC: 'HVAC',
  Lighting: 'LIGHTING',
  'Solar PV': 'PV',
  'Forklift Charger': 'FORKLIFT',
  'Hot Water': 'HEATER_GEYSER',
  'General Power': 'POWER_OUTLET',
};

const WW_CHANNEL_PURPOSE_BY_FORM_VALUE: Readonly<
  Record<string, MeterDevice['channels'][number]['purpose']>
> = {
  'Main board supply': 'MAIN_SUPPLY',
  'Sub-circuit / asset': 'SUB_CIRCUIT',
  'Spare / unused': 'SPARE',
};

/** Shared server mapper/guard for WW commissioning answers → meter identity. */
export function wwCommissioningFormMatchesMeter(
  form: CanonicalFormSubmission,
  meter: MeterDevice | undefined,
): boolean {
  if (!meter || form.formType !== 'ww-installation' || form.status !== 'Completed') return false;
  const model = form.answers['device.type'];
  if ((model !== 'A3RM' && model !== 'A6M') || meter.deviceModel !== model) return false;
  if (meter.deviceFamily !== 'WATTWATCHERS') return false;
  if (meter.deviceNumber !== (form.answers['device.number'] || null)) return false;
  if (meter.serialNumber !== form.answers['device.id']) return false;
  const channelCount = model === 'A3RM' ? 3 : 6;
  if (meter.channels.length !== channelCount) return false;
  for (let ordinal = 1; ordinal <= channelCount; ordinal += 1) {
    const channel = meter.channels.find((item) => item.ordinal === ordinal);
    if (!channel) return false;
    const load = form.answers[`channel.${ordinal}.load`];
    const purposeAnswer = form.answers[`channel.${ordinal}.purpose`];
    const expectedPurpose = purposeAnswer
      ? WW_CHANNEL_PURPOSE_BY_FORM_VALUE[purposeAnswer]
      : load === 'Not Used'
        ? 'SPARE'
        : load === 'Mains Supply'
          ? 'MAIN_SUPPLY'
          : 'SUB_CIRCUIT';
    if (!expectedPurpose) return false;
    if (channel.purpose !== expectedPurpose) return false;
    const customLoadKey = `channel.${ordinal}.custom_load_type`;
    const hasCurrentCustomLoad = Object.prototype.hasOwnProperty.call(
      form.answers,
      customLoadKey,
    );
    const customLoadLabel = load === 'Other'
      ? hasCurrentCustomLoad
        ? form.answers[customLoadKey]?.trim() || null
        : form.answers[`channel.${ordinal}.description`]?.trim() || load
      : null;
    if (load === 'Other' && !customLoadLabel) return false;
    const classifiedCustomLoad = load === 'Other'
      ? classifyLegacyMeterLoadType(customLoadLabel)
      : null;
    const expectedLoadType = expectedPurpose === 'SUB_CIRCUIT'
      ? classifiedCustomLoad?.code ?? WW_LOAD_TYPE_CODES[load] ?? 'OTHER'
      : null;
    if ((channel.loadTypeCode ?? null) !== expectedLoadType) return false;
    const expectedCustom = expectedPurpose === 'SUB_CIRCUIT'
      ? classifiedCustomLoad?.custom ?? null
      : null;
    if ((channel.customLoadTypeName ?? null) !== expectedCustom) return false;
    const expectedRating = expectedPurpose === 'SPARE'
      ? null
      : form.answers[`channel.${ordinal}.rating`] || null;
    if ((channel.sensorRating ?? null) !== expectedRating) return false;
  }
  return true;
}

/**
 * Commissioning evidence owns meter identity/channel configuration. Labels,
 * notes and photos remain operationally editable; identity changes require a
 * completed amendment linked to the latest completed WW form.
 */
export function assertCommissionedMetersRequireAmendment(input: {
  existing: CanonicalInstallationTree;
  incoming: CanonicalInstallationTree;
  allowRemovedMeterIds?: ReadonlySet<string>;
}): void {
  const incomingMeters = new Map(input.incoming.meterDevices.map((meter) => [meter.id, meter]));
  const completedByMeter = new Map<string, CanonicalFormSubmission[]>();
  for (const form of input.existing.formSubmissions) {
    if (form.formType !== 'ww-installation' || form.status !== 'Completed' || !form.meterId) continue;
    const forms = completedByMeter.get(form.meterId) ?? [];
    forms.push(form);
    completedByMeter.set(form.meterId, forms);
  }
  for (const [meterId, forms] of completedByMeter) {
    const existingMeter = input.existing.meterDevices.find((meter) => meter.id === meterId);
    if (
      commissionedMeterFingerprint(existingMeter)
      === commissionedMeterFingerprint(incomingMeters.get(meterId))
    ) continue;
    if (!incomingMeters.has(meterId) && input.allowRemovedMeterIds?.has(meterId)) continue;
    const latest = [...forms].sort((left, right) => (
      `${left.completedAt ?? left.createdAt ?? ''}:${left.id}`
        .localeCompare(`${right.completedAt ?? right.createdAt ?? ''}:${right.id}`)
    )).at(-1)!;
    const amendment = input.incoming.formSubmissions.some((form) => (
      form.id !== latest.id
      && form.formType === 'ww-installation'
      && form.status === 'Completed'
      && form.meterId === meterId
      && form.supersedesId === latest.id
      && wwCommissioningFormMatchesMeter(form, incomingMeters.get(meterId))
    ));
    if (!amendment) throw new Error(`WW_METER_AMENDMENT_REQUIRED:${meterId}`);
  }
}

async function retainedCommissioningRemoval(input: {
  installationId: string;
  existing: CanonicalInstallationTree;
  incoming: CanonicalInstallationTree;
  executor: InstallHubExecutor;
  allowedMeterIds: ReadonlySet<string>;
}): Promise<{ meterIds: Set<string>; formIds: Set<string> }> {
  const incomingMeterIds = new Set(input.incoming.meterDevices.map((meter) => meter.id));
  const removedMeters = input.existing.meterDevices.filter((meter) => (
    !incomingMeterIds.has(meter.id) && input.allowedMeterIds.has(meter.id)
  ));
  if (!removedMeters.length) return { meterIds: new Set(), formIds: new Set() };
  const commissionedForms = input.existing.formSubmissions.filter((form) => (
    form.formType === 'ww-installation'
    && form.status === 'Completed'
    && form.meterId
    && removedMeters.some((meter) => meter.id === form.meterId)
  ));
  if (!commissionedForms.length) return { meterIds: new Set(), formIds: new Set() };
  const versions = await input.executor.select({ snapshot: recordVersions.snapshot })
    .from(recordVersions)
    .where(and(
      eq(recordVersions.app, 'installhub'),
      eq(recordVersions.entityType, 'installation'),
      eq(recordVersions.entityId, input.installationId),
    ));
  const retainedMeterIds = new Set<string>();
  const retainedFormIds = new Set<string>();
  for (const meter of removedMeters) {
    const forms = commissionedForms.filter((form) => form.meterId === meter.id);
    const retained = versions.some(({ snapshot }) => {
      if (!snapshot || typeof snapshot !== 'object') return false;
      const tree = (snapshot as { installationTree?: CanonicalInstallationTree }).installationTree;
      if (!tree) return false;
      const pinnedMeter = tree.meterDevices?.find((item) => item.id === meter.id);
      if (commissionedMeterFingerprint(pinnedMeter) !== commissionedMeterFingerprint(meter)) return false;
      return forms.every((form) => {
        const pinnedForm = tree.formSubmissions?.find((item) => item.id === form.id);
        return Boolean(
          pinnedForm
          && retainedFormFingerprint(pinnedForm) === retainedFormFingerprint(form)
        );
      });
    });
    if (!retained) continue;
    retainedMeterIds.add(meter.id);
    forms.forEach((form) => retainedFormIds.add(form.id));
  }
  return { meterIds: retainedMeterIds, formIds: retainedFormIds };
}

async function existingDisplayCodeClaims(
  installationId: string,
  executor: InstallHubExecutor,
): Promise<DisplayCodeClaim[]> {
  const rows = await executor.select().from(ihDisplayCodeClaims)
    .where(eq(ihDisplayCodeClaims.installationId, installationId));
  return rows.map((row) => ({
    entityType: row.entityType as DisplayCodeClaim['entityType'],
    entityId: row.entityId,
    typeCode: row.typeCode,
    sequence: row.sequence,
    displayCode: row.displayCode,
    normalizedDisplayCode: row.normalizedDisplayCode,
    generated: row.generated,
    ruleVersion: row.ruleVersion,
  }));
}

async function softDeleteOmitted(
  executor: InstallHubExecutor,
  table: typeof ihGridSupplies
    | typeof ihZones
    | typeof ihElectricalAssets
    | typeof ihSiteAssets
    | typeof ihMeterDevices
    | typeof ihMeterChannels
    | typeof ihMeasurementAssignments
    | typeof ihFormSubmissions,
  installationId: string,
  ids: string[],
  now: Date,
): Promise<void> {
  await executor.update(table as never).set({
    deletedAt: now,
    updatedAt: now,
    syncStatus: 'synced',
  } as never).where(
    ids.length
      ? and(
          eq((table as typeof ihGridSupplies).installationId, installationId),
          notInArray((table as typeof ihGridSupplies).id, ids),
        )
      : eq((table as typeof ihGridSupplies).installationId, installationId),
  );
}

type InstallationOwnedCanonicalTable = typeof ihGridSupplies
  | typeof ihZones
  | typeof ihElectricalAssets
  | typeof ihSiteAssets
  | typeof ihMeterDevices
  | typeof ihMeterChannels
  | typeof ihMeasurementAssignments
  | typeof ihMeasurementAssignmentChannels
  | typeof ihFormSubmissions;

async function assertTableIdsOwnedByInstallation(input: {
  executor: InstallHubExecutor;
  table: InstallationOwnedCanonicalTable;
  installationId: string;
  ids: string[];
}): Promise<void> {
  const ids = [...new Set(input.ids)];
  if (!ids.length) return;
  const table = input.table as typeof ihGridSupplies;
  const [collision] = await input.executor
    .select({ id: table.id })
    .from(input.table as never)
    .where(and(
      inArray(table.id, ids),
      ne(table.installationId, input.installationId),
    ))
    .limit(1);
  if (collision) throw conflict('canonical_child_id_conflict');
}

/** Transaction-scoped fail-closed ownership preflight before any child write. */
export async function assertCanonicalChildOwnership(input: {
  executor: InstallHubExecutor;
  tree: CanonicalInstallationTree;
}): Promise<void> {
  const { executor, tree } = input;
  const installationId = tree.installation.id;
  const channelIds = tree.meterDevices.flatMap((meter) => (
    meter.channels.map((channel) => channel.id)
  ));
  const assignmentChannelIds = tree.measurementAssignments.flatMap((assignment) => (
    assignment.channelIds.map((channelId) => `${assignment.id}:${channelId}`)
  ));
  const checks: Array<[InstallationOwnedCanonicalTable, string[]]> = [
    [ihGridSupplies, tree.gridSupplies.map((item) => item.id)],
    [ihZones, tree.zones.map((item) => item.id)],
    [ihElectricalAssets, tree.electricalAssets.map((item) => item.id)],
    [ihSiteAssets, tree.siteAssets.map((item) => item.id)],
    [ihMeterDevices, tree.meterDevices.map((item) => item.id)],
    [ihMeterChannels, channelIds],
    [ihMeasurementAssignments, tree.measurementAssignments.map((item) => item.id)],
    [ihMeasurementAssignmentChannels, assignmentChannelIds],
    [ihFormSubmissions, tree.formSubmissions.map((item) => item.id)],
  ];
  for (const [table, ids] of checks) {
    await assertTableIdsOwnedByInstallation({ executor, table, installationId, ids });
  }

  const displayEntityConditions: SQL[] = [];
  const boardIds = tree.electricalAssets.map((item) => item.id);
  const siteAssetIds = tree.siteAssets.map((item) => item.id);
  const meterIds = tree.meterDevices.map((item) => item.id);
  if (boardIds.length) {
    displayEntityConditions.push(and(
      eq(ihDisplayCodeClaims.entityType, 'board'),
      inArray(ihDisplayCodeClaims.entityId, boardIds),
    )!);
  }
  if (siteAssetIds.length) {
    displayEntityConditions.push(and(
      eq(ihDisplayCodeClaims.entityType, 'site_asset'),
      inArray(ihDisplayCodeClaims.entityId, siteAssetIds),
    )!);
  }
  if (meterIds.length) {
    displayEntityConditions.push(and(
      eq(ihDisplayCodeClaims.entityType, 'meter'),
      inArray(ihDisplayCodeClaims.entityId, meterIds),
    )!);
  }
  if (displayEntityConditions.length) {
    const [claimCollision] = await executor
      .select({ id: ihDisplayCodeClaims.id })
      .from(ihDisplayCodeClaims)
      .where(and(
        ne(ihDisplayCodeClaims.installationId, installationId),
        or(...displayEntityConditions),
      ))
      .limit(1);
    if (claimCollision) throw conflict('canonical_child_id_conflict');
  }
}

export type ReplaceCanonicalInstallationChildrenInput = {
  executor: InstallHubExecutor;
  tree: CanonicalInstallationTree;
  now?: Date;
  commissionedMeterRemovalIds?: ReadonlySet<string>;
};

async function replaceCanonicalInstallationChildrenUnchecked(
  input: ReplaceCanonicalInstallationChildrenInput,
): Promise<void> {
  const { executor, tree } = input;
  const now = input.now ?? new Date();
  const installationId = tree.installation.id;
  await assertCanonicalChildOwnership({ executor, tree });
  const existingTree = await loadCanonicalInstallationTree(installationId, executor);
  const historicalFormIds = new Set(
    existingTree?.formSubmissions
      .filter((form) => form.historicalMeterRemoved)
      .map((form) => form.id) ?? [],
  );
  for (const form of tree.formSubmissions) {
    if (form.historicalMeterRemoved && !historicalFormIds.has(form.id)) {
      throw new CanonicalInputError(
        `Form ${form.id} cannot set server-owned historicalMeterRemoved`,
      );
    }
  }
  if (existingTree) {
    const removal = await retainedCommissioningRemoval({
      installationId,
      existing: existingTree,
      incoming: tree,
      executor,
      allowedMeterIds: input.commissionedMeterRemovalIds ?? new Set(),
    });
    const removedCommissionedIds = new Set(
      existingTree.meterDevices
        .filter((meter) => !tree.meterDevices.some((item) => item.id === meter.id))
        .filter((meter) => existingTree.formSubmissions.some((form) => (
          form.formType === 'ww-installation'
          && form.status === 'Completed'
          && form.meterId === meter.id
        )))
        .map((meter) => meter.id),
    );
    for (const meterId of removedCommissionedIds) {
      if (!removal.meterIds.has(meterId)) {
        throw conflict(`WW_METER_REMOVAL_VERSION_REQUIRED:${meterId}`);
      }
    }
    removal.formIds.forEach((formId) => historicalFormIds.add(formId));
    const removedAssignmentIds = new Set(existingTree.measurementAssignments
      .filter((assignment) => removal.meterIds.has(assignment.meterId))
      .map((assignment) => assignment.id));
    for (const asset of tree.siteAssets) {
      if (
        asset.meteringState.kind === 'METERED'
        && asset.meteringState.measurementAssignmentIds.some((id) => removedAssignmentIds.has(id))
      ) {
        asset.meteringState = { kind: 'TBC' };
        asset.meterPresent = false;
      }
    }
    assertCompletedFormsImmutable({
      existing: existingTree.formSubmissions,
      incoming: tree.formSubmissions,
    });
    assertCommissionedMetersRequireAmendment({
      existing: existingTree,
      incoming: tree,
      allowRemovedMeterIds: removal.meterIds,
    });
  }

  const priorClaims = await existingDisplayCodeClaims(installationId, executor);
  const newClaims = allocateDisplayCodes({ tree, existingClaims: priorClaims });
  if (newClaims.length) {
    await executor.insert(ihDisplayCodeClaims).values(newClaims.map((claim) => ({
      id: randomUUID(),
      installationId,
      entityType: claim.entityType,
      entityId: claim.entityId,
      typeCode: claim.typeCode,
      sequence: claim.sequence,
      displayCode: claim.displayCode,
      normalizedDisplayCode: claim.normalizedDisplayCode,
      generated: claim.generated,
      ruleVersion: claim.ruleVersion,
    })));
  }

  for (const supply of tree.gridSupplies) {
    const values = {
      id: supply.id,
      installationId,
      name: supply.name,
      isDefault: supply.isDefault,
      nmi: supply.nmi ?? null,
      externalKey: supply.externalKey ?? null,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: supply.createdAt ? new Date(supply.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihGridSupplies).values(values).onConflictDoUpdate({
      target: ihGridSupplies.id,
      set: update,
    });
  }
  for (const zone of tree.zones) {
    const values = {
      id: zone.id,
      installationId,
      zoneName: zone.zoneName,
      zoneDescription: zone.zoneDescription,
      photos: zone.photos,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: zone.createdAt ? new Date(zone.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihZones).values(values).onConflictDoUpdate({ target: ihZones.id, set: update });
  }
  for (const board of tree.electricalAssets) {
    const values = {
      id: board.id,
      installationId,
      zoneId: board.zoneId,
      assetName: board.assetName,
      displayCode: board.displayCode.value,
      generatedDisplayCode: board.displayCode.generatedValue,
      displayCodeOverridden: board.displayCode.isOverridden,
      displayCodeRuleVersion: board.displayCode.ruleVersion,
      displayCodeOverrideReason: board.displayCode.overrideReason ?? null,
      assetType: boardTypeLabel(board.typeCode, board.customTypeName),
      typeCode: board.typeCode,
      customTypeName: board.customTypeName ?? null,
      sourceKind: board.electricalSource.kind,
      gridSupplyId: board.electricalSource.kind === 'GRID' ? board.electricalSource.gridSupplyId : null,
      electricalParentId: board.electricalSource.kind === 'BOARD' ? board.electricalSource.boardId : null,
      electricalParentTbc: board.electricalSource.kind === 'TBC',
      locationDescription: board.locationDescription ?? null,
      phase: board.phase ?? null,
      amperageRating: board.amperageRating ?? null,
      siteNmi: board.siteNmi ?? null,
      photo: board.photo ?? null,
      extraPhotos: board.extraPhotos,
      meterPresent: board.meterPresent,
      meters: [],
      subCircuitsDescription: board.subCircuitsDescription ?? null,
      comments: board.comments ?? null,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: board.createdAt ? new Date(board.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihElectricalAssets).values(values).onConflictDoUpdate({
      target: ihElectricalAssets.id,
      set: update,
    });
  }
  for (const asset of tree.siteAssets) {
    const assignmentIds = asset.meteringState.kind === 'METERED'
      ? asset.meteringState.measurementAssignmentIds
      : [];
    const values = {
      id: asset.id,
      installationId,
      zoneId: asset.zoneId,
      assetName: asset.assetName,
      assetType: assetTypeLabel(asset.typeCode, asset.customTypeName),
      typeCode: asset.typeCode,
      customTypeName: asset.customTypeName ?? null,
      sourceKind: asset.electricalSource.kind,
      gridSupplyId: asset.electricalSource.kind === 'GRID' ? asset.electricalSource.gridSupplyId : null,
      electricalBoardId: asset.electricalSource.kind === 'BOARD' ? asset.electricalSource.boardId : null,
      electricalBoardTbc: asset.electricalSource.kind === 'TBC',
      locationDescription: asset.locationDescription ?? null,
      locationPhoto: asset.locationPhoto ?? null,
      displayCode: asset.displayCode.value,
      generatedDisplayCode: asset.displayCode.generatedValue,
      displayCodeOverridden: asset.displayCode.isOverridden,
      displayCodeRuleVersion: asset.displayCode.ruleVersion,
      displayCodeOverrideReason: asset.displayCode.overrideReason ?? null,
      meteringStateKind: asset.meteringState.kind,
      measurementAssignmentIds: assignmentIds,
      meterPresent: asset.meterPresent,
      meterSwitchboardId: null,
      meterSwitchboardTbc: asset.meteringState.kind === 'TBC',
      meterChannels: [],
      comments: asset.comments ?? null,
      extraPhotos: asset.extraPhotos,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: asset.createdAt ? new Date(asset.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihSiteAssets).values(values).onConflictDoUpdate({ target: ihSiteAssets.id, set: update });
  }
  for (const meter of tree.meterDevices) {
    const values = {
      id: meter.id,
      installationId,
      installedOnBoardId: meter.installedOnBoardId,
      deviceFamily: meter.deviceFamily,
      deviceModel: meter.deviceModel,
      customManufacturerName: meter.customManufacturerName ?? null,
      customModelName: meter.customModelName ?? null,
      deviceNumber: meter.deviceNumber ?? null,
      serialNumber: meter.serialNumber,
      displayCode: meter.displayName.value,
      generatedDisplayCode: meter.displayName.generatedValue,
      displayCodeOverridden: meter.displayName.isOverridden,
      displayCodeRuleVersion: meter.displayName.ruleVersion,
      displayCodeOverrideReason: meter.displayName.overrideReason ?? null,
      ...(meter.commissioningData !== undefined ? {
        commissioningData: meter.commissioningData as Record<string, unknown>,
      } : {}),
      wwPhotos: meter.wwPhotos ?? {},
      notes: meter.notes ?? null,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: meter.createdAt ? new Date(meter.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihMeterDevices).values(values).onConflictDoUpdate({ target: ihMeterDevices.id, set: update });
    for (const channel of meter.channels) {
      const channelValues = {
        id: channel.id,
        installationId,
        meterId: meter.id,
        ordinal: channel.ordinal,
        phaseLabel: channel.phaseLabel ?? null,
        purpose: channel.purpose,
        loadTypeCode: channel.loadTypeCode ?? null,
        customLoadTypeName: channel.customLoadTypeName ?? null,
        sensorRating: channel.sensorRating ?? null,
        description: channel.description ?? null,
        capabilities: channel.capabilities ?? {},
        syncStatus: 'synced',
        updatedAt: now,
        deletedAt: null,
        createdAt: channel.createdAt ? new Date(channel.createdAt) : now,
      };
      const { id: _channelId, createdAt: _channelCreatedAt, ...channelUpdate } = channelValues;
      await executor.insert(ihMeterChannels).values(channelValues).onConflictDoUpdate({
        target: ihMeterChannels.id,
        set: channelUpdate,
      });
    }
  }

  await executor.delete(ihMeasurementAssignmentChannels)
    .where(eq(ihMeasurementAssignmentChannels.installationId, installationId));
  for (const assignment of tree.measurementAssignments) {
    const values = {
      id: assignment.id,
      installationId,
      meterId: assignment.meterId,
      phaseMode: assignment.phaseMode,
      targetKind: assignment.target.kind,
      targetBoardId: assignment.target.kind === 'BOARD' ? assignment.target.boardId : null,
      targetSiteAssetId: assignment.target.kind === 'SITE_ASSET' ? assignment.target.siteAssetId : null,
      targetGridSupplyId: assignment.target.kind === 'GRID_BOUNDARY' ? assignment.target.gridSupplyId : null,
      direction: assignment.direction,
      status: assignment.status,
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: assignment.createdAt ? new Date(assignment.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihMeasurementAssignments).values(values).onConflictDoUpdate({
      target: ihMeasurementAssignments.id,
      set: update,
    });
    if (assignment.channelIds.length) {
      const assignmentChannels = assignment.channelIds.map((channelId, position) => ({
          id: `${assignment.id}:${channelId}`,
          installationId,
          assignmentId: assignment.id,
          meterId: assignment.meterId,
          channelId,
          position,
      }));
      const inserted = await executor.insert(ihMeasurementAssignmentChannels)
        .values(assignmentChannels)
        .onConflictDoNothing()
        .returning({ id: ihMeasurementAssignmentChannels.id });
      if (inserted.length !== assignmentChannels.length) {
        throw conflict('canonical_child_id_conflict');
      }
    }
  }
  for (const form of tree.formSubmissions) {
    const values = {
      id: form.id,
      installationId,
      formType: form.formType,
      schemaVersion: form.schemaVersion,
      status: form.status,
      zoneId: form.zoneId ?? null,
      boardId: form.boardId ?? null,
      meterId: form.meterId ?? null,
      siteAssetId: form.siteAssetId ?? null,
      answers: form.answers,
      attachments: form.attachments,
      completedAt: form.completedAt ? new Date(form.completedAt) : null,
      supersedesId: form.supersedesId ?? null,
      historicalMeterRemoved: historicalFormIds.has(form.id),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      createdAt: form.createdAt ? new Date(form.createdAt) : now,
    };
    const { id: _id, createdAt: _createdAt, ...update } = values;
    await executor.insert(ihFormSubmissions).values(values).onConflictDoUpdate({ target: ihFormSubmissions.id, set: update });
  }

  const channelIds = tree.meterDevices.flatMap((meter) => meter.channels.map((channel) => channel.id));
  await softDeleteOmitted(executor, ihMeasurementAssignments, installationId, tree.measurementAssignments.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihMeterChannels, installationId, channelIds, now);
  await softDeleteOmitted(executor, ihMeterDevices, installationId, tree.meterDevices.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihFormSubmissions, installationId, tree.formSubmissions.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihSiteAssets, installationId, tree.siteAssets.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihElectricalAssets, installationId, tree.electricalAssets.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihZones, installationId, tree.zones.map((item) => item.id), now);
  await softDeleteOmitted(executor, ihGridSupplies, installationId, tree.gridSupplies.map((item) => item.id), now);
}

export function isCanonicalChildOwnershipDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const databaseError = error as {
    code?: unknown;
    cause?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    message?: unknown;
  };
  return (databaseError.cause !== error && isCanonicalChildOwnershipDatabaseError(databaseError.cause))
    || databaseError.constraint === 'ih_canonical_child_installation_immutable'
    || databaseError.constraint_name === 'ih_canonical_child_installation_immutable'
    || (
      databaseError.code === '23514'
      && databaseError.message === 'InstallHub canonical child ownership is immutable'
    );
}

export async function replaceCanonicalInstallationChildren(
  input: ReplaceCanonicalInstallationChildrenInput,
): Promise<void> {
  try {
    await replaceCanonicalInstallationChildrenUnchecked(input);
  } catch (error) {
    if (isCanonicalChildOwnershipDatabaseError(error)) {
      throw conflict('canonical_child_id_conflict');
    }
    throw error;
  }
}

export type CanonicalRecordVersionSnapshot = {
  snapshotSchema: 'InstallationCanonicalSnapshotV2';
  canonicalizerVersion: string;
  validatorVersion: string;
  taxonomyVersion: string;
  displayCodeRuleVersion: number;
  virtualMeterFormulaVersion: number;
  controlledLabelCatalog: typeof INSTALLATION_CONTROLLED_LABEL_CATALOG;
  installationTree: CanonicalInstallationTree;
  readiness: ReturnType<typeof installationReadiness>;
  mediaManifest: Array<{
    id: string;
    checksum: string;
    entityType: string;
    entityId: string;
    fieldName: string;
    contentType: string | null;
    fileSizeBytes: number | null;
  }>;
  viewArtifacts: {
    electricalTree: ReturnType<typeof buildElectricalTreeView>;
    allAssets: ReturnType<typeof buildAllAssetsView>;
    metering: ReturnType<typeof buildMeteringView>;
    mapping: ReturnType<typeof buildInstallationMappingExport>;
  };
  payloadHash: string;
};

export function canonicalPhotoEntities(tree: CanonicalInstallationTree): CopiedPhotoEntity[] {
  return [
    ...tree.zones.map((zone) => {
      const record = { photos: zone.photos } as Record<string, unknown>;
      return {
        sourceEntityId: zone.id,
        targetEntityId: zone.id,
        targetEntityType: 'zone',
        photoValues: record,
        photoReferences: installHubZonePhotoFieldReferences(record),
      };
    }),
    ...tree.electricalAssets.map((board) => {
      const record = {
        photo: board.photo,
        extraPhotos: board.extraPhotos,
      } as Record<string, unknown>;
      return {
        sourceEntityId: board.id,
        targetEntityId: board.id,
        targetEntityType: 'electrical_asset',
        photoValues: record,
        photoReferences: installHubElectricalPhotoFieldReferences(record),
      };
    }),
    ...tree.siteAssets.map((asset) => {
      const record = {
        locationPhoto: asset.locationPhoto,
        extraPhotos: asset.extraPhotos,
      } as Record<string, unknown>;
      return {
        sourceEntityId: asset.id,
        targetEntityId: asset.id,
        targetEntityType: 'site_asset',
        photoValues: record,
        photoReferences: installHubSiteAssetPhotoFieldReferences(record),
      };
    }),
    ...tree.meterDevices.map((meter) => {
      const record = { wwPhotos: meter.wwPhotos ?? {} } as Record<string, unknown>;
      return {
        sourceEntityId: meter.id,
        targetEntityId: meter.id,
        targetEntityType: 'meter_device',
        photoValues: record,
        photoReferences: installHubMeterPhotoFieldReferences(record),
      };
    }),
    ...tree.formSubmissions.map((form) => {
      const record = { attachments: form.attachments } as Record<string, unknown>;
      return {
        sourceEntityId: form.id,
        targetEntityId: form.id,
        targetEntityType: 'form_submission',
        photoValues: record,
        photoReferences: installHubFormPhotoFieldReferences(record),
      };
    }),
  ];
}

export type CanonicalEvidenceReference = {
  entityType: 'zone' | 'electrical_asset' | 'site_asset' | 'meter_device' | 'form_submission';
  entityId: string;
  fieldName: string;
  uri: string;
};

function evidenceString(
  references: CanonicalEvidenceReference[],
  entityType: CanonicalEvidenceReference['entityType'],
  entityId: string,
  fieldName: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.trim()) {
    references.push({ entityType, entityId, fieldName, uri: value.trim() });
  }
}

/** Exact evidence-bearing paths in the canonical v2 tree. */
export function canonicalEvidenceReferences(
  tree: CanonicalInstallationTree,
): CanonicalEvidenceReference[] {
  const references: CanonicalEvidenceReference[] = [];
  for (const zone of tree.zones) {
    zone.photos.forEach((uri, index) => evidenceString(
      references, 'zone', zone.id, `photos[${index}]`, uri,
    ));
  }
  for (const board of tree.electricalAssets) {
    evidenceString(references, 'electrical_asset', board.id, 'photo', board.photo);
    board.extraPhotos.forEach((uri, index) => evidenceString(
      references, 'electrical_asset', board.id, `extraPhotos[${index}]`, uri,
    ));
  }
  for (const asset of tree.siteAssets) {
    evidenceString(references, 'site_asset', asset.id, 'locationPhoto', asset.locationPhoto);
    asset.extraPhotos.forEach((uri, index) => evidenceString(
      references, 'site_asset', asset.id, `extraPhotos[${index}]`, uri,
    ));
  }
  for (const meter of tree.meterDevices) {
    const photos = meter.wwPhotos && typeof meter.wwPhotos === 'object'
      ? meter.wwPhotos
      : {};
    evidenceString(
      references, 'meter_device', meter.id, 'wwPhotos.deviceInstalled',
      photos.deviceInstalled ?? photos.device_installed,
    );
    evidenceString(
      references, 'meter_device', meter.id, 'wwPhotos.switchboardOverview',
      photos.switchboardOverview ?? photos.switchboard_overview,
    );
    evidenceString(references, 'meter_device', meter.id, 'wwPhotos.labeling', photos.labeling);
    if (Array.isArray(photos.extra)) {
      photos.extra.forEach((uri, index) => evidenceString(
        references, 'meter_device', meter.id, `wwPhotos.extra[${index}]`, uri,
      ));
    }
  }
  for (const form of tree.formSubmissions) {
    form.attachments.forEach((attachment, index) => {
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return;
      evidenceString(
        references,
        'form_submission',
        form.id,
        `attachments[${index}].uri`,
        (attachment as Record<string, unknown>).uri,
      );
    });
  }
  return references.sort((left, right) => (
    `${left.entityType}:${left.entityId}:${left.fieldName}`
      .localeCompare(`${right.entityType}:${right.entityId}:${right.fieldName}`)
  ));
}

function evidenceKey(input: { id: string; entityType: string; entityId: string; fieldName: string }): string {
  return [input.id.toLowerCase(), input.entityType, input.entityId, input.fieldName].join('\0');
}

function manifestRow(row: PhotoRow): CanonicalRecordVersionSnapshot['mediaManifest'][number] {
  return {
    id: row.id,
    checksum: row.checksum,
    entityType: row.entityType,
    entityId: row.entityId,
    fieldName: row.fieldName,
    contentType: row.contentType,
    fileSizeBytes: row.fileSizeBytes,
  };
}

export function resolveCanonicalEvidence(input: {
  tree: CanonicalInstallationTree;
  photos: PhotoRow[];
}): {
  mediaManifest: CanonicalRecordVersionSnapshot['mediaManifest'];
  issues: ReadinessIssue[];
} {
  const confirmedByExactReference = new Map<string, PhotoRow>();
  for (const photo of input.photos) {
    if (
      photo.app !== 'installhub'
      || photo.parentId !== input.tree.installation.id
      || photo.status !== 'confirmed'
      || !photo.storageKey
      || !photo.remoteUrl
    ) continue;
    confirmedByExactReference.set(evidenceKey(photo), photo);
  }
  const resolved = new Map<string, PhotoRow>();
  const issues: ReadinessIssue[] = [];
  for (const reference of canonicalEvidenceReferences(input.tree)) {
    const ids = [...collectImmutablePhotoIds(reference.uri)];
    const photo = ids.length === 1
      ? confirmedByExactReference.get(evidenceKey({ id: ids[0], ...reference }))
      : undefined;
    if (!photo || reference.uri !== photo.remoteUrl) {
      issues.push({
        code: 'EVIDENCE_NOT_CONFIRMED',
        severity: 'ERROR',
        entityType: reference.entityType === 'electrical_asset'
          ? 'board'
          : reference.entityType === 'meter_device'
            ? 'meter'
            : reference.entityType === 'form_submission'
              ? 'form'
              : reference.entityType,
        entityId: reference.entityId,
        field: reference.fieldName,
        message: 'Evidence must reference the exact confirmed upload for this installation, entity, and field.',
      });
      continue;
    }
    resolved.set(evidenceKey(photo), photo);
  }
  return {
    mediaManifest: [...resolved.values()].map(manifestRow).sort((left, right) => (
      `${left.entityType}:${left.entityId}:${left.fieldName}:${left.id}`
        .localeCompare(`${right.entityType}:${right.entityId}:${right.fieldName}:${right.id}`)
    )),
    issues,
  };
}

export function projectCanonicalMediaManifest(
  tree: CanonicalInstallationTree,
  photos: PhotoRow[],
): CanonicalRecordVersionSnapshot['mediaManifest'] {
  return resolveCanonicalEvidence({ tree, photos }).mediaManifest;
}

export async function canonicalEvidenceResolution(
  tree: CanonicalInstallationTree,
  executor: InstallHubExecutor,
): Promise<ReturnType<typeof resolveCanonicalEvidence>> {
  const photos = await loadPhotosForParent({
    app: 'installhub',
    parentId: tree.installation.id,
    executor: executor as typeof db,
  });
  return resolveCanonicalEvidence({ tree, photos });
}

export function canonicalCompletionFormIssues(
  tree: CanonicalInstallationTree,
): ReadinessIssue[] {
  return tree.formSubmissions.flatMap((form): ReadinessIssue[] => {
    if (form.status !== 'Completed') return [];
    try {
      validateInstallHubFormContract({
        formType: form.formType,
        schemaVersion: form.schemaVersion,
        status: form.status,
        answers: form.answers,
        attachments: form.attachments,
        syncStage: 'complete',
        // Readiness operates on forms loaded from persistence. Completed rows
        // are immutable, so older load-only WW answers may be projected on a
        // temporary validation copy without weakening new completion writes.
        allowLegacyCompletedWwLoadOnly: true,
      });
      return [];
    } catch (error) {
      const detail = error instanceof AppError
        ? error.detail ?? error.message
        : 'Completed form does not satisfy its pinned contract.';
      return [{
        code: 'FORM_CONTRACT_INVALID',
        severity: 'ERROR',
        entityType: 'form',
        entityId: form.id,
        field: 'answers',
        message: detail,
      }];
    }
  });
}

export async function canonicalCompletionReadiness(input: {
  tree: CanonicalInstallationTree;
  executor: InstallHubExecutor;
}): Promise<ReturnType<typeof installationReadiness>> {
  const readiness = installationReadiness(input.tree);
  const evidence = await canonicalEvidenceResolution(input.tree, input.executor);
  const additional = [...canonicalCompletionFormIssues(input.tree), ...evidence.issues];
  if (!additional.length) return readiness;
  const issues = [...readiness.issues, ...additional].sort((left, right) => (
    `${left.code}:${left.entityType}:${left.entityId}:${left.field ?? ''}`
      .localeCompare(`${right.code}:${right.entityType}:${right.entityId}:${right.field ?? ''}`)
  ));
  return {
    ...readiness,
    readyToComplete: false,
    eligibility: {
      ...readiness.eligibility,
      authoritativeReport: false,
      mappingExport: false,
    },
    issues,
  };
}

export function buildCanonicalSnapshotPayload(input: {
  tree: CanonicalInstallationTree;
  mediaManifest: CanonicalRecordVersionSnapshot['mediaManifest'];
}): CanonicalRecordVersionSnapshot {
  let canonicalTree = normalizeInstallationTreeV2(input.tree);
  const sourceMediaManifest = [...input.mediaManifest].sort((left, right) => (
    `${left.entityType}:${left.entityId}:${left.fieldName}:${left.id}`
      .localeCompare(`${right.entityType}:${right.entityId}:${right.fieldName}:${right.id}`)
  ));
  const manifestByReference = new Map(sourceMediaManifest.map((item) => [
    evidenceKey(item),
    item,
  ]));
  const entityRecord = (reference: CanonicalEvidenceReference): Record<string, unknown> | undefined => {
    if (reference.entityType === 'zone') {
      return canonicalTree.zones.find((item) => item.id === reference.entityId) as unknown as Record<string, unknown>;
    }
    if (reference.entityType === 'electrical_asset') {
      return canonicalTree.electricalAssets.find((item) => item.id === reference.entityId) as unknown as Record<string, unknown>;
    }
    if (reference.entityType === 'site_asset') {
      return canonicalTree.siteAssets.find((item) => item.id === reference.entityId) as unknown as Record<string, unknown>;
    }
    if (reference.entityType === 'meter_device') {
      return canonicalTree.meterDevices.find((item) => item.id === reference.entityId) as unknown as Record<string, unknown>;
    }
    return canonicalTree.formSubmissions.find((item) => item.id === reference.entityId) as unknown as Record<string, unknown>;
  };
  const setPath = (record: Record<string, unknown>, fieldName: string, value: string): void => {
    const parts = [...fieldName.matchAll(/([^.\[\]]+)|\[(\d+)\]/g)]
      .map((match) => match[1] ?? Number(match[2]));
    let cursor: unknown = record;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!cursor || typeof cursor !== 'object') return;
      cursor = (cursor as Record<string | number, unknown>)[part];
    }
    if (!cursor || typeof cursor !== 'object') return;
    const last = parts.at(-1);
    if (last !== undefined) (cursor as Record<string | number, unknown>)[last] = value;
  };
  for (const reference of canonicalEvidenceReferences(canonicalTree)) {
    const ids = [...collectImmutablePhotoIds(reference.uri)];
    const manifest = ids.length === 1
      ? manifestByReference.get(evidenceKey({ id: ids[0], ...reference }))
      : undefined;
    if (!manifest) {
      throw new Error(`CANONICAL_EVIDENCE_UNRESOLVED:${reference.entityType}:${reference.entityId}:${reference.fieldName}`);
    }
    const entity = entityRecord(reference);
    if (entity) setPath(entity, reference.fieldName, `urn:installhub:photo:${manifest.id}`);
  }
  canonicalTree = canonicalOrderInstallationTree(canonicalTree);
  const manifestPool = new Map<string, typeof sourceMediaManifest>();
  for (const item of sourceMediaManifest) {
    const key = [item.id.toLowerCase(), item.entityType, item.entityId].join('\0');
    const values = manifestPool.get(key) ?? [];
    values.push(item);
    manifestPool.set(key, values);
  }
  const mediaManifest = canonicalEvidenceReferences(canonicalTree).map((reference) => {
    const [id] = [...collectImmutablePhotoIds(reference.uri)];
    const key = [id?.toLowerCase() ?? '', reference.entityType, reference.entityId].join('\0');
    const source = manifestPool.get(key)?.shift();
    if (!source) {
      throw new Error(`CANONICAL_EVIDENCE_UNRESOLVED:${reference.entityType}:${reference.entityId}:${reference.fieldName}`);
    }
    return { ...source, fieldName: reference.fieldName };
  }).sort((left, right) => (
    `${left.entityType}:${left.entityId}:${left.fieldName}:${left.id}`
      .localeCompare(`${right.entityType}:${right.entityId}:${right.fieldName}:${right.id}`)
  ));
  // Snapshot hashes must be computed over the exact JSON shape PostgreSQL
  // stores. An enumerable `undefined` hashes as null in stableStringify but is
  // dropped by JSON/JSONB, making the immutable version unreadable on reload.
  delete canonicalTree.baseTreeRevision;
  canonicalTree.serverDerived.virtualMeterDefinitions = deriveVirtualMeterDefinitions(canonicalTree);
  const recordVersionNumber = canonicalTree.installation.recordVersionNumber;
  const withoutHash = {
    snapshotSchema: 'InstallationCanonicalSnapshotV2' as const,
    canonicalizerVersion: INSTALLATION_CANONICALIZER_VERSION,
    validatorVersion: INSTALLATION_VALIDATOR_VERSION,
    taxonomyVersion: INSTALLATION_TAXONOMY_VERSION,
    displayCodeRuleVersion: DISPLAY_CODE_RULE_VERSION,
    virtualMeterFormulaVersion: VIRTUAL_METER_FORMULA_VERSION,
    controlledLabelCatalog: INSTALLATION_CONTROLLED_LABEL_CATALOG,
    installationTree: canonicalTree,
    readiness: installationReadiness(canonicalTree),
    mediaManifest,
    viewArtifacts: {
      electricalTree: buildElectricalTreeView(canonicalTree, recordVersionNumber),
      allAssets: buildAllAssetsView(canonicalTree, recordVersionNumber),
      metering: buildMeteringView(canonicalTree, recordVersionNumber),
      mapping: buildInstallationMappingExport(canonicalTree, recordVersionNumber),
    },
  };
  return { ...withoutHash, payloadHash: canonicalPayloadHash(withoutHash) };
}

function canonicalSnapshotWithoutPayloadHash(
  snapshot: CanonicalRecordVersionSnapshot,
): Omit<CanonicalRecordVersionSnapshot, 'payloadHash'> {
  const { payloadHash: _payloadHash, ...withoutHash } = snapshot;
  return withoutHash;
}

export function canonicalSnapshotContentHash(
  snapshot: CanonicalRecordVersionSnapshot,
): string {
  const withoutHash = canonicalSnapshotWithoutPayloadHash(snapshot);
  // v2.2 changed only JSON/hash canonicalization. Treat an otherwise exact
  // v2.1 pin as the same immutable content so retry never creates a version
  // solely to repair historical hash provenance.
  const comparable = withoutHash.canonicalizerVersion === 'installation-canonical-v2.1'
    ? { ...withoutHash, canonicalizerVersion: INSTALLATION_CANONICALIZER_VERSION }
    : withoutHash;
  return canonicalPayloadHash(comparable);
}

/**
 * Accepts the exact stored hash plus one bounded historical defect: v2.1
 * snapshots were hashed with an enumerable undefined baseTreeRevision before
 * JSONB dropped that key. Historical rows stay immutable; new rows never use
 * this compatibility shape.
 */
export function canonicalSnapshotPayloadHashMatches(
  snapshot: CanonicalRecordVersionSnapshot,
): boolean {
  const withoutHash = canonicalSnapshotWithoutPayloadHash(snapshot);
  if (canonicalPayloadHash(withoutHash) === snapshot.payloadHash) return true;
  if (
    snapshot.canonicalizerVersion !== 'installation-canonical-v2.1'
    || Object.prototype.hasOwnProperty.call(
      withoutHash.installationTree,
      'baseTreeRevision',
    )
  ) return false;
  const legacyWithoutHash = {
    ...withoutHash,
    installationTree: {
      ...withoutHash.installationTree,
      baseTreeRevision: undefined,
    },
  };
  return canonicalPayloadHash(legacyWithoutHash) === snapshot.payloadHash;
}

export async function makeCanonicalSnapshot(input: {
  tree: CanonicalInstallationTree;
  executor: InstallHubExecutor;
}): Promise<CanonicalRecordVersionSnapshot> {
  const canonicalTree = normalizeInstallationTreeV2(input.tree);
  const evidence = await canonicalEvidenceResolution(canonicalTree, input.executor);
  if (evidence.issues.length) {
    const issue = evidence.issues[0];
    throw new Error(`CANONICAL_EVIDENCE_UNRESOLVED:${issue.entityType}:${issue.entityId}:${issue.field ?? ''}`);
  }
  return buildCanonicalSnapshotPayload({
    tree: canonicalTree,
    mediaManifest: evidence.mediaManifest,
  });
}

export async function insertCanonicalRecordVersion(input: {
  executor: InstallHubExecutor;
  tree: CanonicalInstallationTree;
  versionNumber: number;
  userId: string;
}): Promise<CanonicalRecordVersionSnapshot> {
  const snapshot = await makeCanonicalSnapshot({ tree: input.tree, executor: input.executor });
  await input.executor.insert(recordVersions).values({
    id: randomUUID(),
    app: 'installhub',
    entityType: 'installation',
    entityId: input.tree.installation.id,
    versionNumber: input.versionNumber,
    schemaVersion: 2,
    canonicalizerVersion: INSTALLATION_CANONICALIZER_VERSION,
    validatorVersion: INSTALLATION_VALIDATOR_VERSION,
    taxonomyVersion: INSTALLATION_TAXONOMY_VERSION,
    payloadHash: snapshot.payloadHash,
    snapshot,
    createdByUserId: input.userId,
  });
  return snapshot;
}

export async function loadCanonicalRecordVersion(input: {
  installationId: string;
  versionNumber?: number;
  executor?: InstallHubExecutor;
}): Promise<{
  versionNumber: number;
  createdAt: string;
  snapshot: CanonicalRecordVersionSnapshot;
} | null> {
  const executor = input.executor ?? db;
  const conditions = [
    eq(recordVersions.app, 'installhub'),
    eq(recordVersions.entityType, 'installation'),
    eq(recordVersions.entityId, input.installationId),
  ];
  if (input.versionNumber !== undefined) {
    conditions.push(eq(recordVersions.versionNumber, input.versionNumber));
  }
  const [row] = await executor.select().from(recordVersions)
    .where(and(...conditions))
    .orderBy(desc(recordVersions.versionNumber))
    .limit(1);
  if (!row) return null;
  const raw = row.snapshot as Partial<CanonicalRecordVersionSnapshot>;
  if (raw.snapshotSchema !== 'InstallationCanonicalSnapshotV2' || !raw.installationTree) return null;
  if (
    raw.installationTree.treeSchemaVersion !== 2
    || raw.installationTree.installation?.id !== input.installationId
    || raw.installationTree.installation.recordVersionNumber !== row.versionNumber
    || !raw.readiness
    || !Array.isArray(raw.mediaManifest)
    || !raw.viewArtifacts
    || !raw.controlledLabelCatalog
    || typeof raw.displayCodeRuleVersion !== 'number'
    || typeof raw.virtualMeterFormulaVersion !== 'number'
    || typeof raw.payloadHash !== 'string'
  ) {
    throw new Error('canonical_snapshot_invalid');
  }
  const snapshot = raw as CanonicalRecordVersionSnapshot;
  if (
    !canonicalSnapshotPayloadHashMatches(snapshot)
    || (row.payloadHash && row.payloadHash !== snapshot.payloadHash)
  ) {
    throw new Error('canonical_snapshot_hash_mismatch');
  }
  // Never run a historical snapshot through the current canonicalizer or
  // derivation code: its pinned labels, virtuals and readiness are immutable.
  return {
    versionNumber: row.versionNumber,
    createdAt: row.createdAt.toISOString(),
    snapshot,
  };
}

/**
 * Pins one immutable version for the current canonical snapshot. Replaying
 * the same complete request returns the existing version; metadata mutations
 * that occurred after the last pin create exactly one newer version.
 */
export async function ensureCanonicalRecordVersion(input: {
  executor: InstallHubExecutor;
  tree: CanonicalInstallationTree;
  userId: string;
}): Promise<number> {
  const currentVersion = input.tree.installation.recordVersionNumber;
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new Error('canonical_record_version_invalid');
  }
  if (currentVersion > 0) {
    const pinned = await loadCanonicalRecordVersion({
      installationId: input.tree.installation.id,
      versionNumber: currentVersion,
      executor: input.executor,
    });
    if (!pinned) throw new Error('canonical_snapshot_missing');
    const currentSnapshot = await makeCanonicalSnapshot({
      tree: input.tree,
      executor: input.executor,
    });
    if (
      canonicalSnapshotContentHash(currentSnapshot)
      === canonicalSnapshotContentHash(pinned.snapshot)
    ) {
      return currentVersion;
    }
  }

  const nextVersion = currentVersion + 1;
  input.tree.installation.recordVersionNumber = nextVersion;
  await input.executor.update(ihInstallations).set({ recordVersionNumber: nextVersion })
    .where(eq(ihInstallations.id, input.tree.installation.id));
  await insertCanonicalRecordVersion({
    executor: input.executor,
    tree: input.tree,
    versionNumber: nextVersion,
    userId: input.userId,
  });
  return nextVersion;
}
