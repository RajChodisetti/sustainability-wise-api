import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihInstallations } from '../db/schema/installhub.js';
import { globalUsers, portalScheduleEvents } from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import {
  addCalendarDays,
  isValidAnalyticsTimeZone,
  startOfCalendarDateInTimeZone,
} from './schedulerAnalyticsService.js';
import {
  isAustralianRoutingCoordinate,
  storedSchedulerCoordinatesAreCurrent,
} from './schedulerAddressService.js';
import {
  geocodeSchedulerAddress,
  getSchedulerTravelMatrix,
} from './schedulerMapProvider.js';
import {
  assertPortalSchedulerApp,
  isSchedulerAdmin,
  resolveCallerFieldUserId,
  type ScheduleSourceApp,
  type ScheduleSourceType,
} from './scheduleService.js';

const ROUTABLE_SOURCE_APPS = ['ecoaudit', 'solarsense', 'installhub'] as const;
const DEFAULT_STRAIGHT_LINE_SPEED_METRES_PER_SECOND = 50_000 / 3_600;
const DEFAULT_UNSCHEDULED_JOB_DURATION_MS = 60 * 60 * 1_000;

export type SchedulerRouteCurrentLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt?: string;
};

export type SchedulerRouteJob = {
  sequence: number;
  eventId: string;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId: string;
  title: string;
  address: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  travelDistanceMeters: number;
  travelDurationSeconds: number;
};

export type SchedulerUnroutableJob = {
  eventId: string;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId: string | null;
  title: string;
  address: string | null;
  reason: string;
};

export type SchedulerRouteSuggestion = {
  date: string;
  timezone: string;
  assigneeFieldUserId: string;
  currentLocation: SchedulerRouteCurrentLocation;
  jobs: SchedulerRouteJob[];
  unroutableJobs: SchedulerUnroutableJob[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  optimization: 'road_duration' | 'straight_line_distance';
  googleMapsUrl: string | null;
  warnings: string[];
};

export type SchedulerRouteSuggestionInput = {
  date: unknown;
  currentLocation: unknown;
  assigneeFieldUserId?: unknown;
};

type EventRow = typeof portalScheduleEvents.$inferSelect;

type StoredDestination = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  addressFingerprint: string | null;
};

type RoutableEvent = {
  event: EventRow;
  address: string;
  latitude: number;
  longitude: number;
};

type Matrix = {
  distances: number[][];
  durations: number[][];
};

export type OpenRouteOptimization = {
  order: number[];
  unrouted: number[];
  legDistances: number[];
  legDurations: number[];
  totalDistance: number;
  totalDuration: number;
};

function requireCalendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest('date must be a valid YYYY-MM-DD calendar date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest('date must be a valid YYYY-MM-DD calendar date');
  }
  return value;
}

