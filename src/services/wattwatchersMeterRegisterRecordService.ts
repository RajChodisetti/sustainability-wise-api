import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { businessClients, businessSites } from '../db/schema/shared.js';
import {
  wwMeterRegisterEntries,
  wwMeterRegisterImports,
  wwMeterRegisterRecords,
} from '../db/schema/wattwatchers.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import {
  BUSINESS_COMPANY_KEY,
  normalizeClientName,
  type ClientSiteMemoryExecutor,
} from './clientSiteMemoryService.js';
import {
  AUSTRALIAN_STATES,
  schedulerAddressFingerprint,
  type AustralianState,
} from './schedulerAddressService.js';
import {
  meterRegisterPlaceholderSiteId,
  type MeterRegisterIdentifierClassification,
  type MeterRegisterOperationalDetails,
} from './wattwatchersMeterRegisterImport.js';

export type WattwatchersMeterRegisterRecordDto = {
  entryId: string;
  businessClientId: string;
  businessSiteId: string;
  clientName: string;
  customerName: string;
  siteName: string;
  siteAddress: string;
  siteState: AustralianState | null;
  details: MeterRegisterOperationalDetails;
  revision: number;
  updatedAt: string;
};

export type UpdateWattwatchersMeterRegisterRecordInput = {
  revision: number | null;
  clientName: string;
  customerName: string;
  siteName: string;
  siteAddress: string;
  siteState: AustralianState | null;
  details: Partial<MeterRegisterOperationalDetails>;
};

export type UpdateWattwatchersMeterRegisterRecordRequest = {
  entryId: string;
  actorUserId: string;
  input: UpdateWattwatchersMeterRegisterRecordInput;
};

export type WattwatchersMeterRegisterEvidenceDto = {
  id: string;
  sourceKey: string;
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRow: number;
  sourcePayload: Record<string, unknown>;
  status: string | null;
  customerName: string | null;
  clientName: string | null;
  fleetAccountName: string | null;
  siteAddress: string | null;
  siteState: string | null;
  serviceType: string | null;
  meteringSolutionType: string | null;
  meterType: string | null;
  jobNumber: string | null;
  quoteNumber: string | null;
  purchaseOrderNumber: string | null;
  jobCompletionDate: string | null;
  jobCompletedBy: string | null;
  existingDeviceIdentifier: string | null;
  existingDeviceClassification: MeterRegisterIdentifierClassification;
  newDeviceIdentifier: string | null;
  newDeviceClassification: MeterRegisterIdentifierClassification;
  currentDeviceIdentifier: string;
  currentDeviceClassification: Exclude<MeterRegisterIdentifierClassification, 'absent'>;
  hardwareInstalled: string | null;
  maas: boolean | null;
  maasStartDate: string | null;
  maasTerm: string | null;
  maasReportingRequired: boolean | null;
  dataEnabled: boolean | null;
  productName: string | null;
  xeroInvoiceNumber: string | null;
  meterCostExGstCents: number | null;
  meteringRecurringFeeExGstCents: number | null;
  otherInvoiceCostsExGstCents: number | null;
  invoiceAmountExGstCents: number | null;
  recurringFeePo: string | null;
  invoicingClientContact: string | null;
  comments: string | null;
  recurringStartDate: string | null;
  recurringFrequency: string | null;
  recurringNextInvoiceIssueDate: string | null;
  invoiceIssuedDate: string | null;
  billingPeriod: string | null;
  issuedPeriodNextInvoiceIssueDate: string | null;
  record: WattwatchersMeterRegisterRecordDto;
};

export type ListWattwatchersMeterRegisterRecordsResult = {
  data: WattwatchersMeterRegisterEvidenceDto[];
  meta: { total: number; limit: number; offset: number };
};

