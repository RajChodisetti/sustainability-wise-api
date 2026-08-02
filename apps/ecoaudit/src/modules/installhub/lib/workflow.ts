import { validateForm } from '@/modules/installhub/forms/catalog';
import { createInstallHubId } from '@/modules/installhub/lib/id';
import type {
  BoardType,
  ChannelPurpose,
  DisplayCodeMetadata,
  ElectricalAsset,
  ElectricalSource,
  ElectricalTreeReadModel,
  GridSupply,
  InstallationMappingExport,
  InstallationReadiness,
  InstallationTree,
  MeasurementAssignment,
  MeasurementDirection,
  Meter,
  MeterDevice,
  MeterDeviceChannel,
  PhaseMode,
  ReadinessIssue,
  SiteAsset,
  SiteAssetMeteringState,
  SiteAssetType,
} from '@/modules/installhub/types/domain';

export const BOARD_TYPE_OPTIONS = [
  { code: 'MSB', label: 'MSB — Main Switchboard' },
  { code: 'MSSB', label: 'MSSB — Main Sub-Switchboard' },
  { code: 'DB', label: 'DB — Distribution Board' },
  { code: 'HVAC_DB', label: 'HVAC-DB — HVAC Distribution Board' },
  { code: 'LX_DB', label: 'LX-DB — Lighting Distribution Board' },
  { code: 'PV_DB', label: 'PV-DB — Solar / PV Distribution Board' },
  { code: 'MCC', label: 'MCC — Motor Control Centre' },
  { code: 'OTHER', label: 'Other' },
] as const;

export const SITE_ASSET_TYPE_OPTIONS = [
  { code: 'PV', label: 'Solar / PV' },
  { code: 'HVAC', label: 'AC / HVAC' },
  { code: 'LIGHTING', label: 'Lighting' },
  { code: 'EV_CHARGER', label: 'EV Charger' },
  { code: 'VEHICLE_HOIST', label: 'Vehicle Hoist' },
  { code: 'FORKLIFT', label: 'Forklift' },
  { code: 'EXHAUST_FAN_SYSTEM', label: 'Exhaust Fan System' },
  { code: 'POWER_OUTLET', label: 'Power Outlet' },
  { code: 'HEATER_GEYSER', label: 'Heater / Geyser' },
  { code: 'OTHER', label: 'Other' },
] as const;

export const CHANNEL_PURPOSE_OPTIONS: Array<{
  code: ChannelPurpose;
  label: string;
  description: string;
}> = [
  {
    code: 'MAIN_SUPPLY',
    label: 'Main board supply',
    description: 'Measures the incoming feed for this switchboard.',
  },
  {
    code: 'SUB_CIRCUIT',
    label: 'Sub-circuit / asset',
    description: 'Measures a child board, outgoing circuit, or site asset.',
  },
  {
    code: 'SPARE',
    label: 'Spare / unused',
    description: 'This physical input is not assigned.',
  },
];

const BOARD_LABEL_BY_CODE = new Map<string, string>(
  BOARD_TYPE_OPTIONS.map((option) => [option.code, option.label]),
);
const ASSET_LABEL_BY_CODE = new Map<string, string>(
  SITE_ASSET_TYPE_OPTIONS.map((option) => [option.code, option.label]),
);

const BOARD_CODE_BY_LEGACY: Record<string, string> = {
  MSB: 'MSB',
  MS8: 'MSB',
  'Main Snachboard': 'MSB',
  MSSB: 'MSSB',
  'Main Sub-Switchboard': 'MSSB',
  DB: 'DB',
  'HVAC-DB': 'HVAC_DB',
  'LX-DB': 'LX_DB',
  'PV-DB': 'PV_DB',
  MCC: 'MCC',
  Other: 'OTHER',
};

const ASSET_CODE_BY_LEGACY: Record<string, string> = {
  HVAC: 'HVAC',
  'AC / HVAC': 'HVAC',
  Lighting: 'LIGHTING',
  Lightning: 'LIGHTING',
  'Solar / PV': 'PV',
  'Solar PV': 'PV',
  'EV Charger': 'EV_CHARGER',
  'Vehicle Hoist': 'VEHICLE_HOIST',
  Forklift: 'FORKLIFT',
  'Forklift Charger': 'FORKLIFT',
  'Exhaust / Fan System': 'EXHAUST_FAN_SYSTEM',
  'Exhaust Fan System': 'EXHAUST_FAN_SYSTEM',
  'Power Outlet': 'POWER_OUTLET',
  'General Power': 'POWER_OUTLET',
  'Hot Water': 'HEATER_GEYSER',
  'Heater / Geyser': 'HEATER_GEYSER',
  Refrigeration: 'OTHER',
  'Compressed Air': 'OTHER',
  Other: 'OTHER',
};

export function boardTypeCode(board: Pick<ElectricalAsset, 'typeCode' | 'assetType'>): string {
  return board.typeCode || BOARD_CODE_BY_LEGACY[board.assetType] || 'OTHER';
}

export function boardTypeLabel(board: Pick<ElectricalAsset, 'typeCode' | 'assetType' | 'customTypeName'>): string {
  const code = boardTypeCode(board);
  if (code === 'OTHER') return board.customTypeName?.trim() || 'Other';
  return BOARD_LABEL_BY_CODE.get(code) || board.assetType;
}

export function legacyBoardType(code: string): BoardType {
  return ({
    HVAC_DB: 'HVAC-DB',
    LX_DB: 'LX-DB',
    PV_DB: 'PV-DB',
    OTHER: 'Other',
  } as Record<string, BoardType>)[code] || (code as BoardType);
}

export function siteAssetTypeCode(asset: Pick<SiteAsset, 'typeCode' | 'assetType'>): string {
  return asset.typeCode || ASSET_CODE_BY_LEGACY[asset.assetType] || 'OTHER';
}

export function siteAssetTypeLabel(asset: Pick<SiteAsset, 'typeCode' | 'assetType' | 'customTypeName'>): string {
  const code = siteAssetTypeCode(asset);
  if (code === 'OTHER') return asset.customTypeName?.trim() || 'Other';
  return ASSET_LABEL_BY_CODE.get(code) || asset.assetType;
}

export function legacySiteAssetType(code: string): SiteAssetType {
  return ({
    PV: 'Solar / PV',
    LIGHTING: 'Lighting',
    EV_CHARGER: 'EV Charger',
    VEHICLE_HOIST: 'Vehicle Hoist',
    FORKLIFT: 'Forklift',
    EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
    POWER_OUTLET: 'Power Outlet',
    HEATER_GEYSER: 'Heater / Geyser',
    OTHER: 'Other',
  } as Record<string, SiteAssetType>)[code] || (code as SiteAssetType);
}

export function defaultGridSupply(installationId: string, nmi?: string | null): GridSupply {
  return {
    id: `grid_${installationId}_primary`,
    installationId,
    name: 'Grid supply',
    isDefault: true,
    nmi: nmi || null,
  };
}

export function primaryGridSupply(tree: InstallationTree): GridSupply {
  const supplies = [...(tree.gridSupplies || [])].sort((left, right) => left.id.localeCompare(right.id));
  return supplies.find((supply) => supply.isDefault) || supplies[0] || defaultGridSupply(tree.installation.id);
}

export function boardElectricalSource(board: ElectricalAsset): ElectricalSource {
  if (board.electricalSource) return board.electricalSource;
  if (board.electricalParentTbc) return { kind: 'TBC' };
  if (board.electricalParentId) return { kind: 'BOARD', boardId: board.electricalParentId };
  return { kind: 'TBC' };
}

export function assetElectricalSource(asset: SiteAsset): ElectricalSource {
  if (asset.electricalSource) return asset.electricalSource;
  if (asset.electricalBoardTbc) return { kind: 'TBC' };
  if (asset.electricalBoardId) return { kind: 'BOARD', boardId: asset.electricalBoardId };
  return { kind: 'TBC' };
}

