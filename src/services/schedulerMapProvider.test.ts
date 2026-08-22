import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSchedulerMapProviderUrl,
  parseSchedulerMapRequestTimeoutMs,
  parseSchedulerRouteMaxStops,
} from '../config.js';
import { AppError } from '../utils/errors.js';
import { createSchedulerMapProvider } from './schedulerMapProvider.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function isAppError(statusCode: number, detail: string) {
  return (error: unknown) => (
    error instanceof AppError
    && error.statusCode === statusCode
    && error.detail === detail
  );
}

test('map configuration is optional, URL-safe, and bounded', () => {
  assert.equal(normalizeSchedulerMapProviderUrl('TEST_MAP_URL', undefined), '');
  assert.equal(
    normalizeSchedulerMapProviderUrl('TEST_MAP_URL', ' https://maps.example.test/photon/ '),
    'https://maps.example.test/photon',
  );
  assert.throws(
    () => normalizeSchedulerMapProviderUrl('TEST_MAP_URL', 'file:///tmp/router'),
    /valid http\(s\) URL/,
  );
  assert.throws(
    () => normalizeSchedulerMapProviderUrl('TEST_MAP_URL', 'https://user:secret@example.test'),
    /must not include credentials/,
  );
  assert.equal(parseSchedulerMapRequestTimeoutMs(undefined), 5_000);
  assert.equal(parseSchedulerMapRequestTimeoutMs('1'), 500);
  assert.equal(parseSchedulerMapRequestTimeoutMs('999999'), 20_000);
  assert.equal(parseSchedulerRouteMaxStops(undefined), 4);
  assert.equal(parseSchedulerRouteMaxStops('0'), 1);
  assert.equal(parseSchedulerRouteMaxStops('99'), 4);
});

test('unconfigured providers are explicitly unavailable without network access', async () => {
  const provider = createSchedulerMapProvider({
    fetchImpl: async () => {
      throw new Error('network must not be called');
    },
  });
  assert.deepEqual(await provider.suggestSchedulerAddresses({ query: 'Sydney' }), {
    available: false,
    provider: null,
    attribution: null,
    suggestions: [],
  });
  assert.equal(await provider.geocodeSchedulerAddress('1 George Street, Sydney'), null);
  assert.deepEqual(await provider.getSchedulerTravelMatrix([
    { latitude: -33.8688, longitude: 151.2093 },
  ]), {
    available: false,
    distancesMeters: null,
    durationsSeconds: null,
  });
});

test('Photon suggestions are Australia-filtered and normalized to the shared DTO', async () => {
  let requestedUrl = '';
  const provider = createSchedulerMapProvider({
    photonUrl: 'https://maps.example.test/photon',
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [151.2093, -33.8688] },
            properties: {
              osm_type: 'W',
              osm_id: 123,
              name: 'Sustainability Wise',
              housenumber: '10',
              street: 'George Street',
              city: 'Sydney',
              state: 'New South Wales',
              postcode: '2000',
              countrycode: 'AU',
            },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [151.2093, -33.8688] },
            properties: {
              osm_type: 'W',
              osm_id: 123,
              name: 'Duplicate',
              city: 'Sydney',
              state: 'NSW',
              postcode: '2000',
              countrycode: 'AU',
            },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-0.1276, 51.5072] },
            properties: {
              osm_type: 'N',
              osm_id: 999,
              name: 'London',
              postcode: '2000',
              countrycode: 'GB',
            },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [167.95, -29.03] },
            properties: {
              osm_type: 'N',
              osm_id: 1000,
              name: 'Outside configured operating bounds',
              postcode: '2899',
              countrycode: 'AU',
            },
          },
        ],
      });
    },
  });

  const result = await provider.suggestSchedulerAddresses({
    query: '10 George Street',
    postcode: '2000',
    limit: 20,
  });
  assert.equal(result.available, true);
  assert.equal(result.provider, 'photon');
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.suggestions[0], {
    id: 'photon:W:123',
    label: '10 George Street, Sustainability Wise, Sydney, NSW, 2000, Australia',
    freeform: '10 George Street',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    countryCode: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'photon',
    placeId: 'W:123',
  });

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/photon/api');
  assert.equal(url.searchParams.get('q'), '10 George Street 2000');
  assert.equal(url.searchParams.get('countrycode'), 'AU');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('geometry'), null);
  assert.equal(url.searchParams.get('limit'), '10');
});

