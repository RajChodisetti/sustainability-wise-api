import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0056_motionless_microchip.sql', import.meta.url);
const journalUrl = new URL('./meta/_journal.json', import.meta.url);

test('0056 adds bounded nullable existing device IDs to Field planning records', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /ALTER TABLE "ih_installations" ADD COLUMN "existing_device_id" text/);
  assert.match(migration, /ALTER TABLE "field_app_job_details" ADD COLUMN "existing_device_id" text/);
  assert.match(migration, /ih_installations_existing_device_id_length_check/);
  assert.match(migration, /field_app_job_details_existing_device_id_check/);
  assert.match(migration, /BETWEEN 1 AND 10000/);
  assert.doesNotMatch(migration, /existing_device_id"[^;]*NOT NULL/);
  assert.doesNotMatch(migration, /UPDATE\s+|DELETE\s+|DROP COLUMN|TRUNCATE/i);
});

test('0056 is registered after 0055 in the append-only migration journal', async () => {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.find(({ idx }) => idx === 55)?.tag, '0055_wattwatchers_meter_register_records');
  assert.equal(journal.entries.find(({ idx }) => idx === 56)?.tag, '0056_motionless_microchip');
});
