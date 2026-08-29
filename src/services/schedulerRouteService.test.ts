import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendScheduleWarnings,
  optimizeOpenRoute,
  parseSchedulerCurrentLocation,
  parseSchedulerRouteOriginInput,
  resolveSchedulerRouteOrigin,
  straightLineMatrix,
} from './schedulerRouteService.js';
import { AppError } from '../utils/errors.js';

function matrix(values: number[][]) {
  return { durations: values, distances: values.map((row) => [...row]) };
}

test('exact optimizer finds the shortest deterministic open route from current location', () => {
  // Matrix index zero is the current location; jobs are indices one through three.
  const optimized = optimizeOpenRoute(matrix([
    [0, 9, 2, 8],
    [9, 0, 7, 1],
    [2, 7, 0, 2],
    [8, 1, 2, 0],
  ]), 3);

  assert.deepEqual(optimized.order, [1, 2, 0]);
  assert.deepEqual(optimized.unrouted, []);
  assert.deepEqual(optimized.legDurations, [2, 2, 1]);
  assert.equal(optimized.totalDuration, 5);
});

test('exact optimizer returns the largest drivable subset and identifies disconnected jobs', () => {
  const unreachable = Number.POSITIVE_INFINITY;
  const optimized = optimizeOpenRoute(matrix([
    [0, 3, unreachable, 1],
    [3, 0, unreachable, 2],
    [unreachable, unreachable, 0, unreachable],
    [1, 2, unreachable, 0],
  ]), 3);

  assert.deepEqual(optimized.order, [2, 0]);
  assert.deepEqual(optimized.unrouted, [1]);
  assert.equal(optimized.totalDuration, 3);
});

test('straight-line fallback is finite, symmetric, and deterministic', () => {
  const fallback = straightLineMatrix([
    { latitude: -33.8688, longitude: 151.2093 },
    { latitude: -33.8731, longitude: 151.2065 },
    { latitude: -33.8568, longitude: 151.2153 },
  ]);
  assert.equal(fallback.distances[0]![0], 0);
  assert.equal(fallback.distances[0]![1], fallback.distances[1]![0]);
  assert.ok(fallback.distances[0]![2]! > 0);
  assert.ok(fallback.durations[0]![2]! > 0);
  assert.deepEqual(
    optimizeOpenRoute(fallback, 2),
    optimizeOpenRoute(fallback, 2),
  );
});

test('exact optimizer supports a full route beyond the former four-job map limit', () => {
  const pointCount = 7;
  const optimized = optimizeOpenRoute(matrix(Array.from(
    { length: pointCount },
    (_, from) => Array.from(
      { length: pointCount },
      (_, to) => from === to ? 0 : 1,
    ),
  )), pointCount - 1);

  assert.deepEqual(optimized.order, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(optimized.unrouted, []);
  assert.equal(optimized.totalDuration, 6);
});

test('route origins accept selected Australian coordinates and require fresh live timestamps', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  assert.deepEqual(parseSchedulerCurrentLocation({
    latitude: -37.8136,
    longitude: 144.9631,
  }, now), {
    latitude: -37.8136,
    longitude: 144.9631,
  });
  assert.deepEqual(parseSchedulerCurrentLocation({
    latitude: -33.8688,
    longitude: 151.2093,
    accuracyMeters: 12,
    capturedAt: '2026-08-22T11:45:00.000Z',
  }, now), {
    latitude: -33.8688,
    longitude: 151.2093,
    accuracyMeters: 12,
    capturedAt: '2026-08-22T11:45:00.000Z',
  });

  for (const location of [
    { latitude: 51.5072, longitude: -0.1276 },
    {
      latitude: -33.8688,
      longitude: 151.2093,
      capturedAt: '2026-08-22T11:29:59.000Z',
    },
    {
      latitude: -33.8688,
      longitude: 151.2093,
      capturedAt: '2026-08-22T12:02:01.000Z',
    },
  ]) {
    assert.throws(
      () => parseSchedulerCurrentLocation(location, now),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }
});

test('route origin input keeps current location and free-form starting address mutually exclusive', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  assert.deepEqual(parseSchedulerRouteOriginInput({
    startingAddress: '  Flinders Street Station, Melbourne VIC 3000  ',
  }, now), {
    kind: 'starting_address',
    startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
  });
  assert.deepEqual(parseSchedulerRouteOriginInput({
    currentLocation: {
      latitude: -37.8136,
      longitude: 144.9631,
      capturedAt: '2026-08-22T11:59:00.000Z',
    },
  }, now), {
    kind: 'current_location',
    currentLocation: {
      latitude: -37.8136,
      longitude: 144.9631,
      capturedAt: '2026-08-22T11:59:00.000Z',
    },
  });
  for (const input of [
    {},
    {
      currentLocation: { latitude: -37.8136, longitude: 144.9631 },
      startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
    },
    { startingAddress: '  ' },
  ]) {
    assert.throws(
      () => parseSchedulerRouteOriginInput(input, now),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }
});

test('free-form route origin is geocoded server-side and returned without a live timestamp', async () => {
  let receivedAddress = '';
  const currentLocation = await resolveSchedulerRouteOrigin({
    startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
  }, {
    geocodingAvailable: true,
    geocode: async (address) => {
      receivedAddress = address;
      return { latitude: -37.8183, longitude: 144.9671 };
    },
  });
  assert.equal(receivedAddress, 'Flinders Street Station, Melbourne VIC 3000');
  assert.deepEqual(currentLocation, { latitude: -37.8183, longitude: 144.9671 });

  await assert.rejects(
    resolveSchedulerRouteOrigin({ startingAddress: 'Unknown Australian address' }, {
      geocodingAvailable: true,
      geocode: async () => null,
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  await assert.rejects(
    resolveSchedulerRouteOrigin({ startingAddress: 'Flinders Street Station, Melbourne VIC 3000' }, {
      geocodingAvailable: false,
    }),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 503
      && error.detail === 'scheduler_geocoder_unavailable',
  );
});

test('schedule warnings identify actionable titled stops without exposing event IDs', () => {
  const warnings: string[] = [];
  appendScheduleWarnings([
    {
      sequence: 1,
      eventId: '11111111-1111-4111-8111-111111111111',
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: 'eco-job',
      title: 'George Street audit',
      address: '1 George Street, Sydney NSW 2000, Australia',
      scheduledStartAt: '2026-08-22T10:00:00.000Z',
      scheduledEndAt: '2026-08-22T11:00:00.000Z',
      travelDistanceMeters: 2_000,
      travelDurationSeconds: 1_800,
    },
    {
      sequence: 2,
      eventId: '22222222-2222-4222-8222-222222222222',
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: 'field-job',
      title: 'Pitt Street install',
      address: '2 Pitt Street, Sydney NSW 2000, Australia',
      scheduledStartAt: '2026-08-22T11:15:00.000Z',
      scheduledEndAt: '2026-08-22T12:15:00.000Z',
      travelDistanceMeters: 3_000,
      travelDurationSeconds: 1_800,
    },
  ], {
    latitude: -33.8688,
    longitude: 151.2093,
    capturedAt: '2026-08-22T09:45:00.000Z',
  }, warnings);

  assert.deepEqual(warnings, [
    'Travel from stop 1 (George Street audit) may make stop 2 (Pitt Street install) late.',
    'The current location may not allow arrival at stop 1 (George Street audit) on time.',
  ]);
  assert.equal(warnings.some((warning) => warning.includes('11111111')), false);
  assert.equal(warnings.some((warning) => warning.includes('22222222')), false);
});
