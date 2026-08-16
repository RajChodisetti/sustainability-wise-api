import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0031_careless_solo.sql', import.meta.url);
const generationMigrationUrl = new URL('./0032_normal_omega_flight.sql', import.meta.url);

test('scheduler notification migration has durable claims, token uniqueness, and receipts', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE "app_push_devices"/);
  assert.match(migration, /app_push_devices_active_token_unique/);
  assert.match(migration, /WHERE "app_push_devices"\."enabled" = true/);
  assert.match(migration, /CREATE TABLE "scheduler_notification_jobs"/);
  assert.match(migration, /"available_at" timestamp/);
  assert.match(migration, /"claim_token" text/);
  assert.match(migration, /"claimed_at" timestamp/);
  assert.match(migration, /CREATE TABLE "scheduler_notification_deliveries"/);
  assert.match(migration, /"ticket_id" text/);
  assert.match(migration, /"receipt_available_at" timestamp/);
  assert.match(migration, /scheduler_notification_deliveries_job_device_unique/);
  assert.match(migration, /'one_day_before'/);
  assert.match(migration, /scheduled_start_at - interval '24 hours' > now\(\)/);
  assert.match(migration, /'day_of'/);
  assert.match(migration, /event\.scheduled_start_at > now\(\)/);
  assert.equal(migration.match(/\n\s*16,\n\s*now\(\),/g)?.length, 2);
  assert.match(migration, /canonical_user\.field_user_id = event\.assignee_field_user_id/);
  assert.match(migration, /event\.source_app = 'ecoaudit'[\s\S]*event\.source_type = 'audit'/);
  assert.match(migration, /FROM "ea_audits" audit/);
  assert.match(migration, /membership\.origin_user_id = audit\.assigned_inspector_user_id/);
  assert.match(migration, /event\.source_app = 'solarsense'[\s\S]*event\.source_type = 'assessment'/);
  assert.match(migration, /FROM "ss_rooftop_assessments" assessment/);
  assert.match(migration, /JOIN "ss_sites" site/);
  assert.match(migration, /event\.source_app = 'installhub'[\s\S]*event\.source_type = 'installation'/);
  assert.match(migration, /installation\.assigned_inspector_user_id = event\.assignee_field_user_id/);
  assert.doesNotMatch(migration, /event\.source_type = 'site'/);
  assert.equal(
    migration.match(/ON CONFLICT \("dedupe_key"\) DO NOTHING/g)?.length,
    2,
  );
});

test('0032 adds per-owner device lifecycle fences with safe legacy backfill', async () => {
  const migration = await readFile(generationMigrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE "app_push_device_fences"/);
  assert.match(
    migration,
    /PRIMARY KEY\("app","device_id","global_user_id"\)/,
  );
  assert.match(migration, /"registration_generation" bigint DEFAULT 1 NOT NULL/);
  assert.match(migration, /FROM "app_push_devices" device/);
  assert.match(migration, /device\.disabled_reason = 'DeviceNotRegistered' THEN true/);
  assert.match(migration, /SET "max_attempts" = 16/);
  assert.match(migration, /ALTER COLUMN "max_attempts" SET DEFAULT 16/);
  assert.match(migration, /notification_job_no_longer_active/);
  assert.match(
    migration,
    /ON CONFLICT \("app", "device_id", "global_user_id"\) DO UPDATE/,
  );
  assert.equal(
    migration.match(/ALTER COLUMN "registration_generation" DROP DEFAULT/g)?.length,
    2,
  );
});
