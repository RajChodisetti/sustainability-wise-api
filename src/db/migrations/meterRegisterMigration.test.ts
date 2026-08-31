import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0054_meter_register_imports.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0053_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0054_snapshot.json', import.meta.url);

test('0054 adds immutable, source-auditable Meter Register storage', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /CREATE TABLE "ww_meter_register_imports"/);
  assert.match(migration, /CREATE TABLE "ww_meter_register_entries"/);
  assert.match(migration, /"workbook_sha256" text NOT NULL/);
  assert.match(migration, /"source_row_sha256" text NOT NULL/);
  assert.match(migration, /"source_payload" jsonb NOT NULL/);
  assert.match(migration, /"meter_cost_ex_gst_cents" bigint/);
  assert.match(migration, /"metering_recurring_fee_ex_gst_cents" bigint/);
  assert.match(migration, /"recurring_next_invoice_issue_date" date/);
  assert.match(migration, /"issued_period_next_invoice_issue_date" date/);

  assert.match(migration, /ww_meter_register_imports_counts_check/);
  assert.match(migration, /ww_meter_register_entries_classification_check/);
  assert.match(migration, /ww_meter_register_entries_identifier_check/);
  assert.match(migration, /ww_meter_register_entries_device_link_check/);
  assert.match(
    migration,
    /\("ww_meter_register_entries"\."existing_wattwatchers_device_id" IS NULL\) = \("ww_meter_register_entries"\."existing_device_classification" <> 'confirmed_wattwatchers'\)/,
  );
  assert.doesNotMatch(
    migration,
    /existing_wattwatchers_device_id" IS NULL OR [^\n]+candidate_wattwatchers/,
  );
  assert.match(migration, /"ww_meter_register_entries"\."source_row" >= 2/);
  assert.match(migration, /'absent', 'confirmed_wattwatchers', 'candidate_wattwatchers', 'other_hardware'/);

  assert.match(
    migration,
    /ww_meter_register_entries_import_fk[\s\S]*REFERENCES "public"\."ww_meter_register_imports"\("id"\) ON DELETE restrict/,
  );
  for (const name of ['existing', 'new', 'current']) {
    assert.match(
      migration,
      new RegExp(`ww_meter_register_entries_${name}_device_fk[\\s\\S]*REFERENCES "public"\\."ww_devices"\\("id"\\) ON DELETE restrict`),
    );
  }

  for (const indexName of [
    'ww_meter_register_imports_workbook_sheet_unique',
    'ww_meter_register_entries_source_unique',
    'ww_meter_register_entries_import_row_unique',
    'ww_meter_register_entries_existing_identifier_idx',
    'ww_meter_register_entries_new_identifier_idx',
    'ww_meter_register_entries_current_identifier_idx',
    'ww_meter_register_entries_job_completion_idx',
    'ww_meter_register_entries_maas_start_idx',
    'ww_meter_register_entries_recurring_next_idx',
    'ww_meter_register_entries_customer_idx',
    'ww_meter_register_entries_client_idx',
  ]) {
    assert.match(migration, new RegExp(`CREATE (?:UNIQUE )?INDEX "${indexName}"`));
  }

  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN|CONSTRAINT)|TRUNCATE|DELETE FROM|UPDATE\s+"/i);
});

test('0054 snapshot and append-only journal follow 0053', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(
    journal.entries.find(({ idx }) => idx === 54)?.tag,
    '0054_meter_register_imports',
  );

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as { id: string };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, {
      columns: Record<string, unknown>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, { onDelete?: string }>;
      checkConstraints: Record<string, { value?: string }>;
    }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);

  const imports = snapshot.tables['public.ww_meter_register_imports'];
  assert.ok(imports);
  assert.ok(imports.columns.workbook_sha256);
  assert.ok(imports.columns.source_row_count);
  assert.ok(imports.indexes.ww_meter_register_imports_workbook_sheet_unique);
  assert.ok(imports.checkConstraints.ww_meter_register_imports_counts_check);

  const entries = snapshot.tables['public.ww_meter_register_entries'];
  assert.ok(entries);
  for (const column of [
    'import_id',
    'source_key',
    'source_row_sha256',
    'current_device_identifier',
    'current_device_classification',
    'current_wattwatchers_device_id',
    'meter_cost_ex_gst_cents',
    'recurring_next_invoice_issue_date',
    'issued_period_next_invoice_issue_date',
    'source_payload',
  ]) {
    assert.ok(entries.columns[column], `missing snapshot column ${column}`);
  }
  assert.ok(entries.indexes.ww_meter_register_entries_import_row_unique);
  assert.ok(entries.indexes.ww_meter_register_entries_current_identifier_idx);
  assert.ok(entries.indexes.ww_meter_register_entries_customer_idx);
  assert.ok(entries.indexes.ww_meter_register_entries_client_idx);
  assert.equal(entries.foreignKeys.ww_meter_register_entries_import_fk?.onDelete, 'restrict');
  assert.equal(entries.foreignKeys.ww_meter_register_entries_existing_device_fk?.onDelete, 'restrict');
  assert.equal(entries.foreignKeys.ww_meter_register_entries_new_device_fk?.onDelete, 'restrict');
  assert.equal(entries.foreignKeys.ww_meter_register_entries_current_device_fk?.onDelete, 'restrict');
  assert.ok(entries.checkConstraints.ww_meter_register_entries_source_check);
  assert.ok(entries.checkConstraints.ww_meter_register_entries_identifier_check);
  assert.match(
    entries.checkConstraints.ww_meter_register_entries_device_link_check?.value ?? '',
    /existing_device_classification" <> 'confirmed_wattwatchers'/,
  );
});
