import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_INVOICE_PDF_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('../db/migrations/', import.meta.url);

const rollingOldInterruptedExportSql = `
  UPDATE pdf_jobs
  SET status = 'failed',
      phase = NULL,
      error = 'Export was interrupted by a server restart. Please start it again.',
      updated_at = LOCALTIMESTAMP
  WHERE status IN ('queued', 'running')
    AND updated_at <= LOCALTIMESTAMP - interval '1 hour'
`;

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('invoice PDF publication CAS and cleanup outbox are atomic on PostgreSQL', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'sw-pdf-recovery-'));
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_WRITE_MODE = 'legacy';
  process.env.LOCAL_FILE_STORAGE_ROOT = storageRoot;
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
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, audit_date, status, created_at
      ) VALUES (
        'audit-export', 'Export Site', '1 Export Road', 'PDF Worker',
        '2026-08-16', 'Completed', now()
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
        'invoice-export', 'finance-export', 'INV-EXPORT-1', 'issued', 'AUD',
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
    assert.equal(snapshot.status, 'issued', 'issued snapshots do not depend on later source state');

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
        ('pdf-job-fresh-old-queued', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', '{"artifactType":"pdf","filename":"fresh-old.pdf","contentType":"application/pdf"}'::jsonb,
         'queued', 'Queued', now()),
        ('pdf-job-stale-worker', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', '{"artifactType":"pdf","filename":"stale.pdf","contentType":"application/pdf"}'::jsonb,
         'running', 'Rendering PDF', now() - interval '2 hours')
    `);
    await pdfJobService.failInterruptedExportJobs(new Date());
    await setup.unsafe(rollingOldInterruptedExportSql);
    const workerRows = await setup`
      SELECT id, status, claim_token FROM pdf_jobs
      WHERE id IN (
        'pdf-job-fresh-old-queued', 'pdf-job-fresh-worker', 'pdf-job-stale-worker'
      )
      ORDER BY id
    `;
    assert.deepEqual(workerRows.map((row) => [row.id, row.status, row.claim_token]), [
      ['pdf-job-fresh-old-queued', 'queued', null],
      ['pdf-job-fresh-worker', 'running', null],
      ['pdf-job-stale-worker', 'running', null],
    ], 'generic interrupted-job cleanup leaves Scheduler PDF recovery to its claim worker');
    const reclaimedLegacyRun = await exportService.claimNextSchedulerInvoicePdfJob();
    assert.equal(reclaimedLegacyRun?.id, 'pdf-job-stale-worker');
    assert.ok(reclaimedLegacyRun?.claimToken);
    assert.equal(
      await exportService.claimNextSchedulerInvoicePdfJob(),
      null,
      'a fresh tokenless running job from a rolling old pod is not stolen',
    );
    await exportService.executeClaimedSchedulerInvoicePdfJob(reclaimedLegacyRun!);
    const [failedByClaimedWorker] = await setup`
      SELECT status, claim_token, claim_expires_at, error
      FROM pdf_jobs WHERE id = 'pdf-job-stale-worker'
    `;
    assert.deepEqual(failedByClaimedWorker, {
      status: 'failed',
      claim_token: null,
      claim_expires_at: null,
      error: 'Invoice PDF job data is invalid. Start a new PDF export.',
    }, 'the claim-token owner can deliberately cross the database failure fence');

    await setup`
      UPDATE scheduler_invoices
      SET status = 'issued', issue_date = DATE '2026-08-16',
          updated_at = updated_at + interval '1 second'
      WHERE id = 'invoice-export'
    `;
    const recoveryInvoice = await financeService.getConsolidatedSchedulerInvoice(
      user,
      'invoice-export',
    );
    const recoveryParams = exportService.schedulerInvoicePdfJobParams(recoveryInvoice);
    await setup`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase, updated_at
      ) VALUES (
        'pdf-job-crash-recovery', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
        'pdf-admin-eco', ${setup.json(JSON.parse(JSON.stringify(recoveryParams)))}, 'queued', 'Queued',
        LOCALTIMESTAMP - interval '2 hours'
      )
    `;
    await setup`
      INSERT INTO scheduler_invoice_email_deliveries (
        id, invoice_id, pdf_job_id, source_updated_at, attachment_filename,
        idempotency_key, request_fingerprint, recipient, subject, message,
        requested_by_global_user_id, requested_by_display_name, requested_by_app,
        status, attempts, max_attempts, available_at, provider
      ) VALUES (
        'email-crash-recovery', 'invoice-export', 'pdf-job-crash-recovery',
        (SELECT updated_at FROM scheduler_invoices WHERE id = 'invoice-export'),
        ${recoveryParams.filename}, 'crash-recovery-once', ${'0'.repeat(64)},
        'recipient@example.test', 'Recovered invoice', 'Attached invoice',
        'pdf-admin-global', 'PDF Admin', 'ecoaudit',
        'queued', 0, 5, LOCALTIMESTAMP, 'gmail_api'
      )
    `;
    await setup.unsafe(rollingOldInterruptedExportSql);
    const [recoveryAfterOldReaper] = await setup`
      SELECT status, claim_token FROM pdf_jobs WHERE id = 'pdf-job-crash-recovery'
    `;
    assert.deepEqual(recoveryAfterOldReaper, {
      status: 'queued',
      claim_token: null,
    }, 'a rolling-old reaper cannot terminally fail a resumable Scheduler PDF');

    let resolveRecovery!: () => void;
    let rejectRecovery!: (error: unknown) => void;
    const recovered = new Promise<void>((resolve, reject) => {
      resolveRecovery = resolve;
      rejectRecovery = reject;
    });
    const recoveryWorker = exportService.startSchedulerInvoicePdfWorker({
      pollIntervalMs: 60_000,
      dependencies: {
        async execute(job) {
          try {
            await exportService.persistSchedulerInvoicePdfArtifact({
              user,
              financeId: 'finance-export',
              invoiceId: 'invoice-export',
              sourceUpdatedAt: recoveryInvoice.updatedAt,
              jobId: job.id,
              claimToken: job.claimToken,
              storageKey: 'ecoaudit/recovery/pdf-job-crash-recovery/invoice.pdf',
              pdfUrl: '/files/recovery-invoice.pdf',
              buffer: Buffer.from('%PDF-recovered'),
            });
            resolveRecovery();
          } catch (error) {
            rejectRecovery(error);
          }
        },
      },
    });
    await recovered;
    await recoveryWorker.stop();
    const [recoveredPdf] = await setup`
      SELECT status, storage_key, claim_token, claim_expires_at
      FROM pdf_jobs WHERE id = 'pdf-job-crash-recovery'
    `;
    assert.deepEqual(recoveredPdf, {
      status: 'complete',
      storage_key: 'ecoaudit/recovery/pdf-job-crash-recovery/invoice.pdf',
      claim_token: null,
      claim_expires_at: null,
    });

    const emailWorker = await import('./schedulerInvoiceEmailWorker.js');
    const [claimedEmail] = await emailWorker.claimDueSchedulerInvoiceEmails(new Date(), 1);
    assert.ok(claimedEmail);
    let sends = 0;
    await emailWorker.processClaimedSchedulerInvoiceEmail(claimedEmail, {
      async prepare() {
        return { accessToken: 'test-access-token' };
      },
      async submit(_prepared, submission) {
        sends += 1;
        assert.equal(submission.attachment.toString(), '%PDF-recovered');
        return { providerMessageId: 'gmail-message-once' };
      },
    });
    assert.equal(sends, 1);
    assert.deepEqual(
      await emailWorker.claimDueSchedulerInvoiceEmails(new Date(), 1),
      [],
      'a sent delivery cannot be claimed or submitted twice',
    );
    const [sentDelivery] = await setup`
      SELECT status, attempts, provider_message_id
      FROM scheduler_invoice_email_deliveries WHERE id = 'email-crash-recovery'
    `;
    assert.deepEqual(sentDelivery, {
      status: 'sent',
      attempts: 1,
      provider_message_id: 'gmail-message-once',
    });

    await setup`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase,
        claim_token, updated_at
      ) VALUES (
        'pdf-job-durable-fresh', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
        'pdf-admin-eco', ${setup.json(JSON.parse(JSON.stringify(recoveryParams)))},
        'queued', 'Queued', ${exportService.SCHEDULER_INVOICE_PDF_DURABLE_QUEUE_MARKER},
        LOCALTIMESTAMP
      )
    `;
    const freshDurableClaim = await exportService.claimNextSchedulerInvoicePdfJob();
    assert.equal(freshDurableClaim?.id, 'pdf-job-durable-fresh');
    await setup`
      UPDATE pdf_jobs SET status = 'failed', claim_token = NULL, claim_expires_at = NULL
      WHERE id = 'pdf-job-durable-fresh'
    `;

    await setup`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status, phase,
        claim_token, claim_expires_at, updated_at
      ) VALUES
        ('pdf-job-live-lease', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', ${setup.json(JSON.parse(JSON.stringify(recoveryParams)))}, 'running', 'Rendering PDF',
         'live-owner-token', LOCALTIMESTAMP + interval '2 minutes', LOCALTIMESTAMP),
        ('pdf-job-expired-lease', 'ecoaudit', 'invoice-export', 'scheduler_invoice',
         'pdf-admin-eco', ${setup.json(JSON.parse(JSON.stringify(recoveryParams)))}, 'running', 'Rendering PDF',
         'dead-owner-token', LOCALTIMESTAMP - interval '1 second', LOCALTIMESTAMP)
    `;
    const concurrentClaims = await Promise.all(Array.from(
      { length: 4 },
      () => exportService.claimNextSchedulerInvoicePdfJob(),
    ));
    const reclaimedClaims = concurrentClaims.filter((claim) => claim !== null);
    assert.equal(reclaimedClaims.length, 1, 'claim CAS gives one process ownership');
    const [reclaimedExpired] = reclaimedClaims;
    assert.equal(reclaimedExpired?.id, 'pdf-job-expired-lease');
    assert.notEqual(reclaimedExpired?.claimToken, 'dead-owner-token');
    assert.equal(
      await exportService.claimNextSchedulerInvoicePdfJob(),
      null,
      'a concurrent live worker with an unexpired lease is not stolen',
    );
    await assert.rejects(
      setup`
        UPDATE pdf_jobs
        SET status = 'complete', storage_key = 'old-writer-key', pdf_url = '/old-writer'
        WHERE id = 'pdf-job-expired-lease'
      `,
      /pdf_jobs_scheduler_invoice_claim_terminal_check/,
      'database fence rejects rolling-old terminal writes after takeover',
    );

    const oldOwnerStorageKey = 'ecoaudit/recovery/old-owner/invoice.pdf';
    await assert.rejects(exportService.persistSchedulerInvoicePdfArtifact({
      user,
      financeId: 'finance-export',
      invoiceId: 'invoice-export',
      sourceUpdatedAt: recoveryInvoice.updatedAt,
      jobId: 'pdf-job-expired-lease',
      claimToken: 'dead-owner-token',
      storageKey: oldOwnerStorageKey,
      pdfUrl: '/files/old-owner.pdf',
      buffer: Buffer.from('%PDF-old-owner'),
    }), /export_job_completion_failed/);
    const [stillNewOwner] = await setup`
      SELECT status, claim_token, storage_key FROM pdf_jobs
      WHERE id = 'pdf-job-expired-lease'
    `;
    assert.deepEqual(stillNewOwner, {
      status: 'running',
      claim_token: reclaimedExpired?.claimToken,
      storage_key: null,
    });
    await exportService.persistSchedulerInvoicePdfArtifact({
      user,
      financeId: 'finance-export',
      invoiceId: 'invoice-export',
      sourceUpdatedAt: recoveryInvoice.updatedAt,
      jobId: 'pdf-job-expired-lease',
      claimToken: reclaimedExpired!.claimToken,
      storageKey: 'ecoaudit/recovery/new-owner/invoice.pdf',
      pdfUrl: '/files/new-owner.pdf',
      buffer: Buffer.from('%PDF-new-owner'),
    });
    const [completedByNewOwner] = await setup`
      SELECT status, claim_token, storage_key FROM pdf_jobs
      WHERE id = 'pdf-job-expired-lease'
    `;
    assert.deepEqual(completedByNewOwner, {
      status: 'complete',
      claim_token: null,
      storage_key: 'ecoaudit/recovery/new-owner/invoice.pdf',
    });

    const [missingCleanup] = await setup`
      SELECT id FROM storage_deletion_tasks WHERE storage_key = ${missingJobStorageKey}
    `;
    assert.ok(missingCleanup?.id);
    await storageDeletionService.drainStorageDeletionTasks({ ids: [missingCleanup.id] });
    await closeDb();
  } finally {
    await setup.end();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
