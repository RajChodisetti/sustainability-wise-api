import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0039_heavy_slayback.sql', import.meta.url);

test('0039 enforces whole billable hours on future override writes', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(
    migration,
    /ADD CONSTRAINT "scheduler_job_hour_overrides_billable_whole_hours_check"/,
  );
  assert.match(
    migration,
    /mod\("scheduler_job_hour_overrides"\."billable_milliseconds", 3600000\) = 0/,
  );
  assert.match(migration, /\) NOT VALID;/);
  assert.doesNotMatch(migration, /mod\([^)]*"cost_milliseconds"/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "scheduler_job_hour_overrides"/);
});
