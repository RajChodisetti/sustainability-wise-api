import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import bcrypt from 'bcryptjs';

const integrationDatabase = process.env.GLOBAL_IDENTITY_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('./migrations/', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('0030 globalizes a populated legacy database and preserves product contracts', {
  skip: !integrationDatabase,
  timeout: 120_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 1 });
  const legacyMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0030_')
    .sort();
  const ecoPassword = 'eco-password-123';
  const solarPassword = 'solar-password-123';
  const fieldPassword = 'field-password-123';
  const newPassword = 'new-global-password-123';
  const [ecoHash, solarHash, fieldHash, newHash] = await Promise.all([
    bcrypt.hash(ecoPassword, 4),
    bcrypt.hash(solarPassword, 4),
    bcrypt.hash(fieldPassword, 4),
    bcrypt.hash(newPassword, 4),
  ]);
  const ecoFieldAlias = 'unified-field:ecoaudit:eco-person';
  const solarFieldAlias = 'unified-field:solarsense:solar-person';
  const canonicalFieldId = 'field-person';
  const rebuildLegacySchema = async () => {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    for (const migration of legacyMigrations) {
      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSource(migration));
      });
    }
  };

  try {
    // This opt-in URL must point at a disposable database: the test proves the
    // actual upgrade chain, so it owns and rebuilds public from 0000.
    await rebuildLegacySchema();

    await sql`
      INSERT INTO ea_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('eco-person', 'person@ecoaudit.users.local', ${ecoHash},
         'Person Eco', 'inspector', true)
    `;
    await sql`
      INSERT INTO ss_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('solar-person', 'person@solarsense.users.local', ${solarHash},
         'Person Solar', 'admin', true)
    `;
    await sql`
      INSERT INTO ih_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        (${canonicalFieldId}, 'person@installhub.users.local', ${fieldHash},
         'Person Field', 'inspector', true)
    `;
    await sql`
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date,
        created_by_user_id, assigned_inspector_user_id,
        completed_by_user_id, reopened_by_user_id
      ) VALUES (
        'identity-installation', 'Client', 'Site', 'Address', 'Inspector',
        '2026-08-15', ${ecoFieldAlias}, ${solarFieldAlias},
        ${ecoFieldAlias}, ${solarFieldAlias}
      )
    `;
    await sql`
      INSERT INTO ih_installation_work_sessions (
        id, installation_id, actor_user_id, started_at, last_active_at,
        ended_at, active_milliseconds, revision
      ) VALUES (
        'work-session', 'identity-installation', ${ecoFieldAlias}, now(),
        now(), now(), 1000, 1
      )
    `;
    await sql`
      INSERT INTO ih_meter_history_events (
        id, installation_id, meter_id, operation,
        from_record_version_number, to_record_version_number,
        restored_from_record_version_number, reason, actor_user_id
      ) VALUES (
        'meter-history', 'identity-installation', 'meter-1', 'ROLLBACK',
        1, 2, 1, 'migration regression', ${solarFieldAlias}
      )
    `;
    await sql`
      INSERT INTO ih_completion_idempotency (
        id, installation_id, operation, actor_user_id, idempotency_key,
        request_fingerprint, completed_from_revision, resulting_tree_revision,
        record_version_number, result
      ) VALUES (
        'completion-key', 'identity-installation', 'complete', ${ecoFieldAlias},
        'request-1', 'fingerprint', 0, 1, 1, '{}'::jsonb
      )
    `;
    await sql`
      INSERT INTO ih_job_finance (installation_id, updated_by_user_id)
      VALUES ('identity-installation', ${solarFieldAlias})
    `;
    await sql`
      INSERT INTO ih_job_cost_lines (
        id, installation_id, category, description, cost_amount,
        created_by_user_id
      ) VALUES (
        'cost-line', 'identity-installation', 'labour', 'Labour', 1,
        ${ecoFieldAlias}
      )
    `;
    await sql`
      INSERT INTO ih_invoices (
        id, installation_id, invoice_number, created_by_user_id
      ) VALUES (
        'invoice', 'identity-installation', 'INV-IDENTITY', ${solarFieldAlias}
      )
    `;
    await sql`
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, assignee_field_user_id,
        scheduled_start_at, deadline_at, created_by_user_id, created_by_app
      ) VALUES (
        'schedule-event', 'Identity migration', 'installhub', 'installation',
        ${ecoFieldAlias}, now(), now(), ${solarFieldAlias}, 'installhub'
      )
    `;
    await sql`
      INSERT INTO api_keys
        (id, name, hashed_key, prefix, app, role, created_by_user_id)
      VALUES
        ('api-key', 'Identity key', 'hash', 'prefix', 'installhub',
         'admin', ${ecoFieldAlias})
    `;
    await sql`
      INSERT INTO record_versions (
        id, app, entity_type, entity_id, version_number, snapshot,
        created_by_user_id
      ) VALUES (
        'record-version', 'installhub', 'installation',
        'identity-installation', 1, '{}'::jsonb, ${solarFieldAlias}
      )
    `;
    await sql`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params
      ) VALUES (
        'pdf-job', 'installhub', 'identity-installation', 'installation',
        ${ecoFieldAlias}, '{}'::jsonb
      )
    `;
    await sql`
      INSERT INTO refresh_tokens
        (id, user_id, app, token_hash, expires_at)
      VALUES
        ('old-field-refresh', ${solarFieldAlias}, 'installhub', 'old-token',
         now() + interval '1 day')
    `;

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0030_global_user_identity.sql'));
    });

    const [identity] = await sql<{
      id: string;
      field_user_id: string;
      role: string;
      is_active: boolean;
      fleet_entitled: boolean;
    }[]>`
      SELECT id, field_user_id, role, is_active, fleet_entitled
      FROM global_users WHERE login_key = 'username:person'
    `;
    assert.deepEqual(identity && {
      fieldUserId: identity.field_user_id,
      role: identity.role,
      active: identity.is_active,
      fleetEntitled: identity.fleet_entitled,
    }, {
      fieldUserId: canonicalFieldId,
      role: 'admin',
      active: true,
      fleetEntitled: true,
    });
    const memberships = await sql<{
      origin_app: string;
      origin_user_id: string;
      field_user_id: string;
      role: string;
    }[]>`
      SELECT origin_app, origin_user_id, field_user_id, role
      FROM unified_users WHERE global_user_id = ${identity!.id}
      ORDER BY origin_app
    `;
    assert.deepEqual(memberships.map((row) => ({
      app: row.origin_app,
      productUserId: row.origin_user_id,
      fieldUserId: row.field_user_id,
      role: row.role,
    })), [
      { app: 'ecoaudit', productUserId: 'eco-person', fieldUserId: canonicalFieldId, role: 'admin' },
      { app: 'installhub', productUserId: canonicalFieldId, fieldUserId: canonicalFieldId, role: 'admin' },
      { app: 'solarsense', productUserId: 'solar-person', fieldUserId: canonicalFieldId, role: 'admin' },
    ]);
    const [{ count: credentialCount }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM global_user_credentials
      WHERE global_user_id = ${identity!.id}
    `;
    assert.equal(credentialCount, 3);

    const [references] = await sql<{
      installation_subjects: string[];
      actor_subjects: string[];
      shared_subjects: string[];
    }[]>`
      SELECT
        ARRAY[
          installation.created_by_user_id,
          installation.assigned_inspector_user_id,
          installation.completed_by_user_id,
          installation.reopened_by_user_id
        ] AS installation_subjects,
        ARRAY[
          work.actor_user_id,
          meter.actor_user_id,
          completion.actor_user_id,
          finance.updated_by_user_id,
          cost.created_by_user_id,
          invoice.created_by_user_id
        ] AS actor_subjects,
        ARRAY[
          schedule.assignee_field_user_id,
          schedule.created_by_user_id,
          key.created_by_user_id,
          version.created_by_user_id,
          pdf.user_id
        ] AS shared_subjects
      FROM ih_installations installation
      JOIN ih_installation_work_sessions work ON work.installation_id = installation.id
      JOIN ih_meter_history_events meter ON meter.installation_id = installation.id
      JOIN ih_completion_idempotency completion ON completion.installation_id = installation.id
      JOIN ih_job_finance finance ON finance.installation_id = installation.id
      JOIN ih_job_cost_lines cost ON cost.installation_id = installation.id
      JOIN ih_invoices invoice ON invoice.installation_id = installation.id
      JOIN portal_schedule_events schedule ON schedule.source_id IS NULL
      JOIN api_keys key ON key.id = 'api-key'
      JOIN record_versions version ON version.id = 'record-version'
      JOIN pdf_jobs pdf ON pdf.id = 'pdf-job'
      WHERE installation.id = 'identity-installation'
    `;
    assert.ok(references);
    assert.ok([
      ...references!.installation_subjects,
      ...references!.actor_subjects,
      ...references!.shared_subjects,
    ].every((subject) => subject === canonicalFieldId));
    const [oldRefresh] = await sql<{ user_id: string; revoked: boolean }[]>`
      SELECT user_id, revoked_at IS NOT NULL AS revoked
      FROM refresh_tokens WHERE id = 'old-field-refresh'
    `;
    assert.deepEqual(oldRefresh, { user_id: solarFieldAlias, revoked: true });

    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    try {
      const expectedIds = {
        ecoaudit: 'eco-person',
        solarsense: 'solar-person',
        installhub: canonicalFieldId,
      } as const;
      for (const product of Object.keys(expectedIds) as Array<keyof typeof expectedIds>) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'person', password: ecoPassword, app: product },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().user.id, expectedIds[product]);
        assert.equal(response.json().user.role, 'admin');
      }

      await sql`UPDATE ea_users SET role = 'inspector', updated_at = now()
        WHERE id = 'eco-person'`;
      const roles = await sql<{ role: string }[]>`
        SELECT role FROM unified_users WHERE global_user_id = ${identity!.id}
      `;
      assert.deepEqual(new Set(roles.map((row) => row.role)), new Set(['inspector']));

      await sql`
        INSERT INTO refresh_tokens (id, user_id, app, token_hash, expires_at)
        SELECT 'new-token-' || origin_app, origin_user_id, origin_app,
          'new-token-hash-' || origin_app, now() + interval '1 day'
        FROM unified_users WHERE global_user_id = ${identity!.id}
      `;
      await sql`UPDATE ss_users SET password_hash = ${newHash}, updated_at = now()
        WHERE id = 'solar-person'`;
      const currentCredentials = await sql<{ password_hash: string }[]>`
        SELECT password_hash FROM global_user_credentials
        WHERE global_user_id = ${identity!.id}
      `;
      assert.equal(currentCredentials.length, 1);
      assert.equal(currentCredentials[0]?.password_hash, newHash);
      const [{ count: revokedCount }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM refresh_tokens
        WHERE id LIKE 'new-token-%' AND revoked_at IS NOT NULL
      `;
      assert.equal(revokedCount, 3);

      for (const product of Object.keys(expectedIds) as Array<keyof typeof expectedIds>) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'person', password: newPassword, app: product },
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().user.role, 'inspector');
      }
      await sql`UPDATE ih_users SET is_active = false, updated_at = now()
        WHERE id = ${canonicalFieldId}`;
      const states = await sql<{ is_active: boolean }[]>`
        SELECT is_active FROM unified_users WHERE global_user_id = ${identity!.id}
      `;
      assert.deepEqual(new Set(states.map((row) => row.is_active)), new Set([false]));
      const denied = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'person', password: newPassword, app: 'ecoaudit' },
      });
      assert.equal(denied.statusCode, 401);
    } finally {
      await app.close();
    }

    await rebuildLegacySchema();
    await sql`
      INSERT INTO ea_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('duplicate-a', 'duplicate@ecoaudit.users.local', ${ecoHash},
         'Duplicate A', 'inspector', true),
        ('duplicate-b', 'DUPLICATE@ecoaudit.users.local', ${solarHash},
         'Duplicate B', 'admin', true)
    `;
    await assert.rejects(
      () => sql.begin(async (tx) => {
        await tx.unsafe(migrationSource('0030_global_user_identity.sql'));
      }),
      /Ambiguous legacy global identity/,
    );

    await rebuildLegacySchema();
    await sql`
      INSERT INTO ea_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('active-eco', 'state@ecoaudit.users.local', ${ecoHash},
         'State Person', 'inspector', true)
    `;
    await sql`
      INSERT INTO ss_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('inactive-solar', 'state@solarsense.users.local', ${solarHash},
         'State Person', 'inspector', false)
    `;
    await assert.rejects(
      () => sql.begin(async (tx) => {
        await tx.unsafe(migrationSource('0030_global_user_identity.sql'));
      }),
      /Conflicting active state for legacy global identity/,
    );

    await rebuildLegacySchema();
    const collisionEcoAlias = 'unified-field:ecoaudit:collision-eco';
    await sql`
      INSERT INTO ea_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('collision-eco', 'collision@ecoaudit.users.local', ${ecoHash},
         'Collision Person', 'admin', true)
    `;
    await sql`
      INSERT INTO ih_users
        (id, email, password_hash, full_name, role, is_active)
      VALUES
        ('collision-field', 'collision@installhub.users.local', ${fieldHash},
         'Collision Person', 'admin', true)
    `;
    await sql`
      INSERT INTO ih_installations
        (id, client_name, site_name, site_address, inspector_name, audit_date)
      VALUES
        ('collision-installation', 'Client', 'Site', 'Address', 'Inspector',
         '2026-08-15')
    `;
    await sql`
      INSERT INTO ih_completion_idempotency (
        id, installation_id, operation, actor_user_id, idempotency_key,
        request_fingerprint, completed_from_revision, resulting_tree_revision,
        record_version_number, result
      ) VALUES
        ('collision-a', 'collision-installation', 'complete',
         ${collisionEcoAlias}, 'same-request', 'fingerprint-a', 0, 1, 1,
         '{"result":"a"}'::jsonb),
        ('collision-b', 'collision-installation', 'complete',
         'collision-field', 'same-request', 'fingerprint-b', 0, 2, 2,
         '{"result":"b"}'::jsonb)
    `;
    await assert.rejects(
      () => sql.begin(async (tx) => {
        await tx.unsafe(migrationSource('0030_global_user_identity.sql'));
      }),
      /Canonical Field identity would collide in ih_completion_idempotency/,
    );
  } finally {
    await sql.end();
  }
});
