import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('./0041_one_hour_scheduler_notifications.sql', import.meta.url);

test('0041 permits and durably backfills one-hour scheduler notifications', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(
    migration,
    /ADD CONSTRAINT "scheduler_notification_jobs_kind_check"[\s\S]*'one_day_before'[\s\S]*'one_hour_before'[\s\S]*'day_of'/,
  );
  assert.match(
    migration,
    /INSERT INTO "scheduler_notification_jobs"[\s\S]*'one_hour_before'[\s\S]*event\.scheduled_start_at - interval '1 hour'/,
  );
  assert.match(migration, /event\.scheduled_start_at - interval '1 hour' > now\(\)/);
  assert.equal(
    migration.match(
      /\(event\.scheduled_start_at AT TIME ZONE 'UTC'\) AT TIME ZONE 'UTC'/g,
    )?.length,
    2,
  );
  assert.match(migration, /event\.status IN \('planned', 'in_progress'\)/);
  assert.match(migration, /canonical_user\.is_active = true/);
  assert.equal(migration.match(/membership\.is_active = true/g)?.length, 3);
  assert.equal(migration.match(/membership\.deleted_at IS NULL/g)?.length, 3);

  assert.match(
    migration,
    /event\.source_app = 'ecoaudit'[\s\S]*event\.source_type = 'audit'[\s\S]*FROM "ea_audits" audit/,
  );
  assert.match(migration, /membership\.origin_user_id = audit\.assigned_inspector_user_id/);
  assert.match(
    migration,
    /event\.source_app = 'solarsense'[\s\S]*event\.source_type = 'assessment'[\s\S]*FROM "ss_rooftop_assessments" assessment/,
  );
  assert.match(
    migration,
    /JOIN "ss_sites" site[\s\S]*site\.status = 'Draft'[\s\S]*site\.deleted_at IS NULL/,
  );
  assert.match(
    migration,
    /event\.source_app = 'installhub'[\s\S]*event\.source_type = 'installation'[\s\S]*FROM "ih_installations" installation/,
  );
  assert.match(migration, /membership\.origin_app = 'installhub'/);
  assert.match(
    migration,
    /installation\.assigned_inspector_user_id = canonical_user\.field_user_id/,
  );

  assert.match(
    migration,
    /'scheduler:' \|\| event\.id \|\| ':migration:one_hour_before:'[\s\S]*extract\(epoch FROM event\.scheduled_start_at\)/,
  );
  assert.match(
    migration,
    /existing\.notification_kind = 'one_hour_before'[\s\S]*existing\.payload ->> 'scheduledStartAt'/,
  );
  assert.match(migration, /ON CONFLICT \("dedupe_key"\) DO NOTHING/);
  assert.match(migration, /'Job starts soon'/);
  assert.match(migration, /'A scheduled job starts within an hour\.'/);
  assert.match(migration, /\n\s*0,\n\s*16,\n\s*now\(\),/);
  assert.match(
    migration,
    /stop every pre-0041 notification worker before this[\s\S]*migration runs/,
  );

  assert.doesNotMatch(migration, /event\.(?:title|description|assignee_email)/);
  assert.doesNotMatch(migration, /event\.source_type = 'site'/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "portal_schedule_events"/);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM) "scheduler_notification_jobs"/);
});
