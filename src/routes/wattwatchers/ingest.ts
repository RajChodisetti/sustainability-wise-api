import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  wwClients,
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
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import {
  classifyFleetObservation,
  availabilityPercent,
  lastUsableReportOffline,
  parseOptionalDate,
  reportTransition,
  type FleetStatus,
} from './status.js';
import {
  absentClientIdsForPublishedInventory,
  clientCoverageIssue,
  collectionCanPublish,
  normalizeEmailDelta,
  outageAction,
  uniqueMemberships,
} from './ingestLogic.js';

type JsonObject = Record<string, unknown>;
type ClientInput = {
  clientCode?: unknown;
  code?: unknown;
  name?: unknown;
  isMaas?: unknown;
  metadata?: unknown;
};

const CLIENT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OBSERVATIONS_PER_BATCH = 250;
const OPERATIONAL_IDENTIFIER_KEYS = new Set([
  'imsi', 'simid', 'apn', 'networkid', 'mac', 'macaddress', 'ssid',
  'ip', 'ipaddress', 'gateway', 'subnet', 'psk',
]);

function requiredString(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw badRequest(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw badRequest(`${name} is too long`);
  return normalized;
}

function optionalString(value: unknown, maxLength = 2_000): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  return normalized.slice(0, maxLength) || null;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw badRequest('Count values must be non-negative integers');
  if (parsed > 2_147_483_647) throw badRequest('Count values exceed the supported range');
  return parsed;
}

function positiveInt(value: unknown, fallback: number, name: string): number {
  const parsed = nonNegativeInt(value, fallback);
  if (parsed < 1) throw badRequest(`${name} must be a positive integer`);
  return parsed;
}

function optionalFiniteNumber(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(`${name} must be a finite number`);
  return parsed;
}

function requiredDate(value: unknown, name: string): Date {
  const parsed = parseOptionalDate(value);
  if (!parsed) throw badRequest(`${name} must be a valid ISO timestamp`);
  return parsed;
}

function optionalValidDate(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredDate(value, name);
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'proto' || normalized === 'prototype' || normalized === 'constructor') return true;
  return OPERATIONAL_IDENTIFIER_KEYS.has(normalized)
    || normalized === 'authorization'
    || normalized.includes('apikey')
    || normalized.includes('password')
    || normalized.includes('secret')
    || normalized === 'token'
    || normalized.endsWith('accesstoken')
    || normalized.endsWith('refreshtoken');
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 10_000).map((entry) => sanitizeJson(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    if (isSensitiveKey(key)) continue;
    output[key] = sanitizeJson(entry, depth + 1);
  }
  return output;
}

function normalizeClientCode(value: unknown): string {
  const code = requiredString(value, 'clientCode', 80).toLowerCase();
  if (!CLIENT_CODE_PATTERN.test(code)) {
    throw badRequest('clientCode must use letters, numbers, dots, underscores, or hyphens');
  }
  return code;
}

function normalizeClientName(value: unknown): string {
  return requiredString(value, 'client name', 200);
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function installDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '' || value === 'Unknown') return null;
  const date = String(value).slice(0, 10);
  return DATE_PATTERN.test(date) ? date : null;
}

async function upsertClient(tx: typeof db, input: ClientInput) {
  const code = normalizeClientCode(input.clientCode ?? input.code);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'wattwatchers-client:' + code}))`);
  const name = normalizeClientName(input.name ?? code);
  const now = new Date();
  const metadata = sanitizeJson(jsonObject(input.metadata)) as JsonObject;
  const [existing] = await tx.select().from(wwClients).where(eq(wwClients.code, code));
  if (existing) {
    const [updated] = await tx.update(wwClients).set({
      name,
      normalizedName: normalizedName(name),
      isMaas: Boolean(input.isMaas),
      isActive: true,
      metadata,
      lastSeenAt: now,
      updatedAt: now,
    }).where(eq(wwClients.id, existing.id)).returning();
    return updated;
  }
  const [created] = await tx.insert(wwClients).values({
    id: randomUUID(),
    code,
    name,
    normalizedName: normalizedName(name),
    isMaas: Boolean(input.isMaas),
    metadata,
    firstSeenAt: now,
    lastSeenAt: now,
  }).returning();
  return created;
}

async function mutableRun(tx: typeof db, runId: string) {
  const [run] = await tx.select().from(wwCollectionRuns).where(eq(wwCollectionRuns.id, runId));
  if (!run) throw notFound('Fleet collection run');
  if (run.status !== 'collecting') throw conflict(`Fleet collection run is already ${run.status}`);
  return run;
}

async function lockRun(tx: typeof db, runId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'wattwatchers-run:' + runId}))`);
}

function runResponse(run: typeof wwCollectionRuns.$inferSelect) {
  return {
    id: run.id,
    sourceRunKey: run.sourceRunKey,
    reportingDate: run.reportingDate,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    publishedAt: run.publishedAt,
    delayedThresholdMinutes: run.delayedThresholdMinutes,
    offlineThresholdMinutes: run.offlineThresholdMinutes,
    reportOfflineThresholdHours: run.reportOfflineThresholdHours,
    inventoryScope: run.inventoryScope,
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
    reportStillOffline: run.reportStillOfflineCount,
    maasTotal: run.maasTotalCount,
    maasReportOffline: run.maasReportOfflineCount,
    clientCount: run.configuredClientCount,
    availabilityPercent: availabilityPercent({
      communicating: run.communicatingCount,
      delayed: run.delayedCount,
      offline: run.offlineCount,
    }),
  };
}

