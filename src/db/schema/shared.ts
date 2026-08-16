import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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

/** Canonical identity shared by all three audit products. */
export const globalUsers = pgTable('global_users', {
  id: text('id').primaryKey(),
  loginKey: text('login_key').notNull(),
  fieldUserId: text('field_user_id').notNull(),
  primaryOriginApp: text('primary_origin_app').notNull(),
  primaryOriginUserId: text('primary_origin_user_id').notNull(),
  displayEmail: text('display_email').notNull(),
  fullName: text('full_name'),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  fleetEntitled: boolean('fleet_entitled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('global_users_field_user_unique').on(table.fieldUserId),
  uniqueIndex('global_users_primary_origin_unique').on(
    table.primaryOriginApp,
    table.primaryOriginUserId,
  ),
  index('global_users_login_key_idx').on(table.loginKey),
  index('global_users_role_active_idx').on(table.role, table.isActive),
  check('global_users_primary_origin_app_check', sql`
    ${table.primaryOriginApp} IN ('ecoaudit', 'solarsense', 'installhub')
  `),
  check('global_users_role_check', sql`
    ${table.role} IN ('admin', 'inspector')
  `),
]);

/**
 * Password hashes accepted for a canonical identity. Migration preserves each
 * legacy hash; the first post-migration password change replaces the set.
 */
export const globalUserCredentials = pgTable('global_user_credentials', {
  id: text('id').primaryKey(),
  globalUserId: text('global_user_id').notNull().references(
    () => globalUsers.id,
    { onDelete: 'cascade' },
  ),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('global_user_credentials_hash_unique').on(
    table.globalUserId,
    table.passwordHash,
  ),
  index('global_user_credentials_user_idx').on(table.globalUserId),
]);

/**
 * Compatibility membership registry for the product-specific user tables.
 * Every canonical identity has one projection in each released product. Those
 * rows keep their product user IDs while sharing one Field authorization ID.
 */
export const unifiedUsers = pgTable('unified_users', {
  id: text('id').primaryKey(),
  globalUserId: text('global_user_id').notNull().references(
    () => globalUsers.id,
    { onDelete: 'cascade' },
  ),
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
  uniqueIndex('unified_users_global_app_unique').on(
    table.globalUserId,
    table.originApp,
  ),
  index('unified_users_field_user_idx').on(table.fieldUserId),
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

export type SchedulerNotificationData = {
  type: 'scheduler';
  notificationKind:
    | 'assigned'
    | 'changed'
    | 'assignment_removed'
    | 'cancelled'
    | 'manual_reminder'
    | 'one_day_before'
    | 'day_of';
  eventId: string;
  sourceApp: 'ecoaudit' | 'solarsense' | 'installhub';
  sourceType: string;
  sourceId: string | null;
  scheduledStartAt: string;
};

/**
 * Monotonic login-lifecycle fence for one canonical account on a physical
 * app/device. Per-owner rows let logout defeat a delayed PUT without allowing
 * another authenticated account to revoke the device's current owner.
 */
export const appPushDeviceFences = pgTable('app_push_device_fences', {
  app: text('app').notNull(),
  deviceId: text('device_id').notNull(),
  globalUserId: text('global_user_id').notNull().references(
    () => globalUsers.id,
    { onDelete: 'cascade' },
  ),
  registrationGeneration: bigint('registration_generation', { mode: 'number' }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({
    columns: [table.app, table.deviceId, table.globalUserId],
    name: 'app_push_device_fences_pk',
  }),
  index('app_push_device_fences_owner_idx').on(
    table.globalUserId,
    table.app,
    table.enabled,
  ),
  check('app_push_device_fences_app_check', sql`
    ${table.app} IN ('ecoaudit', 'solarsense', 'installhub')
  `),
  check('app_push_device_fences_generation_check', sql`
    ${table.registrationGeneration} > 0
      AND ${table.registrationGeneration} <= 9007199254740991
  `),
]);

/** App-scoped Expo destinations registered by authenticated mobile clients. */
export const appPushDevices = pgTable('app_push_devices', {
  id: text('id').primaryKey(),
  globalUserId: text('global_user_id').notNull().references(
    () => globalUsers.id,
    { onDelete: 'cascade' },
  ),
  app: text('app').notNull(),
  deviceId: text('device_id').notNull(),
  registrationGeneration: bigint('registration_generation', { mode: 'number' }).notNull(),
  expoPushToken: text('expo_push_token').notNull(),
  platform: text('platform').notNull(),
  projectId: text('project_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  disabledReason: text('disabled_reason'),
  lastRegisteredAt: timestamp('last_registered_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('app_push_devices_app_device_unique').on(table.app, table.deviceId),
  uniqueIndex('app_push_devices_active_token_unique')
    .on(table.app, table.expoPushToken)
    .where(sql`${table.enabled} = true`),
  index('app_push_devices_user_app_enabled_idx').on(
    table.globalUserId,
    table.app,
    table.enabled,
  ),
  index('app_push_devices_token_idx').on(table.app, table.expoPushToken),
  check('app_push_devices_app_check', sql`
    ${table.app} IN ('ecoaudit', 'solarsense', 'installhub')
  `),
  check('app_push_devices_platform_check', sql`
    ${table.platform} IN ('ios', 'android')
  `),
  check('app_push_devices_generation_check', sql`
    ${table.registrationGeneration} > 0
      AND ${table.registrationGeneration} <= 9007199254740991
  `),
]);

/**
 * Durable scheduler notification intent. It is committed in the same database
 * transaction as the scheduler mutation and claimed with SKIP LOCKED.
 */
export const schedulerNotificationJobs = pgTable('scheduler_notification_jobs', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(
    () => portalScheduleEvents.id,
    { onDelete: 'cascade' },
  ),
  globalUserId: text('global_user_id').notNull().references(
    () => globalUsers.id,
    { onDelete: 'restrict' },
  ),
  sourceApp: text('source_app').notNull(),
  notificationKind: text('notification_kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  payload: jsonb('payload').notNull().$type<SchedulerNotificationData>(),
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status').notNull().default('queued'),
  availableAt: timestamp('available_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(16),
  claimToken: text('claim_token'),
  claimedAt: timestamp('claimed_at'),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scheduler_notification_jobs_dedupe_unique').on(table.dedupeKey),
  index('scheduler_notification_jobs_claim_idx').on(
    table.status,
    table.availableAt,
    table.createdAt,
  ),
  index('scheduler_notification_jobs_event_idx').on(table.eventId, table.status),
  index('scheduler_notification_jobs_target_idx').on(
    table.globalUserId,
    table.sourceApp,
    table.status,
  ),
  check('scheduler_notification_jobs_source_app_check', sql`
    ${table.sourceApp} IN ('ecoaudit', 'solarsense', 'installhub')
  `),
  check('scheduler_notification_jobs_kind_check', sql`
    ${table.notificationKind} IN (
      'assigned',
      'changed',
      'assignment_removed',
      'cancelled',
      'manual_reminder',
      'one_day_before',
      'day_of'
    )
  `),
  check('scheduler_notification_jobs_status_check', sql`
    ${table.status} IN (
      'queued',
      'processing',
      'awaiting_receipts',
      'delivered',
      'failed',
      'cancelled'
    )
  `),
  check('scheduler_notification_jobs_attempts_check', sql`
    ${table.attempts} >= 0 AND ${table.maxAttempts} > 0
  `),
]);

/** Per-device Expo ticket/receipt state for one durable notification intent. */
export const schedulerNotificationDeliveries = pgTable('scheduler_notification_deliveries', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(
    () => schedulerNotificationJobs.id,
    { onDelete: 'cascade' },
  ),
  deviceRegistrationId: text('device_registration_id').notNull().references(
    () => appPushDevices.id,
    { onDelete: 'restrict' },
  ),
  registrationGeneration: bigint('registration_generation', { mode: 'number' }).notNull(),
  expoPushToken: text('expo_push_token').notNull(),
  status: text('status').notNull().default('pending'),
  ticketId: text('ticket_id'),
  receiptAvailableAt: timestamp('receipt_available_at'),
  receiptChecks: integer('receipt_checks').notNull().default(0),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scheduler_notification_deliveries_job_device_unique').on(
    table.jobId,
    table.deviceRegistrationId,
  ),
  index('scheduler_notification_deliveries_receipt_idx').on(
    table.status,
    table.receiptAvailableAt,
  ),
  index('scheduler_notification_deliveries_job_idx').on(table.jobId, table.status),
  check('scheduler_notification_deliveries_status_check', sql`
    ${table.status} IN ('pending', 'ticketed', 'delivered', 'failed')
  `),
  check('scheduler_notification_deliveries_receipt_checks_check', sql`
    ${table.receiptChecks} >= 0
  `),
  check('scheduler_notification_deliveries_generation_check', sql`
    ${table.registrationGeneration} > 0
      AND ${table.registrationGeneration} <= 9007199254740991
  `),
]);

/**
 * Commercial ledger header for one immutable product-job identity. Calendar
 * events are only entry points: cancelling/rescheduling an event never forks
 * or deletes the ledger.
 */
export const schedulerJobFinance = pgTable('scheduler_job_finance', {
  id: text('id').primaryKey(),
  sourceApp: text('source_app').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  pricingMode: text('pricing_mode').notNull().default('charge_up'),
  quotedAmountCents: bigint('quoted_amount_cents', { mode: 'number' }),
  currency: text('currency').notNull().default('AUD'),
  notes: text('notes'),
  billToName: text('bill_to_name'),
  billToAddress: text('bill_to_address'),
  billToEmail: text('bill_to_email'),
  billingReference: text('billing_reference'),
  billableRateCents: bigint('billable_rate_cents', { mode: 'number' }).notNull().default(15000),
  costRateCents: bigint('cost_rate_cents', { mode: 'number' }).notNull().default(7500),
  updatedByUserId: text('updated_by_user_id'),
  updatedByDisplayName: text('updated_by_display_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scheduler_job_finance_source_unique').on(
    table.sourceApp,
    table.sourceType,
    table.sourceId,
  ),
  index('scheduler_job_finance_app_updated_idx').on(table.sourceApp, table.updatedAt),
  check('scheduler_job_finance_source_check', sql`
    (${table.sourceApp} = 'ecoaudit' AND ${table.sourceType} = 'audit')
    OR (${table.sourceApp} = 'solarsense' AND ${table.sourceType} = 'assessment')
    OR (${table.sourceApp} = 'installhub' AND ${table.sourceType} = 'installation')
  `),
  check('scheduler_job_finance_pricing_mode_check', sql`
    ${table.pricingMode} IN ('quoted', 'charge_up')
  `),
  check('scheduler_job_finance_money_check', sql`
    (${table.quotedAmountCents} IS NULL OR ${table.quotedAmountCents} >= 0)
    AND ${table.billableRateCents} >= 0
    AND ${table.costRateCents} >= 0
  `),
  check('scheduler_job_finance_currency_check', sql`
    length(btrim(${table.currency})) BETWEEN 1 AND 8
  `),
]);

/** Append-only provenance for effective billable/cost-hour overrides. */
export const schedulerJobHourOverrides = pgTable('scheduler_job_hour_overrides', {
  id: text('id').primaryKey(),
  financeId: text('finance_id').notNull().references(
    () => schedulerJobFinance.id,
    { onDelete: 'restrict' },
  ),
  revision: integer('revision').notNull(),
  action: text('action').notNull(),
  source: text('source').notNull().default('admin'),
  billableMilliseconds: bigint('billable_milliseconds', { mode: 'number' }),
  costMilliseconds: bigint('cost_milliseconds', { mode: 'number' }),
  reason: text('reason').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  actorDisplayName: text('actor_display_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('scheduler_job_hour_overrides_finance_created_idx').on(
    table.financeId,
    table.createdAt,
  ),
  uniqueIndex('scheduler_job_hour_overrides_finance_revision_unique').on(
    table.financeId,
    table.revision,
  ),
  check('scheduler_job_hour_overrides_revision_check', sql`${table.revision} > 0`),
  check('scheduler_job_hour_overrides_action_check', sql`
    ${table.action} IN ('set', 'clear')
  `),
  check('scheduler_job_hour_overrides_source_check', sql`
    ${table.source} IN ('admin', 'legacy_estimate')
  `),
  check('scheduler_job_hour_overrides_values_check', sql`
    (
      ${table.action} = 'set'
      AND (${table.billableMilliseconds} IS NOT NULL OR ${table.costMilliseconds} IS NOT NULL)
      AND (${table.billableMilliseconds} IS NULL OR ${table.billableMilliseconds} >= 0)
      AND (${table.costMilliseconds} IS NULL OR ${table.costMilliseconds} >= 0)
    ) OR (
      ${table.action} = 'clear'
      AND ${table.billableMilliseconds} IS NULL
      AND ${table.costMilliseconds} IS NULL
    )
  `),
  check('scheduler_job_hour_overrides_reason_check', sql`
    length(btrim(${table.reason})) > 0
  `),
]);

/** Structured out-of-pocket expense or supplier-bill record, all ex-GST. */
export const schedulerJobExpenses = pgTable('scheduler_job_expenses', {
  id: text('id').primaryKey(),
  financeId: text('finance_id').notNull().references(
    () => schedulerJobFinance.id,
    { onDelete: 'restrict' },
  ),
  kind: text('kind').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  vendor: text('vendor'),
  reference: text('reference'),
  costAmountCents: bigint('cost_amount_cents', { mode: 'number' }).notNull(),
  billableAmountCents: bigint('billable_amount_cents', { mode: 'number' }),
  billable: boolean('billable').notNull().default(true),
  invoiced: boolean('invoiced').notNull().default(false),
  incurredAt: timestamp('incurred_at'),
  createdByUserId: text('created_by_user_id'),
  createdByDisplayName: text('created_by_display_name'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('scheduler_job_expenses_finance_idx').on(table.financeId, table.deletedAt),
  index('scheduler_job_expenses_invoice_idx').on(table.financeId, table.invoiced),
  check('scheduler_job_expenses_kind_check', sql`
    ${table.kind} IN ('expense', 'supplier_bill')
  `),
  check('scheduler_job_expenses_category_check', sql`
    ${table.category} IN ('materials', 'travel', 'subcontractor', 'equipment', 'other')
  `),
  check('scheduler_job_expenses_money_check', sql`
    ${table.costAmountCents} >= 0
    AND (${table.billableAmountCents} IS NULL OR ${table.billableAmountCents} >= 0)
  `),
  check('scheduler_job_expenses_description_check', sql`
    length(btrim(${table.description})) > 0
  `),
]);

/** Immutable accounting document header; source and party fields are snapshots. */
export const schedulerInvoices = pgTable('scheduler_invoices', {
  id: text('id').primaryKey(),
  financeId: text('finance_id').notNull().references(
    () => schedulerJobFinance.id,
    { onDelete: 'restrict' },
  ),
  invoiceNumber: text('invoice_number').notNull(),
  status: text('status').notNull().default('draft'),
  currency: text('currency').notNull().default('AUD'),
  issueDate: timestamp('issue_date'),
  dueDate: timestamp('due_date'),
  subtotalExGstCents: bigint('subtotal_ex_gst_cents', { mode: 'number' }).notNull().default(0),
  gstAmountCents: bigint('gst_amount_cents', { mode: 'number' }).notNull().default(0),
  totalIncGstCents: bigint('total_inc_gst_cents', { mode: 'number' }).notNull().default(0),
  gstRateBps: integer('gst_rate_bps').notNull().default(1000),
  notes: text('notes'),
  sellerName: text('seller_name').notNull(),
  sellerAbn: text('seller_abn'),
  sellerAddress: text('seller_address'),
  sellerEmail: text('seller_email'),
  billToName: text('bill_to_name').notNull(),
  billToAddress: text('bill_to_address'),
  billToEmail: text('bill_to_email'),
  purchaseOrderReference: text('purchase_order_reference'),
  jobSiteName: text('job_site_name').notNull(),
  jobSiteAddress: text('job_site_address'),
  jobName: text('job_name').notNull(),
  jobDate: text('job_date').notNull(),
  jobClientName: text('job_client_name'),
  jobStatus: text('job_status').notNull(),
  jobSourceApp: text('job_source_app').notNull(),
  jobSourceType: text('job_source_type').notNull(),
  jobSourceId: text('job_source_id').notNull(),
  createdByUserId: text('created_by_user_id'),
  createdByDisplayName: text('created_by_display_name'),
  issuedAt: timestamp('issued_at'),
  paidAt: timestamp('paid_at'),
  voidedAt: timestamp('voided_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scheduler_invoices_number_unique').on(table.invoiceNumber),
  index('scheduler_invoices_finance_created_idx').on(table.financeId, table.createdAt),
  index('scheduler_invoices_finance_status_idx').on(table.financeId, table.status),
  check('scheduler_invoices_status_check', sql`
    ${table.status} IN ('draft', 'issued', 'paid', 'void')
  `),
  check('scheduler_invoices_money_check', sql`
    ${table.subtotalExGstCents} >= 0
    AND ${table.gstAmountCents} >= 0
    AND ${table.totalIncGstCents} >= 0
    AND ${table.gstRateBps} >= 0
  `),
  check('scheduler_invoices_job_source_check', sql`
    (${table.jobSourceApp} = 'ecoaudit' AND ${table.jobSourceType} = 'audit')
    OR (${table.jobSourceApp} = 'solarsense' AND ${table.jobSourceType} = 'assessment')
    OR (${table.jobSourceApp} = 'installhub' AND ${table.jobSourceType} = 'installation')
  `),
  check('scheduler_invoices_job_date_check', sql`
    ${table.jobDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
  `),
]);

/** Invoice line snapshots; non-void rows reserve their linked source value. */
export const schedulerInvoiceLines = pgTable('scheduler_invoice_lines', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(
    () => schedulerInvoices.id,
    { onDelete: 'cascade' },
  ),
  sortOrder: integer('sort_order').notNull().default(0),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unitAmountExGstCents: bigint('unit_amount_ex_gst_cents', { mode: 'number' }).notNull().default(0),
  lineTotalExGstCents: bigint('line_total_ex_gst_cents', { mode: 'number' }).notNull().default(0),
  expenseId: text('expense_id').references(
    () => schedulerJobExpenses.id,
    { onDelete: 'restrict' },
  ),
  category: text('category'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('scheduler_invoice_lines_invoice_idx').on(table.invoiceId, table.sortOrder),
  index('scheduler_invoice_lines_expense_idx').on(table.expenseId),
  check('scheduler_invoice_lines_kind_check', sql`
    ${table.kind} IN ('labour', 'expense', 'quoted', 'other')
  `),
  check('scheduler_invoice_lines_amount_check', sql`
    ${table.quantity} > 0
    AND ${table.unitAmountExGstCents} >= 0
    AND ${table.lineTotalExGstCents} >= 0
  `),
  check('scheduler_invoice_lines_expense_link_check', sql`
    (${table.kind} = 'expense' AND ${table.expenseId} IS NOT NULL)
    OR (${table.kind} <> 'expense' AND ${table.expenseId} IS NULL)
  `),
]);

/** Transactionally incremented yearly invoice-number sequence. */
export const schedulerInvoiceCounters = pgTable('scheduler_invoice_counters', {
  year: integer('year').primaryKey(),
  lastValue: integer('last_value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  check('scheduler_invoice_counters_year_check', sql`${table.year} BETWEEN 2000 AND 9999`),
  check('scheduler_invoice_counters_value_check', sql`${table.lastValue} >= 0`),
]);
