import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businessClients, businessSites } from './shared.js';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const wwUsers = pgTable('ww_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull().default('viewer'),
  isActive: boolean('is_active').notNull().default(true),
  // Set only for source-controlled EcoAudit Pro/SolarSense admin shadows.
  // Explicit Fleet identities leave both columns null.
  sourceApp: text('source_app'),
  sourceUserId: text('source_user_id'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_users_source_identity_unique').on(table.sourceApp, table.sourceUserId),
]);

export const wwClients = pgTable('ww_clients', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  isMaas: boolean('is_maas').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  /** Canonical business client populated by completed Field work when available. */
  sourceBusinessClientId: text('source_business_client_id'),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_clients_code_unique').on(table.code),
  uniqueIndex('ww_clients_business_client_unique').on(table.sourceBusinessClientId),
  index('ww_clients_name_idx').on(table.normalizedName),
]);

/** Encrypted Wattwatchers credential. API responses expose presence, never ciphertext. */
export const wwClientCredentials = pgTable('ww_client_credentials', {
  clientId: text('client_id').primaryKey().references(() => wwClients.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  updatedByUserId: text('updated_by_user_id').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  check('ww_client_credentials_key_version_check', sql`${table.keyVersion} >= 1`),
]);

export const wwDevices = pgTable('ww_devices', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  label: text('label'),
  model: text('model'),
  installDate: date('install_date'),
  firmwareVersion: text('firmware_version'),
  deviceTimezone: text('device_timezone'),
  primaryClientId: text('primary_client_id').references(() => wwClients.id),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  lastDiscoveredAt: instant('last_discovered_at').notNull().defaultNow(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_devices_device_id_unique').on(table.deviceId),
  index('ww_devices_primary_client_idx').on(table.primaryClientId),
  index('ww_devices_label_idx').on(table.label),
]);

export const wwDeviceClients = pgTable('ww_device_clients', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => wwDevices.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => wwClients.id, { onDelete: 'cascade' }),
  isCurrent: boolean('is_current').notNull().default(true),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_device_clients_unique').on(table.deviceId, table.clientId),
  index('ww_device_clients_client_idx').on(table.clientId, table.isCurrent),
]);

/**
 * Source-auditable installation and replacement facts for Fleet devices.
 * These records enrich Fleet without fabricating Field App forms, boards, or
 * electrical hierarchy when the source only supplies customer/site/device data.
 */
