import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_ONE_HOUR_MIGRATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('./', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('0041 backfills only eligible future one-hour reminders and is rerun-safe', {
  skip: !integrationDatabase,
  timeout: 120_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 1 });
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0041_')
    .sort();

  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    for (const migration of priorMigrations) {
      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSource(migration));
      });
    }

    await sql.unsafe(`
      INSERT INTO global_users (
        id, login_key, field_user_id, primary_origin_app,
        primary_origin_user_id, display_email, role, is_active
      ) VALUES
        ('active-user', 'active@example.test', 'active-field', 'ecoaudit',
         'active-eco', 'active@example.test', 'inspector', true),
        ('inactive-user', 'inactive@example.test', 'inactive-field', 'ecoaudit',
         'inactive-eco', 'inactive@example.test', 'inspector', false),
        ('inactive-membership-user', 'membership@example.test', 'membership-field',
         'ecoaudit', 'inactive-membership-eco', 'membership@example.test',
         'inspector', true)
    `);
    await sql.unsafe(`
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id,
        email, password_hash, role, is_active, source_created_at,
        source_updated_at, deleted_at
      ) VALUES
        ('active-eco-membership', 'active-user', 'ecoaudit', 'active-eco',
         'active-field', 'active@example.test', 'test-only', 'inspector', true,
         now(), now(), null),
        ('active-solar-membership', 'active-user', 'solarsense', 'active-solar',
         'active-field', 'active@example.test', 'test-only', 'inspector', true,
         now(), now(), null),
        ('active-field-membership', 'active-user', 'installhub', 'active-installhub',
         'active-field', 'active@example.test', 'test-only', 'inspector', true,
         now(), now(), null),
        ('inactive-global-eco-membership', 'inactive-user', 'ecoaudit', 'inactive-eco',
         'inactive-field', 'inactive@example.test', 'test-only', 'inspector', true,
         now(), now(), null),
        ('inactive-eco-membership', 'inactive-membership-user', 'ecoaudit',
         'inactive-membership-eco', 'membership-field', 'membership@example.test',
         'test-only', 'inspector', false, now(), now(), null)
    `);
    await sql.unsafe(`
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, status,
        assigned_inspector_user_id, deleted_at
      ) VALUES
        ('audit-active', 'Private active audit', 'Private address', 'Inspector',
         'Draft', 'active-eco', null),
        ('audit-inactive-global', 'Private inactive audit', 'Private address',
         'Inspector', 'Draft', 'inactive-eco', null),
        ('audit-inactive-membership', 'Private membership audit', 'Private address',
         'Inspector', 'Draft', 'inactive-membership-eco', null),
        ('audit-misaligned', 'Private mismatch', 'Private address', 'Inspector',
         'Draft', 'inactive-eco', null),
        ('audit-completed', 'Private completed audit', 'Private address', 'Inspector',
         'Completed', 'active-eco', null),
        ('audit-deleted', 'Private deleted audit', 'Private address', 'Inspector',
         'Draft', 'active-eco', now())
    `);
    await sql.unsafe(`
      INSERT INTO ss_sites (id, site_name, status, deleted_at) VALUES
        ('site-active', 'Private active site', 'Draft', null),
        ('site-completed', 'Private completed site', 'Completed', null)
    `);
    await sql.unsafe(`
      INSERT INTO ss_rooftop_assessments (
        id, site_id, site_name, building_id_name, status,
        assigned_inspector_user_id, deleted_at
      ) VALUES
        ('assessment-active', 'site-active', 'Private active site', 'Roof 1',
         'Draft', 'active-solar', null),
        ('assessment-bad-parent', 'site-completed', 'Private completed site', 'Roof 2',
         'Draft', 'active-solar', null)
    `);
    await sql.unsafe(`
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date,
        status, assigned_inspector_user_id, deleted_at
      ) VALUES
        ('installation-active', 'Private client', 'Private install', 'Private address',
         'Inspector', '2026-08-18', 'Draft', 'active-field', null)
    `);
    await sql.unsafe(`
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, source_id,
        assignee_field_user_id, scheduled_start_at, deadline_at,
        status, created_by_user_id, created_by_app
      ) VALUES
        ('eligible-eco', 'Private Eco title', 'ecoaudit', 'audit', 'audit-active',
         'active-field', now() + interval '4 hours', now() + interval '5 hours',
         'planned', 'admin', 'ecoaudit'),
        ('eligible-solar', 'Private Solar title', 'solarsense', 'assessment',
         'assessment-active', 'active-field', now() + interval '5 hours',
         now() + interval '6 hours', 'in_progress', 'admin', 'ecoaudit'),
        ('eligible-field', 'Private Field title', 'installhub', 'installation',
         'installation-active', 'active-field', now() + interval '6 hours',
         now() + interval '7 hours', 'planned', 'admin', 'ecoaudit'),
        ('inside-hour', 'Private near title', 'ecoaudit', 'audit', 'audit-active',
         'active-field', now() + interval '30 minutes', now() + interval '2 hours',
         'planned', 'admin', 'ecoaudit'),
        ('inactive-global', 'Private inactive title', 'ecoaudit', 'audit',
         'audit-inactive-global', 'inactive-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('inactive-membership', 'Private inactive membership', 'ecoaudit', 'audit',
         'audit-inactive-membership', 'membership-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('misaligned', 'Private mismatch title', 'ecoaudit', 'audit',
         'audit-misaligned', 'active-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('completed-source', 'Private completed title', 'ecoaudit', 'audit',
         'audit-completed', 'active-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('deleted-source', 'Private deleted title', 'ecoaudit', 'audit',
         'audit-deleted', 'active-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('bad-solar-parent', 'Private parent title', 'solarsense', 'assessment',
         'assessment-bad-parent', 'active-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('legacy-solar-site', 'Private legacy site', 'solarsense', 'site',
         'site-active', 'active-field', now() + interval '4 hours',
         now() + interval '5 hours', 'planned', 'admin', 'ecoaudit'),
        ('custom-event', 'Private custom title', 'custom', 'custom', null,
         'active-field', now() + interval '4 hours', now() + interval '5 hours',
         'planned', 'admin', 'ecoaudit'),
        ('done-event', 'Private done title', 'ecoaudit', 'audit', 'audit-active',
         'active-field', now() + interval '4 hours', now() + interval '5 hours',
         'done', 'admin', 'ecoaudit')
    `);

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0041_one_hour_scheduler_notifications.sql'));
    });

    const jobs = await sql<{
      event_id: string;
      notification_kind: string;
      title: string;
      body: string;
      max_attempts: number;
      timing_ok: boolean;
      payload_time_ok: boolean;
      payload_is_generic: boolean;
    }[]>`
      SELECT
        job.event_id,
        job.notification_kind,
        job.title,
        job.body,
        job.max_attempts,
        job.available_at = event.scheduled_start_at - interval '1 hour' AS timing_ok,
        job.payload ->> 'scheduledStartAt' = to_char(
          (event.scheduled_start_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS payload_time_ok,
        job.payload::text NOT LIKE '%Private%' AS payload_is_generic
      FROM scheduler_notification_jobs job
      JOIN portal_schedule_events event ON event.id = job.event_id
      WHERE job.notification_kind = 'one_hour_before'
      ORDER BY job.event_id
    `;
    assert.deepEqual(
      jobs.map((job) => job.event_id),
      ['eligible-eco', 'eligible-field', 'eligible-solar'],
    );
    for (const job of jobs) {
      assert.equal(job.notification_kind, 'one_hour_before');
      assert.equal(job.title, 'Job starts soon');
      assert.equal(job.body, 'A scheduled job starts within an hour.');
      assert.equal(job.max_attempts, 16);
      assert.equal(job.timing_ok, true);
      assert.equal(job.payload_time_ok, true);
      assert.equal(job.payload_is_generic, true);
    }

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0041_one_hour_scheduler_notifications.sql'));
    });
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM scheduler_notification_jobs
      WHERE notification_kind = 'one_hour_before'
    `;
    assert.equal(count, 3);

    await assert.rejects(
      sql.unsafe(`
        INSERT INTO scheduler_notification_jobs (
          id, event_id, global_user_id, source_app, notification_kind,
          title, body, payload, dedupe_key, status, available_at,
          attempts, max_attempts
        ) VALUES (
          'unknown-kind-job', 'eligible-eco', 'active-user', 'ecoaudit',
          'unknown_kind', 'Generic', 'Generic', '{}'::jsonb,
          'unknown-kind-dedupe', 'queued', now(), 0, 16
        )
      `),
      (error: unknown) => (error as { code?: string }).code === '23514',
    );
  } finally {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.end({ timeout: 5 });
  }
});
