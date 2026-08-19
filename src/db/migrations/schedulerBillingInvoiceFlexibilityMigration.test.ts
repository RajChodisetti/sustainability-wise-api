import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0038_yielding_wolfsbane.sql', import.meta.url);

test('0038 delinks Eco from Scheduler without mutating Eco jobs', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /UPDATE "portal_schedule_events"[\s\S]*"source_app" = 'ecoaudit'/);
  assert.match(migration, /UPDATE "scheduler_notification_jobs"[\s\S]*"source_app" = 'ecoaudit'/);
  assert.match(migration, /CREATE TRIGGER "portal_schedule_events_active_source_fence_trigger"/);
  assert.match(migration, /NEW\."source_app" = 'ecoaudit'[\s\S]*NEW\."status" IN \('planned', 'in_progress'\)/);
  assert.ok(
    migration.indexOf('CREATE TRIGGER "portal_schedule_events_active_source_fence_trigger"')
      < migration.indexOf('UPDATE "portal_schedule_events"'),
    'the active-source fence must be installed before the Eco event cutover',
  );
  assert.ok(
    migration.indexOf('UPDATE "scheduler_notification_deliveries"')
      < migration.indexOf('ALTER TABLE "global_users"'),
    'event and notification cutover locks must precede global-user DDL',
  );
  assert.ok(
    migration.indexOf('UPDATE "scheduler_notification_jobs"')
      < migration.indexOf('UPDATE "scheduler_notification_deliveries"'),
    'notification jobs must be locked before their deliveries',
  );
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "ea_audits"/);
});

test('0038 adds canonical user rates and zeroes existing explicit hour state without touching pristine ledgers', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /ALTER TABLE "global_users" ADD COLUMN "billing_rate_cents" bigint/);
  assert.match(migration, /"billing_rate_cents" IS NULL OR[\s\S]*"billing_rate_cents" >= 0/);
  assert.match(migration, /"billing_rate_cents" <= 9007199254740991/);
  assert.match(migration, /FROM "scheduler_job_hour_overrides" AS hours/);
  assert.match(migration, /GROUP BY hours\."finance_id"/);
  assert.match(migration, /FROM "scheduler_job_finance" AS finance[\s\S]*ORDER BY finance\."id"[\s\S]*FOR UPDATE;/);
  assert.ok(
    migration.indexOf('FROM "scheduler_job_finance" AS finance')
      < migration.indexOf('ALTER TABLE "global_users"'),
    'finance rows must be locked before finance-related DDL',
  );
  const latestOverrideCte = migration.split('WITH latest AS (')[1]?.split('INSERT INTO')[0] ?? '';
  assert.doesNotMatch(latestOverrideCte, /scheduler_job_finance/);
  assert.match(migration, /'Existing commercial hours reset to zero'/);
  assert.doesNotMatch(migration, /latest\."source" = 'legacy_estimate'/);
});

test('0038 makes only draft invoice lines editable and defaults new lines to amount-only', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /ADD COLUMN "show_quantity_and_rate" boolean DEFAULT true NOT NULL/);
  assert.match(migration, /ALTER COLUMN "show_quantity_and_rate" SET DEFAULT false/);
  assert.match(migration, /invoice\."status" = 'draft'/);
  assert.ok(
    migration.indexOf('CREATE OR REPLACE FUNCTION "scheduler_invoice_line_reservation_fence"')
      < migration.indexOf('SET "show_quantity_and_rate" = false'),
    'draft-line backfill must run only after replacing the immutable legacy trigger function',
  );
  assert.match(
    migration,
    /DISABLE TRIGGER "scheduler_invoice_lines_reservation_fence_trigger"[\s\S]*SET "show_quantity_and_rate" = false[\s\S]*ENABLE TRIGGER "scheduler_invoice_lines_reservation_fence_trigger"/,
  );
  assert.match(migration, /IF v_invoice_status <> 'draft' THEN[\s\S]*scheduler_invoice_lines_immutable/);
  assert.match(migration, /scheduler_invoice_expense_already_reserved/);
  assert.match(migration, /IF FOUND AND v_invoice_status <> 'draft' THEN/);
  assert.match(migration, /CREATE TRIGGER "scheduler_invoices_lifecycle_fence_trigger"/);
  assert.match(migration, /OLD\."status" = 'draft' AND NEW\."status" IN \('issued', 'void'\)/);
  assert.match(migration, /OLD\."status" = 'issued' AND NEW\."status" IN \('paid', 'void'\)/);
  assert.match(migration, /TG_OP = 'DELETE'[\s\S]*OLD\."status" <> 'draft'/);
  assert.match(migration, /FROM "scheduler_job_finance"[\s\S]*FOR UPDATE;[\s\S]*FROM "scheduler_invoices"[\s\S]*FOR UPDATE;/);

  const commercialFence = migration.split(
    'CREATE OR REPLACE FUNCTION "scheduler_finance_commercial_mutation_fence"()',
  )[1] ?? '';
  assert.match(commercialFence, /currency/);
  assert.doesNotMatch(commercialFence, /pricing_mode|quoted_amount_cents|billable_rate_cents/);
});
