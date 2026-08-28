import { createHash } from 'node:crypto';
import { badRequest } from '../utils/errors.js';

export const AUSTRALIAN_STATES = [
  'ACT',
  'NSW',
  'NT',
  'QLD',
  'SA',
  'TAS',
  'VIC',
  'WA',
] as const;

export type AustralianState = (typeof AUSTRALIAN_STATES)[number];

export const ADDRESS_PROVIDERS = ['geoapify', 'photon'] as const;
export type AddressProvider = (typeof ADDRESS_PROVIDERS)[number];

/** Australia mainland and Tasmania bounds used by this Australia-only workflow. */
export const AUSTRALIAN_ROUTING_BOUNDS = {
  minimumLatitude: -44,
  maximumLatitude: -9,
  minimumLongitude: 112,
  maximumLongitude: 154,
} as const;

export function isAustralianRoutingCoordinate(input: {
  latitude: number;
  longitude: number;
}): boolean {
  return input.latitude >= AUSTRALIAN_ROUTING_BOUNDS.minimumLatitude
    && input.latitude <= AUSTRALIAN_ROUTING_BOUNDS.maximumLatitude
    && input.longitude >= AUSTRALIAN_ROUTING_BOUNDS.minimumLongitude
    && input.longitude <= AUSTRALIAN_ROUTING_BOUNDS.maximumLongitude;
}

export type SchedulerDispatchAddressInput = {
  freeform: string;
  locality?: string;
  state?: string;
  postcode?: string;
  countryCode: 'AU';
  latitude?: number;
  longitude?: number;
  provider?: AddressProvider;
  placeId?: string;
  source?: AddressSource;
};

export const ADDRESS_SOURCES = ['suggested', 'manual', 'client_saved'] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

export type SchedulerSiteLocationColumns = {
  siteLocality: string | null;
  siteState: AustralianState | null;
  sitePostcode: string | null;
  siteCountryCode: 'AU';
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteGeocodeStatus: 'unresolved' | 'resolved' | 'manual';
  siteGeocodeProvider: AddressProvider | null;
  siteGeocodePlaceId: string | null;
  siteAddressSource: AddressSource;
  siteAddressFingerprint: string;
  siteGeocodedAt: Date | null;
};