export function applyBoardElectricalSource(
  board: ElectricalAsset,
  source: ElectricalSource,
): void {
  board.electricalSource = source;
  board.electricalParentId = source.kind === 'BOARD' ? source.boardId : null;
  board.electricalParentTbc = source.kind === 'TBC';
}

export function applyAssetElectricalSource(
  asset: SiteAsset,
  source: ElectricalSource,
): void {
  asset.electricalSource = source;
  asset.electricalBoardId = source.kind === 'BOARD' ? source.boardId : null;
  asset.electricalBoardTbc = source.kind === 'TBC';
}

export function siteAssetMeteringState(asset: SiteAsset): SiteAssetMeteringState {
  if (asset.meteringState) return asset.meteringState;
  if (asset.meterSwitchboardTbc) return { kind: 'TBC' };
  if (asset.meterPresent && asset.meterId && asset.meterChannelIds?.length) {
    return {
      kind: 'METERED',
      measurementAssignmentIds: [`assignment_${asset.id}`],
    };
  }
  if (
    !asset.meterPresent &&
    !asset.meterSwitchboardId &&
    !asset.meterId &&
    !asset.meterChannelIds?.length &&
    (asset.meterChannels?.length ?? 0) === 0
  ) {
    return { kind: 'TBC' };
  }
  return { kind: 'TBC' };
}

export function displayCodeValue(
  entity: Pick<ElectricalAsset | SiteAsset, 'displayCode' | 'displayCodeMeta'>,
): string {
  return entity.displayCodeMeta?.value || entity.displayCode || '';
}

export function installationDisplayCodePrefix(value: string): string {
  const prefix = value
    .normalize('NFKD')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16)
    .replace(/-+$/g, '');
  return prefix || 'SITE';
}

export function installationSiteCode(tree: InstallationTree): string {
  if (tree.installation.siteCode?.trim()) {
    return installationDisplayCodePrefix(tree.installation.siteCode);
  }
  const words = tree.installation.siteName.match(/[A-Za-z0-9]+/g) || [];
  const initials = words.map((word) => word[0]).join('').toUpperCase().slice(0, 8);
  return initials || 'SITE';
}

