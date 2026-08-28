import { eq } from 'drizzle-orm';
import { businessSites } from '../db/schema/shared.js';
import {
  upsertClientSiteFromProductRecord,
  type ClientSiteGeocodingStatus,
  type ClientSiteMemoryExecutor,
  type ProductJobMemoryInput,
  type UpsertClientSiteResult,
} from '../services/clientSiteMemoryService.js';
import {
  schedulerAddressFingerprint,
  type AddressSource,
} from '../services/schedulerAddressService.js';
import { badRequest } from '../utils/errors.js';

type JsonInput = Record<string, unknown>;

export type ProductClientSiteSnapshot = {
  clientName?: string | null;
  businessSiteId?: string | null;
  siteName: string;
  displayAddress?: string | null;
  locality?: string | null;
  state?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocodingStatus?: string | null;
  provider?: string | null;
  placeId?: string | null;
  source?: string | null;
  fingerprint?: string | null;
  geocodedAt?: Date | null;
};

export type ProductClientSiteColumns = {
  clientName: string;
  businessSiteId: string;
  siteName: string;
  displayAddress: string;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  geocodingStatus: ClientSiteGeocodingStatus;
  provider: string | null;
  placeId: string | null;
  source: AddressSource;
  fingerprint: string;
  geocodedAt: Date | null;
};

export type PreparedProductClientSite = {
  clientName: string;
  selectedClientId: string | null;
  selectedSiteId: string | null;
  siteName: string;
  address: {
    displayAddress: string;
    locality: string | null;
    state: string | null;
    postcode: string | null;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    provider: string | null;
    placeId: string | null;
    source: AddressSource;
    geocodingStatus: ClientSiteGeocodingStatus;
  };
};

type ReadValue<T> = { present: boolean; value: T | null };

function nestedAddress(payload: JsonInput): JsonInput {
  const value = payload.address;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonInput
    : {};
}

function rawWireValue(
  payload: JsonInput,
  flatKeys: string[],
  nestedKey?: string,
): { present: boolean; value: unknown; field: string } {
  for (const key of flatKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return { present: true, value: payload[key], field: key };
    }
  }
  if (nestedKey) {
    const address = nestedAddress(payload);
    if (Object.prototype.hasOwnProperty.call(address, nestedKey)) {
      return { present: true, value: address[nestedKey], field: `address.${nestedKey}` };
    }
  }
  return { present: false, value: undefined, field: flatKeys[0] ?? nestedKey ?? 'value' };
}

function readText(
  payload: JsonInput,
  flatKeys: string[],
  nestedKey?: string,
): ReadValue<string> {
  const wire = rawWireValue(payload, flatKeys, nestedKey);
  if (!wire.present) return { present: false, value: null };
  if (wire.value === undefined || wire.value === null || wire.value === '') {
    return { present: true, value: null };
  }
  if (typeof wire.value !== 'string') throw badRequest(`${wire.field} must be a string`);
  const value = wire.value.trim();
  return { present: true, value: value || null };
}

