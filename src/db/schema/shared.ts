import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Additive shared registry for every Eco Audit, Solar Sense, and Field origin
 * account.
 *
 * Existing product user tables remain in place so released mobile clients can
 * keep using their current login and user-management APIs. Database triggers
 * mirror those rows here, and new shared functionality reads this one table.
 * A source account's `fieldUserId` is its stable Field authorization subject;
 * independent accounts that happen to share a username are never merged.
 */
export const unifiedUsers = pgTable('unified_users', {
  id: text('id').primaryKey(),
  originApp: text('origin_app').notNull(),
  originUserId: text('origin_user_id').notNull(),
  fieldUserId: text('field_user_id').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sourceCreatedAt: timestamp('source_created_at').notNull(),
  sourceUpdatedAt: timestamp('source_updated_at').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
  syncVersion: integer('sync_version').notNull().default(1),
}, (table) => [
  uniqueIndex('unified_users_origin_unique').on(table.originApp, table.originUserId),
  uniqueIndex('unified_users_field_user_unique').on(table.fieldUserId),
  index('unified_users_email_idx').on(table.email),
  index('unified_users_app_role_active_idx').on(
    table.originApp,
    table.role,
    table.isActive,
  ),
  check('unified_users_origin_app_check', sql`
    ${table.originApp} IN ('ecoaudit', 'solarsense', 'installhub')
  `),
  check('unified_users_sync_version_check', sql`
    ${table.syncVersion} > 0
  `),
]);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hashedKey: text('hashed_key').notNull(),
  prefix: text('prefix').notNull(),
  app: text('app').notNull(),
  role: text('role').notNull(),
  createdByUserId: text('created_by_user_id'),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  app: text('app').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const photoRegistry = pgTable('photo_registry', {
  id: text('id').primaryKey(),
  checksum: text('checksum').notNull(),
  remoteUrl: text('remote_url'),
  onedriveItemId: text('onedrive_item_id'),
  storageKey: text('storage_key'),
  contentType: text('content_type'),
  originalFilename: text('original_filename'),
  app: text('app').notNull(),
  parentId: text('parent_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  fieldName: text('field_name').notNull(),
  fileSizeBytes: integer('file_size_bytes'),
  status: text('status').notNull().default('pending'),
  uploadedAt: timestamp('uploaded_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Grants a copied parent durable use of an existing immutable photo. The
 * registry row and stored original remain single-instance; entity/field are
 * remapped so copied reports can use the same bytes with their cloned rows.
 */
export const photoCopyReferences = pgTable('photo_copy_references', {
  id: text('id').primaryKey(),
  app: text('app').notNull(),
  photoId: text('photo_id').notNull().references(() => photoRegistry.id),
  targetParentId: text('target_parent_id').notNull(),
  targetEntityType: text('target_entity_type').notNull(),
  targetEntityId: text('target_entity_id').notNull(),
  targetFieldName: text('target_field_name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('photo_copy_references_target_unique').on(
    table.app,
    table.photoId,
    table.targetParentId,
    table.targetEntityId,
    table.targetFieldName,
  ),
  index('photo_copy_references_photo_idx').on(table.app, table.photoId),
  index('photo_copy_references_parent_idx').on(table.app, table.targetParentId),
  index('photo_copy_references_entity_idx').on(table.app, table.targetEntityId),
]);

export const recordVersions = pgTable('record_versions', {
  id: text('id').primaryKey(),
  app: text('app').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  createdByUserId: text('created_by_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const pdfJobs = pgTable('pdf_jobs', {
  id: text('id').primaryKey(),
  app: text('app').notNull(),
  entityId: text('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  userId: text('user_id').notNull(),
  params: jsonb('params').notNull().$type<Record<string, unknown>>(),
  status: text('status').notNull().default('queued'),
  phase: text('phase'),
  progressCurrent: integer('progress_current'),
  progressTotal: integer('progress_total'),
  pdfUrl: text('pdf_url'),
  storageKey: text('storage_key'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