const ADDRESS_FIELDS = new Set([
  'freeform',
  'locality',
  'state',
  'postcode',
  'countryCode',
  'latitude',
  'longitude',
  'provider',
  'placeId',
  'source',
]);

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`job.address.${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw badRequest(`job.address.${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function optionalCoordinate(value: unknown, field: 'latitude' | 'longitude'): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`job.address.${field} must be a finite number`);
  }
  const [minimum, maximum] = field === 'latitude' ? [-90, 90] : [-180, 180];
  if (value < minimum || value > maximum) {
    throw badRequest(`job.address.${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

/** Normalize only for equality/fingerprinting; the original text remains authoritative. */
export function normalizeSchedulerAddressText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

export type AustralianAddressFingerprintParts = {
  displayAddress: string;
  locality?: string | null;
  state?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
};

/** Includes structured locality data so repeated street names cannot collide. */
export function schedulerAddressFingerprint(
  value: string | AustralianAddressFingerprintParts,
): string {
  const parts = typeof value === 'string'
    ? { displayAddress: value }
    : value;
  const normalized = [
    parts.displayAddress,
    parts.locality ?? '',
    parts.state ?? '',
    parts.postcode ?? '',
    parts.countryCode ?? 'AU',
  ].map(normalizeSchedulerAddressText).join('\u001f');
  // PostgreSQL's built-in md5(text) makes legacy backfills deterministic
  // without requiring a privileged database extension. Two domain-separated
  // hashes retain the existing 64-hex wire/storage contract.
  return createHash('md5').update(normalized, 'utf8').digest('hex')
    + createHash('md5').update(`${normalized}\u001e2`, 'utf8').digest('hex');
}

export function parseSchedulerDispatchAddress(
  value: unknown,
  authoritativeFreeform: string,
  now = new Date(),
): SchedulerSiteLocationColumns {
  if (value === undefined || value === null) {
    return {
      siteLocality: null,
      siteState: null,
      sitePostcode: null,
      siteCountryCode: 'AU',
      siteLatitude: null,
      siteLongitude: null,
      siteGeocodeStatus: 'unresolved',
      siteGeocodeProvider: null,
      siteGeocodePlaceId: null,
      siteAddressSource: 'manual',
      siteAddressFingerprint: schedulerAddressFingerprint(authoritativeFreeform),
      siteGeocodedAt: null,
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('job.address must be an object');
  }
  const input = value as Record<string, unknown>;
  const unsupported = Object.keys(input).find((field) => !ADDRESS_FIELDS.has(field));
  if (unsupported) throw badRequest(`job.address.${unsupported} is not accepted`);

  if (typeof input.freeform !== 'string' || !input.freeform.trim()) {
    throw badRequest('job.address.freeform is required');
  }
  if (input.freeform.trim().length > 1_000) {
    throw badRequest('job.address.freeform must be 1000 characters or fewer');
  }
  if (input.countryCode !== 'AU') {
    throw badRequest('job.address.countryCode must be AU');
  }

  const locality = optionalText(input.locality, 'locality', 200);
  const stateValue = optionalText(input.state, 'state', 3)?.toUpperCase() ?? null;
  if (stateValue !== null && !AUSTRALIAN_STATES.includes(stateValue as AustralianState)) {
    throw badRequest('job.address.state must be an Australian state or territory abbreviation');
  }
  const postcode = optionalText(input.postcode, 'postcode', 4);
  if (postcode !== null && !/^\d{4}$/.test(postcode)) {
    throw badRequest('job.address.postcode must contain four digits');
  }
  const latitude = optionalCoordinate(input.latitude, 'latitude');
  const longitude = optionalCoordinate(input.longitude, 'longitude');
  if ((latitude === null) !== (longitude === null)) {
    throw badRequest('job.address.latitude and longitude must be supplied together');
  }
  if (latitude !== null && longitude !== null && !isAustralianRoutingCoordinate({
    latitude,
    longitude,
  })) {
    throw badRequest('job.address coordinates must be within Australia');
  }
  const providerValue = optionalText(input.provider, 'provider', 100);
  if (
    providerValue !== null
    && !ADDRESS_PROVIDERS.includes(providerValue as AddressProvider)
  ) {
    throw badRequest('job.address.provider must be geoapify or photon');
  }
  const provider = providerValue as AddressProvider | null;
  const placeId = optionalText(input.placeId, 'placeId', 500);
  const sourceValue = optionalText(input.source, 'source', 20);
  if (sourceValue !== null && !ADDRESS_SOURCES.includes(sourceValue as AddressSource)) {
    throw badRequest('job.address.source must be suggested, manual, or client_saved');
  }
  const source = (sourceValue as AddressSource | null) ?? (provider ? 'suggested' : 'manual');
  if (placeId && !provider) throw badRequest('job.address.placeId requires provider');
  if ((provider || placeId) && latitude === null) {
    throw badRequest('job.address provider details require latitude and longitude');
  }
  if (source === 'suggested' && (!provider || !placeId || latitude === null)) {
    throw badRequest(
      'job.address suggested source requires coordinates, provider, and placeId',
    );
  }

  return {
    siteLocality: locality,
    siteState: stateValue as AustralianState | null,
    sitePostcode: postcode,
    siteCountryCode: 'AU',
    siteLatitude: latitude,
    siteLongitude: longitude,
    siteGeocodeStatus: latitude === null ? 'unresolved' : provider ? 'resolved' : 'manual',
    siteGeocodeProvider: provider,
    siteGeocodePlaceId: placeId,
    siteAddressSource: source,
    siteAddressFingerprint: schedulerAddressFingerprint({
      displayAddress: authoritativeFreeform,
      locality,
      state: stateValue,
      postcode,
      countryCode: 'AU',
    }),
    siteGeocodedAt: latitude === null ? null : now,
  };
}

export function storedSchedulerCoordinatesAreCurrent(input: {
  freeform: string;
  locality?: string | null;
  state?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  latitude: number | null;
  longitude: number | null;
  addressFingerprint: string | null;
}): input is typeof input & { latitude: number; longitude: number } {
  return input.latitude !== null
    && input.longitude !== null
    && input.addressFingerprint === schedulerAddressFingerprint({
      displayAddress: input.freeform,
      locality: input.locality,
      state: input.state,
      postcode: input.postcode,
      countryCode: input.countryCode,
    });
}
