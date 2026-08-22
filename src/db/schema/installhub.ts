import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const syncColumns = {
  serverId: text('server_id'),
  syncStatus: text('sync_status').notNull().default('local'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
};

export const ihUsers = pgTable('ih_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull().default('inspector'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const ihInstallations = pgTable('ih_installations', {
  id: text('id').primaryKey(),
  ...syncColumns,
  externalKey: text('external_key')
    .notNull()
    .default(sql`'ih_' || gen_random_uuid()::text`),
  siteCode: text('site_code').notNull().default('SITE'),
  timezone: text('timezone').notNull().default('Australia/Sydney'),
  treeSchemaVersion: integer('tree_schema_version').notNull().default(1),
  treeRevision: integer('tree_revision').notNull().default(0),
  recordVersionNumber: integer('record_version_number').notNull().default(0),
  electricalMapLayout: jsonb('electrical_map_layout'),
  electricalMapLayoutRevision: integer('electrical_map_layout_revision').notNull().default(0),
  electricalMapLayoutUpdatedAt: timestamp('electrical_map_layout_updated_at'),
  customerName: text('customer_name'),
  clientName: text('client_name').notNull(),
  maas: boolean('maas'),
  serviceType: text('service_type'),
  meteringSolutionType: text('metering_solution_type'),
  plannedMeterType: text('planned_meter_type'),
  siteName: text('site_name').notNull(),
  siteAddress: text('site_address').notNull(),
  siteLocality: text('site_locality'),
  siteState: text('site_state'),
  sitePostcode: text('site_postcode'),
  siteCountryCode: text('site_country_code'),
  siteLatitude: doublePrecision('site_latitude'),
  siteLongitude: doublePrecision('site_longitude'),
  siteGeocodeStatus: text('site_geocode_status'),
  siteGeocodeProvider: text('site_geocode_provider'),
  siteGeocodePlaceId: text('site_geocode_place_id'),
  siteAddressFingerprint: text('site_address_fingerprint'),
  siteGeocodedAt: timestamp('site_geocoded_at'),
  siteContactName: text('site_contact_name'),
  siteContactPhone: text('site_contact_phone'),
  siteContactEmail: text('site_contact_email'),
  fergusJobNumber: text('fergus_job_number'),
  quoteNumber: text('quote_number'),
  jobComments: text('job_comments'),
  accessInformation: text('access_information'),
  warrantyDevice: boolean('warranty_device'),
  monitoringInstalled: boolean('monitoring_installed'),
  hardwareInstalled: boolean('hardware_installed'),
  solarCapacityKw: doublePrecision('solar_capacity_kw'),
  additionalMonitoringRequired: boolean('additional_monitoring_required'),
  additionalMonitoringHardware: text('additional_monitoring_hardware'),
  inspectorName: text('inspector_name').notNull(),
  auditDate: text('audit_date').notNull(),
  status: text('status').notNull().default('Draft'),
  createdByUserId: text('created_by_user_id'),
  assignedInspectorUserId: text('assigned_inspector_user_id'),
  completedAt: timestamp('completed_at'),
  completedByUserId: text('completed_by_user_id'),
  completedFromRevision: integer('completed_from_revision'),
  completionNotes: text('completion_notes'),
  reopenedAt: timestamp('reopened_at'),
  reopenedByUserId: text('reopened_by_user_id'),
  reopenedFromVersionNumber: integer('reopened_from_version_number'),
  reopenReason: text('reopen_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ih_installations_external_key_unique').on(table.externalKey),
  index('ih_installations_owner_idx').on(table.createdByUserId, table.updatedAt),
  index('ih_installations_assignee_idx').on(table.assignedInspectorUserId, table.updatedAt),
  index('ih_installations_analytics_completed_idx').on(table.completedAt).where(sql`
    ${table.completedAt} IS NOT NULL AND ${table.deletedAt} IS NULL
  `),
  index('ih_installations_analytics_undated_completed_idx').on(table.id).where(sql`
    ${table.status} = 'Completed' AND ${table.completedAt} IS NULL
  `),
  check('ih_installations_tree_schema_version_check', sql`${table.treeSchemaVersion} IN (1, 2)`),
  check('ih_installations_tree_revision_check', sql`${table.treeRevision} >= 0`),
  check('ih_installations_record_version_check', sql`${table.recordVersionNumber} >= 0`),
  check('ih_installations_electrical_map_layout_revision_check', sql`${table.electricalMapLayoutRevision} >= 0`),
  check('ih_installations_status_check', sql`${table.status} IN ('Draft', 'Completed')`),
  check('ih_installations_customer_name_length_check', sql`
    ${table.customerName} IS NULL
    OR char_length(btrim(${table.customerName})) BETWEEN 1 AND 300
  `),
  check('ih_installations_service_type_length_check', sql`
    ${table.serviceType} IS NULL
    OR char_length(btrim(${table.serviceType})) BETWEEN 1 AND 120
  `),
  check('ih_installations_metering_solution_type_length_check', sql`
    ${table.meteringSolutionType} IS NULL
    OR char_length(btrim(${table.meteringSolutionType})) BETWEEN 1 AND 120
  `),
  check('ih_installations_planned_meter_type_length_check', sql`
    ${table.plannedMeterType} IS NULL
    OR char_length(btrim(${table.plannedMeterType})) BETWEEN 1 AND 120
  `),
  check('ih_installations_site_contact_name_length_check', sql`
    ${table.siteContactName} IS NULL
    OR char_length(btrim(${table.siteContactName})) BETWEEN 1 AND 300
  `),
  check('ih_installations_site_contact_phone_length_check', sql`
    ${table.siteContactPhone} IS NULL
    OR char_length(btrim(${table.siteContactPhone})) BETWEEN 1 AND 50
  `),
  check('ih_installations_site_contact_email_length_check', sql`
    ${table.siteContactEmail} IS NULL
    OR char_length(btrim(${table.siteContactEmail})) BETWEEN 1 AND 320
  `),
  check('ih_installations_fergus_job_number_length_check', sql`
    ${table.fergusJobNumber} IS NULL
    OR char_length(btrim(${table.fergusJobNumber})) BETWEEN 1 AND 100
  `),
  check('ih_installations_quote_number_length_check', sql`
    ${table.quoteNumber} IS NULL
    OR char_length(btrim(${table.quoteNumber})) BETWEEN 1 AND 100
  `),
  check('ih_installations_job_comments_length_check', sql`
    ${table.jobComments} IS NULL
    OR char_length(btrim(${table.jobComments})) BETWEEN 1 AND 5000
  `),
  check('ih_installations_access_information_length_check', sql`
    ${table.accessInformation} IS NULL
    OR char_length(btrim(${table.accessInformation})) BETWEEN 1 AND 5000
  `),
  check('ih_installations_solar_capacity_kw_check', sql`
    ${table.solarCapacityKw} IS NULL
    OR (${table.solarCapacityKw} >= 0 AND ${table.solarCapacityKw} <= 1000000)
  `),
  check('ih_installations_additional_monitoring_hardware_length_check', sql`
    ${table.additionalMonitoringHardware} IS NULL
    OR char_length(btrim(${table.additionalMonitoringHardware})) BETWEEN 1 AND 5000
  `),
  check(
    'ih_installations_completion_notes_length_check',
    sql`${table.completionNotes} IS NULL OR char_length(${table.completionNotes}) <= 2000`,
  ),
  check('ih_installations_external_key_nonempty_check', sql`length(btrim(${table.externalKey})) > 0`),
  check('ih_installations_site_country_check', sql`
    ${table.siteCountryCode} IS NULL OR ${table.siteCountryCode} = 'AU'
  `),
  check('ih_installations_site_state_check', sql`
    ${table.siteState} IS NULL OR ${table.siteState} IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  `),
  check('ih_installations_site_postcode_check', sql`
    ${table.sitePostcode} IS NULL OR ${table.sitePostcode} ~ '^[0-9]{4}$'
  `),
  check('ih_installations_site_coordinates_check', sql`
    (${table.siteLatitude} IS NULL AND ${table.siteLongitude} IS NULL)
    OR (
      ${table.siteLatitude} IS NOT NULL
      AND ${table.siteLongitude} IS NOT NULL
      AND ${table.siteLatitude} BETWEEN -44 AND -9
      AND ${table.siteLongitude} BETWEEN 112 AND 154
    )
  `),
  check('ih_installations_site_geocode_status_check', sql`
    ${table.siteGeocodeStatus} IS NULL
    OR ${table.siteGeocodeStatus} IN ('unresolved', 'resolved', 'manual', 'failed')
  `),
  check('ih_installations_site_geocode_evidence_check', sql`
    (${table.siteGeocodeStatus} IS DISTINCT FROM 'resolved')
    OR (${table.siteLatitude} IS NOT NULL AND ${table.siteLongitude} IS NOT NULL)
  `),
  check('ih_installations_site_address_fingerprint_check', sql`
    ${table.siteAddressFingerprint} IS NULL
    OR ${table.siteAddressFingerprint} ~ '^[0-9a-f]{64}$'
  `),
]);

