import { createHash } from 'node:crypto';

export const INSTALLATION_TREE_SCHEMA_VERSION = 2 as const;
export const INSTALLATION_CANONICALIZER_VERSION = 'installation-canonical-v2.4';
export const INSTALLATION_VALIDATOR_VERSION = 'installation-readiness-v2.2';
export const INSTALLATION_TAXONOMY_VERSION = 'installation-taxonomy-2026-08-05';
export const DISPLAY_CODE_RULE_VERSION = 2;
export const INSTALLATION_SITE_CODE_MAX_LENGTH = 16;
export const INSTALLATION_SITE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const INSTALLATION_ZONE_CODE_MAX_LENGTH = 16;
export const INSTALLATION_ZONE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const DISPLAY_CODE_MAX_LENGTH = 64;
export const VIRTUAL_METER_FORMULA_VERSION = 1;

export const BOARD_TYPE_CODES = [
  'MSB',
  'MSSB',
  'DB',
  'HVAC_DB',
  'LX_DB',
  'PV_DB',
  'MCC',
  'OTHER',
] as const;

export const SITE_ASSET_TYPE_CODES = [
  'PV',
  'HVAC',
  'LIGHTING',
  'EV_CHARGER',
  'VEHICLE_HOIST',
  'FORKLIFT',
  'EXHAUST_FAN_SYSTEM',
  'POWER_OUTLET',
  'HEATER_GEYSER',
  'REFRIGERATION',
  'COMPRESSED_AIR',
  'OTHER',
] as const;

export type BoardTypeCode = (typeof BOARD_TYPE_CODES)[number];
export type SiteAssetTypeCode = (typeof SITE_ASSET_TYPE_CODES)[number];
export type ReadinessIssueCode =
  | 'EXTERNAL_KEY_REQUIRED'
  | 'SUPPLY_TBC'
  | 'SUPPLY_SOURCE_INVALID'
  | 'GRID_SUPPLY_INVALID'
  | 'ELECTRICAL_CYCLE'
  | 'DISPLAY_CODE_DUPLICATE'
  | 'DISPLAY_CODE_INVALID'
  | 'CUSTOM_TYPE_REQUIRED'
  | 'METER_DEVICE_REQUIRED'
  | 'METER_CAPABILITY_REQUIRED'
  | 'METER_BOARD_MISMATCH'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_UNASSIGNED'
  | 'CHANNEL_DUPLICATE_ASSIGNMENT'
  | 'CHANNEL_PURPOSE_CONFLICT'
  | 'PHASE_GROUP_INVALID'
  | 'SENSOR_RATING_INVALID'
  | 'METER_PRESENT_MISMATCH'
  | 'METERING_STATE_INVALID'
  | 'MEASUREMENT_TARGET_TBC'
  | 'FORM_CONTEXT_REQUIRED'
  | 'FORM_INCOMPLETE'
  | 'FORM_CONTRACT_INVALID'
  | 'COMPLETED_FORM_IMMUTABLE'
  | 'EVIDENCE_NOT_CONFIRMED'
  | 'TIMEZONE_REQUIRED_FOR_EXPORT'
  | 'VIRTUAL_METER_SOURCE_INCOMPLETE';

export type DisplayCode = {
  value: string;
  generatedValue: string;
  isOverridden: boolean;
  ruleVersion: number;
  overrideReason?: string;
  provisional?: boolean;
};

export type ElectricalSource =
  | { kind: 'GRID'; gridSupplyId: string }
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'TBC' };

export type MeteringState =
  | { kind: 'METERED'; measurementAssignmentIds: string[] }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

export type MeasurementTarget =
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'SITE_ASSET'; siteAssetId: string }
  | { kind: 'GRID_BOUNDARY'; gridSupplyId: string }
  | { kind: 'TBC' };

