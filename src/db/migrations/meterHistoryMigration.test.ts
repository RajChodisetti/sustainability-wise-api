import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0022_tired_shiver_man.sql', import.meta.url);

test('meter history migration is append-only and does not depend on an active meter row', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE "ih_meter_history_events"/);
  assert.match(sql, /operation.*REPLACEMENT.*ROLLBACK/s);
  assert.match(sql, /from_record_version_number.*> 0/s);
  assert.match(sql, /source_form_submission_id.*UNIQUE INDEX/s);
  assert.match(sql, /ih_meter_history_events_installation_fk.*ON DELETE cascade/s);
  assert.doesNotMatch(sql, /ih_meter_history_events_meter_fk/);
  assert.doesNotMatch(sql, /ih_meter_history_events_source_form_fk/);
  assert.doesNotMatch(sql, /^(?:DROP|TRUNCATE|UPDATE|DELETE)\b/im);
});
