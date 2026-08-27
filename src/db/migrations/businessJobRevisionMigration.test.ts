import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('./0046_sweet_vulture.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('./meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const previousSnapshot = JSON.parse(readFileSync(
  new URL('./meta/0045_snapshot.json', import.meta.url),
  'utf8',
)) as { id: string };
const snapshot = JSON.parse(readFileSync(
  new URL('./meta/0046_snapshot.json', import.meta.url),
  'utf8',
)) as { prevId: string; tables: Record<string, { columns: Record<string, unknown> }> };

test('0046 gives every site and app a deterministic append-only job revision chain', () => {
  assert.match(migration, /ADD COLUMN "revision_number" integer DEFAULT 1 NOT NULL/);
  assert.match(migration, /ADD COLUMN "previous_job_id" text/);
  assert.match(
    migration,
    /PARTITION BY "site_id", "source_app"[\s\S]*ORDER BY "created_at", "id"/,
  );
  assert.match(migration, /lag\("id"\)/);
  assert.match(migration, /business_jobs_previous_job_fk/);
  assert.match(migration, /business_jobs_site_app_revision_unique/);
  assert.ok(
    migration.indexOf('UPDATE "business_jobs" AS target')
      < migration.indexOf('CREATE UNIQUE INDEX "business_jobs_site_app_revision_unique"'),
  );
});

test('0046 snapshot and journal extend 0045 without rewriting it', () => {
  assert.equal(journal.entries.find(({ idx }) => idx === 46)?.tag, '0046_sweet_vulture');
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.business_jobs']?.columns.revision_number);
  assert.ok(snapshot.tables['public.business_jobs']?.columns.previous_job_id);
});