export const wwDeviceInstallationAssignments = pgTable('ww_device_installation_assignments', {
  id: text('id').primaryKey(),
  sourceKey: text('source_key').notNull(),
  sourceWorkbook: text('source_workbook').notNull(),
  sourceSheet: text('source_sheet').notNull(),
  sourceRow: integer('source_row').notNull(),
  fleetAccountClientId: text('fleet_account_client_id').notNull().references(
    () => wwClients.id,
    { onDelete: 'restrict' },
  ),
  businessClientId: text('business_client_id').notNull().references(
    () => businessClients.id,
    { onDelete: 'restrict' },
  ),
  businessSiteId: text('business_site_id').references(
    () => businessSites.id,
    { onDelete: 'restrict' },
  ),
  customerNameSnapshot: text('customer_name_snapshot').notNull(),
  siteNameSnapshot: text('site_name_snapshot'),
  siteAddressSnapshot: text('site_address_snapshot'),
  deviceLabelSnapshot: text('device_label_snapshot').notNull(),
  jobCompletionDate: date('job_completion_date'),
  maasStartDate: date('maas_start_date'),
  effectiveDate: date('effective_date').notNull(),
  existingDeviceId: text('existing_device_id').references(
    () => wwDevices.id,
    { onDelete: 'restrict' },
  ),
  newDeviceId: text('new_device_id').references(
    () => wwDevices.id,
    { onDelete: 'restrict' },
  ),
  currentDeviceId: text('current_device_id').notNull().references(
    () => wwDevices.id,
    { onDelete: 'restrict' },
  ),
  notes: text('notes'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_device_installation_assignments_source_unique').on(table.sourceKey),
  index('ww_device_installation_assignments_account_idx').on(table.fleetAccountClientId),
  index('ww_device_installation_assignments_business_client_idx').on(table.businessClientId),
  index('ww_device_installation_assignments_site_idx').on(table.businessSiteId),
  index('ww_device_installation_assignments_current_device_idx').on(table.currentDeviceId),
  check('ww_device_installation_assignments_source_row_check', sql`${table.sourceRow} >= 2`),
  check('ww_device_installation_assignments_date_check', sql`
    num_nonnulls(${table.jobCompletionDate}, ${table.maasStartDate}) = 1
    AND ${table.effectiveDate} = coalesce(${table.jobCompletionDate}, ${table.maasStartDate})
  `),
  check('ww_device_installation_assignments_device_check', sql`
    num_nonnulls(${table.existingDeviceId}, ${table.newDeviceId}) >= 1
    AND ${table.currentDeviceId} = coalesce(${table.newDeviceId}, ${table.existingDeviceId})
    AND (${table.newDeviceId} IS NULL OR ${table.existingDeviceId} IS NULL OR ${table.newDeviceId} <> ${table.existingDeviceId})
  `),
  check('ww_device_installation_assignments_unknown_site_check', sql`
    (${table.businessSiteId} IS NULL AND ${table.siteAddressSnapshot} IS NULL)
    OR (${table.businessSiteId} IS NOT NULL AND ${table.siteAddressSnapshot} IS NOT NULL)
  `),
  check('ww_device_installation_assignments_notes_check', sql`
    ${table.notes} IS NULL OR char_length(${table.notes}) <= 2_000
  `),
]);

/**
 * Immutable workbook-level provenance for Master Register imports.
 * Re-importing the same workbook sheet resolves to the same hash/sheet key
 * instead of creating a second logical source.
 */
export const wwMeterRegisterImports = pgTable('ww_meter_register_imports', {
  id: text('id').primaryKey(),
  sourceWorkbook: text('source_workbook').notNull(),
  sourceSheet: text('source_sheet').notNull(),
  workbookSha256: text('workbook_sha256').notNull(),
  sourceRowCount: integer('source_row_count').notNull(),
  deviceValueCount: integer('device_value_count').notNull(),
  uniqueIdentifierCount: integer('unique_identifier_count').notNull(),
  confirmedWattwatchersIdentifierCount: integer('confirmed_wattwatchers_identifier_count').notNull(),
  candidateWattwatchersIdentifierCount: integer('candidate_wattwatchers_identifier_count').notNull(),
  otherHardwareIdentifierCount: integer('other_hardware_identifier_count').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_meter_register_imports_workbook_sheet_unique').on(
    table.workbookSha256,
    table.sourceSheet,
  ),
  check('ww_meter_register_imports_source_check', sql`
    char_length(btrim(${table.sourceWorkbook})) >= 1
    AND char_length(btrim(${table.sourceSheet})) >= 1
    AND char_length(${table.workbookSha256}) = 64
    AND ${table.workbookSha256} ~ '^[0-9a-f]{64}$'
  `),
  check('ww_meter_register_imports_counts_check', sql`
    ${table.sourceRowCount} >= 0
    AND ${table.deviceValueCount} >= 0
    AND ${table.uniqueIdentifierCount} >= 0
    AND ${table.uniqueIdentifierCount} <= ${table.deviceValueCount}
    AND ${table.confirmedWattwatchersIdentifierCount} >= 0
    AND ${table.candidateWattwatchersIdentifierCount} >= 0
    AND ${table.otherHardwareIdentifierCount} >= 0
    AND ${table.confirmedWattwatchersIdentifierCount}
      + ${table.candidateWattwatchersIdentifierCount}
      + ${table.otherHardwareIdentifierCount} = ${table.uniqueIdentifierCount}
  `),
]);

/**
 * Append-only, row-faithful Master Register evidence. Raw workbook values are
 * retained alongside typed projections and optional Fleet device links so a
 * later normalization improvement never rewrites the imported source.
 */