function readNumber(
  payload: JsonInput,
  flatKeys: string[],
  nestedKey?: string,
): ReadValue<number> {
  const wire = rawWireValue(payload, flatKeys, nestedKey);
  if (!wire.present) return { present: false, value: null };
  if (wire.value === undefined || wire.value === null || wire.value === '') {
    return { present: true, value: null };
  }
  const value = typeof wire.value === 'number' ? wire.value : Number(wire.value);
  if (!Number.isFinite(value)) throw badRequest(`${wire.field} must be a finite number`);
  return { present: true, value };
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function addressFingerprint(input: {
  displayAddress: string;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: string | null;
}): string {
  return schedulerAddressFingerprint({
    displayAddress: input.displayAddress,
    locality: input.locality,
    state: input.state,
    postcode: input.postcode,
    countryCode: input.countryCode ?? 'AU',
  });
}

function derivedGeocodingStatus(input: {
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  placeId: string | null;
}): ClientSiteGeocodingStatus {
  if (input.latitude === null || input.longitude === null) return 'unresolved';
  return input.provider && input.placeId ? 'resolved' : 'manual';
}

function derivedAddressSource(input: {
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  placeId: string | null;
}): AddressSource {
  return input.latitude !== null && input.longitude !== null && input.provider && input.placeId
    ? 'suggested'
    : 'manual';
}

/**
 * Accepts the additive address/client fields used by current clients while
 * retaining the former site-name/address-only payload as a valid manual site.
 */
export function prepareProductClientSite(
  payload: JsonInput,
  current: ProductClientSiteSnapshot,
): PreparedProductClientSite {
  const clientNameWire = readText(payload, ['clientName']);
  const selectedClientWire = readText(payload, ['clientId']);
  const selectedSiteWire = readText(payload, ['clientSiteId']);
  const displayWire = readText(
    payload,
    ['siteAddress', 'location', 'displayAddress'],
    'displayAddress',
  );
  const localityWire = readText(payload, ['siteLocality'], 'locality');
  const stateWire = readText(payload, ['siteState'], 'state');
  const postcodeWire = readText(payload, ['sitePostcode'], 'postcode');
  const countryWire = readText(payload, ['siteCountryCode'], 'countryCode');
  const latitudeWire = readNumber(payload, ['siteLatitude'], 'latitude');
  const longitudeWire = readNumber(payload, ['siteLongitude'], 'longitude');
  const providerWire = readText(payload, ['siteGeocodeProvider'], 'provider');
  const placeIdWire = readText(payload, ['siteGeocodePlaceId'], 'placeId');
  const sourceWire = readText(payload, ['siteAddressSource', 'addressSource'], 'source');
  const statusWire = readText(
    payload,
    ['siteGeocodeStatus', 'geocodingStatus'],
    'geocodingStatus',
  );

  const siteName = current.siteName.trim();
  const clientName = clientNameWire.value
    ?? current.clientName?.trim()
    ?? siteName;
  const displayAddress = displayWire.value
    ?? (current.displayAddress?.trim() || 'Address unavailable');
  const locality = localityWire.present ? localityWire.value : current.locality ?? null;
  const state = stateWire.present ? stateWire.value : current.state ?? null;
  const postcode = postcodeWire.present ? postcodeWire.value : current.postcode ?? null;
  const countryCode = countryWire.present
    ? countryWire.value ?? 'AU'
    : current.countryCode ?? 'AU';

  const currentDisplayAddress = current.displayAddress?.trim() || 'Address unavailable';
  const currentFingerprint = current.fingerprint ?? addressFingerprint({
    displayAddress: currentDisplayAddress,
    locality: current.locality ?? null,
    state: current.state ?? null,
    postcode: current.postcode ?? null,
    countryCode: current.countryCode ?? 'AU',
  });
  const nextFingerprint = addressFingerprint({
    displayAddress,
    locality,
    state,
    postcode,
    countryCode,
  });
  const addressChanged = currentFingerprint !== nextFingerprint;
  const clientChanged = normalizedText(current.clientName ?? siteName) !== normalizedText(clientName);
  const preserveExistingEvidence = !addressChanged;

  const latitude = latitudeWire.present
    ? latitudeWire.value
    : preserveExistingEvidence ? current.latitude ?? null : null;
  const longitude = longitudeWire.present
    ? longitudeWire.value
    : preserveExistingEvidence ? current.longitude ?? null : null;
  const provider = providerWire.present
    ? providerWire.value
    : preserveExistingEvidence ? current.provider ?? null : null;
  const placeId = placeIdWire.present
    ? placeIdWire.value
    : preserveExistingEvidence ? current.placeId ?? null : null;

  let selectedSiteId = selectedSiteWire.value;
  if (
    !selectedSiteWire.present
    && !clientChanged
    && !addressChanged
    && current.source === 'client_saved'
    && current.businessSiteId
  ) {
    selectedSiteId = current.businessSiteId;
  }
  if (
    !selectedSiteId
    && sourceWire.value === 'client_saved'
    && current.businessSiteId
    && !clientChanged
    && !addressChanged
  ) {
    selectedSiteId = current.businessSiteId;
  }

  const evidence = { latitude, longitude, provider, placeId };
  const reusableCurrentSource = current.source === 'client_saved' && !selectedSiteId
    ? derivedAddressSource(evidence)
    : current.source as AddressSource | null | undefined;
  let source = selectedSiteId
    ? 'client_saved' as const
    : sourceWire.present
      ? sourceWire.value as AddressSource
      : preserveExistingEvidence && reusableCurrentSource
        ? reusableCurrentSource
        : derivedAddressSource(evidence);
  let geocodingStatus = statusWire.present
    ? statusWire.value as ClientSiteGeocodingStatus
    : preserveExistingEvidence && current.geocodingStatus
      ? current.geocodingStatus as ClientSiteGeocodingStatus
      : derivedGeocodingStatus(evidence);

  // Some legacy product rows were marked resolved without provider evidence.
  // Preserve their coordinates, but make the new directory write internally valid.
  if (!statusWire.present && geocodingStatus === 'resolved' && (!provider || !placeId)) {
    geocodingStatus = derivedGeocodingStatus(evidence);
  }
  if (!sourceWire.present && source === 'suggested' && geocodingStatus !== 'resolved') {
    source = selectedSiteId ? 'client_saved' : derivedAddressSource(evidence);
  }

  return {
    clientName,
    selectedClientId: selectedClientWire.value,
    selectedSiteId,
    siteName,
    address: {
      displayAddress,
      locality,
      state,
      postcode,
      countryCode,
      latitude,
      longitude,
      provider,
      placeId,
      source,
      geocodingStatus,
    },
  };
}

export async function rememberProductClientSite(
  executor: ClientSiteMemoryExecutor,
  input: {
    payload: JsonInput;
    current: ProductClientSiteSnapshot;
    job?: ProductJobMemoryInput;
  },
): Promise<{
  memory: UpsertClientSiteResult;
  columns: ProductClientSiteColumns;
}> {
  const prepared = prepareProductClientSite(input.payload, input.current);
  let selectedClientId = prepared.selectedClientId;
  if (!selectedClientId && prepared.selectedSiteId) {
    const [selectedSite] = await executor.select({ clientId: businessSites.clientId })
      .from(businessSites)
      .where(eq(businessSites.id, prepared.selectedSiteId))
      .limit(1);
    selectedClientId = selectedSite?.clientId ?? null;
  }
  const memory = await upsertClientSiteFromProductRecord(executor, {
    clientName: prepared.clientName,
    selectedClientId,
    selectedSiteId: prepared.selectedSiteId,
    siteName: prepared.siteName,
    address: prepared.address,
    job: input.job,
  });
  const selectedSavedSite = prepared.address.source === 'client_saved';
  const displayAddress = selectedSavedSite
    ? memory.site.displayAddress
    : prepared.address.displayAddress;
  const siteName = selectedSavedSite ? memory.site.siteName : prepared.siteName;
  const source = selectedSavedSite ? 'client_saved' : prepared.address.source;
  const fingerprint = addressFingerprint({
    displayAddress,
    locality: memory.site.locality,
    state: memory.site.state,
    postcode: memory.site.postcode,
    countryCode: 'AU',
  });
  const geocoded = memory.site.geocodingStatus === 'resolved'
    || memory.site.geocodingStatus === 'manual';
  const geocodedAt = geocoded
    ? input.current.fingerprint === fingerprint && input.current.geocodedAt
      ? input.current.geocodedAt
      : new Date(memory.site.updatedAt)
    : null;

  return {
    memory,
    columns: {
      clientName: memory.client.name,
      businessSiteId: memory.site.id,
      siteName,
      displayAddress,
      locality: memory.site.locality,
      state: memory.site.state,
      postcode: memory.site.postcode,
      countryCode: 'AU',
      latitude: memory.site.latitude,
      longitude: memory.site.longitude,
      geocodingStatus: memory.site.geocodingStatus,
      provider: memory.site.provider,
      placeId: memory.site.placeId,
      source,
      fingerprint,
      geocodedAt,
    },
  };
}
