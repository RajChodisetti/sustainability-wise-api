import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import { ihInventoryMeters } from '../db/schema/installhub.js';
import {
  businessClientMergeEvents,
  businessClients,
  businessJobs,
  businessSites,
  ecoauditJobDetails,
  fieldAppJobDetails,
  solarsenseJobDetails,
} from '../db/schema/shared.js';
import { wwClients, wwMeterRegisterRecords } from '../db/schema/wattwatchers.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import {
  ADDRESS_SOURCES,
  ADDRESS_PROVIDERS,
  AUSTRALIAN_STATES,
  isAustralianRoutingCoordinate,
  schedulerAddressFingerprint,
  type AddressProvider,
  type AddressSource,
  type AustralianState,
} from './schedulerAddressService.js';
import {
  suggestSchedulerAddresses,
  type SchedulerAddressSuggestion,
} from './schedulerMapProvider.js';

/** One server-owned company scope shared by the static migration and every client. */
export const BUSINESS_COMPANY_KEY = 'sustainability-wise' as const;

export type ClientSiteMemoryExecutor = Pick<
  typeof db,
  'execute' | 'insert' | 'select' | 'update'
>;

export type ClientSiteGeocodingStatus = 'unresolved' | 'resolved' | 'manual' | 'failed';

export type ClientSiteAddressInput = {
  displayAddress: string;
  locality?: string | null;
  state?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  provider?: string | null;
  placeId?: string | null;
  source?: AddressSource | null;
  geocodingStatus?: ClientSiteGeocodingStatus | null;
};

export type ProductJobMemoryInput = {
  sourceApp: 'installhub' | 'ecoaudit' | 'solarsense';
  sourceType: 'installation' | 'audit' | 'assessment';
  sourceId: string;
  jobType: 'field' | 'ecoaudit' | 'solarsense';
  title: string;
  status: 'planned' | 'in_progress' | 'done' | 'cancelled';
  createdByUserId?: string | null;
  detail:
    | {
      kind: 'field';
      workType: string;
      maas?: boolean | null;
      meteringSolutionType?: string | null;
      plannedMeterType?: string | null;
      customJobNumber?: string | null;
      jobComments?: string | null;
    }
    | { kind: 'ecoaudit'; auditId: string }
    | { kind: 'solarsense'; assessmentId: string; buildingName?: string | null };
};

export type UpsertClientSiteFromProductRecordInput = {
  clientName: string;
  selectedClientId?: string | null;
  selectedSiteId?: string | null;
  siteName: string;
  address: ClientSiteAddressInput;
  timezone?: string | null;
  clientContactName?: string | null;
  clientContactPhone?: string | null;
  clientContactEmail?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  siteContactEmail?: string | null;
  accessInformation?: string | null;
  job?: ProductJobMemoryInput;
};

export type ClientDirectorySiteDto = {
  id: string;
  clientId: string;
  siteName: string;
  displayAddress: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  provider: AddressProvider | null;
  placeId: string | null;
  source: AddressSource;
  geocodingStatus: ClientSiteGeocodingStatus;
  fingerprint: string;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accessInformation: string | null;
  updatedAt: string;
};

export type ClientDirectoryClientDto = {
  id: string;
  name: string;
  normalizedKey: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  updatedAt: string;
  sites: ClientDirectorySiteDto[];
};

export type UpsertClientSiteResult = {
  client: ClientDirectoryClientDto;
  site: ClientDirectorySiteDto;
  jobId: string | null;
};

type CanonicalAddress = {
  displayAddress: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  provider: AddressProvider | null;
  placeId: string | null;
  source: AddressSource;
  geocodingStatus: ClientSiteGeocodingStatus;
  fingerprint: string;
  geocodedAt: Date | null;
};

