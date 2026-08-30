import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('./0052_scheduler_annual_targets.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('./meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const previousSnapshot = JSON.parse(readFileSync(
  new URL('./meta/0051_snapshot.json', import.meta.url),
  'utf8',
)) as { id: string };
const snapshot = JSON.parse(readFileSync(
  new URL('./meta/0052_snapshot.json', import.meta.url),
  'utf8',
)) as { prevId: string; tables: Record<string, unknown> };

test('0052 stores audited positive year-specific Scheduler revenue targets', () => {
  assert.match(migration, /CREATE TABLE "scheduler_annual_targets"/);
  assert.match(migration, /PRIMARY KEY\("company_key","year"\)/);
  assert.match(migration, /"amount_ex_gst_cents" bigint NOT NULL/);
  assert.match(migration, /"amount_ex_gst_cents" > 0/);
  assert.match(migration, /"currency" ~ '\^\[A-Z\]\{3\}\$'/);
  assert.match(migration, /ON DELETE set null/);
  assert.doesNotMatch(migration, /(?:^|\n)\s*(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|DROP)\b/im);
});

test('0052 snapshot and append-only journal follow 0051', () => {
  assert.equal(
    journal.entries.find(({ idx }) => idx === 52)?.tag,
    '0052_scheduler_annual_targets',
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.scheduler_annual_targets']);
});
