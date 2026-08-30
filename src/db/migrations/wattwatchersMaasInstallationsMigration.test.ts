import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0053_wattwatchers_maas_installations.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0052_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0053_snapshot.json', import.meta.url);

test('0053 adds source-auditable Fleet installation and replacement assignments', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ww_device_installation_assignments"/);
  assert.match(migration, /"fleet_account_client_id" text NOT NULL/);
  assert.match(migration, /"business_client_id" text NOT NULL/);
  assert.match(migration, /"business_site_id" text/);
  assert.match(migration, /"existing_device_id" text/);
  assert.match(migration, /"new_device_id" text/);
  assert.match(migration, /"current_device_id" text NOT NULL/);
  assert.match(migration, /ww_device_installation_assignments_date_check/);
  assert.match(migration, /ww_device_installation_assignments_device_check/);
  assert.match(migration, /ww_device_installation_assignments_unknown_site_check/);
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)|TRUNCATE|DELETE FROM/i);
});

test('0053 snapshot and append-only journal follow 0052', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(
    journal.entries.find(({ idx }) => idx === 53)?.tag,
    '0053_wattwatchers_maas_installations',
  );

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as { id: string };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  const table = snapshot.tables['public.ww_device_installation_assignments'];
  assert.ok(table);
  assert.ok(table.columns.fleet_account_client_id);
  assert.ok(table.columns.business_client_id);
  assert.ok(table.columns.current_device_id);
});
