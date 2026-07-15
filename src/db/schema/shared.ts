import { index, jsonb, pgTable, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';

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