export const ihInstallationWorkSessions = pgTable('ih_installation_work_sessions', {
  id: text('id').notNull(),
  installationId: text('installation_id')
    .notNull()
    .references(() => ihInstallations.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').notNull(),
  startedAt: timestamp('started_at').notNull(),
  lastActiveAt: timestamp('last_active_at').notNull(),
  endedAt: timestamp('ended_at'),
  activeMilliseconds: bigint('active_milliseconds', { mode: 'number' }).notNull(),
  revision: integer('revision').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({
    columns: [table.installationId, table.id],
    name: 'ih_installation_work_sessions_pk',
  }),
  index('ih_installation_work_sessions_installation_actor_idx').on(
    table.installationId,
    table.actorUserId,
    table.updatedAt,
  ),
  index('ih_installation_work_sessions_analytics_boundary_idx').on(
    sql`coalesce(${table.endedAt}, ${table.lastActiveAt})`,
  ),
  check(
    'ih_installation_work_sessions_active_milliseconds_check',
    sql`${table.activeMilliseconds} >= 0`,
  ),
  check('ih_installation_work_sessions_revision_check', sql`${table.revision} >= 0`),
  check(
    'ih_installation_work_sessions_time_order_check',
    sql`${table.startedAt} <= ${table.lastActiveAt}
      AND (${table.endedAt} IS NULL OR ${table.lastActiveAt} <= ${table.endedAt})`,
  ),
]);

export const ihGridSupplies = pgTable('ih_grid_supplies', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  nmi: text('nmi'),
  externalKey: text('external_key'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_grid_supplies_installation_idx').on(table.installationId),
  uniqueIndex('ih_grid_supplies_installation_id_unique').on(table.installationId, table.id),
  uniqueIndex('ih_grid_supplies_installation_external_key_unique').on(
    table.installationId,
    table.externalKey,
  ),
  uniqueIndex('ih_grid_supplies_one_active_default_unique')
    .on(table.installationId)
    .where(sql`${table.isDefault} = true AND ${table.deletedAt} IS NULL`),
  check('ih_grid_supplies_nmi_length_check', sql`
    ${table.nmi} IS NULL OR char_length(btrim(${table.nmi})) BETWEEN 1 AND 100
  `),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_grid_supplies_installation_fk',
  }).onDelete('restrict'),
]);

