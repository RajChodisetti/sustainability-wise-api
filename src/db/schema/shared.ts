import { jsonb, pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';

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
