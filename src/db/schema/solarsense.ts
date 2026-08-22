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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const syncCols = {
  serverId: text('server_id'),
  syncStatus: text('sync_status').notNull().default('local'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
};

export const ssUsers = pgTable('ss_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull().default('inspector'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const ssSites = pgTable('ss_sites', {
  id: text('id').primaryKey(),
  ...syncCols,
  siteName: text('site_name').notNull(),
  location: text('location'),
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
  dateOfAssessment: text('date_of_assessment'),
  documentClassification: text('document_classification'),
  electricalInfrastructureSummary: text('electrical_infrastructure_summary'),
  knownConstraints: text('known_constraints'),
  loadProfileMeteringSummary: text('load_profile_metering_summary'),
  ppaAssetDemarcation: text('ppa_asset_demarcation'),
  appendixNotes: text('appendix_notes'),
  appendixItems: jsonb('appendix_items').notNull().default([]),
  reportPdfLocalPath: text('report_pdf_local_path'),
  reportPdfRemoteUrl: text('report_pdf_remote_url'),
  createdByUserId: text('created_by_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  status: text('status').notNull().default('Draft'),
  completedAt: timestamp('completed_at'),
}, (table) => [
  check('ss_sites_country_check', sql`
    ${table.siteCountryCode} IS NULL OR ${table.siteCountryCode} = 'AU'
  `),
  check('ss_sites_state_check', sql`
    ${table.siteState} IS NULL OR ${table.siteState} IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
  `),
  check('ss_sites_postcode_check', sql`
    ${table.sitePostcode} IS NULL OR ${table.sitePostcode} ~ '^[0-9]{4}$'
  `),
  check('ss_sites_coordinates_check', sql`
    (${table.siteLatitude} IS NULL AND ${table.siteLongitude} IS NULL)
    OR (
      ${table.siteLatitude} IS NOT NULL
      AND ${table.siteLongitude} IS NOT NULL
      AND ${table.siteLatitude} BETWEEN -44 AND -9
      AND ${table.siteLongitude} BETWEEN 112 AND 154
    )
  `),
  check('ss_sites_geocode_status_check', sql`
    ${table.siteGeocodeStatus} IS NULL
    OR ${table.siteGeocodeStatus} IN ('unresolved', 'resolved', 'manual', 'failed')
  `),
  check('ss_sites_geocode_evidence_check', sql`
    (${table.siteGeocodeStatus} IS DISTINCT FROM 'resolved')
    OR (${table.siteLatitude} IS NOT NULL AND ${table.siteLongitude} IS NOT NULL)
  `),
  check('ss_sites_address_fingerprint_check', sql`
    ${table.siteAddressFingerprint} IS NULL
    OR ${table.siteAddressFingerprint} ~ '^[0-9a-f]{64}$'
  `),
]);

export const ssRooftopAssessments = pgTable('ss_rooftop_assessments', {
  id: text('id').primaryKey(),
  ...syncCols,
  siteId: text('site_id'),
  siteName: text('site_name').notNull(),
  buildingIdName: text('building_id_name').notNull(),
  heritageStatus: text('heritage_status'),
  heritageDealBreaker: boolean('heritage_deal_breaker').notNull().default(false),
  aerialPhotoUri: text('aerial_photo_uri'),
  roofAreaTotalM2: real('roof_area_total_m2'),
  roofMaterial: text('roof_material'),
  roofFramingType: text('roof_framing_type'),
  roofPitchAngle: text('roof_pitch_angle'),
  roofConstructionMaterial: text('roof_construction_material'),
  asbestosFlag: boolean('asbestos_flag').notNull().default(false),
  roofCondition: text('roof_condition'),
  roofEstimatedAge: text('roof_estimated_age'),
  roofOrientationPrimary: text('roof_orientation_primary'),
  roofShadingSources: text('roof_shading_sources'),
  roofShadingUsablePct: text('roof_shading_usable_pct'),
  roofOrientationShading: text('roof_orientation_shading'),
  structuralFeasibility: text('structural_feasibility'),
  structuralRiskFlag: boolean('structural_risk_flag').notNull().default(false),
  roofAreaUsableM2: real('roof_area_usable_m2'),
  pvSizeKwDc: real('pv_size_kw_dc'),
  acExportKw: real('ac_export_kw'),
  accessSafetyConstraints: text('access_safety_constraints'),
  switchboards: jsonb('switchboards').notNull().default([]),
  msbDetails: text('msb_details'),
  msbPhotoUri: text('msb_photo_uri'),
  existingGeneration: text('existing_generation'),
  distanceToConnectionM: real('distance_to_connection_m'),
  electricalPitsEntry: text('electrical_pits_entry'),
  inverterSiting: text('inverter_siting'),
  transformerSupplyCapacity: text('transformer_supply_capacity'),
  dnspConstraints: text('dnsp_constraints'),
  loadProfileMetering: text('load_profile_metering'),
  otherConsiderations: jsonb('other_considerations').notNull().default([]),
  siteRepFeedback: text('site_rep_feedback'),
  viabilityStatus: text('viability_status'),
  dealBreakerReason: text('deal_breaker_reason'),
  ragPriority: text('rag_priority'),
  keyAssumptionsGaps: text('key_assumptions_gaps'),
  additionalPhotos: jsonb('additional_photos').notNull().default([]),
  photoMetadata: jsonb('photo_metadata').notNull().default({}),
  createdByUserId: text('created_by_user_id'),
  assignedInspectorUserId: text('assigned_inspector_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  status: text('status').notNull().default('Draft'),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('ss_rooftop_assessments_analytics_completed_idx').on(table.completedAt).where(sql`
    ${table.completedAt} IS NOT NULL AND ${table.deletedAt} IS NULL
  `),
  index('ss_rooftop_assessments_analytics_undated_completed_idx').on(table.id).where(sql`
    ${table.status} = 'Completed' AND ${table.completedAt} IS NULL
  `),
]);

export const ssAssessmentWorkSessions = pgTable('ss_assessment_work_sessions', {
  id: text('id').notNull(),
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => ssRooftopAssessments.id, { onDelete: 'cascade' }),
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
    columns: [table.assessmentId, table.id],
    name: 'ss_assessment_work_sessions_pk',
  }),
  index('ss_assessment_work_sessions_assessment_actor_idx').on(
    table.assessmentId,
    table.actorUserId,
    table.updatedAt,
  ),
  index('ss_assessment_work_sessions_analytics_boundary_idx').on(
    sql`coalesce(${table.endedAt}, ${table.lastActiveAt})`,
  ),
  check(
    'ss_assessment_work_sessions_active_milliseconds_check',
    sql`${table.activeMilliseconds} >= 0`,
  ),
  check('ss_assessment_work_sessions_revision_check', sql`${table.revision} >= 0`),
  check(
    'ss_assessment_work_sessions_time_order_check',
    sql`${table.startedAt} <= ${table.lastActiveAt}
      AND (${table.endedAt} IS NULL OR ${table.lastActiveAt} <= ${table.endedAt})`,
  ),
]);
