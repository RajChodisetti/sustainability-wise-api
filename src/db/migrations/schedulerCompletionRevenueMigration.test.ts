import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);

test('0044 adds immutable completion revenue snapshots, capture time, and analytics indexes', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /ADD COLUMN "revenue_snapshot_status" text DEFAULT 'unavailable' NOT NULL/);
  assert.match(migration, /ADD COLUMN "currency" text/);
  assert.match(migration, /ADD COLUMN "amount_ex_gst_cents" bigint/);
  assert.match(migration, /ADD COLUMN "gst_amount_cents" bigint/);
  assert.match(migration, /ADD COLUMN "total_inc_gst_cents" bigint/);
  assert.match(migration, /ADD COLUMN "gst_rate_bps" integer/);
  assert.match(migration, /ADD COLUMN "revenue_captured_at" timestamp/);
  assert.match(migration, /scheduler_job_completion_facts_revenue_snapshot_check/);
  assert.match(migration, /scheduler_job_completion_facts_attribution_identity_check/);
  assert.match(migration, /"attribution_source" = 'unattributed'[\s\S]+"primary_global_user_id" IS NULL/);
  assert.match(
    migration,
    /revenue_snapshot_status" IN \('captured', 'incomplete'\)/,
  );
  assert.match(migration, /ea_audit_work_sessions_analytics_boundary_idx/);
  assert.match(migration, /ss_assessment_work_sessions_analytics_boundary_idx/);
  assert.match(migration, /ih_installation_work_sessions_analytics_boundary_idx/);
  assert.match(migration, /ea_audits_analytics_completed_idx/);
  assert.match(migration, /ss_rooftop_assessments_analytics_completed_idx/);
  assert.match(migration, /ih_installations_analytics_completed_idx/);
  assert.match(migration, /ea_audits_analytics_undated_completed_idx/);
  assert.match(migration, /ss_rooftop_assessments_analytics_undated_completed_idx/);
  assert.match(migration, /ih_installations_analytics_undated_completed_idx/);
  assert.match(migration, /WHERE "ea_audits"\."completed_at" IS NOT NULL AND "ea_audits"\."deleted_at" IS NULL/);
  assert.match(migration, /WHERE "ss_rooftop_assessments"\."completed_at" IS NOT NULL AND "ss_rooftop_assessments"\."deleted_at" IS NULL/);
  assert.match(migration, /WHERE "ih_installations"\."completed_at" IS NOT NULL AND "ih_installations"\."deleted_at" IS NULL/);
  assert.match(migration, /scheduler_invoices_created_idx/);
  assert.match(migration, /scheduler_invoices_issued_idx/);
  assert.match(migration, /scheduler_invoices_paid_idx/);
  assert.match(migration, /scheduler_invoices_voided_idx/);
  assert.match(migration, /scheduler_invoice_refunds_refunded_idx/);
  assert.match(migration, /scheduler_invoice_refunds_voided_idx/);
  assert.match(migration, /"currency" IS NOT NULL/);
  assert.match(migration, /"amount_ex_gst_cents" IS NOT NULL/);
  assert.match(migration, /"gst_amount_cents" IS NOT NULL/);
  assert.match(migration, /"total_inc_gst_cents" IS NOT NULL/);
  assert.match(migration, /"gst_rate_bps" IS NOT NULL/);
  assert.match(migration, /"revenue_captured_at" IS NOT NULL/);
  assert.match(migration, /"amount_ex_gst_cents" <= 9007199254740991/);
  assert.match(migration, /"gst_amount_cents" <= 9007199254740991/);
  assert.match(migration, /"total_inc_gst_cents" <= 9007199254740991/);
  assert.match(migration, /WITH legacy_products AS/);
  assert.match(migration, /FROM ea_audits audit\s+WHERE audit\.completed_at IS NOT NULL/);
  assert.match(migration, /FROM ss_rooftop_assessments assessment\s+WHERE assessment\.completed_at IS NOT NULL/);
  assert.match(migration, /FROM ih_installations installation\s+WHERE installation\.completed_at IS NOT NULL/);
  assert.match(migration, /ON CONFLICT \(source_app, source_type, source_id\) DO NOTHING/);
});

test('0044 retains products and makes every completion-fact field immutable', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_product_source_delete_retention_fence"/);
  assert.match(migration, /SELECT 1 FROM "scheduler_job_completion_facts"/);
  assert.match(migration, /OLD\."completed_at" IS NOT NULL/);
  assert.match(migration, /OLD\."status" = 'Completed'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_completion_fact_immutability_fence"/);
  assert.match(migration, /scheduler_completion_fact_delete_blocked/);
  assert.match(migration, /scheduler_completion_fact_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "scheduler_job_completion_facts"/);
  assert.match(migration, /scheduler_product_completion_update_retention_fence/);
  assert.match(migration, /scheduler_historical_completion_update_blocked/);
  assert.match(migration, /BEFORE UPDATE OF "status", "completed_at" ON "ea_audits"/);
  assert.match(migration, /BEFORE UPDATE OF "status", "completed_at" ON "ss_rooftop_assessments"/);
  assert.match(migration, /BEFORE UPDATE OF "status", "completed_at" ON "ih_installations"/);
  assert.match(migration, /BEFORE UPDATE OF "status", "completed_at" ON "ss_sites"/);
});

test('0044 freezes invoice identity and post-draft accounting snapshots', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_invoice_lifecycle_fence"/);
  assert.match(migration, /scheduler_invoice_snapshot_immutable/);
  assert.match(migration, /scheduler_invoice_insert_lifecycle_invalid/);
  assert.match(migration, /scheduler_invoice_lifecycle_evidence_invalid/);
  assert.match(migration, /scheduler_invoice_status_transition_invalid/);
  assert.match(migration, /DROP TRIGGER IF EXISTS "scheduler_invoices_lifecycle_fence_trigger"/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "scheduler_invoices"/);
});

test('0044 blocks invoice void while a posted refund exists', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_invoice_posted_refund_void_fence"/);
  assert.match(migration, /refund\.status = 'posted'/);
  assert.match(migration, /scheduler_invoice_posted_refund_blocks_void/);
  assert.match(migration, /USING ERRCODE = '23514'/);
  assert.match(migration, /CREATE TRIGGER "scheduler_invoice_posted_refund_void_fence_trigger"/);
});

test('0044 makes refund evidence append-only and fences both sides of invoice void races', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_invoice_refund_insert_fence"/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /scheduler_invoice_refund_invoice_status_invalid/);
  assert.match(migration, /BEFORE INSERT ON "scheduler_invoice_refunds"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_invoice_refund_immutability_fence"/);
  assert.match(migration, /scheduler_invoice_refund_delete_blocked/);
  assert.match(migration, /scheduler_invoice_refund_lifecycle_immutable/);
  assert.match(migration, /scheduler_invoice_refund_core_immutable/);
  assert.match(migration, /scheduler_invoice_refund_revision_invalid/);
  assert.match(migration, /scheduler_invoice_refund_void_time_invalid/);
  assert.match(migration, /scheduler_invoice_refund_currency_mismatch/);
  assert.match(migration, /scheduler_invoice_refund_invoice_snapshot_invalid/);
  assert.match(migration, /scheduler_invoice_refund_amount_invalid/);
  assert.match(migration, /scheduler_invoice_refund_time_invalid/);
  assert.match(migration, /scheduler_invoice_refund_capacity_exceeded/);
  assert.match(migration, /scheduler_invoice_refund_gst_invalid/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "scheduler_invoice_refunds"/);
});

test('0044 remains an append-only Drizzle journal entry', async () => {
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
