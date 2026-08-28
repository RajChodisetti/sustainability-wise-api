import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('./0051_job_actor_billing_rate_overrides.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(new URL('./meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> };
const previousSnapshot = JSON.parse(
  readFileSync(new URL('./meta/0050_snapshot.json', import.meta.url), 'utf8'),
) as { id: string };
const snapshot = JSON.parse(
  readFileSync(new URL('./meta/0051_snapshot.json', import.meta.url), 'utf8'),
) as { prevId: string; tables: Record<string, unknown> };

test('0051 stores one safe per-job billing-rate override for each canonical user', () => {
  assert.match(
    migration,
    /CREATE TABLE "scheduler_job_actor_billing_rate_overrides"/,
  );
  assert.match(migration, /"finance_id" text NOT NULL/);
  assert.match(migration, /"global_user_id" text NOT NULL/);
  assert.match(migration, /"billing_rate_cents" bigint NOT NULL/);
  assert.match(migration, /"updated_by_global_user_id" text NOT NULL/);
  assert.match(migration, /PRIMARY KEY\("finance_id","global_user_id"\)/);
  assert.match(migration, /"billing_rate_cents" >= 0/);
  assert.match(migration, /"billing_rate_cents" <= 9007199254740991/);
  assert.equal((migration.match(/ON DELETE restrict/g) ?? []).length, 3);
  assert.match(
    migration,
    /scheduler_job_actor_billing_rate_overrides_user_idx[\s\S]*\("global_user_id"\)/,
  );
  assert.doesNotMatch(
    migration,
    /(?:^|\n)\s*(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|DROP)\b/im,
  );
});

test('0051 snapshot and append-only journal follow 0050', () => {
  assert.equal(
    journal.entries.find(({ idx }) => idx === 51)?.tag,
    '0051_job_actor_billing_rate_overrides',
  );
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.ok(
    snapshot.tables['public.scheduler_job_actor_billing_rate_overrides'],
  );
});
