import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0042_third_wilson_fisk.sql', import.meta.url);

test('0042 adds an optional whole-minute Scheduler estimate with a bounded database fence', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(
    migration,
    /ALTER TABLE "portal_schedule_events" ADD COLUMN "estimated_duration_minutes" integer;/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "portal_schedule_events_estimated_duration_check" CHECK \([\s\S]*"estimated_duration_minutes" IS NULL[\s\S]*"estimated_duration_minutes" > 0[\s\S]*"estimated_duration_minutes" <= 10080[\s\S]*\) NOT VALID;/,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "portal_schedule_events_estimated_duration_check";/,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN "estimated_duration_minutes" integer (?:NOT NULL|DEFAULT)/,
  );
});

test('0042 preserves historical Scheduler timing rows and their legacy end timestamps', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "portal_schedule_events"/);
  assert.doesNotMatch(migration, /(?:DROP|ALTER) COLUMN "scheduled_end_at"/);
  assert.doesNotMatch(migration, /SET "estimated_duration_minutes"/);
});
