import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  wwClients,
  wwClientCredentials,
  wwClientRunResults,
  wwCollectionRuns,
  wwDeviceClients,
  wwDeviceObservations,
  wwDevices,
  wwObservationClients,
  wwOutages,
  wwReportDeliveries,
  wwReports,
} from '../../db/schema/wattwatchers.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { badRequest, notFound } from '../../utils/errors.js';
import {
  loadBusinessClientGraph,
  loadBusinessSiteGraph,
  loadDeviceAssociations,
  loadFleetAccountsByDevice,
  loadPlacementsByDevice,
  placementSummary,
  searchBusinessSites,
  type FleetDeviceReference,
} from './readRelations.js';
import { summarizeDeviceStatuses } from './readModels.js';
import { availabilityPercent, type FleetStatus } from './status.js';

type FleetFilters = { clientId?: string; maas?: string };
type FleetClientReference = { id: string; code: string; name: string; isMaas: boolean };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const safeObservationColumns = {
  observationId: wwDeviceObservations.id,
  runId: wwDeviceObservations.runId,
  internalDeviceId: wwDeviceObservations.deviceId,
  primaryClientId: wwDeviceObservations.clientId,
  observedAt: wwDeviceObservations.observedAt,
  lastHeardAt: wwDeviceObservations.lastHeardAt,
  latestStatusAt: wwDeviceObservations.latestStatusAt,
  communicationAgeSeconds: wwDeviceObservations.communicationAgeSeconds,
  status: wwDeviceObservations.status,
  reportOffline: wwDeviceObservations.reportOffline,
  reportTransition: wwDeviceObservations.reportTransition,
  fetchStatus: wwDeviceObservations.fetchStatus,
  uninitialised: wwDeviceObservations.uninitialised,
  labelSnapshot: wwDeviceObservations.labelSnapshot,
  modelSnapshot: wwDeviceObservations.modelSnapshot,
  installDateSnapshot: wwDeviceObservations.installDateSnapshot,
  observationFirmwareVersion: wwDeviceObservations.firmwareVersion,
  observationDeviceTimezone: wwDeviceObservations.deviceTimezone,
  commsType: wwDeviceObservations.commsType,
  commsMode: wwDeviceObservations.commsMode,
  lastHeardVia: wwDeviceObservations.lastHeardVia,
  signalQualityDbm: wwDeviceObservations.signalQualityDbm,
  cellQuality: wwDeviceObservations.cellQuality,
  metrics: wwDeviceObservations.metrics,
  externalDeviceId: wwDevices.deviceId,
  deviceLabel: wwDevices.label,
  deviceModel: wwDevices.model,
  deviceInstallDate: wwDevices.installDate,
  deviceFirmwareVersion: wwDevices.firmwareVersion,
  deviceTimezone: wwDevices.deviceTimezone,
  firstSeenAt: wwDevices.firstSeenAt,
  lastDiscoveredAt: wwDevices.lastDiscoveredAt,
};

type SafeObservation = Awaited<ReturnType<typeof loadObservations>>[number];
type Attribution = {
  observationId: string;
  runId: string;
  internalDeviceId: string;
  clientId: string;
  code: string;
  name: string;
  isMaas: boolean;
};

async function loadObservations(runIds: string[]) {
  if (runIds.length === 0) return [];
  return db.select(safeObservationColumns)
    .from(wwDeviceObservations)
    .innerJoin(wwDevices, eq(wwDeviceObservations.deviceId, wwDevices.id))
    .where(inArray(wwDeviceObservations.runId, runIds));
}

async function loadAttributions(runIds: string[]): Promise<Attribution[]> {
  if (runIds.length === 0) return [];
  return db.select({
    observationId: wwObservationClients.observationId,
    runId: wwObservationClients.runId,
    internalDeviceId: wwObservationClients.deviceId,
    clientId: wwObservationClients.clientId,
    code: wwObservationClients.clientCodeSnapshot,
    name: wwObservationClients.clientNameSnapshot,
    isMaas: wwObservationClients.isMaas,
  }).from(wwObservationClients).where(inArray(wwObservationClients.runId, runIds));
}

async function loadAttributionsForObservations(observationIds: string[]): Promise<Attribution[]> {
  if (observationIds.length === 0) return [];
  return db.select({
    observationId: wwObservationClients.observationId,
    runId: wwObservationClients.runId,
    internalDeviceId: wwObservationClients.deviceId,
    clientId: wwObservationClients.clientId,
    code: wwObservationClients.clientCodeSnapshot,
    name: wwObservationClients.clientNameSnapshot,
    isMaas: wwObservationClients.isMaas,
  }).from(wwObservationClients)
    .where(inArray(wwObservationClients.observationId, observationIds));
}

function attributionsByObservation(rows: Attribution[]) {
  const map = new Map<string, Attribution[]>();
  for (const row of rows) {
    const list = map.get(row.observationId) ?? [];
    list.push(row);
    map.set(row.observationId, list);
  }
  return map;
}

function parseBoolean(value: unknown, name: string): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw badRequest(`${name} must be true or false`);
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) throw badRequest('Pagination values must be integers');
  return Math.min(max, Math.max(min, number));
}

function dateFilter(value: string | undefined, name: string): string | null {
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) throw badRequest(`${name} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${name} must be a real calendar date`);
  }
  return value;
}