export const ihZones = pgTable('ih_zones', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneCode: text('zone_code').notNull().default('ZONE'),
  zoneName: text('zone_name').notNull(),
  zoneDescription: text('zone_description').notNull().default(''),
  photos: jsonb('photos').notNull().default([]).$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_zones_installation_idx').on(table.installationId),
  uniqueIndex('ih_zones_installation_id_unique').on(table.installationId, table.id),
  uniqueIndex('ih_zones_active_code_unique')
    .on(table.installationId, table.zoneCode)
    .where(sql`${table.deletedAt} IS NULL`),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_zones_installation_fk',
  }).onDelete('restrict'),
]);

export const ihElectricalAssets = pgTable('ih_electrical_assets', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneId: text('zone_id').notNull(),
  assetName: text('asset_name').notNull(),
  displayCode: text('display_code').notNull(),
  generatedDisplayCode: text('generated_display_code'),
  displayCodeOverridden: boolean('display_code_overridden').notNull().default(false),
  displayCodeRuleVersion: integer('display_code_rule_version').notNull().default(1),
  displayCodeOverrideReason: text('display_code_override_reason'),
  assetType: text('asset_type').notNull(),
  typeCode: text('type_code').notNull().default('OTHER'),
  customTypeName: text('custom_type_name'),
  sourceKind: text('source_kind').notNull().default('LEGACY'),
  gridSupplyId: text('grid_supply_id'),
  electricalParentId: text('electrical_parent_id'),
  electricalParentTbc: boolean('electrical_parent_tbc').notNull().default(false),
  locationDescription: text('location_description'),
  phase: text('phase'),
  amperageRating: text('amperage_rating'),
  siteNmi: text('site_nmi'),
  photo: text('photo'),
  extraPhotos: jsonb('extra_photos').notNull().default([]).$type<string[]>(),
  meterPresent: boolean('meter_present').notNull().default(false),
  meters: jsonb('meters').notNull().default([]).$type<unknown[]>(),
  subCircuitsDescription: text('sub_circuits_description'),
  comments: text('comments'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_electrical_assets_installation_idx').on(table.installationId),
  index('ih_electrical_assets_zone_idx').on(table.zoneId),
  uniqueIndex('ih_electrical_assets_installation_id_unique').on(table.installationId, table.id),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_electrical_assets_installation_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.zoneId],
    foreignColumns: [ihZones.installationId, ihZones.id],
    name: 'ih_electrical_assets_zone_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.gridSupplyId],
    foreignColumns: [ihGridSupplies.installationId, ihGridSupplies.id],
    name: 'ih_electrical_assets_grid_supply_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.electricalParentId],
    foreignColumns: [table.installationId, table.id],
    name: 'ih_electrical_assets_parent_fk',
  }).onDelete('restrict'),
  check('ih_electrical_assets_source_check', sql`
    (${table.sourceKind} = 'GRID' AND ${table.gridSupplyId} IS NOT NULL AND ${table.electricalParentId} IS NULL AND ${table.electricalParentTbc} = false)
    OR (${table.sourceKind} = 'BOARD' AND ${table.gridSupplyId} IS NULL AND ${table.electricalParentId} IS NOT NULL AND ${table.electricalParentTbc} = false)
    OR (${table.sourceKind} = 'TBC' AND ${table.gridSupplyId} IS NULL AND ${table.electricalParentId} IS NULL AND ${table.electricalParentTbc} = true)
    OR (${table.sourceKind} = 'LEGACY' AND ${table.gridSupplyId} IS NULL)
  `),
]);

