import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0047_lucky_richard_fisk.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0046_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0047_snapshot.json', import.meta.url);

test('0047 adds custody history and encrypted Fleet client credentials additively', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE "ih_inventory_meters"/);
  assert.match(migration, /CREATE TABLE "ih_inventory_meter_movements"/);
  assert.match(migration, /CREATE TABLE "ww_client_credentials"/);
  assert.match(migration, /global_users" ADD COLUMN "is_maintainer" boolean DEFAULT false NOT NULL/);
  assert.match(migration, /ww_clients" ADD COLUMN "source_business_client_id" text/);
  assert.match(migration, /ih_inventory_meters_custody_check/);
  assert.match(migration, /ww_clients_business_client_unique/);
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)|TRUNCATE|DELETE FROM/i);
});

test('0047 snapshot and append-only journal follow 0046', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.find(({ idx }) => idx === 47)?.tag, '0047_lucky_richard_fisk');

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as { id: string };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.ih_inventory_meters']);
  assert.ok(snapshot.tables['public.ih_inventory_meter_movements']);
  assert.ok(snapshot.tables['public.ww_client_credentials']);
  assert.ok(snapshot.tables['public.global_users']?.columns.is_maintainer);
  assert.ok(snapshot.tables['public.ww_clients']?.columns.source_business_client_id);
});
