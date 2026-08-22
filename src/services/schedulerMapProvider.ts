import {
  config,
  normalizeSchedulerMapProviderUrl,
} from '../config.js';
import { AppError, badRequest } from '../utils/errors.js';
import {
  AUSTRALIAN_STATES,
  type AustralianState,
  isAustralianRoutingCoordinate,
} from './schedulerAddressService.js';

const PHOTON_ATTRIBUTION = '© OpenStreetMap contributors';
const PHOTON_MAX_RESPONSE_BYTES = 512 * 1024;
const OSRM_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ADDRESS_QUERY_LENGTH = 300;
const MAX_ADDRESS_SUGGESTIONS = 10;

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export type SchedulerMapPoint = {
  latitude: number;
  longitude: number;
};

export type SchedulerAddressSuggestion = {
  id: string;
  label: string;
  freeform: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number;
  longitude: number;
  provider: string;
  placeId: string | null;
};

export type SchedulerAddressSuggestionsResult = {
  available: boolean;
  provider: 'photon' | null;
  attribution: string | null;
  suggestions: SchedulerAddressSuggestion[];
};

export type SchedulerTravelMatrixResult = {
  available: boolean;
  distancesMeters: number[][] | null;
  durationsSeconds: number[][] | null;
};

export type SchedulerMapProvider = {
  suggestSchedulerAddresses: (input: {
    query: string;
    postcode?: string;
    limit?: number;
  }) => Promise<SchedulerAddressSuggestionsResult>;
  geocodeSchedulerAddress: (freeform: string) => Promise<SchedulerAddressSuggestion | null>;
  getSchedulerTravelMatrix: (
    points: SchedulerMapPoint[],
  ) => Promise<SchedulerTravelMatrixResult>;
};