function compactText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const normalized = compactText(value);
  if (!normalized) throw badRequest(`${field} is required`);
  if (normalized.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const normalized = compactText(value);
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw badRequest(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

/** Stable matching key. The original display capitalization remains untouched. */
export function normalizeClientName(value: string): string {
  return compactText(value).toLocaleLowerCase('en-AU');
}

function canonicalAddress(input: ClientSiteAddressInput): CanonicalAddress {
  const displayAddress = requiredText(input.displayAddress, 'address.displayAddress', 1_000);
  if (input.countryCode !== undefined && input.countryCode !== null && input.countryCode !== 'AU') {
    throw badRequest('address.countryCode must be AU');
  }
  const locality = optionalText(input.locality, 'address.locality', 200);
  const stateValue = optionalText(input.state, 'address.state', 3)?.toUpperCase() ?? null;
  if (stateValue !== null && !AUSTRALIAN_STATES.includes(stateValue as AustralianState)) {
    throw badRequest('address.state must be an Australian state or territory abbreviation');
  }
  const postcode = optionalText(input.postcode, 'address.postcode', 4);
  if (postcode !== null && !/^\d{4}$/u.test(postcode)) {
    throw badRequest('address.postcode must contain four digits');
  }
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) {
    throw badRequest('address.latitude and longitude must be supplied together');
  }
  if (
    latitude !== null
    && longitude !== null
    && (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || !isAustralianRoutingCoordinate({ latitude, longitude })
    )
  ) throw badRequest('address coordinates must be within Australia');

  const providerValue = optionalText(input.provider, 'address.provider', 100);
  if (
    providerValue !== null
    && !ADDRESS_PROVIDERS.includes(providerValue as AddressProvider)
  ) {
    throw badRequest('address.provider must be geoapify or photon');
  }
  const provider = providerValue as AddressProvider | null;
  const placeId = optionalText(input.placeId, 'address.placeId', 500);
  if (placeId && !provider) throw badRequest('address.placeId requires provider');
  if ((provider || placeId) && latitude === null) {
    throw badRequest('address provider details require latitude and longitude');
  }
  const source = input.source ?? (provider && placeId ? 'suggested' : 'manual');
  if (!ADDRESS_SOURCES.includes(source)) {
    throw badRequest('address.source must be suggested, manual, or client_saved');
  }
  if (source === 'suggested' && (!provider || !placeId || latitude === null)) {
    throw badRequest('suggested addresses require coordinates, provider, and placeId');
  }
  const derivedStatus: ClientSiteGeocodingStatus = latitude === null
    ? 'unresolved'
    : provider && placeId
      ? 'resolved'
      : 'manual';
  const geocodingStatus = input.geocodingStatus ?? derivedStatus;
  if (!['unresolved', 'resolved', 'manual', 'failed'].includes(geocodingStatus)) {
    throw badRequest('address.geocodingStatus is invalid');
  }
  if (geocodingStatus === 'resolved' && (!provider || !placeId || latitude === null)) {
    throw badRequest('resolved addresses require coordinates, provider, and placeId');
  }
  if (geocodingStatus === 'manual' && latitude === null) {
    throw badRequest('manually geocoded addresses require coordinates');
  }
  if (source === 'suggested' && geocodingStatus !== 'resolved') {
    throw badRequest('suggested addresses must have resolved geocoding status');
  }

  return {
    displayAddress,
    locality,
    state: stateValue as AustralianState | null,
    postcode,
    countryCode: 'AU',
    latitude,
    longitude,
    provider,
    placeId,
    source,
    geocodingStatus,
    fingerprint: schedulerAddressFingerprint({
      displayAddress,
      locality,
      state: stateValue,
      postcode,
      countryCode: 'AU',
    }),
    geocodedAt: geocodingStatus === 'resolved' || geocodingStatus === 'manual'
      ? new Date()
      : null,
  };
}

function toSiteDto(row: typeof businessSites.$inferSelect): ClientDirectorySiteDto {
  return {
    id: row.id,
    clientId: row.clientId,
    siteName: row.name,
    displayAddress: row.address,
    locality: row.locality,
    state: row.state as AustralianState | null,
    postcode: row.postcode,
    countryCode: 'AU',
    latitude: row.latitude,
    longitude: row.longitude,
    provider: row.geocodeProvider as AddressProvider | null,
    placeId: row.geocodePlaceId,
    source: row.addressSource as AddressSource,
    geocodingStatus: row.geocodeStatus as ClientSiteGeocodingStatus,
    fingerprint: row.addressFingerprint,
    timezone: row.timezone,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    accessInformation: row.accessInformation,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toClientDto(
  row: typeof businessClients.$inferSelect,
  sites: ClientDirectorySiteDto[],
): ClientDirectoryClientDto {
  return {
    id: row.id,
    name: row.name,
    normalizedKey: row.normalizedKey,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    updatedAt: row.updatedAt.toISOString(),
    sites,
  };
}

async function lockMemoryKey(executor: ClientSiteMemoryExecutor, key: string): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `);
}

async function resolveActiveClientById(
  executor: ClientSiteMemoryExecutor,
  initialClientId: string,
): Promise<typeof businessClients.$inferSelect | undefined> {
  let clientId = initialClientId;
  const visited = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (visited.has(clientId)) throw conflict('Client merge chain contains a cycle');
    visited.add(clientId);
    const [row] = await executor.select().from(businessClients).where(and(
      eq(businessClients.id, clientId),
      eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    )).limit(1);
    if (!row) return undefined;
    if (!row.mergedIntoClientId) return row;
    clientId = row.mergedIntoClientId;
  }
  throw conflict('Client merge chain is too deep');
}

async function resolveClient(
  executor: ClientSiteMemoryExecutor,
  input: UpsertClientSiteFromProductRecordInput,
  now: Date,
): Promise<typeof businessClients.$inferSelect> {
  const displayName = requiredText(input.clientName, 'clientName', 300);
  const normalizedKey = normalizeClientName(displayName);
  await lockMemoryKey(executor, `${BUSINESS_COMPANY_KEY}:client:${normalizedKey}`);

  let existing: typeof businessClients.$inferSelect | undefined;
  if (input.selectedClientId) {
    existing = await resolveActiveClientById(executor, input.selectedClientId);
    if (!existing) throw notFound('Client');
  } else {
    [existing] = await executor.select().from(businessClients).where(and(
      eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
      eq(businessClients.normalizedKey, normalizedKey),
    )).orderBy(asc(businessClients.createdAt)).limit(1);
    if (existing?.mergedIntoClientId) {
      existing = await resolveActiveClientById(executor, existing.mergedIntoClientId);
      if (!existing) throw conflict('The matching client alias has an invalid merge target');
    }
  }

  const contactName = optionalText(input.clientContactName, 'clientContactName', 300);
  const contactPhone = optionalText(input.clientContactPhone, 'clientContactPhone', 50);
  const contactEmail = optionalText(input.clientContactEmail, 'clientContactEmail', 320);
  if (existing) {
    const [updated] = await executor.update(businessClients).set({
      contactName: contactName ?? existing.contactName,
      contactPhone: contactPhone ?? existing.contactPhone,
      contactEmail: contactEmail ?? existing.contactEmail,
      updatedAt: now,
    }).where(eq(businessClients.id, existing.id)).returning();
    return updated!;
  }

  const [created] = await executor.insert(businessClients).values({
    id: randomUUID(),
    companyKey: BUSINESS_COMPANY_KEY,
    name: displayName,
    normalizedKey,
    contactName,
    contactPhone,
    contactEmail,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created!;
}

async function resolveSite(
  executor: ClientSiteMemoryExecutor,
  client: typeof businessClients.$inferSelect,
  input: UpsertClientSiteFromProductRecordInput,
  address: CanonicalAddress,
  now: Date,
): Promise<typeof businessSites.$inferSelect> {
  await lockMemoryKey(
    executor,
    `${BUSINESS_COMPANY_KEY}:site:${client.id}:${address.fingerprint}`,
  );
  if (address.source === 'client_saved') {
    if (!input.selectedSiteId) {
      throw badRequest('client_saved addresses require selectedSiteId');
    }
    const [saved] = await executor.select().from(businessSites).where(and(
      eq(businessSites.id, input.selectedSiteId),
      eq(businessSites.clientId, client.id),
    )).limit(1);
    if (!saved) throw notFound('Client site');
    return saved;
  }

  const [matching] = await executor.select().from(businessSites).where(and(
    eq(businessSites.clientId, client.id),
    eq(businessSites.addressFingerprint, address.fingerprint),
  )).orderBy(desc(businessSites.updatedAt)).limit(1);

  const siteName = requiredText(input.siteName, 'siteName', 300);
  const timezone = optionalText(input.timezone, 'timezone', 100) ?? 'Australia/Sydney';
  const siteContactName = optionalText(input.siteContactName, 'siteContactName', 300);
  const siteContactPhone = optionalText(input.siteContactPhone, 'siteContactPhone', 50);
  const siteContactEmail = optionalText(input.siteContactEmail, 'siteContactEmail', 320);
  const accessInformation = optionalText(input.accessInformation, 'accessInformation', 5_000);
  if (matching) {
    const incomingHasBetterGeocode = address.geocodingStatus === 'resolved'
      && matching.geocodeStatus !== 'resolved';
    const [updated] = await executor.update(businessSites).set({
      name: matching.name || siteName,
      locality: incomingHasBetterGeocode ? address.locality : matching.locality ?? address.locality,
      state: incomingHasBetterGeocode ? address.state : matching.state ?? address.state,
      postcode: incomingHasBetterGeocode ? address.postcode : matching.postcode ?? address.postcode,
      latitude: incomingHasBetterGeocode ? address.latitude : matching.latitude ?? address.latitude,
      longitude: incomingHasBetterGeocode ? address.longitude : matching.longitude ?? address.longitude,
      addressSource: incomingHasBetterGeocode ? address.source : matching.addressSource,
      geocodeStatus: incomingHasBetterGeocode
        ? address.geocodingStatus
        : matching.geocodeStatus,
      geocodeProvider: incomingHasBetterGeocode
        ? address.provider
        : matching.geocodeProvider ?? address.provider,
      geocodePlaceId: incomingHasBetterGeocode
        ? address.placeId
        : matching.geocodePlaceId ?? address.placeId,
      geocodedAt: incomingHasBetterGeocode
        ? address.geocodedAt
        : matching.geocodedAt ?? address.geocodedAt,
      contactName: siteContactName ?? matching.contactName,
      contactPhone: siteContactPhone ?? matching.contactPhone,
      contactEmail: siteContactEmail ?? matching.contactEmail,
      accessInformation: accessInformation ?? matching.accessInformation,
      timezone: matching.timezone || timezone,
      updatedAt: now,
    }).where(eq(businessSites.id, matching.id)).returning();
    return updated!;
  }

  const [created] = await executor.insert(businessSites).values({
    id: randomUUID(),
    clientId: client.id,
    name: siteName,
    address: address.displayAddress,
    locality: address.locality,
    state: address.state,
    postcode: address.postcode,
    countryCode: 'AU',
    latitude: address.latitude,
    longitude: address.longitude,
    addressSource: address.source,
    geocodeStatus: address.geocodingStatus,
    geocodeProvider: address.provider,
    geocodePlaceId: address.placeId,
    addressFingerprint: address.fingerprint,
    geocodedAt: address.geocodedAt,
    timezone,
    contactName: siteContactName,
    contactPhone: siteContactPhone,
    contactEmail: siteContactEmail,
    accessInformation,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created!;
}

async function upsertProductJob(
  executor: ClientSiteMemoryExecutor,
  siteId: string,
  input: ProductJobMemoryInput,
  now: Date,
): Promise<string> {
  const sourceId = requiredText(input.sourceId, 'job.sourceId', 500);
  const title = requiredText(input.title, 'job.title', 300);
  const [existing] = await executor.select().from(businessJobs).where(and(
    eq(businessJobs.sourceApp, input.sourceApp),
    eq(businessJobs.sourceType, input.sourceType),
    eq(businessJobs.sourceId, sourceId),
  )).limit(1);

  let jobId: string;
  if (existing) {
    jobId = existing.id;
    await executor.update(businessJobs).set({
      siteId,
      title,
      status: input.status,
      updatedAt: now,
    }).where(eq(businessJobs.id, jobId));
  } else {
    const [previous] = await executor.select({
      id: businessJobs.id,
      revisionNumber: businessJobs.revisionNumber,
    }).from(businessJobs).where(and(
      eq(businessJobs.siteId, siteId),
      eq(businessJobs.sourceApp, input.sourceApp),
    )).orderBy(desc(businessJobs.revisionNumber)).limit(1);
    jobId = randomUUID();
    await executor.insert(businessJobs).values({
      id: jobId,
      siteId,
      jobType: input.jobType,
      title,
      status: input.status,
      sourceApp: input.sourceApp,
      sourceType: input.sourceType,
      sourceId,
      revisionNumber: (previous?.revisionNumber ?? 0) + 1,
      previousJobId: previous?.id ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (input.detail.kind === 'field') {
    await executor.insert(fieldAppJobDetails).values({
      jobId,
      workType: requiredText(input.detail.workType, 'job.detail.workType', 120),
      maas: input.detail.maas ?? null,
      meteringSolutionType: optionalText(
        input.detail.meteringSolutionType,
        'job.detail.meteringSolutionType',
        120,
      ),
      plannedMeterType: optionalText(
        input.detail.plannedMeterType,
        'job.detail.plannedMeterType',
        120,
      ),
      customJobNumber: optionalText(
        input.detail.customJobNumber,
        'job.detail.customJobNumber',
        100,
      ),
      jobComments: optionalText(input.detail.jobComments, 'job.detail.jobComments', 5_000),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: fieldAppJobDetails.jobId,
      set: {
        workType: requiredText(input.detail.workType, 'job.detail.workType', 120),
        maas: input.detail.maas ?? null,
        meteringSolutionType: optionalText(
          input.detail.meteringSolutionType,
          'job.detail.meteringSolutionType',
          120,
        ),
        plannedMeterType: optionalText(
          input.detail.plannedMeterType,
          'job.detail.plannedMeterType',
          120,
        ),
        customJobNumber: optionalText(
          input.detail.customJobNumber,
          'job.detail.customJobNumber',
          100,
        ),
        jobComments: optionalText(input.detail.jobComments, 'job.detail.jobComments', 5_000),
        updatedAt: now,
      },
    });
  } else if (input.detail.kind === 'ecoaudit') {
    await executor.insert(ecoauditJobDetails).values({
      jobId,
      auditId: input.detail.auditId,
      createdAt: now,
    }).onConflictDoNothing();
  } else {
    await executor.insert(solarsenseJobDetails).values({
      jobId,
      assessmentId: input.detail.assessmentId,
      buildingName: optionalText(input.detail.buildingName, 'job.detail.buildingName', 300),
      createdAt: now,
    }).onConflictDoUpdate({
      target: solarsenseJobDetails.jobId,
      set: {
        buildingName: optionalText(input.detail.buildingName, 'job.detail.buildingName', 300),
      },
    });
  }
  return jobId;
}

/**
 * Must be invoked with the product write transaction. It intentionally does
 * not open a nested transaction, so product links and directory memory commit
 * or roll back together.
 */
export async function upsertClientSiteFromProductRecord(
  executor: ClientSiteMemoryExecutor,
  input: UpsertClientSiteFromProductRecordInput,
): Promise<UpsertClientSiteResult> {
  const now = new Date();
  const address = canonicalAddress(input.address);
  const client = await resolveClient(executor, input, now);
  const site = await resolveSite(executor, client, input, address, now);
  const jobId = input.job ? await upsertProductJob(executor, site.id, input.job, now) : null;
  return {
    client: toClientDto(client, [toSiteDto(site)]),
    site: toSiteDto(site),
    jobId,
  };
}

export async function listClientDirectory(input: {
  query?: string;
  clientId?: string;
  limit?: number;
} = {}): Promise<ClientDirectoryClientDto[]> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const query = compactText(input.query ?? '');
  const filters = [
    eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    isNull(businessClients.mergedIntoClientId),
  ];
  if (input.clientId) {
    const resolved = await resolveActiveClientById(db, input.clientId);
    if (!resolved) return [];
    filters.push(eq(businessClients.id, resolved.id));
  }
  let aliasTargetIds: string[] = [];
  if (query) {
    const aliases = await db.select({
      targetId: businessClients.mergedIntoClientId,
    }).from(businessClients).where(and(
      eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
      or(
        ilike(businessClients.name, `%${query}%`),
        ilike(businessClients.normalizedKey, `%${normalizeClientName(query)}%`),
      ),
    )).limit(limit);
    aliasTargetIds = aliases.flatMap((value) => value.targetId ? [value.targetId] : []);
    filters.push(or(
      ilike(businessClients.name, `%${query}%`),
      ilike(businessClients.normalizedKey, `%${normalizeClientName(query)}%`),
      ...(aliasTargetIds.length > 0 ? [inArray(businessClients.id, aliasTargetIds)] : []),
    )!);
  }
  const clients = await db.select().from(businessClients).where(and(...filters))
    .orderBy(asc(businessClients.name)).limit(limit);
  if (clients.length === 0) return [];
  const sites = await db.select().from(businessSites).where(inArray(
    businessSites.clientId,
    clients.map((client) => client.id),
  )).orderBy(asc(businessSites.name), asc(businessSites.address));
  const sitesByClient = new Map<string, ClientDirectorySiteDto[]>();
  for (const site of sites) {
    const values = sitesByClient.get(site.clientId) ?? [];
    values.push(toSiteDto(site));
    sitesByClient.set(site.clientId, values);
  }
  return clients.map((client) => toClientDto(client, sitesByClient.get(client.id) ?? []));
}

export type MixedAddressSuggestion = {
  kind: 'client_saved' | 'provider';
  id: string;
  label: string;
  clientId: string | null;
  clientSiteId: string | null;
  siteName: string | null;
  address: ClientSiteAddressInput & { fingerprint: string };
};

function storedSuggestion(site: ClientDirectorySiteDto): MixedAddressSuggestion {
  return {
    kind: 'client_saved',
    id: `client_saved:${site.id}`,
    label: site.displayAddress,
    clientId: site.clientId,
    clientSiteId: site.id,
    siteName: site.siteName,
    address: {
      displayAddress: site.displayAddress,
      locality: site.locality,
      state: site.state,
      postcode: site.postcode,
      countryCode: 'AU',
      latitude: site.latitude,
      longitude: site.longitude,
      provider: site.provider,
      placeId: site.placeId,
      source: 'client_saved',
      geocodingStatus: site.geocodingStatus,
      fingerprint: site.fingerprint,
    },
  };
}

function providerSuggestion(value: SchedulerAddressSuggestion): MixedAddressSuggestion {
  return {
    kind: 'provider',
    id: value.id,
    label: value.label,
    clientId: null,
    clientSiteId: null,
    siteName: null,
    address: {
      displayAddress: value.freeform,
      locality: value.locality,
      state: value.state,
      postcode: value.postcode,
      countryCode: 'AU',
      latitude: value.latitude,
      longitude: value.longitude,
      provider: value.provider,
      placeId: value.placeId,
      source: 'suggested',
      geocodingStatus: 'resolved',
      fingerprint: schedulerAddressFingerprint({
        displayAddress: value.freeform,
        locality: value.locality,
        state: value.state,
        postcode: value.postcode,
        countryCode: 'AU',
      }),
    },
  };
}

export async function suggestClientAndProviderAddresses(input: {
  clientId?: string;
  query: string;
  postcode?: string;
  limit?: number;
}): Promise<{
  available: boolean;
  provider: 'geoapify' | 'photon' | null;
  attribution: string | null;
  storedSuggestions: MixedAddressSuggestion[];
  providerSuggestions: MixedAddressSuggestion[];
  suggestions: MixedAddressSuggestion[];
}> {
  const limit = Math.min(10, Math.max(1, input.limit ?? 8));
  const query = compactText(input.query);
  let storedSuggestions: MixedAddressSuggestion[] = [];
  if (input.clientId) {
    const [client] = await listClientDirectory({ clientId: input.clientId, limit: 1 });
    if (!client) throw notFound('Client');
    const normalizedQuery = query.toLocaleLowerCase('en-AU');
    storedSuggestions = client.sites.filter((site) => (
      !normalizedQuery
      || site.displayAddress.toLocaleLowerCase('en-AU').includes(normalizedQuery)
      || site.siteName.toLocaleLowerCase('en-AU').includes(normalizedQuery)
      || site.postcode === input.postcode
    )).slice(0, limit).map(storedSuggestion);
  }

  let providerResult: Awaited<ReturnType<typeof suggestSchedulerAddresses>>;
  try {
    providerResult = await suggestSchedulerAddresses({
      query,
      postcode: input.postcode,
      limit,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 503) throw error;
    providerResult = {
      available: false,
      provider: null,
      attribution: null,
      suggestions: [],
    };
  }
  const storedFingerprints = new Set(storedSuggestions.map((value) => value.address.fingerprint));
  const providerSuggestions = providerResult.suggestions.map(providerSuggestion).filter(
    (value) => !storedFingerprints.has(value.address.fingerprint),
  );
  return {
    available: providerResult.available || storedSuggestions.length > 0,
    provider: providerResult.provider,
    attribution: providerResult.attribution,
    storedSuggestions,
    providerSuggestions,
    suggestions: [...storedSuggestions, ...providerSuggestions],
  };
}

/**
 * A merge locks each participating client independently, in stable order. This
 * makes A->B serialize with both A->C and C->B instead of only with the same pair.
 */
export function businessClientMergeLockKeys(
  sourceClientId: string,
  targetClientId: string,
): string[] {
  return [...new Set([sourceClientId, targetClientId])]
    .sort()
    .map((clientId) => `${BUSINESS_COMPANY_KEY}:merge-client:${clientId}`);
}

export async function mergeBusinessClients(input: {
  sourceClientId: string;
  targetClientId: string;
  mergedByUserId: string;
  reason: string;
}): Promise<ClientDirectoryClientDto> {
  if (input.sourceClientId === input.targetClientId) {
    throw badRequest('Source and target clients must be different');
  }
  const reason = requiredText(input.reason, 'reason', 1_000);
  return db.transaction(async (tx) => {
    for (const lockKey of businessClientMergeLockKeys(
      input.sourceClientId,
      input.targetClientId,
    )) {
      await lockMemoryKey(tx, lockKey);
    }
    const rows = await tx.select().from(businessClients).where(and(
      inArray(businessClients.id, [input.sourceClientId, input.targetClientId]),
      eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    )).orderBy(asc(businessClients.id)).for('update');
    const source = rows.find((row) => row.id === input.sourceClientId);
    const target = rows.find((row) => row.id === input.targetClientId);
    if (!source || !target) throw notFound('Client');
    if (source.mergedIntoClientId) throw conflict('Source client has already been merged');
    if (target.mergedIntoClientId) throw conflict('Target client has already been merged');

    const now = new Date();
    await tx.update(businessSites).set({
      clientId: target.id,
      updatedAt: now,
    }).where(eq(businessSites.clientId, source.id));
    // Meter Register records duplicate the owning client for fast Fleet reads.
    // Keep that projection aligned after its referenced sites move to the target.
    await tx.update(wwMeterRegisterRecords).set({
      businessClientId: target.id,
      revision: sql`${wwMeterRegisterRecords.revision} + 1`,
      updatedByUserId: input.mergedByUserId,
      updatedAt: now,
    }).where(eq(wwMeterRegisterRecords.businessClientId, source.id));
    await tx.update(ihInventoryMeters).set({
      businessClientId: target.id,
      updatedAt: now,
    }).where(eq(ihInventoryMeters.businessClientId, source.id));

    const fleetClients = await tx.select().from(wwClients).where(inArray(
      wwClients.sourceBusinessClientId,
      [source.id, target.id],
    ));
    const sourceFleetClient = fleetClients.find(
      (row) => row.sourceBusinessClientId === source.id,
    );
    const targetFleetClient = fleetClients.find(
      (row) => row.sourceBusinessClientId === target.id,
    );
    if (sourceFleetClient && targetFleetClient) {
      throw conflict(
        'Both clients have Fleet projections; merge those Fleet clients before retrying',
      );
    } else if (sourceFleetClient) {
      await tx.update(wwClients).set({
        sourceBusinessClientId: target.id,
        updatedAt: now,
      }).where(eq(wwClients.id, sourceFleetClient.id));
    }
    const [updatedTarget] = await tx.update(businessClients).set({
      contactName: target.contactName ?? source.contactName,
      contactPhone: target.contactPhone ?? source.contactPhone,
      contactEmail: target.contactEmail ?? source.contactEmail,
      updatedAt: now,
    }).where(eq(businessClients.id, target.id)).returning();
    await tx.update(businessClients).set({
      mergedIntoClientId: target.id,
      mergedAt: now,
      mergedByUserId: input.mergedByUserId,
      updatedAt: now,
    }).where(eq(businessClients.id, source.id));
    await tx.insert(businessClientMergeEvents).values({
      id: randomUUID(),
      companyKey: BUSINESS_COMPANY_KEY,
      sourceClientId: source.id,
      targetClientId: target.id,
      mergedByUserId: input.mergedByUserId,
      reason,
      createdAt: now,
    });
    const sites = await tx.select().from(businessSites).where(
      eq(businessSites.clientId, target.id),
    ).orderBy(asc(businessSites.name), asc(businessSites.address));
    return toClientDto(updatedTarget!, sites.map(toSiteDto));
  });
}
