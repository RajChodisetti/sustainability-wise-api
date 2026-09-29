import {
  bigint,
  boolean,
  check,
  doublePrecision,
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
import { businessSites } from './shared.js';

const syncCols = {
  serverId: text('server_id'),
  syncStatus: text('sync_status').notNull().default('local'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
};

export const eaUsers = pgTable('ea_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull().default('inspector'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const eaAudits = pgTable('ea_audits', {
  id: text('id').primaryKey(),
  ...syncCols,
  clientName: text('client_name'),
  businessSiteId: text('business_site_id').references(
    () => businessSites.id,
    { onDelete: 'restrict' },
  ),
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
  siteAddressSource: text('site_address_source').notNull().default('manual'),
  siteAddressFingerprint: text('site_address_fingerprint'),
  siteGeocodedAt: timestamp('site_geocoded_at'),
  inspectorName: text('inspector_name').notNull(),
  auditDate: text('audit_date'),
  status: text('status').notNull().default('Draft'),
  /** Monotonic compare-and-swap fence for the complete audit aggregate. */
  treeRevision: integer('tree_revision').notNull().default(0),
  /** Latest immutable record_versions snapshot pinned for this audit. */
  recordVersionNumber: integer('record_version_number').notNull().default(0),
  /** Monotonic ownership fence. It survives lease release and token rotation. */
  editFence: integer('edit_fence').notNull().default(0),
  copiedFromAuditId: text('copied_from_audit_id'),
  copiedFromRecordVersionNumber: integer('copied_from_record_version_number'),
  lineageRootAuditId: text('lineage_root_audit_id'),
  copyPurpose: text('copy_purpose'),
  reportPdfLocalPath: text('report_pdf_local_path'),
  reportPdfRemoteUrl: text('report_pdf_remote_url'),
  createdByUserId: text('created_by_user_id'),
  assignedInspectorUserId: text('assigned_inspector_user_id'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ea_audits_analytics_completed_idx').on(table.completedAt).where(sql`
    ${table.completedAt} IS NOT NULL AND ${table.deletedAt} IS NULL
  `),
  index('ea_audits_analytics_undated_completed_idx').on(table.id).where(sql`
    ${table.status} = 'Completed' AND ${table.completedAt} IS NULL
  `),
  index('ea_audits_business_site_idx').on(table.businessSiteId, table.updatedAt),
  index('ea_audits_copied_from_idx').on(table.copiedFromAuditId),
  index('ea_audits_lineage_root_idx').on(table.lineageRootAuditId, table.updatedAt),
  check('ea_audits_tree_revision_check', sql`${table.treeRevision} >= 0`),
  check('ea_audits_record_version_check', sql`${table.recordVersionNumber} >= 0`),
  check('ea_audits_edit_fence_check', sql`${table.editFence} >= 0`),
  check('ea_audits_copy_purpose_check', sql`
    ${table.copyPurpose} IS NULL OR ${table.copyPurpose} IN ('independent', 'amendment')
  `),
  check('ea_audits_copy_provenance_check', sql`
    (${table.copiedFromAuditId} IS NULL
      AND ${table.copiedFromRecordVersionNumber} IS NULL
      AND ${table.copyPurpose} IS NULL)
    OR (${table.copiedFromAuditId} IS NOT NULL
      AND ${table.copiedFromRecordVersionNumber} IS NOT NULL
      AND ${table.copiedFromRecordVersionNumber} >= 1
      AND ${table.copyPurpose} IS NOT NULL)
  `),
  check('ea_audits_client_name_check', sql`
    ${table.clientName} IS NULL
    OR char_length(btrim(${table.clientName})) BETWEEN 1 AND 300
  `),
  check('ea_audits_site_country_check', sql`
    ${table.siteCountryCode} IS NULL OR ${table.siteCountryCode} = 'AU'
  `),
  check('ea_audits_site_state_check', sql`
    ${table.siteState} IS NULL OR ${table.siteState} IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  `),
  check('ea_audits_site_postcode_check', sql`
    ${table.sitePostcode} IS NULL OR ${table.sitePostcode} ~ '^[0-9]{4}$'
  `),
  check('ea_audits_site_coordinates_check', sql`
    (${table.siteLatitude} IS NULL AND ${table.siteLongitude} IS NULL)
    OR (
      ${table.siteLatitude} IS NOT NULL
      AND ${table.siteLongitude} IS NOT NULL
      AND ${table.siteLatitude} BETWEEN -44 AND -9
      AND ${table.siteLongitude} BETWEEN 112 AND 154
    )
  `),
  check('ea_audits_site_geocode_status_check', sql`
    ${table.siteGeocodeStatus} IS NULL
    OR ${table.siteGeocodeStatus} IN ('unresolved', 'resolved', 'manual', 'failed')
  `),
  check('ea_audits_site_geocode_evidence_check', sql`
    (${table.siteGeocodeStatus} IS DISTINCT FROM 'resolved')
    OR (${table.siteLatitude} IS NOT NULL AND ${table.siteLongitude} IS NOT NULL)
  `),
  check('ea_audits_site_address_source_check', sql`
    ${table.siteAddressSource} IN ('suggested', 'manual', 'client_saved')
  `),
  check('ea_audits_site_address_fingerprint_check', sql`
    ${table.siteAddressFingerprint} IS NULL
    OR ${table.siteAddressFingerprint} ~ '^[0-9a-f]{64}$'
  `),
]);

/**
 * The one active EcoAudit editor. The opaque bearer token is stored only as a
 * SHA-256 digest; editFence on ea_audits prevents delayed tokens from becoming
 * valid again after release, completion, or an explicit takeover.
 */
export const eaAuditEditLeases = pgTable('ea_audit_edit_leases', {
  auditId: text('audit_id')
    .primaryKey()
    .references(() => eaAudits.id, { onDelete: 'cascade' }),
  fence: integer('fence').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  clientInstanceId: text('client_instance_id').notNull(),
  clientKind: text('client_kind').notNull(),
  clientLabel: text('client_label'),
  tokenHash: text('token_hash').notNull(),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  index('ea_audit_edit_leases_owner_idx').on(
    table.ownerUserId,
    table.clientInstanceId,
  ),
  index('ea_audit_edit_leases_expiry_idx').on(table.expiresAt),
  check('ea_audit_edit_leases_fence_check', sql`${table.fence} > 0`),
  check('ea_audit_edit_leases_client_kind_check', sql`
    ${table.clientKind} IN ('mobile', 'portal')
  `),
]);

/** Durable provenance for ownership changes and recovery actions. */
export const eaAuditEditLeaseEvents = pgTable('ea_audit_edit_lease_events', {
  id: text('id').primaryKey(),
  // Intentionally not a foreign key: ownership history must survive the
  // deliberate hard purge of the mutable audit aggregate.
  auditId: text('audit_id').notNull(),
  fence: integer('fence').notNull(),
  eventType: text('event_type').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  clientInstanceId: text('client_instance_id').notNull(),
  clientKind: text('client_kind').notNull(),
  previousOwnerUserId: text('previous_owner_user_id'),
  previousClientInstanceId: text('previous_client_instance_id'),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ea_audit_edit_lease_events_audit_idx').on(table.auditId, table.createdAt),
  check('ea_audit_edit_lease_events_fence_check', sql`${table.fence} > 0`),
  check('ea_audit_edit_lease_events_type_check', sql`
    ${table.eventType} IN ('acquired', 'reissued', 'released', 'taken_over', 'completed')
  `),
  check('ea_audit_edit_lease_events_client_kind_check', sql`
    ${table.clientKind} IN ('mobile', 'portal')
  `),
]);

/**
 * Permanent, non-secret evidence that an audit identifier was deliberately
 * hard-purged. Deterministic create retries must never resurrect that ID.
 */
export const eaAuditPurgeTombstones = pgTable('ea_audit_purge_tombstones', {
  auditId: text('audit_id').primaryKey(),
  purgedByUserId: text('purged_by_user_id').notNull(),
  lastTreeRevision: integer('last_tree_revision').notNull(),
  lastEditFence: integer('last_edit_fence').notNull(),
  purgedAt: timestamp('purged_at').notNull().defaultNow(),
}, (table) => [
  index('ea_audit_purge_tombstones_purged_at_idx').on(table.purgedAt),
  check('ea_audit_purge_tombstones_revision_check', sql`
    ${table.lastTreeRevision} >= 0 AND ${table.lastEditFence} >= 0
  `),
]);

/** Idempotent aggregate commands (sync, completion, and copy/amendment). */
export const eaAuditIdempotency = pgTable('ea_audit_idempotency', {
  id: text('id').primaryKey(),
  auditId: text('audit_id')
    .notNull()
    .references(() => eaAudits.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  clientInstanceId: text('client_instance_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  baseTreeRevision: integer('base_tree_revision').notNull(),
  resultingTreeRevision: integer('resulting_tree_revision').notNull(),
  recordVersionNumber: integer('record_version_number').notNull(),
  result: jsonb('result').notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('ea_audit_idempotency_scope_unique').on(
    table.auditId,
    table.operation,
    table.actorUserId,
    table.clientInstanceId,
    table.idempotencyKey,
  ),
  index('ea_audit_idempotency_audit_idx').on(table.auditId, table.createdAt),
  check('ea_audit_idempotency_revision_check', sql`
    ${table.baseTreeRevision} >= 0
    AND ${table.resultingTreeRevision} >= 0
    AND ${table.recordVersionNumber} >= 0
  `),
]);

export const eaAuditWorkSessions = pgTable('ea_audit_work_sessions', {
  id: text('id').notNull(),
  auditId: text('audit_id')
    .notNull()
    .references(() => eaAudits.id, { onDelete: 'cascade' }),
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
    columns: [table.auditId, table.id],
    name: 'ea_audit_work_sessions_pk',
  }),
  index('ea_audit_work_sessions_audit_actor_idx').on(
    table.auditId,
    table.actorUserId,
    table.updatedAt,
  ),
  index('ea_audit_work_sessions_analytics_boundary_idx').on(
    sql`coalesce(${table.endedAt}, ${table.lastActiveAt})`,
  ),
  check(
    'ea_audit_work_sessions_active_milliseconds_check',
    sql`${table.activeMilliseconds} >= 0`,
  ),
  check('ea_audit_work_sessions_revision_check', sql`${table.revision} >= 0`),
  check(
    'ea_audit_work_sessions_time_order_check',
    sql`${table.startedAt} <= ${table.lastActiveAt}
      AND (${table.endedAt} IS NULL OR ${table.lastActiveAt} <= ${table.endedAt})`,
  ),
]);

export const eaZones = pgTable('ea_zones', {
  id: text('id').primaryKey(),
  ...syncCols,
  auditId: text('audit_id').notNull(),
  zoneName: text('zone_name').notNull(),
  zoneDescription: text('zone_description'),
  photos: text('photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaMainSwitchboards = pgTable('ea_main_switchboards', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  name: text('name').notNull(),
  location: text('location'),
  mapLocator: text('map_locator'),
  siteNmi: text('site_nmi'),
  photo: text('photo'),
  subCircuitsDescription: text('sub_circuits_description'),
  comments: text('comments'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaAdditionalSwitchboards = pgTable('ea_additional_switchboards', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  name: text('name').notNull(),
  location: text('location'),
  mapLocator: text('map_locator'),
  type: text('type'),
  photo: text('photo'),
  subCircuitsDescription: text('sub_circuits_description'),
  comments: text('comments'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaHvacUnits = pgTable('ea_hvac_units', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  unitName: text('unit_name').notNull(),
  make: text('make'),
  photo: text('photo'),
  location: text('location'),
  type: text('type'),
  model: text('model'),
  serialNumber: text('serial_number'),
  heatingCapacityKw: real('heating_capacity_kw'),
  coolingCapacityKw: real('cooling_capacity_kw'),
  powerSupplyPhase: text('power_supply_phase'),
  nameplatePhotos: text('nameplate_photos'),
  indoorUnitModel: text('indoor_unit_model'),
  indoorUnitSerial: text('indoor_unit_serial'),
  indoorUnitNameplatePhoto: text('indoor_unit_nameplate_photo'),
  controllerType: text('controller_type'),
  controllerModel: text('controller_model'),
  controllerPhoto: text('controller_photo'),
  temperatureSensorType: text('temperature_sensor_type'),
  systemCoverage: text('system_coverage'),
  energyImprovementObservations: text('energy_improvement_observations'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaLightingSystems = pgTable('ea_lighting_systems', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  lightType: text('light_type').notNull(),
  brandModel: text('brand_model'),
  photo: text('photo'),
  ratedWattage: real('rated_wattage'),
  quantity: integer('quantity'),
  fixturesInstalled: text('fixtures_installed'),
  fixturesPhoto: text('fixtures_photo'),
  areaLocation: text('area_location'),
  controlsType: text('controls_type'),
  operatingHours: text('operating_hours'),
  mountingHeight: text('mounting_height'),
  mountingConstraintsPhoto: text('mounting_constraints_photo'),
  circuitGrouping: text('circuit_grouping'),
  sensorsPhoto: text('sensors_photo'),
  accessLimitations: text('access_limitations'),
  // Keep the legacy physical column for compatibility with existing data, but
  // expose the same field name used by the mobile domain model and PDF metadata.
  switchboardControlsPhoto: text('switchboard_photo_notes'),
  energyImprovementObservations: text('energy_improvement_observations'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaSolarPv = pgTable('ea_solar_pv', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  systemSizeKw: real('system_size_kw'),
  roofPhoto: text('roof_photo'),
  inverterBrandModel: text('inverter_brand_model'),
  inverterLocation: text('inverter_location'),
  inverterLabelPhoto: text('inverter_label_photo'),
  powerSupplyToPv: text('power_supply_to_pv'),
  electricityMeterPhoto: text('electricity_meter_photo'),
  availableRoofSpace: text('available_roof_space'),
  roofSpaceAmount: text('roof_space_amount'),
  additionalSolarSpacePhoto: text('additional_solar_space_photo'),
  suitableSwitchboard: text('suitable_switchboard'),
  switchboardPhoto: text('switchboard_photo'),
  switchboardLocation: text('switchboard_location'),
  cableDistance: text('cable_distance'),
  cableRouteDescription: text('cable_route_description'),
  energyImprovementObservations: text('energy_improvement_observations'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaForkliftChargers = pgTable('ea_forklift_chargers', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  chargerType: text('charger_type').notNull(),
  chargerPhoto: text('charger_photo'),
  brandModel: text('brand_model'),
  rating: text('rating'),
  chargerLabelPhoto: text('charger_label_photo'),
  powerSupply: text('power_supply'),
  electricConnectionPhoto: text('electric_connection_photo'),
  location: text('location'),
  quantity: integer('quantity'),
  chargerSpacePhoto: text('charger_space_photo'),
  connectionDescription: text('connection_description'),
  socketConnectionPhoto: text('socket_connection_photo'),
  localIsolator: text('local_isolator'),
  circuitIdentifiable: text('circuit_identifiable'),
  distanceToSwitchboard: text('distance_to_switchboard'),
  spaceForAdditional: text('space_for_additional'),
  hardwiredSocket: text('hardwired_socket'),
  schedulingOpportunity: text('scheduling_opportunity'),
  energyImprovementObservations: text('energy_improvement_observations'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaHotWaterSystems = pgTable('ea_hot_water_systems', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  dhwDetailsType: text('dhw_details_type').notNull(),
  photo: text('photo'),
  serialNumber: text('serial_number'),
  sizeLiters: real('size_liters'),
  fuelType: text('fuel_type'),
  location: text('location'),
  pipeInsulation: text('pipe_insulation'),
  pipeInsulationThickness: text('pipe_insulation_thickness'),
  temperingValve: text('tempering_valve'),
  additionalPhoto: text('additional_photo'),
  moreDhwSystems: text('more_dhw_systems'),
  additionalComments: text('additional_comments'),
  energyImprovementObservations: text('energy_improvement_observations'),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaGeneralWater = pgTable('ea_general_water', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  question: text('question'),
  answer: text('answer'),
  photos: text('photos').array().notNull().default([]),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const eaWaterAssets = pgTable('ea_water_assets', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  assetType: text('asset_type').notNull(),
  name: text('name').notNull(),
  category: text('category'),
  data: jsonb('data').notNull().default({}).$type<Record<string, unknown>>(),
  generalComments: text('general_comments'),
  customFields: jsonb('custom_fields').notNull().default([]).$type<unknown[]>(),
  photos: text('photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ea_water_assets_audit_idx').on(table.auditId, table.createdAt),
  index('ea_water_assets_zone_idx').on(table.zoneId, table.createdAt),
  check('ea_water_assets_type_check', sql`
    ${table.assetType} IN (
      'water_meter',
      'water_submeter_logger',
      'water_fixture',
      'water_asset_system'
    )
  `),
  check('ea_water_assets_data_object_check', sql`jsonb_typeof(${table.data}) = 'object'`),
  check('ea_water_assets_custom_fields_array_check', sql`jsonb_typeof(${table.customFields}) = 'array'`),
  check('ea_water_assets_photo_descs_object_check', sql`jsonb_typeof(${table.photoDescs}) = 'object'`),
]);

export const eaGeneralElectricity = pgTable('ea_general_electricity', {
  id: text('id').primaryKey(),
  ...syncCols,
  zoneId: text('zone_id').notNull(),
  auditId: text('audit_id').notNull(),
  question: text('question'),
  answer: text('answer'),
  photos: text('photos').array().notNull().default([]),
  extraNotes: text('extra_notes'),
  extraPhotos: text('extra_photos').array().notNull().default([]),
  photoDescs: jsonb('photo_descs').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
