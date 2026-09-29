import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0064_fancy_lilandra.sql', import.meta.url);

test('EcoAudit purge tombstones permanently fence IDs and retain lease event history', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /CREATE TABLE "ea_audit_purge_tombstones"/);
  assert.match(sql, /"audit_id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"purged_by_user_id" text NOT NULL/);
  assert.match(sql, /"last_tree_revision" integer NOT NULL/);
  assert.match(sql, /"last_edit_fence" integer NOT NULL/);
  assert.match(
    sql,
    /ALTER TABLE "ea_audit_edit_lease_events" DROP CONSTRAINT "ea_audit_edit_lease_events_audit_id_ea_audits_id_fk"/,
  );
  assert.doesNotMatch(sql, /token|secret|idempotency_key/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
