import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0063_youthful_franklin_richards.sql', import.meta.url);

test('EcoAudit edit protocol migration adds only the new concurrency contract', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  for (const table of [
    'ea_audit_edit_leases',
    'ea_audit_edit_lease_events',
    'ea_audit_idempotency',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
  for (const column of [
    'tree_revision',
    'record_version_number',
    'edit_fence',
    'copied_from_audit_id',
    'copied_from_record_version_number',
    'lineage_root_audit_id',
    'copy_purpose',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE "ea_audits" ADD COLUMN "${column}"`));
  }

  assert.doesNotMatch(sql, /CREATE TABLE "ea_water_assets"/);
  assert.doesNotMatch(sql, /ALTER TABLE "ih_/);
  assert.doesNotMatch(sql, /^(?:DROP|TRUNCATE|UPDATE|DELETE FROM)\s/imu);
  assert.equal((sql.match(/ON DELETE cascade/g) ?? []).length, 3);
});