export type CanonicalInstallation = {
  id: string;
  externalKey: string;
  siteCode: string;
  timezone: string;
  clientName: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate: string;
  status: 'Draft' | 'Completed';
  treeSchemaVersion: 2;
  treeRevision: number;
  recordVersionNumber: number;
  createdByUserId?: string | null;
  assignedInspectorUserId?: string | null;
  completedAt?: string | null;
  completedByUserId?: string | null;
  completedFromRevision?: number | null;
  reopenedAt?: string | null;
  reopenedByUserId?: string | null;
  reopenedFromVersionNumber?: number | null;
  reopenReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type GridSupply = {
  id: string;
  installationId: string;
  name: string;
  isDefault: boolean;
  nmi?: string | null;
  externalKey?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type CanonicalZone = {
  id: string;
  installationId: string;
  zoneCode: string;
  zoneName: string;
  zoneDescription: string;
  photos: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type CanonicalBoard = {
  id: string;
  installationId: string;
  zoneId: string;
  assetName: string;
  typeCode: BoardTypeCode;
  customTypeName?: string | null;
  displayCode: DisplayCode;
  electricalSource: ElectricalSource;
  locationDescription?: string | null;
  phase?: string | null;
  amperageRating?: string | null;
  siteNmi?: string | null;
  photo?: string | null;
  extraPhotos: string[];
  meterPresent: boolean;
  subCircuitsDescription?: string | null;
  comments?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type CanonicalSiteAsset = {
  id: string;
  installationId: string;
  zoneId: string;
  assetName: string;
  typeCode: SiteAssetTypeCode;
  customTypeName?: string | null;
  displayCode: DisplayCode;
  electricalSource: ElectricalSource;
  meteringState: MeteringState;
  locationDescription?: string | null;
  locationPhoto?: string | null;
  meterPresent: boolean;
  comments?: string | null;
  extraPhotos: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type MeterChannel = {
  id: string;
  ordinal: number;
  phaseLabel?: string | null;
  purpose: 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE';
  loadTypeCode?: SiteAssetTypeCode | null;
  customLoadTypeName?: string | null;
  sensorRating?: string | null;
  description?: string | null;
  capabilities?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type MeterCommissioningData = {
  classification?: string | null;
  coverage?: string | null;
  prestart?: {
    siteInduction?: boolean;
    safeAccess?: boolean;
    correctPpe?: boolean;
    livePointsAware?: boolean;
    canIsolate?: boolean;
    additionalHazards?: boolean;
    safeToProceed?: boolean;
  };
  switchboard?: {
    name?: string | null;
    location?: string | null;
    deviceSerial?: string | null;
    firmware?: string | null;
    antennaType?: string | null;
    signalStrength?: string | null;
    notes?: string | null;
  };
  verification?: {
    voltageChecked?: boolean;
    polarityChecked?: boolean;
    communicationsOk?: boolean;
    notes?: string | null;
  };
  commissioning?: {
    deviceOnline?: boolean;
    channelsReporting?: boolean;
    labeled?: boolean;
    photosTaken?: boolean;
    notes?: string | null;
  };
};

export type MeterDevice = {
  id: string;
  installationId: string;
  installedOnBoardId: string;
  customName: string;
  deviceFamily: 'WATTWATCHERS' | 'OTHER';
  deviceModel: 'A3RM' | 'A6M' | 'OTHER';
  customManufacturerName?: string | null;
  customModelName?: string | null;
  deviceNumber?: string | null;
  serialNumber: string;
  displayName: DisplayCode;
  channels: MeterChannel[];
  commissioningData?: MeterCommissioningData;
  wwPhotos?: Record<string, unknown>;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type MeasurementAssignment = {
  id: string;
  installationId: string;
  meterId: string;
  channelIds: string[];
  phaseMode: 'SINGLE_PHASE' | 'THREE_PHASE' | 'OTHER';
  target: MeasurementTarget;
  direction: 'CONSUMPTION' | 'GENERATION' | 'BIDIRECTIONAL';
  status: 'CONFIRMED' | 'TBC';
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type CanonicalFormSubmission = {
  id: string;
  installationId: string;
  formType: string;
  schemaVersion: number;
  status: string;
  zoneId?: string | null;
  boardId?: string | null;
  meterId?: string | null;
  siteAssetId?: string | null;
  answers: Record<string, string>;
  attachments: unknown[];
  completedAt?: string | null;
  supersedesId?: string | null;
  /** Server-owned marker for immutable commissioning evidence whose meter was removed. */
  historicalMeterRemoved?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
};

export type VirtualMeterDefinition = {
  id: string;
  parentNodeId: string;
  totalMeasurementAssignmentId: string;
  subtractAssignmentIds: string[];
  formulaVersion: number;
  allocation: 'UNALLOCATED_RESIDUAL';
};

export type CanonicalInstallationTree = {
  treeSchemaVersion: 2;
  baseTreeRevision?: number;
  installation: CanonicalInstallation;
  gridSupplies: GridSupply[];
  zones: CanonicalZone[];
  electricalAssets: CanonicalBoard[];
  siteAssets: CanonicalSiteAsset[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
  formSubmissions: CanonicalFormSubmission[];
  serverDerived: {
    virtualMeterDefinitions: VirtualMeterDefinition[];
  };
};

export type ReadinessIssue = {
  code: ReadinessIssueCode;
  severity: 'ERROR' | 'WARNING';
  entityType:
    | 'installation'
    | 'grid_supply'
    | 'zone'
    | 'board'
    | 'site_asset'
    | 'meter'
    | 'channel'
    | 'measurement_assignment'
    | 'virtual_meter'
    | 'form';
  entityId: string;
  field?: string;
  message: string;
  candidateIds?: string[];
};

const READINESS_CANDIDATE_LIMIT = 50;
const CUSTOM_LABEL_MAX_LENGTH = 120;
const CAPABILITY_MAX_KEYS = 64;
const CAPABILITY_MAX_SERIALIZED_BYTES = 8192;
const METER_COMMISSIONING_TEXT_MAX_LENGTH = 4000;
const METER_COMMISSIONING_DATA_MAX_SERIALIZED_BYTES = 16384;

function boundedCandidateIds(ids: string[]): string[] {
  return [...ids].sort().slice(0, READINESS_CANDIDATE_LIMIT);
}

export type InstallationReadiness = {
  installationId: string;
  treeRevision: number;
  recordVersionNumber?: number;
  readyToComplete: boolean;
  eligibility: {
    draftDiagnosticReport: boolean;
    authoritativeReport: boolean;
    mappingExport: boolean;
    dataDomeDelivery: false;
  };
  issues: ReadinessIssue[];
};

export type DisplayCodeClaim = {
  entityType: 'board' | 'site_asset' | 'meter';
  entityId: string;
  zoneId: string | null;
  typeCode: string;
  sequence: number | null;
  displayCode: string;
  normalizedDisplayCode: string;
  generated: boolean;
  ruleVersion: number;
};

export class CanonicalInputError extends Error {
  constructor(readonly detail: string, readonly code = 'invalid_canonical_tree') {
    super(detail);
    this.name = 'CanonicalInputError';
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalInputError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CanonicalInputError(`${label} is required`);
  }
  return value.trim();
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new CanonicalInputError(`${label} must be a string`);
  return value.trim();
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new CanonicalInputError(`${label} must be a boolean`);
  return value;
}

function rejectPresentFields(
  value: JsonRecord,
  fields: string[],
  label: string,
): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new CanonicalInputError(`${label}.${field} is not allowed for this kind`);
    }
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function boundedOptionalText(value: unknown, label: string): string | null {
  const result = optionalText(value);
  if (result && result.length > CUSTOM_LABEL_MAX_LENGTH) {
    throw new CanonicalInputError(`${label} must be at most ${CUSTOM_LABEL_MAX_LENGTH} characters`);
  }
  return result;
}

function boundedCapabilities(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalInputError(`${label} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > CAPABILITY_MAX_KEYS) {
    throw new CanonicalInputError(`${label} may contain at most ${CAPABILITY_MAX_KEYS} keys`);
  }
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, item] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > CUSTOM_LABEL_MAX_LENGTH) {
      throw new CanonicalInputError(
        `${label} keys must be 1-${CUSTOM_LABEL_MAX_LENGTH} trimmed characters`,
      );
    }
    if (key in normalized) throw new CanonicalInputError(`${label} contains duplicate normalized key ${key}`);
    normalized[key] = item;
  }
  if (Buffer.byteLength(stableStringify(normalized), 'utf8') > CAPABILITY_MAX_SERIALIZED_BYTES) {
    throw new CanonicalInputError(
      `${label} must serialize to at most ${CAPABILITY_MAX_SERIALIZED_BYTES} bytes`,
    );
  }
  return normalized;
}

function boundedMeterCommissioningText(value: unknown, label: string): string | null {
  const result = optionalText(value);
  if (result && result.length > METER_COMMISSIONING_TEXT_MAX_LENGTH) {
    throw new CanonicalInputError(
      `${label} must be at most ${METER_COMMISSIONING_TEXT_MAX_LENGTH} characters`,
    );
  }
  return result;
}

function optionalBooleanField(
  value: JsonRecord,
  key: string,
  label: string,
): boolean | undefined {
  if (
    !Object.prototype.hasOwnProperty.call(value, key)
    || value[key] === undefined
    || value[key] === null
  ) return undefined;
  return booleanValue(value[key], `${label}.${key}`);
}

function optionalBooleanFields<Key extends string>(
  value: JsonRecord,
  label: string,
  keys: readonly Key[],
): Partial<Record<Key, boolean>> {
  const normalized: Partial<Record<Key, boolean>> = {};
  for (const key of keys) {
    const parsed = optionalBooleanField(value, key, label);
    if (parsed !== undefined) normalized[key] = parsed;
  }
  return normalized;
}

function optionalCommissioningSection(value: unknown, label: string): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  return record(value, label);
}

function parseMeterCommissioningData(
  value: unknown,
  label: string,
): MeterCommissioningData | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, label);
  const prestart = optionalCommissioningSection(input.prestart, `${label}.prestart`);
  const switchboard = optionalCommissioningSection(input.switchboard, `${label}.switchboard`);
  const verification = optionalCommissioningSection(input.verification, `${label}.verification`);
  const commissioning = optionalCommissioningSection(input.commissioning, `${label}.commissioning`);
  const normalized: MeterCommissioningData = {
    classification: boundedMeterCommissioningText(input.classification, `${label}.classification`),
    coverage: boundedMeterCommissioningText(input.coverage, `${label}.coverage`),
    ...(prestart ? {
      prestart: optionalBooleanFields(prestart, `${label}.prestart`, [
        'siteInduction',
        'safeAccess',
        'correctPpe',
        'livePointsAware',
        'canIsolate',
        'additionalHazards',
        'safeToProceed',
      ] as const),
    } : {}),
    ...(switchboard ? {
      switchboard: {
        name: boundedMeterCommissioningText(switchboard.name, `${label}.switchboard.name`),
        location: boundedMeterCommissioningText(switchboard.location, `${label}.switchboard.location`),
        deviceSerial: boundedMeterCommissioningText(switchboard.deviceSerial, `${label}.switchboard.deviceSerial`),
        firmware: boundedMeterCommissioningText(switchboard.firmware, `${label}.switchboard.firmware`),
        antennaType: boundedMeterCommissioningText(switchboard.antennaType, `${label}.switchboard.antennaType`),
        signalStrength: boundedMeterCommissioningText(switchboard.signalStrength, `${label}.switchboard.signalStrength`),
        notes: boundedMeterCommissioningText(switchboard.notes, `${label}.switchboard.notes`),
      },
    } : {}),
    ...(verification ? {
      verification: {
        ...optionalBooleanFields(verification, `${label}.verification`, [
          'voltageChecked',
          'polarityChecked',
          'communicationsOk',
        ] as const),
        notes: boundedMeterCommissioningText(verification.notes, `${label}.verification.notes`),
      },
    } : {}),
    ...(commissioning ? {
      commissioning: {
        ...optionalBooleanFields(commissioning, `${label}.commissioning`, [
          'deviceOnline',
          'channelsReporting',
          'labeled',
          'photosTaken',
        ] as const),
        notes: boundedMeterCommissioningText(commissioning.notes, `${label}.commissioning.notes`),
      },
    } : {}),
  };
  if (Buffer.byteLength(stableStringify(normalized), 'utf8') > METER_COMMISSIONING_DATA_MAX_SERIALIZED_BYTES) {
    throw new CanonicalInputError(
      `${label} must serialize to at most ${METER_COMMISSIONING_DATA_MAX_SERIALIZED_BYTES} bytes`,
    );
  }
  return normalized;
}

function integer(value: unknown, fallback: number, label: string): number {
  const parsed = value === undefined || value === null ? fallback : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
    throw new CanonicalInputError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function requiredInteger(value: unknown, label: string): number {
  if (value === undefined || value === null) {
    throw new CanonicalInputError(`${label} is required`);
  }
  return integer(value, 0, label);
}

function iso(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CanonicalInputError('ISO date must be a string');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CanonicalInputError('Invalid ISO date');
  return parsed.toISOString();
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new CanonicalInputError(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value ?? [], label).map((item, index) => requiredText(item, `${label}[${index}]`));
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value as T[number])) {
    throw new CanonicalInputError(`${label} must be one of ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function uniqueById<T extends { id: string }>(items: T[], label: string): T[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new CanonicalInputError(`Duplicate ${label} id ${item.id}`);
    ids.add(item.id);
  }
  return items.sort((left, right) => left.id.localeCompare(right.id));
}

function assertInstallationId(actual: unknown, expected: string, label: string): void {
  if (requiredText(actual, `${label}.installationId`) !== expected) {
    throw new CanonicalInputError(`${label} belongs to another installation`);
  }
}

export function normalizeDisplayCode(value: string): string {
  return value.trim().replace(/\s+/g, '').toLocaleUpperCase('en-AU');
}

export function deriveSiteCode(siteName: string): string {
  const words = siteName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.map((word) => word[0]).join('').toUpperCase();
  const fallback = words.join('').slice(0, 8).toUpperCase();
  return (initials || fallback || 'SITE').slice(0, 8);
}

export function isValidInstallationSiteCode(value: string): boolean {
  return value.length >= 1
    && value.length <= INSTALLATION_SITE_CODE_MAX_LENGTH
    && INSTALLATION_SITE_CODE_PATTERN.test(value);
}

export function deriveZoneCode(zoneName: string): string {
  const code = zoneName
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, INSTALLATION_ZONE_CODE_MAX_LENGTH)
    .replace(/-+$/g, '');
  return code || 'ZONE';
}

export function isValidInstallationZoneCode(value: string): boolean {
  return value.length >= 1
    && value.length <= INSTALLATION_ZONE_CODE_MAX_LENGTH
    && INSTALLATION_ZONE_CODE_PATTERN.test(value);
}

function nextAvailableZoneCode(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `-${ordinal}`;
    const candidate = `${base.slice(0, INSTALLATION_ZONE_CODE_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function defaultMeterCustomName(input: {
  deviceModel: MeterDevice['deviceModel'];
  customManufacturerName?: string | null;
  customModelName?: string | null;
}): string {
  if (input.deviceModel === 'A3RM') return 'A3RM Meter';
  if (input.deviceModel === 'A6M') return 'A6M Meter';
  return input.customModelName?.trim()
    || input.customManufacturerName?.trim()
    || 'Meter';
}

/**
 * Historical site codes stay authoritative, but newly generated entity codes
 * need one bounded cross-client prefix. This projection never writes back to
 * the installation record.
 */
export function installationDisplayCodePrefix(value: string): string {
  const prefix = value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, INSTALLATION_SITE_CODE_MAX_LENGTH)
    .replace(/-+$/g, '');
  return prefix || 'SITE';
}

function parseDisplayCode(value: unknown, label: string): DisplayCode {
  const raw = record(value, label);
  const code = stringValue(raw.value, `${label}.value`);
  const generatedValue = stringValue(raw.generatedValue, `${label}.generatedValue`);
  return {
    value: code,
    generatedValue,
    isOverridden: booleanValue(raw.isOverridden, `${label}.isOverridden`),
    ruleVersion: requiredInteger(raw.ruleVersion, `${label}.ruleVersion`),
    ...(optionalText(raw.overrideReason) ? { overrideReason: optionalText(raw.overrideReason)! } : {}),
    ...(raw.provisional === true ? { provisional: true } : {}),
  };
}

function classifiedBoardType(item: JsonRecord): { typeCode: BoardTypeCode; customTypeName: string | null } {
  const typeCode = enumValue(item.typeCode, BOARD_TYPE_CODES, 'board.typeCode');
  const customTypeName = boundedOptionalText(item.customTypeName, 'board.customTypeName');
  return { typeCode, customTypeName };
}

function classifiedAssetType(item: JsonRecord): { typeCode: SiteAssetTypeCode; customTypeName: string | null } {
  const typeCode = enumValue(item.typeCode, SITE_ASSET_TYPE_CODES, 'siteAsset.typeCode');
  const customTypeName = boundedOptionalText(item.customTypeName, 'siteAsset.customTypeName');
  return { typeCode, customTypeName };
}

function parseSource(item: JsonRecord, label: string): ElectricalSource {
  const raw = record(item.electricalSource, `${label}.electricalSource`);
  const kind = enumValue(raw.kind, ['GRID', 'BOARD', 'TBC'] as const, `${label}.electricalSource.kind`);
  if (kind === 'GRID') {
    rejectPresentFields(raw, ['boardId'], `${label}.electricalSource`);
    return { kind, gridSupplyId: requiredText(raw.gridSupplyId, `${label}.electricalSource.gridSupplyId`) };
  }
  if (kind === 'BOARD') {
    rejectPresentFields(raw, ['gridSupplyId'], `${label}.electricalSource`);
    return { kind, boardId: requiredText(raw.boardId, `${label}.electricalSource.boardId`) };
  }
  rejectPresentFields(raw, ['gridSupplyId', 'boardId'], `${label}.electricalSource`);
  return { kind: 'TBC' };
}

function parseMeteringState(item: JsonRecord, label: string): MeteringState {
  const raw = record(item.meteringState, `${label}.meteringState`);
  const kind = enumValue(
    raw.kind,
    ['METERED', 'UNMETERED', 'TBC'] as const,
    `${label}.meteringState.kind`,
  );
  if (kind === 'METERED') {
    return {
      kind,
      measurementAssignmentIds: stringArray(
        raw.measurementAssignmentIds,
        `${label}.meteringState.measurementAssignmentIds`,
      ),
    };
  }
  rejectPresentFields(raw, ['measurementAssignmentIds'], `${label}.meteringState`);
  if (kind === 'UNMETERED') return { kind };
  return { kind: 'TBC' };
}

function parseTarget(value: unknown): MeasurementTarget {
  const raw = record(value, 'measurementAssignment.target');
  const kind = requiredText(raw.kind, 'measurementAssignment.target.kind');
  if (kind === 'BOARD') {
    rejectPresentFields(raw, ['siteAssetId', 'gridSupplyId'], 'measurementAssignment.target');
    return { kind, boardId: requiredText(raw.boardId, 'target.boardId') };
  }
  if (kind === 'SITE_ASSET') {
    rejectPresentFields(raw, ['boardId', 'gridSupplyId'], 'measurementAssignment.target');
    return { kind, siteAssetId: requiredText(raw.siteAssetId, 'target.siteAssetId') };
  }
  if (kind === 'GRID_BOUNDARY') {
    rejectPresentFields(raw, ['boardId', 'siteAssetId'], 'measurementAssignment.target');
    return { kind, gridSupplyId: requiredText(raw.gridSupplyId, 'target.gridSupplyId') };
  }
  if (kind === 'TBC') {
    rejectPresentFields(raw, ['boardId', 'siteAssetId', 'gridSupplyId'], 'measurementAssignment.target');
    return { kind };
  }
  throw new CanonicalInputError('measurementAssignment.target.kind must be BOARD, SITE_ASSET, GRID_BOUNDARY or TBC');
}

function normalizeInstallation(value: unknown): CanonicalInstallation {
  const item = record(value, 'installation');
  if (item.treeSchemaVersion !== INSTALLATION_TREE_SCHEMA_VERSION) {
    throw new CanonicalInputError('installation.treeSchemaVersion must be 2');
  }
  if (typeof item.siteCode !== 'string' || !item.siteCode.trim()) {
    throw new CanonicalInputError('installation.siteCode is required');
  }
  const siteCode = item.siteCode;
  // Persisted canonical-v2 rows predate the bounded site-code contract. The
  // authenticated sync boundary validates every new code or deliberate change;
  // the canonicalizer itself must remain able to read, hash, complete and
  // exactly replay a non-empty historical value without renaming display-code
  // identity underneath it.
  return {
    id: requiredText(item.id, 'installation.id'),
    externalKey: requiredText(item.externalKey, 'installation.externalKey'),
    siteCode,
    timezone: requiredText(item.timezone, 'installation.timezone'),
    clientName: requiredText(item.clientName, 'installation.clientName'),
    siteName: requiredText(item.siteName, 'installation.siteName'),
    siteAddress: requiredText(item.siteAddress, 'installation.siteAddress'),
    inspectorName: requiredText(item.inspectorName, 'installation.inspectorName'),
    auditDate: requiredText(item.auditDate, 'installation.auditDate'),
    status: enumValue(item.status, ['Draft', 'Completed'] as const, 'installation.status'),
    treeSchemaVersion: 2,
    treeRevision: requiredInteger(item.treeRevision, 'installation.treeRevision'),
    recordVersionNumber: requiredInteger(item.recordVersionNumber, 'installation.recordVersionNumber'),
    createdByUserId: optionalText(item.createdByUserId),
    assignedInspectorUserId: optionalText(item.assignedInspectorUserId),
    completedAt: iso(item.completedAt),
    completedByUserId: optionalText(item.completedByUserId),
    completedFromRevision: item.completedFromRevision == null
      ? null
      : integer(item.completedFromRevision, 0, 'installation.completedFromRevision'),
    reopenedAt: iso(item.reopenedAt),
    reopenedByUserId: optionalText(item.reopenedByUserId),
    reopenedFromVersionNumber: item.reopenedFromVersionNumber == null
      ? null
      : integer(item.reopenedFromVersionNumber, 0, 'installation.reopenedFromVersionNumber'),
    reopenReason: optionalText(item.reopenReason),
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
    deletedAt: iso(item.deletedAt),
  };
}

/** Normalize accepted v2 aliases into one deterministic server-owned tree. */
export function normalizeInstallationTreeV2(value: unknown): CanonicalInstallationTree {
  const input = record(value, 'installation tree');
  if (input.treeSchemaVersion !== INSTALLATION_TREE_SCHEMA_VERSION) {
    throw new CanonicalInputError('treeSchemaVersion must be 2', 'unsupported_tree_schema');
  }
  const installation = normalizeInstallation(input.installation);
  const installationId = installation.id;
  const baseTreeRevision = input.baseTreeRevision == null
    ? undefined
    : integer(input.baseTreeRevision, 0, 'baseTreeRevision');
  if (input.serverDerived !== undefined) {
    const serverDerived = record(input.serverDerived, 'serverDerived');
    const suppliedDefinitions = array(
      serverDerived.virtualMeterDefinitions,
      'serverDerived.virtualMeterDefinitions',
    );
    if (suppliedDefinitions.length) {
      throw new CanonicalInputError(
        'serverDerived.virtualMeterDefinitions is server-owned and must be empty on write',
      );
    }
  }

  const gridSupplies = uniqueById(array(input.gridSupplies, 'gridSupplies').map((value, index) => {
    const item = record(value, `gridSupplies[${index}]`);
    assertInstallationId(item.installationId, installationId, `gridSupplies[${index}]`);
    return {
      id: requiredText(item.id, `gridSupplies[${index}].id`),
      installationId,
      name: requiredText(item.name, `gridSupplies[${index}].name`),
      isDefault: booleanValue(item.isDefault, `gridSupplies[${index}].isDefault`),
      nmi: optionalText(item.nmi),
      externalKey: optionalText(item.externalKey),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'grid supply');

  const zoneInputs = uniqueById(array(input.zones, 'zones').map((value, index) => {
    const item = record(value, `zones[${index}]`);
    assertInstallationId(item.installationId, installationId, `zones[${index}]`);
    const requestedZoneCode = item.zoneCode == null
      ? null
      : stringValue(item.zoneCode, `zones[${index}].zoneCode`);
    return {
      id: requiredText(item.id, `zones[${index}].id`),
      installationId,
      requestedZoneCode: requestedZoneCode || null,
      zoneName: requiredText(item.zoneName, `zones[${index}].zoneName`),
      zoneDescription: stringValue(item.zoneDescription, `zones[${index}].zoneDescription`),
      photos: stringArray(item.photos, `zones[${index}].photos`),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'zone');
  const explicitZoneCodes = new Set<string>();
  for (const zone of zoneInputs) {
    if (!zone.requestedZoneCode) continue;
    if (!isValidInstallationZoneCode(zone.requestedZoneCode)) {
      throw new CanonicalInputError(
        `Zone ${zone.id} zoneCode must be 1-${INSTALLATION_ZONE_CODE_MAX_LENGTH} uppercase letters, numbers or hyphen-separated groups`,
      );
    }
    if (explicitZoneCodes.has(zone.requestedZoneCode)) {
      throw new CanonicalInputError(`Duplicate zoneCode ${zone.requestedZoneCode}`);
    }
    explicitZoneCodes.add(zone.requestedZoneCode);
  }
  const usedZoneCodes = new Set(explicitZoneCodes);
  const zones: CanonicalZone[] = zoneInputs.map(({ requestedZoneCode, ...zone }) => {
    if (requestedZoneCode) return { ...zone, zoneCode: requestedZoneCode };
    const zoneCode = nextAvailableZoneCode(deriveZoneCode(zone.zoneName), usedZoneCodes);
    usedZoneCodes.add(zoneCode);
    return { ...zone, zoneCode };
  });

  const electricalAssets = uniqueById(array(input.electricalAssets, 'electricalAssets').map((value, index) => {
    const item = record(value, `electricalAssets[${index}]`);
    assertInstallationId(item.installationId, installationId, `electricalAssets[${index}]`);
    const classified = classifiedBoardType(item);
    return {
      id: requiredText(item.id, `electricalAssets[${index}].id`),
      installationId,
      zoneId: requiredText(item.zoneId, `electricalAssets[${index}].zoneId`),
      assetName: requiredText(item.assetName, `electricalAssets[${index}].assetName`),
      ...classified,
      displayCode: parseDisplayCode(item.displayCode, `electricalAssets[${index}].displayCode`),
      electricalSource: parseSource(item, `electricalAssets[${index}]`),
      locationDescription: optionalText(item.locationDescription),
      phase: optionalText(item.phase),
      amperageRating: optionalText(item.amperageRating),
      siteNmi: optionalText(item.siteNmi),
      photo: optionalText(item.photo),
      extraPhotos: stringArray(item.extraPhotos, `electricalAssets[${index}].extraPhotos`),
      meterPresent: booleanValue(item.meterPresent, `electricalAssets[${index}].meterPresent`),
      subCircuitsDescription: optionalText(item.subCircuitsDescription),
      comments: optionalText(item.comments),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'board');

  const siteAssets = uniqueById(array(input.siteAssets, 'siteAssets').map((value, index) => {
    const item = record(value, `siteAssets[${index}]`);
    assertInstallationId(item.installationId, installationId, `siteAssets[${index}]`);
    const classified = classifiedAssetType(item);
    return {
      id: requiredText(item.id, `siteAssets[${index}].id`),
      installationId,
      zoneId: requiredText(item.zoneId, `siteAssets[${index}].zoneId`),
      assetName: requiredText(item.assetName, `siteAssets[${index}].assetName`),
      ...classified,
      displayCode: parseDisplayCode(item.displayCode, `siteAssets[${index}].displayCode`),
      electricalSource: parseSource(item, `siteAssets[${index}]`),
      meteringState: parseMeteringState(item, `siteAssets[${index}]`),
      locationDescription: optionalText(item.locationDescription),
      locationPhoto: optionalText(item.locationPhoto),
      meterPresent: booleanValue(item.meterPresent, `siteAssets[${index}].meterPresent`),
      comments: optionalText(item.comments),
      extraPhotos: stringArray(item.extraPhotos, `siteAssets[${index}].extraPhotos`),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'site asset');

  const meterDevices = uniqueById(array(input.meterDevices, 'meterDevices').map((value, index) => {
    const item = record(value, `meterDevices[${index}]`);
    assertInstallationId(item.installationId, installationId, `meterDevices[${index}]`);
    const deviceModel = enumValue(
      item.deviceModel,
      ['A3RM', 'A6M', 'OTHER'] as const,
      `meterDevices[${index}].deviceModel`,
    );
    const customManufacturerName = boundedOptionalText(
      item.customManufacturerName,
      `meterDevices[${index}].customManufacturerName`,
    );
    const customModelName = boundedOptionalText(
      item.customModelName,
      `meterDevices[${index}].customModelName`,
    );
    const customName = boundedOptionalText(
      item.customName,
      `meterDevices[${index}].customName`,
    ) ?? defaultMeterCustomName({
      deviceModel,
      customManufacturerName,
      customModelName,
    });
    const channels = uniqueById(array(item.channels, `meterDevices[${index}].channels`).map((value, channelIndex) => {
      const channel = record(value, `meterDevices[${index}].channels[${channelIndex}]`);
      const ordinal = integer(channel.ordinal, 0, `meterDevices[${index}].channels[${channelIndex}].ordinal`);
      if (ordinal < 1) throw new CanonicalInputError('meter channel ordinal must be positive');
      const rawLoadType = optionalText(channel.loadTypeCode);
      const loadTypeCode = rawLoadType
        ? enumValue(
            rawLoadType,
            SITE_ASSET_TYPE_CODES,
            `meterDevices[${index}].channels[${channelIndex}].loadTypeCode`,
          )
        : null;
      const customLoadTypeName = boundedOptionalText(
        channel.customLoadTypeName,
        `meterDevices[${index}].channels[${channelIndex}].customLoadTypeName`,
      );
      return {
        id: requiredText(channel.id, `meterDevices[${index}].channels[${channelIndex}].id`),
        ordinal,
        phaseLabel: optionalText(channel.phaseLabel),
        purpose: enumValue(channel.purpose, ['MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE'] as const, 'channel.purpose'),
        loadTypeCode,
        customLoadTypeName,
        sensorRating: optionalText(channel.sensorRating),
        description: optionalText(channel.description),
        capabilities: boundedCapabilities(
          channel.capabilities,
          `meterDevices[${index}].channels[${channelIndex}].capabilities`,
        ),
        createdAt: iso(channel.createdAt),
        updatedAt: iso(channel.updatedAt),
        deletedAt: iso(channel.deletedAt),
      };
    }), `channel in meter ${requiredText(item.id, `meterDevices[${index}].id`)}`);
    return {
      id: requiredText(item.id, `meterDevices[${index}].id`),
      installationId,
      installedOnBoardId: requiredText(item.installedOnBoardId, `meterDevices[${index}].installedOnBoardId`),
      customName,
      deviceFamily: enumValue(item.deviceFamily, ['WATTWATCHERS', 'OTHER'] as const, 'meter.deviceFamily'),
      deviceModel,
      customManufacturerName,
      customModelName,
      deviceNumber: optionalText(item.deviceNumber),
      serialNumber: requiredText(item.serialNumber, `meterDevices[${index}].serialNumber`),
      displayName: parseDisplayCode(item.displayName, `meterDevices[${index}].displayName`),
      channels,
      commissioningData: parseMeterCommissioningData(
        item.commissioningData,
        `meterDevices[${index}].commissioningData`,
      ),
      wwPhotos: record(item.wwPhotos, `meterDevices[${index}].wwPhotos`),
      notes: optionalText(item.notes),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'meter');

  const measurementAssignments = uniqueById(array(input.measurementAssignments, 'measurementAssignments').map((value, index) => {
    const item = record(value, `measurementAssignments[${index}]`);
    assertInstallationId(item.installationId, installationId, `measurementAssignments[${index}]`);
    const target = parseTarget(item.target);
    const status = enumValue(item.status, ['CONFIRMED', 'TBC'] as const, 'measurementAssignment.status');
    if ((target.kind === 'TBC') !== (status === 'TBC')) {
      throw new CanonicalInputError('TBC assignments require a TBC target and confirmed assignments require a concrete target');
    }
    return {
      id: requiredText(item.id, `measurementAssignments[${index}].id`),
      installationId,
      meterId: requiredText(item.meterId, `measurementAssignments[${index}].meterId`),
      channelIds: stringArray(item.channelIds, `measurementAssignments[${index}].channelIds`),
      phaseMode: enumValue(item.phaseMode, ['SINGLE_PHASE', 'THREE_PHASE', 'OTHER'] as const, 'measurementAssignment.phaseMode'),
      target,
      direction: enumValue(item.direction, ['CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL'] as const, 'measurementAssignment.direction'),
      status,
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'measurement assignment');

  const formSubmissions = uniqueById(array(input.formSubmissions, 'formSubmissions').map((value, index) => {
    const item = record(value, `formSubmissions[${index}]`);
    assertInstallationId(item.installationId, installationId, `formSubmissions[${index}]`);
    const answersRecord = record(item.answers, `formSubmissions[${index}].answers`);
    const answers: Record<string, string> = {};
    for (const [key, answer] of Object.entries(answersRecord)) {
      if (typeof answer !== 'string') {
        throw new CanonicalInputError(
          `formSubmissions[${index}].answers.${key} must be a string`,
        );
      }
      answers[key] = answer;
    }
    const schemaVersion = requiredInteger(
      item.schemaVersion,
      `formSubmissions[${index}].schemaVersion`,
    );
    if (schemaVersion !== 1 && schemaVersion !== 2) {
      throw new CanonicalInputError(`formSubmissions[${index}].schemaVersion must be 1 or 2`);
    }
    return {
      id: requiredText(item.id, `formSubmissions[${index}].id`),
      installationId,
      formType: requiredText(item.formType, `formSubmissions[${index}].formType`),
      schemaVersion,
      status: enumValue(
        item.status,
        ['Draft', 'Completed'] as const,
        `formSubmissions[${index}].status`,
      ),
      zoneId: optionalText(item.zoneId),
      boardId: optionalText(item.boardId),
      meterId: optionalText(item.meterId),
      siteAssetId: optionalText(item.siteAssetId),
      answers,
      attachments: array(
        item.attachments,
        `formSubmissions[${index}].attachments`,
      ),
      completedAt: iso(item.completedAt),
      supersedesId: optionalText(item.supersedesId),
      historicalMeterRemoved: booleanValue(
        item.historicalMeterRemoved,
        `formSubmissions[${index}].historicalMeterRemoved`,
      ),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
      deletedAt: iso(item.deletedAt),
    };
  }), 'form submission');
  const formIds = new Set(formSubmissions.map((form) => form.id));
  for (const form of formSubmissions) {
    if (form.supersedesId && (form.supersedesId === form.id || !formIds.has(form.supersedesId))) {
      throw new CanonicalInputError(`Form ${form.id} has an invalid supersedesId`);
    }
  }
  for (const form of formSubmissions) {
    const lineage = new Set<string>();
    let cursor: CanonicalFormSubmission | undefined = form;
    while (cursor?.supersedesId) {
      if (lineage.has(cursor.id)) {
        throw new CanonicalInputError(`Form ${form.id} has a supersedes cycle`);
      }
      lineage.add(cursor.id);
      cursor = formSubmissions.find((candidate) => candidate.id === cursor!.supersedesId);
    }
  }

  const tree: CanonicalInstallationTree = {
    treeSchemaVersion: 2,
    ...(baseTreeRevision === undefined ? {} : { baseTreeRevision }),
    installation,
    gridSupplies,
    zones,
    electricalAssets,
    siteAssets,
    meterDevices,
    measurementAssignments,
    formSubmissions,
    serverDerived: { virtualMeterDefinitions: [] },
  };
  assertStructurallySafeTree(tree);
  tree.serverDerived.virtualMeterDefinitions = deriveVirtualMeterDefinitions(tree);
  return tree;
}

export function assertStructurallySafeTree(tree: CanonicalInstallationTree): void {
  const zoneIds = new Set(tree.zones.map((zone) => zone.id));
  const boardIds = new Set(tree.electricalAssets.map((board) => board.id));
  const assetIds = new Set(tree.siteAssets.map((asset) => asset.id));
  const supplyIds = new Set(tree.gridSupplies.map((supply) => supply.id));
  const electricalNodeKinds = new Map<string, 'GRID' | 'BOARD' | 'SITE_ASSET' | 'VIRTUAL_RESIDUAL'>();
  const registerElectricalNodeId = (
    id: string,
    kind: 'GRID' | 'BOARD' | 'SITE_ASSET' | 'VIRTUAL_RESIDUAL',
  ) => {
    const priorKind = electricalNodeKinds.get(id);
    if (priorKind) {
      throw new CanonicalInputError(
        `Electrical node id ${id} is shared by ${priorKind} and ${kind}`,
      );
    }
    electricalNodeKinds.set(id, kind);
  };
  for (const supply of tree.gridSupplies) registerElectricalNodeId(supply.id, 'GRID');
  for (const board of tree.electricalAssets) registerElectricalNodeId(board.id, 'BOARD');
  for (const asset of tree.siteAssets) registerElectricalNodeId(asset.id, 'SITE_ASSET');
  for (const entity of [...tree.gridSupplies, ...tree.electricalAssets, ...tree.siteAssets]) {
    if (entity.id.startsWith('virtual_')) {
      throw new CanonicalInputError(
        `Electrical node id ${entity.id} uses the reserved virtual_ namespace`,
      );
    }
  }
  for (const definition of tree.serverDerived.virtualMeterDefinitions) {
    registerElectricalNodeId(definition.id, 'VIRTUAL_RESIDUAL');
  }
  if (tree.gridSupplies.filter((supply) => supply.isDefault).length !== 1) {
    throw new CanonicalInputError('Exactly one active Grid supply must be the installation default');
  }
  for (const [field, values] of [
    ['externalKey', tree.gridSupplies.map((supply) => ({ id: supply.id, value: supply.externalKey }))],
    ['nmi', tree.gridSupplies.map((supply) => ({ id: supply.id, value: supply.nmi }))],
  ] as const) {
    const seen = new Map<string, string>();
    for (const entry of values) {
      if (!entry.value?.trim()) continue;
      const normalized = entry.value.trim().replace(/\s+/g, '').toUpperCase();
      const prior = seen.get(normalized);
      if (prior) {
        throw new CanonicalInputError(
          `Grid supplies ${prior} and ${entry.id} have duplicate normalized ${field}`,
        );
      }
      seen.set(normalized, entry.id);
    }
  }
  const meterIds = new Set(tree.meterDevices.map((meter) => meter.id));
  const channelToMeter = new Map<string, string>();
  for (const meter of tree.meterDevices) {
    if (!boardIds.has(meter.installedOnBoardId)) {
      throw new CanonicalInputError(`Meter ${meter.id} references an unknown installedOnBoardId`);
    }
    const ordinals = new Set<number>();
    for (const channel of meter.channels) {
      if (channelToMeter.has(channel.id)) {
        throw new CanonicalInputError(`Channel id ${channel.id} appears under more than one meter`);
      }
      if (ordinals.has(channel.ordinal)) {
        throw new CanonicalInputError(
          `Meter ${meter.id} contains duplicate channel ordinal ${channel.ordinal}`,
        );
      }
      ordinals.add(channel.ordinal);
      channelToMeter.set(channel.id, meter.id);
    }
  }
  for (const entity of [...tree.electricalAssets, ...tree.siteAssets]) {
    if (!zoneIds.has(entity.zoneId)) {
      throw new CanonicalInputError(`${entity.id} references an unknown zoneId`);
    }
    if (entity.electricalSource.kind === 'GRID' && !supplyIds.has(entity.electricalSource.gridSupplyId)) {
      throw new CanonicalInputError(`${entity.id} references an unknown gridSupplyId`);
    }
    if (entity.electricalSource.kind === 'BOARD' && !boardIds.has(entity.electricalSource.boardId)) {
      throw new CanonicalInputError(`${entity.id} references an unknown source boardId`);
    }
  }
  const assignedChannels = new Map<string, string>();
  for (const assignment of tree.measurementAssignments) {
    if (!meterIds.has(assignment.meterId)) {
      throw new CanonicalInputError(`Assignment ${assignment.id} references an unknown meterId`);
    }
    const assignmentChannelIds = new Set<string>();
    for (const channelId of assignment.channelIds) {
      const owningMeterId = channelToMeter.get(channelId);
      if (!owningMeterId) {
        throw new CanonicalInputError(`Assignment ${assignment.id} references an unknown channelId`);
      }
      if (owningMeterId !== assignment.meterId) {
        throw new CanonicalInputError(
          `Assignment ${assignment.id} references a channel owned by another meter`,
        );
      }
      if (assignmentChannelIds.has(channelId)) {
        throw new CanonicalInputError(
          `Assignment ${assignment.id} contains duplicate channelId ${channelId}`,
        );
      }
      assignmentChannelIds.add(channelId);
      const priorAssignmentId = assignedChannels.get(channelId);
      if (priorAssignmentId) {
        throw new CanonicalInputError(
          `Channel ${channelId} is assigned by both ${priorAssignmentId} and ${assignment.id}`,
        );
      }
      assignedChannels.set(channelId, assignment.id);
    }
    if (assignment.target.kind === 'BOARD' && !boardIds.has(assignment.target.boardId)) {
      throw new CanonicalInputError(`Assignment ${assignment.id} references an unknown target boardId`);
    }
    if (assignment.target.kind === 'SITE_ASSET' && !assetIds.has(assignment.target.siteAssetId)) {
      throw new CanonicalInputError(`Assignment ${assignment.id} references an unknown target siteAssetId`);
    }
    if (assignment.target.kind === 'GRID_BOUNDARY' && !supplyIds.has(assignment.target.gridSupplyId)) {
      throw new CanonicalInputError(`Assignment ${assignment.id} references an unknown target gridSupplyId`);
    }
  }
  const formIds = new Set(tree.formSubmissions.map((form) => form.id));
  for (const form of tree.formSubmissions) {
    if (form.zoneId && !zoneIds.has(form.zoneId)) {
      throw new CanonicalInputError(`Form ${form.id} references an unknown zoneId`);
    }
    if (form.boardId && !boardIds.has(form.boardId)) {
      throw new CanonicalInputError(`Form ${form.id} references an unknown boardId`);
    }
    if (form.siteAssetId && !assetIds.has(form.siteAssetId)) {
      throw new CanonicalInputError(`Form ${form.id} references an unknown siteAssetId`);
    }
    if (form.historicalMeterRemoved) {
      if (
        form.formType !== 'ww-installation'
        || form.status !== 'Completed'
        || !form.meterId
        || meterIds.has(form.meterId)
      ) {
        throw new CanonicalInputError(
          `Form ${form.id} has an invalid historicalMeterRemoved state`,
        );
      }
    } else if (form.meterId && !meterIds.has(form.meterId)) {
      throw new CanonicalInputError(`Form ${form.id} references an unknown meterId`);
    }
    if (form.supersedesId && (form.supersedesId === form.id || !formIds.has(form.supersedesId))) {
      throw new CanonicalInputError(`Form ${form.id} has an invalid supersedesId`);
    }
  }
}

function issueSortKey(issue: ReadinessIssue): string {
  return [issue.severity, issue.code, issue.entityType, issue.entityId, issue.field ?? ''].join('\u0000');
}

function isValidDisplayLabel(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1
    && trimmed.length <= DISPLAY_CODE_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(trimmed);
}

function displayCodeIssues(tree: CanonicalInstallationTree): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const byCode = new Map<string, Array<{ entityType: 'board' | 'site_asset' | 'meter'; entityId: string }>>();
  for (const entity of [
    ...tree.electricalAssets.map((item) => ({
      id: item.id,
      typeCode: item.typeCode,
      display: item.displayCode,
      entityType: 'board' as const,
    })),
    ...tree.siteAssets.map((item) => ({
      id: item.id,
      typeCode: item.typeCode,
      display: item.displayCode,
      entityType: 'site_asset' as const,
    })),
    ...tree.meterDevices.map((item) => ({
      id: item.id,
      typeCode: item.deviceModel,
      display: item.displayName,
      entityType: 'meter' as const,
    })),
  ]) {
    const code = entity.display.value;
    if (!isValidDisplayLabel(code)) {
      issues.push({
        code: 'DISPLAY_CODE_INVALID',
        severity: 'ERROR',
        entityType: entity.entityType,
        entityId: entity.id,
        field: 'displayCode.value',
        message: `Display name must be 1-${DISPLAY_CODE_MAX_LENGTH} visible characters.`,
      });
      continue;
    }
    const normalized = normalizeDisplayCode(code);
    const entries = byCode.get(normalized) ?? [];
    entries.push({ entityType: entity.entityType, entityId: entity.id });
    byCode.set(normalized, entries);
  }
  for (const duplicates of byCode.values()) {
    if (duplicates.length < 2) continue;
    for (const duplicate of duplicates) {
      issues.push({
        code: 'DISPLAY_CODE_DUPLICATE',
        severity: 'ERROR',
        entityType: duplicate.entityType,
        entityId: duplicate.entityId,
        field: 'displayCode.value',
        message: 'Display name is already used by another item in this installation.',
        candidateIds: boundedCandidateIds(duplicates.filter((item) => item.entityId !== duplicate.entityId).map((item) => item.entityId)),
      });
    }
  }
  return issues;
}

function graphIssues(tree: CanonicalInstallationTree): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const boardById = new Map(tree.electricalAssets.map((board) => [board.id, board]));
  const supplyIds = new Set(tree.gridSupplies.map((supply) => supply.id));
  const sourceCandidateIds = (entity: CanonicalBoard | CanonicalSiteAsset): string[] => {
    const boardIds = tree.electricalAssets
      .filter((candidate) => {
        if (!boardById.has(entity.id)) return true;
        if (candidate.id === entity.id) return false;
        return !isBoardOnUpstreamPath(entity.id, candidate.electricalSource, boardById);
      })
      .map((board) => board.id);
    const gridIds = tree.gridSupplies.map((supply) => supply.id).sort();
    return [...gridIds, ...boardIds.sort()].slice(0, READINESS_CANDIDATE_LIMIT);
  };
  if (tree.gridSupplies.length === 0 || tree.gridSupplies.filter((supply) => supply.isDefault).length !== 1) {
    issues.push({
      code: 'GRID_SUPPLY_INVALID',
      severity: 'ERROR',
      entityType: 'installation',
      entityId: tree.installation.id,
      field: 'gridSupplies',
      message: 'Installation requires exactly one active default Grid supply.',
      candidateIds: boundedCandidateIds(tree.gridSupplies.map((supply) => supply.id)),
    });
  }
  for (const entity of [...tree.electricalAssets, ...tree.siteAssets]) {
    if (entity.electricalSource.kind === 'TBC') {
      issues.push({
        code: 'SUPPLY_TBC',
        severity: 'ERROR',
        entityType: 'meterPresent' in entity && 'subCircuitsDescription' in entity ? 'board' : 'site_asset',
        entityId: entity.id,
        field: 'electricalSource',
        message: 'Electrical supply must be reconciled before completion.',
        candidateIds: sourceCandidateIds(entity),
      });
    } else if (entity.electricalSource.kind === 'GRID' && !supplyIds.has(entity.electricalSource.gridSupplyId)) {
      issues.push({
        code: 'GRID_SUPPLY_INVALID',
        severity: 'ERROR',
        entityType: 'subCircuitsDescription' in entity ? 'board' : 'site_asset',
        entityId: entity.id,
        field: 'electricalSource.gridSupplyId',
        message: 'Grid supply does not exist in this installation.',
        candidateIds: tree.gridSupplies.map((supply) => supply.id).sort().slice(0, READINESS_CANDIDATE_LIMIT),
      });
    } else if (entity.electricalSource.kind === 'BOARD' && !boardById.has(entity.electricalSource.boardId)) {
      issues.push({
        code: 'SUPPLY_SOURCE_INVALID',
        severity: 'ERROR',
        entityType: 'subCircuitsDescription' in entity ? 'board' : 'site_asset',
        entityId: entity.id,
        field: 'electricalSource.boardId',
        message: 'Source board does not exist in this installation.',
        candidateIds: sourceCandidateIds(entity),
      });
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  const cyclic = new Set<string>();
  for (const start of tree.electricalAssets) {
    if (state.get(start.id) === 2) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let cursor: CanonicalBoard | undefined = start;
    while (cursor) {
      const seenAt = positions.get(cursor.id);
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cyclic.add(id);
        break;
      }
      if (state.get(cursor.id) === 2) break;
      positions.set(cursor.id, path.length);
      path.push(cursor.id);
      state.set(cursor.id, 1);
      cursor = cursor.electricalSource.kind === 'BOARD'
        ? boardById.get(cursor.electricalSource.boardId)
        : undefined;
    }
    for (const id of path) state.set(id, 2);
  }
  for (const boardId of [...cyclic].sort()) {
    issues.push({
      code: 'ELECTRICAL_CYCLE',
      severity: 'ERROR',
      entityType: 'board',
      entityId: boardId,
      field: 'electricalSource',
      message: 'Board-to-board electrical sources contain a cycle.',
      candidateIds: boundedCandidateIds([...cyclic].filter((id) => id !== boardId)),
    });
  }
  return issues;
}

function isBoardOnUpstreamPath(
  installedOnBoardId: string,
  targetSource: ElectricalSource,
  boardById: Map<string, CanonicalBoard>,
): boolean {
  if (targetSource.kind !== 'BOARD') return false;
  let currentId: string | undefined = targetSource.boardId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    if (currentId === installedOnBoardId) return true;
    seen.add(currentId);
    const current = boardById.get(currentId);
    currentId = current?.electricalSource.kind === 'BOARD'
      ? current.electricalSource.boardId
      : undefined;
  }
  return false;
}

function meterIssues(tree: CanonicalInstallationTree): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const boardById = new Map(tree.electricalAssets.map((board) => [board.id, board]));
  const assetById = new Map(tree.siteAssets.map((asset) => [asset.id, asset]));
  const meterById = new Map(tree.meterDevices.map((meter) => [meter.id, meter]));
  const channelById = new Map<string, { meter: MeterDevice; channel: MeterChannel }>();
  const assignmentById = new Map(tree.measurementAssignments.map((assignment) => [assignment.id, assignment]));
  const assignedChannel = new Map<string, string>();
  const assignmentsByAsset = new Map<string, MeasurementAssignment[]>();

  for (const meter of tree.meterDevices) {
    const isCustomMeter = meter.deviceFamily === 'OTHER' || meter.deviceModel === 'OTHER';
    if (!boardById.has(meter.installedOnBoardId)) {
      issues.push({
        code: 'METER_BOARD_MISMATCH',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'installedOnBoardId',
        message: 'Meter must be installed on a board in this installation.',
      });
    }
    if (isCustomMeter && !meter.customManufacturerName) {
      issues.push({
        code: 'CUSTOM_TYPE_REQUIRED',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'customManufacturerName',
        message: 'Other meter families require a manufacturer name.',
      });
    }
    if (isCustomMeter && !meter.customModelName) {
      issues.push({
        code: 'CUSTOM_TYPE_REQUIRED',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'customModelName',
        message: 'Other meter models require a model name.',
      });
    }
    if (isCustomMeter && meter.channels.length === 0) {
      issues.push({
        code: 'METER_CAPABILITY_REQUIRED',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'channels',
        message: 'Custom meters require at least one explicit channel capability record.',
      });
    }
    const requiredCount = meter.deviceModel === 'A3RM' ? 3 : meter.deviceModel === 'A6M' ? 6 : null;
    if (requiredCount !== null && meter.channels.length !== requiredCount) {
      issues.push({
        code: 'CHANNEL_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'channels',
        message: `${meter.deviceModel} requires exactly ${requiredCount} channels.`,
      });
    }
    if (requiredCount !== null) {
      const actualOrdinals = meter.channels.map((channel) => channel.ordinal).sort((left, right) => left - right);
      const expectedOrdinals = Array.from({ length: requiredCount }, (_, index) => index + 1);
      if (actualOrdinals.some((ordinal, index) => ordinal !== expectedOrdinals[index])) {
        issues.push({
          code: 'CHANNEL_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'meter',
          entityId: meter.id,
          field: 'channels.ordinal',
          message: `${meter.deviceModel} channel ordinals must be exactly 1 through ${requiredCount}.`,
        });
      }
    }
    const ordinals = new Set<number>();
    for (const channel of meter.channels) {
      if (ordinals.has(channel.ordinal)) {
        issues.push({
          code: 'CHANNEL_DUPLICATE_ASSIGNMENT',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channel.id,
          field: 'ordinal',
          message: 'Channel ordinal must be unique within a meter.',
        });
      }
      ordinals.add(channel.ordinal);
      channelById.set(channel.id, { meter, channel });
      if (
        isCustomMeter
        && (!channel.capabilities || Object.keys(channel.capabilities).length === 0)
      ) {
        issues.push({
          code: 'METER_CAPABILITY_REQUIRED',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channel.id,
          field: 'capabilities',
          message: 'Every custom-meter channel requires a non-empty explicit capabilities object.',
        });
      }
      if (
        channel.purpose === 'SPARE'
        && (channel.loadTypeCode || channel.customLoadTypeName || channel.sensorRating || channel.description)
      ) {
        issues.push({
          code: 'CHANNEL_PURPOSE_CONFLICT',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channel.id,
          field: 'purpose',
          message: 'A spare channel cannot carry load, sensor, or description metadata.',
        });
      }
      if (channel.loadTypeCode === 'OTHER' && !channel.customLoadTypeName) {
        issues.push({
          code: 'CUSTOM_TYPE_REQUIRED',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channel.id,
          field: 'customLoadTypeName',
          message: 'Other channel load types require a custom label.',
        });
      }
      const allowedRatings = meter.deviceModel === 'A3RM'
        ? new Set([
            '10cm-200A',
            '10cm-333mV',
            '20cm-3000A',
            '30cm-3000A',
            '45cm-3000A',
            'Not Used',
            '3000A - 9cm',
            '3000A - 20cm',
            '3000A - 29cm',
          ])
        : meter.deviceModel === 'A6M'
          ? new Set([
              'CT-60A',
              'CT-120A',
              'CT-250A',
              'CT-400A',
              'CT-600A',
              'Not Used',
              '60A',
              '120A',
              '200A',
              '400A',
              '600A',
            ])
          : null;
      if (
        channel.purpose !== 'SPARE'
        && allowedRatings
        && (!channel.sensorRating || !allowedRatings.has(channel.sensorRating))
      ) {
        issues.push({
          code: 'SENSOR_RATING_INVALID',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channel.id,
          field: 'sensorRating',
          message: `${meter.deviceModel} channel sensor rating is missing or outside the supported vocabulary.`,
        });
      }
    }
  }

  const mainTotalsByBoundary = new Map<string, string[]>();
  for (const assignment of tree.measurementAssignments) {
    const meter = meterById.get(assignment.meterId);
    const uniqueChannelIds = new Set(assignment.channelIds);
    if (uniqueChannelIds.size !== assignment.channelIds.length) {
      issues.push({
        code: 'CHANNEL_DUPLICATE_ASSIGNMENT',
        severity: 'ERROR',
        entityType: 'measurement_assignment',
        entityId: assignment.id,
        field: 'channelIds',
        message: 'A channel may appear only once in an assignment.',
      });
    }
    const expectedCount = assignment.phaseMode === 'SINGLE_PHASE'
      ? 1
      : assignment.phaseMode === 'THREE_PHASE'
        ? 3
        : null;
    if ((expectedCount !== null && uniqueChannelIds.size !== expectedCount) || uniqueChannelIds.size === 0) {
      issues.push({
        code: 'PHASE_GROUP_INVALID',
        severity: 'ERROR',
        entityType: 'measurement_assignment',
        entityId: assignment.id,
        field: 'channelIds',
        message: expectedCount
          ? `${assignment.phaseMode} requires exactly ${expectedCount} distinct channel${expectedCount === 1 ? '' : 's'}.`
          : 'An assignment requires at least one channel.',
      });
    }
    const assignmentPurposes = new Set<MeterChannel['purpose']>();
    for (const channelId of uniqueChannelIds) {
      const channelEntry = channelById.get(channelId);
      if (!channelEntry || channelEntry.meter.id !== assignment.meterId) {
        issues.push({
          code: 'CHANNEL_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'measurement_assignment',
          entityId: assignment.id,
          field: 'channelIds',
          message: 'Every assigned channel must exist on the selected meter.',
        });
        continue;
      }
      assignmentPurposes.add(channelEntry.channel.purpose);
      if (channelEntry.channel.purpose === 'SPARE') {
        issues.push({
          code: 'CHANNEL_PURPOSE_CONFLICT',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channelId,
          field: 'purpose',
          message: 'A spare channel cannot be assigned to a measurement target.',
        });
      }
      const priorAssignment = assignedChannel.get(channelId);
      if (priorAssignment && priorAssignment !== assignment.id) {
        issues.push({
          code: 'CHANNEL_DUPLICATE_ASSIGNMENT',
          severity: 'ERROR',
          entityType: 'channel',
          entityId: channelId,
          field: 'channelIds',
          message: 'A channel may have only one active measurement target.',
          candidateIds: [priorAssignment, assignment.id].sort(),
        });
      } else {
        assignedChannel.set(channelId, assignment.id);
      }
    }
    if (assignmentPurposes.size > 1) {
      issues.push({
        code: 'CHANNEL_PURPOSE_CONFLICT',
        severity: 'ERROR',
        entityType: 'measurement_assignment',
        entityId: assignment.id,
        field: 'channelIds',
        message: 'One measurement assignment cannot mix channel purposes.',
      });
    }
    if (assignmentPurposes.has('MAIN_SUPPLY')) {
      if (
        assignment.target.kind !== 'BOARD'
        && assignment.target.kind !== 'GRID_BOUNDARY'
        && assignment.target.kind !== 'TBC'
      ) {
        issues.push({
          code: 'CHANNEL_PURPOSE_CONFLICT',
          severity: 'ERROR',
          entityType: 'measurement_assignment',
          entityId: assignment.id,
          field: 'target',
          message: 'MAIN_SUPPLY channels must target their installed board, a Grid boundary, or explicit TBC.',
        });
      } else if (assignment.target.kind !== 'TBC' && assignment.status === 'CONFIRMED') {
        const boundaryId = assignment.target.kind === 'BOARD'
          ? assignment.target.boardId
          : assignment.target.gridSupplyId;
        const totals = mainTotalsByBoundary.get(boundaryId) ?? [];
        totals.push(assignment.id);
        mainTotalsByBoundary.set(boundaryId, totals);
      }
    }
    if (assignment.target.kind === 'TBC') {
      issues.push({
        code: 'MEASUREMENT_TARGET_TBC',
        severity: 'ERROR',
        entityType: 'measurement_assignment',
        entityId: assignment.id,
        field: 'target',
        message: 'Measurement target must be reconciled before completion.',
      });
    } else if (meter && assignment.target.kind === 'SITE_ASSET') {
      const target = assetById.get(assignment.target.siteAssetId);
      if (!target || !isBoardOnUpstreamPath(meter.installedOnBoardId, target.electricalSource, boardById)) {
        issues.push({
          code: 'METER_BOARD_MISMATCH',
          severity: 'ERROR',
          entityType: 'measurement_assignment',
          entityId: assignment.id,
          field: 'meterId',
          message: 'Meter installation board must lie on the target asset electrical path.',
        });
      }
      const existing = assignmentsByAsset.get(assignment.target.siteAssetId) ?? [];
      existing.push(assignment);
      assignmentsByAsset.set(assignment.target.siteAssetId, existing);
    } else if (meter && assignment.target.kind === 'BOARD') {
      const target = boardById.get(assignment.target.boardId);
      const mainSupplyTargetsAnotherBoard = assignmentPurposes.has('MAIN_SUPPLY')
        && meter.installedOnBoardId !== assignment.target.boardId;
      const subCircuitTargetsInstalledBoard = assignmentPurposes.has('SUB_CIRCUIT')
        && meter.installedOnBoardId === assignment.target.boardId;
      if (mainSupplyTargetsAnotherBoard || subCircuitTargetsInstalledBoard || (
        target
        && meter.installedOnBoardId !== target.id
        && !isBoardOnUpstreamPath(meter.installedOnBoardId, target.electricalSource, boardById)
      )) {
        issues.push({
          code: 'METER_BOARD_MISMATCH',
          severity: 'ERROR',
          entityType: 'measurement_assignment',
          entityId: assignment.id,
          field: 'meterId',
          message: mainSupplyTargetsAnotherBoard
            ? 'MAIN_SUPPLY channels targeting a board must measure the board where the meter is installed.'
            : subCircuitTargetsInstalledBoard
              ? 'SUB_CIRCUIT channels must target a downstream board or site asset.'
            : 'Meter installation board must lie on the measured board electrical path.',
        });
      }
    }
  }

  for (const meter of tree.meterDevices) {
    for (const channel of meter.channels) {
      if (channel.purpose === 'SPARE' || assignedChannel.has(channel.id)) continue;
      issues.push({
        code: 'CHANNEL_UNASSIGNED',
        severity: 'ERROR',
        entityType: 'channel',
        entityId: channel.id,
        field: 'measurementAssignments',
        message: 'Every non-spare meter channel must belong to exactly one measurement assignment.',
        candidateIds: [meter.id],
      });
    }
  }

  for (const [boundaryId, assignmentIds] of mainTotalsByBoundary) {
    if (assignmentIds.length < 2) continue;
    for (const assignmentId of assignmentIds) {
      issues.push({
        code: 'VIRTUAL_METER_SOURCE_INCOMPLETE',
        severity: 'ERROR',
        entityType: 'measurement_assignment',
        entityId: assignmentId,
        field: 'target',
        message: 'A measured boundary may have only one MAIN_SUPPLY total assignment.',
        candidateIds: boundedCandidateIds(assignmentIds.filter((id) => id !== assignmentId)),
      });
    }
  }

  const immediateChildren = new Map<string, string[]>();
  for (const board of tree.electricalAssets) {
    const parentId = board.electricalSource.kind === 'BOARD'
      ? board.electricalSource.boardId
      : board.electricalSource.kind === 'GRID'
        ? board.electricalSource.gridSupplyId
        : null;
    if (!parentId) continue;
    const children = immediateChildren.get(parentId) ?? [];
    children.push(board.id);
    immediateChildren.set(parentId, children);
  }
  for (const asset of tree.siteAssets) {
    const parentId = asset.electricalSource.kind === 'BOARD'
      ? asset.electricalSource.boardId
      : asset.electricalSource.kind === 'GRID'
        ? asset.electricalSource.gridSupplyId
        : null;
    if (!parentId) continue;
    const children = immediateChildren.get(parentId) ?? [];
    children.push(asset.id);
    immediateChildren.set(parentId, children);
  }
  const confirmedByTarget = new Map<string, string[]>();
  for (const assignment of tree.measurementAssignments) {
    if (assignment.status !== 'CONFIRMED' || assignment.target.kind === 'TBC') continue;
    const targetId = assignment.target.kind === 'BOARD'
      ? assignment.target.boardId
      : assignment.target.kind === 'SITE_ASSET'
        ? assignment.target.siteAssetId
        : assignment.target.gridSupplyId;
    const assignments = confirmedByTarget.get(targetId) ?? [];
    assignments.push(assignment.id);
    confirmedByTarget.set(targetId, assignments);
  }
  for (const [boundaryId, totalIds] of mainTotalsByBoundary) {
    if (totalIds.length !== 1) continue;
    for (const childId of immediateChildren.get(boundaryId) ?? []) {
      const childAssignments = confirmedByTarget.get(childId) ?? [];
      if (childAssignments.length <= 1) continue;
      issues.push({
        code: 'VIRTUAL_METER_SOURCE_INCOMPLETE',
        severity: 'ERROR',
        entityType: 'virtual_meter',
        entityId: boundaryId,
        field: 'subtractAssignmentIds',
        message: 'Each measured immediate child requires exactly one unambiguous boundary assignment.',
        candidateIds: boundedCandidateIds(childAssignments),
      });
    }
  }

  for (const board of tree.electricalAssets) {
    const actual = tree.meterDevices.some((meter) => meter.installedOnBoardId === board.id);
    if (board.meterPresent !== actual) {
      issues.push({
        code: 'METER_PRESENT_MISMATCH',
        severity: 'ERROR',
        entityType: 'board',
        entityId: board.id,
        field: 'meterPresent',
        message: 'Legacy meterPresent must agree with canonical installed meter devices.',
      });
    }
  }

  for (const asset of tree.siteAssets) {
    const direct = assignmentsByAsset.get(asset.id) ?? [];
    if (direct.length > 1) {
      issues.push({
        code: 'METERING_STATE_INVALID',
        severity: 'ERROR',
        entityType: 'site_asset',
        entityId: asset.id,
        field: 'meteringState.measurementAssignmentIds',
        message: 'A site asset may have only one active direct measurement assignment.',
        candidateIds: boundedCandidateIds(direct.map((assignment) => assignment.id)),
      });
    }
    if (asset.meterPresent !== (direct.length > 0)) {
      issues.push({
        code: 'METER_PRESENT_MISMATCH',
        severity: 'ERROR',
        entityType: 'site_asset',
        entityId: asset.id,
        field: 'meterPresent',
        message: 'Legacy meterPresent must agree with canonical measurement assignments.',
      });
    }
    if (asset.meteringState.kind === 'TBC') {
      issues.push({
        code: 'METERING_STATE_INVALID',
        severity: 'ERROR',
        entityType: 'site_asset',
        entityId: asset.id,
        field: 'meteringState',
        message: 'Metering state must be reconciled before completion.',
      });
    } else if (asset.meteringState.kind === 'METERED') {
      const expected = new Set(asset.meteringState.measurementAssignmentIds);
      const actual = new Set(direct.map((assignment) => assignment.id));
      if (!expected.size || expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) {
        issues.push({
          code: 'METERING_STATE_INVALID',
          severity: 'ERROR',
          entityType: 'site_asset',
          entityId: asset.id,
          field: 'meteringState.measurementAssignmentIds',
          message: 'Metered state must name every valid assignment targeting this asset.',
          candidateIds: boundedCandidateIds(direct.map((assignment) => assignment.id)),
        });
      }
    } else if (direct.length) {
      issues.push({
        code: 'METERING_STATE_INVALID',
        severity: 'ERROR',
        entityType: 'site_asset',
        entityId: asset.id,
        field: 'meteringState.measurementAssignmentIds',
        message: 'Confirmed-unmetered assets cannot have measurement assignments.',
        candidateIds: boundedCandidateIds(direct.map((assignment) => assignment.id)),
      });
    }
  }

  return issues;
}

function taxonomyIssues(tree: CanonicalInstallationTree): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  for (const board of tree.electricalAssets) {
    if (board.typeCode === 'OTHER' && !board.customTypeName?.trim()) {
      issues.push({
        code: 'CUSTOM_TYPE_REQUIRED',
        severity: 'ERROR',
        entityType: 'board',
        entityId: board.id,
        field: 'customTypeName',
        message: 'Other board types require a custom label.',
      });
    }
  }
  for (const asset of tree.siteAssets) {
    if (asset.typeCode === 'OTHER' && !asset.customTypeName?.trim()) {
      issues.push({
        code: 'CUSTOM_TYPE_REQUIRED',
        severity: 'ERROR',
        entityType: 'site_asset',
        entityId: asset.id,
        field: 'customTypeName',
        message: 'Other site asset types require a custom label.',
      });
    }
  }
  return issues;
}

function formIssues(tree: CanonicalInstallationTree): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const zoneIds = new Set(tree.zones.map((zone) => zone.id));
  const boardsById = new Map(tree.electricalAssets.map((board) => [board.id, board]));
  const assetsById = new Map(tree.siteAssets.map((asset) => [asset.id, asset]));
  const metersById = new Map(tree.meterDevices.map((meter) => [meter.id, meter]));
  const formsById = new Map(tree.formSubmissions.map((form) => [form.id, form]));
  const completedMeterFormIds = new Set<string>();
  for (const form of tree.formSubmissions) {
    const board = form.boardId ? boardsById.get(form.boardId) : undefined;
    const asset = form.siteAssetId ? assetsById.get(form.siteAssetId) : undefined;
    const meter = form.meterId ? metersById.get(form.meterId) : undefined;
    const retainedCommissioningHistory = form.formType === 'ww-installation'
      && form.status === 'Completed'
      && form.historicalMeterRemoved === true
      && Boolean(form.meterId)
      && !meter;
    const superseded = form.supersedesId ? formsById.get(form.supersedesId) : undefined;
    const wwContextInvalid = form.formType === 'ww-installation' && !retainedCommissioningHistory && (
      !form.meterId
      || !form.boardId
      || !meter
      || !board
      || meter.installedOnBoardId !== board.id
    );
    const lineageInvalid = Boolean(form.supersedesId) && (
      !superseded
      || superseded.formType !== form.formType
      || superseded.status !== 'Completed'
      || (form.formType === 'ww-installation' && superseded.meterId !== form.meterId)
    );
    const contextInvalid = Boolean(
      (form.zoneId && !zoneIds.has(form.zoneId))
      || (form.boardId && !board)
      || (form.siteAssetId && !asset)
      || (form.meterId && !meter && !retainedCommissioningHistory)
      || (form.zoneId && board && board.zoneId !== form.zoneId)
      || (form.zoneId && asset && asset.zoneId !== form.zoneId)
      || wwContextInvalid
      || lineageInvalid
    );
    if (contextInvalid) {
      issues.push({
        code: 'FORM_CONTEXT_REQUIRED',
        severity: 'ERROR',
        entityType: 'form',
        entityId: form.id,
        field: 'context',
        message: 'Form must reference valid installation entities.',
      });
    }
    if (form.status !== 'Completed') {
      issues.push({
        code: 'FORM_INCOMPLETE',
        severity: 'ERROR',
        entityType: 'form',
        entityId: form.id,
        field: 'status',
        message: 'Draft form submissions must be completed or removed before installation completion.',
      });
    } else if (form.formType === 'ww-installation' && form.meterId && !contextInvalid) {
      completedMeterFormIds.add(form.meterId);
    }
  }
  for (const meter of tree.meterDevices) {
    const requiresCommissioningForm = meter.deviceFamily === 'WATTWATCHERS'
      && (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M');
    if (!requiresCommissioningForm) continue;
    if (!completedMeterFormIds.has(meter.id)) {
      issues.push({
        code: 'METER_DEVICE_REQUIRED',
        severity: 'ERROR',
        entityType: 'meter',
        entityId: meter.id,
        field: 'formSubmission',
        message: 'Meter requires a completed WW installation form linked by stable meter ID.',
      });
    }
  }
  return issues;
}

export function installationReadiness(tree: CanonicalInstallationTree): InstallationReadiness {
  const issues = [
    ...graphIssues(tree),
    ...displayCodeIssues(tree),
    ...taxonomyIssues(tree),
    ...meterIssues(tree),
    ...formIssues(tree),
  ];
  if (!tree.installation.externalKey.trim()) {
    issues.push({
      code: 'EXTERNAL_KEY_REQUIRED',
      severity: 'ERROR',
      entityType: 'installation',
      entityId: tree.installation.id,
      field: 'externalKey',
      message: 'Installation external key is required and immutable.',
    });
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
  issues.sort((left, right) => issueSortKey(left).localeCompare(issueSortKey(right)));
  const readyToComplete = !issues.some((issue) => issue.severity === 'ERROR');
  const completedAndReady = tree.installation.status === 'Completed' && readyToComplete;
  const exportReady = completedAndReady && timezoneValid;
  return {
    installationId: tree.installation.id,
    treeRevision: tree.installation.treeRevision,
    ...(tree.installation.recordVersionNumber > 0
      ? { recordVersionNumber: tree.installation.recordVersionNumber }
      : {}),
    readyToComplete,
    eligibility: {
      draftDiagnosticReport: true,
      authoritativeReport: exportReady,
      mappingExport: exportReady,
      // Vendor contract/credentials are intentionally not yet evidenced.
      dataDomeDelivery: false,
    },
    issues,
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function canonicalPayloadHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Stable domain-only fingerprint used to suppress retry/reorder revisions. */
function evidenceOrderKey(value: unknown): string {
  if (typeof value !== 'string') return stableStringify(value);
  const match = value.toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  return match?.[0] ?? value;
}

/**
 * Canonical ordering for hashes and immutable versions. Entity identity, not
 * database/input order, controls serialization. Evidence collections without
 * a positional domain meaning are ordered by immutable photo/attachment ID;
 * channel phase position remains ordered by ordinal.
 */
export function canonicalOrderInstallationTree(
  input: CanonicalInstallationTree,
): CanonicalInstallationTree {
  const tree = structuredClone(input);
  const byId = <T extends { id: string }>(values: T[]): T[] => (
    values.sort((left, right) => left.id.localeCompare(right.id))
  );
  const evidence = (values: string[]): string[] => values.sort((left, right) => (
    evidenceOrderKey(left).localeCompare(evidenceOrderKey(right))
  ));
  byId(tree.gridSupplies);
  byId(tree.zones);
  byId(tree.electricalAssets);
  byId(tree.siteAssets);
  byId(tree.meterDevices);
  byId(tree.measurementAssignments);
  byId(tree.formSubmissions);
  tree.zones.forEach((zone) => evidence(zone.photos));
  tree.electricalAssets.forEach((board) => evidence(board.extraPhotos));
  tree.siteAssets.forEach((asset) => evidence(asset.extraPhotos));
  tree.meterDevices.forEach((meter) => {
    meter.channels.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
    const photos = meter.wwPhotos;
    if (photos && Array.isArray(photos.extra)) evidence(photos.extra as string[]);
  });
  const channelOrdinal = new Map(tree.meterDevices.flatMap((meter) => (
    meter.channels.map((channel) => [channel.id, channel.ordinal] as const)
  )));
  tree.measurementAssignments.forEach((assignment) => assignment.channelIds.sort((left, right) => (
    (channelOrdinal.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (channelOrdinal.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right)
  )));
  tree.formSubmissions.forEach((form) => form.attachments.sort((left, right) => {
    const id = (value: unknown): string => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return stableStringify(value);
      const record = value as Record<string, unknown>;
      return typeof record.id === 'string'
        ? record.id
        : evidenceOrderKey(record.uri);
    };
    return id(left).localeCompare(id(right));
  }));
  tree.serverDerived.virtualMeterDefinitions.sort((left, right) => left.id.localeCompare(right.id));
  tree.serverDerived.virtualMeterDefinitions.forEach((definition) => definition.subtractAssignmentIds.sort());
  return tree;
}

export function canonicalTreeMutationFingerprint(tree: CanonicalInstallationTree): string {
  const ordered = canonicalOrderInstallationTree(tree);
  const stripLifecycle = <T extends Record<string, unknown>>(value: T) => {
    const {
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      deletedAt: _deletedAt,
      ...domain
    } = value;
    return domain;
  };
  const byId = <T extends { id: string }>(values: T[]) => (
    [...values].sort((left, right) => left.id.localeCompare(right.id))
  );
  return canonicalPayloadHash({
    installation: {
      id: ordered.installation.id,
      siteCode: ordered.installation.siteCode,
      timezone: ordered.installation.timezone,
      clientName: ordered.installation.clientName,
      siteName: ordered.installation.siteName,
      siteAddress: ordered.installation.siteAddress,
      inspectorName: ordered.installation.inspectorName,
      auditDate: ordered.installation.auditDate,
    },
    gridSupplies: byId(ordered.gridSupplies).map((item) => stripLifecycle(item)),
    zones: byId(ordered.zones).map((item) => stripLifecycle(item)),
    electricalAssets: byId(ordered.electricalAssets).map((item) => stripLifecycle(item)),
    siteAssets: byId(ordered.siteAssets).map((item) => stripLifecycle(item)),
    meterDevices: byId(ordered.meterDevices).map((meter) => ({
      ...stripLifecycle(meter),
      channels: byId(meter.channels).map((channel) => stripLifecycle(channel)),
    })),
    measurementAssignments: byId(ordered.measurementAssignments).map((item) => ({
      ...stripLifecycle(item),
      channelIds: [...item.channelIds].sort(),
    })),
    formSubmissions: byId(ordered.formSubmissions).map((item) => stripLifecycle(item)),
  });
}

function virtualId(parentNodeId: string, totalId: string, subtractIds: string[]): string {
  const digest = createHash('sha256')
    .update([parentNodeId, totalId, ...subtractIds].join('\u0000'))
    .digest('hex')
    .slice(0, 24);
  return `virtual_${digest}`;
}

export function deriveVirtualMeterDefinitions(
  tree: CanonicalInstallationTree,
): VirtualMeterDefinition[] {
  type ConcreteNode = {
    kind: 'BOARD' | 'SITE_ASSET' | 'GRID_BOUNDARY';
    id: string;
  };
  type VirtualParent = {
    kind: 'BOARD' | 'GRID_BOUNDARY';
    id: string;
  };
  type ImmediateChild = {
    kind: 'BOARD' | 'SITE_ASSET';
    id: string;
  };
  const nodeKey = (node: ConcreteNode): string => `${node.kind}\u0000${node.id}`;
  const assignmentNode = (assignment: MeasurementAssignment): ConcreteNode | null => {
    if (assignment.target.kind === 'BOARD') {
      return { kind: 'BOARD', id: assignment.target.boardId };
    }
    if (assignment.target.kind === 'SITE_ASSET') {
      return { kind: 'SITE_ASSET', id: assignment.target.siteAssetId };
    }
    if (assignment.target.kind === 'GRID_BOUNDARY') {
      return { kind: 'GRID_BOUNDARY', id: assignment.target.gridSupplyId };
    }
    return null;
  };
  const totalsByNode = new Map<string, {
    parent: VirtualParent;
    assignments: MeasurementAssignment[];
  }>();
  const measurementsByNode = new Map<string, MeasurementAssignment[]>();
  for (const assignment of tree.measurementAssignments) {
    if (assignment.status !== 'CONFIRMED') continue;
    const meter = tree.meterDevices.find((item) => item.id === assignment.meterId);
    if (!meter) continue;
    const channels = assignment.channelIds
      .map((id) => meter.channels.find((channel) => channel.id === id))
      .filter((channel): channel is MeterChannel => Boolean(channel));
    const node = assignmentNode(assignment);
    if (!node) continue;
    const key = nodeKey(node);
    const measurements = measurementsByNode.get(key) ?? [];
    measurements.push(assignment);
    measurementsByNode.set(key, measurements);
    if (
      node.kind !== 'SITE_ASSET'
      && channels.length
      && channels.every((channel) => channel.purpose === 'MAIN_SUPPLY')
    ) {
      const parent: VirtualParent = { kind: node.kind, id: node.id };
      const entry = totalsByNode.get(key) ?? {
        parent,
        assignments: [],
      };
      entry.assignments.push(assignment);
      totalsByNode.set(key, entry);
    }
  }

  const boardChildren = new Map<string, ImmediateChild[]>();
  const gridChildren = new Map<string, ImmediateChild[]>();
  for (const board of tree.electricalAssets) {
    if (board.electricalSource.kind === 'BOARD') {
      const children = boardChildren.get(board.electricalSource.boardId) ?? [];
      children.push({ kind: 'BOARD', id: board.id });
      boardChildren.set(board.electricalSource.boardId, children);
    } else if (board.electricalSource.kind === 'GRID') {
      const children = gridChildren.get(board.electricalSource.gridSupplyId) ?? [];
      children.push({ kind: 'BOARD', id: board.id });
      gridChildren.set(board.electricalSource.gridSupplyId, children);
    }
  }
  for (const asset of tree.siteAssets) {
    if (asset.electricalSource.kind === 'BOARD') {
      const children = boardChildren.get(asset.electricalSource.boardId) ?? [];
      children.push({ kind: 'SITE_ASSET', id: asset.id });
      boardChildren.set(asset.electricalSource.boardId, children);
    } else if (asset.electricalSource.kind === 'GRID') {
      const children = gridChildren.get(asset.electricalSource.gridSupplyId) ?? [];
      children.push({ kind: 'SITE_ASSET', id: asset.id });
      gridChildren.set(asset.electricalSource.gridSupplyId, children);
    }
  }

  const definitions: VirtualMeterDefinition[] = [];
  for (const [, entry] of [...totalsByNode.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    if (entry.assignments.length !== 1) continue;
    const total = entry.assignments[0];
    const immediateChildren = entry.parent.kind === 'BOARD'
      ? boardChildren.get(entry.parent.id) ?? []
      : gridChildren.get(entry.parent.id) ?? [];
    const childMeasurements = immediateChildren.map((child) => (
      (measurementsByNode.get(nodeKey(child)) ?? [])
        .filter((assignment) => assignment.id !== total.id)
    ));
    if (childMeasurements.some((assignments) => assignments.length > 1)) continue;
    const subtractIds = childMeasurements.flatMap((assignments) => (
      assignments.length === 1 ? [assignments[0].id] : []
    )).sort();
    definitions.push({
      id: virtualId(entry.parent.id, total.id, subtractIds),
      parentNodeId: entry.parent.id,
      totalMeasurementAssignmentId: total.id,
      subtractAssignmentIds: subtractIds,
      formulaVersion: VIRTUAL_METER_FORMULA_VERSION,
      allocation: 'UNALLOCATED_RESIDUAL',
    });
  }
  return definitions;
}

export function allocateDisplayCodes(input: {
  tree: CanonicalInstallationTree;
  existingClaims: DisplayCodeClaim[];
}): DisplayCodeClaim[] {
  const claims = [...input.existingClaims];
  const claimed = new Map(
    claims.map((claim) => [
      claim.normalizedDisplayCode,
      claim,
    ]),
  );
  const nextByZone = new Map<string, number>();
  for (const claim of claims) {
    if (!claim.zoneId || claim.sequence == null) continue;
    nextByZone.set(
      claim.zoneId,
      Math.max(nextByZone.get(claim.zoneId) ?? 0, claim.sequence),
    );
  }

  const zoneById = new Map(input.tree.zones.map((zone) => [zone.id, zone]));
  const boardZoneById = new Map(
    input.tree.electricalAssets.map((board) => [board.id, board.zoneId]),
  );
  const entities: Array<{
    entityType: DisplayCodeClaim['entityType'];
    entityId: string;
    zoneId: string;
    typeCode: string;
    customName: string;
    display: DisplayCode;
  }> = [
    ...input.tree.electricalAssets.map((entity) => ({
      entityType: 'board' as const,
      entityId: entity.id,
      zoneId: entity.zoneId,
      typeCode: entity.typeCode,
      customName: entity.assetName,
      display: entity.displayCode,
    })),
    ...input.tree.siteAssets.map((entity) => ({
      entityType: 'site_asset' as const,
      entityId: entity.id,
      zoneId: entity.zoneId,
      typeCode: entity.typeCode,
      customName: entity.assetName,
      display: entity.displayCode,
    })),
    ...input.tree.meterDevices.map((entity) => {
      const zoneId = boardZoneById.get(entity.installedOnBoardId);
      if (!zoneId) {
        throw new CanonicalInputError(
          `Meter ${entity.id} references an unknown installedOnBoardId`,
        );
      }
      return {
        entityType: 'meter' as const,
        entityId: entity.id,
        zoneId,
        typeCode: entity.deviceModel,
        customName: entity.customName,
        display: entity.displayName,
      };
    }),
  ].sort((left, right) => `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`));

  for (const entity of entities) {
    const priorClaimsForEntity = claims.filter((claim) => (
      claim.entityType === entity.entityType && claim.entityId === entity.entityId
    ));
    const priorForEntity = priorClaimsForEntity[0];
    if (priorClaimsForEntity.some((claim) => (
      claim.normalizedDisplayCode !== priorForEntity.normalizedDisplayCode
    ))) {
      throw new CanonicalInputError(
        `Entity ${entity.entityType} ${entity.entityId} has conflicting retained display-code claims`,
        'display_code_conflict',
      );
    }
    if (priorForEntity) {
      // Claims are immutable identity history. Site/type/rule changes and
      // client-side regeneration may never silently allocate a different code
      // for an already claimed entity.
      entity.display.value = priorForEntity.displayCode;
      entity.display.generatedValue = priorForEntity.displayCode;
      entity.display.isOverridden = !priorForEntity.generated;
      entity.display.ruleVersion = priorForEntity.ruleVersion;
      entity.display.provisional = false;
      continue;
    }

    const zone = zoneById.get(entity.zoneId);
    if (!zone) {
      throw new CanonicalInputError(
        `${entity.entityType} ${entity.entityId} references an unknown zoneId`,
      );
    }
    entity.display.ruleVersion = DISPLAY_CODE_RULE_VERSION;

    if (entity.display.isOverridden && entity.display.value.trim()) {
      const displayCode = entity.display.value.trim();
      const normalizedDisplayCode = normalizeDisplayCode(displayCode);
      const collision = claimed.get(normalizedDisplayCode);
      if (collision) {
        throw new CanonicalInputError(
          `Display name ${displayCode} is already used by ${collision.entityType} ${collision.entityId}`,
          'display_code_conflict',
        );
      }
      entity.display.value = displayCode;
      entity.display.provisional = false;
      const claim: DisplayCodeClaim = {
        entityType: entity.entityType,
        entityId: entity.entityId,
        zoneId: entity.zoneId,
        typeCode: entity.typeCode,
        sequence: null,
        displayCode,
        normalizedDisplayCode,
        generated: false,
        ruleVersion: DISPLAY_CODE_RULE_VERSION,
      };
      claims.push(claim);
      claimed.set(normalizedDisplayCode, claim);
      continue;
    }

    const sitePrefix = installationDisplayCodePrefix(input.tree.installation.siteCode);
    let sequence: number;
    let displayCode: string;
    let normalizedDisplayCode: string;
    do {
      sequence = (nextByZone.get(entity.zoneId) ?? 0) + 1;
      nextByZone.set(entity.zoneId, sequence);
      const sequenceText = String(sequence).padStart(2, '0');
      const prefix = `${sitePrefix}-${zone.zoneCode}-${sequenceText}-`;
      const fallbackName = entity.typeCode || entity.entityType;
      const normalizedCustomName = (entity.customName || fallbackName)
        .normalize('NFKD')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || fallbackName;
      const availableNameLength = Math.max(1, DISPLAY_CODE_MAX_LENGTH - prefix.length);
      const boundedCustomName = normalizedCustomName
        .slice(0, availableNameLength)
        .replace(/-+$/g, '')
        || fallbackName.slice(0, availableNameLength).toUpperCase()
        || 'X';
      displayCode = `${prefix}${boundedCustomName}`;
      normalizedDisplayCode = normalizeDisplayCode(displayCode);
    } while (claimed.has(normalizedDisplayCode));

    entity.display.value = displayCode;
    entity.display.generatedValue = displayCode;
    entity.display.isOverridden = false;
    entity.display.overrideReason = undefined;
    entity.display.provisional = false;
    const claim: DisplayCodeClaim = {
      entityType: entity.entityType,
      entityId: entity.entityId,
      zoneId: entity.zoneId,
      typeCode: entity.typeCode,
      sequence,
      displayCode,
      normalizedDisplayCode,
      generated: true,
      ruleVersion: DISPLAY_CODE_RULE_VERSION,
    };
    claims.push(claim);
    claimed.set(normalizedDisplayCode, claim);
  }
  return claims.slice(input.existingClaims.length);
}
