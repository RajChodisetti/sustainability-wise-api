import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0044_integrated_scheduler_entity_features.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0043_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0044_snapshot.json', import.meta.url);

const installationColumns = [
  'customer_name',
  'maas',
  'service_type',
  'metering_solution_type',
  'planned_meter_type',
  'site_contact_name',
  'site_contact_phone',
  'site_contact_email',
  'fergus_job_number',
  'quote_number',
  'job_comments',
  'access_information',
  'warranty_device',
  'monitoring_installed',
  'hardware_installed',
  'solar_capacity_kw',
  'additional_monitoring_required',
  'additional_monitoring_hardware',
] as const;

test('0044 adds nullable InstallHub job metadata and separate Xero reconciliation fields', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  for (const column of installationColumns) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE "ih_installations" ADD COLUMN "${column}"`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`ADD COLUMN "${column}"[^;]*NOT NULL`),
    );
  }
  assert.match(
    migration,
    /ALTER TABLE "scheduler_invoices" ADD COLUMN "xero_invoice_number" text/,
  );
  assert.match(
    migration,
    /ALTER TABLE "scheduler_invoices" ADD COLUMN "xero_date" date/,
  );
  assert.match(migration, /ih_installations_solar_capacity_kw_check/);
  assert.match(migration, /ih_installations_site_contact_email_length_check/);
  assert.match(migration, /scheduler_invoices_xero_invoice_number_check/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "scheduler_invoice_lifecycle_fence"/);
  assert.match(
    migration,
    /to_jsonb\(NEW\) - ARRAY\['xero_invoice_number', 'xero_date', 'updated_at'\]/,
  );
  assert.match(migration, /IF OLD\."status" = 'void'[\s\S]+scheduler_invoice_snapshot_immutable/);
  assert.doesNotMatch(migration, /UPDATE\s+"ih_installations"\s+SET/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"ih_installations"/i);
  assert.doesNotMatch(migration, /DROP COLUMN|TRUNCATE/i);
});

test('0044 snapshot and append-only journal follow upstream 0043', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  assert.deepEqual(journal.entries.find(({ idx }) => idx === 44), {
    idx: 44,
    version: '7',
    when: journal.entries.find(({ idx }) => idx === 44)?.when,
    tag: '0044_integrated_scheduler_entity_features',
    breakpoints: true,
  });

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as {
    id: string;
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  const installation = snapshot.tables['public.ih_installations'];
  for (const column of installationColumns) assert.ok(installation?.columns[column]);
  assert.ok(snapshot.tables['public.scheduler_invoices']?.columns.xero_invoice_number);
  assert.ok(snapshot.tables['public.scheduler_invoices']?.columns.xero_date);
});
