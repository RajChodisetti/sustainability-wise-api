import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('./migrations/0030_global_user_identity.sql', import.meta.url),
  'utf8',
);

test('0030 backfills before enforcing the canonical membership constraint', () => {
  const addNullable = migration.indexOf(
    'ALTER TABLE "unified_users" ADD COLUMN "global_user_id" text;',
  );
  const membershipBackfill = migration.indexOf(
    'INSERT INTO "unified_users"',
  );
  const setNotNull = migration.indexOf(
    'ALTER TABLE "unified_users" ALTER COLUMN "global_user_id" SET NOT NULL',
  );
  assert.ok(addNullable >= 0);
  assert.ok(membershipBackfill > addNullable);
  assert.ok(setNotNull > membershipBackfill);
  assert.doesNotMatch(
    migration,
    /ADD COLUMN "global_user_id" text NOT NULL/,
  );
});

test('legacy merge is app-priority deterministic and rejects unsafe ambiguity', () => {
  assert.match(migration, /SELECT \*, 1::integer AS identity_ordinal/);
  assert.doesNotMatch(migration, /row_number\(\)/i);
  assert.match(
    migration,
    /CASE s\.origin_app WHEN 'installhub' THEN 1 WHEN 'ecoaudit' THEN 2 ELSE 3 END/,
  );
  assert.match(migration, /HAVING count\(\*\) > 1/);
  assert.match(migration, /Ambiguous legacy global identity/);
  assert.match(migration, /bool_or\(is_active\) <> bool_and\(is_active\)/);
  assert.match(migration, /Conflicting active state for legacy global identity/);
  assert.match(migration, /bool_or\(s\.role = 'admin'\)/);
});

test('migration preserves all legacy credentials and creates all projections', () => {
  assert.match(
    migration,
    /SELECT DISTINCT[\s\S]+g\.global_user_id,[\s\S]+s\.password_hash/,
  );
  for (const app of ['ecoaudit', 'solarsense', 'installhub']) {
    assert.match(
      migration,
      new RegExp(`INSERT INTO "(?:${app === 'ecoaudit' ? 'ea' : app === 'solarsense' ? 'ss' : 'ih'})_users"`),
    );
  }
  assert.match(migration, /WHEN applications\.origin_app = 'installhub' THEN g\.field_user_id/);
  assert.match(migration, /CREATE UNIQUE INDEX "unified_users_global_app_unique"/);
});

test('old Field subjects are remapped under one fixed write lock set', () => {
  const lockedTables = [
    'ih_installations',
    'ih_installation_work_sessions',
    'ih_meter_history_events',
    'ih_completion_idempotency',
    'ih_job_finance',
    'ih_job_cost_lines',
    'ih_invoices',
    'portal_schedule_events',
    'api_keys',
    'record_versions',
    'pdf_jobs',
    'refresh_tokens',
  ];
  for (const table of lockedTables) {
    assert.match(migration, new RegExp(`"${table}"`));
  }
  for (const column of [
    'created_by_user_id',
    'assigned_inspector_user_id',
    'completed_by_user_id',
    'reopened_by_user_id',
    'actor_user_id',
    'updated_by_user_id',
    'assignee_field_user_id',
  ]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /Canonical Field identity would collide in ih_completion_idempotency/);
  assert.doesNotMatch(migration, /DELETE FROM "ih_completion_idempotency"/);
  assert.match(
    migration,
    /UPDATE "refresh_tokens" row SET[\s\S]+revoked_at = COALESCE/,
  );
});

test('global propagation serializes before row locks and cannot recurse', () => {
  for (const table of ['ea_users', 'ss_users', 'ih_users']) {
    assert.match(
      migration,
      new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON "${table}"`),
    );
  }
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('global-user-mutations'\)\)/);
  assert.match(migration, /IF pg_trigger_depth\(\) > 1 THEN/);
  assert.match(
    migration,
    /DELETE FROM "public"\."global_user_credentials"[\s\S]+INSERT INTO "public"\."global_user_credentials"/,
  );
  assert.match(migration, /UPDATE "public"\."refresh_tokens" SET revoked_at/);
});

test('Fleet entitlement is preserved explicitly and never inferred from generated projections', () => {
  assert.match(migration, /"fleet_entitled" boolean DEFAULT false NOT NULL/);
  assert.match(
    migration,
    /s\.origin_app IN \('ecoaudit', 'solarsense'\)[\s\S]+s\.role = 'admin'[\s\S]+s\.is_active/,
  );
  assert.match(
    migration,
    /NEW\.is_active, false, NEW\.created_at, NEW\.updated_at/,
  );
});