function requireCoordinate(
  value: unknown,
  field: 'latitude' | 'longitude',
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`currentLocation.${field} must be a finite number`);
  }
  const [minimum, maximum] = field === 'latitude' ? [-90, 90] : [-180, 180];
  if (value < minimum || value > maximum) {
    throw badRequest(`currentLocation.${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseSchedulerCurrentLocation(
  value: unknown,
  now = new Date(),
): SchedulerRouteCurrentLocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('currentLocation is required');
  }
  const input = value as Record<string, unknown>;
  const unsupported = Object.keys(input).find((field) => ![
    'latitude',
    'longitude',
    'accuracyMeters',
    'capturedAt',
  ].includes(field));
  if (unsupported) throw badRequest(`currentLocation.${unsupported} is not accepted`);
  const accuracyMeters = input.accuracyMeters === undefined || input.accuracyMeters === null
    ? null
    : input.accuracyMeters;
  if (
    accuracyMeters !== null
    && (
      typeof accuracyMeters !== 'number'
      || !Number.isFinite(accuracyMeters)
      || accuracyMeters < 0
      || accuracyMeters > 100_000
    )
  ) {
    throw badRequest('currentLocation.accuracyMeters must be between 0 and 100000');
  }
  const latitude = requireCoordinate(input.latitude, 'latitude');
  const longitude = requireCoordinate(input.longitude, 'longitude');
  if (!isAustralianRoutingCoordinate({ latitude, longitude })) {
    throw badRequest('currentLocation coordinates must be within Australia');
  }
  let capturedAt: string | null = null;
  if (input.capturedAt !== undefined && input.capturedAt !== null && input.capturedAt !== '') {
    if (typeof input.capturedAt !== 'string') {
      throw badRequest('currentLocation.capturedAt must be an ISO datetime');
    }
    const parsed = new Date(input.capturedAt);
    if (Number.isNaN(parsed.getTime())) {
      throw badRequest('currentLocation.capturedAt must be an ISO datetime');
    }
    if (parsed.getTime() < now.getTime() - (30 * 60 * 1_000)) {
      throw badRequest('currentLocation.capturedAt must be within the last 30 minutes');
    }
    if (parsed.getTime() > now.getTime() + (2 * 60 * 1_000)) {
      throw badRequest('currentLocation.capturedAt cannot be more than two minutes in the future');
    }
    capturedAt = parsed.toISOString();
  }
  return {
    latitude,
    longitude,
    ...(accuracyMeters === null ? {} : { accuracyMeters: accuracyMeters as number }),
    ...(capturedAt === null ? {} : { capturedAt }),
  };
}

async function resolveRouteAssignee(
  user: AuthUser,
  requestedFieldUserId: unknown,
): Promise<{ fieldUserId: string; timezone: string }> {
  assertPortalSchedulerApp(user);
  let requested: string | null = null;
  if (requestedFieldUserId !== undefined && requestedFieldUserId !== null) {
    if (typeof requestedFieldUserId !== 'string' || !requestedFieldUserId.trim()) {
      throw badRequest('assigneeFieldUserId must be a non-empty string');
    }
    requested = requestedFieldUserId.trim();
  }

  const callerFieldUserId = requested && isSchedulerAdmin(user)
    ? null
    : await resolveCallerFieldUserId(user);
  if (!isSchedulerAdmin(user) && requested && requested !== callerFieldUserId) {
    throw forbidden('You can only request your own route suggestions');
  }
  const fieldUserId = requested ?? callerFieldUserId;
  if (!fieldUserId) throw notFound('Scheduler user');

  const [assignee] = await db.select({
    fieldUserId: globalUsers.fieldUserId,
    timezone: globalUsers.timezone,
  }).from(globalUsers).where(and(
    eq(globalUsers.fieldUserId, fieldUserId),
    eq(globalUsers.isActive, true),
  )).limit(1);
  if (!assignee) throw notFound('Assignee');
  if (!isValidAnalyticsTimeZone(assignee.timezone)) {
    throw badRequest('Assignee timezone must be a valid IANA timezone');
  }
  return assignee;
}

async function loadRouteEvents(
  assigneeFieldUserId: string,
  date: string,
  timezone: string,
): Promise<EventRow[]> {
  const startAt = startOfCalendarDateInTimeZone(date, timezone);
  const endAt = startOfCalendarDateInTimeZone(addCalendarDays(date, 1), timezone);
  const rows = await db.select().from(portalScheduleEvents).where(and(
    eq(portalScheduleEvents.assigneeFieldUserId, assigneeFieldUserId),
    gte(portalScheduleEvents.scheduledStartAt, startAt),
    lt(portalScheduleEvents.scheduledStartAt, endAt),
    inArray(portalScheduleEvents.status, ['planned', 'in_progress']),
    inArray(portalScheduleEvents.sourceApp, [...ROUTABLE_SOURCE_APPS]),
  )).orderBy(
    asc(portalScheduleEvents.scheduledStartAt),
    asc(portalScheduleEvents.id),
  ).limit(config.schedulerMaps.maxStops + 1);
  if (rows.length > config.schedulerMaps.maxStops) {
    throw badRequest(`Route suggestions support at most ${config.schedulerMaps.maxStops} jobs`);
  }
  return rows;
}

function destinationSelection<T extends {
  address: unknown;
  latitude: unknown;
  longitude: unknown;
  addressFingerprint: unknown;
}>(row: T): StoredDestination {
  return {
    address: typeof row.address === 'string' && row.address.trim()
      ? row.address.trim()
      : null,
    latitude: typeof row.latitude === 'number' && Number.isFinite(row.latitude)
      ? row.latitude
      : null,
    longitude: typeof row.longitude === 'number' && Number.isFinite(row.longitude)
      ? row.longitude
      : null,
    addressFingerprint: typeof row.addressFingerprint === 'string'
      ? row.addressFingerprint
      : null,
  };
}

async function loadStoredDestinations(events: readonly EventRow[]): Promise<Map<string, StoredDestination>> {
  const ecoIds: string[] = [];
  const solarIds: string[] = [];
  const fieldIds: string[] = [];
  for (const event of events) {
    if (!event.sourceId) continue;
    if (event.sourceApp === 'ecoaudit' && event.sourceType === 'audit') ecoIds.push(event.sourceId);
    if (event.sourceApp === 'solarsense' && event.sourceType === 'assessment') solarIds.push(event.sourceId);
    if (event.sourceApp === 'installhub' && event.sourceType === 'installation') fieldIds.push(event.sourceId);
  }

  const [ecoRows, solarRows, fieldRows] = await Promise.all([
    ecoIds.length === 0 ? [] : db.select({
      id: eaAudits.id,
      address: eaAudits.siteAddress,
      latitude: eaAudits.siteLatitude,
      longitude: eaAudits.siteLongitude,
      addressFingerprint: eaAudits.siteAddressFingerprint,
    }).from(eaAudits).where(and(
      inArray(eaAudits.id, ecoIds),
      eq(eaAudits.status, 'Draft'),
      isNull(eaAudits.deletedAt),
    )),
    solarIds.length === 0 ? [] : db.select({
      id: ssRooftopAssessments.id,
      address: ssSites.location,
      latitude: ssSites.siteLatitude,
      longitude: ssSites.siteLongitude,
      addressFingerprint: ssSites.siteAddressFingerprint,
    }).from(ssRooftopAssessments).innerJoin(ssSites, and(
      eq(ssSites.id, ssRooftopAssessments.siteId),
      eq(ssSites.status, 'Draft'),
      isNull(ssSites.deletedAt),
    )).where(and(
      inArray(ssRooftopAssessments.id, solarIds),
      eq(ssRooftopAssessments.status, 'Draft'),
      isNull(ssRooftopAssessments.deletedAt),
    )),
    fieldIds.length === 0 ? [] : db.select({
      id: ihInstallations.id,
      address: ihInstallations.siteAddress,
      latitude: ihInstallations.siteLatitude,
      longitude: ihInstallations.siteLongitude,
      addressFingerprint: ihInstallations.siteAddressFingerprint,
    }).from(ihInstallations).where(and(
      inArray(ihInstallations.id, fieldIds),
      eq(ihInstallations.status, 'Draft'),
      isNull(ihInstallations.deletedAt),
    )),
  ]);

  const destinations = new Map<string, StoredDestination>();
  for (const row of ecoRows) {
    destinations.set(`ecoaudit:audit:${row.id}`, destinationSelection(row));
  }
  for (const row of solarRows) {
    destinations.set(`solarsense:assessment:${row.id}`, destinationSelection(row));
  }
  for (const row of fieldRows) {
    destinations.set(`installhub:installation:${row.id}`, destinationSelection(row));
  }
  return destinations;
}

function unroutableFromEvent(
  event: EventRow,
  address: string | null,
  reason: string,
): SchedulerUnroutableJob {
  return {
    eventId: event.id,
    sourceApp: event.sourceApp as ScheduleSourceApp,
    sourceType: event.sourceType as ScheduleSourceType,
    sourceId: event.sourceId,
    title: event.title,
    address,
    reason,
  };
}

async function resolveRoutableEvents(
  events: readonly EventRow[],
  warnings: string[],
): Promise<{ routable: RoutableEvent[]; unroutable: SchedulerUnroutableJob[] }> {
  const destinations = await loadStoredDestinations(events);
  const routable: RoutableEvent[] = [];
  const unroutable: SchedulerUnroutableJob[] = [];

  for (const event of events) {
    if (!event.sourceId) {
      unroutable.push(unroutableFromEvent(event, null, 'The job is not linked to a product record'));
      continue;
    }
    const key = `${event.sourceApp}:${event.sourceType}:${event.sourceId}`;
    const destination = destinations.get(key);
    if (!destination) {
      unroutable.push(unroutableFromEvent(
        event,
        null,
        'The linked Draft job is unavailable',
      ));
      continue;
    }
    if (!destination.address) {
      unroutable.push(unroutableFromEvent(event, null, 'The job does not have an address'));
      continue;
    }

    if (storedSchedulerCoordinatesAreCurrent({
      freeform: destination.address,
      latitude: destination.latitude,
      longitude: destination.longitude,
      addressFingerprint: destination.addressFingerprint,
    })) {
      routable.push({
        event,
        address: destination.address,
        latitude: destination.latitude!,
        longitude: destination.longitude!,
      });
      continue;
    }
    if (destination.latitude !== null || destination.longitude !== null) {
      warnings.push(`Stored coordinates for ${event.title} were ignored because its address changed.`);
    }

    if (!config.schedulerMaps.photonUrl) {
      unroutable.push(unroutableFromEvent(
        event,
        destination.address,
        'Address geocoding is not configured',
      ));
      continue;
    }

    try {
      const geocoded = await geocodeSchedulerAddress(destination.address);
      if (geocoded) {
        routable.push({
          event,
          address: destination.address,
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
        });
      } else {
        unroutable.push(unroutableFromEvent(
          event,
          destination.address,
          'The address could not be geocoded',
        ));
      }
    } catch {
      unroutable.push(unroutableFromEvent(
        event,
        destination.address,
        'The address geocoder was unavailable',
      ));
    }
  }
  return { routable, unroutable };
}

function haversineDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6_371_008.8;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const firstLatitude = radians(from.latitude);
  const secondLatitude = radians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude)
      * Math.cos(secondLatitude)
      * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function straightLineMatrix(
  points: readonly { latitude: number; longitude: number }[],
): Matrix {
  const distances = points.map((from) => points.map((to) => (
    haversineDistanceMeters(from, to)
  )));
  return {
    distances,
    durations: distances.map((row) => row.map((distance) => (
      distance / DEFAULT_STRAIGHT_LINE_SPEED_METRES_PER_SECOND
    ))),
  };
}

function finiteMatrixValue(matrix: number[][], from: number, to: number): number | null {
  const value = matrix[from]?.[to];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function compareNumericPaths(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

/** Exact open route: start at matrix index 0, visit the largest drivable job set, no return. */
export function optimizeOpenRoute(matrix: Matrix, jobCount: number): OpenRouteOptimization {
  if (!Number.isInteger(jobCount) || jobCount < 0 || jobCount > config.schedulerMaps.maxStops) {
    throw badRequest(`jobCount must be between 0 and ${config.schedulerMaps.maxStops}`);
  }
  let bestOrder: number[] = [];
  let bestDuration = 0;

  function visit(currentPoint: number, remaining: number[], path: number[], duration: number): void {
    if (
      path.length > bestOrder.length
      || (
        path.length === bestOrder.length
        && (
          duration < bestDuration
          || (duration === bestDuration && compareNumericPaths(path, bestOrder) < 0)
        )
      )
    ) {
      bestOrder = [...path];
      bestDuration = duration;
    }
    for (let position = 0; position < remaining.length; position += 1) {
      const jobIndex = remaining[position]!;
      const nextPoint = jobIndex + 1;
      const legDuration = finiteMatrixValue(matrix.durations, currentPoint, nextPoint);
      const legDistance = finiteMatrixValue(matrix.distances, currentPoint, nextPoint);
      if (legDuration === null || legDistance === null) continue;
      visit(
        nextPoint,
        remaining.filter((_, index) => index !== position),
        [...path, jobIndex],
        duration + legDuration,
      );
    }
  }

  visit(0, Array.from({ length: jobCount }, (_, index) => index), [], 0);
  const orderSet = new Set(bestOrder);
  const unrouted = Array.from({ length: jobCount }, (_, index) => index)
    .filter((index) => !orderSet.has(index));
  const legDistances: number[] = [];
  const legDurations: number[] = [];
  let currentPoint = 0;
  for (const jobIndex of bestOrder) {
    const nextPoint = jobIndex + 1;
    legDistances.push(finiteMatrixValue(matrix.distances, currentPoint, nextPoint) ?? 0);
    legDurations.push(finiteMatrixValue(matrix.durations, currentPoint, nextPoint) ?? 0);
    currentPoint = nextPoint;
  }
  return {
    order: bestOrder,
    unrouted,
    legDistances,
    legDurations,
    totalDistance: legDistances.reduce((sum, value) => sum + value, 0),
    totalDuration: legDurations.reduce((sum, value) => sum + value, 0),
  };
}

export function buildSchedulerGoogleMapsUrl(
  current: SchedulerRouteCurrentLocation,
  ordered: readonly { latitude: number; longitude: number }[],
): string | null {
  if (ordered.length === 0) return null;
  const params = new URLSearchParams({
    api: '1',
    origin: `${current.latitude},${current.longitude}`,
    destination: `${ordered.at(-1)!.latitude},${ordered.at(-1)!.longitude}`,
    travelmode: 'driving',
    dir_action: 'navigate',
  });
  if (ordered.length > 1) {
    params.set('waypoints', ordered.slice(0, -1).map((job) => (
      `${job.latitude},${job.longitude}`
    )).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function appendScheduleWarnings(
  jobs: readonly SchedulerRouteJob[],
  currentLocation: SchedulerRouteCurrentLocation,
  warnings: string[],
): void {
  const scheduledOrder = [...jobs].sort((left, right) => (
    left.scheduledStartAt.localeCompare(right.scheduledStartAt)
      || left.eventId.localeCompare(right.eventId)
  ));
  if (jobs.some((job, index) => job.eventId !== scheduledOrder[index]?.eventId)) {
    warnings.push('The shortest route order differs from the scheduled start order.');
  }
  for (let index = 1; index < jobs.length; index += 1) {
    const previous = jobs[index - 1]!;
    const current = jobs[index]!;
    const previousFinish = previous.scheduledEndAt
      ? new Date(previous.scheduledEndAt).getTime()
      : new Date(previous.scheduledStartAt).getTime() + DEFAULT_UNSCHEDULED_JOB_DURATION_MS;
    const arrival = previousFinish + (current.travelDurationSeconds * 1_000);
    if (arrival > new Date(current.scheduledStartAt).getTime()) {
      warnings.push(
        `Travel from stop ${previous.sequence} (${previous.title}) may make stop ${current.sequence} (${current.title}) late.`,
      );
    }
  }
  if (jobs.length > 0 && currentLocation.capturedAt) {
    const first = jobs[0]!;
    const arrival = new Date(currentLocation.capturedAt).getTime()
      + (first.travelDurationSeconds * 1_000);
    if (arrival > new Date(first.scheduledStartAt).getTime()) {
      warnings.push(
        `The current location may not allow arrival at stop ${first.sequence} (${first.title}) on time.`,
      );
    }
  }
}

export async function getSchedulerRouteSuggestion(
  user: AuthUser,
  input: SchedulerRouteSuggestionInput,
): Promise<SchedulerRouteSuggestion> {
  const date = requireCalendarDate(input.date);
  const currentLocation = parseSchedulerCurrentLocation(input.currentLocation);
  const assignee = await resolveRouteAssignee(user, input.assigneeFieldUserId);
  const events = await loadRouteEvents(assignee.fieldUserId, date, assignee.timezone);
  const warnings: string[] = [];
  if (currentLocation.accuracyMeters !== undefined && currentLocation.accuracyMeters > 1_000) {
    warnings.push('Current location accuracy is low, so route estimates may be imprecise.');
  }

  const resolved = await resolveRoutableEvents(events, warnings);
  const points = [
    { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
    ...resolved.routable.map(({ latitude, longitude }) => ({ latitude, longitude })),
  ];
  let matrix = straightLineMatrix(points);
  let optimization: SchedulerRouteSuggestion['optimization'] = 'straight_line_distance';
  if (resolved.routable.length > 0) {
    try {
      const road = await getSchedulerTravelMatrix(points);
      if (road.available && road.distancesMeters && road.durationsSeconds) {
        matrix = {
          distances: road.distancesMeters,
          durations: road.durationsSeconds,
        };
        optimization = 'road_duration';
      } else {
        warnings.push('Road routing is not configured; estimates use straight-line distance at 50 km/h.');
      }
    } catch {
      warnings.push('Road routing was unavailable; estimates use straight-line distance at 50 km/h.');
    }
  }

  const optimized = optimizeOpenRoute(matrix, resolved.routable.length);
  const orderedInternal = optimized.order.map((index) => resolved.routable[index]!);
  const jobs = orderedInternal.map((job, index): SchedulerRouteJob => ({
    sequence: index + 1,
    eventId: job.event.id,
    sourceApp: job.event.sourceApp as ScheduleSourceApp,
    sourceType: job.event.sourceType as ScheduleSourceType,
    sourceId: job.event.sourceId!,
    title: job.event.title,
    address: job.address,
    scheduledStartAt: job.event.scheduledStartAt.toISOString(),
    scheduledEndAt: job.event.scheduledEndAt?.toISOString() ?? null,
    travelDistanceMeters: Math.round(optimized.legDistances[index] ?? 0),
    travelDurationSeconds: Math.round(optimized.legDurations[index] ?? 0),
  }));
  for (const unroutedIndex of optimized.unrouted) {
    const job = resolved.routable[unroutedIndex]!;
    resolved.unroutable.push(unroutableFromEvent(
      job.event,
      job.address,
      'The road router did not return a drivable path',
    ));
  }
  if (resolved.unroutable.length > 0) {
    warnings.push(`${resolved.unroutable.length} job(s) could not be included in the route.`);
  }
  appendScheduleWarnings(jobs, currentLocation, warnings);

  return {
    date,
    timezone: assignee.timezone,
    assigneeFieldUserId: assignee.fieldUserId,
    currentLocation,
    jobs,
    unroutableJobs: resolved.unroutable,
    totalDistanceMeters: Math.round(optimized.totalDistance),
    totalDurationSeconds: Math.round(optimized.totalDuration),
    optimization,
    googleMapsUrl: buildSchedulerGoogleMapsUrl(currentLocation, orderedInternal),
    warnings: [...new Set(warnings)],
  };
}