export const ihSiteAssets = pgTable('ih_site_assets', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneId: text('zone_id').notNull(),
  assetName: text('asset_name').notNull(),
  assetType: text('asset_type').notNull(),
  typeCode: text('type_code').notNull().default('OTHER'),
  customTypeName: text('custom_type_name'),
  sourceKind: text('source_kind').notNull().default('LEGACY'),
  gridSupplyId: text('grid_supply_id'),
  electricalBoardId: text('electrical_board_id'),
  electricalBoardTbc: boolean('electrical_board_tbc').notNull().default(false),
  locationDescription: text('location_description'),
  locationPhoto: text('location_photo'),
  displayCode: text('display_code'),
  generatedDisplayCode: text('generated_display_code'),
  displayCodeOverridden: boolean('display_code_overridden').notNull().default(false),
  displayCodeRuleVersion: integer('display_code_rule_version').notNull().default(1),
  displayCodeOverrideReason: text('display_code_override_reason'),
  meteringStateKind: text('metering_state_kind').notNull().default('TBC'),
  measurementAssignmentIds: jsonb('measurement_assignment_ids').notNull().default([]).$type<string[]>(),
  meterPresent: boolean('meter_present').notNull().default(false),
  meterSwitchboardId: text('meter_switchboard_id'),
  meterSwitchboardTbc: boolean('meter_switchboard_tbc').notNull().default(false),
  meterChannels: jsonb('meter_channels').notNull().default([]).$type<unknown[]>(),
  comments: text('comments'),
  extraPhotos: jsonb('extra_photos').notNull().default([]).$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_site_assets_installation_idx').on(table.installationId),
  index('ih_site_assets_zone_idx').on(table.zoneId),
  uniqueIndex('ih_site_assets_installation_id_unique').on(table.installationId, table.id),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_site_assets_installation_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.zoneId],
    foreignColumns: [ihZones.installationId, ihZones.id],
    name: 'ih_site_assets_zone_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.gridSupplyId],
    foreignColumns: [ihGridSupplies.installationId, ihGridSupplies.id],
    name: 'ih_site_assets_grid_supply_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.electricalBoardId],
    foreignColumns: [ihElectricalAssets.installationId, ihElectricalAssets.id],
    name: 'ih_site_assets_source_board_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.meterSwitchboardId],
    foreignColumns: [ihElectricalAssets.installationId, ihElectricalAssets.id],
    name: 'ih_site_assets_meter_board_fk',
  }).onDelete('restrict'),
  check('ih_site_assets_source_check', sql`
    (${table.sourceKind} = 'GRID' AND ${table.gridSupplyId} IS NOT NULL AND ${table.electricalBoardId} IS NULL AND ${table.electricalBoardTbc} = false)
    OR (${table.sourceKind} = 'BOARD' AND ${table.gridSupplyId} IS NULL AND ${table.electricalBoardId} IS NOT NULL AND ${table.electricalBoardTbc} = false)
    OR (${table.sourceKind} = 'TBC' AND ${table.gridSupplyId} IS NULL AND ${table.electricalBoardId} IS NULL AND ${table.electricalBoardTbc} = true)
    OR (${table.sourceKind} = 'LEGACY' AND ${table.gridSupplyId} IS NULL)
  `),
  check('ih_site_assets_metering_state_check', sql`
    ${table.meteringStateKind} IN ('METERED', 'UNMETERED', 'TBC')
  `),
]);

