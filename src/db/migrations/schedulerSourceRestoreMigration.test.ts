import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0040_restore_scheduler_source_links.sql', import.meta.url);

test('0040 removes the Eco Scheduler write fence without rewriting historical rows', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(
    migration,
    /DROP TRIGGER IF EXISTS "portal_schedule_events_active_source_fence_trigger"[\s\S]*ON "portal_schedule_events"/,
  );
  assert.match(migration, /DROP FUNCTION IF EXISTS "scheduler_active_source_fence"\(\)/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "portal_schedule_events"/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "scheduler_notification_(?:jobs|deliveries)"/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "ea_audits"/);
});
