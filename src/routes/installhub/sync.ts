import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  ihElectricalAssets,
  ihFormSubmissions,
  ihInstallations,
  ihMeterDevices,
  ihMeterHistoryEvents,
  ihSiteAssets,
  ihZones,
} from '../../db/schema/installhub.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { mirrorStoredPhotoToOneDrive } from '../../onedrive/photoBackup.js';
import { deleteOneDrivePath } from '../../onedrive/uploadSession.js';
import { resolveSyncCreatedByUserId } from '../syncOwnership.js';
import { makePhotoStorageKeyFromNames } from '../../services/storageNaming.js';
import {
  deleteLocalFile,
  localFileExists,
  publicFileUrl,
  writeLocalFile,
} from '../../storage/localFiles.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
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
import {
  CanonicalInputError,
  INSTALLATION_METADATA_TEXT_LIMITS,
  INSTALLATION_ZONE_CODE_MAX_LENGTH,
  canonicalTreeMutationFingerprint,
  deriveSiteCode,
  deriveZoneCode,
  installationReadiness,
  isValidInstallationSiteCode,
  normalizeInstallationTreeV2,
  retainOmittedCanonicalInstallationFields,
  type CanonicalFormSubmission,
} from './canonical.js';
import {
  assertCompletedFormsImmutable,
  ensureCanonicalRecordVersion,
  isCanonicalChildOwnershipDatabaseError,
  loadCanonicalInstallationTree,
  projectLegacyInstallationTree,
  retainCompletedFormsDuringMetadata,
  replaceCanonicalInstallationChildren,
  type InstallHubExecutor,
} from './treeService.js';
import { paginateReadiness } from './canonicalPagination.js';
import {
  CommsReplacementStateError,
  ambiguousCommsReplacementMeterIds,
  authorizeCommsReplacementTransitions,
  completedCommsReplacementTransitions,
  retainPendingCommsReplacementMeterState,
  type CommsReplacementTransition,
} from './meterHistory.js';
import {
  AUSTRALIAN_STATES,
  normalizeSchedulerAddressText,
  schedulerAddressFingerprint,
} from '../../services/schedulerAddressService.js';

type PushBody = {
  syncStage?: 'metadata' | 'complete';
  treeSchemaVersion?: number;
  baseTreeRevision?: number;
  installation?: JsonRecord;
  gridSupplies?: JsonRecord[];
  zones?: JsonRecord[];
  electricalAssets?: JsonRecord[];
  siteAssets?: JsonRecord[];
  meterDevices?: JsonRecord[];
  measurementAssignments?: JsonRecord[];
  formSubmissions?: JsonRecord[];
  serverDerived?: JsonRecord;
};

export function parseInstallHubTreeSchemaMode(body: {
  treeSchemaVersion?: unknown;
  installation?: JsonRecord;
}): 1 | 2 {
  const topLevelDeclared = Object.prototype.hasOwnProperty.call(body, 'treeSchemaVersion');
  const nestedDeclared = Boolean(body.installation)
    && Object.prototype.hasOwnProperty.call(body.installation, 'treeSchemaVersion');
  if (!topLevelDeclared && !nestedDeclared) return 1;
  // Legacy payloads historically carried version 1 only on the nested row.
  // Preserve that shape, but never interpret any other nested declaration as v1.
  if (!topLevelDeclared && body.installation?.treeSchemaVersion === 1) return 1;
  if (body.treeSchemaVersion !== 2) {
    throw badRequest('unsupported_tree_schema');
  }
  if (nestedDeclared && body.installation?.treeSchemaVersion !== 2) {
    throw badRequest('unsupported_tree_schema');
  }
  return 2;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

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

type CanonicalInstallationAuthority = {
  externalKey: string;
  siteCode: string;
  timezone: string;
  treeRevision: number;
  recordVersionNumber: number;
  zoneCodes?: ReadonlyMap<string, string>;
  meterCustomNames?: ReadonlyMap<string, string>;
};

function isMissingCanonicalValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && !value.trim());
}

function isProvisionalExternalKey(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('local:');
}

function canonicalOptionalString(
  source: JsonRecord,
  key: string,
  fallback: string,
): string {
  const value = source[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw badRequest(`${key} must be a string`);
  return value.trim() || fallback;
}

function canonicalServerInteger(value: unknown, authoritativeValue: number): unknown {
  if (value == null) return authoritativeValue;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return authoritativeValue;
  }
  return value;
}

/**
 * Supplies only server-owned/defaulted values needed to normalize a canonical
 * create or a mobile follow-up write. Explicit invalid client values remain in
 * place so the canonical normalizer rejects them. Every create receives a new
 * server identity. Existing missing/local keys converge to server authority.
 * A base-zero/omitted first-create replay also converges before fingerprinting
 * so an imported copy can recover an ambiguous response after the server has
 * replaced its source identity. Canonical identity replacement remains
 * fail-closed for ordinary existing-tree updates.
 */
export function prepareCanonicalInstallHubWrite(
  body: PushBody,
  authority: CanonicalInstallationAuthority | undefined,
  generatedExternalKey: string,
): PushBody {
  if (!body.installation) throw badRequest('installation is required');
  const installation = body.installation;
  const siteName = canonicalOptionalString(
    installation,
    'siteName',
    'Untitled installation',
  );
  const siteCode = authority?.siteCode?.trim()
    ? authority.siteCode
    : deriveInstallHubSiteCode(siteName);
  const timezone = authority?.timezone ?? 'Australia/Sydney';
  const externalKey = authority?.externalKey ?? generatedExternalKey;
  const suppliedExternalKey = installation.externalKey;
  const firstCreateReplay = Boolean(authority)
    && (body.baseTreeRevision === undefined || body.baseTreeRevision === 0);
  const preparedExternalKey = authority
    ? (
        isMissingCanonicalValue(suppliedExternalKey)
        || isProvisionalExternalKey(suppliedExternalKey)
        || (firstCreateReplay && (typeof suppliedExternalKey === 'string' || suppliedExternalKey == null))
          ? externalKey
          : suppliedExternalKey
      )
    : (typeof suppliedExternalKey === 'string' || suppliedExternalKey == null
        ? externalKey
        : suppliedExternalKey);
  const reservedZoneCodes = new Set(authority?.zoneCodes?.values() ?? []);
  for (const zone of body.zones ?? []) {
    if (typeof zone.zoneCode === 'string' && zone.zoneCode.trim()) {
      reservedZoneCodes.add(zone.zoneCode.trim());
    }
  }
  const generatedZoneCodes = new Map<string, string>();
  for (const zone of [...(body.zones ?? [])].sort((left, right) => (
    String(left.id ?? '').localeCompare(String(right.id ?? ''))
  ))) {
    const zoneId = typeof zone.id === 'string' ? zone.id : null;
    const zoneCodeMissing = zone.zoneCode == null
      || (typeof zone.zoneCode === 'string' && !zone.zoneCode.trim());
    if (!zoneId || !zoneCodeMissing) continue;
    const authoritativeZoneCode = authority?.zoneCodes?.get(zoneId);
    if (authoritativeZoneCode) {
      generatedZoneCodes.set(zoneId, authoritativeZoneCode);
      continue;
    }
    if (typeof zone.zoneName !== 'string' || !zone.zoneName.trim()) continue;
    const zoneCode = nextLegacyZoneCode(deriveZoneCode(zone.zoneName), reservedZoneCodes);
    reservedZoneCodes.add(zoneCode);
    generatedZoneCodes.set(zoneId, zoneCode);
  }
  const preparedZones = body.zones?.map((zone) => {
    const zoneId = typeof zone.id === 'string' ? zone.id : null;
    const zoneCode = zoneId ? generatedZoneCodes.get(zoneId) : undefined;
    return zoneCode ? { ...zone, zoneCode } : zone;
  });
  const preparedMeterDevices = body.meterDevices?.map((meter) => {
    const meterId = typeof meter.id === 'string' ? meter.id : null;
    if (!meterId || !isMissingCanonicalValue(meter.customName)) return meter;
    const authoritativeCustomName = authority?.meterCustomNames?.get(meterId);
    return authoritativeCustomName === undefined
      ? meter
      : { ...meter, customName: authoritativeCustomName };
  });
  return {
    ...body,
    ...(preparedZones ? { zones: preparedZones } : {}),
    ...(preparedMeterDevices ? { meterDevices: preparedMeterDevices } : {}),
    installation: {
      ...installation,
      siteName,
      treeSchemaVersion: installation.treeSchemaVersion ?? 2,
      externalKey: preparedExternalKey,
      siteCode: installation.siteCode === undefined || installation.siteCode === null
        ? siteCode
        : installation.siteCode,
      timezone: isMissingCanonicalValue(installation.timezone)
        ? timezone
        : installation.timezone,
      treeRevision: canonicalServerInteger(
        installation.treeRevision,
        authority?.treeRevision ?? 0,
      ),
      recordVersionNumber: canonicalServerInteger(
        installation.recordVersionNumber,
        authority?.recordVersionNumber ?? 0,
      ),
    },
  };
}

