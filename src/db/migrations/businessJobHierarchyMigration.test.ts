import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0045_little_warstar.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);
const previousSnapshotUrl = new URL('./meta/0044_snapshot.json', import.meta.url);
const snapshotUrl = new URL('./meta/0045_snapshot.json', import.meta.url);

test('0045 adds and backfills the shared client site job hierarchy without removing legacy data', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  for (const table of [
    'business_clients',
    'business_sites',
    'business_jobs',
    'field_app_job_details',
    'ecoaudit_job_details',
    'solarsense_job_details',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /portal_schedule_events" ADD COLUMN "job_id" text/);
  assert.match(migration, /business_sites_client_id_business_clients_id_fk/);
  assert.match(migration, /business_jobs_site_id_business_sites_id_fk/);
  assert.match(migration, /INSERT INTO "field_app_job_details"/);
  assert.match(migration, /COALESCE\(NULLIF\(btrim\("service_type"\), ''\), 'legacy_unclassified'\)/);
  assert.match(migration, /UPDATE "portal_schedule_events" e[\s\S]+SET "job_id" = j\."id"/);
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)|TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE "ih_installations"/i);
});

test('0045 snapshot and append-only journal follow upstream 0044', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.find(({ idx }) => idx === 45)?.tag, '0045_little_warstar');

  const previousSnapshot = JSON.parse(await readFile(previousSnapshotUrl, 'utf8')) as { id: string };
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8')) as {
    prevId: string;
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.business_clients']);
  assert.ok(snapshot.tables['public.business_sites']);
  assert.ok(snapshot.tables['public.business_jobs']);
  assert.ok(snapshot.tables['public.field_app_job_details']);
  assert.ok(snapshot.tables['public.portal_schedule_events']?.columns.job_id);
});
