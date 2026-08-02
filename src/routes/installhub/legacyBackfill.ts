import { createHash } from 'node:crypto';
import type { BoardTypeCode, SiteAssetTypeCode } from './canonical.js';

export type LegacyBackfillException = {
  code:
    | 'AMBIGUOUS_LEGACY_SOURCE'
    | 'INVALID_PARENT_REFERENCE'
    | 'MULTIPLE_GRID_DEFAULTS'
    | 'MULTIPLE_NMI_VALUES'
    | 'DUPLICATE_GRID_IDENTITY'
    | 'ELECTRICAL_NODE_ID_COLLISION'
    | 'RESERVED_ELECTRICAL_NODE_ID'
    | 'DUPLICATE_DISPLAY_CODE'
    | 'AMBIGUOUS_METER_IDENTITY'
    | 'AMBIGUOUS_CHANNEL_IDENTITY'
    | 'AMBIGUOUS_MEASUREMENT_MAPPING'
    | 'AMBIGUOUS_MEASUREMENT_DIRECTION'
    | 'MISSING_METER_CAPABILITY'
    | 'CONFLICTING_CANONICAL_METER'
    | 'CONFLICTING_CANONICAL_ASSIGNMENT'
    | 'AMBIGUOUS_FORM_METER_LINK'
    | 'METER_PRESENT_MISMATCH';
  severity: 'REVIEW' | 'BLOCKING';
  entityType: 'installation' | 'board' | 'site_asset' | 'meter';
  entityId: string;
  detail: string;
};