function filterObservations(
  observations: SafeObservation[],
  attributionMap: Map<string, Attribution[]>,
  filters: FleetFilters,
): SafeObservation[] {
  const maas = parseBoolean(filters.maas, 'maas');
  return observations.filter((observation) => {
    const allAttributions = attributionMap.get(observation.observationId) ?? [];
    const scopedAttributions = filters.clientId
      ? allAttributions.filter((row) => row.clientId === filters.clientId)
      : allAttributions;
    if (filters.clientId && scopedAttributions.length === 0) return false;
    if (maas === null) return true;
    const belongsToMaas = scopedAttributions.some((row) => row.isMaas);
    return belongsToMaas === maas;
  });
}

function clientReference(attribution: Attribution | undefined): FleetClientReference | null {
  return attribution ? {
    id: attribution.clientId,
    code: attribution.code,
    name: attribution.name,
    isMaas: attribution.isMaas,
  } : null;
}

function mapObservation(
  observation: SafeObservation,
  attributions: Attribution[],
  preferredClientId?: string,
) {
  const primary = attributions.find((row) => row.clientId === preferredClientId)
    ?? attributions.find((row) => row.clientId === observation.primaryClientId)
    ?? attributions[0];
  return {
    deviceId: observation.externalDeviceId,
    label: observation.labelSnapshot ?? observation.deviceLabel,
    model: observation.modelSnapshot ?? observation.deviceModel,
    installDate: observation.installDateSnapshot ?? observation.deviceInstallDate,
    firmwareVersion: observation.observationFirmwareVersion ?? observation.deviceFirmwareVersion,
    deviceTimezone: observation.observationDeviceTimezone ?? observation.deviceTimezone,
    client: clientReference(primary),
    status: observation.status,
    reportOffline: observation.reportOffline,
    reportTransition: observation.reportTransition,
    lastHeardAt: observation.lastHeardAt,
    latestStatusAt: observation.latestStatusAt,
    observedAt: observation.observedAt,
    communicationAgeSeconds: observation.communicationAgeSeconds,
    fetchStatus: observation.fetchStatus,
    uninitialised: observation.uninitialised,
    commsType: observation.commsType,
    commsMode: observation.commsMode,
    lastHeardVia: observation.lastHeardVia,
    signalQualityDbm: observation.signalQualityDbm,
    cellQuality: observation.cellQuality,
    metrics: observation.metrics,
  };
}

function runReference(run: typeof wwCollectionRuns.$inferSelect | null | undefined) {
  return run ? {
    id: run.id,
    reportingDate: run.reportingDate,
    status: run.status,
    publishedAt: run.publishedAt,
    finishedAt: run.finishedAt,
    delayedThresholdMinutes: run.delayedThresholdMinutes,
    offlineThresholdMinutes: run.offlineThresholdMinutes,
    reportOfflineThresholdHours: run.reportOfflineThresholdHours,
    inventoryScope: run.inventoryScope,
  } : null;
}

function mapRun(run: typeof wwCollectionRuns.$inferSelect) {
  return {
    id: run.id,
    sourceRunKey: run.sourceRunKey,
    reportingDate: run.reportingDate,
    status: run.status,
    trigger: run.trigger,
    inventoryScope: run.inventoryScope,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    publishedAt: run.publishedAt,
    configuredClientCount: run.configuredClientCount,
    successfulClientCount: run.successfulClientCount,
    failedClientCount: run.failedClientCount,
    totalDevices: run.totalDevices,
    communicating: run.communicatingCount,
    delayed: run.delayedCount,
    offline: run.offlineCount,
    inactive: run.inactiveCount,
    unknown: run.unknownCount,
    reportOffline: run.reportOfflineCount,
    reportNewlyOffline: run.reportNewlyOfflineCount,
    reportRecovered: run.reportRecoveredCount,
    requestCount: run.requestCount,
    retryCount: run.retryCount,
    rateLimitCount: run.rateLimitCount,
    errorCount: run.errorCount,
    errorSummary: run.errorSummary,
  };
}

async function selectedRun(runId?: string) {
  if (runId) {
    const [run] = await db.select().from(wwCollectionRuns).where(eq(wwCollectionRuns.id, runId));
    if (!run) throw notFound('Fleet collection run');
    return run;
  }
  const [run] = await db.select().from(wwCollectionRuns)
    .where(eq(wwCollectionRuns.status, 'published'))
    .orderBy(desc(wwCollectionRuns.publishedAt)).limit(1);
  return run ?? null;
}

async function relatedDeviceRows(devices: FleetDeviceReference[]) {
  if (devices.length === 0) return [];
  const run = await selectedRun();
  const [observations, attributions, accountMap, placementMap] = await Promise.all([
    run ? loadObservations([run.id]) : [],
    run ? loadAttributions([run.id]) : [],
    loadFleetAccountsByDevice(devices.map((device) => device.internalDeviceId)),
    loadPlacementsByDevice(devices),
  ]);
  const attributionMap = attributionsByObservation(attributions);
  const observationByDevice = new Map(
    observations.map((observation) => [observation.internalDeviceId, observation]),
  );
  return devices.map((device) => {
    const observation = observationByDevice.get(device.internalDeviceId);
    const base = observation
      ? mapObservation(
          observation,
          attributionMap.get(observation.observationId) ?? [],
          observation.primaryClientId ?? undefined,
        )
      : {
          deviceId: device.deviceId,
          label: device.label,
          model: device.model,
          status: 'unknown' as const,
          reportOffline: false,
          lastHeardAt: null,
          observedAt: null,
          fetchStatus: 'not_collected',
        };
    const placements = placementMap.get(device.internalDeviceId) ?? [];
    return {
      ...base,
      status: base.status as FleetStatus,
      fleetAccounts: accountMap.get(device.internalDeviceId) ?? [],
      ...placementSummary(placements),
    };
  });
}