export const wwMeterRegisterEntries = pgTable('ww_meter_register_entries', {
  id: text('id').primaryKey(),
  importId: text('import_id').notNull(),
  sourceKey: text('source_key').notNull(),
  sourceRow: integer('source_row').notNull(),
  sourceRowSha256: text('source_row_sha256').notNull(),
  statusSnapshot: text('status_snapshot'),
  customerNameSnapshot: text('customer_name_snapshot'),
  clientNameSnapshot: text('client_name_snapshot'),
  siteAddressSnapshot: text('site_address_snapshot'),
  siteStateSnapshot: text('site_state_snapshot'),
  serviceTypeSnapshot: text('service_type_snapshot'),
  meteringSolutionTypeSnapshot: text('metering_solution_type_snapshot'),
  meterTypeSnapshot: text('meter_type_snapshot'),
  fergusJobNumberSnapshot: text('fergus_job_number_snapshot'),
  quoteNumberSnapshot: text('quote_number_snapshot'),
  purchaseOrderNumberSnapshot: text('purchase_order_number_snapshot'),
  jobCompletionDate: date('job_completion_date'),
  jobCompletedBySnapshot: text('job_completed_by_snapshot'),
  existingDeviceIdentifier: text('existing_device_identifier'),
  newDeviceIdentifier: text('new_device_identifier'),
  currentDeviceIdentifier: text('current_device_identifier'),
  existingDeviceClassification: text('existing_device_classification').notNull(),
  newDeviceClassification: text('new_device_classification').notNull(),
  currentDeviceClassification: text('current_device_classification').notNull(),
  existingWattwatchersDeviceId: text('existing_wattwatchers_device_id'),
  newWattwatchersDeviceId: text('new_wattwatchers_device_id'),
  currentWattwatchersDeviceId: text('current_wattwatchers_device_id'),
  hardwareInstalledSnapshot: text('hardware_installed_snapshot'),
  maas: boolean('maas'),
  maasStartDate: date('maas_start_date'),
  maasTermSnapshot: text('maas_term_snapshot'),
  maasReportingRequired: boolean('maas_reporting_required'),
  dataEnabled: boolean('data_enabled'),
  productNameSnapshot: text('product_name_snapshot'),
  xeroInvoiceNumberSnapshot: text('xero_invoice_number_snapshot'),
  meterCostExGstCents: bigint('meter_cost_ex_gst_cents', { mode: 'number' }),
  meteringRecurringFeeExGstCents: bigint('metering_recurring_fee_ex_gst_cents', { mode: 'number' }),
  otherInvoiceCostsExGstCents: bigint('other_invoice_costs_ex_gst_cents', { mode: 'number' }),
  invoiceAmountExGstCents: bigint('invoice_amount_ex_gst_cents', { mode: 'number' }),
  recurringFeePoSnapshot: text('recurring_fee_po_snapshot'),
  invoicingClientContactSnapshot: text('invoicing_client_contact_snapshot'),
  commentsSnapshot: text('comments_snapshot'),
  recurringStartDate: date('recurring_start_date'),
  recurringFrequencySnapshot: text('recurring_frequency_snapshot'),
  recurringNextInvoiceIssueDate: date('recurring_next_invoice_issue_date'),
  invoiceIssuedDate: date('invoice_issued_date'),
  billingPeriodSnapshot: text('billing_period_snapshot'),
  issuedPeriodNextInvoiceIssueDate: date('issued_period_next_invoice_issue_date'),
  sourcePayload: jsonb('source_payload').notNull().$type<Record<string, unknown>>(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: 'ww_meter_register_entries_import_fk',
    columns: [table.importId],
    foreignColumns: [wwMeterRegisterImports.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ww_meter_register_entries_existing_device_fk',
    columns: [table.existingWattwatchersDeviceId],
    foreignColumns: [wwDevices.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ww_meter_register_entries_new_device_fk',
    columns: [table.newWattwatchersDeviceId],
    foreignColumns: [wwDevices.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ww_meter_register_entries_current_device_fk',
    columns: [table.currentWattwatchersDeviceId],
    foreignColumns: [wwDevices.id],
  }).onDelete('restrict'),
  uniqueIndex('ww_meter_register_entries_source_unique').on(table.sourceKey),
  uniqueIndex('ww_meter_register_entries_import_row_unique').on(table.importId, table.sourceRow),
  index('ww_meter_register_entries_existing_identifier_idx').on(table.existingDeviceIdentifier),
  index('ww_meter_register_entries_new_identifier_idx').on(table.newDeviceIdentifier),
  index('ww_meter_register_entries_current_identifier_idx').on(table.currentDeviceIdentifier),
  index('ww_meter_register_entries_existing_device_idx').on(table.existingWattwatchersDeviceId),
  index('ww_meter_register_entries_new_device_idx').on(table.newWattwatchersDeviceId),
  index('ww_meter_register_entries_current_device_idx').on(table.currentWattwatchersDeviceId),
  index('ww_meter_register_entries_job_completion_idx').on(table.jobCompletionDate),
  index('ww_meter_register_entries_maas_start_idx').on(table.maasStartDate),
  index('ww_meter_register_entries_recurring_start_idx').on(table.recurringStartDate),
  index('ww_meter_register_entries_invoice_issue_idx').on(table.invoiceIssuedDate),
  index('ww_meter_register_entries_recurring_next_idx').on(table.recurringNextInvoiceIssueDate),
  index('ww_meter_register_entries_issued_period_next_idx').on(table.issuedPeriodNextInvoiceIssueDate),
  index('ww_meter_register_entries_customer_idx').on(table.customerNameSnapshot),
  index('ww_meter_register_entries_client_idx').on(table.clientNameSnapshot),
  check('ww_meter_register_entries_source_check', sql`
    ${table.sourceRow} >= 2
    AND char_length(btrim(${table.sourceKey})) >= 1
    AND char_length(${table.sourceRowSha256}) = 64
    AND ${table.sourceRowSha256} ~ '^[0-9a-f]{64}$'
  `),
  check('ww_meter_register_entries_classification_check', sql`
    ${table.existingDeviceClassification} IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
    AND ${table.newDeviceClassification} IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
    AND ${table.currentDeviceClassification} IN ('absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware')
  `),
  check('ww_meter_register_entries_identifier_check', sql`
    ((${table.existingDeviceIdentifier} IS NULL) = (${table.existingDeviceClassification} = 'absent'))
    AND ((${table.newDeviceIdentifier} IS NULL) = (${table.newDeviceClassification} = 'absent'))
    AND ((${table.currentDeviceIdentifier} IS NULL) = (${table.currentDeviceClassification} = 'absent'))
    AND ${table.currentDeviceIdentifier} IS NOT DISTINCT FROM coalesce(
      ${table.newDeviceIdentifier},
      ${table.existingDeviceIdentifier}
    )
    AND ${table.currentDeviceClassification} = CASE
      WHEN ${table.newDeviceIdentifier} IS NOT NULL THEN ${table.newDeviceClassification}
      WHEN ${table.existingDeviceIdentifier} IS NOT NULL THEN ${table.existingDeviceClassification}
      ELSE 'absent'
    END
  `),
  check('ww_meter_register_entries_device_link_check', sql`
    ((${table.existingWattwatchersDeviceId} IS NULL) = (${table.existingDeviceClassification} <> 'confirmed_wattwatchers'))
    AND ((${table.newWattwatchersDeviceId} IS NULL) = (${table.newDeviceClassification} <> 'confirmed_wattwatchers'))
    AND ((${table.currentWattwatchersDeviceId} IS NULL) = (${table.currentDeviceClassification} <> 'confirmed_wattwatchers'))
    AND ${table.currentWattwatchersDeviceId} IS NOT DISTINCT FROM CASE
      WHEN ${table.newDeviceIdentifier} IS NOT NULL THEN ${table.newWattwatchersDeviceId}
      ELSE ${table.existingWattwatchersDeviceId}
    END
  `),
]);

export const wwCollectionRuns = pgTable('ww_collection_runs', {
  id: text('id').primaryKey(),
  sourceRunKey: text('source_run_key').notNull(),
  collectorVersion: text('collector_version'),
  trigger: text('trigger').notNull().default('scheduled'),
  reportingDate: date('reporting_date').notNull(),
  timezone: text('timezone').notNull().default('Australia/Melbourne'),
  delayedThresholdMinutes: integer('delayed_threshold_minutes').notNull().default(15),
  offlineThresholdMinutes: integer('offline_threshold_minutes').notNull().default(60),
  reportOfflineThresholdHours: integer('report_offline_threshold_hours').notNull().default(24),
  inventoryScope: text('inventory_scope').notNull().default('partial'),
  status: text('status').notNull().default('collecting'),
  scheduledFor: instant('scheduled_for'),
  startedAt: instant('started_at').notNull().defaultNow(),
  finishedAt: instant('finished_at'),
  publishedAt: instant('published_at'),
  configuredClientCount: integer('configured_client_count').notNull().default(0),
  successfulClientCount: integer('successful_client_count').notNull().default(0),
  failedClientCount: integer('failed_client_count').notNull().default(0),
  rawDeviceCount: integer('raw_device_count').notNull().default(0),
  totalDevices: integer('total_devices').notNull().default(0),
  communicatingCount: integer('communicating_count').notNull().default(0),
  delayedCount: integer('delayed_count').notNull().default(0),
  offlineCount: integer('offline_count').notNull().default(0),
  inactiveCount: integer('inactive_count').notNull().default(0),
  unknownCount: integer('unknown_count').notNull().default(0),
  reportOfflineCount: integer('report_offline_count').notNull().default(0),
  reportNewlyOfflineCount: integer('report_newly_offline_count').notNull().default(0),
  reportRecoveredCount: integer('report_recovered_count').notNull().default(0),
  reportStillOfflineCount: integer('report_still_offline_count').notNull().default(0),
  maasTotalCount: integer('maas_total_count').notNull().default(0),
  maasReportOfflineCount: integer('maas_report_offline_count').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  rateLimitCount: integer('rate_limit_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  errorSummary: text('error_summary'),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_collection_runs_source_key_unique').on(table.sourceRunKey),
  index('ww_collection_runs_published_idx').on(table.status, table.publishedAt),
  index('ww_collection_runs_reporting_date_idx').on(table.reportingDate),
]);

export const wwClientRunResults = pgTable('ww_client_run_results', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => wwCollectionRuns.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => wwClients.id),
  status: text('status').notNull().default('pending'),
  startedAt: instant('started_at'),
  finishedAt: instant('finished_at'),
  requestedDeviceCount: integer('requested_device_count').notNull().default(0),
  fetchedDeviceCount: integer('fetched_device_count').notNull().default(0),
  communicatingCount: integer('communicating_count').notNull().default(0),
  delayedCount: integer('delayed_count').notNull().default(0),
  offlineCount: integer('offline_count').notNull().default(0),
  inactiveCount: integer('inactive_count').notNull().default(0),
  unknownCount: integer('unknown_count').notNull().default(0),
  reportOfflineCount: integer('report_offline_count').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  rateLimitCount: integer('rate_limit_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  error: text('error'),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_client_run_results_unique').on(table.runId, table.clientId),
  index('ww_client_run_results_run_status_idx').on(table.runId, table.status),
]);