async function insertMissingKnownDevicesAsUnknown(
  tx: typeof db,
  run: typeof wwCollectionRuns.$inferSelect,
  clientIds: string[],
  observedAt: Date,
): Promise<void> {
  if (clientIds.length === 0) return;
  const memberships = await tx.select({
    device: wwDevices,
    membershipClientId: wwDeviceClients.clientId,
    clientCode: wwClients.code,
    clientName: wwClients.name,
    clientIsMaas: wwClients.isMaas,
  }).from(wwDeviceClients)
    .innerJoin(wwDevices, eq(wwDeviceClients.deviceId, wwDevices.id))
    .innerJoin(wwClients, eq(wwDeviceClients.clientId, wwClients.id))
    .where(and(inArray(wwDeviceClients.clientId, clientIds), eq(wwDeviceClients.isCurrent, true)));

  const existing = await tx.select({
    id: wwDeviceObservations.id,
    deviceId: wwDeviceObservations.deviceId,
    isMaas: wwDeviceObservations.isMaas,
  })
    .from(wwDeviceObservations)
    .where(eq(wwDeviceObservations.runId, run.id));
  const existingByDevice = new Map(existing.map((row) => [row.deviceId, row]));
  const byDevice = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const list = byDevice.get(membership.device.id) ?? [];
    list.push(membership);
    byDevice.set(membership.device.id, list);
  }

  for (const [deviceId, deviceMemberships] of byDevice) {
    const existingObservation = existingByDevice.get(deviceId);
    if (existingObservation) {
      const savedAttributions = await tx.select({ clientId: wwObservationClients.clientId })
        .from(wwObservationClients)
        .where(eq(wwObservationClients.observationId, existingObservation.id));
      const savedClientIds = new Set(savedAttributions.map((row) => row.clientId));
      const missingAttributions = deviceMemberships.filter((entry) => !savedClientIds.has(entry.membershipClientId));
      if (missingAttributions.length > 0) {
        await tx.insert(wwObservationClients).values(missingAttributions.map((entry) => ({
          id: randomUUID(),
          observationId: existingObservation.id,
          runId: run.id,
          deviceId,
          clientId: entry.membershipClientId,
          clientCodeSnapshot: entry.clientCode,
          clientNameSnapshot: entry.clientName,
          isMaas: entry.clientIsMaas,
        })));
      }
      if (!existingObservation.isMaas && deviceMemberships.some((entry) => entry.clientIsMaas)) {
        await tx.update(wwDeviceObservations).set({ isMaas: true, updatedAt: new Date() })
          .where(eq(wwDeviceObservations.id, existingObservation.id));
      }
      continue;
    }
    const device = deviceMemberships[0].device;
    const observationId = randomUUID();
    await tx.insert(wwDeviceObservations).values({
      id: observationId,
      runId: run.id,
      deviceId,
      clientId: device.primaryClientId ?? deviceMemberships[0].membershipClientId,
      observedAt,
      status: 'unknown',
      fetchStatus: 'missing',
      fetchError: 'Device was not returned in this collection run',
      isMaas: deviceMemberships.some((entry) => entry.clientIsMaas),
      labelSnapshot: device.label,
      modelSnapshot: device.model,
      installDateSnapshot: device.installDate,
      firmwareVersion: device.firmwareVersion,
      deviceTimezone: device.deviceTimezone,
    });
    await tx.insert(wwObservationClients).values(deviceMemberships.map((entry) => ({
      id: randomUUID(),
      observationId,
      runId: run.id,
      deviceId,
      clientId: entry.membershipClientId,
      clientCodeSnapshot: entry.clientCode,
      clientNameSnapshot: entry.clientName,
      isMaas: entry.clientIsMaas,
    })));
  }
}

type ObservationRow = typeof wwDeviceObservations.$inferSelect;

function countObservations(observations: ObservationRow[]) {
  const count = (status: FleetStatus) => observations.filter((row) => row.status === status).length;
  return {
    totalDevices: observations.length,
    communicating: count('communicating'),
    delayed: count('delayed'),
    offline: count('offline'),
    inactive: count('inactive'),
    unknown: count('unknown'),
    reportOffline: observations.filter((row) => row.reportOffline).length,
    reportNewlyOffline: observations.filter((row) => row.reportTransition === 'newly_offline').length,
    reportRecovered: observations.filter((row) => row.reportTransition === 'recovered').length,
    reportStillOffline: observations.filter((row) => row.reportTransition === 'still_offline').length,
    maasTotal: observations.filter((row) => row.isMaas).length,
    maasReportOffline: observations.filter((row) => row.isMaas && row.reportOffline).length,
  };
}