/**
 * Grandfathers only the exact non-empty site code already owned by this
 * installation. Fresh values and deliberate edits must satisfy the current
 * bounded contract; callers may never silently derive a replacement for an
 * existing code because generated display-code identity depends on it.
 */
export function assertInstallHubSiteCodeWriteAllowed(
  siteCode: unknown,
  authoritativeSiteCode?: string | null,
): void {
  if (typeof siteCode !== 'string' || !siteCode.trim()) {
    throw badRequest('installation.siteCode is required');
  }
  if (
    typeof authoritativeSiteCode === 'string'
    && authoritativeSiteCode.trim()
    && siteCode === authoritativeSiteCode
  ) return;
  if (!isValidInstallationSiteCode(siteCode)) {
    throw badRequest(
      'installation.siteCode must be 1-16 uppercase letters/digits, with single hyphens only between groups',
    );
  }
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

export const deriveInstallHubSiteCode = deriveSiteCode;

/**
 * Installation lifecycle is server-owned. Canonical sync can replay an
 * already-completed row, but only POST /installations/:id/complete may create
 * the first Draft -> Completed transition (and its immutable sign-off).
 */
export function installHubInstallationStatusForSync(
  existingStatus?: string | null,
): 'Draft' | 'Completed' {
  return existingStatus === 'Completed' ? 'Completed' : 'Draft';
}

/** Legacy full-snapshot clients must upgrade/delegate installation completion. */
export function assertLegacyInstallHubCompletionUsesCanonicalRoute(
  incomingStatus: string,
  existingStatus?: string | null,
): void {
  if (incomingStatus === 'Completed' && existingStatus !== 'Completed') {
    throw conflict('upgrade_required');
  }
}

function payloadOwns(payload: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined;
}

function legacyNullableText(
  payload: JsonRecord,
  key: string,
  maxLength: number,
  existingValue?: string | null,
): string | null {
  if (!payloadOwns(payload, key)) return existingValue ?? null;
  const value = payload[key];
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${key} must be a string or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw badRequest(`${key} must contain at most ${maxLength} characters`);
  }
  return normalized;
}

function legacyNullableBoolean(
  payload: JsonRecord,
  key: string,
  existingValue?: boolean | null,
): boolean | null {
  if (!payloadOwns(payload, key)) return existingValue ?? null;
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== 'boolean') throw badRequest(`${key} must be a boolean or null`);
  return value;
}

function legacyNullableSolarCapacity(
  payload: JsonRecord,
  existingValue?: number | null,
): number | null {
  if (!payloadOwns(payload, 'solarCapacityKw')) return existingValue ?? null;
  const value = payload.solarCapacityKw;
  if (value === null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > 1_000_000
  ) {
    throw badRequest('solarCapacityKw must be a finite number between 0 and 1000000, or null');
  }
  return value;
}

function legacyNullableSiteState(
  payload: JsonRecord,
  existingValue?: string | null,
): typeof AUSTRALIAN_STATES[number] | null {
  if (!payloadOwns(payload, 'siteState')) {
    return (existingValue as typeof AUSTRALIAN_STATES[number] | null | undefined) ?? null;
  }
  const value = payload.siteState;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('siteState must be a string or null');
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_STATES.includes(normalized as typeof AUSTRALIAN_STATES[number])) {
    throw badRequest('siteState must be an Australian state or territory abbreviation');
  }
  return normalized as typeof AUSTRALIAN_STATES[number];
}

function legacyNullableSitePostcode(
  payload: JsonRecord,
  existingValue?: string | null,
): string | null {
  const postcode = legacyNullableText(payload, 'sitePostcode', 4, existingValue);
  if (postcode !== null && !/^\d{4}$/.test(postcode)) {
    throw badRequest('sitePostcode must contain four digits');
  }
  return postcode;
}

function legacyNullableSiteCountry(
  payload: JsonRecord,
  existingValue?: string | null,
): 'AU' | null {
  if (!payloadOwns(payload, 'siteCountryCode')) {
    return existingValue === 'AU' ? 'AU' : null;
  }
  const value = payload.siteCountryCode;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().toUpperCase() !== 'AU') {
    throw badRequest('siteCountryCode must be AU or null');
  }
  return 'AU';
}

type InstallHubAddressComparable = {
  siteAddress: string;
  siteLocality?: string | null;
  siteState?: string | null;
  sitePostcode?: string | null;
  siteCountryCode?: string | null;
};

function normalizedOptionalAddressPart(value: string | null | undefined): string | null {
  return value && value.trim() ? normalizeSchedulerAddressText(value) : null;
}

export function installHubSiteAddressChanged(
  current: InstallHubAddressComparable,
  next: InstallHubAddressComparable,
): boolean {
  return normalizeSchedulerAddressText(current.siteAddress)
      !== normalizeSchedulerAddressText(next.siteAddress)
    || normalizedOptionalAddressPart(current.siteLocality)
      !== normalizedOptionalAddressPart(next.siteLocality)
    || normalizedOptionalAddressPart(current.siteState)
      !== normalizedOptionalAddressPart(next.siteState)
    || normalizedOptionalAddressPart(current.sitePostcode)
      !== normalizedOptionalAddressPart(next.sitePostcode)
    || normalizedOptionalAddressPart(current.siteCountryCode)
      !== normalizedOptionalAddressPart(next.siteCountryCode);
}

function installHubGeocodeInvalidation(
  current: InstallHubAddressComparable | undefined,
  next: InstallHubAddressComparable,
) {
  if (current && !installHubSiteAddressChanged(current, next)) return {};
  return {
    siteLatitude: null,
    siteLongitude: null,
    siteGeocodeStatus: 'unresolved' as const,
    siteGeocodeProvider: null,
    siteGeocodePlaceId: null,
    siteAddressFingerprint: schedulerAddressFingerprint(next.siteAddress),
    siteGeocodedAt: null,
  };
}