export const wwDeviceObservations = pgTable('ww_device_observations', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => wwCollectionRuns.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => wwDevices.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => wwClients.id),
  observedAt: instant('observed_at').notNull(),
  lastHeardAt: instant('last_heard_at'),
  latestStatusAt: instant('latest_status_at'),
  communicationAgeSeconds: integer('communication_age_seconds'),
  status: text('status').notNull(),
  reportOffline: boolean('report_offline').notNull().default(false),
  reportTransition: text('report_transition'),
  fetchStatus: text('fetch_status').notNull().default('ok'),
  fetchError: text('fetch_error'),
  uninitialised: boolean('uninitialised').notNull().default(false),
  isMaas: boolean('is_maas').notNull().default(false),
  labelSnapshot: text('label_snapshot'),
  modelSnapshot: text('model_snapshot'),
  installDateSnapshot: date('install_date_snapshot'),
  firmwareVersion: text('firmware_version'),
  deviceTimezone: text('device_timezone'),
  commsType: text('comms_type'),
  commsMode: text('comms_mode'),
  lastHeardVia: text('last_heard_via'),
  signalQualityDbm: real('signal_quality_dbm'),
  cellQuality: real('cell_quality'),
  metrics: jsonb('metrics').notNull().$type<Record<string, unknown>>().default({}),
  rawStatus: jsonb('raw_status').notNull().$type<Record<string, unknown>>().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_device_observations_unique').on(table.runId, table.deviceId),
  index('ww_device_observations_run_status_idx').on(table.runId, table.status),
  index('ww_device_observations_run_report_idx').on(table.runId, table.reportOffline),
  index('ww_device_observations_device_time_idx').on(table.deviceId, table.observedAt),
  index('ww_device_observations_client_status_idx').on(table.clientId, table.status),
]);