export const ihMeterDevices = pgTable('ih_meter_devices', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  installedOnBoardId: text('installed_on_board_id').notNull(),
  customName: text('custom_name').notNull().default('Meter'),
  deviceFamily: text('device_family').notNull(),
  deviceModel: text('device_model').notNull(),
  customManufacturerName: text('custom_manufacturer_name'),
  customModelName: text('custom_model_name'),
  deviceNumber: text('device_number'),
  serialNumber: text('serial_number').notNull(),
  displayCode: text('display_code'),
  generatedDisplayCode: text('generated_display_code'),
  displayCodeOverridden: boolean('display_code_overridden').notNull().default(false),
  displayCodeRuleVersion: integer('display_code_rule_version').notNull().default(1),
  displayCodeOverrideReason: text('display_code_override_reason'),
  commissioningData: jsonb('commissioning_data').$type<Record<string, unknown>>(),
  wwPhotos: jsonb('ww_photos').notNull().default({}).$type<Record<string, unknown>>(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_meter_devices_installation_idx').on(table.installationId),
  index('ih_meter_devices_board_idx').on(table.installedOnBoardId),
  uniqueIndex('ih_meter_devices_installation_id_unique').on(table.installationId, table.id),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_meter_devices_installation_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.installedOnBoardId],
    foreignColumns: [ihElectricalAssets.installationId, ihElectricalAssets.id],
    name: 'ih_meter_devices_board_fk',
  }).onDelete('restrict'),
  check('ih_meter_devices_family_check', sql`${table.deviceFamily} IN ('WATTWATCHERS', 'OTHER')`),
  check('ih_meter_devices_model_check', sql`${table.deviceModel} IN ('A3RM', 'A6M', 'OTHER')`),
]);

export const ihMeterChannels = pgTable('ih_meter_channels', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  meterId: text('meter_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  phaseLabel: text('phase_label'),
  purpose: text('purpose').notNull(),
  loadTypeCode: text('load_type_code'),
  customLoadTypeName: text('custom_load_type_name'),
  sensorRating: text('sensor_rating'),
  description: text('description'),
  capabilities: jsonb('capabilities').notNull().default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_meter_channels_installation_idx').on(table.installationId),
  uniqueIndex('ih_meter_channels_installation_id_unique').on(table.installationId, table.id),
  uniqueIndex('ih_meter_channels_installation_meter_id_unique').on(
    table.installationId,
    table.meterId,
    table.id,
  ),
  uniqueIndex('ih_meter_channels_meter_ordinal_unique').on(table.meterId, table.ordinal),
  foreignKey({
    columns: [table.installationId, table.meterId],
    foreignColumns: [ihMeterDevices.installationId, ihMeterDevices.id],
    name: 'ih_meter_channels_meter_fk',
  }).onDelete('restrict'),
  check('ih_meter_channels_ordinal_check', sql`${table.ordinal} > 0`),
  check('ih_meter_channels_purpose_check', sql`${table.purpose} IN ('MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE')`),
]);