export function installationValuesFromPayload(
  payload: JsonRecord,
  actor: { userId: string; role: string },
  existing?: typeof ihInstallations.$inferSelect,
) {
  const id = requiredString(payload, 'id');
  const siteName = requiredString(payload, 'siteName');
  const clientName = requiredString(payload, 'clientName');
  const siteAddress = requiredString(payload, 'siteAddress');
  const derivedSiteCode = deriveInstallHubSiteCode(siteName);
  const siteLocality = legacyNullableText(payload, 'siteLocality', 200, existing?.siteLocality);
  const siteState = legacyNullableSiteState(payload, existing?.siteState);
  const sitePostcode = legacyNullableSitePostcode(payload, existing?.sitePostcode);
  const siteCountryCode = legacyNullableSiteCountry(payload, existing?.siteCountryCode);
  return {
    id,
    serverId: existing?.serverId ?? optionalString(payload, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(payload.updatedAt),
    deletedAt: optionalDate(payload.deletedAt),
    externalKey: existing?.externalKey ?? `ih_${randomUUID()}`,
    siteCode: existing?.siteCode ?? (() => {
      const supplied = optionalString(payload, 'siteCode')?.trim().toUpperCase();
      return supplied && isValidInstallationSiteCode(supplied) ? supplied : derivedSiteCode;
    })(),
    timezone: optionalString(payload, 'timezone') ?? existing?.timezone ?? 'Australia/Sydney',
    treeSchemaVersion: existing?.treeSchemaVersion ?? 1,
    treeRevision: existing?.treeRevision ?? 0,
    recordVersionNumber: existing?.recordVersionNumber ?? 0,
    customerName: legacyNullableText(
      payload,
      'customerName',
      INSTALLATION_METADATA_TEXT_LIMITS.customerName,
      existing?.customerName,
    ),
    clientName,
    maas: legacyNullableBoolean(payload, 'maas', existing?.maas),
    serviceType: legacyNullableText(
      payload,
      'serviceType',
      INSTALLATION_METADATA_TEXT_LIMITS.serviceType,
      existing?.serviceType,
    ),
    meteringSolutionType: legacyNullableText(
      payload,
      'meteringSolutionType',
      INSTALLATION_METADATA_TEXT_LIMITS.meteringSolutionType,
      existing?.meteringSolutionType,
    ),
    plannedMeterType: legacyNullableText(
      payload,
      'plannedMeterType',
      INSTALLATION_METADATA_TEXT_LIMITS.plannedMeterType,
      existing?.plannedMeterType,
    ),
    customJobNumber: legacyNullableText(
      payload,
      'customJobNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.customJobNumber,
      existing?.customJobNumber,
    ),
    siteName,
    siteAddress,
    siteLocality,
    siteState,
    sitePostcode,
    siteCountryCode,
    siteContactName: legacyNullableText(
      payload,
      'siteContactName',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactName,
      existing?.siteContactName,
    ),
    siteContactPhone: legacyNullableText(
      payload,
      'siteContactPhone',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactPhone,
      existing?.siteContactPhone,
    ),
    siteContactEmail: legacyNullableText(
      payload,
      'siteContactEmail',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactEmail,
      existing?.siteContactEmail,
    ),
    fergusJobNumber: legacyNullableText(
      payload,
      'fergusJobNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.fergusJobNumber,
      existing?.fergusJobNumber,
    ),
    quoteNumber: legacyNullableText(
      payload,
      'quoteNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.quoteNumber,
      existing?.quoteNumber,
    ),
    jobComments: legacyNullableText(
      payload,
      'jobComments',
      INSTALLATION_METADATA_TEXT_LIMITS.jobComments,
      existing?.jobComments,
    ),
    accessInformation: legacyNullableText(
      payload,
      'accessInformation',
      INSTALLATION_METADATA_TEXT_LIMITS.accessInformation,
      existing?.accessInformation,
    ),
    warrantyDevice: legacyNullableBoolean(payload, 'warrantyDevice', existing?.warrantyDevice),
    monitoringInstalled: legacyNullableBoolean(
      payload,
      'monitoringInstalled',
      existing?.monitoringInstalled,
    ),
    hardwareInstalled: legacyNullableBoolean(
      payload,
      'hardwareInstalled',
      existing?.hardwareInstalled,
    ),
    solarCapacityKw: legacyNullableSolarCapacity(payload, existing?.solarCapacityKw),
    additionalMonitoringRequired: legacyNullableBoolean(
      payload,
      'additionalMonitoringRequired',
      existing?.additionalMonitoringRequired,
    ),
    additionalMonitoringHardware: legacyNullableText(
      payload,
      'additionalMonitoringHardware',
      INSTALLATION_METADATA_TEXT_LIMITS.additionalMonitoringHardware,
      existing?.additionalMonitoringHardware,
    ),
    ...installHubGeocodeInvalidation(existing, {
      siteAddress,
      siteLocality,
      siteState,
      sitePostcode,
      siteCountryCode,
    }),
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
  executor: InstallHubExecutor = db,
): Promise<{ name: string }> {
  if (entityType === 'installation' && entityId === installationId) {
    const [row] = await executor.select().from(ihInstallations).where(and(
      eq(ihInstallations.id, installationId),
      isNull(ihInstallations.deletedAt),
    ));
    return { name: assertFound(row, 'Installation').siteName };
  }
  if (entityType === 'zone') {
    const [row] = await executor.select().from(ihZones).where(and(
      eq(ihZones.id, entityId),
      eq(ihZones.installationId, installationId),
      isNull(ihZones.deletedAt),
    ));
    return { name: assertFound(row, 'Zone').zoneName };
  }
  if (entityType === 'electrical_asset') {
    const [row] = await executor.select().from(ihElectricalAssets).where(and(
      eq(ihElectricalAssets.id, entityId),
      eq(ihElectricalAssets.installationId, installationId),
      isNull(ihElectricalAssets.deletedAt),
    ));
    return { name: assertFound(row, 'Electrical asset').assetName };
  }
  if (entityType === 'site_asset') {
    const [row] = await executor.select().from(ihSiteAssets).where(and(
      eq(ihSiteAssets.id, entityId),
      eq(ihSiteAssets.installationId, installationId),
      isNull(ihSiteAssets.deletedAt),
    ));
    return { name: assertFound(row, 'Site asset').assetName };
  }
  if (entityType === 'meter_device') {
    const [row] = await executor.select().from(ihMeterDevices).where(and(
      eq(ihMeterDevices.id, entityId),
      eq(ihMeterDevices.installationId, installationId),
      isNull(ihMeterDevices.deletedAt),
    ));
    const meter = assertFound(row, 'Meter device');
    return { name: meter.displayCode ?? meter.deviceNumber ?? meter.serialNumber };
  }
  if (entityType === 'form_submission') {
    const [row] = await executor.select().from(ihFormSubmissions).where(and(
      eq(ihFormSubmissions.id, entityId),
      eq(ihFormSubmissions.installationId, installationId),
      isNull(ihFormSubmissions.deletedAt),
    ));
    const form = assertFound(row, 'Form submission');
    return { name: `${form.formType}-${form.id}` };
  }
  throw badRequest('Unsupported upload entityType');
}

export function assertInstallHubUploadFieldName(
  entityType: string,
  fieldName: string,
): void {
  if (entityType !== 'meter_device') return;
  if (
    /^wwPhotos\.(deviceInstalled|switchboardOverview|labeling)$/.test(fieldName)
    || /^wwPhotos\.extra\[\d+]$/.test(fieldName)
  ) return;
  throw badRequest('Unsupported meter_device photo fieldName');
}

export function parseInstallHubUploadBaseTreeRevision(
  value: unknown,
  required = config.installhubUploadRevisionCasRequired,
): number | undefined {
  if (value === undefined) {
    if (required) throw conflict('client_upgrade_required: upload baseTreeRevision');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest('baseTreeRevision must be a non-negative integer');
  }
  return value;
}

function nextLegacyZoneCode(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `-${ordinal}`;
    const candidate = `${base.slice(0, INSTALLATION_ZONE_CODE_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function zoneValues(
  item: JsonRecord,
  installationId: string,
  existing?: typeof ihZones.$inferSelect,
  allocatedZoneCode?: string,
) {
  requireParentId(item, installationId);
  const zoneName = requiredString(item, 'zoneName');
  return {
    id: requiredString(item, 'id'),
    serverId: existing?.serverId ?? optionalString(item, 'serverId') ?? randomUUID(),
    syncStatus: 'synced',
    updatedAt: dateOrNow(item.updatedAt),
    deletedAt: optionalDate(item.deletedAt),
    installationId,
    zoneCode: existing?.zoneCode ?? allocatedZoneCode ?? deriveZoneCode(zoneName),
    zoneName,
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
  if (syncStage === 'metadata' && status === 'Completed' && existing?.status !== 'Completed') {
    throw badRequest('metadata_stage_cannot_complete_form');
  }
  validateInstallHubFormContract({
    formType,
    schemaVersion,
    status,
    answers,
    attachments,
    syncStage: status === 'Completed' ? 'complete' : syncStage,
    allowLegacyCompletedWwLoadOnly: existing?.status === 'Completed',
  });
  const values = {
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
    historicalMeterRemoved: existing?.historicalMeterRemoved ?? false,
    createdAt: item.createdAt ? dateOrNow(item.createdAt) : (existing?.createdAt ?? new Date()),
  };
  if (existing?.status === 'Completed') {
    try {
      assertCompletedFormsImmutable({
        existing: [canonicalFormForImmutability(existing)],
        incoming: [canonicalFormForImmutability(values)],
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('COMPLETED_FORM_IMMUTABLE:')) {
        throw conflict(error.message);
      }
      throw error;
    }
  }
  return values;
}

type ImmutableFormInput = {
  id: string;
  installationId: string;
  formType: string;
  schemaVersion: number;
  status: string;
  zoneId?: string | null;
  boardId?: string | null;
  meterId?: string | null;
  siteAssetId?: string | null;
  answers: unknown;
  attachments: unknown;
  completedAt?: Date | string | null;
  supersedesId?: string | null;
};

function canonicalFormForImmutability(form: ImmutableFormInput): CanonicalFormSubmission {
  return {
    id: form.id,
    installationId: form.installationId,
    formType: form.formType,
    schemaVersion: form.schemaVersion,
    status: form.status,
    zoneId: form.zoneId ?? null,
    boardId: form.boardId ?? null,
    meterId: form.meterId ?? null,
    siteAssetId: form.siteAssetId ?? null,
    answers: jsonObject(form.answers) as Record<string, string>,
    attachments: jsonArray(form.attachments),
    completedAt: form.completedAt ? isoDate(form.completedAt) : null,
    supersedesId: form.supersedesId ?? null,
  };
}

export function validateCanonicalFormContractsForSync(input: {
  incoming: readonly CanonicalFormSubmission[];
  existing?: readonly CanonicalFormSubmission[];
  syncStage?: PushBody['syncStage'];
}): void {
  const persistedCompletedIds = new Set(
    input.existing
      ?.filter((form) => form.status === 'Completed')
      .map((form) => form.id) ?? [],
  );
  for (const form of input.incoming) {
    validateInstallHubFormContract({
      formType: form.formType,
      schemaVersion: form.schemaVersion,
      status: form.status,
      answers: form.answers,
      attachments: form.attachments,
      syncStage: form.status === 'Completed' ? 'complete' : input.syncStage,
      allowLegacyCompletedWwLoadOnly: persistedCompletedIds.has(form.id),
    });
  }
}

export async function installhubSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post('/check-photo', {
    schema: { tags: ['Field App Complete Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const installationId = requiredString(body, 'installationId');
    const baseTreeRevision = parseInstallHubUploadBaseTreeRevision(body.baseTreeRevision);
    if (baseTreeRevision === undefined) {
      request.log.warn({ installationId, endpoint: 'check-photo' },
        'Accepted deprecated InstallHub upload request without baseTreeRevision');
    }
    const entityType = requiredString(body, 'entityType');
    const entityId = requiredString(body, 'entityId');
    const fieldName = requiredString(body, 'fieldName');
    assertInstallHubUploadFieldName(entityType, fieldName);
    await loadAccessibleInstallation(installationId, request);
    await loadUploadEntity(installationId, entityType, entityId);

    const duplicateIdentity = [
      eq(photoRegistry.app, 'installhub'),
      eq(photoRegistry.checksum, checksum),
      eq(photoRegistry.parentId, installationId),
      eq(photoRegistry.entityType, entityType),
      eq(photoRegistry.entityId, entityId),
      eq(photoRegistry.fieldName, fieldName),
      eq(photoRegistry.status, 'confirmed'),
    ] as const;
    const [existing] = await db.select().from(photoRegistry).where(
      baseTreeRevision === undefined
        ? and(...duplicateIdentity)
        : and(
            ...duplicateIdentity,
            or(
              eq(photoRegistry.baseTreeRevision, baseTreeRevision),
              eq(photoRegistry.confirmedTreeRevision, baseTreeRevision),
            ),
            isNotNull(photoRegistry.confirmedTreeRevision),
          ),
    );
    return reply.send({
      exists: Boolean(existing),
      remoteUrl: existing?.remoteUrl,
      fileSizeBytes: existing?.fileSizeBytes,
      photoId: existing?.id,
      treeRevision: existing?.confirmedTreeRevision,
    });
  });

  app.post('/create-upload-session', {
    schema: { tags: ['Field App Complete Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as JsonRecord;
    const checksum = requiredString(body, 'checksum');
    const installationId = requiredString(body, 'installationId');
    const baseTreeRevision = parseInstallHubUploadBaseTreeRevision(body.baseTreeRevision);
    if (baseTreeRevision === undefined) {
      request.log.warn({ installationId, endpoint: 'create-upload-session' },
        'Accepted deprecated InstallHub upload request without baseTreeRevision');
    }
    const entityType = requiredString(body, 'entityType');
    const entityId = requiredString(body, 'entityId');
    const fieldName = requiredString(body, 'fieldName');
    assertInstallHubUploadFieldName(entityType, fieldName);
    const filename = requiredString(body, 'filename');
    const fileSizeBytes = Number(body.fileSizeBytes);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      throw badRequest('fileSizeBytes must be a positive number');
    }
    if (fileSizeBytes > config.storage.maxUploadBytes) {
      throw badRequest(`File exceeds max upload size of ${config.storage.maxUploadBytes} bytes`);
    }

    const result = await db.transaction(async (tx) => {
      const [installation] = await tx.select().from(ihInstallations).where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      )).for('update');
      const lockedInstallation = assertFound(installation, 'Installation');
      assertInstallationAccess(lockedInstallation, request.user);
      if (lockedInstallation.status === 'Completed') {
        throw conflict('installation_completed_reopen_required');
      }
      const effectiveBaseTreeRevision = baseTreeRevision ?? lockedInstallation.treeRevision;
      const entity = await loadUploadEntity(installationId, entityType, entityId, tx);
      const duplicateIdentity = [
        eq(photoRegistry.app, 'installhub'),
        eq(photoRegistry.checksum, checksum),
        eq(photoRegistry.parentId, installationId),
        eq(photoRegistry.entityType, entityType),
        eq(photoRegistry.entityId, entityId),
        eq(photoRegistry.fieldName, fieldName),
        eq(photoRegistry.status, 'confirmed'),
      ] as const;
      const [duplicate] = await tx.select().from(photoRegistry).where(
        baseTreeRevision === undefined
          ? and(...duplicateIdentity)
          : and(
              ...duplicateIdentity,
              or(
                eq(photoRegistry.baseTreeRevision, baseTreeRevision),
                eq(photoRegistry.confirmedTreeRevision, baseTreeRevision),
              ),
              isNotNull(photoRegistry.confirmedTreeRevision),
            ),
      );
      if (duplicate?.remoteUrl) {
        if (
          baseTreeRevision !== undefined
          && !Number.isSafeInteger(duplicate.confirmedTreeRevision)
        ) {
          throw conflict('upload_confirmation_revision_unavailable');
        }
        return {
          statusCode: 200,
          body: {
            sessionId: duplicate.id,
            uploadUrl: null,
            alreadyExists: true,
            remoteUrl: duplicate.remoteUrl,
            treeRevision: duplicate.confirmedTreeRevision ?? lockedInstallation.treeRevision,
          },
        };
      }
      if (
        baseTreeRevision !== undefined
        && lockedInstallation.treeRevision !== baseTreeRevision
      ) {
        throw conflict('snapshot_conflict');
      }

      const sessionId = randomUUID();
      const storageKey = makePhotoStorageKeyFromNames({
        app: 'installhub',
        parentName: lockedInstallation.siteName,
        entityType,
        entityName: entity.name,
        fieldName,
        sessionId,
        filename,
      });
      await tx.insert(photoRegistry).values({
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
        baseTreeRevision: effectiveBaseTreeRevision,
      });
      return {
        statusCode: 201,
        body: {
          sessionId,
          uploadUrl: uploadUrl(sessionId),
          alreadyExists: false,
        },
      };
    });
    return reply.status(result.statusCode).send(result.body);
  });

  app.put('/upload/:sessionId', {
    schema: { tags: ['Field App Complete Sync'] },
    onRequest: requireUploadCapability('installhub'),
    bodyLimit: config.storage.maxUploadBytes,
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!Buffer.isBuffer(request.body)) throw badRequest('Upload body must be raw bytes');
    const body = request.body;
    const [session] = await db.select({ parentId: photoRegistry.parentId })
      .from(photoRegistry).where(and(
      eq(photoRegistry.id, sessionId),
      eq(photoRegistry.app, 'installhub'),
    ));
    const foundSession = assertFound(session, 'Upload session');
    let writtenStorageKey: string | null = null;
    try {
      const outcome = await db.transaction(async (tx) => {
        // Installation is always the first row lock, matching purge/confirm and
        // preventing a session lock -> installation lock deadlock.
        const [installation] = await tx.select().from(ihInstallations).where(and(
          eq(ihInstallations.id, foundSession.parentId),
          isNull(ihInstallations.deletedAt),
        )).for('update');
        const lockedInstallation = assertFound(installation, 'Installation');
        if (lockedInstallation.status === 'Completed') {
          throw conflict('installation_completed_reopen_required');
        }
        const [current] = await tx.select().from(photoRegistry).where(and(
          eq(photoRegistry.id, sessionId),
          eq(photoRegistry.app, 'installhub'),
        )).for('update');
        const locked = assertFound(current, 'Upload session');
        if (locked.parentId !== lockedInstallation.id) {
          throw conflict('upload_parent_changed');
        }
        await loadUploadEntity(
          locked.parentId,
          locked.entityType,
          locked.entityId,
          tx,
        );
        if (locked.status !== 'pending') throw badRequest(`Upload session is ${locked.status}`);
        assertUploadSessionFresh(locked.createdAt);
        if (!locked.storageKey) throw badRequest('Upload session has no storage key');
        if (locked.fileSizeBytes && locked.fileSizeBytes !== body.length) {
          throw badRequest('Uploaded file size does not match session');
        }

        writtenStorageKey = locked.storageKey;
        const written = await writeLocalFile(locked.storageKey, body);
        if (written.checksum !== locked.checksum) {
          await deleteLocalFile(locked.storageKey);
          writtenStorageKey = null;
          const [failed] = await tx.update(photoRegistry).set({ status: 'failed' }).where(and(
            eq(photoRegistry.id, sessionId),
            eq(photoRegistry.status, 'pending'),
          )).returning({ id: photoRegistry.id });
          if (!failed) throw conflict('upload_session_conflict');
          return { checksumMismatch: true as const, written };
        }
        const [uploaded] = await tx.update(photoRegistry).set({
          status: 'uploaded',
          fileSizeBytes: written.size,
          contentType: String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0],
          uploadedAt: new Date(),
        }).where(and(
          eq(photoRegistry.id, sessionId),
          eq(photoRegistry.status, 'pending'),
        )).returning({ id: photoRegistry.id });
        if (!uploaded) throw conflict('upload_session_conflict');
        return { checksumMismatch: false as const, written };
      });
      writtenStorageKey = null;
      if (outcome.checksumMismatch) {
        throw badRequest('Uploaded checksum does not match session');
      }
      return reply.send({
        ok: true,
        checksum: outcome.written.checksum,
        fileSizeBytes: outcome.written.size,
      });
    } catch (error) {
      if (writtenStorageKey) {
        await deleteLocalFile(writtenStorageKey).catch((cleanupError) => {
          request.log.warn({ err: cleanupError }, 'Failed to compensate aborted upload write');
        });
      }
      throw error;
    }
  });

  app.post('/confirm-upload', {
    schema: { tags: ['Field App Complete Sync'], security: [{ bearerAuth: [] }] },
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
    if (found.checksum !== checksum) throw badRequest('Checksum does not match session');
    let mirroredDrivePath: string | null = null;
    try {
      const outcome = await db.transaction(async (tx) => {
        const [installation] = await tx.select().from(ihInstallations).where(and(
          eq(ihInstallations.id, found.parentId),
          isNull(ihInstallations.deletedAt),
        )).for('update');
        if (!installation) throw notFound('Installation');
        assertInstallationAccess(installation, request.user);

        const [current] = await tx.select().from(photoRegistry).where(and(
          eq(photoRegistry.id, sessionId),
          eq(photoRegistry.app, 'installhub'),
        )).for('update');
        const locked = assertFound(current, 'Upload session');
        if (locked.parentId !== installation.id) throw conflict('upload_parent_changed');
        await loadUploadEntity(
          locked.parentId,
          locked.entityType,
          locked.entityId,
          tx,
        );
        if (locked.checksum !== checksum) throw badRequest('Checksum does not match session');
        if (locked.status === 'confirmed' && locked.remoteUrl) {
          if (!Number.isSafeInteger(locked.confirmedTreeRevision)) {
            if (config.installhubUploadRevisionCasRequired) {
              throw conflict('upload_confirmation_revision_unavailable');
            }
            request.log.warn({ sessionId, installationId: installation.id },
              'Replayed deprecated InstallHub confirmation without a pinned revision');
            return {
              remoteUrl: locked.remoteUrl,
              treeRevision: installation.treeRevision,
            };
          }
          return {
            remoteUrl: locked.remoteUrl,
            treeRevision: locked.confirmedTreeRevision,
          };
        }
        const effectiveBaseTreeRevision = Number.isSafeInteger(locked.baseTreeRevision)
          ? locked.baseTreeRevision!
          : config.installhubUploadRevisionCasRequired
            ? undefined
            : installation.treeRevision;
        if (!Number.isSafeInteger(locked.baseTreeRevision) && effectiveBaseTreeRevision !== undefined) {
          request.log.warn({ sessionId, installationId: installation.id },
            'Bound deprecated InstallHub upload session at confirmation time');
        }
        if (
          effectiveBaseTreeRevision === undefined
          || installation.treeRevision !== effectiveBaseTreeRevision
        ) {
          throw conflict('snapshot_conflict');
        }
        if (installation.status === 'Completed') {
          throw conflict('installation_completed_reopen_required');
        }
        if (locked.status !== 'uploaded') throw badRequest(`Upload session is ${locked.status}`);
        if (!locked.storageKey || !(await localFileExists(locked.storageKey))) {
          throw badRequest('Uploaded file is missing');
        }

        const remoteUrl = publicFileUrl(locked.storageKey);
        const oneDriveBackup = locked.onedriveItemId
          ? null
          : await mirrorStoredPhotoToOneDrive({
              storageKey: locked.storageKey,
              contentType: locked.contentType,
              logger: request.log,
            });
        mirroredDrivePath = oneDriveBackup?.drivePath ?? null;
        const confirmedAt = new Date();
        const nextRevision = effectiveBaseTreeRevision + 1;
        const [confirmed] = await tx.update(photoRegistry).set({
          status: 'confirmed',
          remoteUrl,
          onedriveItemId: oneDriveBackup?.itemId ?? locked.onedriveItemId,
          uploadedAt: confirmedAt,
          baseTreeRevision: effectiveBaseTreeRevision,
          confirmedTreeRevision: nextRevision,
        }).where(and(
          eq(photoRegistry.id, sessionId),
          eq(photoRegistry.status, 'uploaded'),
        )).returning();
        if (!confirmed) throw conflict('upload_confirmation_conflict');
        const [revised] = await tx.update(ihInstallations).set({
          treeRevision: nextRevision,
          updatedAt: confirmedAt,
          syncStatus: 'synced',
        }).where(and(
          eq(ihInstallations.id, installation.id),
          eq(ihInstallations.treeRevision, installation.treeRevision),
          eq(ihInstallations.status, 'Draft'),
        )).returning();
        if (!revised) throw conflict('snapshot_conflict');
        return { remoteUrl, treeRevision: nextRevision };
      });
      // The database row and mirror are now committed. Compensation below is
      // only for aborted transactions, never for a response transport error.
      mirroredDrivePath = null;
      return reply.send(outcome);
    } catch (error) {
      if (mirroredDrivePath && config.oneDrive.enabled) {
        await deleteOneDrivePath({
          target: config.oneDrive,
          drivePath: mirroredDrivePath,
          ignoreNotFound: true,
        }).catch((cleanupError) => {
          request.log.warn({ err: cleanupError }, 'Failed to compensate aborted OneDrive mirror');
        });
      }
      throw error;
    }
  });

  app.post('/push', {
    schema: { tags: ['Field App Complete Sync'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('installhub'), requireRole('inspector')],
  }, async (request, reply) => {
    const body = request.body as PushBody;
    const syncStage = parseInstallHubSyncStage(body.syncStage);
    if (!body.installation) throw badRequest('installation is required');
    const treeSchemaMode = parseInstallHubTreeSchemaMode(body);

    if (treeSchemaMode === 2) {
      if (!config.installhubCanonicalV2Enabled) {
        throw conflict('canonical_v2_feature_disabled');
      }
      if (
        !Array.isArray(body.gridSupplies)
        || !Array.isArray(body.zones)
        || !Array.isArray(body.electricalAssets)
        || !Array.isArray(body.siteAssets)
        || !Array.isArray(body.meterDevices)
        || !Array.isArray(body.measurementAssignments)
        || !Array.isArray(body.formSubmissions)
      ) {
        throw badRequest(
          'gridSupplies, zones, electricalAssets, siteAssets, meterDevices, measurementAssignments and formSubmissions must be arrays',
        );
      }

      const installationId = requiredString(body.installation, 'id');
      const [existingInstallation] = await db.select().from(ihInstallations)
        .where(and(
          eq(ihInstallations.id, installationId),
          isNull(ihInstallations.deletedAt),
        ));
      const expectedExistingInstallation = Boolean(existingInstallation);
      if (existingInstallation) {
        assertInstallationAccess(existingInstallation, request.user);
      } else if (body.baseTreeRevision !== undefined && body.baseTreeRevision !== 0) {
        throw conflict('snapshot_conflict');
      }
      const existingZoneCodes = existingInstallation
        ? await db.select({ id: ihZones.id, zoneCode: ihZones.zoneCode })
            .from(ihZones)
            .where(and(
              eq(ihZones.installationId, installationId),
              isNull(ihZones.deletedAt),
            ))
        : [];
      const existingMeterCustomNames = existingInstallation
        ? await db.select({ id: ihMeterDevices.id, customName: ihMeterDevices.customName })
            .from(ihMeterDevices)
            .where(and(
              eq(ihMeterDevices.installationId, installationId),
              isNull(ihMeterDevices.deletedAt),
            ))
        : [];

      const now = new Date();
      const serverExternalKey = existingInstallation?.externalKey ?? `ih_${randomUUID()}`;
      const normalizationInput = prepareCanonicalInstallHubWrite(
        body,
        existingInstallation
          ? {
              externalKey: existingInstallation.externalKey,
              siteCode: existingInstallation.siteCode,
              timezone: existingInstallation.timezone,
              treeRevision: existingInstallation.treeRevision,
              recordVersionNumber: existingInstallation.recordVersionNumber,
              zoneCodes: new Map(existingZoneCodes.map((zone) => [zone.id, zone.zoneCode])),
              meterCustomNames: new Map(existingMeterCustomNames.map((meter) => [
                meter.id,
                meter.customName,
              ])),
            }
          : undefined,
        serverExternalKey,
      );
      if (
        existingInstallation
        && normalizationInput.installation?.siteCode !== existingInstallation.siteCode
      ) {
        if (body.baseTreeRevision === undefined) {
          throw conflict('baseTreeRevision_required');
        }
        if (body.baseTreeRevision !== existingInstallation.treeRevision) {
          throw conflict('snapshot_conflict');
        }
      }
      assertInstallHubSiteCodeWriteAllowed(
        normalizationInput.installation?.siteCode,
        existingInstallation?.siteCode,
      );

      let incomingTree;
      try {
        incomingTree = normalizeInstallationTreeV2(normalizationInput);
      } catch (error) {
        if (error instanceof CanonicalInputError) {
          if (error.code === 'display_code_conflict') throw conflict(error.code);
          throw badRequest(`${error.code}: ${error.detail}`);
        }
        throw error;
      }
      const externalKeyConflict = incomingTree.installation.externalKey !== serverExternalKey;
      incomingTree.installation.externalKey = serverExternalKey;
      incomingTree.installation.siteCode = incomingTree.installation.siteCode
        || existingInstallation?.siteCode
        || 'SITE';
      incomingTree.installation.timezone = incomingTree.installation.timezone
        || existingInstallation?.timezone
        || 'Australia/Sydney';
      incomingTree.installation.status = installHubInstallationStatusForSync(
        existingInstallation?.status,
      );
      // Completion notes are pinned only by the canonical completion route.
      // Restore the server value so clients predating this additive field can
      // still replay an exact completed snapshot without erasing the sign-off.
      incomingTree.installation.completionNotes = existingInstallation?.completionNotes ?? null;
      incomingTree.installation.createdByUserId = existingInstallation?.createdByUserId
        ?? request.user.userId;
      incomingTree.installation.assignedInspectorUserId = existingInstallation?.assignedInspectorUserId ?? null;
      incomingTree.installation.createdAt = isoDate(existingInstallation?.createdAt ?? now);
      incomingTree.installation.updatedAt = now.toISOString();

      let transactionResult: {
        treeRevision: number;
        recordVersionNumber: number;
        readiness: ReturnType<typeof installationReadiness>;
      };
      try {
        transactionResult = await db.transaction(async (tx) => {
          let replacementTransitions: CommsReplacementTransition[] = [];
          let replacementFromVersionNumber: number | null = null;
          let commissionedMeterIdentityChangeIds: ReadonlySet<string> = new Set();
          const [current] = await tx.select().from(ihInstallations)
            .where(and(
              eq(ihInstallations.id, installationId),
              isNull(ihInstallations.deletedAt),
            ))
            .for('update');
          if (!current && expectedExistingInstallation) {
            throw conflict('installation_purged');
          }
          if (current) {
            assertInstallationAccess(current, request.user);
            if (incomingTree.installation.siteCode !== current.siteCode) {
              if (body.baseTreeRevision === undefined) {
                throw conflict('baseTreeRevision_required');
              }
              if (body.baseTreeRevision !== current.treeRevision) {
                throw conflict('snapshot_conflict');
              }
            }
            assertInstallHubSiteCodeWriteAllowed(
              incomingTree.installation.siteCode,
              current.siteCode,
            );
            if (incomingTree.installation.siteCode === current.siteCode) {
              incomingTree.installation.siteCode = current.siteCode;
            }
            incomingTree.installation.externalKey = current.externalKey;
            incomingTree.installation.treeRevision = current.treeRevision;
            incomingTree.installation.recordVersionNumber = current.recordVersionNumber;
            const currentTree = await loadCanonicalInstallationTree(installationId, tx);
            if (!currentTree) throw notFound('Installation');
            retainOmittedCanonicalInstallationFields(
              currentTree.installation,
              incomingTree.installation,
            );
            if (syncStage === 'metadata') {
              // Installed clients stage server-completed forms as Draft during
              // metadata sync. Restore those first so only a genuinely pending
              // replacement form defers its meter identity.
              incomingTree.formSubmissions = retainCompletedFormsDuringMetadata({
                existing: currentTree.formSubmissions,
                incoming: incomingTree.formSubmissions,
              });
              retainPendingCommsReplacementMeterState({
                current: currentTree,
                incoming: incomingTree,
              });
              const priorCompleted = new Set(currentTree.formSubmissions
                .filter((form) => form.status === 'Completed')
                .map((form) => form.id));
              if (incomingTree.formSubmissions.some((form) => (
                form.status === 'Completed' && !priorCompleted.has(form.id)
              ))) {
                throw badRequest('metadata_stage_cannot_complete_form');
              }
            }
            replacementTransitions = syncStage === 'metadata'
              ? []
              : completedCommsReplacementTransitions({
                  current: currentTree,
                  incoming: incomingTree,
                });
            if (ambiguousCommsReplacementMeterIds(replacementTransitions).length) {
              throw badRequest('multiple_comms_replacements_per_meter');
            }
            commissionedMeterIdentityChangeIds = authorizeCommsReplacementTransitions({
              current: currentTree,
              incoming: incomingTree,
              transitions: replacementTransitions,
            });
            replacementFromVersionNumber = replacementTransitions.length
              ? await ensureCanonicalRecordVersion({
                  executor: tx,
                  tree: currentTree,
                  userId: request.user.userId,
                })
              : null;
            if (replacementFromVersionNumber !== null) {
              // ensureCanonicalRecordVersion may pin metadata changes made
              // while the replacement form was still a draft. Continue the
              // accepted write from that exact immutable baseline.
              incomingTree.installation.recordVersionNumber = replacementFromVersionNumber;
            }
            validateCanonicalFormContractsForSync({
              incoming: incomingTree.formSubmissions,
              existing: currentTree.formSubmissions,
              syncStage,
            });
            if (
              canonicalTreeMutationFingerprint(currentTree)
              === canonicalTreeMutationFingerprint(incomingTree)
            ) {
              const recordVersionNumber = installHubSyncCreatesRecordVersion(syncStage)
                ? await ensureCanonicalRecordVersion({
                    executor: tx,
                    tree: currentTree,
                    userId: request.user.userId,
                  })
                : current.recordVersionNumber;
              return {
                treeRevision: current.treeRevision,
                recordVersionNumber,
                readiness: installationReadiness(currentTree),
              };
            }
            if (current.status === 'Completed') {
              throw conflict('installation_completed_reopen_required');
            }
            // A legacy imported mobile copy may have durably received the
            // accepted revision before its replacement server identity. Let
            // an exact no-op replay recover, but never let that key authorize
            // an actual mutation of the canonical record.
            if (externalKeyConflict) {
              throw conflict('external_key_conflict');
            }
            if (body.baseTreeRevision === undefined) {
              throw conflict('baseTreeRevision_required');
            }
            if (current.treeRevision !== body.baseTreeRevision) {
              throw conflict('snapshot_conflict');
            }
            const nextRevision = current.treeRevision + 1;
            const [updated] = await tx.update(ihInstallations).set({
              customerName: incomingTree.installation.customerName ?? null,
              clientName: incomingTree.installation.clientName,
              maas: incomingTree.installation.maas ?? null,
              serviceType: incomingTree.installation.serviceType ?? null,
              meteringSolutionType: incomingTree.installation.meteringSolutionType ?? null,
              plannedMeterType: incomingTree.installation.plannedMeterType ?? null,
              customJobNumber: incomingTree.installation.customJobNumber ?? null,
              siteName: incomingTree.installation.siteName,
              siteAddress: incomingTree.installation.siteAddress,
              siteLocality: incomingTree.installation.siteLocality ?? null,
              siteState: incomingTree.installation.siteState ?? null,
              sitePostcode: incomingTree.installation.sitePostcode ?? null,
              siteCountryCode: incomingTree.installation.siteCountryCode ?? null,
              siteContactName: incomingTree.installation.siteContactName ?? null,
              siteContactPhone: incomingTree.installation.siteContactPhone ?? null,
              siteContactEmail: incomingTree.installation.siteContactEmail ?? null,
              fergusJobNumber: incomingTree.installation.fergusJobNumber ?? null,
              quoteNumber: incomingTree.installation.quoteNumber ?? null,
              jobComments: incomingTree.installation.jobComments ?? null,
              accessInformation: incomingTree.installation.accessInformation ?? null,
              warrantyDevice: incomingTree.installation.warrantyDevice ?? null,
              monitoringInstalled: incomingTree.installation.monitoringInstalled ?? null,
              hardwareInstalled: incomingTree.installation.hardwareInstalled ?? null,
              solarCapacityKw: incomingTree.installation.solarCapacityKw ?? null,
              additionalMonitoringRequired:
                incomingTree.installation.additionalMonitoringRequired ?? null,
              additionalMonitoringHardware:
                incomingTree.installation.additionalMonitoringHardware ?? null,
              ...installHubGeocodeInvalidation(current, incomingTree.installation),
              inspectorName: incomingTree.installation.inspectorName,
              auditDate: incomingTree.installation.auditDate,
              siteCode: incomingTree.installation.siteCode,
              timezone: incomingTree.installation.timezone,
              treeSchemaVersion: 2,
              treeRevision: nextRevision,
              syncStatus: 'synced',
              updatedAt: now,
            }).where(and(
              eq(ihInstallations.id, installationId),
              eq(ihInstallations.treeRevision, current.treeRevision),
            )).returning();
            if (!updated) throw conflict('snapshot_conflict');
            incomingTree.installation.treeRevision = nextRevision;
            incomingTree.installation.recordVersionNumber =
              replacementFromVersionNumber ?? current.recordVersionNumber;
          } else {
            if (
              syncStage === 'metadata'
              && incomingTree.formSubmissions.some((form) => form.status === 'Completed')
            ) {
              throw badRequest('metadata_stage_cannot_complete_form');
            }
            if (body.baseTreeRevision !== undefined && body.baseTreeRevision !== 0) {
              throw conflict('snapshot_conflict');
            }
            validateCanonicalFormContractsForSync({
              incoming: incomingTree.formSubmissions,
              syncStage,
            });
            incomingTree.installation.treeRevision = 1;
            incomingTree.installation.recordVersionNumber = 0;
            const [created] = await tx.insert(ihInstallations).values({
              id: installationId,
              serverId: randomUUID(),
              syncStatus: 'synced',
              updatedAt: now,
              deletedAt: null,
              externalKey: incomingTree.installation.externalKey,
              siteCode: incomingTree.installation.siteCode,
              timezone: incomingTree.installation.timezone,
              treeSchemaVersion: 2,
              treeRevision: 1,
              recordVersionNumber: 0,
              customerName: incomingTree.installation.customerName ?? null,
              clientName: incomingTree.installation.clientName,
              maas: incomingTree.installation.maas ?? null,
              serviceType: incomingTree.installation.serviceType ?? null,
              meteringSolutionType: incomingTree.installation.meteringSolutionType ?? null,
              plannedMeterType: incomingTree.installation.plannedMeterType ?? null,
              customJobNumber: incomingTree.installation.customJobNumber ?? null,
              siteName: incomingTree.installation.siteName,
              siteAddress: incomingTree.installation.siteAddress,
              siteLocality: incomingTree.installation.siteLocality ?? null,
              siteState: incomingTree.installation.siteState ?? null,
              sitePostcode: incomingTree.installation.sitePostcode ?? null,
              siteCountryCode: incomingTree.installation.siteCountryCode ?? null,
              siteContactName: incomingTree.installation.siteContactName ?? null,
              siteContactPhone: incomingTree.installation.siteContactPhone ?? null,
              siteContactEmail: incomingTree.installation.siteContactEmail ?? null,
              fergusJobNumber: incomingTree.installation.fergusJobNumber ?? null,
              quoteNumber: incomingTree.installation.quoteNumber ?? null,
              jobComments: incomingTree.installation.jobComments ?? null,
              accessInformation: incomingTree.installation.accessInformation ?? null,
              warrantyDevice: incomingTree.installation.warrantyDevice ?? null,
              monitoringInstalled: incomingTree.installation.monitoringInstalled ?? null,
              hardwareInstalled: incomingTree.installation.hardwareInstalled ?? null,
              solarCapacityKw: incomingTree.installation.solarCapacityKw ?? null,
              additionalMonitoringRequired:
                incomingTree.installation.additionalMonitoringRequired ?? null,
              additionalMonitoringHardware:
                incomingTree.installation.additionalMonitoringHardware ?? null,
              ...installHubGeocodeInvalidation(undefined, incomingTree.installation),
              inspectorName: incomingTree.installation.inspectorName,
              auditDate: incomingTree.installation.auditDate,
              status: 'Draft',
              createdByUserId: request.user.userId,
              assignedInspectorUserId: null,
              createdAt: now,
            }).onConflictDoNothing().returning();
            if (!created) throw conflict('snapshot_conflict');
          }

          await replaceCanonicalInstallationChildren({
            executor: tx,
            tree: incomingTree,
            now,
            commissionedMeterIdentityChangeIds,
          });
          const persisted = await loadCanonicalInstallationTree(installationId, tx);
          if (!persisted) throw new Error('Canonical installation disappeared during transaction');
          let recordVersionNumber = persisted.installation.recordVersionNumber;
          if (installHubSyncCreatesRecordVersion(syncStage)) {
            recordVersionNumber = await ensureCanonicalRecordVersion({
              executor: tx,
              tree: persisted,
              userId: request.user.userId,
            });
          }
          if (replacementTransitions.length) {
            if (
              replacementFromVersionNumber === null
              || replacementFromVersionNumber < 1
              || recordVersionNumber < 1
            ) {
              throw new Error('comms_replacement_version_missing');
            }
            await tx.insert(ihMeterHistoryEvents).values(
              replacementTransitions.map((transition) => ({
                id: randomUUID(),
                installationId,
                meterId: transition.meterId,
                operation: 'REPLACEMENT',
                sourceFormSubmissionId: transition.formSubmissionId,
                fromRecordVersionNumber: replacementFromVersionNumber!,
                toRecordVersionNumber: recordVersionNumber,
                restoredFromRecordVersionNumber: null,
                reason: null,
                actorUserId: request.user.userId,
              })),
            );
          }
          return {
            treeRevision: persisted.installation.treeRevision,
            recordVersionNumber,
            readiness: installationReadiness(persisted),
          };
        });
      } catch (error) {
        if (error instanceof CanonicalInputError) {
          if (error.code === 'display_code_conflict') throw conflict(error.code);
          throw badRequest(`${error.code}: ${error.detail}`);
        }
        if (error instanceof CommsReplacementStateError) {
          const guidance = {
            comms_replacement_meter_missing:
              'Refresh the installation and reopen the replacement form before retrying.',
            comms_replacement_mapping_changed:
              'Save assignment or affected-asset mapping changes before completing the replacement. For an A6M-to-A3RM downgrade, clear or migrate channel 4–6 assignments first.',
            comms_replacement_state_mismatch:
              'Check the replacement model, Device ID / serial, sensor rating, and channel configuration before retrying.',
          }[error.code];
          throw badRequest(`${error.code}: ${guidance}`);
        }
        if (error instanceof Error && error.message.startsWith('COMPLETED_FORM_IMMUTABLE:')) {
          throw conflict(error.message);
        }
        if (error instanceof Error && error.message.startsWith('WW_METER_AMENDMENT_REQUIRED:')) {
          throw conflict(error.message);
        }
        if (error instanceof Error && error.message.startsWith('WW_METER_REMOVAL_VERSION_REQUIRED:')) {
          throw conflict(error.message);
        }
        if (error instanceof Error && error.message.startsWith('CANONICAL_EVIDENCE_UNRESOLVED:')) {
          throw badRequest(error.message);
        }
        throw error;
      }

      await reconcilePhotoCopyReferencesForParent({
        app: 'installhub',
        parentId: installationId,
        actor: request.user,
      });
      return reply.send({
        installationId,
        treeSchemaVersion: 2,
        treeRevision: transactionResult.treeRevision,
        recordVersionNumber: transactionResult.recordVersionNumber || null,
        versionNumber: transactionResult.recordVersionNumber || null,
        readiness: paginateReadiness(transactionResult.readiness),
        displayCodeReconciliations: [
          ...incomingTree.electricalAssets.map((item) => ({
            entityType: 'BOARD' as const,
            entityId: item.id,
            displayCode: item.displayCode,
          })),
          ...incomingTree.siteAssets.map((item) => ({
            entityType: 'SITE_ASSET' as const,
            entityId: item.id,
            displayCode: item.displayCode,
          })),
          ...incomingTree.meterDevices.map((item) => ({
            entityType: 'METER' as const,
            entityId: item.id,
            displayCode: item.displayName,
          })),
        ].sort((left, right) => (
          `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`)
        )),
        serverIds: {
          gridSupplyIds: Object.fromEntries(incomingTree.gridSupplies.map((item) => [item.id, item.id])),
          zoneIds: Object.fromEntries(incomingTree.zones.map((item) => [item.id, item.id])),
          electricalAssetIds: Object.fromEntries(incomingTree.electricalAssets.map((item) => [item.id, item.id])),
          siteAssetIds: Object.fromEntries(incomingTree.siteAssets.map((item) => [item.id, item.id])),
          meterDeviceIds: Object.fromEntries(incomingTree.meterDevices.map((item) => [item.id, item.id])),
          measurementAssignmentIds: Object.fromEntries(
            incomingTree.measurementAssignments.map((item) => [item.id, item.id]),
          ),
          formSubmissionIds: Object.fromEntries(incomingTree.formSubmissions.map((item) => [item.id, item.id])),
        },
      });
    }

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
      .where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      ));
    const expectedExistingInstallation = Boolean(existingInstallation);
    if (existingInstallation) {
      assertInstallationAccess(existingInstallation, request.user);
      if (existingInstallation.treeSchemaVersion >= 2) {
        throw conflict('upgrade_required');
      }
    }
    const installationValues = installationValuesFromPayload(
      body.installation,
      request.user,
      existingInstallation,
    );
    installationValues.treeSchemaVersion = 1;
    installationValues.treeRevision = (existingInstallation?.treeRevision ?? 0) + 1;
    assertLegacyInstallHubCompletionUsesCanonicalRoute(
      installationValues.status,
      existingInstallation?.status,
    );
    installationValues.status = installHubInstallationStatusForSync(
      existingInstallation?.status,
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

    let transactionState: { treeRevision: number; recordVersionNumber: number };
    try {
      transactionState = await db.transaction(async (tx) => {
      const [lockedInstallation] = await tx.select().from(ihInstallations).where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      )).for('update');
      if (!lockedInstallation && expectedExistingInstallation) {
        throw conflict('installation_purged');
      }
      if (lockedInstallation) {
        assertInstallationAccess(lockedInstallation, request.user);
        if (lockedInstallation.treeSchemaVersion >= 2) throw conflict('upgrade_required');
      }

      const persistedInstallationValues = lockedInstallation
        ? installationValuesFromPayload(body.installation!, request.user, lockedInstallation)
        : installationValues;
      persistedInstallationValues.treeSchemaVersion = 1;
      persistedInstallationValues.treeRevision = (lockedInstallation?.treeRevision ?? 0) + 1;
      assertLegacyInstallHubCompletionUsesCanonicalRoute(
        persistedInstallationValues.status,
        lockedInstallation?.status,
      );
      persistedInstallationValues.status = installHubInstallationStatusForSync(
        lockedInstallation?.status,
      );
      const { id: _installationId, ...installationUpdate } = persistedInstallationValues;
      if (lockedInstallation) {
        const [updated] = await tx.update(ihInstallations).set(installationUpdate).where(and(
          eq(ihInstallations.id, installationId),
          isNull(ihInstallations.deletedAt),
        )).returning({ id: ihInstallations.id });
        if (!updated) throw conflict('installation_purged');
      } else {
        const [created] = await tx.insert(ihInstallations)
          .values(persistedInstallationValues)
          .onConflictDoNothing()
          .returning({ id: ihInstallations.id });
        if (!created) throw conflict('snapshot_conflict');
      }
      serverIds.installationId = persistedInstallationValues.serverId;

      const retainedZoneCodes = new Set((await tx.select({ zoneCode: ihZones.zoneCode })
        .from(ihZones)
        .where(eq(ihZones.installationId, installationId)))
        .map((zone) => zone.zoneCode));
      for (const item of zones) {
        const id = requiredString(item, 'id');
        const [existing] = await tx.select().from(ihZones).where(eq(ihZones.id, id));
        if (existing && existing.installationId !== installationId) throw forbidden('Zone belongs to another installation');
        const allocatedZoneCode = existing
          ? existing.zoneCode
          : nextLegacyZoneCode(
              deriveZoneCode(requiredString(item, 'zoneName')),
              retainedZoneCodes,
            );
        retainedZoneCodes.add(allocatedZoneCode);
        const values = zoneValues(item, installationId, existing, allocatedZoneCode);
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
        return {
          treeRevision: persistedInstallationValues.treeRevision,
          recordVersionNumber: lockedInstallation?.recordVersionNumber ?? 0,
        };
      });
    } catch (error) {
      if (isCanonicalChildOwnershipDatabaseError(error)) {
        throw conflict('canonical_child_id_conflict');
      }
      throw error;
    }

    await reconcilePhotoCopyReferencesForParent({
      app: 'installhub',
      parentId: installationId,
      actor: request.user,
    });

    return reply.send({
      ...serverIds,
      treeSchemaVersion: 1,
      treeRevision: transactionState.treeRevision,
      recordVersionNumber: transactionState.recordVersionNumber,
      versionNumber: null,
    });
  });

  app.get('/pull', {
    schema: { tags: ['Field App Complete Sync'], security: [{ bearerAuth: [] }] },
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
    const trees = await Promise.all(installations.map(async (installation) => {
      if (installation.treeSchemaVersion >= 2) {
        if (!config.installhubCanonicalV2Enabled) {
          throw conflict('canonical_v2_feature_disabled');
        }
        const canonical = await loadCanonicalInstallationTree(installation.id);
        if (!canonical) throw new Error('Installation disappeared during pull');
        return projectLegacyInstallationTree(canonical);
      }
      return {
        treeSchemaVersion: 1,
        treeRevision: installation.treeRevision,
        recordVersionNumber: installation.recordVersionNumber,
        installation,
        gridSupplies: [],
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
        meterDevices: [],
        measurementAssignments: [],
        formSubmissions: await db.select().from(ihFormSubmissions).where(and(
          eq(ihFormSubmissions.installationId, installation.id),
          isNull(ihFormSubmissions.deletedAt),
        )),
      };
    }));
    return reply.send({ installations: trees, pulledAt: new Date().toISOString() });
  });
}