const DETAIL_KEYS = [
  'status',
  'serviceType',
  'meteringSolutionType',
  'installationDetail',
  'meterType',
  'fergusJobNumber',
  'quoteNumber',
  'purchaseOrderNumber',
  'jobCompletionDate',
  'jobCompletedBy',
  'hardwareInstalled',
  'maas',
  'maasStartDate',
  'maasTerm',
  'maasReportingRequired',
  'dataEnabled',
  'productName',
  'xeroInvoiceNumber',
  'meterCostExGstCents',
  'meteringRecurringFeeExGstCents',
  'otherInvoiceCostsExGstCents',
  'invoiceAmountExGstCents',
  'recurringFeePo',
  'invoicingClientContact',
  'comments',
  'recurringStartDate',
  'recurringFrequency',
  'recurringNextInvoiceIssueDate',
  'invoiceIssuedDate',
  'billingPeriod',
  'issuedPeriodNextInvoiceIssueDate',
] as const satisfies readonly (keyof MeterRegisterOperationalDetails)[];

const DETAIL_KEY_SET = new Set<string>(DETAIL_KEYS);
const PLACEHOLDER_VALUES = new Set(['', '0', 'NA', 'N/A']);

const EMPTY_DETAILS: MeterRegisterOperationalDetails = {
  status: null,
  serviceType: null,
  meteringSolutionType: null,
  installationDetail: null,
  meterType: null,
  fergusJobNumber: null,
  quoteNumber: null,
  purchaseOrderNumber: null,
  jobCompletionDate: null,
  jobCompletedBy: null,
  hardwareInstalled: null,
  maas: null,
  maasStartDate: null,
  maasTerm: null,
  maasReportingRequired: null,
  dataEnabled: null,
  productName: null,
  xeroInvoiceNumber: null,
  meterCostExGstCents: null,
  meteringRecurringFeeExGstCents: null,
  otherInvoiceCostsExGstCents: null,
  invoiceAmountExGstCents: null,
  recurringFeePo: null,
  invoicingClientContact: null,
  comments: null,
  recurringStartDate: null,
  recurringFrequency: null,
  recurringNextInvoiceIssueDate: null,
  invoiceIssuedDate: null,
  billingPeriod: null,
  issuedPeriodNextInvoiceIssueDate: null,
};

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be text`);
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw badRequest(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text or null`);
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) throw badRequest(`${field} is too long`);
  return normalized;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw badRequest(`${field} must use YYYY-MM-DD or be null`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} must be a real calendar date`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw badRequest(`${field} must be boolean or null`);
  return value;
}

function optionalCents(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw badRequest(`${field} must be whole cents or null`);
  return value as number;
}

function detailValue<K extends keyof MeterRegisterOperationalDetails>(
  current: MeterRegisterOperationalDetails,
  incoming: Partial<MeterRegisterOperationalDetails>,
  key: K,
): MeterRegisterOperationalDetails[K] {
  return Object.prototype.hasOwnProperty.call(incoming, key)
    ? incoming[key] as MeterRegisterOperationalDetails[K]
    : current[key];
}

export function normalizeMeterRegisterOperationalDetails(
  current: MeterRegisterOperationalDetails,
  incoming: Partial<MeterRegisterOperationalDetails>,
): MeterRegisterOperationalDetails {
  for (const key of Object.keys(incoming)) {
    if (!DETAIL_KEY_SET.has(key)) throw badRequest(`details.${key} is not editable`);
  }
  return {
    status: optionalText(detailValue(current, incoming, 'status'), 'details.status', 300),
    serviceType: optionalText(detailValue(current, incoming, 'serviceType'), 'details.serviceType', 300),
    meteringSolutionType: optionalText(detailValue(current, incoming, 'meteringSolutionType'), 'details.meteringSolutionType', 300),
    installationDetail: optionalText(
      detailValue(current, incoming, 'installationDetail'),
      'details.installationDetail',
      300,
    ),
    meterType: optionalText(detailValue(current, incoming, 'meterType'), 'details.meterType', 300),
    fergusJobNumber: optionalText(detailValue(current, incoming, 'fergusJobNumber'), 'details.fergusJobNumber', 300),
    quoteNumber: optionalText(detailValue(current, incoming, 'quoteNumber'), 'details.quoteNumber', 300),
    purchaseOrderNumber: optionalText(detailValue(current, incoming, 'purchaseOrderNumber'), 'details.purchaseOrderNumber', 300),
    jobCompletionDate: optionalDate(detailValue(current, incoming, 'jobCompletionDate'), 'details.jobCompletionDate'),
    jobCompletedBy: optionalText(detailValue(current, incoming, 'jobCompletedBy'), 'details.jobCompletedBy', 300),
    hardwareInstalled: optionalText(detailValue(current, incoming, 'hardwareInstalled'), 'details.hardwareInstalled', 300),
    maas: optionalBoolean(detailValue(current, incoming, 'maas'), 'details.maas'),
    maasStartDate: optionalDate(detailValue(current, incoming, 'maasStartDate'), 'details.maasStartDate'),
    maasTerm: optionalText(detailValue(current, incoming, 'maasTerm'), 'details.maasTerm', 300),
    maasReportingRequired: optionalBoolean(detailValue(current, incoming, 'maasReportingRequired'), 'details.maasReportingRequired'),
    dataEnabled: optionalBoolean(detailValue(current, incoming, 'dataEnabled'), 'details.dataEnabled'),
    productName: optionalText(detailValue(current, incoming, 'productName'), 'details.productName', 300),
    xeroInvoiceNumber: optionalText(detailValue(current, incoming, 'xeroInvoiceNumber'), 'details.xeroInvoiceNumber', 300),
    meterCostExGstCents: optionalCents(detailValue(current, incoming, 'meterCostExGstCents'), 'details.meterCostExGstCents'),
    meteringRecurringFeeExGstCents: optionalCents(detailValue(current, incoming, 'meteringRecurringFeeExGstCents'), 'details.meteringRecurringFeeExGstCents'),
    otherInvoiceCostsExGstCents: optionalCents(detailValue(current, incoming, 'otherInvoiceCostsExGstCents'), 'details.otherInvoiceCostsExGstCents'),
    invoiceAmountExGstCents: optionalCents(detailValue(current, incoming, 'invoiceAmountExGstCents'), 'details.invoiceAmountExGstCents'),
    recurringFeePo: optionalText(detailValue(current, incoming, 'recurringFeePo'), 'details.recurringFeePo', 300),
    invoicingClientContact: optionalText(detailValue(current, incoming, 'invoicingClientContact'), 'details.invoicingClientContact', 500),
    comments: optionalText(detailValue(current, incoming, 'comments'), 'details.comments', 2_000),
    recurringStartDate: optionalDate(detailValue(current, incoming, 'recurringStartDate'), 'details.recurringStartDate'),
    recurringFrequency: optionalText(detailValue(current, incoming, 'recurringFrequency'), 'details.recurringFrequency', 300),
    recurringNextInvoiceIssueDate: optionalDate(detailValue(current, incoming, 'recurringNextInvoiceIssueDate'), 'details.recurringNextInvoiceIssueDate'),
    invoiceIssuedDate: optionalDate(detailValue(current, incoming, 'invoiceIssuedDate'), 'details.invoiceIssuedDate'),
    billingPeriod: optionalText(detailValue(current, incoming, 'billingPeriod'), 'details.billingPeriod', 300),
    issuedPeriodNextInvoiceIssueDate: optionalDate(detailValue(current, incoming, 'issuedPeriodNextInvoiceIssueDate'), 'details.issuedPeriodNextInvoiceIssueDate'),
  };
}

function placeholderText(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value.trim().toLocaleUpperCase('en-AU'));
}

function timezoneForState(state: AustralianState | null): string {
  switch (state) {
    case 'QLD': return 'Australia/Brisbane';
    case 'NT': return 'Australia/Darwin';
    case 'SA': return 'Australia/Adelaide';
    case 'TAS': return 'Australia/Hobart';
    case 'VIC': return 'Australia/Melbourne';
    case 'WA': return 'Australia/Perth';
    default: return 'Australia/Sydney';
  }
}

async function lockKey(executor: ClientSiteMemoryExecutor, key: string): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

async function resolveActiveClientById(
  executor: ClientSiteMemoryExecutor,
  initialId: string,
): Promise<typeof businessClients.$inferSelect | undefined> {
  let id = initialId;
  const visited = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (visited.has(id)) throw conflict('Client merge chain contains a cycle');
    visited.add(id);
    const [row] = await executor.select().from(businessClients).where(and(
      eq(businessClients.id, id),
      eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    )).limit(1).for('update');
    if (!row) return undefined;
    if (!row.mergedIntoClientId) return row;
    id = row.mergedIntoClientId;
  }
  throw conflict('Client merge chain is too deep');
}

async function resolveClient(
  executor: ClientSiteMemoryExecutor,
  displayName: string,
  now: Date,
): Promise<typeof businessClients.$inferSelect> {
  const normalizedKey = normalizeClientName(displayName);
  await lockKey(executor, `${BUSINESS_COMPANY_KEY}:client:${normalizedKey}`);
  const matches = await executor.select().from(businessClients).where(and(
    eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    eq(businessClients.normalizedKey, normalizedKey),
  )).orderBy(asc(businessClients.createdAt)).for('update');
  const active = matches.find((candidate) => !candidate.mergedIntoClientId);
  if (active) return active;
  if (matches[0]?.mergedIntoClientId) {
    const target = await resolveActiveClientById(executor, matches[0].mergedIntoClientId);
    if (target) return target;
    throw conflict('The matching client alias has an invalid merge target');
  }
  const [created] = await executor.insert(businessClients).values({
    id: randomUUID(),
    companyKey: BUSINESS_COMPANY_KEY,
    name: displayName,
    normalizedKey,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created!;
}

type ExistingRecordContext = {
  businessClientId: string;
  businessSiteId: string;
  siteAddress: string;
};

async function resolveSite(
  executor: ClientSiteMemoryExecutor,
  input: {
    entryId: string;
    client: typeof businessClients.$inferSelect;
    siteName: string;
    siteAddress: string;
    siteState: AustralianState | null;
    existing: ExistingRecordContext | null;
    now: Date;
  },
): Promise<typeof businessSites.$inferSelect> {
  const isPlaceholder = placeholderText(input.siteAddress);
  const address = isPlaceholder ? 'NA' : input.siteAddress;
  const state = input.siteState;
  const fingerprint = schedulerAddressFingerprint({ displayAddress: address, state, countryCode: 'AU' });
  const placeholderSiteId = meterRegisterPlaceholderSiteId(input.entryId, input.client.id);
  const normalizedSiteName = normalizeClientName(input.siteName);
  await lockKey(
    executor,
    `${BUSINESS_COMPANY_KEY}:site:${input.client.id}:${fingerprint}`,
  );

  if (
    isPlaceholder
    && input.existing?.businessClientId === input.client.id
    && (
      input.existing.businessSiteId === placeholderSiteId
      || placeholderText(input.existing.siteAddress)
    )
  ) {
    const [updated] = await executor.update(businessSites).set({
      name: input.siteName,
      address: 'NA',
      state,
      addressFingerprint: fingerprint,
      timezone: timezoneForState(state),
      updatedAt: input.now,
    }).where(and(
      eq(businessSites.id, input.existing.businessSiteId),
      eq(businessSites.clientId, input.client.id),
    )).returning();
    if (updated) return updated;
  }

  const candidates = await executor.select().from(businessSites).where(
    isPlaceholder
      ? and(
          eq(businessSites.id, placeholderSiteId),
          eq(businessSites.clientId, input.client.id),
        )
      : and(
          eq(businessSites.clientId, input.client.id),
          eq(businessSites.addressFingerprint, fingerprint),
        ),
  ).orderBy(asc(businessSites.createdAt));
  const matching = candidates.find((candidate) => normalizeClientName(candidate.name) === normalizedSiteName);
  if (matching) return matching;

  const [created] = await executor.insert(businessSites).values({
    id: isPlaceholder ? placeholderSiteId : randomUUID(),
    clientId: input.client.id,
    name: input.siteName,
    address,
    state,
    countryCode: 'AU',
    addressSource: 'manual',
    geocodeStatus: 'unresolved',
    addressFingerprint: fingerprint,
    timezone: timezoneForState(state),
    createdAt: input.now,
    updatedAt: input.now,
  }).returning();
  return created!;
}

function normalizeState(value: unknown): AustralianState | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw badRequest('siteState must be an Australian state or null');
  const normalized = value.trim().toLocaleUpperCase('en-AU');
  if (!AUSTRALIAN_STATES.includes(normalized as AustralianState)) {
    throw badRequest('siteState must be an Australian state or null');
  }
  return normalized as AustralianState;
}

export async function updateWattwatchersMeterRegisterRecord(
  request: UpdateWattwatchersMeterRegisterRecordRequest,
): Promise<WattwatchersMeterRegisterRecordDto> {
  const entryId = requiredText(request.entryId, 'entryId', 200);
  const actorUserId = requiredText(request.actorUserId, 'actorUserId', 200);
  const clientName = requiredText(request.input.clientName, 'clientName', 300);
  const customerName = requiredText(request.input.customerName, 'customerName', 300);
  const siteName = requiredText(request.input.siteName, 'siteName', 300);
  const rawSiteAddress = requiredText(request.input.siteAddress, 'siteAddress', 1_000);
  const siteAddress = placeholderText(rawSiteAddress) ? 'NA' : rawSiteAddress;
  const siteState = normalizeState(request.input.siteState);
  if (request.input.revision !== null && !Number.isSafeInteger(request.input.revision)) {
    throw badRequest('revision must be a whole number or null');
  }

  return db.transaction(async (tx) => {
    await lockKey(tx, `${BUSINESS_COMPANY_KEY}:meter-register-entry:${entryId}`);
    const [entry] = await tx.select({
      id: wwMeterRegisterEntries.id,
      currentDeviceIdentifier: wwMeterRegisterEntries.currentDeviceIdentifier,
    }).from(wwMeterRegisterEntries).where(eq(wwMeterRegisterEntries.id, entryId)).limit(1);
    if (!entry) throw notFound('Meter Register entry');
    if (!entry.currentDeviceIdentifier) {
      throw badRequest('Only Meter Register rows with a current identifier are editable');
    }

    const [existing] = await tx.select({
      entryId: wwMeterRegisterRecords.entryId,
      businessClientId: wwMeterRegisterRecords.businessClientId,
      businessSiteId: wwMeterRegisterRecords.businessSiteId,
      details: wwMeterRegisterRecords.details,
      revision: wwMeterRegisterRecords.revision,
      siteAddress: businessSites.address,
    }).from(wwMeterRegisterRecords)
      .innerJoin(businessSites, eq(businessSites.id, wwMeterRegisterRecords.businessSiteId))
      .where(eq(wwMeterRegisterRecords.entryId, entryId))
      .limit(1);

    if (existing) {
      if (request.input.revision !== existing.revision) {
        throw conflict('The Meter Register row changed after it was opened');
      }
    } else if (request.input.revision !== null && request.input.revision !== 0) {
      throw conflict('The Meter Register row changed after it was opened');
    }

    const details = normalizeMeterRegisterOperationalDetails(
      existing?.details ?? EMPTY_DETAILS,
      request.input.details,
    );
    const now = new Date();
    const client = await resolveClient(tx, clientName, now);
    const site = await resolveSite(tx, {
      entryId,
      client,
      siteName,
      siteAddress,
      siteState,
      existing: existing ? {
        businessClientId: existing.businessClientId,
        businessSiteId: existing.businessSiteId,
        siteAddress: existing.siteAddress,
      } : null,
      now,
    });

    let record: typeof wwMeterRegisterRecords.$inferSelect;
    if (existing) {
      const [updated] = await tx.update(wwMeterRegisterRecords).set({
        businessClientId: client.id,
        businessSiteId: site.id,
        customerName,
        details,
        revision: existing.revision + 1,
        updatedByUserId: actorUserId,
        manuallyCorrectedAt: now,
        updatedAt: now,
      }).where(and(
        eq(wwMeterRegisterRecords.entryId, entryId),
        eq(wwMeterRegisterRecords.revision, existing.revision),
      )).returning();
      if (!updated) throw conflict('The Meter Register row changed after it was opened');
      record = updated;
    } else {
      const [created] = await tx.insert(wwMeterRegisterRecords).values({
        entryId,
        businessClientId: client.id,
        businessSiteId: site.id,
        customerName,
        details,
        revision: 1,
        updatedByUserId: actorUserId,
        manuallyCorrectedAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      record = created!;
    }

    return {
      entryId: record.entryId,
      businessClientId: client.id,
      businessSiteId: site.id,
      clientName: client.name,
      customerName: record.customerName,
      siteName: site.name,
      siteAddress: site.address,
      siteState: site.state as AustralianState | null,
      details: record.details,
      revision: record.revision,
      updatedAt: record.updatedAt.toISOString(),
    };
  });
}

export async function listWattwatchersMeterRegisterRecords(input: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ListWattwatchersMeterRegisterRecordsResult> {
  const search = input.search?.trim().replace(/\s+/gu, ' ') ?? '';
  if (search.length > 200) throw badRequest('search is too long');
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw badRequest('limit must be an integer between 1 and 200');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw badRequest('offset must be a non-negative integer');
  }

  const pattern = `%${search}%`;
  const searchCondition = search ? or(
    ilike(wwMeterRegisterImports.sourceWorkbook, pattern),
    ilike(wwMeterRegisterImports.sourceSheet, pattern),
    ilike(wwMeterRegisterEntries.sourceKey, pattern),
    sql`${wwMeterRegisterEntries.sourcePayload}::text ILIKE ${pattern}`,
    ilike(wwMeterRegisterEntries.currentDeviceIdentifier, pattern),
    ilike(wwMeterRegisterEntries.existingDeviceIdentifier, pattern),
    ilike(wwMeterRegisterEntries.newDeviceIdentifier, pattern),
    ilike(wwMeterRegisterEntries.clientNameSnapshot, pattern),
    ilike(wwMeterRegisterEntries.customerNameSnapshot, pattern),
    ilike(wwMeterRegisterEntries.siteAddressSnapshot, pattern),
    ilike(wwMeterRegisterRecords.customerName, pattern),
    sql`${wwMeterRegisterRecords.details}::text ILIKE ${pattern}`,
    ilike(businessClients.name, pattern),
    ilike(businessSites.name, pattern),
    ilike(businessSites.address, pattern),
  ) : undefined;
  const where = and(
    searchCondition,
    eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    sql`${businessClients.mergedIntoClientId} IS NULL`,
  );

  const [countRows, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(wwMeterRegisterEntries)
      .innerJoin(wwMeterRegisterImports, eq(wwMeterRegisterImports.id, wwMeterRegisterEntries.importId))
      .innerJoin(wwMeterRegisterRecords, eq(wwMeterRegisterRecords.entryId, wwMeterRegisterEntries.id))
      .innerJoin(businessClients, eq(businessClients.id, wwMeterRegisterRecords.businessClientId))
      .innerJoin(businessSites, and(
        eq(businessSites.id, wwMeterRegisterRecords.businessSiteId),
        eq(businessSites.clientId, wwMeterRegisterRecords.businessClientId),
      ))
      .where(where),
    db.select({
      id: wwMeterRegisterEntries.id,
      sourceKey: wwMeterRegisterEntries.sourceKey,
      sourceWorkbook: wwMeterRegisterImports.sourceWorkbook,
      sourceSheet: wwMeterRegisterImports.sourceSheet,
      sourceRow: wwMeterRegisterEntries.sourceRow,
      sourcePayload: wwMeterRegisterEntries.sourcePayload,
      status: wwMeterRegisterEntries.statusSnapshot,
      customerName: wwMeterRegisterEntries.customerNameSnapshot,
      clientName: wwMeterRegisterEntries.clientNameSnapshot,
      siteAddress: wwMeterRegisterEntries.siteAddressSnapshot,
      siteState: wwMeterRegisterEntries.siteStateSnapshot,
      serviceType: wwMeterRegisterEntries.serviceTypeSnapshot,
      meteringSolutionType: wwMeterRegisterEntries.meteringSolutionTypeSnapshot,
      meterType: wwMeterRegisterEntries.meterTypeSnapshot,
      jobNumber: wwMeterRegisterEntries.fergusJobNumberSnapshot,
      quoteNumber: wwMeterRegisterEntries.quoteNumberSnapshot,
      purchaseOrderNumber: wwMeterRegisterEntries.purchaseOrderNumberSnapshot,
      jobCompletionDate: wwMeterRegisterEntries.jobCompletionDate,
      jobCompletedBy: wwMeterRegisterEntries.jobCompletedBySnapshot,
      existingDeviceIdentifier: wwMeterRegisterEntries.existingDeviceIdentifier,
      existingDeviceClassification: wwMeterRegisterEntries.existingDeviceClassification,
      newDeviceIdentifier: wwMeterRegisterEntries.newDeviceIdentifier,
      newDeviceClassification: wwMeterRegisterEntries.newDeviceClassification,
      currentDeviceIdentifier: wwMeterRegisterEntries.currentDeviceIdentifier,
      currentDeviceClassification: wwMeterRegisterEntries.currentDeviceClassification,
      hardwareInstalled: wwMeterRegisterEntries.hardwareInstalledSnapshot,
      maas: wwMeterRegisterEntries.maas,
      maasStartDate: wwMeterRegisterEntries.maasStartDate,
      maasTerm: wwMeterRegisterEntries.maasTermSnapshot,
      maasReportingRequired: wwMeterRegisterEntries.maasReportingRequired,
      dataEnabled: wwMeterRegisterEntries.dataEnabled,
      productName: wwMeterRegisterEntries.productNameSnapshot,
      xeroInvoiceNumber: wwMeterRegisterEntries.xeroInvoiceNumberSnapshot,
      meterCostExGstCents: wwMeterRegisterEntries.meterCostExGstCents,
      meteringRecurringFeeExGstCents: wwMeterRegisterEntries.meteringRecurringFeeExGstCents,
      otherInvoiceCostsExGstCents: wwMeterRegisterEntries.otherInvoiceCostsExGstCents,
      invoiceAmountExGstCents: wwMeterRegisterEntries.invoiceAmountExGstCents,
      recurringFeePo: wwMeterRegisterEntries.recurringFeePoSnapshot,
      invoicingClientContact: wwMeterRegisterEntries.invoicingClientContactSnapshot,
      comments: wwMeterRegisterEntries.commentsSnapshot,
      recurringStartDate: wwMeterRegisterEntries.recurringStartDate,
      recurringFrequency: wwMeterRegisterEntries.recurringFrequencySnapshot,
      recurringNextInvoiceIssueDate: wwMeterRegisterEntries.recurringNextInvoiceIssueDate,
      invoiceIssuedDate: wwMeterRegisterEntries.invoiceIssuedDate,
      billingPeriod: wwMeterRegisterEntries.billingPeriodSnapshot,
      issuedPeriodNextInvoiceIssueDate: wwMeterRegisterEntries.issuedPeriodNextInvoiceIssueDate,
      businessClientId: wwMeterRegisterRecords.businessClientId,
      businessSiteId: wwMeterRegisterRecords.businessSiteId,
      recordCustomerName: wwMeterRegisterRecords.customerName,
      details: wwMeterRegisterRecords.details,
      revision: wwMeterRegisterRecords.revision,
      updatedAt: wwMeterRegisterRecords.updatedAt,
      recordClientName: businessClients.name,
      recordSiteName: businessSites.name,
      recordSiteAddress: businessSites.address,
      recordSiteState: businessSites.state,
    }).from(wwMeterRegisterEntries)
      .innerJoin(wwMeterRegisterImports, eq(wwMeterRegisterImports.id, wwMeterRegisterEntries.importId))
      .innerJoin(wwMeterRegisterRecords, eq(wwMeterRegisterRecords.entryId, wwMeterRegisterEntries.id))
      .innerJoin(businessClients, eq(businessClients.id, wwMeterRegisterRecords.businessClientId))
      .innerJoin(businessSites, and(
        eq(businessSites.id, wwMeterRegisterRecords.businessSiteId),
        eq(businessSites.clientId, wwMeterRegisterRecords.businessClientId),
      ))
      .where(where)
      .orderBy(
        desc(wwMeterRegisterEntries.jobCompletionDate),
        desc(wwMeterRegisterEntries.sourceRow),
        asc(wwMeterRegisterEntries.id),
      )
      .limit(limit)
      .offset(offset),
  ]);

  return {
    data: rows.map((row) => {
      if (!row.currentDeviceIdentifier || row.currentDeviceClassification === 'absent') {
        throw conflict('A mapped Meter Register row has no current identifier');
      }
      return {
        id: row.id,
        sourceKey: row.sourceKey,
        sourceWorkbook: row.sourceWorkbook,
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        sourcePayload: row.sourcePayload,
        status: row.status,
        customerName: row.customerName,
        clientName: row.clientName,
        fleetAccountName: row.clientName,
        siteAddress: row.siteAddress,
        siteState: row.siteState,
        serviceType: row.serviceType,
        meteringSolutionType: row.meteringSolutionType,
        meterType: row.meterType,
        jobNumber: row.jobNumber,
        quoteNumber: row.quoteNumber,
        purchaseOrderNumber: row.purchaseOrderNumber,
        jobCompletionDate: row.jobCompletionDate,
        jobCompletedBy: row.jobCompletedBy,
        existingDeviceIdentifier: row.existingDeviceIdentifier,
        existingDeviceClassification: row.existingDeviceClassification as MeterRegisterIdentifierClassification,
        newDeviceIdentifier: row.newDeviceIdentifier,
        newDeviceClassification: row.newDeviceClassification as MeterRegisterIdentifierClassification,
        currentDeviceIdentifier: row.currentDeviceIdentifier,
        currentDeviceClassification: row.currentDeviceClassification as Exclude<
          MeterRegisterIdentifierClassification,
          'absent'
        >,
        hardwareInstalled: row.hardwareInstalled,
        maas: row.maas,
        maasStartDate: row.maasStartDate,
        maasTerm: row.maasTerm,
        maasReportingRequired: row.maasReportingRequired,
        dataEnabled: row.dataEnabled,
        productName: row.productName,
        xeroInvoiceNumber: row.xeroInvoiceNumber,
        meterCostExGstCents: row.meterCostExGstCents,
        meteringRecurringFeeExGstCents: row.meteringRecurringFeeExGstCents,
        otherInvoiceCostsExGstCents: row.otherInvoiceCostsExGstCents,
        invoiceAmountExGstCents: row.invoiceAmountExGstCents,
        recurringFeePo: row.recurringFeePo,
        invoicingClientContact: row.invoicingClientContact,
        comments: row.comments,
        recurringStartDate: row.recurringStartDate,
        recurringFrequency: row.recurringFrequency,
        recurringNextInvoiceIssueDate: row.recurringNextInvoiceIssueDate,
        invoiceIssuedDate: row.invoiceIssuedDate,
        billingPeriod: row.billingPeriod,
        issuedPeriodNextInvoiceIssueDate: row.issuedPeriodNextInvoiceIssueDate,
        record: {
          entryId: row.id,
          businessClientId: row.businessClientId,
          businessSiteId: row.businessSiteId,
          clientName: row.recordClientName,
          customerName: row.recordCustomerName,
          siteName: row.recordSiteName,
          siteAddress: row.recordSiteAddress,
          siteState: row.recordSiteState as AustralianState | null,
          details: row.details,
          revision: row.revision,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    }),
    meta: { total: countRows[0]?.count ?? 0, limit, offset },
  };
}
