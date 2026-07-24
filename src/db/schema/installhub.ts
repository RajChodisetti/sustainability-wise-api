import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

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
  clientName: text('client_name').notNull(),
  siteName: text('site_name').notNull(),
  siteAddress: text('site_address').notNull(),
  inspectorName: text('inspector_name').notNull(),
  auditDate: text('audit_date').notNull(),
  status: text('status').notNull().default('Draft'),
  createdByUserId: text('created_by_user_id'),
  assignedInspectorUserId: text('assigned_inspector_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_installations_owner_idx').on(table.createdByUserId, table.updatedAt),
  index('ih_installations_assignee_idx').on(table.assignedInspectorUserId, table.updatedAt),
]);

export const ihZones = pgTable('ih_zones', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneName: text('zone_name').notNull(),
  zoneDescription: text('zone_description').notNull().default(''),
  photos: jsonb('photos').notNull().default([]).$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_zones_installation_idx').on(table.installationId),
]);

export const ihElectricalAssets = pgTable('ih_electrical_assets', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneId: text('zone_id').notNull(),
  assetName: text('asset_name').notNull(),
  displayCode: text('display_code').notNull(),
  assetType: text('asset_type').notNull(),
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
]);

export const ihSiteAssets = pgTable('ih_site_assets', {
  id: text('id').primaryKey(),
  ...syncColumns,
  installationId: text('installation_id').notNull(),
  zoneId: text('zone_id').notNull(),
  assetName: text('asset_name').notNull(),
  assetType: text('asset_type').notNull(),
  electricalBoardId: text('electrical_board_id'),
  electricalBoardTbc: boolean('electrical_board_tbc').notNull().default(false),
  locationDescription: text('location_description'),
  locationPhoto: text('location_photo'),
  displayCode: text('display_code'),
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
]);

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('ih_form_submissions_installation_idx').on(table.installationId),
  index('ih_form_submissions_type_idx').on(table.formType, table.status),
]);
