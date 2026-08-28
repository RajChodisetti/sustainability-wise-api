import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('./0050_ambiguous_speedball.sql', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('./meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const previousSnapshot = JSON.parse(readFileSync(
  new URL('./meta/0049_snapshot.json', import.meta.url),
  'utf8',
)) as { id: string };
const snapshot = JSON.parse(readFileSync(
  new URL('./meta/0050_snapshot.json', import.meta.url),
  'utf8',
)) as { prevId: string; tables: Record<string, unknown> };

test('0050 stores one current seller ABN and makes issued invoices revisable', () => {
  assert.match(migration, /CREATE TABLE "scheduler_invoice_settings"/);
  assert.match(migration, /"company_key" text PRIMARY KEY/);
  assert.match(migration, /seller_abn_check/);
  assert.match(migration, /OLD\."status" = 'issued' AND NEW\."status" = 'issued'/);
  assert.match(migration, /v_invoice_status NOT IN \('draft', 'issued'\)/);
  assert.match(migration, /stored PDF artifacts[\s\S]*append-only evidence/);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i);
});

test('0050 snapshot and append-only journal follow 0049', () => {
  assert.equal(journal.entries.find(({ idx }) => idx === 50)?.tag, '0050_ambiguous_speedball');
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(snapshot.tables['public.scheduler_invoice_settings']);
});
