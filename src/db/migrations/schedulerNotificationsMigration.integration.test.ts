import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_NOTIFICATION_MIGRATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('./', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('0031-0032 backfill aligned reminders and legacy device generations safely', {
  skip: !integrationDatabase,
  timeout: 120_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 1 });
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0031_')
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
         'inactive-eco', 'inactive@example.test', 'inspector', false)
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
        ('inactive-eco-membership', 'inactive-user', 'ecoaudit', 'inactive-eco',
         'inactive-field', 'inactive@example.test', 'test-only', 'inspector', false,
         now(), now(), now())
    `);
    await sql.unsafe(`
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, status,
        assigned_inspector_user_id, deleted_at
      ) VALUES
        ('audit-1', 'Aligned audit', 'Private address', 'Inspector', 'Draft',
         'active-eco', null),
        ('audit-2', 'Done event audit', 'Private address', 'Inspector', 'Draft',
         'active-eco', null),
        ('audit-3', 'Inactive identity audit', 'Private address', 'Inspector', 'Draft',
         'inactive-eco', null),
        ('audit-misaligned', 'Misaligned audit', 'Private address', 'Inspector', 'Draft',
         'inactive-eco', null),
        ('audit-completed', 'Completed audit', 'Private address', 'Inspector', 'Completed',
         'active-eco', null),
        ('audit-deleted', 'Deleted audit', 'Private address', 'Inspector', 'Draft',
         'active-eco', now())
    `);
    await sql.unsafe(`
      INSERT INTO ss_sites (id, site_name, status, deleted_at) VALUES
        ('site-1', 'Active solar site', 'Draft', null),
        ('site-completed', 'Completed solar site', 'Completed', null)
    `);
    await sql.unsafe(`
      INSERT INTO ss_rooftop_assessments (
        id, site_id, site_name, building_id_name, status,
        assigned_inspector_user_id, deleted_at
      ) VALUES
        ('assessment-1', 'site-1', 'Active solar site', 'Building 1', 'Draft',
         'active-solar', null),
        ('assessment-bad-parent', 'site-completed', 'Completed solar site', 'Building 2',
         'Draft', 'active-solar', null)
    `);
    await sql.unsafe(`
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date,
        status, assigned_inspector_user_id, deleted_at
      ) VALUES
        ('installation-1', 'Client', 'Past install', 'Private address', 'Inspector',
         '2026-08-16', 'Draft', 'active-field', null),
        ('installation-future', 'Client', 'Future install', 'Private address', 'Inspector',
         '2026-08-16', 'Draft', 'active-field', null),
        ('installation-misaligned', 'Client', 'Misaligned install', 'Private address',
         'Inspector', '2026-08-16', 'Draft', 'inactive-field', null)
    `);
    await sql.unsafe(`
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, source_id,
        assignee_field_user_id, scheduled_start_at, deadline_at,
        status, created_by_user_id, created_by_app
      ) VALUES
        ('future-event', 'Private future title', 'ecoaudit', 'audit', 'audit-1',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('inside-day-event', 'Private near title', 'solarsense', 'assessment', 'assessment-1',
         'active-field', now() + interval '12 hours', now() + interval '1 day',
         'planned', 'admin', 'ecoaudit'),
        ('past-event', 'Past title', 'installhub', 'installation', 'installation-1',
         'active-field', now() - interval '1 hour', now() + interval '1 day',
         'planned', 'admin', 'ecoaudit'),
        ('done-event', 'Done title', 'ecoaudit', 'audit', 'audit-2',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'done', 'admin', 'ecoaudit'),
        ('custom-event', 'Custom title', 'custom', 'custom', null,
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('inactive-event', 'Inactive title', 'ecoaudit', 'audit', 'audit-3',
         'inactive-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('install-future-event', 'Future install', 'installhub', 'installation',
         'installation-future', 'active-field', now() + interval '3 days',
         now() + interval '4 days', 'planned', 'admin', 'ecoaudit'),
        ('legacy-solar-site-event', 'Legacy site', 'solarsense', 'site', 'site-1',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('misaligned-event', 'Misaligned', 'ecoaudit', 'audit', 'audit-misaligned',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('missing-event', 'Missing', 'ecoaudit', 'audit', 'audit-missing',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('completed-source-event', 'Completed source', 'ecoaudit', 'audit',
         'audit-completed', 'active-field', now() + interval '3 days',
         now() + interval '4 days', 'planned', 'admin', 'ecoaudit'),
        ('deleted-source-event', 'Deleted source', 'ecoaudit', 'audit', 'audit-deleted',
         'active-field', now() + interval '3 days', now() + interval '4 days',
         'planned', 'admin', 'ecoaudit'),
        ('bad-solar-parent-event', 'Bad parent', 'solarsense', 'assessment',
         'assessment-bad-parent', 'active-field', now() + interval '3 days',
         now() + interval '4 days', 'planned', 'admin', 'ecoaudit'),
        ('misaligned-install-event', 'Misaligned install', 'installhub', 'installation',
         'installation-misaligned', 'active-field', now() + interval '3 days',
         now() + interval '4 days', 'planned', 'admin', 'ecoaudit')
    `);

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0031_careless_solo.sql'));
    });

    const jobs = await sql<{
      event_id: string;
      notification_kind: string;
      title: string;
      body: string;
      payload: Record<string, unknown>;
      dedupe_key: string;
      global_user_id: string;
      max_attempts: number;
    }[]>`
      SELECT event_id, notification_kind, title, body, payload,
             dedupe_key, global_user_id, max_attempts
      FROM scheduler_notification_jobs
      ORDER BY event_id, notification_kind
    `;
    assert.deepEqual(
      jobs.map((job) => `${job.event_id}:${job.notification_kind}`),
      [
        'future-event:day_of',
        'future-event:one_day_before',
        'inactive-event:day_of',
        'inactive-event:one_day_before',
        'inside-day-event:day_of',
        'install-future-event:day_of',
        'install-future-event:one_day_before',
      ],
    );
    assert.equal(jobs.every((job) => !JSON.stringify(job).includes('Private')), true);
    assert.equal(jobs.every((job) => job.payload.type === 'scheduler'), true);
    assert.equal(jobs.every((job) => typeof job.payload.scheduledStartAt === 'string'), true);
    assert.equal(new Set(jobs.map((job) => job.dedupe_key)).size, jobs.length);
    assert.equal(jobs.every((job) => job.max_attempts === 16), true);
    assert.equal(jobs.every((job) => job.dedupe_key.startsWith(
      `scheduler:${job.event_id}:migration:${job.notification_kind}:`,
    )), true);
    assert.deepEqual(
      [...new Set(jobs
        .filter((job) => job.event_id !== 'inactive-event')
        .map((job) => job.global_user_id))],
      ['active-user'],
    );
    assert.deepEqual(
      [...new Set(jobs
        .filter((job) => job.event_id === 'inactive-event')
        .map((job) => job.global_user_id))],
      ['inactive-user'],
    );

    await sql.unsafe(`
      INSERT INTO app_push_devices (
        id, global_user_id, app, device_id, expo_push_token, platform,
        project_id, enabled, disabled_reason
      ) VALUES
        ('legacy-device-row', 'active-user', 'ecoaudit', 'legacy-device',
         'ExpoPushToken[legacydevice]', 'ios', 'legacy-project', true, null),
        ('legacy-dnr-device-row', 'active-user', 'ecoaudit', 'legacy-dnr-device',
         'ExpoPushToken[legacydnrdevice]', 'ios', 'legacy-project', false,
         'DeviceNotRegistered'),
        ('legacy-logout-device-row', 'active-user', 'ecoaudit', 'legacy-logout-device',
         'ExpoPushToken[legacylogoutdevice]', 'ios', 'legacy-project', false, 'logout')
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_notification_deliveries (
        id, job_id, device_registration_id, expo_push_token, status
      ) VALUES (
        'legacy-delivery-row',
        (SELECT id FROM scheduler_notification_jobs WHERE event_id = 'future-event' LIMIT 1),
        'legacy-device-row', 'ExpoPushToken[legacydevice]', 'pending'
      )
    `);
    await sql.unsafe(`
      UPDATE scheduler_notification_jobs
      SET max_attempts = 8
      WHERE event_id = 'future-event'
    `);
    await sql.unsafe(`
      UPDATE scheduler_notification_jobs
      SET status = 'cancelled', completed_at = now()
      WHERE id = (
        SELECT job_id
        FROM scheduler_notification_deliveries
        WHERE id = 'legacy-delivery-row'
      )
    `);
    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0032_normal_omega_flight.sql'));
    });
    const [legacyDevice] = await sql<{
      registration_generation: number;
    }[]>`
      SELECT registration_generation
      FROM app_push_devices
      WHERE id = 'legacy-device-row'
    `;
    const [legacyFence] = await sql<{
      global_user_id: string;
      registration_generation: number;
      enabled: boolean;
    }[]>`
      SELECT global_user_id, registration_generation, enabled
      FROM app_push_device_fences
      WHERE app = 'ecoaudit' AND device_id = 'legacy-device'
    `;
    const [legacyDelivery] = await sql<{
      registration_generation: number;
    }[]>`
      SELECT registration_generation
      FROM scheduler_notification_deliveries
      WHERE id = 'legacy-delivery-row'
    `;
    assert.equal(Number(legacyDevice.registration_generation), 1);
    assert.deepEqual({
      globalUserId: legacyFence.global_user_id,
      registrationGeneration: Number(legacyFence.registration_generation),
      enabled: legacyFence.enabled,
    }, {
      globalUserId: 'active-user',
      registrationGeneration: 1,
      enabled: true,
    });
    assert.equal(Number(legacyDelivery.registration_generation), 1);
    assert.deepEqual(
      (await sql<{ device_id: string; enabled: boolean }[]>`
        SELECT device_id, enabled
        FROM app_push_device_fences
        WHERE device_id IN ('legacy-dnr-device', 'legacy-logout-device')
        ORDER BY device_id
      `).map((fence) => `${fence.device_id}:${fence.enabled}`),
      ['legacy-dnr-device:true', 'legacy-logout-device:false'],
    );
    const [reconciledLegacyDelivery] = await sql<{
      status: string;
      last_error: string;
    }[]>`
      SELECT status, last_error
      FROM scheduler_notification_deliveries
      WHERE id = 'legacy-delivery-row'
    `;
    assert.deepEqual(reconciledLegacyDelivery, {
      status: 'failed',
      last_error: 'notification_job_no_longer_active',
    });
    const [attemptBudget] = await sql<{
      minimum: number;
      default_value: string;
    }[]>`
      SELECT
        (SELECT min(max_attempts) FROM scheduler_notification_jobs) AS minimum,
        (SELECT column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'scheduler_notification_jobs'
           AND column_name = 'max_attempts') AS default_value
    `;
    assert.equal(Number(attemptBudget.minimum), 16);
    assert.match(attemptBudget.default_value, /16/);
  } finally {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.end({ timeout: 5 });
  }
});