async function applyPublishedTransitions(
  tx: typeof db,
  run: typeof wwCollectionRuns.$inferSelect,
  observations: ObservationRow[],
): Promise<ObservationRow[]> {
  const previous = await tx.selectDistinctOn([wwDeviceObservations.deviceId], {
    deviceId: wwDeviceObservations.deviceId,
    reportOffline: wwDeviceObservations.reportOffline,
    status: wwDeviceObservations.status,
  }).from(wwDeviceObservations)
    .innerJoin(wwCollectionRuns, eq(wwDeviceObservations.runId, wwCollectionRuns.id))
    .where(and(
      eq(wwCollectionRuns.status, 'published'),
      inArray(wwDeviceObservations.status, ['communicating', 'delayed', 'offline']),
    ))
    .orderBy(wwDeviceObservations.deviceId, desc(wwCollectionRuns.publishedAt));
  const previousByDevice = new Map(previous.map((row) => [row.deviceId, row]));
  const openOutages = await tx.select().from(wwOutages).where(isNull(wwOutages.closedRunId));
  const outageByDevice = new Map(openOutages.map((row) => [row.deviceId, row]));

  const updatedRows: ObservationRow[] = [];
  for (const observation of observations) {
    const previousObservation = previousByDevice.get(observation.deviceId);
    const transition = reportTransition(
      previousObservation
        ? lastUsableReportOffline([{
            status: previousObservation.status as FleetStatus,
            reportOffline: previousObservation.reportOffline,
          }])
        : null,
      observation.reportOffline,
      observation.status as FleetStatus,
    );
    const [updated] = await tx.update(wwDeviceObservations)
      .set({ reportTransition: transition, updatedAt: new Date() })
      .where(eq(wwDeviceObservations.id, observation.id))
      .returning();
    updatedRows.push(updated);

    const outage = outageByDevice.get(observation.deviceId);
    const action = outageAction({
      status: observation.status,
      hasOpenOutage: Boolean(outage),
      openTelemetryStoppedAt: outage?.telemetryStoppedAt ?? null,
      currentLastHeardAt: observation.lastHeardAt,
    });
    if (action === 'extend' && outage) {
      await tx.update(wwOutages).set({
        lastConfirmedAt: observation.observedAt,
        updatedAt: new Date(),
      }).where(eq(wwOutages.id, outage.id));
    } else if (action === 'open' || action === 'rollover') {
      if (action === 'rollover' && outage && observation.lastHeardAt) {
        const oldDurationStart = outage.telemetryStoppedAt ?? outage.firstDetectedAt;
        const oldDurationSeconds = Math.max(
          0,
          Math.floor((observation.lastHeardAt.getTime() - oldDurationStart.getTime()) / 1_000),
        );
        await tx.update(wwOutages).set({
          closedRunId: run.id,
          recoveredAt: observation.lastHeardAt,
          durationSeconds: oldDurationSeconds,
          closeReason: 'heartbeat_advanced',
          updatedAt: new Date(),
        }).where(eq(wwOutages.id, outage.id));
      }
      const thresholdQualifiedAt = observation.lastHeardAt
        ? new Date(observation.lastHeardAt.getTime() + run.offlineThresholdMinutes * 60_000)
        : null;
      const [created] = await tx.insert(wwOutages).values({
        id: randomUUID(),
        deviceId: observation.deviceId,
        clientId: observation.clientId,
        openedRunId: run.id,
        telemetryStoppedAt: observation.lastHeardAt,
        thresholdQualifiedAt,
        firstDetectedAt: observation.observedAt,
        lastConfirmedAt: observation.observedAt,
      }).returning();
      outageByDevice.set(observation.deviceId, created);
    } else if (action === 'close' && outage) {
      const durationStart = outage.telemetryStoppedAt ?? outage.firstDetectedAt;
      const durationSeconds = Math.max(
        0,
        Math.floor((observation.observedAt.getTime() - durationStart.getTime()) / 1_000),
      );
      await tx.update(wwOutages).set({
        closedRunId: run.id,
        recoveredAt: observation.observedAt,
        durationSeconds,
        closeReason: 'recovered',
        updatedAt: new Date(),
      }).where(eq(wwOutages.id, outage.id));
      outageByDevice.delete(observation.deviceId);
    }
  }
  return updatedRows;
}

async function updateClientCounts(
  tx: typeof db,
  runId: string,
  observations: ObservationRow[],
): Promise<void> {
  const attributions = await tx.select().from(wwObservationClients)
    .where(eq(wwObservationClients.runId, runId));
  const observationsById = new Map(observations.map((row) => [row.id, row]));
  const byClient = new Map<string, Map<string, ObservationRow>>();
  for (const attribution of attributions) {
    const observation = observationsById.get(attribution.observationId);
    if (!observation) continue;
    const clientDevices = byClient.get(attribution.clientId) ?? new Map<string, ObservationRow>();
    clientDevices.set(observation.deviceId, observation);
    byClient.set(attribution.clientId, clientDevices);
  }
  const results = await tx.select().from(wwClientRunResults).where(eq(wwClientRunResults.runId, runId));
  for (const result of results) {
    const counts = countObservations([...((byClient.get(result.clientId) ?? new Map()).values())]);
    await tx.update(wwClientRunResults).set({
      communicatingCount: counts.communicating,
      delayedCount: counts.delayed,
      offlineCount: counts.offline,
      inactiveCount: counts.inactive,
      unknownCount: counts.unknown,
      reportOfflineCount: counts.reportOffline,
      updatedAt: new Date(),
    }).where(eq(wwClientRunResults.id, result.id));
  }
}

async function deactivateAbsentMembershipsAfterPublishedRun(
  tx: typeof db,
  runId: string,
  clientIds: string[],
): Promise<void> {
  const attributions = await tx.select({
    clientId: wwObservationClients.clientId,
    deviceId: wwObservationClients.deviceId,
  }).from(wwObservationClients).where(eq(wwObservationClients.runId, runId));
  for (const clientId of clientIds) {
    const observedDeviceIds = [...new Set(
      attributions.filter((row) => row.clientId === clientId).map((row) => row.deviceId),
    )];
    const condition = observedDeviceIds.length > 0
      ? and(
          eq(wwDeviceClients.clientId, clientId),
          eq(wwDeviceClients.isCurrent, true),
          notInArray(wwDeviceClients.deviceId, observedDeviceIds),
        )
      : and(eq(wwDeviceClients.clientId, clientId), eq(wwDeviceClients.isCurrent, true));
    await tx.update(wwDeviceClients).set({ isCurrent: false }).where(condition);
  }
}