export type LegacyBoardRow = {
  id: string;
  installationId: string;
  assetType: string;
  displayCode: string;
  electricalParentId: string | null;
  electricalParentTbc: boolean;
  siteNmi: string | null;
  meterPresent: boolean;
  meters: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type LegacySiteAssetRow = {
  id: string;
  installationId: string;
  assetType: string;
  displayCode: string | null;
  electricalBoardId: string | null;
  electricalBoardTbc: boolean;
  meterPresent: boolean;
  meterSwitchboardId: string | null;
  meterSwitchboardTbc: boolean;
  meterChannels: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type LegacyFormRow = {
  id: string;
  formType: string;
  status: string;
  boardId: string | null;
  meterId: string | null;
  answers: unknown;
};

export type ExistingGridRow = {
  id: string;
  isDefault: boolean;
  nmi?: string | null;
  externalKey?: string | null;
  deletedAt: Date | null;
};

export type BackfillMeterDevice = {
  id: string;
  installationId: string;
  installedOnBoardId: string;
  deviceFamily: 'WATTWATCHERS' | 'OTHER';
  deviceModel: 'A3RM' | 'A6M' | 'OTHER';
  customManufacturerName: string | null;
  customModelName: string | null;
  deviceNumber: string | null;
  serialNumber: string;
  displayCode: string;
  wwPhotos: Record<string, unknown>;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  legacyBoardId: string;
  legacyMeterIndex: number;
  channels: BackfillMeterChannel[];
};

export type BackfillMeterChannel = {
  id: string;
  ordinal: number;
  phaseLabel: string | null;
  purpose: 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE';
  loadTypeCode: SiteAssetTypeCode | null;
  customLoadTypeName: string | null;
  sensorRating: string | null;
  description: string | null;
  capabilities: Record<string, unknown>;
};

export type ExistingCanonicalMeter = {
  id: string;
  installedOnBoardId: string;
  deviceFamily: 'WATTWATCHERS' | 'OTHER';
  deviceModel: 'A3RM' | 'A6M' | 'OTHER';
  customManufacturerName: string | null;
  customModelName: string | null;
  deviceNumber: string | null;
  serialNumber: string;
  displayCode: string;
  channels: Array<{
    id: string;
    ordinal: number;
    purpose: 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE';
    phaseLabel: string | null;
    loadTypeCode: SiteAssetTypeCode | null;
    customLoadTypeName: string | null;
    sensorRating: string | null;
    description: string | null;
    capabilities: Record<string, unknown>;
  }>;
};

export type ExistingCanonicalAssignment = {
  id: string;
  meterId: string;
  channelIds: string[];
  targetKind: string;
  targetSiteAssetId: string | null;
  direction: 'CONSUMPTION' | 'GENERATION' | 'BIDIRECTIONAL';
  status: string;
  deletedAt: Date | null;
};

export type LegacyBackfillPlan = {
  installationId: string;
  expectedTreeRevision: number;
  deterministicGrid: {
    id: string;
    name: string;
    nmi: string | null;
    isDefault: true;
  } | null;
  boardUpdates: Array<{
    id: string;
    typeCode: BoardTypeCode;
    customTypeName: string | null;
    sourceKind: 'BOARD' | 'TBC' | 'LEGACY';
    electricalParentId: string | null;
    electricalParentTbc: boolean;
    displayCodeOverridden: boolean;
  }>;
  siteAssetUpdates: Array<{
    id: string;
    typeCode: SiteAssetTypeCode;
    customTypeName: string | null;
    sourceKind: 'BOARD' | 'TBC' | 'LEGACY';
    electricalBoardId: string | null;
    electricalBoardTbc: boolean;
    displayCodeOverridden: boolean;
    meteringStateKind: 'METERED' | 'TBC';
    measurementAssignmentIds: string[];
  }>;
  displayClaims: Array<{
    id: string;
    entityType: 'board' | 'site_asset' | 'meter';
    entityId: string;
    typeCode: string;
    displayCode: string;
    normalizedDisplayCode: string;
    sequence: number | null;
    generated: boolean;
  }>;
  meterDevices: BackfillMeterDevice[];
  photoReconciliations: Array<{
    meterId: string;
    legacyBoardId: string;
    legacyMeterIndex: number;
  }>;
  measurementAssignments: Array<{
    id: string;
    meterId: string;
    channelIds: string[];
    targetSiteAssetId: string;
    phaseMode: 'SINGLE_PHASE' | 'THREE_PHASE';
    direction: 'CONSUMPTION' | 'GENERATION' | 'BIDIRECTIONAL';
  }>;
  formUpdates: Array<{ id: string; meterId: string }>;
  alreadyMigratedMeters: number;
  alreadyMigratedAssignments: number;
  exceptions: LegacyBackfillException[];
  promotable: boolean;
};

const BOARD_ALIASES: Record<string, BoardTypeCode> = {
  MSB: 'MSB',
  MS8: 'MSB',
  'MAIN SWITCHBOARD': 'MSB',
  'MAIN SNACHBOARD': 'MSB',
  MSSB: 'MSSB',
  'MAIN SUB SWITCHBOARD': 'MSSB',
  'MAIN SUB-SWITCHBOARD': 'MSSB',
  DB: 'DB',
  'DISTRIBUTION BOARD': 'DB',
  'HVAC-DB': 'HVAC_DB',
  'HVAC DB': 'HVAC_DB',
  'LX-DB': 'LX_DB',
  'LX DB': 'LX_DB',
  'PV-DB': 'PV_DB',
  'PV DB': 'PV_DB',
  MCC: 'MCC',
  'MOTOR CONTROL CENTRE': 'MCC',
  OTHER: 'OTHER',
};

const ASSET_ALIASES: Record<string, SiteAssetTypeCode> = {
  PV: 'PV',
  SOLAR: 'PV',
  'SOLAR / PV': 'PV',
  HVAC: 'HVAC',
  'AC/HVAC': 'HVAC',
  LIGHTING: 'LIGHTING',
  LIGHTNING: 'LIGHTING',
  'EV CHARGER': 'EV_CHARGER',
  'VEHICLE HOIST': 'VEHICLE_HOIST',
  FORKLIFT: 'FORKLIFT',
  'EXHAUST / FAN SYSTEM': 'EXHAUST_FAN_SYSTEM',
  'POWER OUTLET': 'POWER_OUTLET',
  'HOT WATER': 'HEATER_GEYSER',
  'HEATER / GEYSER': 'HEATER_GEYSER',
  OTHER: 'OTHER',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;
}

export function deterministicLegacyGridId(installationId: string): string {
  return deterministicId('grid', installationId, 'canonical-v2-default');
}

function normalizeDisplayCode(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function boardClassification(value: string): { typeCode: BoardTypeCode; customTypeName: string | null } {
  const typeCode = BOARD_ALIASES[value.trim().toUpperCase()] ?? 'OTHER';
  return {
    typeCode,
    customTypeName: typeCode === 'OTHER' && value.trim().toUpperCase() !== 'OTHER'
      ? value.trim()
      : null,
  };
}

function assetClassification(value: string): { typeCode: SiteAssetTypeCode; customTypeName: string | null } {
  const typeCode = ASSET_ALIASES[value.trim().toUpperCase()] ?? 'OTHER';
  return {
    typeCode,
    customTypeName: typeCode === 'OTHER' && value.trim().toUpperCase() !== 'OTHER'
      ? value.trim()
      : null,
  };
}

export function classifyLegacyMeterLoadType(
  value: string | null,
): { code: SiteAssetTypeCode | null; custom: string | null } {
  if (!value || value === 'Not Used' || value === 'Mains Supply') return { code: null, custom: null };
  const classification = assetClassification(value);
  return {
    code: classification.typeCode,
    custom: classification.typeCode === 'OTHER' ? classification.customTypeName ?? value : null,
  };
}

function meterFromLegacy(input: {
  installationId: string;
  board: LegacyBoardRow;
  meter: Record<string, unknown>;
  meterIndex: number;
  knownMeterIds: Set<string>;
  knownChannelIds: Set<string>;
  exceptions: LegacyBackfillException[];
}): BackfillMeterDevice | null {
  const id = text(input.meter.id);
  const rawModel = text(input.meter.deviceType) ?? text(input.meter.deviceModel);
  const serialNumber = text(input.meter.deviceId) ?? text(input.meter.serialNumber);
  if (!id || !rawModel || !serialNumber || input.knownMeterIds.has(id)) {
    input.exceptions.push({
      code: 'AMBIGUOUS_METER_IDENTITY',
      severity: 'BLOCKING',
      entityType: 'board',
      entityId: input.board.id,
      detail: 'Embedded meter requires a unique stable id, model, and serial identity.',
    });
    return null;
  }
  const deviceModel = rawModel === 'A3RM' || rawModel === 'A6M' ? rawModel : 'OTHER';
  const deviceFamily = deviceModel === 'OTHER'
    ? (input.meter.deviceFamily === 'WATTWATCHERS' ? 'WATTWATCHERS' : 'OTHER')
    : 'WATTWATCHERS';
  const customMeter = deviceFamily === 'OTHER' || deviceModel === 'OTHER';
  const rawChannels = Array.isArray(input.meter.wwChannels) ? input.meter.wwChannels : [];
  const expectedCount = deviceModel === 'A3RM' ? 3 : deviceModel === 'A6M' ? 6 : null;
  if ((expectedCount !== null && rawChannels.length !== expectedCount) || rawChannels.length === 0) {
    input.exceptions.push({
      code: 'AMBIGUOUS_CHANNEL_IDENTITY',
      severity: 'BLOCKING',
      entityType: 'meter',
      entityId: id,
      detail: `${deviceModel} embedded channels are missing or do not have the exact required count.`,
    });
    return null;
  }
  const localChannelIds = new Set<string>();
  const channels: BackfillMeterChannel[] = [];
  for (const rawChannel of rawChannels) {
    const item = record(rawChannel);
    const channelId = text(item?.id);
    const ordinal = typeof item?.ordinal === 'number' && Number.isInteger(item.ordinal)
      ? item.ordinal
      : null;
    const rawPurpose = text(item?.purpose);
    const rawLoad = text(item?.loadType) ?? text(item?.load);
    const purpose = rawPurpose === 'MAIN_SUPPLY' || rawPurpose === 'SUB_CIRCUIT' || rawPurpose === 'SPARE'
      ? rawPurpose
      : rawLoad === 'Mains Supply'
        ? 'MAIN_SUPPLY'
        : rawLoad === 'Not Used'
          ? 'SPARE'
          : rawLoad
            ? 'SUB_CIRCUIT'
            : null;
    if (
      !channelId
      || ordinal === null
      || ordinal < 1
      || !purpose
      || localChannelIds.has(channelId)
      || input.knownChannelIds.has(channelId)
    ) {
      input.exceptions.push({
        code: 'AMBIGUOUS_CHANNEL_IDENTITY',
        severity: 'BLOCKING',
        entityType: 'meter',
        entityId: id,
        detail: 'Every embedded channel requires a unique stable id, positive ordinal, and explicit purpose/load.',
      });
      return null;
    }
    localChannelIds.add(channelId);
    const classifiedLoad = classifyLegacyMeterLoadType(rawLoad);
    channels.push({
      id: channelId,
      ordinal,
      phaseLabel: text(item?.phaseLabel),
      purpose,
      loadTypeCode: purpose === 'SUB_CIRCUIT' ? classifiedLoad.code : null,
      customLoadTypeName: purpose === 'SUB_CIRCUIT' ? classifiedLoad.custom : null,
      sensorRating: purpose === 'SPARE'
        ? null
        : text(item?.rogowskiSize) ?? text(item?.ctRatio) ?? text(item?.sensorRating),
      description: purpose === 'SPARE' ? null : text(item?.description),
      capabilities: record(item?.capabilities) ?? {},
    });
  }
  const ordinals = channels.map((channel) => channel.ordinal).sort((left, right) => left - right);
  if (
    new Set(ordinals).size !== ordinals.length
    || (expectedCount !== null && ordinals.some((ordinal, index) => ordinal !== index + 1))
  ) {
    input.exceptions.push({
      code: 'AMBIGUOUS_CHANNEL_IDENTITY',
      severity: 'BLOCKING',
      entityType: 'meter',
      entityId: id,
      detail: 'Channel ordinals are duplicated or incomplete.',
    });
    return null;
  }
  input.knownMeterIds.add(id);
  for (const channelId of localChannelIds) input.knownChannelIds.add(channelId);
  for (const channel of customMeter ? channels : []) {
    if (Object.keys(channel.capabilities).length === 0) {
      input.exceptions.push({
        code: 'MISSING_METER_CAPABILITY',
        severity: 'BLOCKING',
        entityType: 'meter',
        entityId: id,
        detail: `Channel ${channel.id} has no explicit capability metadata; values were preserved but schema-v2 promotion is blocked.`,
      });
    }
  }
  const displayCode = text(input.meter.deviceName) ?? `${deviceModel}-${serialNumber}`;
  return {
    id,
    installationId: input.installationId,
    installedOnBoardId: input.board.id,
    deviceFamily,
    deviceModel,
    customManufacturerName: text(input.meter.customManufacturerName),
    customModelName: deviceModel === 'OTHER'
      ? text(input.meter.customModelName) ?? rawModel
      : null,
    deviceNumber: text(input.meter.deviceNumber),
    serialNumber,
    displayCode,
    wwPhotos: record(input.meter.wwPhotos) ?? {},
    notes: text(input.meter.notes),
    createdAt: input.board.createdAt,
    updatedAt: input.board.updatedAt,
    deletedAt: input.board.deletedAt,
    legacyBoardId: input.board.id,
    legacyMeterIndex: input.meterIndex,
    channels: channels.sort((left, right) => left.ordinal - right.ordinal),
  };
}

export function planLegacyInstallationBackfill(input: {
  installationId: string;
  siteCode: string;
  expectedTreeRevision?: number;
  grids: ExistingGridRow[];
  boards: LegacyBoardRow[];
  siteAssets: LegacySiteAssetRow[];
  forms?: LegacyFormRow[];
  existingMeters?: ExistingCanonicalMeter[];
  existingChannelIds?: string[];
  existingAssignments?: ExistingCanonicalAssignment[];
}): LegacyBackfillPlan {
  const exceptions: LegacyBackfillException[] = [];
  const boardIds = new Set(input.boards.map((board) => board.id));
  const activeGrids = input.grids.filter((grid) => !grid.deletedAt);
  const defaults = activeGrids.filter((grid) => grid.isDefault);
  if (activeGrids.length > 0 && defaults.length !== 1) {
    exceptions.push({
      code: 'MULTIPLE_GRID_DEFAULTS',
      severity: 'BLOCKING',
      entityType: 'installation',
      entityId: input.installationId,
      detail: 'Existing Grid supplies require exactly one active default.',
    });
  }
  for (const field of ['nmi', 'externalKey'] as const) {
    const seen = new Map<string, string>();
    for (const grid of activeGrids) {
      const value = text(grid[field]);
      if (!value) continue;
      const normalized = value.replace(/\s+/g, '').toUpperCase();
      const prior = seen.get(normalized);
      if (prior) {
        exceptions.push({
          code: 'DUPLICATE_GRID_IDENTITY',
          severity: 'BLOCKING',
          entityType: 'installation',
          entityId: input.installationId,
          detail: `Grid supplies ${prior} and ${grid.id} have duplicate normalized ${field}.`,
        });
      } else {
        seen.set(normalized, grid.id);
      }
    }
  }
  const nmis = [...new Set(input.boards.map((board) => text(board.siteNmi)).filter((value): value is string => Boolean(value)))].sort();
  if (nmis.length > 1) {
    exceptions.push({
      code: 'MULTIPLE_NMI_VALUES',
      severity: 'REVIEW',
      entityType: 'installation',
      entityId: input.installationId,
      detail: 'Multiple legacy NMI values exist; the deterministic Grid NMI remains unset.',
    });
  }
  const deterministicGrid = activeGrids.length === 0 ? {
    id: deterministicLegacyGridId(input.installationId),
    name: 'Grid supply',
    nmi: nmis.length === 1 ? nmis[0] : null,
    isDefault: true as const,
  } : null;
  const electricalNodeIds = new Map<string, 'grid' | 'board' | 'site_asset'>();
  for (const node of [
    ...(deterministicGrid
      ? [{ id: deterministicGrid.id, kind: 'grid' as const }]
      : activeGrids.map((grid) => ({ id: grid.id, kind: 'grid' as const }))),
    ...input.boards.map((board) => ({ id: board.id, kind: 'board' as const })),
    ...input.siteAssets.map((asset) => ({ id: asset.id, kind: 'site_asset' as const })),
  ]) {
    if (node.id.startsWith('virtual_')) {
      exceptions.push({
        code: 'RESERVED_ELECTRICAL_NODE_ID',
        severity: 'BLOCKING',
        entityType: node.kind === 'grid' ? 'installation' : node.kind,
        entityId: node.id,
        detail: 'Electrical node IDs cannot use the reserved virtual_ namespace.',
      });
    }
    const priorKind = electricalNodeIds.get(node.id);
    if (priorKind) {
      exceptions.push({
        code: 'ELECTRICAL_NODE_ID_COLLISION',
        severity: 'BLOCKING',
        entityType: node.kind === 'grid' ? 'installation' : node.kind,
        entityId: node.id,
        detail: `Electrical node ID is shared by ${priorKind} and ${node.kind}.`,
      });
    } else {
      electricalNodeIds.set(node.id, node.kind);
    }
  }

  const boardUpdates = input.boards.map((board) => {
    const classification = boardClassification(board.assetType);
    let sourceKind: 'BOARD' | 'TBC' | 'LEGACY' = 'TBC';
    let parentId = board.electricalParentId;
    let parentTbc = board.electricalParentTbc;
    if (parentId && boardIds.has(parentId) && parentId !== board.id) {
      sourceKind = 'BOARD';
      parentTbc = false;
    } else if (parentId) {
      sourceKind = 'LEGACY';
      exceptions.push({
        code: 'INVALID_PARENT_REFERENCE',
        severity: 'BLOCKING',
        entityType: 'board',
        entityId: board.id,
        detail: 'Legacy parent is missing, self-referential, or outside the installation.',
      });
    } else {
      sourceKind = 'TBC';
      parentId = null;
      parentTbc = true;
      if (!board.electricalParentTbc) {
        exceptions.push({
          code: 'AMBIGUOUS_LEGACY_SOURCE',
          severity: 'REVIEW',
          entityType: 'board',
          entityId: board.id,
          detail: 'Null parent plus false TBC was preserved as unresolved TBC, never guessed as Grid.',
        });
      }
    }
    return {
      id: board.id,
      ...classification,
      sourceKind,
      electricalParentId: parentId,
      electricalParentTbc: parentTbc,
      displayCodeOverridden: Boolean(text(board.displayCode)),
    };
  });

  const siteAssetUpdates: LegacyBackfillPlan['siteAssetUpdates'] = input.siteAssets.map((asset) => {
    const classification = assetClassification(asset.assetType);
    let sourceKind: 'BOARD' | 'TBC' | 'LEGACY' = 'TBC';
    let boardId = asset.electricalBoardId;
    let boardTbc = asset.electricalBoardTbc;
    if (boardId && boardIds.has(boardId)) {
      sourceKind = 'BOARD';
      boardTbc = false;
    } else if (boardId) {
      sourceKind = 'LEGACY';
      exceptions.push({
        code: 'INVALID_PARENT_REFERENCE',
        severity: 'BLOCKING',
        entityType: 'site_asset',
        entityId: asset.id,
        detail: 'Legacy source board is outside the installation.',
      });
    } else {
      sourceKind = 'TBC';
      boardId = null;
      boardTbc = true;
      if (!asset.electricalBoardTbc) {
        exceptions.push({
          code: 'AMBIGUOUS_LEGACY_SOURCE',
          severity: 'REVIEW',
          entityType: 'site_asset',
          entityId: asset.id,
          detail: 'Null source plus false TBC was preserved as unresolved TBC, never guessed as Grid.',
        });
      }
    }
    return {
      id: asset.id,
      ...classification,
      sourceKind,
      electricalBoardId: boardId,
      electricalBoardTbc: boardTbc,
      displayCodeOverridden: Boolean(text(asset.displayCode)),
      meteringStateKind: 'TBC' as const,
      measurementAssignmentIds: [],
    };
  });

  const existingMeters = input.existingMeters ?? [];
  const existingMeterIds = new Set(existingMeters.map((meter) => meter.id));
  const knownMeterIds = new Set(existingMeterIds);
  const knownChannelIds = new Set(input.existingChannelIds ?? []);
  const meterDevices: BackfillMeterDevice[] = [];
  const photoReconciliations: LegacyBackfillPlan['photoReconciliations'] = [];
  const reconciledExistingMeterIds = new Set<string>();
  let alreadyMigratedMeters = 0;
  for (const board of input.boards) {
    const meters = Array.isArray(board.meters) ? board.meters : [];
    if (board.meterPresent !== (meters.length > 0)) {
      exceptions.push({
        code: 'METER_PRESENT_MISMATCH',
        severity: 'BLOCKING',
        entityType: 'board',
        entityId: board.id,
        detail: 'Legacy meterPresent disagrees with embedded meter records.',
      });
    }
    meters.forEach((rawMeter, meterIndex) => {
      const meterRecord = record(rawMeter);
      const meterId = text(meterRecord?.id);
      if (meterId && existingMeterIds.has(meterId)) {
        const existing = existingMeters.find((meter) => meter.id === meterId)!;
        const comparisonExceptions: LegacyBackfillException[] = [];
        const planned = meterRecord ? meterFromLegacy({
          installationId: input.installationId,
          board,
          meter: meterRecord,
          meterIndex,
          knownMeterIds: new Set([...existingMeterIds].filter((id) => id !== meterId)),
          knownChannelIds: new Set(
            (input.existingChannelIds ?? []).filter(
              (id) => !existing.channels.some((channel) => channel.id === id),
            ),
          ),
          exceptions: comparisonExceptions,
        }) : null;
        const identity = (meter: BackfillMeterDevice | ExistingCanonicalMeter) => JSON.stringify({
          id: meter.id,
          installedOnBoardId: meter.installedOnBoardId,
          deviceFamily: meter.deviceFamily,
          deviceModel: meter.deviceModel,
          customManufacturerName: meter.customManufacturerName,
          customModelName: meter.customModelName,
          deviceNumber: meter.deviceNumber,
          serialNumber: meter.serialNumber,
          channels: [...meter.channels].sort((left, right) => left.ordinal - right.ordinal).map((channel) => ({
            id: channel.id,
            ordinal: channel.ordinal,
            phaseLabel: channel.phaseLabel,
            purpose: channel.purpose,
            loadTypeCode: channel.loadTypeCode,
            customLoadTypeName: channel.customLoadTypeName,
            sensorRating: channel.sensorRating,
            description: channel.description,
            capabilities: channel.capabilities,
          })),
        });
        if (!planned || identity(planned) !== identity(existing)) {
          exceptions.push({
            code: 'CONFLICTING_CANONICAL_METER',
            severity: 'BLOCKING',
            entityType: 'meter',
            entityId: meterId,
            detail: 'Existing canonical meter differs from the same-ID legacy board/model/serial/channel identity.',
          });
          return;
        }
        exceptions.push(...comparisonExceptions);
        alreadyMigratedMeters += 1;
        reconciledExistingMeterIds.add(meterId);
        photoReconciliations.push({ meterId, legacyBoardId: board.id, legacyMeterIndex: meterIndex });
        return;
      }
      if (!meterRecord) {
        exceptions.push({
          code: 'AMBIGUOUS_METER_IDENTITY',
          severity: 'BLOCKING',
          entityType: 'board',
          entityId: board.id,
          detail: 'Embedded meter is not an object.',
        });
        return;
      }
      const planned = meterFromLegacy({
        installationId: input.installationId,
        board,
        meter: meterRecord,
        meterIndex,
        knownMeterIds,
        knownChannelIds,
        exceptions,
      });
      if (planned) {
        meterDevices.push(planned);
        photoReconciliations.push({
          meterId: planned.id,
          legacyBoardId: planned.legacyBoardId,
          legacyMeterIndex: planned.legacyMeterIndex,
        });
      }
    });
  }

  const meterCatalog: ExistingCanonicalMeter[] = [
    ...existingMeters,
    ...meterDevices.map((meter) => ({
      id: meter.id,
      installedOnBoardId: meter.installedOnBoardId,
      deviceFamily: meter.deviceFamily,
      deviceModel: meter.deviceModel,
      customManufacturerName: meter.customManufacturerName,
      customModelName: meter.customModelName,
      deviceNumber: meter.deviceNumber,
      serialNumber: meter.serialNumber,
      displayCode: meter.displayCode,
      channels: meter.channels.map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        purpose: channel.purpose,
        phaseLabel: channel.phaseLabel,
        loadTypeCode: channel.loadTypeCode,
        customLoadTypeName: channel.customLoadTypeName,
        sensorRating: channel.sensorRating,
        description: channel.description,
        capabilities: channel.capabilities,
      })),
    })),
  ];

  const measurementAssignments: LegacyBackfillPlan['measurementAssignments'] = [];
  const existingAssignments = input.existingAssignments ?? [];
  let alreadyMigratedAssignments = 0;
  for (const asset of input.siteAssets) {
    const references = Array.isArray(asset.meterChannels) ? asset.meterChannels : [];
    if (!asset.meterPresent && references.length === 0) continue;
    const update = siteAssetUpdates.find((item) => item.id === asset.id)!;
    const candidates = asset.meterSwitchboardId && boardIds.has(asset.meterSwitchboardId)
      ? meterCatalog.filter((meter) => meter.installedOnBoardId === asset.meterSwitchboardId)
      : [];
    if (candidates.length !== 1 || references.length === 0) {
      exceptions.push({
        code: 'AMBIGUOUS_MEASUREMENT_MAPPING',
        severity: 'BLOCKING',
        entityType: 'site_asset',
        entityId: asset.id,
        detail: 'Exact mapping requires a valid meter switchboard, exactly one stable meter there, and explicit channel labels.',
      });
      continue;
    }
    const directionValues = references.map((reference) => {
      const value = text(record(reference)?.direction)?.toUpperCase();
      return value === 'CONSUMPTION' || value === 'GENERATION' || value === 'BIDIRECTIONAL'
        ? value
        : null;
    });
    const directions = [...new Set(directionValues.filter(
      (value): value is 'CONSUMPTION' | 'GENERATION' | 'BIDIRECTIONAL' => Boolean(value),
    ))];
    if (directions.length !== 1 || directionValues.some((value) => value === null)) {
      exceptions.push({
        code: 'AMBIGUOUS_MEASUREMENT_DIRECTION',
        severity: 'BLOCKING',
        entityType: 'site_asset',
        entityId: asset.id,
        detail: 'Every mapped legacy channel must carry one explicit, consistent CONSUMPTION, GENERATION, or BIDIRECTIONAL direction.',
      });
      continue;
    }
    const meter = candidates[0];
    const selectedChannelIds: string[] = [];
    let ambiguous = false;
    for (const reference of references) {
      const item = record(reference);
      const label = text(item?.channelId) ?? text(item?.channel);
      if (!label) {
        ambiguous = true;
        break;
      }
      const ordinalMatch = /^(?:channel\s*)?(\d+)$/i.exec(label);
      const matches = meter.channels.filter((channel) => (
        channel.id === label
        || (ordinalMatch && channel.ordinal === Number(ordinalMatch[1]))
      ) && channel.purpose !== 'SPARE');
      if (matches.length !== 1 || selectedChannelIds.includes(matches[0].id)) {
        ambiguous = true;
        break;
      }
      selectedChannelIds.push(matches[0].id);
    }
    if (ambiguous || (selectedChannelIds.length !== 1 && selectedChannelIds.length !== 3)) {
      exceptions.push({
        code: 'AMBIGUOUS_MEASUREMENT_MAPPING',
        severity: 'BLOCKING',
        entityType: 'site_asset',
        entityId: asset.id,
        detail: 'Channel labels must resolve uniquely to one or three non-spare stable channels.',
      });
      continue;
    }
    const assignmentId = deterministicId(
      'assignment',
      input.installationId,
      asset.id,
      meter.id,
      ...[...selectedChannelIds].sort(),
    );
    const plannedAssignment: LegacyBackfillPlan['measurementAssignments'][number] = {
      id: assignmentId,
      meterId: meter.id,
      channelIds: selectedChannelIds,
      targetSiteAssetId: asset.id,
      phaseMode: selectedChannelIds.length === 1 ? 'SINGLE_PHASE' : 'THREE_PHASE',
      direction: directions[0],
    };
    const conflicting = existingAssignments.filter((assignment) => (
      assignment.id === assignmentId
      || assignment.targetSiteAssetId === asset.id
      || assignment.channelIds.some((id) => selectedChannelIds.includes(id))
    ));
    if (conflicting.length) {
      const exact = conflicting.length === 1
        && conflicting[0].id === assignmentId
        && conflicting[0].meterId === meter.id
        && conflicting[0].targetKind === 'SITE_ASSET'
        && conflicting[0].targetSiteAssetId === asset.id
        && conflicting[0].direction === directions[0]
        && conflicting[0].status === 'CONFIRMED'
        && conflicting[0].deletedAt === null
        && JSON.stringify([...conflicting[0].channelIds].sort()) === JSON.stringify([...selectedChannelIds].sort());
      if (!exact) {
        exceptions.push({
          code: 'CONFLICTING_CANONICAL_ASSIGNMENT',
          severity: 'BLOCKING',
          entityType: 'site_asset',
          entityId: asset.id,
          detail: 'Existing canonical assignment conflicts with the deterministic meter/channel/target/direction mapping.',
        });
        continue;
      }
      alreadyMigratedAssignments += 1;
    } else {
      measurementAssignments.push(plannedAssignment);
    }
    update.meteringStateKind = 'METERED';
    update.measurementAssignmentIds = [assignmentId];
  }

  const formUpdates: LegacyBackfillPlan['formUpdates'] = [];
  for (const form of input.forms ?? []) {
    if (form.formType !== 'ww-installation' || form.status !== 'Completed') continue;
    const answers = record(form.answers) ?? {};
    const serial = text(answers['device.id']);
    const model = text(answers['device.type']);
    const deviceNumber = text(answers['device.number']);
    const matches = meterCatalog.filter((meter) => (
      Boolean(form.boardId)
      && meter.installedOnBoardId === form.boardId
      && Boolean(serial)
      && meter.serialNumber === serial
      && Boolean(model)
      && meter.deviceModel === model
      && (!deviceNumber || meter.deviceNumber === deviceNumber)
    ));
    if (matches.length !== 1 || (form.meterId && form.meterId !== matches[0].id)) {
      exceptions.push({
        code: 'AMBIGUOUS_FORM_METER_LINK',
        severity: 'BLOCKING',
        entityType: 'installation',
        entityId: form.id,
        detail: 'Completed WW form must match exactly one stable meter by board, model, serial, and device number.',
      });
      continue;
    }
    if (form.meterId !== matches[0].id) {
      formUpdates.push({ id: form.id, meterId: matches[0].id });
    }
  }

  const displayClaims: LegacyBackfillPlan['displayClaims'] = [];
  const usedCodes = new Map<string, string>();
  const displayEntities = [
    ...input.boards.map((board) => ({
      entityType: 'board' as const,
      entityId: board.id,
      typeCode: boardUpdates.find((item) => item.id === board.id)!.typeCode,
      displayCode: text(board.displayCode),
    })),
    ...input.siteAssets.map((asset) => ({
      entityType: 'site_asset' as const,
      entityId: asset.id,
      typeCode: siteAssetUpdates.find((item) => item.id === asset.id)!.typeCode,
      displayCode: text(asset.displayCode),
    })),
    ...meterDevices.map((meter) => ({
      entityType: 'meter' as const,
      entityId: meter.id,
      typeCode: meter.deviceModel,
      displayCode: text(meter.displayCode),
    })),
    ...existingMeters.filter((meter) => reconciledExistingMeterIds.has(meter.id)).map((meter) => ({
      entityType: 'meter' as const,
      entityId: meter.id,
      typeCode: meter.deviceModel,
      displayCode: text(meter.displayCode),
    })),
  ].sort((left, right) => `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`));
  for (const entity of displayEntities) {
    if (!entity.displayCode) continue;
    const normalized = normalizeDisplayCode(entity.displayCode);
    const prior = usedCodes.get(normalized);
    if (prior) {
      exceptions.push({
        code: 'DUPLICATE_DISPLAY_CODE',
        severity: 'BLOCKING',
        entityType: entity.entityType,
        entityId: entity.entityId,
        detail: `Legacy display code conflicts with ${prior}.`,
      });
      continue;
    }
    usedCodes.set(normalized, `${entity.entityType}:${entity.entityId}`);
    const generatedPrefix = normalizeDisplayCode(`${input.siteCode}-${entity.typeCode}-`);
    const suffix = normalized.startsWith(generatedPrefix)
      ? normalized.slice(generatedPrefix.length)
      : '';
    const generated = /^\d+$/.test(suffix) && Number(suffix) > 0;
    const sequence = generated ? Number(suffix) : null;
    if (generated && entity.entityType === 'board') {
      boardUpdates.find((item) => item.id === entity.entityId)!.displayCodeOverridden = false;
    }
    if (generated && entity.entityType === 'site_asset') {
      siteAssetUpdates.find((item) => item.id === entity.entityId)!.displayCodeOverridden = false;
    }
    displayClaims.push({
      id: deterministicId('claim', input.installationId, entity.entityType, entity.entityId, normalized),
      entityType: entity.entityType,
      entityId: entity.entityId,
      typeCode: entity.typeCode,
      displayCode: entity.displayCode,
      normalizedDisplayCode: normalized,
      sequence,
      generated,
    });
  }

  exceptions.sort((left, right) => (
    `${left.severity}:${left.code}:${left.entityType}:${left.entityId}`
      .localeCompare(`${right.severity}:${right.code}:${right.entityType}:${right.entityId}`)
  ));
  return {
    installationId: input.installationId,
    expectedTreeRevision: input.expectedTreeRevision ?? 0,
    deterministicGrid,
    boardUpdates,
    siteAssetUpdates,
    displayClaims,
    meterDevices,
    photoReconciliations,
    measurementAssignments,
    formUpdates,
    alreadyMigratedMeters,
    alreadyMigratedAssignments,
    exceptions,
    promotable: !exceptions.some((exception) => exception.severity === 'BLOCKING'),
  };
}
