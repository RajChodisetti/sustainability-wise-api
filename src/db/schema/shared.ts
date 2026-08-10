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
  /** InstallHub CAS base captured when the upload session was created. */
  baseTreeRevision: integer('base_tree_revision'),
  /** Exact installation CAS revision created by InstallHub confirmation. */
  confirmedTreeRevision: integer('confirmed_tree_revision'),
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
  schemaVersion: integer('schema_version'),
  canonicalizerVersion: text('canonicalizer_version'),
  validatorVersion: text('validator_version'),
  taxonomyVersion: text('taxonomy_version'),
  payloadHash: text('payload_hash'),
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

/**
 * Durable outbox for storage deletion. Domain/registry rows and this task are
 * committed atomically; physical bytes are removed only after that commit and
 * unfinished tasks are replayed on startup.
 */
export const storageDeletionTasks = pgTable('storage_deletion_tasks', {
  id: text('id').primaryKey(),
  app: text('app').notNull(),
  storageKey: text('storage_key').notNull(),
  reason: text('reason').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('storage_deletion_tasks_storage_key_unique').on(table.storageKey),
  index('storage_deletion_tasks_app_created_idx').on(table.app, table.createdAt),
]);

/**
 * Portal-scoped work calendar events (phase 1 scheduler).
 * Soft-links to product jobs via source_app / source_type / source_id.
 * Assignees use unified_users.field_user_id for stable cross-app identity.
 */
export const portalScheduleEvents = pgTable('portal_schedule_events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  sourceApp: text('source_app').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  assigneeFieldUserId: text('assignee_field_user_id').notNull(),
  assigneeDisplayName: text('assignee_display_name'),
  assigneeEmail: text('assignee_email'),
  scheduledStartAt: timestamp('scheduled_start_at').notNull(),
  scheduledEndAt: timestamp('scheduled_end_at'),
  deadlineAt: timestamp('deadline_at').notNull(),
  status: text('status').notNull().default('planned'),
  createdByUserId: text('created_by_user_id').notNull(),
  createdByApp: text('created_by_app').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at'),
}, (table) => [
  index('portal_schedule_events_assignee_start_idx').on(
    table.assigneeFieldUserId,
    table.scheduledStartAt,
  ),
  index('portal_schedule_events_deadline_idx').on(table.deadlineAt),
  index('portal_schedule_events_source_idx').on(table.sourceApp, table.sourceId),
  index('portal_schedule_events_start_idx').on(table.scheduledStartAt),
  index('portal_schedule_events_status_idx').on(table.status),
  check('portal_schedule_events_source_app_check', sql`
    ${table.sourceApp} IN ('ecoaudit', 'solarsense', 'installhub', 'custom')
  `),
  check('portal_schedule_events_source_type_check', sql`
    ${table.sourceType} IN ('audit', 'site', 'assessment', 'installation', 'custom')
  `),
  check('portal_schedule_events_status_check', sql`
    ${table.status} IN ('planned', 'in_progress', 'done', 'cancelled')
  `),
]);