async function deactivateClientsAbsentFromPublishedFullInventory(
  tx: typeof db,
  configuredClientIds: string[],
): Promise<string[]> {
  const activeClients = await tx.select({ id: wwClients.id }).from(wwClients)
    .where(eq(wwClients.isActive, true));
  const absentClientIds = absentClientIdsForPublishedInventory({
    activeClientIds: activeClients.map((client) => client.id),
    configuredClientIds,
    publish: true,
    inventoryScope: 'full',
  });
  if (absentClientIds.length === 0) return [];
  const now = new Date();
  await tx.update(wwClients).set({ isActive: false, updatedAt: now })
    .where(inArray(wwClients.id, absentClientIds));
  await tx.update(wwDeviceClients).set({ isCurrent: false })
    .where(and(
      inArray(wwDeviceClients.clientId, absentClientIds),
      eq(wwDeviceClients.isCurrent, true),
    ));
  return absentClientIds;
}

async function closeOutagesWithoutCurrentMembership(
  tx: typeof db,
  runId: string,
  closedAt: Date,
): Promise<void> {
  const retiredOutages = await tx.select().from(wwOutages).where(and(
    isNull(wwOutages.closedRunId),
    sql`not exists (
      select 1 from ww_device_clients current_membership
      where current_membership.device_id = ${wwOutages.deviceId}
        and current_membership.is_current = true
    )`,
  ));
  for (const outage of retiredOutages) {
    const durationStart = outage.telemetryStoppedAt ?? outage.firstDetectedAt;
    const durationSeconds = Math.max(
      0,
      Math.floor((closedAt.getTime() - durationStart.getTime()) / 1_000),
    );
    await tx.update(wwOutages).set({
      closedRunId: runId,
      recoveredAt: null,
      durationSeconds,
      closeReason: 'inventory_removed',
      updatedAt: new Date(),
    }).where(eq(wwOutages.id, outage.id));
  }
}