type SchedulerMapProviderOptions = {
  photonUrl?: string;
  osrmUrl?: string;
  requestTimeoutMs?: number;
  maxStops?: number;
  fetchImpl?: FetchLike;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeAustralianPostcode(value: unknown): string | null {
  const postcode = optionalString(value);
  return postcode && /^\d{4}$/u.test(postcode) ? postcode : null;
}

function normalizeAustralianState(value: unknown): AustralianState | null {
  const state = optionalString(value);
  if (!state) return null;
  const normalized = state.toLowerCase().replace(/[._-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const abbreviations: Record<string, AustralianState> = {
    act: 'ACT',
    'australian capital territory': 'ACT',
    nsw: 'NSW',
    'new south wales': 'NSW',
    nt: 'NT',
    'northern territory': 'NT',
    qld: 'QLD',
    queensland: 'QLD',
    sa: 'SA',
    'south australia': 'SA',
    tas: 'TAS',
    tasmania: 'TAS',
    vic: 'VIC',
    victoria: 'VIC',
    wa: 'WA',
    'western australia': 'WA',
  };
  const abbreviation = abbreviations[normalized]
    ?? state.toUpperCase();
  return AUSTRALIAN_STATES.includes(abbreviation as AustralianState)
    ? abbreviation as AustralianState
    : null;
}

function joinUniqueAddressParts(parts: Array<string | null>): string {
  const seen = new Set<string>();
  return parts.filter((part): part is string => {
    if (!part) return false;
    const key = part.toLocaleLowerCase('en-AU');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

function photonSuggestion(feature: unknown): SchedulerAddressSuggestion | null {
  if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) {
    return null;
  }
  const coordinates = feature.geometry.coordinates;
  if (
    feature.geometry.type !== 'Point'
    || !Array.isArray(coordinates)
    || coordinates.length < 2
  ) return null;

  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (
    typeof latitude !== 'number'
    || typeof longitude !== 'number'
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) return null;
  if (!isAustralianRoutingCoordinate({ latitude, longitude })) return null;

  const properties = feature.properties;
  if (optionalString(properties.countrycode)?.toUpperCase() !== 'AU') return null;

  const name = optionalString(properties.name);
  const street = optionalString(properties.street);
  const houseNumber = optionalString(properties.housenumber);
  const locality = optionalString(properties.locality)
    ?? optionalString(properties.city)
    ?? optionalString(properties.district)
    ?? optionalString(properties.county);
  const state = normalizeAustralianState(properties.state);
  const postcode = normalizeAustralianPostcode(properties.postcode);
  const streetAddress = street
    ? [houseNumber, street].filter(Boolean).join(' ')
    : name;
  const label = joinUniqueAddressParts([
    streetAddress,
    name !== streetAddress ? name : null,
    locality,
    state,
    postcode,
    'Australia',
  ]);
  if (!label) return null;

  const osmType = optionalString(properties.osm_type)?.toUpperCase() ?? 'UNKNOWN';
  const osmIdValue = properties.osm_id;
  const osmId = typeof osmIdValue === 'string' || typeof osmIdValue === 'number'
    ? String(osmIdValue)
    : `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
  const placeId = `${osmType}:${osmId}`;

  return {
    id: `photon:${placeId}`,
    label,
    freeform: streetAddress ?? name ?? label,
    locality,
    state,
    postcode,
    countryCode: 'AU',
    latitude,
    longitude,
    provider: 'photon',
    placeId,
  };
}

function providerUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const prefix = url.pathname.replace(/\/+$/u, '');
  url.pathname = `${prefix}/${path.replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';
  return url;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('provider_response_too_large');
  }
  if (!response.body) throw new Error('provider_response_missing');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('provider_response_too_large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function unavailable(detail: string): AppError {
  return new AppError(503, 'Service unavailable', detail);
}

async function requestProviderJson(input: {
  fetchImpl: FetchLike;
  url: URL;
  timeoutMs: number;
  maxBytes: number;
  unavailableDetail: string;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  timeout.unref();
  try {
    const response = await input.fetchImpl(input.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw unavailable(input.unavailableDetail);
    return await readBoundedJson(response, input.maxBytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(input.unavailableDetail);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMatrix(value: unknown, size: number): number[][] | null {
  if (!Array.isArray(value) || value.length !== size) return null;
  const normalized: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== size) return null;
    const normalizedRow: number[] = [];
    for (const cell of row) {
      if (cell === null) {
        // OSRM uses null for an unreachable pair. Infinity preserves that fact
        // for the optimizer without widening the public number[][] contract.
        normalizedRow.push(Number.POSITIVE_INFINITY);
      } else if (typeof cell === 'number' && Number.isFinite(cell) && cell >= 0) {
        normalizedRow.push(cell);
      } else {
        return null;
      }
    }
    normalized.push(normalizedRow);
  }
  return normalized;
}

function validatePoint(point: SchedulerMapPoint): void {
  if (
    !Number.isFinite(point.latitude)
    || !Number.isFinite(point.longitude)
    || !isAustralianRoutingCoordinate(point)
  ) {
    throw badRequest('Route coordinates must be within Australia');
  }
}

export function createSchedulerMapProvider(
  options: SchedulerMapProviderOptions = {},
): SchedulerMapProvider {
  const photonUrl = normalizeSchedulerMapProviderUrl('photonUrl', options.photonUrl);
  const osrmUrl = normalizeSchedulerMapProviderUrl('osrmUrl', options.osrmUrl);
  const timeoutMs = Math.min(20_000, Math.max(500, options.requestTimeoutMs ?? 5_000));
  const maxStops = Math.min(4, Math.max(1, options.maxStops ?? 4));
  const fetchImpl = options.fetchImpl ?? fetch;

  async function suggestSchedulerAddresses(input: {
    query: string;
    postcode?: string;
    limit?: number;
  }): Promise<SchedulerAddressSuggestionsResult> {
    if (!photonUrl) {
      return {
        available: false,
        provider: null,
        attribution: null,
        suggestions: [],
      };
    }

    const query = compactWhitespace(input.query);
    if (query.length > MAX_ADDRESS_QUERY_LENGTH) {
      throw badRequest(`Address query must be at most ${MAX_ADDRESS_QUERY_LENGTH} characters`);
    }
    const postcodeInput = input.postcode === undefined
      ? null
      : compactWhitespace(input.postcode);
    if (postcodeInput && !/^\d{4}$/u.test(postcodeInput)) {
      throw badRequest('Postcode must be a four-digit Australian postcode');
    }
    if (!query && !postcodeInput) {
      return {
        available: true,
        provider: 'photon',
        attribution: PHOTON_ATTRIBUTION,
        suggestions: [],
      };
    }

    const requestedLimit = Number.isSafeInteger(input.limit) ? input.limit! : 8;
    const limit = Math.min(MAX_ADDRESS_SUGGESTIONS, Math.max(1, requestedLimit));
    const url = providerUrl(photonUrl, query ? '/api' : '/structured');
    if (query) {
      url.searchParams.set('q', [query, postcodeInput].filter(Boolean).join(' '));
    } else {
      url.searchParams.set('postcode', postcodeInput!);
    }
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('countrycode', 'AU');

    const payload = await requestProviderJson({
      fetchImpl,
      url,
      timeoutMs,
      maxBytes: PHOTON_MAX_RESPONSE_BYTES,
      unavailableDetail: 'scheduler_geocoder_unavailable',
    });
    if (!isRecord(payload) || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
      throw unavailable('scheduler_geocoder_unavailable');
    }

    const suggestions: SchedulerAddressSuggestion[] = [];
    const seen = new Set<string>();
    for (const feature of payload.features) {
      const suggestion = photonSuggestion(feature);
      if (
        !suggestion
        || (postcodeInput !== null && suggestion.postcode !== postcodeInput)
        || seen.has(suggestion.id)
      ) continue;
      seen.add(suggestion.id);
      suggestions.push(suggestion);
      if (suggestions.length >= limit) break;
    }
    return {
      available: true,
      provider: 'photon',
      attribution: PHOTON_ATTRIBUTION,
      suggestions,
    };
  }

  async function geocodeSchedulerAddress(
    freeform: string,
  ): Promise<SchedulerAddressSuggestion | null> {
    const query = compactWhitespace(freeform);
    if (!query || !photonUrl) return null;
    const result = await suggestSchedulerAddresses({ query, limit: 1 });
    return result.suggestions[0] ?? null;
  }

  async function getSchedulerTravelMatrix(
    points: SchedulerMapPoint[],
  ): Promise<SchedulerTravelMatrixResult> {
    if (!osrmUrl) {
      return {
        available: false,
        distancesMeters: null,
        durationsSeconds: null,
      };
    }
    if (points.length > maxStops + 1) {
      throw badRequest(`A route can contain at most ${maxStops} job stops`);
    }
    for (const point of points) validatePoint(point);
    if (points.length <= 1) {
      const matrix = points.length === 0 ? [] : [[0]];
      return {
        available: true,
        distancesMeters: matrix,
        durationsSeconds: matrix.map((row) => [...row]),
      };
    }

    const coordinates = points.map((point) => (
      `${Number(point.longitude.toFixed(6))},${Number(point.latitude.toFixed(6))}`
    )).join(';');
    const url = providerUrl(osrmUrl, `/table/v1/driving/${coordinates}`);
    url.searchParams.set('annotations', 'duration,distance');
    url.searchParams.set('generate_hints', 'false');
    const payload = await requestProviderJson({
      fetchImpl,
      url,
      timeoutMs,
      maxBytes: OSRM_MAX_RESPONSE_BYTES,
      unavailableDetail: 'scheduler_router_unavailable',
    });
    if (!isRecord(payload) || payload.code !== 'Ok') {
      throw unavailable('scheduler_router_unavailable');
    }
    const durationsSeconds = normalizeMatrix(payload.durations, points.length);
    const distancesMeters = normalizeMatrix(payload.distances, points.length);
    if (!durationsSeconds || !distancesMeters) {
      throw unavailable('scheduler_router_unavailable');
    }
    return { available: true, distancesMeters, durationsSeconds };
  }

  return {
    suggestSchedulerAddresses,
    geocodeSchedulerAddress,
    getSchedulerTravelMatrix,
  };
}

const configuredProvider = createSchedulerMapProvider({
  photonUrl: config.schedulerMaps.photonUrl,
  osrmUrl: config.schedulerMaps.osrmUrl,
  requestTimeoutMs: config.schedulerMaps.requestTimeoutMs,
  maxStops: config.schedulerMaps.maxStops,
});

export const suggestSchedulerAddresses = configuredProvider.suggestSchedulerAddresses;
export const geocodeSchedulerAddress = configuredProvider.geocodeSchedulerAddress;
export const getSchedulerTravelMatrix = configuredProvider.getSchedulerTravelMatrix;
