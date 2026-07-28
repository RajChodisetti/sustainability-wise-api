import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fieldBridgeIdentity } from '../auth/loginIdentity.js';

const migration = readFileSync(
  new URL('./migrations/0014_unified_users_registry.sql', import.meta.url),
  'utf8',
);

test('shared-user migration is expand-only for every legacy user table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "unified_users"/);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:ea|ss|ih)_users"/);
  assert.doesNotMatch(migration, /INSERT INTO "(?:ea|ss|ih)_users"/);
  assert.doesNotMatch(migration, /UPDATE "(?:ea|ss|ih)_users"/);
  assert.doesNotMatch(migration, /DELETE FROM "(?:ea|ss|ih)_users"/);

  for (const table of ['ea_users', 'ss_users', 'ih_users']) {
    assert.match(
      migration,
      new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON "${table}"`),
    );
  }
});

test('legacy writers are locked before backfill and remain locked through trigger installation', () => {
  const lockIndex = migration.indexOf(
    'LOCK TABLE "ea_users", "ss_users", "ih_users"',
  );
  const backfillIndex = migration.indexOf('INSERT INTO "unified_users"');
  const firstTriggerIndex = migration.indexOf(
    'CREATE TRIGGER "ea_users_sync_unified_users"',
  );

  assert.ok(lockIndex >= 0, 'migration must lock every legacy user table');
  assert.ok(
    lockIndex < backfillIndex,
    'legacy writers must be blocked before the registry backfill starts',
  );
  assert.ok(
    firstTriggerIndex > backfillIndex,
    'trigger installation must occur before the migration transaction unlocks',
  );
  assert.match(migration, /IN SHARE ROW EXCLUSIVE MODE/);
});

test('one generic trigger only reads columns shared by all legacy user rows', () => {
  const functionBody = migration.match(
    /CREATE OR REPLACE FUNCTION "sync_legacy_user_to_unified_users"\(\)([\s\S]+?)\n\$\$;/,
  )?.[1];
  assert.ok(functionBody);
  assert.doesNotMatch(functionBody, /NEW\."source_app"/);
  assert.doesNotMatch(functionBody, /NEW\."source_user_id"/);
  assert.match(functionBody, /NEW\."password_hash"/);
  assert.match(functionBody, /NEW\."role"/);
  assert.match(functionBody, /NEW\."is_active"/);
});

test('database and API derive the same collision-free Field subject', () => {
  const source = { app: 'ecoaudit' as const, id: 'legacy:user/42' };
  assert.equal(
    fieldBridgeIdentity(source).id,
    'unified-field:ecoaudit:legacy:user/42',
  );
  assert.match(
    migration,
    /'unified-field:' \|\| application_name \|\| ':' \|\| NEW\."id"/,
  );
});

test('deletes retain a tombstone and revoke Field refresh sessions', () => {
  assert.match(migration, /"deleted_at" = CURRENT_TIMESTAMP/);
  assert.match(migration, /"is_active" = false/);
  assert.match(migration, /UPDATE "public"\."refresh_tokens"/);
  assert.match(migration, /"app" = 'installhub'/);
  assert.match(migration, /"app" = application_name/);
});

test('legacy primary user IDs remain immutable authorization subjects', () => {
  assert.match(
    migration,
    /OLD\."id" IS DISTINCT FROM NEW\."id"[\s\S]+User IDs are immutable authorization subjects/,
  );
});