function summaryFor(
  observations: SafeObservation[],
  attributionMap: Map<string, Attribution[]>,
  filters: FleetFilters,
) {
  const count = (status: FleetStatus) => observations.filter((row) => row.status === status).length;
  const communicating = count('communicating');
  const delayed = count('delayed');
  const offline = count('offline');
  const relevantClientIds = new Set<string>();
  let maasTotal = 0;
  let maasReportOffline = 0;
  for (const observation of observations) {
    const all = attributionMap.get(observation.observationId) ?? [];
    const scoped = filters.clientId ? all.filter((row) => row.clientId === filters.clientId) : all;
    const matchingMaas = parseBoolean(filters.maas, 'maas');
    for (const attribution of scoped) {
      if (matchingMaas === null || attribution.isMaas === matchingMaas) relevantClientIds.add(attribution.clientId);
    }
    if (scoped.some((row) => row.isMaas)) {
      maasTotal += 1;
      if (observation.reportOffline) maasReportOffline += 1;
    }
  }
  return {
    totalDevices: observations.length,
    communicating,
    delayed,
    offline,
    inactive: count('inactive'),
    unknown: count('unknown'),
    reportOffline: observations.filter((row) => row.reportOffline).length,
    availabilityPercent: availabilityPercent({ communicating, delayed, offline }),
    reportNewlyOffline: observations.filter((row) => row.reportTransition === 'newly_offline').length,
    reportRecovered: observations.filter((row) => row.reportTransition === 'recovered').length,
    reportStillOffline: observations.filter((row) => row.reportTransition === 'still_offline').length,
    maasTotal,
    maasReportOffline,
    clientCount: relevantClientIds.size,
  };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function archivedEmailDelta(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const value = metadata.emailDelta;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reportScopeCondition(filters: FleetFilters) {
  const maas = parseBoolean(filters.maas, 'maas');
  if (filters.clientId) {
    return maas === null
      ? sql`exists (
          select 1 from ww_observation_clients scope_oc
          where scope_oc.run_id = ${wwReports.runId}
            and scope_oc.client_id = ${filters.clientId}
        )`
      : sql`exists (
          select 1 from ww_observation_clients scope_oc
          where scope_oc.run_id = ${wwReports.runId}
            and scope_oc.client_id = ${filters.clientId}
            and scope_oc.is_maas = ${maas}
        )`;
  }
  if (maas === true) {
    return sql`exists (
      select 1 from ww_observation_clients scope_oc
      where scope_oc.run_id = ${wwReports.runId} and scope_oc.is_maas = true
    )`;
  }
  if (maas === false) {
    // Match filterObservations semantics: shared MaaS/non-MaaS devices belong
    // to the MaaS cohort unless a specific non-MaaS client is selected.
    return sql`exists (
      select 1 from ww_device_observations scope_o
      where scope_o.run_id = ${wwReports.runId}
        and not exists (
          select 1 from ww_observation_clients scope_oc
          where scope_oc.observation_id = scope_o.id and scope_oc.is_maas = true
        )
    )`;
  }
  return undefined;
}

export async function wattwatchersReadRoutes(app: FastifyInstance): Promise<void> {
  const readGuards = [authenticate, requireApp('wattwatchers'), requireRole('viewer')];

  app.get('/dashboard/summary', {
    schema: { tags: ['Wattwatchers Dashboard'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as FleetFilters & { runId?: string };
    const run = await selectedRun(query.runId);
    const filters = { clientId: query.clientId || undefined, maas: query.maas };
    if (!run) return reply.send({ run: null, summary: null, filters: { clientId: null, maas: null } });
    const observations = await loadObservations([run.id]);
    const attributions = await loadAttributions([run.id]);
    const attributionMap = attributionsByObservation(attributions);
    const filtered = filterObservations(observations, attributionMap, filters);
    return reply.send({
      run: runReference(run),
      summary: summaryFor(filtered, attributionMap, filters),
      filters: { clientId: filters.clientId ?? null, maas: parseBoolean(filters.maas, 'maas') },
    });
  });

  app.get('/dashboard/trends', {
    schema: { tags: ['Wattwatchers Dashboard'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as FleetFilters & { from?: string; to?: string };
    const conditions = [eq(wwCollectionRuns.status, 'published')];
    const from = dateFilter(query.from, 'from');
    const to = dateFilter(query.to, 'to');
    if (from) conditions.push(gte(wwCollectionRuns.reportingDate, from));
    if (to) conditions.push(lte(wwCollectionRuns.reportingDate, to));
    const candidateRuns = await db.select().from(wwCollectionRuns).where(and(...conditions))
      .orderBy(desc(wwCollectionRuns.reportingDate), desc(wwCollectionRuns.publishedAt))
      .limit(732);
    // Manual retries may publish more than once on a reporting date. Trends are
    // daily, so retain only the latest complete snapshot for each date.
    const latestRunByDate = new Map<string, typeof candidateRuns[number]>();
    for (const run of candidateRuns) {
      if (!latestRunByDate.has(run.reportingDate)) latestRunByDate.set(run.reportingDate, run);
    }
    const runs = [...latestRunByDate.values()].slice(0, 366);
    const orderedRuns = [...runs].reverse();
    const observations = await loadObservations(orderedRuns.map((run) => run.id));
    const attributions = await loadAttributions(orderedRuns.map((run) => run.id));
    const attributionMap = attributionsByObservation(attributions);
    const data = orderedRuns.map((run) => {
      const runObservations = observations.filter((row) => row.runId === run.id);
      const filtered = filterObservations(runObservations, attributionMap, query);
      return {
        runId: run.id,
        reportingDate: run.reportingDate,
        publishedAt: run.publishedAt,
        ...summaryFor(filtered, attributionMap, query),
      };
    }).map(({ reportStillOffline: _reportStillOffline, maasTotal: _maasTotal, maasReportOffline: _maasReportOffline, clientCount: _clientCount, ...point }) => point);
    return reply.send({ data });
  });

  app.get('/devices', {
    schema: { tags: ['Wattwatchers Devices'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as FleetFilters & {
      status?: string; q?: string; model?: string; reportOffline?: string;
      limit?: string; offset?: string; sort?: string; direction?: string;
    };
    const run = await selectedRun();
    const limit = boundedInt(query.limit, 50, 1, 200);
    const offset = boundedInt(query.offset, 0, 0, 1_000_000);
    const [observations, attributions, registeredDevices] = await Promise.all([
      run ? loadObservations([run.id]) : [],
      run ? loadAttributions([run.id]) : [],
      db.select({
        internalDeviceId: wwDevices.id,
        deviceId: wwDevices.deviceId,
        label: wwDevices.label,
        model: wwDevices.model,
        installDate: wwDevices.installDate,
        firmwareVersion: wwDevices.firmwareVersion,
        deviceTimezone: wwDevices.deviceTimezone,
        clientId: wwClients.id,
        clientCode: wwClients.code,
        clientName: wwClients.name,
        clientIsMaas: wwClients.isMaas,
      }).from(wwDevices).leftJoin(wwClients, eq(wwClients.id, wwDevices.primaryClientId)),
    ]);
    const deviceReferences: FleetDeviceReference[] = registeredDevices.map((device) => ({
      internalDeviceId: device.internalDeviceId,
      deviceId: device.deviceId,
      label: device.label,
      model: device.model,
    }));
    const [fleetAccountMap, placementMap] = await Promise.all([
      loadFleetAccountsByDevice(deviceReferences.map((device) => device.internalDeviceId)),
      loadPlacementsByDevice(deviceReferences),
    ]);
    const referenceByDeviceId = new Map(
      deviceReferences.map((device) => [device.deviceId, device]),
    );
    const attributionMap = attributionsByObservation(attributions);
    let filtered = filterObservations(observations, attributionMap, query);
    if (query.status) filtered = filtered.filter((row) => row.status === query.status);
    if (query.reportOffline !== undefined && query.reportOffline !== '') {
      const reportOffline = parseBoolean(query.reportOffline, 'reportOffline');
      filtered = filtered.filter((row) => row.reportOffline === reportOffline);
    }
    if (query.model) filtered = filtered.filter((row) => (row.modelSnapshot ?? row.deviceModel) === query.model);
    const observedInternalIds = new Set(observations.map((row) => row.internalDeviceId));
    const attributedDeviceClientPairs = new Set(attributions.map((row) => `${row.internalDeviceId}:${row.clientId}`));
    const projected = registeredDevices.filter((row) => {
      if (observedInternalIds.has(row.internalDeviceId) && (
        !query.clientId || attributedDeviceClientPairs.has(`${row.internalDeviceId}:${query.clientId}`)
      )) return false;
      if (query.clientId && row.clientId !== query.clientId) return false;
      const maas = parseBoolean(query.maas, 'maas');
      if (maas !== null && (row.clientIsMaas ?? false) !== maas) return false;
      if (query.status && query.status !== 'unknown') return false;
      if (query.reportOffline !== undefined && query.reportOffline !== '') {
        const reportOffline = parseBoolean(query.reportOffline, 'reportOffline');
        if (reportOffline === true) return false;
      }
      if (query.model && row.model !== query.model) return false;
      return true;
    }).map((row) => ({
      deviceId: row.deviceId,
      label: row.label,
      model: row.model,
      installDate: row.installDate,
      firmwareVersion: row.firmwareVersion,
      deviceTimezone: row.deviceTimezone,
      client: row.clientId && row.clientCode && row.clientName && row.clientIsMaas !== null
        ? { id: row.clientId, code: row.clientCode, name: row.clientName, isMaas: row.clientIsMaas }
        : null,
      status: 'unknown' as const,
      reportOffline: false,
      reportTransition: null,
      lastHeardAt: null,
      latestStatusAt: null,
      observedAt: null,
      communicationAgeSeconds: null,
      fetchStatus: 'not_collected',
      uninitialised: true,
      commsType: null,
      commsMode: null,
      lastHeardVia: null,
      signalQualityDbm: null,
      cellQuality: null,
      metrics: null,
    }));
    const data = [
      ...filtered.map((row) => mapObservation(
        row, attributionMap.get(row.observationId) ?? [], query.clientId,
      )),
      ...projected,
    ];
    const direction = query.direction === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      if (query.sort === 'label') {
        return (a.label ?? '').localeCompare(b.label ?? '') * direction;
      }
      const aValue = query.sort === 'lastHeardAt' ? a.lastHeardAt?.getTime() : a.communicationAgeSeconds;
      const bValue = query.sort === 'lastHeardAt' ? b.lastHeardAt?.getTime() : b.communicationAgeSeconds;
      return ((aValue ?? -1) - (bValue ?? -1)) * direction;
    });
    let enrichedData = data.map((row) => {
      const reference = referenceByDeviceId.get(row.deviceId);
      const placements = reference
        ? placementMap.get(reference.internalDeviceId) ?? []
        : [];
      return {
        ...row,
        fleetAccounts: reference
          ? fleetAccountMap.get(reference.internalDeviceId) ?? []
          : [],
        ...placementSummary(placements),
      };
    });
    if (query.q) {
      const search = query.q.toLowerCase().trim();
      enrichedData = enrichedData.filter((row) => [
        row.deviceId,
        row.label,
        row.model,
        row.client?.name,
        row.currentPlacement?.businessClient.name,
        row.currentPlacement?.site?.id,
        row.currentPlacement?.site?.name,
        row.currentPlacement?.site?.address,
        ...row.fleetAccounts.flatMap((account) => [account.name, account.code]),
      ].some((value) => value?.toLowerCase().includes(search)));
    }
    return reply.send({
      run: runReference(run),
      data: enrichedData.slice(offset, offset + limit),
      meta: { total: enrichedData.length, limit, offset },
    });
  });

  app.get('/devices/:deviceId', {
    schema: { tags: ['Wattwatchers Devices'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { deviceId: externalDeviceId } = request.params as { deviceId: string };
    const { historyLimit: rawHistoryLimit } = request.query as { historyLimit?: string };
    const historyLimit = boundedInt(rawHistoryLimit, 90, 1, 366);
    const [device] = await db.select().from(wwDevices).where(eq(wwDevices.deviceId, externalDeviceId));
    if (!device) throw notFound('Fleet device');
    const memberships = await db.select({
      id: wwClients.id, code: wwClients.code, name: wwClients.name, isMaas: wwClients.isMaas,
    }).from(wwDeviceClients).innerJoin(wwClients, eq(wwDeviceClients.clientId, wwClients.id))
      .where(and(eq(wwDeviceClients.deviceId, device.id), eq(wwDeviceClients.isCurrent, true)))
      .orderBy(asc(wwClients.name));
    const historyRows = await db.select({ run: wwCollectionRuns, observation: safeObservationColumns })
      .from(wwDeviceObservations)
      .innerJoin(wwDevices, eq(wwDeviceObservations.deviceId, wwDevices.id))
      .innerJoin(wwCollectionRuns, eq(wwDeviceObservations.runId, wwCollectionRuns.id))
      .where(and(eq(wwDeviceObservations.deviceId, device.id), eq(wwCollectionRuns.status, 'published')))
      .orderBy(desc(wwCollectionRuns.publishedAt)).limit(historyLimit);
    const observationRows = historyRows.map((row) => row.observation);
    const attributions = await loadAttributionsForObservations(
      observationRows.map((row) => row.observationId),
    );
    const attributionMap = attributionsByObservation(attributions);
    const currentRow = observationRows[0] ?? null;
    const history = historyRows.map(({ run, observation }) => ({
      runId: run.id,
      reportingDate: run.reportingDate,
      status: observation.status,
      reportOffline: observation.reportOffline,
      reportTransition: observation.reportTransition,
      lastHeardAt: observation.lastHeardAt,
      latestStatusAt: observation.latestStatusAt,
      observedAt: observation.observedAt,
      communicationAgeSeconds: observation.communicationAgeSeconds,
    }));
    const outages = await db.select().from(wwOutages).where(eq(wwOutages.deviceId, device.id))
      .orderBy(desc(wwOutages.firstDetectedAt)).limit(historyLimit);
    const deviceReference: FleetDeviceReference = {
      internalDeviceId: device.id,
      deviceId: device.deviceId,
      label: device.label,
      model: device.model,
    };
    const [fleetAccountMap, placementMap, associations] = await Promise.all([
      loadFleetAccountsByDevice([device.id]),
      loadPlacementsByDevice([deviceReference]),
      loadDeviceAssociations(deviceReference, {
        includeSensitiveMeterRegisterFields: request.user.role === 'admin',
      }),
    ]);
    const placements = placementMap.get(device.id) ?? [];
    return reply.send({
      device: {
        deviceId: device.deviceId,
        label: device.label,
        model: device.model,
        installDate: device.installDate,
        firmwareVersion: device.firmwareVersion,
        deviceTimezone: device.deviceTimezone,
        firstSeenAt: device.firstSeenAt,
        lastDiscoveredAt: device.lastDiscoveredAt,
        memberships,
      },
      fleetAccounts: fleetAccountMap.get(device.id) ?? [],
      ...placementSummary(placements),
      current: currentRow ? mapObservation(
        currentRow, attributionMap.get(currentRow.observationId) ?? [], device.primaryClientId ?? undefined,
      ) : null,
      history,
      placements,
      outages: outages.map((outage) => ({
        id: outage.id,
        openedAt: outage.firstDetectedAt,
        lastConfirmedAt: outage.lastConfirmedAt,
        recoveredAt: outage.recoveredAt,
        durationSeconds: outage.durationSeconds,
        closeReason: outage.closeReason,
        open: outage.closedRunId === null,
      })),
      ...associations,
    });
  });

  app.get('/clients', {
    schema: { tags: ['Wattwatchers Clients'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { runId } = request.query as { runId?: string };
    const run = await selectedRun(runId);
    const [observations, attributions, results, clients, currentMemberships] = await Promise.all([
      run ? loadObservations([run.id]) : [],
      run ? loadAttributions([run.id]) : [],
      run
        ? db.select().from(wwClientRunResults).where(eq(wwClientRunResults.runId, run.id))
        : [],
      db.select({
        client: wwClients,
        credentialClientId: wwClientCredentials.clientId,
        apiKeyUpdatedAt: wwClientCredentials.updatedAt,
      }).from(wwClients).leftJoin(
        wwClientCredentials,
        eq(wwClientCredentials.clientId, wwClients.id),
      ).orderBy(asc(wwClients.name)),
      db.select({ clientId: wwDeviceClients.clientId, deviceId: wwDeviceClients.deviceId })
        .from(wwDeviceClients)
        .where(eq(wwDeviceClients.isCurrent, true))
        .orderBy(wwDeviceClients.clientId),
    ]);
    const observationById = new Map(observations.map((row) => [row.observationId, row]));
    const resultByClient = new Map(results.map((result) => [result.clientId, result]));
    const selectedClientIds = runId ? new Set(resultByClient.keys()) : null;
    const data = clients.filter(({ client }) => (
      selectedClientIds === null || selectedClientIds.has(client.id)
    )).map(({ client, credentialClientId, apiKeyUpdatedAt }) => {
      const result = resultByClient.get(client.id);
      const clientAttributions = attributions.filter((row) => row.clientId === client.id);
      const snapshot = clientAttributions[0];
      const clientObservationIds = new Set(clientAttributions.map((row) => row.observationId));
      const attributedDeviceIds = new Set(clientAttributions.map((row) => row.internalDeviceId));
      const clientObservations = [...clientObservationIds]
        .map((id) => observationById.get(id)).filter((row): row is SafeObservation => Boolean(row));
      const summary = summaryFor(clientObservations, attributionsByObservation(attributions), { clientId: client.id });
      const projectedUnknown = runId ? 0 : currentMemberships.filter((membership) => (
        membership.clientId === client.id && !attributedDeviceIds.has(membership.deviceId)
      )).length;
      const totalDevices = summary.totalDevices + projectedUnknown;
      return {
        id: client.id,
        code: snapshot?.code ?? client.code,
        name: snapshot?.name ?? client.name,
        isMaas: snapshot?.isMaas ?? client.isMaas,
        isActive: client.isActive,
        totalDevices,
        communicating: summary.communicating,
        delayed: summary.delayed,
        offline: summary.offline,
        inactive: summary.inactive,
        unknown: summary.unknown + projectedUnknown,
        reportOffline: summary.reportOffline,
        availabilityPercent: summary.availabilityPercent,
        collectionStatus: result?.status ?? null,
        collectionError: result?.error ?? null,
        apiKeyConfigured: credentialClientId !== null,
        apiKeyUpdatedAt,
      };
    });
    return reply.send({ run: run ? runReference(run) : null, data });
  });

  app.get('/business-clients/:businessClientId', {
    schema: { tags: ['Wattwatchers Clients'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { businessClientId } = request.params as { businessClientId: string };
    const graph = await loadBusinessClientGraph(businessClientId);
    if (!graph) throw notFound('Business client');
    const relatedDevices = await relatedDeviceRows(graph.devices);
    const devices = relatedDevices.filter(
      (device) => device.currentPlacement?.businessClient.id === businessClientId,
    );
    const jobsBySite = new Map<string, number>();
    const installationsBySite = new Map<string, number>();
    for (const job of graph.jobs) {
      if (job.siteId) jobsBySite.set(job.siteId, (jobsBySite.get(job.siteId) ?? 0) + 1);
    }
    for (const installation of graph.installations) {
      if (installation.siteId) {
        installationsBySite.set(
          installation.siteId,
          (installationsBySite.get(installation.siteId) ?? 0) + 1,
        );
      }
    }
    const sites = graph.sites.map((site) => {
      const siteDevices = devices.filter(
        (device) => device.currentPlacement?.site?.id === site.id,
      );
      return {
        id: site.id,
        clientId: site.clientId,
        name: site.name,
        address: site.address,
        locality: site.locality,
        state: site.state,
        postcode: site.postcode,
        countryCode: site.countryCode,
        timezone: site.timezone,
        contactName: site.contactName,
        contactPhone: site.contactPhone,
        contactEmail: site.contactEmail,
        accessInformation: site.accessInformation,
        updatedAt: site.updatedAt,
        jobCount: jobsBySite.get(site.id) ?? 0,
        installationCount: installationsBySite.get(site.id) ?? 0,
        status: summarizeDeviceStatuses(siteDevices),
      };
    });
    return reply.send({
      client: graph.client,
      summary: {
        ...summarizeDeviceStatuses(devices),
        siteCount: sites.length,
        jobCount: graph.jobs.length,
        installationCount: graph.installations.length,
      },
      sites,
      jobs: graph.jobs,
      installations: graph.installations,
      devices,
    });
  });

  app.get('/business-sites', {
    schema: {
      tags: ['Wattwatchers Sites'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 300 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as { q?: string; limit?: number };
    const q = query.q?.trim() ?? '';
    const limit = boundedInt(query.limit, 25, 1, 100);
    const data = await searchBusinessSites(q, limit);
    return reply.send({ data, meta: { query: q, limit } });
  });

  app.get('/business-sites/:businessSiteId', {
    schema: { tags: ['Wattwatchers Sites'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { businessSiteId } = request.params as { businessSiteId: string };
    const graph = await loadBusinessSiteGraph(businessSiteId);
    if (!graph) throw notFound('Business site');
    const relatedDevices = await relatedDeviceRows(graph.devices);
    const devices = relatedDevices.filter(
      (device) => device.currentPlacement?.site?.id === businessSiteId,
    );
    const site = graph.site;
    return reply.send({
      site: {
        id: site.id,
        clientId: site.clientId,
        name: site.name,
        address: site.address,
        locality: site.locality,
        state: site.state,
        postcode: site.postcode,
        countryCode: site.countryCode,
        timezone: site.timezone,
        contactName: site.contactName,
        contactPhone: site.contactPhone,
        contactEmail: site.contactEmail,
        accessInformation: site.accessInformation,
        updatedAt: site.updatedAt,
      },
      client: graph.client,
      summary: {
        ...summarizeDeviceStatuses(devices),
        jobCount: graph.jobs.length,
        installationCount: graph.installations.length,
      },
      jobs: graph.jobs,
      installations: graph.installations,
      devices,
    });
  });

  app.get('/runs', {
    schema: { tags: ['Wattwatchers Runs'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as { status?: string; limit?: string; offset?: string };
    const limit = boundedInt(query.limit, 50, 1, 200);
    const offset = boundedInt(query.offset, 0, 0, 1_000_000);
    const where = query.status ? eq(wwCollectionRuns.status, query.status) : undefined;
    const [rows, totals] = await Promise.all([
      db.select().from(wwCollectionRuns).where(where).orderBy(desc(wwCollectionRuns.startedAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(wwCollectionRuns).where(where),
    ]);
    return reply.send({ data: rows.map(mapRun), meta: { total: totals[0]?.count ?? 0, limit, offset } });
  });

  app.get('/runs/:runId', {
    schema: { tags: ['Wattwatchers Runs'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const [run] = await db.select().from(wwCollectionRuns).where(eq(wwCollectionRuns.id, runId));
    if (!run) throw notFound('Fleet collection run');
    const results = await db.select({ result: wwClientRunResults, client: wwClients })
      .from(wwClientRunResults).innerJoin(wwClients, eq(wwClientRunResults.clientId, wwClients.id))
      .where(eq(wwClientRunResults.runId, runId)).orderBy(asc(wwClients.name));
    return reply.send({
      run: mapRun(run),
      clients: results.map(({ result, client }) => ({
        id: result.id,
        clientId: client.id,
        clientCode: client.code,
        clientName: client.name,
        status: result.status,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        requestedDeviceCount: result.requestedDeviceCount,
        fetchedDeviceCount: result.fetchedDeviceCount,
        deviceCount: result.fetchedDeviceCount,
        requestCount: result.requestCount,
        retryCount: result.retryCount,
        rateLimitCount: result.rateLimitCount,
        errorCount: result.errorCount,
        error: result.error,
        metadata: result.metadata,
      })),
    });
  });

  app.get('/reports/:reportId.csv', {
    schema: { tags: ['Wattwatchers Reports'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const query = request.query as FleetFilters;
    const [report] = await db.select().from(wwReports).where(eq(wwReports.id, reportId));
    if (!report) throw notFound('Fleet report');
    const observations = await loadObservations([report.runId]);
    const attributions = await loadAttributions([report.runId]);
    const attributionMap = attributionsByObservation(attributions);
    const maas = parseBoolean(query.maas, 'maas');
    const header = [
      'Device Number', 'Client Name', 'MaaS', 'Connectivity Status', 'Report Offline',
      'Report Transition', 'Last Heard', 'Description', 'Model', 'Install Date', 'Firmware', 'Comms Type',
    ];
    const rows = filterObservations(observations, attributionMap, query)
      .filter((observation) => observation.reportOffline)
      .map((observation) => {
      const observationAttributions = attributionMap.get(observation.observationId) ?? [];
      const clientScopedAttributions = query.clientId
        ? observationAttributions.filter((entry) => entry.clientId === query.clientId)
        : observationAttributions;
      const scopedAttributions = maas === null
        ? clientScopedAttributions
        : clientScopedAttributions.filter((entry) => entry.isMaas === maas);
      const mapped = mapObservation(observation, scopedAttributions, query.clientId);
      const clientNames = [...new Set(scopedAttributions.map((entry) => entry.name))].join('; ');
      const belongsToMaas = scopedAttributions.some((entry) => entry.isMaas);
      return [
        mapped.deviceId, clientNames, belongsToMaas ? 'MaaS' : 'N/A', mapped.status,
        mapped.reportOffline ? 'Yes' : 'No', mapped.reportTransition,
        mapped.lastHeardAt?.toISOString(), mapped.label, mapped.model, mapped.installDate,
        mapped.firmwareVersion, mapped.commsType,
      ].map(csvCell).join(',');
      });
    const csv = `${header.map(csvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
    const filename = (report.csvFilename || `wattwatchers_fleet_${report.generatedAt.toISOString().slice(0, 10)}.csv`)
      .replace(/[^a-zA-Z0-9._-]+/g, '_');
    return reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      .type('text/csv; charset=utf-8').send(csv);
  });

  app.get('/reports', {
    schema: { tags: ['Wattwatchers Reports'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as FleetFilters & { limit?: string; offset?: string };
    const limit = boundedInt(query.limit, 50, 1, 200);
    const offset = boundedInt(query.offset, 0, 0, 1_000_000);
    const filters: FleetFilters = { clientId: query.clientId || undefined, maas: query.maas };
    const scopeCondition = reportScopeCondition(filters);
    const [rows, totals] = await Promise.all([
      db.select({ report: wwReports, run: wwCollectionRuns }).from(wwReports)
        .innerJoin(wwCollectionRuns, eq(wwReports.runId, wwCollectionRuns.id))
        .where(scopeCondition)
        .orderBy(desc(wwReports.generatedAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(wwReports).where(scopeCondition),
    ]);
    const runIds = rows.map(({ run }) => run.id);
    const [observations, attributions] = await Promise.all([
      loadObservations(runIds),
      loadAttributions(runIds),
    ]);
    const attributionMap = attributionsByObservation(attributions);
    const data = [];
    for (const { report, run } of rows) {
      const [latestDelivery] = await db.select().from(wwReportDeliveries)
        .where(eq(wwReportDeliveries.reportId, report.id))
        .orderBy(desc(wwReportDeliveries.attemptedAt)).limit(1);
      const scopedObservations = filterObservations(
        observations.filter((observation) => observation.runId === run.id),
        attributionMap,
        filters,
      );
      const scopedSummary = summaryFor(scopedObservations, attributionMap, filters);
      data.push({
        id: report.id,
        runId: run.id,
        reportingDate: run.reportingDate,
        status: report.status,
        subject: report.subject,
        generatedAt: report.generatedAt,
        latestDelivery: latestDelivery ? {
          channel: latestDelivery.channel,
          status: latestDelivery.status,
          attemptedAt: latestDelivery.attemptedAt,
          sentAt: latestDelivery.sentAt,
          error: latestDelivery.error,
          emailDelta: archivedEmailDelta(latestDelivery.metadata),
        } : null,
        databaseTransitions: {
          reportOffline: scopedSummary.reportOffline,
          newlyOffline: scopedSummary.reportNewlyOffline,
          recovered: scopedSummary.reportRecovered,
          stillOffline: scopedSummary.reportStillOffline,
        },
        summary: scopedSummary,
      });
    }
    return reply.send({
      data,
      meta: {
        total: totals[0]?.count ?? 0,
        limit,
        offset,
        filters: { clientId: filters.clientId ?? null, maas: parseBoolean(filters.maas, 'maas') },
      },
    });
  });

  app.get('/reports/:reportId', {
    schema: { tags: ['Wattwatchers Reports'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const [row] = await db.select({ report: wwReports, run: wwCollectionRuns }).from(wwReports)
      .innerJoin(wwCollectionRuns, eq(wwReports.runId, wwCollectionRuns.id))
      .where(eq(wwReports.id, reportId));
    if (!row) throw notFound('Fleet report');
    const deliveries = await db.select().from(wwReportDeliveries)
      .where(eq(wwReportDeliveries.reportId, reportId))
      .orderBy(desc(wwReportDeliveries.attemptedAt));
    return reply.send({
      report: {
        id: row.report.id,
        runId: row.run.id,
        reportingDate: row.run.reportingDate,
        status: row.report.status,
        subject: row.report.subject,
        generatedAt: row.report.generatedAt,
        renderedHtml: row.report.renderedHtml,
        csvFilename: row.report.csvFilename,
        summary: row.report.summary,
        databaseTransitions: {
          reportOffline: row.run.reportOfflineCount,
          newlyOffline: row.run.reportNewlyOfflineCount,
          recovered: row.run.reportRecoveredCount,
          stillOffline: row.run.reportStillOfflineCount,
        },
      },
      deliveries: deliveries.map((delivery) => ({
        channel: delivery.channel,
        status: delivery.status,
        attemptedAt: delivery.attemptedAt,
        sentAt: delivery.sentAt,
        error: delivery.error,
        emailDelta: archivedEmailDelta(delivery.metadata),
      })),
    });
  });

  app.get('/outages', {
    schema: { tags: ['Wattwatchers Devices'], security: [{ bearerAuth: [] }] },
    preHandler: readGuards,
  }, async (request, reply) => {
    const query = request.query as { state?: string; limit?: string; offset?: string };
    const limit = boundedInt(query.limit, 50, 1, 200);
    const offset = boundedInt(query.offset, 0, 0, 1_000_000);
    const rows = await db.select({ outage: wwOutages, device: wwDevices, client: wwClients })
      .from(wwOutages)
      .innerJoin(wwDevices, eq(wwOutages.deviceId, wwDevices.id))
      .leftJoin(wwClients, eq(wwOutages.clientId, wwClients.id))
      .orderBy(desc(wwOutages.firstDetectedAt));
    const filtered = rows.filter(({ outage }) => query.state === 'open'
      ? outage.closedRunId === null
      : query.state === 'recovered'
        ? outage.closedRunId !== null
        : true);
    return reply.send({
      data: filtered.slice(offset, offset + limit).map(({ outage, device, client }) => ({
        id: outage.id,
        deviceId: device.deviceId,
        label: device.label,
        client: client ? { id: client.id, code: client.code, name: client.name, isMaas: client.isMaas } : null,
        openedAt: outage.firstDetectedAt,
        lastConfirmedAt: outage.lastConfirmedAt,
        recoveredAt: outage.recoveredAt,
        durationSeconds: outage.durationSeconds,
        closeReason: outage.closeReason,
        open: outage.closedRunId === null,
      })),
      meta: { total: filtered.length, limit, offset },
    });
  });
}
