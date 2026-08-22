import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendScheduleWarnings,
  buildSchedulerGoogleMapsUrl,
  optimizeOpenRoute,
  parseSchedulerCurrentLocation,
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

test('Google Maps URL preserves the optimized stop order without an API key', () => {
  const current = {
    latitude: -33.86,
    longitude: 151.2,
    accuracyMeters: 15,
    capturedAt: '2026-08-22T00:00:00.000Z',
  };
  const url = buildSchedulerGoogleMapsUrl(current, [
    { latitude: -33.87, longitude: 151.21 },
    { latitude: -33.88, longitude: 151.22 },
    { latitude: -33.89, longitude: 151.23 },
  ]);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://www.google.com');
  assert.equal(parsed.searchParams.get('origin'), '-33.86,151.2');
  assert.equal(parsed.searchParams.get('waypoints'), '-33.87,151.21|-33.88,151.22');
  assert.equal(parsed.searchParams.get('destination'), '-33.89,151.23');
  assert.equal(parsed.searchParams.has('key'), false);
});

test('Google Maps URL is null when no job can be routed', () => {
  assert.equal(buildSchedulerGoogleMapsUrl({
    latitude: -33.86,
    longitude: 151.2,
  }, []), null);
});

test('current location must be Australian and genuinely current when timestamped', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
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
