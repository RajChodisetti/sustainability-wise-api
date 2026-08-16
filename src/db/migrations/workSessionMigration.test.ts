import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0028_fluffy_korath.sql', import.meta.url);

test('active-time migration creates isolated product session stores', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'ea_audit_work_sessions',
    'ss_assessment_work_sessions',
    'ih_installation_work_sessions',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    assert.match(sql, new RegExp(`${table}.*active_milliseconds_check`, 's'));
    assert.match(sql, new RegExp(`${table}.*revision_check`, 's'));
    assert.match(sql, new RegExp(`${table}.*time_order_check`, 's'));
  }
  assert.equal((sql.match(/ON DELETE cascade/g) ?? []).length, 3);
  assert.equal((sql.match(/_actor_idx/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /^(?:DROP|TRUNCATE|UPDATE|DELETE)\b/im);
  assert.doesNotMatch(sql, /ALTER TABLE "(?:ea_audits|ss_rooftop_assessments|ih_installations)"/);
});
