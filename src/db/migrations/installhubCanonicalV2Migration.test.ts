import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0015_installation_canonical_v2.sql', import.meta.url);
const deletionOutboxMigrationUrl = new URL(
  './0016_durable_storage_deletion_outbox.sql',
  import.meta.url,
);
const ownershipFenceMigrationUrl = new URL(
  './0017_installhub_child_ownership_fence.sql',
  import.meta.url,
);
const uploadConfirmationRevisionMigrationUrl = new URL(
  './0018_installhub_upload_confirmation_revision.sql',
  import.meta.url,
);
const uploadBaseRevisionMigrationUrl = new URL(
  './0019_installhub_upload_base_revision.sql',
  import.meta.url,
);

const expectedNewTables = [
  'ih_completion_idempotency',
  'ih_display_code_claims',
  'ih_grid_supplies',
  'ih_measurement_assignment_channels',
  'ih_measurement_assignments',
  'ih_meter_channels',
  'ih_meter_devices',
].sort();

const knownExistingTables = [
  'ih_electrical_assets',
  'ih_form_submissions',
  'ih_installations',
  'ih_site_assets',
  'ih_users',
  'ih_zones',
  'pdf_jobs',
  'photo_copy_references',
  'record_versions',
  'unified_users',
  'ww_clients',
  'ww_collection_runs',
];

test('canonical-v2 migration is an expand-only delta from migration 0014', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const createdTables = [...sql.matchAll(/CREATE TABLE\s+"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(createdTables, expectedNewTables);
  for (const existingTable of knownExistingTables) {
    assert.doesNotMatch(sql, new RegExp(`CREATE TABLE\\s+"${existingTable}"`, 'i'));
  }

  assert.match(sql, /ih_legacy_' \|\| md5\("id"\)/);
  assert.match(sql, /gen_random_uuid\(\)::text/);
  assert.match(sql, /CREATE TRIGGER "ih_installations_external_key_immutable"/);
  assert.match(sql, /OLD\."external_key" IS DISTINCT FROM NEW\."external_key"/);
  assert.match(sql, /ih_installations_external_key_nonempty_check/);
  assert.match(sql, /ALTER TABLE "ih_installations" ADD COLUMN "tree_schema_version"/);
  assert.match(sql, /ALTER TABLE "record_versions" ADD COLUMN "payload_hash"/);
  assert.match(sql, /source_kind" text DEFAULT 'LEGACY' NOT NULL/);
  assert.match(sql, /ih_electrical_assets_source_check[\s\S]+NOT VALID/);
  assert.match(sql, /ih_form_submissions_supersedes_fk[\s\S]+NOT VALID/);
  assert.match(sql, /ih_form_submissions_meter_fk[\s\S]+NOT VALID/);
  assert.match(sql, /ih_form_submissions_status_check[\s\S]+NOT VALID/);
  assert.match(sql, /ih_form_submissions_schema_version_check[\s\S]+NOT VALID/);
});

test('purge storage cleanup is a durable additive outbox', async () => {
  const sql = await readFile(deletionOutboxMigrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE "storage_deletion_tasks"/);
  assert.match(sql, /"storage_key" text NOT NULL/);
  assert.match(sql, /storage_deletion_tasks_storage_key_unique/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('canonical child installation ownership is immutable across every child table', async () => {
  const sql = await readFile(ownershipFenceMigrationUrl, 'utf8');
  const protectedTables = [
    'ih_grid_supplies',
    'ih_zones',
    'ih_electrical_assets',
    'ih_site_assets',
    'ih_meter_devices',
    'ih_meter_channels',
    'ih_measurement_assignments',
    'ih_measurement_assignment_channels',
    'ih_form_submissions',
    'ih_display_code_claims',
    'ih_completion_idempotency',
  ];

  assert.match(sql, /OLD\."installation_id" IS DISTINCT FROM NEW\."installation_id"/);
  assert.match(sql, /ih_canonical_child_installation_immutable/);
  for (const table of protectedTables) {
    assert.match(
      sql,
      new RegExp(`BEFORE UPDATE OF "installation_id" ON "${table}"`),
    );
  }
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('upload confirmation revision migration is nullable and expand-only', async () => {
  const sql = await readFile(uploadConfirmationRevisionMigrationUrl, 'utf8');
  assert.match(
    sql,
    /ALTER TABLE "photo_registry" ADD COLUMN "confirmed_tree_revision" integer/,
  );
  assert.doesNotMatch(sql, /NOT NULL|DROP TABLE|DROP COLUMN|TRUNCATE|UPDATE/i);
});

test('upload base revision migration is nullable and expand-only', async () => {
  const sql = await readFile(uploadBaseRevisionMigrationUrl, 'utf8');
  assert.match(sql, /ALTER TABLE "photo_registry" ADD COLUMN "base_tree_revision" integer/);
  assert.doesNotMatch(sql, /NOT NULL|DROP TABLE|DROP COLUMN|TRUNCATE|UPDATE/i);
});