test('postcode-only address lookup uses Photon structured search with AU filtering', async () => {
  let requestedUrl = '';
  const provider = createSchedulerMapProvider({
    photonUrl: 'https://maps.example.test/photon',
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [151.21, -33.87] },
          properties: {
            osm_type: 'N',
            osm_id: 321,
            name: 'Unknown state record',
            city: 'Sydney',
            state: 'Unrecognized state name',
            postcode: '2000',
            countrycode: 'AU',
          },
        }],
      });
    },
  });
  const result = await provider.suggestSchedulerAddresses({ query: '', postcode: '2000' });
  assert.equal(result.available, true);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.state, null);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/photon/structured');
  assert.equal(url.searchParams.get('postcode'), '2000');
  assert.equal(url.searchParams.get('countrycode'), 'AU');
  assert.equal(url.searchParams.has('q'), false);
  assert.equal(url.searchParams.has('geometry'), false);
});

test('Photon no-match geocoding returns null and configured failures stay controlled', async () => {
  const noMatch = createSchedulerMapProvider({
    photonUrl: 'https://maps.example.test',
    fetchImpl: async () => jsonResponse({ type: 'FeatureCollection', features: [] }),
  });
  assert.equal(await noMatch.geocodeSchedulerAddress('Unknown site'), null);

  const failed = createSchedulerMapProvider({
    photonUrl: 'https://maps.example.test',
    fetchImpl: async () => new Response('private upstream detail', { status: 429 }),
  });
  await assert.rejects(
    failed.suggestSchedulerAddresses({ query: 'Sydney' }),
    isAppError(503, 'scheduler_geocoder_unavailable'),
  );

  const oversized = createSchedulerMapProvider({
    photonUrl: 'https://maps.example.test',
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(600 * 1024) },
    }),
  });
  await assert.rejects(
    oversized.suggestSchedulerAddresses({ query: 'Sydney' }),
    isAppError(503, 'scheduler_geocoder_unavailable'),
  );
});

test('OSRM table requests use longitude-first coordinates and normalize unreachable cells', async () => {
  let requestedUrl = '';
  const provider = createSchedulerMapProvider({
    osrmUrl: 'http://osrm.internal:5000/osrm/',
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        code: 'Ok',
        durations: [[0, 120], [null, 0]],
        distances: [[0, 1500], [null, 0]],
      });
    },
  });
  const result = await provider.getSchedulerTravelMatrix([
    { latitude: -33.8688, longitude: 151.2093 },
    { latitude: -37.8136, longitude: 144.9631 },
  ]);
  assert.equal(result.available, true);
  assert.deepEqual(result.durationsSeconds, [[0, 120], [Number.POSITIVE_INFINITY, 0]]);
  assert.deepEqual(result.distancesMeters, [[0, 1500], [Number.POSITIVE_INFINITY, 0]]);

  const url = new URL(requestedUrl);
  assert.equal(
    decodeURIComponent(url.pathname),
    '/osrm/table/v1/driving/151.2093,-33.8688;144.9631,-37.8136',
  );
  assert.equal(url.searchParams.get('annotations'), 'duration,distance');
  assert.equal(url.searchParams.get('generate_hints'), 'false');
});

test('OSRM enforces stop bounds and rejects malformed configured-provider responses', async () => {
  const bounded = createSchedulerMapProvider({
    osrmUrl: 'http://osrm.internal:5000',
    maxStops: 1,
    fetchImpl: async () => {
      throw new Error('must reject before calling provider');
    },
  });
  await assert.rejects(
    bounded.getSchedulerTravelMatrix([
      { latitude: -33.86, longitude: 151.2 },
      { latitude: -33.87, longitude: 151.21 },
      { latitude: -33.88, longitude: 151.22 },
    ]),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );

  const malformed = createSchedulerMapProvider({
    osrmUrl: 'http://osrm.internal:5000',
    fetchImpl: async () => jsonResponse({
      code: 'Ok',
      durations: [[0, 1], [1]],
      distances: [[0, 10], [10, 0]],
    }),
  });
  await assert.rejects(
    malformed.getSchedulerTravelMatrix([
      { latitude: -33.86, longitude: 151.2 },
      { latitude: -33.87, longitude: 151.21 },
    ]),
    isAppError(503, 'scheduler_router_unavailable'),
  );
});