export async function wattwatchersIngestRoutes(app: FastifyInstance): Promise<void> {
  const ingestGuards = [authenticate, requireApp('wattwatchers'), requireRole('service_account')];

  app.post('/runs', {
    schema: {
      tags: ['Wattwatchers Ingest'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['sourceRunKey', 'reportingDate', 'clients'], additionalProperties: false,
        properties: {
          sourceRunKey: { type: 'string', minLength: 1, maxLength: 200 },
          collectorVersion: { type: 'string', maxLength: 100 },
          trigger: { type: 'string', enum: ['scheduled', 'manual', 'retry'] },
          scheduledFor: { type: 'string' },
          reportingDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          timezone: { type: 'string', maxLength: 100 },
          delayedThresholdMinutes: { type: 'integer', minimum: 1 },
          offlineThresholdMinutes: { type: 'integer', minimum: 1 },
          reportOfflineThresholdHours: { type: 'integer', minimum: 1 },
          inventoryScope: { type: 'string', enum: ['full', 'partial'] },
          clients: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: true } },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
    preHandler: ingestGuards,
  }, async (request, reply) => {
    const body = request.body as JsonObject;
    const sourceRunKey = requiredString(body.sourceRunKey, 'sourceRunKey', 200);
    if (!DATE_PATTERN.test(String(body.reportingDate))) throw badRequest('reportingDate must be YYYY-MM-DD');
    const parsedReportingDate = new Date(`${String(body.reportingDate)}T00:00:00.000Z`);
    if (Number.isNaN(parsedReportingDate.getTime())
      || parsedReportingDate.toISOString().slice(0, 10) !== String(body.reportingDate)) {
      throw badRequest('reportingDate must be a real calendar date');
    }
    const clients = body.clients as ClientInput[];
    const timezone = optionalString(body.timezone, 100) ?? 'Australia/Melbourne';
    try {
      new Intl.DateTimeFormat('en-AU', { timeZone: timezone }).format(new Date());
    } catch {
      throw badRequest('timezone must be a valid IANA timezone');
    }
    const delayedThresholdMinutes = positiveInt(body.delayedThresholdMinutes, 15, 'delayedThresholdMinutes');
    const offlineThresholdMinutes = positiveInt(body.offlineThresholdMinutes, 60, 'offlineThresholdMinutes');
    const reportOfflineThresholdHours = positiveInt(body.reportOfflineThresholdHours, 24, 'reportOfflineThresholdHours');
    const inventoryScope = optionalString(body.inventoryScope, 20) ?? 'partial';
    if (!['full', 'partial'].includes(inventoryScope)) {
      throw badRequest('inventoryScope must be full or partial');
    }
    if (delayedThresholdMinutes >= offlineThresholdMinutes) {
      throw badRequest('delayedThresholdMinutes must be lower than offlineThresholdMinutes');
    }
    if (reportOfflineThresholdHours * 60 < offlineThresholdMinutes) {
      throw badRequest('reportOfflineThresholdHours must not be shorter than the offline threshold');
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'wattwatchers-source:' + sourceRunKey}))`);
      const [existing] = await tx.select().from(wwCollectionRuns)
        .where(eq(wwCollectionRuns.sourceRunKey, sourceRunKey));
      if (existing) return { run: existing, resumed: true };

      const now = new Date();
      const [run] = await tx.insert(wwCollectionRuns).values({
        id: randomUUID(),
        sourceRunKey,
        collectorVersion: optionalString(body.collectorVersion, 100),
        trigger: optionalString(body.trigger, 30) ?? 'scheduled',
        reportingDate: String(body.reportingDate),
        timezone,
        delayedThresholdMinutes,
        offlineThresholdMinutes,
        reportOfflineThresholdHours,
        inventoryScope,
        scheduledFor: optionalValidDate(body.scheduledFor, 'scheduledFor'),
        startedAt: now,
        configuredClientCount: clients.length,
        metadata: sanitizeJson(jsonObject(body.metadata)) as JsonObject,
      }).returning();

      const seenCodes = new Set<string>();
      for (const clientInput of clients) {
        const client = await upsertClient(tx as unknown as typeof db, clientInput);
        if (seenCodes.has(client.code)) throw badRequest(`Duplicate clientCode: ${client.code}`);
        seenCodes.add(client.code);
        await tx.insert(wwClientRunResults).values({
          id: randomUUID(), runId: run.id, clientId: client.id, status: 'pending',
        });
      }
      return { run, resumed: false };
    });

    return reply.status(result.resumed ? 200 : 201).send({
      id: result.run.id,
      status: result.run.status,
      resumed: result.resumed,
    });
  });

  app.put('/runs/:runId/clients/:clientCode', {
    schema: {
      tags: ['Wattwatchers Ingest'], security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['status'], additionalProperties: true },
    },
    preHandler: ingestGuards,
  }, async (request, reply) => {
    const { runId, clientCode: rawClientCode } = request.params as { runId: string; clientCode: string };
    const body = request.body as JsonObject;
    const clientCode = normalizeClientCode(rawClientCode);
    if (!['success', 'partial', 'failed'].includes(String(body.status))) {
      throw badRequest('status must be success, partial, or failed');
    }
    const result = await db.transaction(async (tx) => {
      await lockRun(tx as unknown as typeof db, runId);
      await mutableRun(tx as unknown as typeof db, runId);
      const [client] = await tx.select().from(wwClients).where(eq(wwClients.code, clientCode));
      if (!client) throw notFound('Fleet client');
      if (body.name !== undefined || body.isMaas !== undefined) {
        await tx.update(wwClients).set({
          name: body.name === undefined ? client.name : normalizeClientName(body.name),
          normalizedName: body.name === undefined ? client.normalizedName : normalizedName(normalizeClientName(body.name)),
          isMaas: body.isMaas === undefined ? client.isMaas : Boolean(body.isMaas),
          lastSeenAt: new Date(), updatedAt: new Date(),
        }).where(eq(wwClients.id, client.id));
      }
      const [existingResult] = await tx.select().from(wwClientRunResults)
        .where(and(eq(wwClientRunResults.runId, runId), eq(wwClientRunResults.clientId, client.id)));
      if (!existingResult) throw badRequest('Client was not configured for this run');
      const [updated] = await tx.update(wwClientRunResults).set({
        status: String(body.status),
        startedAt: optionalValidDate(body.startedAt, 'startedAt'),
        finishedAt: optionalValidDate(body.finishedAt, 'finishedAt'),
        requestedDeviceCount: nonNegativeInt(body.requestedDeviceCount),
        fetchedDeviceCount: nonNegativeInt(body.fetchedDeviceCount),
        requestCount: nonNegativeInt(body.requestCount),
        retryCount: nonNegativeInt(body.retryCount),
        rateLimitCount: nonNegativeInt(body.rateLimitCount),
        errorCount: nonNegativeInt(body.errorCount),
        error: optionalString(body.error, 4_000),
        metadata: sanitizeJson(jsonObject(body.metadata)) as JsonObject,
        updatedAt: new Date(),
      }).where(eq(wwClientRunResults.id, existingResult.id)).returning();
      return updated;
    });
    return reply.send(result);
  });

  app.post('/runs/:runId/observations/batch', {
    bodyLimit: 8 * 1024 * 1024,
    schema: {
      tags: ['Wattwatchers Ingest'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['observations'], additionalProperties: false,
        properties: {
          observations: {
            type: 'array', minItems: 1, maxItems: MAX_OBSERVATIONS_PER_BATCH,
            items: {
              type: 'object', required: ['deviceId', 'clientCode'], additionalProperties: true,
            },
          },
        },
      },
    },
    preHandler: ingestGuards,
  }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { observations: JsonObject[] };
    if (body.observations.length > MAX_OBSERVATIONS_PER_BATCH) throw badRequest('Maximum batch size is 250');

    await db.transaction(async (tx) => {
      await lockRun(tx as unknown as typeof db, runId);
      const run = await mutableRun(tx as unknown as typeof db, runId);
      const configuredResults = await tx.select({ clientId: wwClientRunResults.clientId })
        .from(wwClientRunResults).where(eq(wwClientRunResults.runId, runId));
      const configuredClientIds = new Set(configuredResults.map((row) => row.clientId));

      for (const input of body.observations) {
        const externalDeviceId = requiredString(input.deviceId, 'deviceId', 200);
        const primaryCode = normalizeClientCode(input.clientCode);
        const rawMemberships = Array.isArray(input.clientMemberships)
          ? input.clientMemberships as ClientInput[]
          : [{ clientCode: primaryCode, name: input.clientName ?? primaryCode, isMaas: input.isMaas }];
        if (!rawMemberships.some((entry) => normalizeClientCode(entry.clientCode ?? entry.code) === primaryCode)) {
          rawMemberships.unshift({ clientCode: primaryCode, name: input.clientName ?? primaryCode, isMaas: input.isMaas });
        }

        const membershipClients = [];
        for (const membership of uniqueMemberships(
          rawMemberships,
          (entry) => normalizeClientCode(entry.clientCode ?? entry.code),
        )) {
          const code = normalizeClientCode(membership.clientCode ?? membership.code);
          let [client] = await tx.select().from(wwClients).where(eq(wwClients.code, code));
          if (!client) client = await upsertClient(tx as unknown as typeof db, membership);
          if (!configuredClientIds.has(client.id)) throw badRequest(`Client ${code} was not configured for this run`);
          membershipClients.push(client);
        }
        const primaryClient = membershipClients.find((client) => client.code === primaryCode);
        if (!primaryClient) throw badRequest(`Primary client ${primaryCode} is missing`);

        const observedAt = input.observedAt === undefined ? new Date() : requiredDate(input.observedAt, 'observedAt');
        const lastHeardAt = optionalValidDate(input.lastHeardAt, 'lastHeardAt');
        const latestStatusAt = optionalValidDate(input.latestStatusAt, 'latestStatusAt');
        const fetchStatus = optionalString(input.fetchStatus, 20) ?? 'ok';
        if (!['ok', 'missing', 'error'].includes(fetchStatus)) throw badRequest('fetchStatus must be ok, missing, or error');
        const classification = classifyFleetObservation({
          fetchStatus,
          uninitialised: Boolean(input.uninitialised),
          observedAt,
          lastHeardAt,
          thresholds: run,
        });
        const label = optionalString(input.label, 500);
        const model = optionalString(input.model, 200);
        const normalizedInstallDate = installDate(input.installDate);
        const firmwareVersion = optionalString(input.firmwareVersion, 200);
        const deviceTimezone = optionalString(input.timezone ?? input.deviceTimezone, 100);
        const now = new Date();
        let [device] = await tx.select().from(wwDevices).where(eq(wwDevices.deviceId, externalDeviceId));
        if (device) {
          [device] = await tx.update(wwDevices).set({
            label: label ?? device.label,
            model: model ?? device.model,
            installDate: normalizedInstallDate ?? device.installDate,
            firmwareVersion: firmwareVersion ?? device.firmwareVersion,
            deviceTimezone: deviceTimezone ?? device.deviceTimezone,
            primaryClientId: primaryClient.id,
            lastDiscoveredAt: observedAt,
            updatedAt: now,
          }).where(eq(wwDevices.id, device.id)).returning();
        } else {
          [device] = await tx.insert(wwDevices).values({
            id: randomUUID(), deviceId: externalDeviceId, label, model,
            installDate: normalizedInstallDate, firmwareVersion, deviceTimezone,
            primaryClientId: primaryClient.id, firstSeenAt: observedAt, lastDiscoveredAt: observedAt,
          }).returning();
        }

        for (const client of membershipClients) {
          const [membership] = await tx.select().from(wwDeviceClients).where(and(
            eq(wwDeviceClients.deviceId, device.id), eq(wwDeviceClients.clientId, client.id),
          ));
          if (membership) {
            await tx.update(wwDeviceClients).set({ isCurrent: true, lastSeenAt: observedAt })
              .where(eq(wwDeviceClients.id, membership.id));
          } else {
            await tx.insert(wwDeviceClients).values({
              id: randomUUID(), deviceId: device.id, clientId: client.id,
              firstSeenAt: observedAt, lastSeenAt: observedAt,
            });
          }
        }

        let [observation] = await tx.select().from(wwDeviceObservations).where(and(
          eq(wwDeviceObservations.runId, runId), eq(wwDeviceObservations.deviceId, device.id),
        ));
        const observationValues = {
          clientId: primaryClient.id,
          observedAt,
          lastHeardAt,
          latestStatusAt,
          communicationAgeSeconds: classification.communicationAgeSeconds,
          status: classification.status,
          reportOffline: classification.reportOffline,
          reportTransition: null,
          fetchStatus,
          fetchError: optionalString(input.fetchError, 4_000),
          uninitialised: Boolean(input.uninitialised),
          isMaas: membershipClients.some((client) => client.isMaas),
          labelSnapshot: label,
          modelSnapshot: model,
          installDateSnapshot: normalizedInstallDate,
          firmwareVersion,
          deviceTimezone,
          commsType: optionalString(input.commsType, 100),
          commsMode: optionalString(input.commsMode, 100),
          lastHeardVia: optionalString(input.lastHeardVia, 100),
          signalQualityDbm: optionalFiniteNumber(input.signalQualityDbm, 'signalQualityDbm'),
          cellQuality: optionalFiniteNumber(input.cellQuality, 'cellQuality'),
          metrics: sanitizeJson(jsonObject(input.metrics)) as JsonObject,
          rawStatus: sanitizeJson(jsonObject(input.rawStatus)) as JsonObject,
          updatedAt: now,
        };
        if (observation) {
          [observation] = await tx.update(wwDeviceObservations).set(observationValues)
            .where(eq(wwDeviceObservations.id, observation.id)).returning();
          await tx.delete(wwObservationClients).where(eq(wwObservationClients.observationId, observation.id));
        } else {
          [observation] = await tx.insert(wwDeviceObservations).values({
            id: randomUUID(), runId, deviceId: device.id, ...observationValues,
          }).returning();
        }
        await tx.insert(wwObservationClients).values(membershipClients.map((client) => ({
          id: randomUUID(), observationId: observation.id, runId, deviceId: device.id,
          clientId: client.id, clientCodeSnapshot: client.code, clientNameSnapshot: client.name,
          isMaas: client.isMaas,
        })));
      }
    });

    return reply.send({ accepted: body.observations.length });
  });

  app.post('/runs/:runId/finalize', {
    schema: { tags: ['Wattwatchers Ingest'], security: [{ bearerAuth: [] }] },
    preHandler: ingestGuards,
  }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = jsonObject(request.body);
    const finalized = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wattwatchers-fleet-finalize'))`);
      await lockRun(tx as unknown as typeof db, runId);
      const [existingRun] = await tx.select().from(wwCollectionRuns).where(eq(wwCollectionRuns.id, runId));
      if (!existingRun) throw notFound('Fleet collection run');
      if (existingRun.status !== 'collecting') return existingRun;
      const finishedAt = optionalValidDate(body.finishedAt, 'finishedAt') ?? new Date();
      let clientResults = await tx.select().from(wwClientRunResults)
        .where(eq(wwClientRunResults.runId, runId));
      if (clientResults.length === 0) throw badRequest('Run has no configured clients');
      const coverageRows = await tx.select({
        clientId: wwObservationClients.clientId,
        attributedDeviceCount: sql<number>`count(distinct ${wwObservationClients.deviceId})::int`,
        observedFetchedDeviceCount: sql<number>`count(distinct case when ${wwDeviceObservations.fetchStatus} = 'ok' then ${wwObservationClients.deviceId} end)::int`,
        observedNonOkDeviceCount: sql<number>`count(distinct case when ${wwDeviceObservations.fetchStatus} <> 'ok' then ${wwObservationClients.deviceId} end)::int`,
      }).from(wwObservationClients)
        .innerJoin(wwDeviceObservations, eq(wwObservationClients.observationId, wwDeviceObservations.id))
        .where(eq(wwObservationClients.runId, runId))
        .groupBy(wwObservationClients.clientId);
      const coverageByClient = new Map(coverageRows.map((row) => [row.clientId, row]));
      const configuredClients = await tx.select({ id: wwClients.id, code: wwClients.code })
        .from(wwClients)
        .where(inArray(wwClients.id, clientResults.map((result) => result.clientId)));
      const clientCodeById = new Map(configuredClients.map((client) => [client.id, client.code]));
      const coverageDiagnostics: string[] = [];
      for (let index = 0; index < clientResults.length; index += 1) {
        const result = clientResults[index];
        const coverage = coverageByClient.get(result.clientId);
        const issue = clientCoverageIssue({
          status: result.status,
          requestedDeviceCount: result.requestedDeviceCount,
          fetchedDeviceCount: result.fetchedDeviceCount,
          attributedDeviceCount: coverage?.attributedDeviceCount ?? 0,
          observedFetchedDeviceCount: coverage?.observedFetchedDeviceCount ?? 0,
          observedNonOkDeviceCount: coverage?.observedNonOkDeviceCount ?? 0,
        });
        if (!issue) continue;
        const diagnostic = `Client ${clientCodeById.get(result.clientId) ?? result.clientId}: ${issue}`;
        coverageDiagnostics.push(diagnostic);
        const [updatedResult] = await tx.update(wwClientRunResults).set({
          status: 'partial',
          error: [result.error, issue].filter(Boolean).join('; ').slice(0, 4_000),
          metadata: {
            ...result.metadata,
            coverage: {
              requestedDeviceCount: result.requestedDeviceCount,
              fetchedDeviceCount: result.fetchedDeviceCount,
              attributedDeviceCount: coverage?.attributedDeviceCount ?? 0,
              observedFetchedDeviceCount: coverage?.observedFetchedDeviceCount ?? 0,
              observedNonOkDeviceCount: coverage?.observedNonOkDeviceCount ?? 0,
              valid: false,
            },
          },
          updatedAt: new Date(),
        }).where(eq(wwClientRunResults.id, result.id)).returning();
        clientResults[index] = updatedResult;
      }
      const clientIds = clientResults.map((row) => row.clientId);
      const unsuccessfulClientIds = clientResults
        .filter((row) => row.status !== 'success')
        .map((row) => row.clientId);
      // Missing devices from an unsuccessful inventory are unknown, never
      // recovered. A fully successful inventory instead ends stale current
      // memberships after the run is published.
      await insertMissingKnownDevicesAsUnknown(
        tx as unknown as typeof db,
        existingRun,
        unsuccessfulClientIds,
        finishedAt,
      );

      let observations = await tx.select().from(wwDeviceObservations)
        .where(eq(wwDeviceObservations.runId, runId));
      const successfulClientCount = clientResults.filter((row) => row.status === 'success').length;
      const failedClientCount = clientResults.length - successfulClientCount;
      const publish = collectionCanPublish(
        clientResults.map((row) => row.status),
        existingRun.configuredClientCount,
      );
      if (publish) {
        observations = await applyPublishedTransitions(tx as unknown as typeof db, existingRun, observations);
        await deactivateAbsentMembershipsAfterPublishedRun(
          tx as unknown as typeof db,
          runId,
          clientIds,
        );
        if (existingRun.inventoryScope === 'full') {
          await deactivateClientsAbsentFromPublishedFullInventory(
            tx as unknown as typeof db,
            clientIds,
          );
        }
        await closeOutagesWithoutCurrentMembership(
          tx as unknown as typeof db,
          runId,
          finishedAt,
        );
      }
      const counts = countObservations(observations);
      await updateClientCounts(tx as unknown as typeof db, runId, observations);

      const [updated] = await tx.update(wwCollectionRuns).set({
        status: publish ? 'published' : 'partial',
        finishedAt,
        publishedAt: publish ? finishedAt : null,
        successfulClientCount,
        failedClientCount,
        rawDeviceCount: nonNegativeInt(body.rawDeviceCount, observations.length),
        totalDevices: counts.totalDevices,
        communicatingCount: counts.communicating,
        delayedCount: counts.delayed,
        offlineCount: counts.offline,
        inactiveCount: counts.inactive,
        unknownCount: counts.unknown,
        reportOfflineCount: counts.reportOffline,
        reportNewlyOfflineCount: counts.reportNewlyOffline,
        reportRecoveredCount: counts.reportRecovered,
        reportStillOfflineCount: counts.reportStillOffline,
        maasTotalCount: counts.maasTotal,
        maasReportOfflineCount: counts.maasReportOffline,
        requestCount: nonNegativeInt(body.requestCount),
        retryCount: nonNegativeInt(body.retryCount),
        rateLimitCount: nonNegativeInt(body.rateLimitCount),
        errorCount: nonNegativeInt(body.errorCount),
        errorSummary: [optionalString(body.errorSummary, 8_000), ...coverageDiagnostics]
          .filter(Boolean).join('; ').slice(0, 8_000) || null,
        metadata: { ...existingRun.metadata, ...sanitizeJson(jsonObject(body.metadata)) as JsonObject },
        updatedAt: new Date(),
      }).where(eq(wwCollectionRuns.id, runId)).returning();

      const summary = runResponse(updated);
      const [report] = await tx.select().from(wwReports).where(eq(wwReports.runId, runId));
      if (!report) {
        await tx.insert(wwReports).values({
          id: randomUUID(), runId, status: publish ? 'generated' : 'partial',
          subject: `Wattwatchers Fleet Report — ${updated.reportingDate}`,
          summary,
        });
      } else {
        await tx.update(wwReports).set({ summary, status: publish ? 'generated' : 'partial', updatedAt: new Date() })
          .where(eq(wwReports.id, report.id));
      }
      return updated;
    });
    return reply.send({ run: runResponse(finalized) });
  });

  app.post('/runs/:runId/report-deliveries', {
    bodyLimit: 8 * 1024 * 1024,
    schema: {
      tags: ['Wattwatchers Ingest'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['idempotencyKey', 'channel', 'status'], additionalProperties: true,
      },
    },
    preHandler: ingestGuards,
  }, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as JsonObject;
    const idempotencyKey = requiredString(body.idempotencyKey, 'idempotencyKey', 300);
    const channel = requiredString(body.channel, 'channel', 50);
    const status = requiredString(body.status, 'status', 30);
    if (!['sent', 'failed'].includes(status)) throw badRequest('status must be sent or failed');
    const delivery = await db.transaction(async (tx) => {
      const [run] = await tx.select().from(wwCollectionRuns).where(eq(wwCollectionRuns.id, runId));
      if (!run) throw notFound('Fleet collection run');
      if (run.status === 'collecting') throw conflict('Run must be finalized before recording a report');
      let [report] = await tx.select().from(wwReports).where(eq(wwReports.runId, runId));
      if (!report) {
        [report] = await tx.insert(wwReports).values({
          id: randomUUID(), runId, status: run.status === 'published' ? 'generated' : 'partial',
          summary: runResponse(run),
        }).returning();
      }
      [report] = await tx.update(wwReports).set({
        subject: optionalString(body.subject, 500) ?? report.subject,
        renderedHtml: optionalString(body.renderedHtml, 8 * 1024 * 1024) ?? report.renderedHtml,
        csvFilename: optionalString(body.csvFilename, 500) ?? report.csvFilename,
        updatedAt: new Date(),
      }).where(eq(wwReports.id, report.id)).returning();

      const [existing] = await tx.select().from(wwReportDeliveries)
        .where(eq(wwReportDeliveries.idempotencyKey, idempotencyKey));
      if (existing && existing.reportId !== report.id) throw conflict('idempotencyKey belongs to another report');
      const emailDelta = normalizeEmailDelta(body.emailDelta);
      const deliveryMetadata = sanitizeJson(jsonObject(body.metadata)) as JsonObject;
      const values = {
        channel,
        status,
        attemptedAt: optionalValidDate(body.attemptedAt, 'attemptedAt') ?? new Date(),
        sentAt: optionalValidDate(body.sentAt, 'sentAt'),
        recipientCount: nonNegativeInt(body.recipientCount),
        error: optionalString(body.error, 8_000),
        metadata: {
          ...(existing?.metadata ?? {}),
          ...deliveryMetadata,
          ...(emailDelta ? { emailDelta } : {}),
        },
        updatedAt: new Date(),
      };
      if (existing) {
        const [updated] = await tx.update(wwReportDeliveries).set(values)
          .where(eq(wwReportDeliveries.id, existing.id)).returning();
        return updated;
      }
      const [created] = await tx.insert(wwReportDeliveries).values({
        id: randomUUID(), reportId: report.id, idempotencyKey, ...values,
      }).returning();
      return created;
    });
    return reply.send(delivery);
  });
}
