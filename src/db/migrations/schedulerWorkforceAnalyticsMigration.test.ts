import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);

test('0044 adds additive workforce, completion attribution, and refund storage', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE TABLE "scheduler_leave_requests"/);
  assert.match(migration, /CREATE TABLE "scheduler_job_completion_facts"/);
  assert.match(migration, /CREATE TABLE "scheduler_invoice_refunds"/);
  assert.match(migration, /ALTER TABLE "global_users" ADD COLUMN "timezone" text DEFAULT 'Australia\/Sydney' NOT NULL/);
  assert.match(migration, /ALTER TABLE "global_users" ADD COLUMN "working_days_mask" integer DEFAULT 62 NOT NULL/);
  assert.match(migration, /scheduler_job_completion_facts_source_unique/);
  assert.match(migration, /scheduler_invoice_refunds_invoice_idempotency_unique/);
  assert.match(migration, /scheduler_leave_requests_date_order_check/);
  assert.match(migration, /scheduler_invoice_refunds_void_lifecycle_check/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "(?:ea_|ss_|ih_|portal_schedule_events)/);
});

test('0044 is the single append-only migration after the upstream 0043 history', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const entry = journal.entries.find(({ idx }) => idx === 44);
  assert.deepEqual(entry, {
    ...entry,
    idx: 44,
    tag: '0044_integrated_scheduler_entity_features',
  });
});
