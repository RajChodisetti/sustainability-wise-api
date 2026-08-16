import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_INVOICE_PDF_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('../db/migrations/', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('invoice PDF publication CAS and cleanup outbox are atomic on PostgreSQL', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const setup = postgres(integrationDatabase!, { max: 2 });
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
      ) VALUES (
        'pdf-admin-global', 'pdf-admin@example.test', 'pdf-admin-field',
        'ecoaudit', 'pdf-admin-eco', 'pdf-admin@example.test', 'PDF Admin',
        'admin', true
      )
    `);
    await setup.unsafe(`
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id, email,
        password_hash, role, is_active, source_created_at, source_updated_at
      ) VALUES (
        'pdf-admin-membership', 'pdf-admin-global', 'ecoaudit', 'pdf-admin-eco',
        'pdf-admin-field', 'pdf-admin@example.test', 'test', 'admin', true, now(), now()
      )
    `);
    await setup.unsafe(`
      INSERT INTO scheduler_job_finance (
        id, source_app, source_type, source_id, pricing_mode, currency,
        bill_to_name, billable_rate_cents, cost_rate_cents
      ) VALUES (
        'finance-export', 'ecoaudit', 'audit', 'audit-export', 'charge_up', 'AUD',
        'Invoice Recipient', 15000, 7500
      )
    `);
    await setup.unsafe(`
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
        notes, seller_name, seller_abn, bill_to_name,
        job_site_name, job_name, job_date, job_status,
        job_source_app, job_source_type, job_source_id, updated_at
      ) VALUES (
        'invoice-export', 'finance-export', 'INV-EXPORT-1', 'draft', 'AUD',
        10000, 1000, 11000, 1000,
        'Pinned snapshot', 'Sustainability Wise', '12 345 678 901', 'Invoice Recipient',
        'Export Site', 'Export Audit', '2026-08-16', 'Scheduled',
        'ecoaudit', 'audit', 'audit-export', TIMESTAMP '2026-08-16 18:15:00'
      )
    `);

    const [
      { closeDb },
      exportService,
      financeService,
      storageDeletionService,
      pdfJobService,
    ] = await Promise.all([
      import('../db/client.js'),
      import('./schedulerInvoicePdfExport.js'),
      import('./schedulerFinanceService.js'),
      import('./storageDeletionService.js'),
      import('./pdfJobService.js'),
    ]);
    const user = {
      userId: 'pdf-admin-eco',
      app: 'ecoaudit' as const,
      role: 'admin' as const,
      authType: 'jwt' as const,
    };
    const snapshot = await financeService.loadSchedulerInvoiceExportSnapshot(
      user,
      'finance-export',
      'invoice-export',
      (await financeService.getConsolidatedSchedulerInvoice(user, 'invoice-export')).updatedAt,
    );
    assert.equal(snapshot.notes, 'Pinned snapshot');

    await setup.unsafe(`
      UPDATE scheduler_invoices
      SET notes = 'Changed during render', updated_at = updated_at + interval '1 second'
      WHERE id = 'invoice-export'
    `);
    await setup.unsafe(`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase
      ) VALUES (
        'pdf-job-stale', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
        'pdf-admin-eco', '{"artifactType":"pdf","filename":"invoice.pdf","contentType":"application/pdf"}'::jsonb,
        'running', 'Saving PDF'
      )
    `);

    const staleStorageKey = 'ecoaudit/scheduler-invoice/stale/invoice.pdf';
    let cleanupObservedBeforeWrite = false;
    await assert.rejects(exportService.persistSchedulerInvoicePdfArtifact({
      user,
      financeId: 'finance-export',
      invoiceId: 'invoice-export',
      sourceUpdatedAt: snapshot.updatedAt,
      jobId: 'pdf-job-stale',
      storageKey: staleStorageKey,
      pdfUrl: '/files/stale-invoice.pdf',
      buffer: Buffer.from('%PDF-stale'),
    }, {
      async writeFile(_storageKey, body) {
        const [task] = await setup`
          SELECT id FROM storage_deletion_tasks WHERE storage_key = ${staleStorageKey}
        `;
        cleanupObservedBeforeWrite = Boolean(task);
        return { size: body.length, checksum: 'test-checksum' };
      },
      async drainCleanupTask() {
        throw new Error('leave cleanup durable for assertion');
      },
    }), (error: unknown) => (
      error instanceof Error && error.message === 'Conflict'
    ));
    assert.equal(cleanupObservedBeforeWrite, true);
    const [staleJob] = await setup`
      SELECT status, storage_key FROM pdf_jobs WHERE id = 'pdf-job-stale'
    `;
    assert.equal(staleJob?.status, 'running');
    assert.equal(staleJob?.storage_key, null);
    const [staleCleanup] = await setup`
      SELECT id, reason FROM storage_deletion_tasks WHERE storage_key = ${staleStorageKey}
    `;
    assert.equal(staleCleanup?.reason, 'scheduler_invoice_pdf_unattached');
    assert.ok(staleCleanup?.id);
    assert.deepEqual(
      await storageDeletionService.drainStorageDeletionTasks({
        now: new Date(),
        maxTasks: 100,
      }),
      { deleted: 0, pending: 0 },
      'a rolling-startup sweep must lease a live/fresh export task',
    );
    const [leasedCleanup] = await setup`
      SELECT id FROM storage_deletion_tasks WHERE id = ${staleCleanup.id}
    `;
    assert.ok(leasedCleanup);
    assert.deepEqual(
      await storageDeletionService.drainStorageDeletionTasks({ ids: [staleCleanup.id] }),
      { deleted: 1, pending: 0 },
      'a known failed export bypasses the global lease',
    );

    const current = await financeService.getConsolidatedSchedulerInvoice(user, 'invoice-export');
    await setup.unsafe(`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase
      ) VALUES (
        'pdf-job-success', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
        'pdf-admin-eco', '{"artifactType":"pdf","filename":"invoice.pdf","contentType":"application/pdf"}'::jsonb,
        'running', 'Saving PDF'
      )
    `);
    const successStorageKey = 'ecoaudit/scheduler-invoice/success/invoice.pdf';
    await exportService.persistSchedulerInvoicePdfArtifact({
      user,
      financeId: 'finance-export',
      invoiceId: 'invoice-export',
      sourceUpdatedAt: current.updatedAt,
      jobId: 'pdf-job-success',
      storageKey: successStorageKey,
      pdfUrl: '/files/success-invoice.pdf',
      buffer: Buffer.from('%PDF-success'),
    }, {
      async writeFile(_storageKey, body) {
        return { size: body.length, checksum: 'test-checksum' };
      },
    });
    const [completed] = await setup`
      SELECT status, storage_key FROM pdf_jobs WHERE id = 'pdf-job-success'
    `;
    assert.equal(completed?.status, 'complete');
    assert.equal(completed?.storage_key, successStorageKey);
    const [releasedCleanup] = await setup`
      SELECT id FROM storage_deletion_tasks WHERE storage_key = ${successStorageKey}
    `;
    assert.equal(releasedCleanup, undefined);

    const missingJobStorageKey = 'ecoaudit/scheduler-invoice/missing-job/invoice.pdf';
    await assert.rejects(exportService.persistSchedulerInvoicePdfArtifact({
      user,
      financeId: 'finance-export',
      invoiceId: 'invoice-export',
      sourceUpdatedAt: current.updatedAt,
      jobId: 'pdf-job-does-not-exist',
      storageKey: missingJobStorageKey,
      pdfUrl: '/files/missing-job-invoice.pdf',
      buffer: Buffer.from('%PDF-missing-job'),
    }, {
      async writeFile(_storageKey, body) {
        return { size: body.length, checksum: 'test-checksum' };
      },
      async drainCleanupTask() {
        throw new Error('leave cleanup durable for assertion');
      },
    }), /export_job_completion_failed/);
    const [completionFailureCleanup] = await setup`
      SELECT reason FROM storage_deletion_tasks WHERE storage_key = ${missingJobStorageKey}
    `;
    assert.equal(
      completionFailureCleanup?.reason,
      'scheduler_invoice_pdf_unattached',
    );

    await setup.unsafe(`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase, updated_at
      ) VALUES
        ('pdf-job-fresh-worker', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', '{"artifactType":"pdf","filename":"fresh.pdf","contentType":"application/pdf"}'::jsonb,
         'running', 'Rendering PDF', now()),
        ('pdf-job-stale-worker', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', '{"artifactType":"pdf","filename":"stale.pdf","contentType":"application/pdf"}'::jsonb,
         'running', 'Rendering PDF', now() - interval '2 hours')
    `);
    await pdfJobService.failInterruptedExportJobs(new Date());
    const workerRows = await setup`
      SELECT id, status FROM pdf_jobs
      WHERE id IN ('pdf-job-fresh-worker', 'pdf-job-stale-worker')
      ORDER BY id
    `;
    assert.deepEqual(workerRows.map((row) => [row.id, row.status]), [
      ['pdf-job-fresh-worker', 'running'],
      ['pdf-job-stale-worker', 'failed'],
    ]);

    const [missingCleanup] = await setup`
      SELECT id FROM storage_deletion_tasks WHERE storage_key = ${missingJobStorageKey}
    `;
    assert.ok(missingCleanup?.id);
    await storageDeletionService.drainStorageDeletionTasks({ ids: [missingCleanup.id] });
    await closeDb();
  } finally {
    await setup.end();
  }
});
