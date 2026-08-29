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
import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
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
import { schedulerVisibleFinanceSourceApps } from './schedulerVisibility.js';
import {
  assertPortalSchedulerApp,
  isSchedulerAdmin,
  resolveCallerFieldUserId,
  type ScheduleSourceApp,
  type ScheduleSourceType,
} from './scheduleService.js';

const DEFAULT_STRAIGHT_LINE_SPEED_METRES_PER_SECOND = 50_000 / 3_600;
const DEFAULT_UNSCHEDULED_JOB_DURATION_MS = 60 * 60 * 1_000;
const SCHEDULER_GEOCODE_CONCURRENCY = 4;

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
  currentLocation?: unknown;
  startingAddress?: unknown;
  assigneeFieldUserId?: unknown;
};

export type SchedulerRouteOriginInput =
  | { kind: 'current_location'; currentLocation: SchedulerRouteCurrentLocation }
  | { kind: 'starting_address'; startingAddress: string };

type EventRow = typeof portalScheduleEvents.$inferSelect;

type StoredDestination = {
  address: string | null;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: string | null;
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

type RoutableEventResolution = {
  routable?: RoutableEvent;
  unroutable?: SchedulerUnroutableJob;
  warning?: string;
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

export function parseSchedulerRouteOriginInput(
  input: Pick<SchedulerRouteSuggestionInput, 'currentLocation' | 'startingAddress'>,
  now = new Date(),
): SchedulerRouteOriginInput {
  const hasCurrentLocation = input.currentLocation !== undefined && input.currentLocation !== null;
  const hasStartingAddress = input.startingAddress !== undefined && input.startingAddress !== null;
  if (hasCurrentLocation === hasStartingAddress) {
    throw badRequest('Provide exactly one of currentLocation or startingAddress');
  }
  if (hasCurrentLocation) {
    return {
      kind: 'current_location',
      currentLocation: parseSchedulerCurrentLocation(input.currentLocation, now),
    };
  }
  if (typeof input.startingAddress !== 'string') {
    throw badRequest('startingAddress must be an Australian address');
  }
  const startingAddress = input.startingAddress.trim().replace(/\s+/gu, ' ');
  if (startingAddress.length < 3 || startingAddress.length > 300) {
    throw badRequest('startingAddress must contain between 3 and 300 characters');
  }
  return { kind: 'starting_address', startingAddress };
}

export async function resolveSchedulerRouteOrigin(
  input: Pick<SchedulerRouteSuggestionInput, 'currentLocation' | 'startingAddress'>,
  options: {
    geocodingAvailable?: boolean;
    geocode?: (address: string) => Promise<{ latitude: number; longitude: number } | null>;
  } = {},
): Promise<SchedulerRouteCurrentLocation> {
  const origin = parseSchedulerRouteOriginInput(input);
  if (origin.kind === 'current_location') return origin.currentLocation;
  const geocodingAvailable = options.geocodingAvailable
    ?? Boolean(config.schedulerMaps.geoapifyApiKey || config.schedulerMaps.photonUrl);
  if (!geocodingAvailable) {
    throw new AppError(503, 'Service unavailable', 'scheduler_geocoder_unavailable');
  }
  const geocoded = await (options.geocode ?? geocodeSchedulerAddress)(origin.startingAddress);
  if (!geocoded) {
    throw badRequest('startingAddress could not be resolved to an Australian location');
  }
  return {
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
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
    inArray(portalScheduleEvents.sourceApp, schedulerVisibleFinanceSourceApps()),
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
  locality: unknown;
  state: unknown;
  postcode: unknown;
  countryCode: unknown;
  latitude: unknown;
  longitude: unknown;
  addressFingerprint: unknown;
}>(row: T): StoredDestination {
  return {
    address: typeof row.address === 'string' && row.address.trim()
      ? row.address.trim()
      : null,
    locality: typeof row.locality === 'string' ? row.locality : null,
    state: typeof row.state === 'string' ? row.state : null,
    postcode: typeof row.postcode === 'string' ? row.postcode : null,
    countryCode: typeof row.countryCode === 'string' ? row.countryCode : null,
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
      locality: eaAudits.siteLocality,
      state: eaAudits.siteState,
      postcode: eaAudits.sitePostcode,
      countryCode: eaAudits.siteCountryCode,
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
      locality: ssSites.siteLocality,
      state: ssSites.siteState,
      postcode: ssSites.sitePostcode,
      countryCode: ssSites.siteCountryCode,
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
      locality: ihInstallations.siteLocality,
      state: ihInstallations.siteState,
      postcode: ihInstallations.sitePostcode,
      countryCode: ihInstallations.siteCountryCode,
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

  async function resolveEvent(event: EventRow): Promise<RoutableEventResolution> {
    if (!event.sourceId) {
      return {
        unroutable: unroutableFromEvent(event, null, 'The job is not linked to a product record'),
      };
    }
    const key = `${event.sourceApp}:${event.sourceType}:${event.sourceId}`;
    const destination = destinations.get(key);
    if (!destination) {
      return {
        unroutable: unroutableFromEvent(event, null, 'The linked Draft job is unavailable'),
      };
    }
    if (!destination.address) {
      return {
        unroutable: unroutableFromEvent(event, null, 'The job does not have an address'),
      };
    }

    if (storedSchedulerCoordinatesAreCurrent({
      freeform: destination.address,
      locality: destination.locality,
      state: destination.state,
      postcode: destination.postcode,
      countryCode: destination.countryCode,
      latitude: destination.latitude,
      longitude: destination.longitude,
      addressFingerprint: destination.addressFingerprint,
    })) {
      return {
        routable: {
          event,
          address: destination.address,
          latitude: destination.latitude!,
          longitude: destination.longitude!,
        },
      };
    }
    const warning = destination.latitude !== null || destination.longitude !== null
      ? `Stored coordinates for ${event.title} were ignored because its address changed.`
      : undefined;

    if (!config.schedulerMaps.geoapifyApiKey && !config.schedulerMaps.photonUrl) {
      return {
        unroutable: unroutableFromEvent(
          event,
          destination.address,
          'Address geocoding is not configured',
        ),
        warning,
      };
    }

    try {
      const geocoded = await geocodeSchedulerAddress(destination.address);
      if (geocoded) {
        return {
          routable: {
            event,
            address: destination.address,
            latitude: geocoded.latitude,
            longitude: geocoded.longitude,
          },
          warning,
        };
      }
      return {
        unroutable: unroutableFromEvent(
          event,
          destination.address,
          'The address could not be geocoded',
        ),
        warning,
      };
    } catch {
      return {
        unroutable: unroutableFromEvent(
          event,
          destination.address,
          'The address geocoder was unavailable',
        ),
        warning,
      };
    }
  }

  const resolutions: RoutableEventResolution[] = [];
  for (let offset = 0; offset < events.length; offset += SCHEDULER_GEOCODE_CONCURRENCY) {
    const batch = events.slice(offset, offset + SCHEDULER_GEOCODE_CONCURRENCY);
    resolutions.push(...await Promise.all(batch.map(resolveEvent)));
  }

  const routable: RoutableEvent[] = [];
  const unroutable: SchedulerUnroutableJob[] = [];
  for (const resolution of resolutions) {
    if (resolution.routable) routable.push(resolution.routable);
    if (resolution.unroutable) unroutable.push(resolution.unroutable);
    if (resolution.warning) warnings.push(resolution.warning);
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

type PartialOpenRoute = {
  duration: number;
  order: number[];
};

function routeIsBetter(candidate: PartialOpenRoute, current: PartialOpenRoute): boolean {
  return candidate.order.length > current.order.length
    || (
      candidate.order.length === current.order.length
      && (
        candidate.duration < current.duration
        || (
          candidate.duration === current.duration
          && compareNumericPaths(candidate.order, current.order) < 0
        )
      )
    );
}

/** Exact map-free open route: start at matrix index 0, visit the largest drivable set, no return. */
export function optimizeOpenRoute(matrix: Matrix, jobCount: number): OpenRouteOptimization {
  if (!Number.isInteger(jobCount) || jobCount < 0 || jobCount > config.schedulerMaps.maxStops) {
    throw badRequest(`jobCount must be between 0 and ${config.schedulerMaps.maxStops}`);
  }
  const states = Array.from(
    { length: 2 ** jobCount },
    () => new Map<number, PartialOpenRoute>(),
  );
  let best: PartialOpenRoute = { duration: 0, order: [] };

  for (let jobIndex = 0; jobIndex < jobCount; jobIndex += 1) {
    const nextPoint = jobIndex + 1;
    const legDuration = finiteMatrixValue(matrix.durations, 0, nextPoint);
    const legDistance = finiteMatrixValue(matrix.distances, 0, nextPoint);
    if (legDuration === null || legDistance === null) continue;
    const initial = { duration: legDuration, order: [jobIndex] };
    states[2 ** jobIndex]!.set(jobIndex, initial);
    if (routeIsBetter(initial, best)) best = initial;
  }

  for (let visitedMask = 1; visitedMask < states.length; visitedMask += 1) {
    for (const [lastJobIndex, partial] of states[visitedMask]!) {
      if (routeIsBetter(partial, best)) best = partial;
      for (let nextJobIndex = 0; nextJobIndex < jobCount; nextJobIndex += 1) {
        const nextBit = 2 ** nextJobIndex;
        if ((visitedMask & nextBit) !== 0) continue;
        const legDuration = finiteMatrixValue(
          matrix.durations,
          lastJobIndex + 1,
          nextJobIndex + 1,
        );
        const legDistance = finiteMatrixValue(
          matrix.distances,
          lastJobIndex + 1,
          nextJobIndex + 1,
        );
        if (legDuration === null || legDistance === null) continue;
        const candidate: PartialOpenRoute = {
          duration: partial.duration + legDuration,
          order: [...partial.order, nextJobIndex],
        };
        const nextStates = states[visitedMask + nextBit]!;
        const existing = nextStates.get(nextJobIndex);
        if (!existing || routeIsBetter(candidate, existing)) {
          nextStates.set(nextJobIndex, candidate);
        }
      }
    }
  }

  const bestOrder = best.order;
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
  const currentLocation = await resolveSchedulerRouteOrigin(input);
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
    // Retained as a null compatibility field for portal clients deployed before
    // route planning became map-free.
    googleMapsUrl: null,
    warnings: [...new Set(warnings)],
  };
}