export const ihMeasurementAssignments = pgTable('ih_measurement_assignments', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  meterId: text('meter_id').notNull(),
  phaseMode: text('phase_mode').notNull(),
  targetKind: text('target_kind').notNull(),
  targetBoardId: text('target_board_id'),
  targetSiteAssetId: text('target_site_asset_id'),
  targetGridSupplyId: text('target_grid_supply_id'),
  direction: text('direction').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_measurement_assignments_installation_idx').on(table.installationId),
  index('ih_measurement_assignments_meter_idx').on(table.meterId),
  index('ih_measurement_assignments_board_idx').on(table.targetBoardId),
  index('ih_measurement_assignments_asset_idx').on(table.targetSiteAssetId),
  uniqueIndex('ih_measurement_assignments_installation_id_unique').on(table.installationId, table.id),
  uniqueIndex('ih_measurement_assignments_installation_meter_id_unique').on(
    table.installationId,
    table.meterId,
    table.id,
  ),
  foreignKey({
    columns: [table.installationId, table.meterId],
    foreignColumns: [ihMeterDevices.installationId, ihMeterDevices.id],
    name: 'ih_measurement_assignments_meter_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.targetBoardId],
    foreignColumns: [ihElectricalAssets.installationId, ihElectricalAssets.id],
    name: 'ih_measurement_assignments_board_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.targetSiteAssetId],
    foreignColumns: [ihSiteAssets.installationId, ihSiteAssets.id],
    name: 'ih_measurement_assignments_asset_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.targetGridSupplyId],
    foreignColumns: [ihGridSupplies.installationId, ihGridSupplies.id],
    name: 'ih_measurement_assignments_grid_fk',
  }).onDelete('restrict'),
  check('ih_measurement_assignments_phase_check', sql`${table.phaseMode} IN ('SINGLE_PHASE', 'THREE_PHASE', 'OTHER')`),
  check('ih_measurement_assignments_direction_check', sql`${table.direction} IN ('CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL')`),
  check('ih_measurement_assignments_target_check', sql`
    (${table.targetKind} = 'BOARD' AND ${table.targetBoardId} IS NOT NULL AND ${table.targetSiteAssetId} IS NULL AND ${table.targetGridSupplyId} IS NULL AND ${table.status} = 'CONFIRMED')
    OR (${table.targetKind} = 'SITE_ASSET' AND ${table.targetBoardId} IS NULL AND ${table.targetSiteAssetId} IS NOT NULL AND ${table.targetGridSupplyId} IS NULL AND ${table.status} = 'CONFIRMED')
    OR (${table.targetKind} = 'GRID_BOUNDARY' AND ${table.targetBoardId} IS NULL AND ${table.targetSiteAssetId} IS NULL AND ${table.targetGridSupplyId} IS NOT NULL AND ${table.status} = 'CONFIRMED')
    OR (${table.targetKind} = 'TBC' AND ${table.targetBoardId} IS NULL AND ${table.targetSiteAssetId} IS NULL AND ${table.targetGridSupplyId} IS NULL AND ${table.status} = 'TBC')
  `),
]);

export const ihMeasurementAssignmentChannels = pgTable(
  'ih_measurement_assignment_channels',
  {
    id: text('id').primaryKey(),
    installationId: text('installation_id').notNull(),
    assignmentId: text('assignment_id').notNull(),
    meterId: text('meter_id').notNull(),
    channelId: text('channel_id').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('ih_assignment_channels_installation_idx').on(table.installationId),
    uniqueIndex('ih_assignment_channels_assignment_position_unique').on(
      table.assignmentId,
      table.position,
    ),
    uniqueIndex('ih_assignment_channels_assignment_channel_unique').on(
      table.assignmentId,
      table.channelId,
    ),
    uniqueIndex('ih_assignment_channels_active_channel_unique').on(table.channelId),
    foreignKey({
      columns: [table.installationId, table.meterId, table.assignmentId],
      foreignColumns: [
        ihMeasurementAssignments.installationId,
        ihMeasurementAssignments.meterId,
        ihMeasurementAssignments.id,
      ],
      name: 'ih_assignment_channels_assignment_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.installationId, table.meterId, table.channelId],
      foreignColumns: [
        ihMeterChannels.installationId,
        ihMeterChannels.meterId,
        ihMeterChannels.id,
      ],
      name: 'ih_assignment_channels_channel_fk',
    }).onDelete('restrict'),
  ],
);

export const ihFormSubmissions = pgTable('ih_form_submissions', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  formType: text('form_type').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  status: text('status').notNull().default('Draft'),
  zoneId: text('zone_id'),
  boardId: text('board_id'),
  meterId: text('meter_id'),
  siteAssetId: text('site_asset_id'),
  answers: jsonb('answers').notNull().default({}).$type<Record<string, string>>(),
  attachments: jsonb('attachments').notNull().default([]).$type<unknown[]>(),
  completedAt: timestamp('completed_at'),
  supersedesId: text('supersedes_id'),
  historicalMeterRemoved: boolean('historical_meter_removed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_form_submissions_installation_idx').on(table.installationId),
  index('ih_form_submissions_type_idx').on(table.formType, table.status),
  uniqueIndex('ih_form_submissions_installation_id_unique').on(table.installationId, table.id),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_form_submissions_installation_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.zoneId],
    foreignColumns: [ihZones.installationId, ihZones.id],
    name: 'ih_form_submissions_zone_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.boardId],
    foreignColumns: [ihElectricalAssets.installationId, ihElectricalAssets.id],
    name: 'ih_form_submissions_board_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.meterId],
    foreignColumns: [ihMeterDevices.installationId, ihMeterDevices.id],
    name: 'ih_form_submissions_meter_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.siteAssetId],
    foreignColumns: [ihSiteAssets.installationId, ihSiteAssets.id],
    name: 'ih_form_submissions_site_asset_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.supersedesId],
    foreignColumns: [table.installationId, table.id],
    name: 'ih_form_submissions_supersedes_fk',
  }).onDelete('restrict'),
  check('ih_form_submissions_status_check', sql`${table.status} IN ('Draft', 'Completed')`),
  check('ih_form_submissions_schema_version_check', sql`${table.schemaVersion} IN (1, 2)`),
]);

