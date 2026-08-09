import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
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
  clientName: text('client_name').notNull(),
  siteName: text('site_name').notNull(),
  siteAddress: text('site_address').notNull(),
  inspectorName: text('inspector_name').notNull(),
  auditDate: text('audit_date').notNull(),
  status: text('status').notNull().default('Draft'),
  createdByUserId: text('created_by_user_id'),
  assignedInspectorUserId: text('assigned_inspector_user_id'),
  completedAt: timestamp('completed_at'),
  completedByUserId: text('completed_by_user_id'),
  completedFromRevision: integer('completed_from_revision'),
  reopenedAt: timestamp('reopened_at'),
  reopenedByUserId: text('reopened_by_user_id'),
  reopenedFromVersionNumber: integer('reopened_from_version_number'),
  reopenReason: text('reopen_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ih_installations_external_key_unique').on(table.externalKey),
  index('ih_installations_owner_idx').on(table.createdByUserId, table.updatedAt),
  index('ih_installations_assignee_idx').on(table.assignedInspectorUserId, table.updatedAt),
  check('ih_installations_tree_schema_version_check', sql`${table.treeSchemaVersion} IN (1, 2)`),
  check('ih_installations_tree_revision_check', sql`${table.treeRevision} >= 0`),
  check('ih_installations_record_version_check', sql`${table.recordVersionNumber} >= 0`),
  check('ih_installations_electrical_map_layout_revision_check', sql`${table.electricalMapLayoutRevision} >= 0`),
  check('ih_installations_status_check', sql`${table.status} IN ('Draft', 'Completed')`),
  check('ih_installations_external_key_nonempty_check', sql`length(btrim(${table.externalKey})) > 0`),
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
