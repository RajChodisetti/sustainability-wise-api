import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
  metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ww_clients_code_unique').on(table.code),
  index('ww_clients_name_idx').on(table.normalizedName),
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