/**
 * Append-only provenance for meter state transitions. Full restorable state
 * remains in the authoritative installation record_versions snapshots; these
 * rows identify why a pair of immutable versions was created without storing
 * a second copy of the device payload.
 */
export const ihMeterHistoryEvents = pgTable('ih_meter_history_events', {
  id: text('id').primaryKey(),
  installationId: text('installation_id').notNull(),
  meterId: text('meter_id').notNull(),
  operation: text('operation').notNull(),
  sourceFormSubmissionId: text('source_form_submission_id'),
  fromRecordVersionNumber: integer('from_record_version_number').notNull(),
  toRecordVersionNumber: integer('to_record_version_number').notNull(),
  restoredFromRecordVersionNumber: integer('restored_from_record_version_number'),
  reason: text('reason'),
  actorUserId: text('actor_user_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_meter_history_events_meter_idx').on(
    table.installationId,
    table.meterId,
    table.createdAt,
  ),
  index('ih_meter_history_events_version_idx').on(
    table.installationId,
    table.toRecordVersionNumber,
  ),
  uniqueIndex('ih_meter_history_events_source_form_unique')
    .on(table.installationId, table.sourceFormSubmissionId)
    .where(sql`${table.sourceFormSubmissionId} IS NOT NULL`),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_meter_history_events_installation_fk',
  }).onDelete('cascade'),
  check(
    'ih_meter_history_events_operation_check',
    sql`${table.operation} IN ('REPLACEMENT', 'ROLLBACK')`,
  ),
  check(
    'ih_meter_history_events_versions_check',
    sql`${table.fromRecordVersionNumber} > 0 AND ${table.toRecordVersionNumber} > 0`,
  ),
  check(
    'ih_meter_history_events_restored_version_check',
    sql`${table.restoredFromRecordVersionNumber} IS NULL OR ${table.restoredFromRecordVersionNumber} > 0`,
  ),
  check(
    'ih_meter_history_events_shape_check',
    sql`(
      ${table.operation} = 'REPLACEMENT'
      AND ${table.sourceFormSubmissionId} IS NOT NULL
      AND ${table.restoredFromRecordVersionNumber} IS NULL
      AND ${table.reason} IS NULL
    ) OR (
      ${table.operation} = 'ROLLBACK'
      AND ${table.sourceFormSubmissionId} IS NULL
      AND ${table.restoredFromRecordVersionNumber} IS NOT NULL
      AND length(btrim(${table.reason})) >= 3
    )`,
  ),
]);

/**
 * Retained claims make generated/overridden display codes non-reusable after
 * soft deletion. Current display metadata remains on the owning entity.
 */
export const ihDisplayCodeClaims = pgTable('ih_display_code_claims', {
  id: text('id').primaryKey(),
  installationId: text('installation_id').notNull(),
  zoneId: text('zone_id'),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  typeCode: text('type_code').notNull(),
  sequence: integer('sequence'),
  displayCode: text('display_code').notNull(),
  normalizedDisplayCode: text('normalized_display_code').notNull(),
  generated: boolean('generated').notNull().default(false),
  ruleVersion: integer('rule_version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ih_display_code_claims_installation_code_unique').on(
    table.installationId,
    table.normalizedDisplayCode,
  ),
  index('ih_display_code_claims_sequence_idx').on(
    table.installationId,
    table.typeCode,
    table.sequence,
  ),
  uniqueIndex('ih_display_code_claims_zone_sequence_unique')
    .on(table.installationId, table.zoneId, table.sequence)
    .where(sql`${table.ruleVersion} = 2 AND ${table.zoneId} IS NOT NULL AND ${table.sequence} IS NOT NULL`),
  index('ih_display_code_claims_entity_idx').on(
    table.installationId,
    table.entityType,
    table.entityId,
  ),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_display_code_claims_installation_fk',
  }).onDelete('restrict'),
  foreignKey({
    columns: [table.installationId, table.zoneId],
    foreignColumns: [ihZones.installationId, ihZones.id],
    name: 'ih_display_code_claims_zone_fk',
  }).onDelete('restrict'),
]);

