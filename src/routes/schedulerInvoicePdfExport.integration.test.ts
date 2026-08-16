import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_INVOICE_PDF_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('../db/migrations/', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('scheduler invoice export status and download require the exact current global admin', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const setup = postgres(integrationDatabase!, { max: 1 });
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  try {
    await setup.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await setup.unsafe('CREATE SCHEMA public');
    for (const migration of migrations) {
      await setup.begin(async (tx) => tx.unsafe(migrationSource(migration)));
    }
    await setup.unsafe(`
      INSERT INTO global_users (
        id, login_key, field_user_id, primary_origin_app, primary_origin_user_id,
        display_email, full_name, role, is_active
      ) VALUES
        ('invoice-admin-global', 'invoice-admin@example.test', 'invoice-admin-field',
         'ecoaudit', 'invoice-admin-eco', 'invoice-admin@example.test', 'Invoice Admin',
         'admin', true),
        ('other-admin-global', 'other-admin@example.test', 'other-admin-field',
         'ecoaudit', 'other-admin-eco', 'other-admin@example.test', 'Other Admin',
         'admin', true)
    `);
    await setup.unsafe(`
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id, email,
        password_hash, role, is_active, source_created_at, source_updated_at
      ) VALUES
        ('invoice-admin-membership', 'invoice-admin-global', 'ecoaudit',
         'invoice-admin-eco', 'invoice-admin-field', 'invoice-admin@example.test',
         'test', 'admin', true, now(), now()),
        ('other-admin-membership', 'other-admin-global', 'ecoaudit',
         'other-admin-eco', 'other-admin-field', 'other-admin@example.test',
         'test', 'admin', true, now(), now())
    `);
    await setup.unsafe(`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase,
        storage_key, created_at, updated_at
      ) VALUES (
        'scheduler-invoice-job', 'ecoaudit', 'invoice-42', 'scheduler_invoice',
        'invoice-admin-eco',
        '{"artifactType":"pdf","filename":"invoice-Café-job-2026-08-16-INV-42.pdf","contentType":"application/pdf","reportVariantKey":"scheduler-invoice-pdf:v1:invoice-42:2026-08-16T18:15:00.000Z"}'::jsonb,
        'complete', 'Ready to download', 'ecoaudit/job/pdfs/invoice.pdf', now(), now()
      )
    `);

    const [{ buildApp }, { signAccessToken }, { closeDb }] = await Promise.all([
      import('../app.js'),
      import('../auth/jwt.js'),
      import('../db/client.js'),
    ]);
    const app = await buildApp();
    const ownerToken = signAccessToken({
      userId: 'invoice-admin-eco',
      app: 'ecoaudit',
      role: 'admin',
    });
    const otherAdminToken = signAccessToken({
      userId: 'other-admin-eco',
      app: 'ecoaudit',
      role: 'admin',
    });
    const request = (url: string, token = ownerToken) => app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    const statusUrl = '/v1/export/jobs/scheduler-invoice-job';
    const downloadUrl = `${statusUrl}/download`;
    const latestUrl = '/v1/export/jobs/latest?entityId=invoice-42&artifactType=pdf'
      + '&reportVariantKey=scheduler-invoice-pdf%3Av1%3Ainvoice-42%3A2026-08-16T18%3A15%3A00.000Z';

    try {
      const current = await request(statusUrl);
      assert.equal(current.statusCode, 200);
      assert.equal(current.json().filename, 'invoice-Café-job-2026-08-16-INV-42.pdf');
      assert.equal(current.json().pdfUrl, null, 'finance artifacts require authenticated download');
      assert.equal((await request(latestUrl)).json().job.id, 'scheduler-invoice-job');
      assert.equal((await request(statusUrl, otherAdminToken)).statusCode, 403);

      await setup.unsafe("UPDATE global_users SET role = 'inspector' WHERE id = 'invoice-admin-global'");
      assert.equal((await request(statusUrl)).statusCode, 403);
      assert.equal((await request(latestUrl)).statusCode, 403);
      assert.equal((await request(downloadUrl)).statusCode, 403);

      await setup.unsafe("UPDATE global_users SET role = 'admin' WHERE id = 'invoice-admin-global'");
      await setup.unsafe("UPDATE unified_users SET is_active = false WHERE id = 'invoice-admin-membership'");
      assert.equal((await request(statusUrl)).statusCode, 403);
      assert.equal((await request(downloadUrl)).statusCode, 403);

      await setup.unsafe("UPDATE unified_users SET is_active = true WHERE id = 'invoice-admin-membership'");
      await setup.unsafe("UPDATE global_users SET is_active = false WHERE id = 'invoice-admin-global'");
      assert.equal((await request(statusUrl)).statusCode, 403);
    } finally {
      await app.close();
      await closeDb();
    }
  } finally {
    await setup.end();
  }
});