/**
 * Immutable attribution captured for a particular observation. A device can
 * be visible through several Wattwatchers accounts; this prevents later
 * membership/name changes from rewriting historical client-filtered reports.
 */
export const wwObservationClients = pgTable('ww_observation_clients', {
  id: text('id').primaryKey(),
  observationId: text('observation_id').notNull().references(() => wwDeviceObservations.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => wwCollectionRuns.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => wwDevices.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => wwClients.id),
  clientCodeSnapshot: text('client_code_snapshot').notNull(),
  clientNameSnapshot: text('client_name_snapshot').notNull(),
  isMaas: boolean('is_maas').notNull().default(false),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_observation_clients_unique').on(table.observationId, table.clientId),
  index('ww_observation_clients_run_client_idx').on(table.runId, table.clientId, table.deviceId),
  index('ww_observation_clients_device_idx').on(table.deviceId, table.runId),
]);

export const wwOutages = pgTable('ww_outages', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => wwDevices.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => wwClients.id),
  openedRunId: text('opened_run_id').notNull().references(() => wwCollectionRuns.id),
  closedRunId: text('closed_run_id').references(() => wwCollectionRuns.id),
  telemetryStoppedAt: instant('telemetry_stopped_at'),
  thresholdQualifiedAt: instant('threshold_qualified_at'),
  firstDetectedAt: instant('first_detected_at').notNull(),
  lastConfirmedAt: instant('last_confirmed_at').notNull(),
  recoveredAt: instant('recovered_at'),
  durationSeconds: integer('duration_seconds'),
  closeReason: text('close_reason'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  index('ww_outages_device_idx').on(table.deviceId, table.firstDetectedAt),
  index('ww_outages_open_idx').on(table.closedRunId, table.lastConfirmedAt),
  index('ww_outages_client_idx').on(table.clientId, table.firstDetectedAt),
]);

export const wwReports = pgTable('ww_reports', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => wwCollectionRuns.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('generated'),
  subject: text('subject'),
  renderedHtml: text('rendered_html'),
  csvFilename: text('csv_filename'),
  summary: jsonb('summary').notNull().$type<Record<string, unknown>>().default({}),
  generatedAt: instant('generated_at').notNull().defaultNow(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_reports_run_unique').on(table.runId),
  index('ww_reports_generated_idx').on(table.generatedAt),
]);

export const wwReportDeliveries = pgTable('ww_report_deliveries', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => wwReports.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(),
  channel: text('channel').notNull(),
  status: text('status').notNull(),
  attemptedAt: instant('attempted_at').notNull().defaultNow(),
  sentAt: instant('sent_at'),
  recipientCount: integer('recipient_count').notNull().default(0),
  error: text('error'),
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_report_deliveries_idempotency_unique').on(table.idempotencyKey),
  index('ww_report_deliveries_report_idx').on(table.reportId, table.attemptedAt),
]);