export const ihCompletionIdempotency = pgTable('ih_completion_idempotency', {
  id: text('id').primaryKey(),
  installationId: text('installation_id').notNull(),
  operation: text('operation').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  completedFromRevision: integer('completed_from_revision').notNull(),
  resultingTreeRevision: integer('resulting_tree_revision').notNull(),
  recordVersionNumber: integer('record_version_number').notNull(),
  result: jsonb('result').notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ih_completion_idempotency_scope_unique').on(
    table.installationId,
    table.operation,
    table.actorUserId,
    table.idempotencyKey,
  ),
  index('ih_completion_idempotency_installation_idx').on(table.installationId),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_completion_idempotency_installation_fk',
  }).onDelete('restrict'),
]);

/** Job-level finance header (Fergus-style Financial Summary MVP). */
export const ihJobFinance = pgTable('ih_job_finance', {
  installationId: text('installation_id').primaryKey(),
  pricingMode: text('pricing_mode').notNull().default('charge_up'),
  pricedAmount: real('priced_amount'),
  currency: text('currency').notNull().default('AUD'),
  notes: text('notes'),
  updatedByUserId: text('updated_by_user_id'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  check('ih_job_finance_pricing_mode_check', sql`${table.pricingMode} IN ('quoted', 'charge_up')`),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_job_finance_installation_fk',
  }).onDelete('cascade'),
]);

/** Manual labour / material / other cost lines for an installation. */
export const ihJobCostLines = pgTable('ih_job_cost_lines', {
  id: text('id').primaryKey(),
  installationId: text('installation_id').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  costAmount: real('cost_amount').notNull().default(0),
  sellAmount: real('sell_amount'),
  hours: real('hours'),
  billable: boolean('billable').notNull().default(true),
  invoiced: boolean('invoiced').notNull().default(false),
  /** manual = user-entered; auto_labour = system day×hours×rate line */
  source: text('source').notNull().default('manual'),
  incurredAt: timestamp('incurred_at'),
  createdByUserId: text('created_by_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('ih_job_cost_lines_installation_idx').on(table.installationId),
  index('ih_job_cost_lines_installation_invoiced_idx').on(table.installationId, table.invoiced),
  check('ih_job_cost_lines_category_check', sql`${table.category} IN ('labour', 'material', 'other')`),
  check('ih_job_cost_lines_source_check', sql`${table.source} IN ('manual', 'auto_labour')`),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_job_cost_lines_installation_fk',
  }).onDelete('cascade'),
]);

/** Tax invoices generated from tracked cost lines (GST-inclusive totals on PDF). */
export const ihInvoices = pgTable('ih_invoices', {
  id: text('id').primaryKey(),
  installationId: text('installation_id').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  status: text('status').notNull().default('draft'),
  currency: text('currency').notNull().default('AUD'),
  issueDate: timestamp('issue_date'),
  dueDate: timestamp('due_date'),
  subtotalExGst: real('subtotal_ex_gst').notNull().default(0),
  gstAmount: real('gst_amount').notNull().default(0),
  totalIncGst: real('total_inc_gst').notNull().default(0),
  gstRate: real('gst_rate').notNull().default(0.1),
  notes: text('notes'),
  sellerName: text('seller_name'),
  sellerAbn: text('seller_abn'),
  sellerAddress: text('seller_address'),
  sellerEmail: text('seller_email'),
  createdByUserId: text('created_by_user_id'),
  issuedAt: timestamp('issued_at'),
  voidedAt: timestamp('voided_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ih_invoices_number_unique').on(table.invoiceNumber),
  index('ih_invoices_installation_idx').on(table.installationId),
  index('ih_invoices_installation_status_idx').on(table.installationId, table.status),
  check('ih_invoices_status_check', sql`${table.status} IN ('draft', 'issued', 'void')`),
  foreignKey({
    columns: [table.installationId],
    foreignColumns: [ihInstallations.id],
    name: 'ih_invoices_installation_fk',
  }).onDelete('cascade'),
]);

export const ihInvoiceLines = pgTable('ih_invoice_lines', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unitAmountExGst: real('unit_amount_ex_gst').notNull().default(0),
  lineTotalExGst: real('line_total_ex_gst').notNull().default(0),
  costLineId: text('cost_line_id'),
  category: text('category'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_invoice_lines_invoice_idx').on(table.invoiceId),
  index('ih_invoice_lines_cost_line_idx').on(table.costLineId),
  check('ih_invoice_lines_category_check', sql`${table.category} IS NULL OR ${table.category} IN ('labour', 'material', 'other')`),
  foreignKey({
    columns: [table.invoiceId],
    foreignColumns: [ihInvoices.id],
    name: 'ih_invoice_lines_invoice_fk',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.costLineId],
    foreignColumns: [ihJobCostLines.id],
    name: 'ih_invoice_lines_cost_line_fk',
  }).onDelete('set null'),
]);