export function generatedDisplayCode(
  tree: InstallationTree,
  typeCode: string,
  excludeId?: string,
): string {
  const normalizedType = typeCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'OTHER';
  const prefix = `${installationSiteCode(tree)}-${normalizedType}`;
  const values = [...tree.electricalAssets, ...tree.siteAssets]
    .filter((entity) => entity.id !== excludeId)
    .map(displayCodeValue);
  values.push(...(
    tree.meterDevices
      ? tree.meterDevices.filter((meter) => meter.id !== excludeId).map((meter) => meter.displayName.value)
      : tree.electricalAssets.flatMap((board) => board.meters.filter((meter) => meter.id !== excludeId).map((meter) => meter.deviceName))
  ));
  let next = 1;
  for (const value of values) {
    const match = value.toUpperCase().match(new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`));
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function displayCodeMetadata(
  tree: InstallationTree,
  typeCode: string,
  currentValue = '',
  current?: DisplayCodeMetadata,
  excludeId?: string,
  refreshProvisional = false,
): DisplayCodeMetadata {
  const generatedValue = generatedDisplayCode(tree, typeCode, excludeId);
  if (current) {
    return {
      ...current,
      generatedValue: refreshProvisional ? generatedValue : current.generatedValue || generatedValue,
      value: current.isOverridden
        ? current.value
        : refreshProvisional
          ? generatedValue
          : current.value || current.generatedValue || generatedValue,
    };
  }
  const value = currentValue.trim();
  return {
    value: value || generatedValue,
    generatedValue,
    isOverridden: Boolean(value && value.toUpperCase() !== generatedValue.toUpperCase()),
    ruleVersion: 1,
  };
}

export function meterChannelId(meterId: string, index: number): string {
  return `${meterId}:${index + 1}`;
}

function canonicalChannels(meter: Meter): MeterDeviceChannel[] {
  return (meter.wwChannels || []).map((channel, index) => {
    const purpose = (channel.purpose as ChannelPurpose) || 'SPARE';
    const rawLoadType = channel.loadType?.trim() || '';
    const loadTypeCode = purpose === 'SUB_CIRCUIT' && rawLoadType
      && rawLoadType !== 'Mains Supply' && rawLoadType !== 'Not Used'
      ? (ASSET_LABEL_BY_CODE.has(rawLoadType)
          ? rawLoadType
          : ASSET_CODE_BY_LEGACY[rawLoadType] || 'OTHER')
      : null;
    const customLoadTypeName = loadTypeCode === 'OTHER'
      ? channel.customLoadTypeName?.trim()
        || (rawLoadType !== 'Other' && rawLoadType !== 'OTHER' ? rawLoadType : null)
      : null;
    return {
      id: channel.id || meterChannelId(meter.id, index),
      ordinal: channel.ordinal || index + 1,
      phaseLabel: channel.phaseLabel || null,
      purpose,
      loadTypeCode,
      customLoadTypeName,
      sensorRating: channel.rogowskiSize || channel.ctRatio || null,
      description: channel.description || null,
      capabilities: channel.capabilities || {},
    };
  });
}

export function canonicalMeterDevice(
  tree: InstallationTree,
  boardId: string,
  meter: Meter,
  prior?: MeterDevice,
): MeterDevice {
  const typeCode = meter.deviceType === 'Other' ? 'OTHER' : meter.deviceType;
  const displayName = displayCodeMetadata(
    tree,
    typeCode,
    meter.deviceNameOverridden ? meter.deviceName : '',
    prior?.displayName,
    meter.id,
  );
  const priorChannels = new Map(prior?.channels.map((channel) => [channel.id, channel]));
  const channels = canonicalChannels(meter).map((channel) => ({
    ...priorChannels.get(channel.id),
    ...channel,
    phaseLabel: channel.phaseLabel ?? priorChannels.get(channel.id)?.phaseLabel ?? null,
    capabilities: Object.keys(channel.capabilities || {}).length
      ? channel.capabilities
      : priorChannels.get(channel.id)?.capabilities || {},
  }));
  return {
      id: meter.id,
      installationId: tree.installation.id,
      installedOnBoardId: boardId,
      deviceFamily: meter.deviceFamily || 'WATTWATCHERS',
      deviceModel: meter.deviceType === 'Other' ? 'OTHER' as const : meter.deviceType,
      customManufacturerName: meter.customManufacturerName || null,
      customModelName: meter.customModelName || null,
      displayName: {
        ...displayName,
        value: meter.deviceNameOverridden ? meter.deviceName : displayName.value,
        isOverridden: Boolean(meter.deviceNameOverridden),
      },
      serialNumber: meter.deviceId,
      deviceNumber: meter.deviceNumber || null,
      lifecycleState: meter.lifecycleState || 'ACTIVE',
      channels,
      commissioningData: {
        classification: meter.classification !== undefined
          ? meter.classification?.trim() || null
          : prior?.commissioningData?.classification ?? null,
        coverage: meter.coverage !== undefined
          ? meter.coverage?.trim() || null
          : prior?.commissioningData?.coverage ?? null,
        prestart: structuredClone(
          meter.wwPrestart ?? prior?.commissioningData?.prestart ?? {},
        ),
        switchboard: structuredClone(
          meter.wwSwitchboard ?? prior?.commissioningData?.switchboard ?? {},
        ),
        verification: structuredClone(
          meter.wwVerification ?? prior?.commissioningData?.verification ?? {},
        ),
        commissioning: structuredClone(
          meter.wwCommissioning ?? prior?.commissioningData?.commissioning ?? {},
        ),
      },
      wwPhotos: meter.wwPhotos as Record<string, unknown> | undefined || prior?.wwPhotos || {},
      notes: meter.notes ?? prior?.notes ?? null,
  };
}

export function meterDevices(tree: InstallationTree): MeterDevice[] {
  if (tree.meterDevices) return tree.meterDevices;
  return tree.electricalAssets.flatMap((board) =>
    board.meters.map((meter) => canonicalMeterDevice(tree, board.id, meter)),
  );
}

export function meterDeviceName(meter: MeterDevice): string {
  return meter.displayName.value || meter.serialNumber || 'Unnamed metering device';
}

export function measurementAssignments(tree: InstallationTree): MeasurementAssignment[] {
  if (tree.measurementAssignments) return tree.measurementAssignments;
  return tree.siteAssets.flatMap((asset) => {
    if (!asset.meterId || !asset.meterChannelIds?.length) return [];
    return [{
      id: `assignment_${asset.id}`,
      installationId: tree.installation.id,
      meterId: asset.meterId,
      channelIds: asset.meterChannelIds,
      phaseMode: asset.phaseMode || (asset.meterChannelIds.length === 3 ? 'THREE_PHASE' : 'SINGLE_PHASE'),
      target: { kind: 'SITE_ASSET' as const, siteAssetId: asset.id },
      direction: asset.measurementDirection || 'CONSUMPTION',
      status: 'CONFIRMED' as const,
    }];
  });
}

export function syncMeterDevice(
  tree: InstallationTree,
  boardId: string,
  meter: Meter,
): MeterDevice {
  const prior = meterDevices(tree).find((item) => item.id === meter.id);
  const device = canonicalMeterDevice(tree, boardId, meter, prior);
  const devices = meterDevices(tree).filter((item) => item.id !== meter.id);
  tree.meterDevices = [...devices, device];

  const existing = measurementAssignments(tree);
  const purposeByChannel = new Map(device.channels.map((channel) => [channel.id, channel.purpose]));
  const invalidAssignments = existing.filter((assignment) =>
    assignment.meterId === meter.id && (
      !assignment.channelIds.length ||
      assignment.channelIds.some((channelId) => !purposeByChannel.has(channelId) || purposeByChannel.get(channelId) === 'SPARE') ||
      (assignment.target.kind === 'SITE_ASSET' && assignment.channelIds.some((channelId) => purposeByChannel.get(channelId) !== 'SUB_CIRCUIT'))
    ),
  );
  const invalidAssignmentIds = new Set(invalidAssignments.map((assignment) => assignment.id));
  const invalidSiteAssetIds = new Set(
    invalidAssignments.flatMap((assignment) => assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []),
  );
  tree.measurementAssignments = existing.filter((assignment) => !invalidAssignmentIds.has(assignment.id));
  for (const asset of tree.siteAssets.filter((item) => invalidSiteAssetIds.has(item.id))) {
    asset.meteringState = { kind: 'TBC' };
    asset.meterPresent = false;
    asset.meterSwitchboardId = null;
    asset.meterSwitchboardTbc = true;
    asset.meterId = null;
    asset.meterChannelIds = [];
    asset.meterChannels = [];
    asset.phaseMode = null;
    asset.measurementDirection = null;
  }
  return device;
}

export function replaceMeterAssignments(
  tree: InstallationTree,
  meterId: string,
  desired: MeasurementAssignment[],
): void {
  const device = meterDevices(tree).find((item) => item.id === meterId);
  if (!device) throw new Error('The metering device is unavailable.');
  const prior = measurementAssignments(tree);
  const channelById = new Map(device.channels.map((channel) => [channel.id, channel]));
  const seenChannels = new Set<string>();
  const seenSiteAssetTargets = new Set<string>();
  for (const assignment of desired) {
    if (assignment.target.kind === 'SITE_ASSET') {
      if (seenSiteAssetTargets.has(assignment.target.siteAssetId)) {
        throw new Error('A site asset may have only one active measurement assignment.');
      }
      const targetSiteAssetId = assignment.target.siteAssetId;
      if (prior.some((existing) => (
        existing.meterId !== meterId
        && existing.target.kind === 'SITE_ASSET'
        && existing.target.siteAssetId === targetSiteAssetId
      ))) {
        throw new Error('This site asset is already measured by another meter. Remove or reassign that measurement explicitly first.');
      }
      seenSiteAssetTargets.add(assignment.target.siteAssetId);
    }
    const expected = assignment.phaseMode === 'SINGLE_PHASE'
      ? 1
      : assignment.phaseMode === 'THREE_PHASE'
        ? 3
        : assignment.channelIds.length;
    if (!expected || assignment.channelIds.length !== expected || new Set(assignment.channelIds).size !== expected) {
      throw new Error(`Assignment ${assignment.id} has an invalid phase grouping.`);
    }
    const purposes = new Set(assignment.channelIds.map((channelId) => channelById.get(channelId)?.purpose));
    if (purposes.size !== 1 || purposes.has(undefined) || purposes.has('SPARE')) {
      throw new Error('Each assignment must use non-spare channels with one shared purpose.');
    }
    const purpose = [...purposes][0];
    if (purpose === 'MAIN_SUPPLY' && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(assignment.target.kind)) {
      throw new Error('Main-supply channels must target the installed switchboard, a Grid boundary, or be explicitly TBC.');
    }
    if (
      purpose === 'MAIN_SUPPLY'
      && assignment.target.kind === 'BOARD'
      && assignment.target.boardId !== device.installedOnBoardId
    ) {
      throw new Error('A confirmed main-supply board total must target the switchboard where this meter is installed.');
    }
    if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'GRID_BOUNDARY') {
      throw new Error('Sub-circuit channels cannot target a Grid boundary.');
    }
    if (assignment.target.kind === 'GRID_BOUNDARY') {
      const gridSupplyId = assignment.target.gridSupplyId;
      if (!reachableGridSuppliesForBoard(tree, device.installedOnBoardId).some((supply) => supply.id === gridSupplyId)) {
        throw new Error('Grid-boundary assignments must target a Grid supply reachable upstream from the installed switchboard.');
      }
    }
    if (purpose === 'SUB_CIRCUIT' && assignment.target.kind === 'BOARD') {
      const targetIsDownstream = assignment.target.boardId !== device.installedOnBoardId
        && boardSupplyPath(tree, assignment.target.boardId).includes(device.installedOnBoardId);
      if (!targetIsDownstream) {
        throw new Error('Sub-circuit channels must target a downstream switchboard or site asset.');
      }
    }
    for (const channelId of assignment.channelIds) {
      if (!channelById.has(channelId)) throw new Error('Assignments may only use channels on this meter.');
      if (seenChannels.has(channelId)) throw new Error('A channel cannot be assigned to more than one active target.');
      seenChannels.add(channelId);
    }
  }

  const replaced = prior.filter((assignment) => assignment.meterId === meterId);
  const desiredSiteIds = new Set(
    desired.flatMap((assignment) => assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []),
  );
  const removedSiteIds = new Set(
    replaced.flatMap((assignment) => {
      const targetSiteAssetId = assignment.target.kind === 'SITE_ASSET' ? assignment.target.siteAssetId : null;
      return targetSiteAssetId && !desiredSiteIds.has(targetSiteAssetId) ? [targetSiteAssetId] : [];
    }),
  );
  tree.measurementAssignments = prior.filter((assignment) => assignment.meterId !== meterId);
  for (const asset of tree.siteAssets.filter((item) => removedSiteIds.has(item.id))) {
    setAssetMetering(tree, asset, { kind: 'TBC' });
  }

  for (const assignment of desired) {
    if (assignment.target.kind === 'SITE_ASSET') {
      const targetSiteAssetId = assignment.target.siteAssetId;
      const asset = tree.siteAssets.find((item) => item.id === targetSiteAssetId);
      if (!asset) throw new Error('The selected site asset is unavailable.');
      setAssetMetering(tree, asset, {
        kind: 'METERED',
        assignmentId: assignment.id,
        meterId,
        channelIds: assignment.channelIds,
        phaseMode: assignment.phaseMode,
        direction: assignment.direction,
      });
    } else {
      tree.measurementAssignments.push({
        ...structuredClone(assignment),
        installationId: tree.installation.id,
        meterId,
        status: assignment.target.kind === 'TBC' ? 'TBC' : 'CONFIRMED',
      });
    }
  }

}

export function assignmentForAsset(
  tree: InstallationTree,
  assetId: string,
): MeasurementAssignment | undefined {
  return measurementAssignments(tree).find(
    (assignment) =>
      assignment.target.kind === 'SITE_ASSET' &&
      assignment.target.siteAssetId === assetId,
  );
}

export function setAssetMetering(
  tree: InstallationTree,
  asset: SiteAsset,
  input:
    | { kind: 'UNMETERED' | 'TBC' }
    | {
        kind: 'METERED';
        assignmentId?: string;
        meterId: string;
        channelIds: string[];
        phaseMode: PhaseMode;
        direction: MeasurementDirection;
      },
): void {
  const current = assignmentForAsset(tree, asset.id);
  tree.measurementAssignments = measurementAssignments(tree).filter(
    (assignment) => assignment.id !== current?.id && !(
      input.kind === 'METERED' &&
      assignment.meterId === input.meterId &&
      assignment.target.kind === 'TBC' &&
      assignment.channelIds.some((channelId) => input.channelIds.includes(channelId))
    ),
  );
  if (input.kind !== 'METERED') {
    asset.meteringState = { kind: input.kind };
    asset.meterPresent = false;
    asset.meterId = null;
    asset.meterChannelIds = [];
    asset.meterChannels = [];
    asset.phaseMode = null;
    asset.measurementDirection = null;
    asset.meterSwitchboardId = null;
    asset.meterSwitchboardTbc = input.kind === 'TBC';
    return;
  }
  const meter = meterDevices(tree).find((item) => item.id === input.meterId);
  if (!meter) throw new Error('Select an available metering device.');
  const unique = [...new Set(input.channelIds)];
  const expected = input.phaseMode === 'THREE_PHASE' ? 3 : input.phaseMode === 'SINGLE_PHASE' ? 1 : unique.length;
  if (!expected || unique.length !== expected) {
    throw new Error(`Select exactly ${expected} channel${expected === 1 ? '' : 's'} for ${input.phaseMode === 'THREE_PHASE' ? 'three' : 'single'} phase.`);
  }
  const availableIds = new Set(meter.channels.filter((channel) => channel.purpose === 'SUB_CIRCUIT').map((channel) => channel.id));
  if (unique.some((id) => !availableIds.has(id))) {
    throw new Error('A selected channel is spare, unavailable, or belongs to another meter.');
  }
  const assignment: MeasurementAssignment = {
    id: input.assignmentId || current?.id || `assignment_${asset.id}`,
    installationId: tree.installation.id,
    meterId: meter.id,
    channelIds: unique,
    phaseMode: input.phaseMode,
    target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
    direction: input.direction,
    status: 'CONFIRMED',
  };
  tree.measurementAssignments.push(assignment);
  asset.meteringState = { kind: 'METERED', measurementAssignmentIds: [assignment.id] };
  asset.meterPresent = true;
  asset.meterId = meter.id;
  asset.meterChannelIds = unique;
  asset.phaseMode = input.phaseMode;
  asset.measurementDirection = input.direction;
  asset.meterSwitchboardId = meter.installedOnBoardId;
  asset.meterSwitchboardTbc = false;
  asset.meterChannels = unique.map((id) => {
    const channel = meter.channels.find((item) => item.id === id)!;
    return {
      channel: String(channel.ordinal),
      description: channel.description || channel.loadTypeCode || '',
    };
  });
}

export function ensureCanonicalTree(input: InstallationTree): InstallationTree {
  const tree = input;
  tree.treeSchemaVersion = 2;
  tree.baseTreeRevision = tree.treeRevision ?? tree.baseTreeRevision ?? 0;
  tree.treeRevision = tree.treeRevision ?? tree.baseTreeRevision ?? 0;
  tree.gridSupplies = tree.gridSupplies?.length
    ? tree.gridSupplies
    : [defaultGridSupply(tree.installation.id)];
  const selectedDefaultId = [...tree.gridSupplies]
    .filter((supply) => supply.isDefault)
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id
    || [...tree.gridSupplies].sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
  tree.gridSupplies = tree.gridSupplies.map((supply) => ({
    ...supply,
    isDefault: supply.id === selectedDefaultId,
  }));
  tree.meterDevices = meterDevices(tree);
  tree.measurementAssignments = measurementAssignments(tree).map((assignment) => ({
    ...assignment,
    installationId: tree.installation.id,
  }));
  tree.serverDerived = tree.serverDerived || { virtualMeterDefinitions: [] };

  for (const board of tree.electricalAssets) {
    const legacyTypeLabel = board.assetType;
    const runtimeDisplay = board.displayCode as unknown as string | DisplayCodeMetadata;
    if (typeof runtimeDisplay === 'object' && runtimeDisplay) {
      board.displayCodeMeta = runtimeDisplay;
      board.displayCode = runtimeDisplay.value;
    }
    board.typeCode = boardTypeCode(board);
    if (
      board.typeCode === 'OTHER'
      && !board.customTypeName?.trim()
      && legacyTypeLabel !== 'Other'
    ) {
      board.customTypeName = legacyTypeLabel;
    }
    board.assetType = legacyBoardType(board.typeCode);
    board.electricalSource = boardElectricalSource(board);
    applyBoardElectricalSource(board, board.electricalSource);
    board.displayCodeMeta = displayCodeMetadata(
      tree,
      board.typeCode,
      board.displayCode,
      board.displayCodeMeta,
      board.id,
    );
    board.displayCode = board.displayCodeMeta.value;
  }

  for (const asset of tree.siteAssets) {
    // Canonical v2 stores channel relationships in measurementAssignments.
    // Keep the legacy editor projection total because older portal views and
    // offline drafts still consume this compatibility field.
    asset.meterChannelIds = asset.meterChannelIds || [];
    asset.meterChannels = asset.meterChannels || [];
    const legacyTypeLabel = asset.assetType;
    const runtimeDisplay = asset.displayCode as unknown as string | DisplayCodeMetadata | null;
    if (typeof runtimeDisplay === 'object' && runtimeDisplay) {
      asset.displayCodeMeta = runtimeDisplay;
      asset.displayCode = runtimeDisplay.value;
    }
    asset.typeCode = siteAssetTypeCode(asset);
    if (
      asset.typeCode === 'OTHER' &&
      !asset.customTypeName?.trim() &&
      legacyTypeLabel !== 'Other'
    ) {
      asset.customTypeName = legacyTypeLabel;
    }
    asset.assetType = legacySiteAssetType(asset.typeCode);
    asset.electricalSource = assetElectricalSource(asset);
    applyAssetElectricalSource(asset, asset.electricalSource);
    asset.displayCodeMeta = displayCodeMetadata(
      tree,
      asset.typeCode,
      asset.displayCode || '',
      asset.displayCodeMeta,
      asset.id,
    );
    asset.displayCode = asset.displayCodeMeta.value;
    const assignment = assignmentForAsset(tree, asset.id);
    if (assignment) {
      asset.meterId = assignment.meterId;
      asset.meterChannelIds = [...assignment.channelIds];
      asset.phaseMode = assignment.phaseMode;
      asset.measurementDirection = assignment.direction;
      asset.meteringState = {
        kind: 'METERED',
        measurementAssignmentIds: [assignment.id],
      };
      const meter = tree.meterDevices.find((item) => item.id === assignment.meterId);
      asset.meterChannels = assignment.channelIds.map((channelId) => {
        const channel = meter?.channels.find((item) => item.id === channelId);
        return {
          channel: channel ? String(channel.ordinal) : channelId,
          description: channel?.description || channel?.loadTypeCode || '',
        };
      });
      asset.meterSwitchboardId = meter?.installedOnBoardId || null;
      asset.meterSwitchboardTbc = !meter;
      asset.meterPresent = true;
    } else {
      asset.meteringState = siteAssetMeteringState(asset);
    }
  }
  return tree;
}

export function applyAuthoritativeTreeRevision(
  tree: InstallationTree,
  value: unknown,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('The API did not return an authoritative installation revision.');
  }
  tree.treeRevision = value;
  tree.baseTreeRevision = value;
  tree.installation.treeRevision = value;
  return value;
}

export function normalizeInstallationTree(input: InstallationTree): InstallationTree {
  return ensureCanonicalTree(structuredClone(input));
}

export function serializeInstallationTree(input: InstallationTree): Record<string, unknown> {
  const tree = ensureCanonicalTree(structuredClone(input));
  const wire = structuredClone(tree) as unknown as Record<string, unknown>;
  wire.installation = {
    ...tree.installation,
    treeSchemaVersion: 2,
    treeRevision: tree.treeRevision ?? tree.installation.treeRevision ?? 0,
    recordVersionNumber: tree.recordVersionNumber
      ?? tree.installation.recordVersionNumber
      ?? 0,
  };
  wire.electricalAssets = tree.electricalAssets.map((board) => ({
    ...board,
    displayCode: board.displayCodeMeta,
  }));
  wire.siteAssets = tree.siteAssets.map((asset) => ({
    ...asset,
    displayCode: asset.displayCodeMeta,
  }));
  wire.formSubmissions = tree.formSubmissions.map((form) => ({
    ...form,
    // Canonical v2 requires an explicit boolean. Fresh portal drafts and
    // older local snapshots may omit the server-owned historical marker.
    historicalMeterRemoved: form.historicalMeterRemoved === true,
  }));
  // Virtual definitions are calculated by the API from the authoritative
  // electrical/measurement graph. Keep them in the read model for display,
  // but never echo them into a client write.
  wire.serverDerived = { virtualMeterDefinitions: [] };
  return wire;
}

export function boardDescendantIds(tree: InstallationTree, boardId: string): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const board of tree.electricalAssets) {
      const source = boardElectricalSource(board);
      if (
        source.kind === 'BOARD' &&
        (source.boardId === boardId || descendants.has(source.boardId)) &&
        !descendants.has(board.id)
      ) {
        descendants.add(board.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export function validBoardParents(tree: InstallationTree, boardId: string): ElectricalAsset[] {
  const descendants = boardDescendantIds(tree, boardId);
  return tree.electricalAssets
    .filter((board) => board.id !== boardId && !descendants.has(board.id))
    .sort((left, right) =>
      `${displayCodeValue(left)} ${left.assetName}`.localeCompare(
        `${displayCodeValue(right)} ${right.assetName}`,
      ),
    );
}

export function boardSupplyPath(tree: InstallationTree, boardId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = tree.electricalAssets.find((board) => board.id === boardId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current.id);
    const source = boardElectricalSource(current);
    if (source.kind !== 'BOARD') break;
    current = tree.electricalAssets.find((board) => board.id === source.boardId);
  }
  return path;
}

export function reachableGridSuppliesForBoard(
  tree: InstallationTree,
  boardId: string,
): GridSupply[] {
  const reachableIds = new Set<string>();
  for (const pathBoardId of boardSupplyPath(tree, boardId)) {
    const board = tree.electricalAssets.find((item) => item.id === pathBoardId);
    const source = board ? boardElectricalSource(board) : null;
    if (source?.kind === 'GRID') reachableIds.add(source.gridSupplyId);
  }
  return (tree.gridSupplies || [])
    .filter((supply) => reachableIds.has(supply.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function assetElectricalAncestorIds(tree: InstallationTree, asset: SiteAsset): string[] {
  const source = assetElectricalSource(asset);
  if (source.kind === 'GRID') return [source.gridSupplyId];
  if (source.kind !== 'BOARD') return [];
  const ancestors = boardSupplyPath(tree, source.boardId);
  const terminalBoard = tree.electricalAssets.find(
    (board) => board.id === ancestors[ancestors.length - 1],
  );
  const terminalSource = terminalBoard ? boardElectricalSource(terminalBoard) : undefined;
  if (terminalSource?.kind === 'GRID') ancestors.push(terminalSource.gridSupplyId);
  return ancestors;
}

export function meterBoardsForAsset(tree: InstallationTree, asset: SiteAsset): ElectricalAsset[] {
  const source = assetElectricalSource(asset);
  if (source.kind === 'GRID') return [];
  if (source.kind !== 'BOARD') return tree.electricalAssets;
  const allowed = new Set(boardSupplyPath(tree, source.boardId));
  return tree.electricalAssets.filter((board) => allowed.has(board.id));
}

function issue(
  code: string,
  entityType: ReadinessIssue['entityType'],
  entityId: string,
  message: string,
  candidateIds?: string[],
): ReadinessIssue {
  return {
    code,
    severity: 'ERROR',
    entityType,
    entityId,
    message,
    candidateIds,
  };
}

export function localReadiness(input: InstallationTree): InstallationReadiness {
  const tree = normalizeInstallationTree(input);
  const issues: ReadinessIssue[] = [];
  const boardIds = new Set(tree.electricalAssets.map((board) => board.id));
  const gridIds = new Set((tree.gridSupplies || []).map((grid) => grid.id));
  const devices = meterDevices(tree);
  const assignments = measurementAssignments(tree);
  const displayOwners = [
    ...tree.electricalAssets.map((entity) => ({ id: entity.id, code: displayCodeValue(entity).trim().toUpperCase() })),
    ...tree.siteAssets.map((entity) => ({ id: entity.id, code: displayCodeValue(entity).trim().toUpperCase() })),
    ...devices.map((entity) => ({ id: entity.id, code: entity.displayName.value.trim().toUpperCase() })),
  ];
  const duplicateCandidates = (code: string, entityId: string) => displayOwners
    .filter((owner) => owner.code === code && owner.id !== entityId)
    .map((owner) => owner.id)
    .sort()
    .slice(0, 100);
  if (!tree.installation.externalKey?.trim()) {
    issues.push(issue('EXTERNAL_KEY_REQUIRED', 'installation', tree.installation.id, 'Server reconciliation must allocate the immutable installation external key.'));
  }
  if (!tree.gridSupplies?.length) {
    issues.push(issue('GRID_SUPPLY_INVALID', 'installation', tree.installation.id, 'Installation requires exactly one active default Grid supply.'));
  } else if (tree.gridSupplies.filter((supply) => supply.isDefault).length !== 1) {
    issues.push(issue('GRID_SUPPLY_INVALID', 'installation', tree.installation.id, 'Installation requires exactly one active default Grid supply.'));
  }

  for (const board of tree.electricalAssets) {
    const source = boardElectricalSource(board);
    if (source.kind === 'TBC') {
      issues.push(issue('SUPPLY_TBC', 'board', board.id, 'Choose Grid or the confirmed parent switchboard.', validBoardParents(tree, board.id).map((item) => item.id)));
    } else if (source.kind === 'BOARD' && !boardIds.has(source.boardId)) {
      issues.push(issue('SUPPLY_SOURCE_INVALID', 'board', board.id, 'The selected parent switchboard is unavailable.'));
    } else if (source.kind === 'GRID' && !gridIds.has(source.gridSupplyId)) {
      issues.push(issue('GRID_SUPPLY_INVALID', 'board', board.id, 'The selected Grid supply is unavailable.'));
    }
    if (source.kind === 'BOARD' && boardDescendantIds(tree, board.id).has(source.boardId)) {
      issues.push(issue('ELECTRICAL_CYCLE', 'board', board.id, 'This parent would create an electrical cycle.'));
    }
    if (boardTypeCode(board) === 'OTHER' && !board.customTypeName?.trim()) {
      issues.push(issue('CUSTOM_TYPE_REQUIRED', 'board', board.id, 'Enter the custom switchboard type.'));
    }
    const code = displayCodeValue(board).trim().toUpperCase();
    if (!code || code.length > 64 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) issues.push(issue('DISPLAY_CODE_INVALID', 'board', board.id, 'Display code must be 1-64 characters using letters, digits, period, underscore or hyphen.'));
    else if (duplicateCandidates(code, board.id).length) issues.push(issue('DISPLAY_CODE_DUPLICATE', 'board', board.id, `Display code ${code} is already used.`, duplicateCandidates(code, board.id)));
    if (board.meterPresent && !meterDevices(tree).some((meter) => meter.installedOnBoardId === board.id && meter.lifecycleState !== 'INACTIVE')) {
      issues.push(issue('METER_PRESENT_MISMATCH', 'board', board.id, 'The switchboard says a meter is installed, but no active metering device exists.'));
    }
  }

  for (const meter of devices) {
    const code = meter.displayName.value.trim().toUpperCase();
    if (!code || code.length > 64 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) issues.push(issue('DISPLAY_CODE_INVALID', 'meter', meter.id, 'Display code must be 1-64 characters using letters, digits, period, underscore or hyphen.'));
    else if (duplicateCandidates(code, meter.id).length) issues.push(issue('DISPLAY_CODE_DUPLICATE', 'meter', meter.id, `Display code ${code} is already used.`, duplicateCandidates(code, meter.id)));
    if (!meter.serialNumber.trim()) issues.push(issue('METER_DEVICE_REQUIRED', 'meter', meter.id, 'Enter the metering-device serial number.'));
    if (meter.deviceFamily === 'OTHER' && !meter.customManufacturerName?.trim()) {
      issues.push(issue('CUSTOM_TYPE_REQUIRED', 'meter', meter.id, 'Enter the custom meter manufacturer.'));
    }
    if (meter.deviceModel === 'OTHER' && !meter.customModelName?.trim()) {
      issues.push(issue('CUSTOM_TYPE_REQUIRED', 'meter', meter.id, 'Enter the custom meter model.'));
    }
    const expectedCount = meter.deviceModel === 'A3RM' ? 3 : meter.deviceModel === 'A6M' ? 6 : null;
    if (expectedCount !== null && meter.channels.length !== expectedCount) {
      issues.push(issue('CHANNEL_NOT_FOUND', 'meter', meter.id, `${meter.deviceModel} requires exactly ${expectedCount} channels.`));
    }
    if (meter.deviceModel === 'OTHER' && meter.channels.length < 1) {
      issues.push({
        ...issue('METER_CAPABILITY_REQUIRED', 'meter', meter.id, 'Add at least one explicit custom-meter channel with capabilities.'),
        field: 'channels',
      });
    }
    const ordinals = new Set<number>();
    for (const channel of meter.channels) {
      if (!Number.isInteger(channel.ordinal) || channel.ordinal < 1) {
        issues.push(issue('CHANNEL_NOT_FOUND', 'channel', channel.id, 'Channel ordinal must be a stable positive integer.'));
      } else if (ordinals.has(channel.ordinal)) {
        issues.push(issue('CHANNEL_DUPLICATE_ASSIGNMENT', 'channel', channel.id, 'Channel ordinal must be unique within a meter.'));
      }
      ordinals.add(channel.ordinal);
      if (channel.purpose === 'SPARE' && (
        channel.loadTypeCode || channel.customLoadTypeName || channel.sensorRating || channel.description
      )) {
        issues.push(issue('CHANNEL_PURPOSE_CONFLICT', 'channel', channel.id, `Clear load, sensor, and description data from spare channel ${channel.ordinal}.`));
      }
      if (channel.loadTypeCode === 'OTHER' && !channel.customLoadTypeName?.trim()) {
        issues.push(issue('CUSTOM_TYPE_REQUIRED', 'channel', channel.id, `Enter the custom load type for channel ${channel.ordinal}.`));
      }
      if (
        meter.deviceModel === 'OTHER'
        && (
          !Object.keys(channel.capabilities || {}).length
          || Object.entries(channel.capabilities || {}).some(([key, value]) => !key.trim() || (typeof value === 'string' && !value.trim()) || value === null || value === undefined)
        )
      ) {
        issues.push({
          ...issue('METER_CAPABILITY_REQUIRED', 'channel', channel.id, `Custom channel ${channel.ordinal} requires explicit non-empty capabilities.`),
          field: 'capabilities',
        });
      }
    }
  }
  const usedChannels = new Map<string, string>();
  for (const asset of tree.siteAssets) {
    const source = assetElectricalSource(asset);
    if (source.kind === 'TBC') {
      issues.push(issue('SUPPLY_TBC', 'site_asset', asset.id, 'Choose Grid or the confirmed supplying switchboard.', tree.electricalAssets.map((item) => item.id)));
    } else if (source.kind === 'BOARD' && !boardIds.has(source.boardId)) {
      issues.push(issue('SUPPLY_SOURCE_INVALID', 'site_asset', asset.id, 'The supplying switchboard is unavailable.'));
    } else if (source.kind === 'GRID' && !gridIds.has(source.gridSupplyId)) {
      issues.push(issue('GRID_SUPPLY_INVALID', 'site_asset', asset.id, 'The selected Grid supply is unavailable.'));
    }
    if (siteAssetTypeCode(asset) === 'OTHER' && !asset.customTypeName?.trim()) {
      issues.push(issue('CUSTOM_TYPE_REQUIRED', 'site_asset', asset.id, 'Enter the custom site-asset type.'));
    }
    const code = displayCodeValue(asset).trim().toUpperCase();
    if (!code || code.length > 64 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) issues.push(issue('DISPLAY_CODE_INVALID', 'site_asset', asset.id, 'Display code must be 1-64 characters using letters, digits, period, underscore or hyphen.'));
    else if (duplicateCandidates(code, asset.id).length) issues.push(issue('DISPLAY_CODE_DUPLICATE', 'site_asset', asset.id, `Display code ${code} is already used.`, duplicateCandidates(code, asset.id)));
    const state = siteAssetMeteringState(asset);
    if (state.kind === 'TBC') {
      issues.push(issue('METERING_STATE_INVALID', 'site_asset', asset.id, 'Confirm whether this asset is metered or unmetered.'));
    }
    if (state.kind === 'METERED') {
      const assignment = assignments.find((item) => state.measurementAssignmentIds.includes(item.id));
      if (!assignment) {
        issues.push(issue('METER_DEVICE_REQUIRED', 'site_asset', asset.id, 'Select an exact meter and channel group.'));
      }
    }
  }

  for (const assignment of assignments) {
    if (assignment.status === 'TBC' || assignment.target.kind === 'TBC') {
      issues.push(issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment', assignment.id, 'Choose the confirmed target for this sub-circuit channel.'));
    }
    const meter = devices.find((item) => item.id === assignment.meterId);
    if (!meter) {
      issues.push(issue('METER_DEVICE_REQUIRED', 'measurement_assignment', assignment.id, 'The selected metering device is unavailable.'));
      continue;
    }
    if (assignment.target.kind === 'GRID_BOUNDARY') {
      const gridSupplyId = assignment.target.gridSupplyId;
      if (!reachableGridSuppliesForBoard(tree, meter.installedOnBoardId).some((supply) => supply.id === gridSupplyId)) {
        issues.push(issue('METER_BOARD_MISMATCH', 'measurement_assignment', assignment.id, 'Grid boundary must be reachable upstream from the meter installation board.'));
      }
    }
    const expected = assignment.phaseMode === 'THREE_PHASE' ? 3 : assignment.phaseMode === 'SINGLE_PHASE' ? 1 : assignment.channelIds.length;
    if (assignment.channelIds.length !== expected || new Set(assignment.channelIds).size !== expected) {
      issues.push(issue('PHASE_GROUP_INVALID', 'measurement_assignment', assignment.id, `Select ${expected} distinct channel${expected === 1 ? '' : 's'} from one meter.`));
    }
    for (const channelId of assignment.channelIds) {
      const channel = meter.channels.find((item) => item.id === channelId);
      if (!channel) issues.push(issue('CHANNEL_NOT_FOUND', 'measurement_assignment', assignment.id, `Channel ${channelId} is unavailable.`));
      else if (channel.purpose === 'SPARE') issues.push(issue('CHANNEL_PURPOSE_CONFLICT', 'measurement_assignment', assignment.id, `Channel ${channel.ordinal} is marked spare.`));
      const prior = usedChannels.get(channelId);
      if (prior && prior !== assignment.id) issues.push(issue('CHANNEL_DUPLICATE_ASSIGNMENT', 'measurement_assignment', assignment.id, `Channel ${channelId} is already assigned.`));
      else usedChannels.set(channelId, assignment.id);
    }
  }

  for (const meter of devices) {
    for (const channel of meter.channels) {
      if (channel.purpose === 'SPARE' || usedChannels.has(channel.id)) continue;
      issues.push({
        ...issue('CHANNEL_UNASSIGNED', 'channel', channel.id, 'Every non-spare meter channel must belong to exactly one measurement assignment.'),
        field: 'measurementAssignments',
      });
    }
  }

  for (const form of tree.formSubmissions.filter((item) => item.status !== 'Completed')) {
    if (form.formType === 'ww-installation' && !form.boardId) {
      issues.push(issue('FORM_CONTEXT_REQUIRED', 'form', form.id, 'Choose a switchboard before completing this Installation Form (WW).'));
    }
    const validationDetail = validateForm(form).length ? ' Required fields or evidence are also incomplete.' : '';
    issues.push(issue('FORM_INCOMPLETE', 'form', form.id, `Complete or remove this draft form before installation completion.${validationDetail}`));
  }

  const completedWwMeterIds = new Set(
    tree.formSubmissions
      .filter((form) => form.status === 'Completed' && form.formType === 'ww-installation' && form.meterId)
      .map((form) => form.meterId!),
  );
  for (const meter of devices) {
    const requiresWwCommissioning = meter.deviceFamily === 'WATTWATCHERS'
      && (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M');
    if (requiresWwCommissioning && !completedWwMeterIds.has(meter.id)) {
      issues.push({
        ...issue('METER_DEVICE_REQUIRED', 'meter', meter.id, 'Meter requires a completed WW installation form linked by stable meter ID.'),
        field: 'formSubmission',
      });
    }
  }

  const timezoneValid = (() => {
    if (!tree.installation.timezone) return false;
    try {
      new Intl.DateTimeFormat('en-AU', { timeZone: tree.installation.timezone }).format(0);
      return true;
    } catch {
      return false;
    }
  })();
  if (!timezoneValid) {
    issues.push({
      code: 'TIMEZONE_REQUIRED_FOR_EXPORT',
      severity: 'WARNING',
      entityType: 'installation',
      entityId: tree.installation.id,
      field: 'timezone',
      message: 'A valid IANA timezone is required for authoritative export.',
    });
  }
  const locallyConsistent = !issues.some((item) => item.severity === 'ERROR');
  return {
    installationId: tree.installation.id,
    authority: 'LOCAL_ADVISORY',
    locallyConsistent,
    treeRevision: tree.treeRevision || 0,
    recordVersionNumber: tree.recordVersionNumber,
    readyToComplete: false,
    eligibility: {
      draftDiagnosticReport: true,
      authoritativeReport: false,
      mappingExport: false,
      dataDomeDelivery: false,
    },
    issues,
  };
}

export function localElectricalTree(input: InstallationTree): ElectricalTreeReadModel {
  const tree = normalizeInstallationTree(input);
  const readiness = localReadiness(tree);
  const nodes: ElectricalTreeReadModel['nodes'] = [
    ...(tree.gridSupplies || []).map((grid) => ({ id: grid.id, kind: 'GRID' as const, name: grid.name })),
    ...tree.electricalAssets.map((board) => ({
      id: board.id,
      kind: 'BOARD' as const,
      name: board.assetName,
      displayCode: displayCodeValue(board),
      typeLabel: boardTypeLabel(board),
      physicalLocationId: board.zoneId,
    })),
    ...tree.siteAssets.map((asset) => ({
      id: asset.id,
      kind: 'SITE_ASSET' as const,
      name: asset.assetName,
      displayCode: displayCodeValue(asset),
      typeLabel: siteAssetTypeLabel(asset),
      physicalLocationId: asset.zoneId,
      coverageState: coverageState(tree, asset),
    })),
    ...(tree.serverDerived?.virtualMeterDefinitions || []).map((definition) => ({
      id: definition.id,
      kind: 'VIRTUAL_RESIDUAL' as const,
      name: `Shared, unallocated residual at ${definition.parentNodeId}`,
      displayCode: `VIRTUAL-${definition.id.replace(/^virtual_/, '').toUpperCase()}`,
      coverageState: 'UNALLOCATED',
    })),
  ];
  const edges: ElectricalTreeReadModel['edges'] = [];
  const unresolved: ElectricalTreeReadModel['unresolved'] = [];
  for (const board of tree.electricalAssets) {
    const source = boardElectricalSource(board);
    if (source.kind === 'GRID') edges.push({ id: `supply_${board.id}`, sourceNodeId: source.gridSupplyId, targetNodeId: board.id, relationship: 'FED_FROM' });
    else if (source.kind === 'BOARD') edges.push({ id: `supply_${board.id}`, sourceNodeId: source.boardId, targetNodeId: board.id, relationship: 'FED_FROM' });
    else unresolved.push({ id: `unresolved_supply_${board.id}`, subjectType: 'BOARD', subjectId: board.id, relation: 'SUPPLY', missingEnd: 'SOURCE', reason: 'TBC' });
  }
  for (const asset of tree.siteAssets) {
    const source = assetElectricalSource(asset);
    if (source.kind === 'GRID') edges.push({ id: `supply_${asset.id}`, sourceNodeId: source.gridSupplyId, targetNodeId: asset.id, relationship: 'FED_FROM' });
    else if (source.kind === 'BOARD') edges.push({ id: `supply_${asset.id}`, sourceNodeId: source.boardId, targetNodeId: asset.id, relationship: 'FED_FROM' });
    else unresolved.push({ id: `unresolved_supply_${asset.id}`, subjectType: 'SITE_ASSET', subjectId: asset.id, relation: 'SUPPLY', missingEnd: 'SOURCE', reason: 'TBC' });
  }
  for (const assignment of measurementAssignments(tree)) {
    const meter = meterDevices(tree).find((item) => item.id === assignment.meterId);
    const targetId = assignment.target.kind === 'BOARD'
      ? assignment.target.boardId
      : assignment.target.kind === 'SITE_ASSET'
        ? assignment.target.siteAssetId
        : assignment.target.kind === 'GRID_BOUNDARY'
          ? assignment.target.gridSupplyId
          : undefined;
    if (meter && targetId) edges.push({ id: `measure_${assignment.id}`, sourceNodeId: meter.installedOnBoardId, targetNodeId: targetId, relationship: 'MEASURES' });
    else unresolved.push({ id: `unresolved_measure_${assignment.id}`, subjectType: 'MEASUREMENT_ASSIGNMENT', subjectId: assignment.id, relation: 'MEASUREMENT', missingEnd: targetId ? 'SOURCE' : 'TARGET', knownNodeId: targetId, reason: assignment.target.kind === 'TBC' ? 'TBC' : 'ORPHAN' });
  }
  return {
    installationId: tree.installation.id,
    treeRevision: readiness.treeRevision,
    recordVersionNumber: tree.recordVersionNumber,
    nodes,
    edges,
    unresolved,
  };
}

export function coverageState(tree: InstallationTree, asset: SiteAsset): 'DIRECT' | 'VIRTUAL' | 'UNMETERED' | 'TBC' {
  const state = siteAssetMeteringState(asset);
  if (state.kind === 'METERED') return 'DIRECT';
  if (state.kind === 'UNMETERED') {
    const virtual = tree.serverDerived?.virtualMeterDefinitions.some(
      (definition) => assetElectricalAncestorIds(tree, asset).includes(definition.parentNodeId),
    );
    return virtual ? 'VIRTUAL' : 'UNMETERED';
  }
  return 'TBC';
}

export function localMappingExport(input: InstallationTree): InstallationMappingExport {
  const tree = normalizeInstallationTree(input);
  const electrical = localElectricalTree(tree);
  const readiness = localReadiness(tree);
  return {
    schema: 'installation-mapping/v1',
    authority: 'LOCAL_ADVISORY',
    installation: {
      id: tree.installation.id,
      externalKey: tree.installation.externalKey || '',
      recordVersionNumber: tree.recordVersionNumber || 0,
      canonicalizerVersion: 1,
      validatorVersion: 1,
      taxonomyCatalogVersion: 1,
      siteName: tree.installation.siteName,
      timezone: tree.installation.timezone || '',
      completedAt: tree.installation.completedAt || undefined,
    },
    physicalLocations: tree.zones.map((zone) => ({ id: zone.id, name: zone.zoneName, description: zone.zoneDescription || undefined })),
    electricalNodes: electrical.nodes,
    supplyEdges: electrical.edges.filter((edge) => edge.relationship === 'FED_FROM').map(({ id, sourceNodeId, targetNodeId }) => ({ id, sourceNodeId, targetNodeId })),
    unresolvedRelationships: electrical.unresolved,
    meters: meterDevices(tree).map((meter) => ({ id: meter.id, installedOnBoardId: meter.installedOnBoardId, model: meter.deviceModel, serialNumber: meter.serialNumber })),
    channels: meterDevices(tree).flatMap((meter) => meter.channels.map((channel) => ({ ...channel, meterId: meter.id }))),
    measurementAssignments: measurementAssignments(tree),
    assetCoverage: tree.siteAssets.map((asset) => {
      const state = coverageState(tree, asset);
      const assignment = assignmentForAsset(tree, asset.id);
      return {
        assetId: asset.id,
        state,
        ...(state === 'DIRECT' && assignment ? { source: { kind: 'MEASUREMENT_ASSIGNMENT', id: assignment.id } } : {}),
      };
    }),
    virtualMeters: tree.serverDerived?.virtualMeterDefinitions || [],
    readiness,
  };
}

export type DependencyPreview = {
  heading: string;
  consequences: string[];
  blocked: boolean;
};

export function boardDependencyPreview(tree: InstallationTree, boardId: string): DependencyPreview {
  const board = tree.electricalAssets.find((item) => item.id === boardId);
  const meters = meterDevices(tree).filter((item) => item.installedOnBoardId === boardId);
  const meterIds = new Set(meters.map((item) => item.id));
  const childBoards = tree.electricalAssets.filter((item) => {
    const source = boardElectricalSource(item);
    return source.kind === 'BOARD' && source.boardId === boardId;
  });
  const suppliedAssets = tree.siteAssets.filter((item) => {
    const source = assetElectricalSource(item);
    return source.kind === 'BOARD' && source.boardId === boardId;
  });
  const assignments = measurementAssignments(tree).filter((item) => meterIds.has(item.meterId));
  const forms = tree.formSubmissions.filter((item) => item.boardId === boardId || meterIds.has(item.meterId || ''));
  const consequences = [
    `${childBoards.length} child switchboard${childBoards.length === 1 ? '' : 's'} will require reconciliation`,
    `${suppliedAssets.length} supplied site asset${suppliedAssets.length === 1 ? '' : 's'} will require reconciliation`,
    `${meters.length} metering device${meters.length === 1 ? '' : 's'} will leave the active register`,
    `${assignments.length} active channel assignment${assignments.length === 1 ? '' : 's'} will become TBC`,
    `${forms.length} linked form${forms.length === 1 ? '' : 's'} and their evidence remain in history`,
  ];
  return {
    heading: `Change dependencies for ${board?.assetName || 'this switchboard'}?`,
    consequences,
    blocked: tree.installation.status === 'Completed',
  };
}

export function meterDependencyPreview(tree: InstallationTree, meterId: string): DependencyPreview {
  const meter = meterDevices(tree).find((item) => item.id === meterId);
  const assignments = measurementAssignments(tree).filter((item) => item.meterId === meterId);
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const affectedAssets = tree.siteAssets.filter((asset) => (
    asset.meteringState?.kind === 'METERED'
    && asset.meteringState.measurementAssignmentIds.some((id) => assignmentIds.has(id))
  ));
  const forms = tree.formSubmissions.filter((item) => item.meterId === meterId);
  const draftForms = forms.filter((item) => item.status === 'Draft');
  const completedForms = forms.filter((item) => item.status === 'Completed');
  const pinnedVersion = tree.recordVersionNumber;
  return {
    heading: `Change dependencies for ${meter ? meterDeviceName(meter) : 'this metering device'}?`,
    consequences: [
      `${meter?.channels.length ?? 0} active channel${meter?.channels.length === 1 ? '' : 's'} will be soft-deleted`,
      `${assignments.length} active assignment${assignments.length === 1 ? '' : 's'} will be soft-deleted`,
      `${affectedAssets.length} assigned site asset${affectedAssets.length === 1 ? '' : 's'} will return to TBC`,
      `${draftForms.length} linked draft form${draftForms.length === 1 ? '' : 's'} will be soft-deleted`,
      completedForms.length
        ? `${completedForms.length} completed WW form${completedForms.length === 1 ? '' : 's'}, meter identity, and media remain immutable${pinnedVersion ? ` in pinned record version ${pinnedVersion}` : ' in pinned version history'}`
        : 'No completed commissioning form is linked to this meter',
    ],
    blocked: tree.installation.status === 'Completed',
  };
}

export function meterEditorHasChanges(
  draft: Meter,
  source: Meter | undefined,
  draftAssignments: MeasurementAssignment[],
  sourceAssignments: MeasurementAssignment[],
  mode: 'new' | 'edit',
): boolean {
  if (mode === 'new') return true;
  if (!source) return false;
  return JSON.stringify(draft) !== JSON.stringify(source)
    || JSON.stringify(draftAssignments) !== JSON.stringify(sourceAssignments);
}

export function reconcileRemovedMeter(tree: InstallationTree, meterId: string): void {
  const impacted = measurementAssignments(tree).filter((assignment) => assignment.meterId === meterId);
  const impactedAssetIds = new Set(
    impacted.flatMap((assignment) => assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []),
  );
  tree.measurementAssignments = measurementAssignments(tree).filter((assignment) => assignment.meterId !== meterId);
  tree.meterDevices = meterDevices(tree).filter((meter) => meter.id !== meterId);
  for (const board of tree.electricalAssets) {
    board.meters = board.meters.filter((meter) => meter.id !== meterId);
    board.meterPresent = board.meters.length > 0;
  }
  for (const asset of tree.siteAssets.filter((item) => impactedAssetIds.has(item.id))) {
    setAssetMetering(tree, asset, { kind: 'TBC' });
  }
}

export function idempotencyKey(prefix: string, revision: number): string {
  return `${prefix}-${revision}-${createInstallHubId('request')}`;
}
