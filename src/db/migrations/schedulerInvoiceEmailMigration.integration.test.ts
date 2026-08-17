import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_INVOICE_EMAIL_MIGRATION_PG_INTEGRATION_URL;
const migrationsDirectory = new URL('./', import.meta.url);
const storageRoot = join(tmpdir(), `scheduler-invoice-email-${process.pid}`);
if (integrationDatabase) {
  process.env.DATABASE_URL = integrationDatabase;
  process.env.JWT_SECRET ||= 'invoice-email-integration-secret';
  process.env.JWT_REFRESH_SECRET ||= 'invoice-email-integration-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_WRITE_MODE = 'legacy';
  process.env.LOCAL_FILE_STORAGE_ROOT = storageRoot;
  process.env.SCHEDULER_INVOICE_EMAIL_ENABLED = 'true';
  process.env.EMAIL_DELIVERY_METHOD = 'gmail_api';
  process.env.GMAIL_USER_ID = 'me';
  process.env.GMAIL_CLIENT_ID = 'integration-client-id';
  process.env.GMAIL_CLIENT_SECRET = 'integration-client-secret';
  process.env.GMAIL_REFRESH_TOKEN = 'integration-refresh-token';
  process.env.FROM_EMAIL = '';
  process.env.SMTP_USER = 'reports@example.test';
}

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('0035 adds an idempotent invoice email outbox with fail-closed delivery states', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 1 });
  let closeApplicationDatabase: (() => Promise<void>) | null = null;
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0035_')
    .sort();

  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    for (const migration of priorMigrations) {
      await sql.begin(async (tx) => tx.unsafe(migrationSource(migration)));
    }

    await sql.unsafe(`
      INSERT INTO global_users (
        id, login_key, field_user_id, primary_origin_app,
        primary_origin_user_id, display_email, full_name, role, is_active
      ) VALUES (
        'email-admin', 'admin@example.test', 'email-admin-field', 'ecoaudit',
        'email-admin-eco', 'admin@example.test', 'Email Admin', 'admin', true
      );
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id,
        email, password_hash, full_name, role, is_active,
        source_created_at, source_updated_at
      ) VALUES (
        'email-admin-membership', 'email-admin', 'ecoaudit', 'email-admin-eco',
        'email-admin-field', 'admin@example.test', 'test-only', 'Email Admin',
        'admin', true, now(), now()
      );
      INSERT INTO scheduler_job_finance (
        id, source_app, source_type, source_id, pricing_mode, currency,
        bill_to_name, bill_to_email, billable_rate_cents, cost_rate_cents
      ) VALUES (
        'email-finance', 'ecoaudit', 'audit', 'email-audit', 'charge_up', 'AUD',
        'Customer', 'accounts@example.test', 15000, 7500
      );
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency, issue_date,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
        seller_name, bill_to_name, bill_to_email,
        job_site_name, job_name, job_date, job_status,
        job_source_app, job_source_type, job_source_id, created_at, updated_at
      ) VALUES (
        'email-invoice', 'email-finance', 'INV-2026-EMAIL', 'issued', 'AUD', now(),
        10000, 1000, 11000, 1000,
        'Sustainability Wise', 'Customer', 'accounts@example.test',
        'Email site', 'Email audit', '2026-08-16', 'Completed',
        'ecoaudit', 'audit', 'email-audit', now(), now()
      );
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status,
        storage_key, created_at, updated_at
      ) VALUES (
        'email-pdf', 'ecoaudit', 'email-invoice', 'scheduler_invoice',
        'email-admin-eco',
        '{"artifactType":"pdf","filename":"invoice.pdf","contentType":"application/pdf","sourceUpdatedAt":"2026-08-16T00:00:00.000Z"}'::jsonb,
        'complete', 'ecoaudit/email/pdf/invoice.pdf', now(), now()
      );
    `);

    await sql.begin(async (tx) => tx.unsafe(migrationSource('0035_silly_triton.sql')));

    await sql.unsafe(`
      INSERT INTO scheduler_invoice_email_deliveries (
        id, invoice_id, pdf_job_id, source_updated_at, attachment_filename,
        idempotency_key, request_fingerprint, recipient, subject, message,
        requested_by_global_user_id, requested_by_display_name,
        requested_by_app, status, attempts, max_attempts, provider
      ) VALUES (
        'email-delivery', 'email-invoice', 'email-pdf',
        '2026-08-16T00:00:00.000Z', 'invoice.pdf', 'email-once', repeat('a', 64),
        'accounts@example.test', 'Invoice INV-2026-EMAIL', 'Attached',
        'email-admin', 'Email Admin', 'ecoaudit', 'queued', 0, 5, 'gmail_api'
      )
    `);

    await assert.rejects(sql.unsafe(`
      INSERT INTO scheduler_invoice_email_deliveries (
        id, invoice_id, pdf_job_id, source_updated_at, attachment_filename,
        idempotency_key, request_fingerprint, recipient, subject, message,
        requested_by_global_user_id, requested_by_app
      ) VALUES (
        'duplicate-delivery', 'email-invoice', 'email-pdf', now(), 'invoice.pdf',
        'email-once', repeat('b', 64), 'other@example.test', 'Other', '',
        'email-admin', 'ecoaudit'
      )
    `), /scheduler_invoice_email_idempotency_unique/);

    await sql.unsafe(`
      UPDATE scheduler_invoice_email_deliveries
      SET status = 'processing', claim_token = 'claim-1', claimed_at = now(),
          attempts = 1, provider_submission_started_at = now()
      WHERE id = 'email-delivery'
    `);
    await sql.unsafe(`
      UPDATE scheduler_invoice_email_deliveries
      SET status = 'delivery_unknown', claim_token = null, claimed_at = null,
          last_error_code = 'worker_interrupted_after_submit_started',
          completed_at = now()
      WHERE id = 'email-delivery'
    `);
    const [unknown] = await sql<{
      status: string;
      attempts: number;
      last_error_code: string | null;
      provider_submission_started_at: Date | null;
    }[]>`
      SELECT status, attempts, last_error_code, provider_submission_started_at
      FROM scheduler_invoice_email_deliveries
      WHERE id = 'email-delivery'
    `;
    assert.equal(unknown?.status, 'delivery_unknown');
    assert.equal(unknown?.attempts, 1);
    assert.equal(unknown?.last_error_code, 'worker_interrupted_after_submit_started');
    assert.ok(unknown?.provider_submission_started_at);

    await assert.rejects(sql.unsafe(`
      UPDATE scheduler_invoice_email_deliveries
      SET status = 'sent', provider_message_id = 'gmail-1', sent_at = now(),
          completed_at = null
      WHERE id = 'email-delivery'
    `), /scheduler_invoice_email_completion_check/);

    await assert.rejects(
      sql.unsafe(`DELETE FROM pdf_jobs WHERE id = 'email-pdf'`),
      /scheduler_invoice_email_deliveries_pdf_job_id_pdf_jobs_id_fk/,
    );

    const {
      queueSchedulerInvoiceEmail,
    } = await import('../../services/schedulerInvoiceEmailService.js');
    closeApplicationDatabase = (await import('../client.js')).closeDb;

    const emailAdmin = {
      userId: 'email-admin-eco',
      app: 'ecoaudit' as const,
      role: 'admin' as const,
      authType: 'jwt' as const,
    };
    const {
      getConsolidatedSchedulerInvoice,
      voidConsolidatedSchedulerInvoice,
    } = await import('../../services/schedulerFinanceService.js');
    const invoiceSnapshot = await getConsolidatedSchedulerInvoice(emailAdmin, 'email-invoice');
    const freshInput = {
      expectedUpdatedAt: invoiceSnapshot.updatedAt,
      idempotencyKey: 'fresh-email-queue',
      to: 'accounts@example.test',
      subject: 'Fresh invoice delivery',
      message: 'Attached',
    };
    let pdfQueueCalls = 0;
    const freshQueue = await queueSchedulerInvoiceEmail(emailAdmin, 'email-invoice', freshInput, {
      async queuePdf(user, invoiceId, expectedUpdatedAt) {
        pdfQueueCalls += 1;
        const reportVariantKey = `scheduler-invoice-pdf:v2:${invoiceId}:${expectedUpdatedAt}`;
        await sql`
          INSERT INTO pdf_jobs (
            id, app, entity_id, entity_type, user_id, params, status,
            created_at, updated_at
          ) VALUES (
            'fresh-email-pdf', ${user.app}, ${invoiceId}, 'scheduler_invoice',
            ${user.userId}, ${sql.json({
              artifactType: 'pdf',
              filename: 'fresh-invoice.pdf',
              contentType: 'application/pdf',
              sourceUpdatedAt: expectedUpdatedAt,
              reportVariantKey,
            })}, 'queued', now(), now()
          )
        `;
        return {
          jobId: 'fresh-email-pdf',
          reused: false,
          sourceUpdatedAt: expectedUpdatedAt,
          reportVariantKey,
        };
      },
    });
    assert.equal(freshQueue.reused, false);
    assert.equal(freshQueue.delivery.pdfJobId, 'fresh-email-pdf');
    assert.equal(freshQueue.delivery.status, 'queued');
    const freshReplay = await queueSchedulerInvoiceEmail(emailAdmin, 'email-invoice', freshInput, {
      async queuePdf() {
        pdfQueueCalls += 1;
        throw new Error('idempotent replay must not queue another PDF');
      },
    });
    assert.equal(freshReplay.reused, true);
    assert.equal(freshReplay.delivery.id, freshQueue.delivery.id);
    assert.equal(pdfQueueCalls, 1);
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM scheduler_invoice_email_deliveries
      WHERE idempotency_key = 'fresh-email-queue'
    `)[0]?.count, 1);

    const replay = await queueSchedulerInvoiceEmail({
      userId: 'email-admin-eco',
      app: 'ecoaudit',
      role: 'admin',
      authType: 'jwt',
    }, 'email-invoice', {
      expectedUpdatedAt: '2026-08-16T00:00:00.000Z',
      idempotencyKey: 'email-once',
      to: 'accounts@example.test',
      subject: 'Invoice INV-2026-EMAIL',
      message: 'Attached',
    });
    assert.equal(replay.reused, true);
    assert.equal(replay.delivery.id, 'email-delivery');
    await assert.rejects(queueSchedulerInvoiceEmail({
      userId: 'email-admin-eco',
      app: 'ecoaudit',
      role: 'admin',
      authType: 'jwt',
    }, 'email-invoice', {
      expectedUpdatedAt: '2026-08-16T00:00:00.000Z',
      idempotencyKey: 'email-once',
      to: 'changed@example.test',
      subject: 'Invoice INV-2026-EMAIL',
      message: 'Attached',
    }), (error: unknown) => (
      Boolean(error)
      && typeof error === 'object'
      && (error as { statusCode?: unknown }).statusCode === 409
      && (error as { detail?: unknown }).detail
        === 'idempotencyKey was already used for another invoice email request'
    ));

    await mkdir(join(storageRoot, 'ecoaudit/email/pdf'), { recursive: true });
    const pdfBytes = Buffer.from('%PDF-1.7\nexact invoice artifact\n%%EOF');
    await writeFile(join(storageRoot, 'ecoaudit/email/pdf/invoice.pdf'), pdfBytes);

    const insertDelivery = async (args: {
      id: string;
      pdfJobId?: string;
      status?: 'queued' | 'processing';
      attempts?: number;
      claimToken?: string | null;
      claimedAt?: Date | null;
      providerSubmissionStartedAt?: Date | null;
    }) => {
      await sql`
        INSERT INTO scheduler_invoice_email_deliveries (
          id, invoice_id, pdf_job_id, source_updated_at, attachment_filename,
          idempotency_key, request_fingerprint, recipient, subject, message,
          requested_by_global_user_id, requested_by_display_name,
          requested_by_app, status, attempts, max_attempts,
          claim_token, claimed_at, provider_submission_started_at, provider,
          created_at, updated_at
        ) VALUES (
          ${args.id}, 'email-invoice', ${args.pdfJobId ?? 'email-pdf'},
          '2026-08-16T00:00:00.000Z', 'invoice.pdf', ${`key-${args.id}`},
          ${'c'.repeat(64)}, 'accounts@example.test', 'Invoice', 'Attached',
          'email-admin', 'Email Admin', 'ecoaudit', ${args.status ?? 'queued'},
          ${args.attempts ?? 0}, 5, ${args.claimToken ?? null},
          ${args.claimedAt ?? null}, ${args.providerSubmissionStartedAt ?? null},
          'gmail_api', now(), now()
        )
      `;
    };

    const {
      claimDueSchedulerInvoiceEmails,
      processClaimedSchedulerInvoiceEmail,
      startSchedulerInvoiceEmailWorker,
    } = await import('../../services/schedulerInvoiceEmailWorker.js');
    await insertDelivery({ id: 'sent-delivery' });
    const [claimed] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
    assert.equal(claimed?.id, 'sent-delivery');
    const exhaustedInitialLease = new Date(Date.now() - 60 * 60_000);
    await sql`
      UPDATE scheduler_invoice_email_deliveries
      SET claimed_at = ${exhaustedInitialLease}
      WHERE id = 'sent-delivery'
    `;
    let prepareCalls = 0;
    let submitCalls = 0;
    await processClaimedSchedulerInvoiceEmail(claimed!, {
      async prepare() {
        prepareCalls += 1;
        return { accessToken: 'fake-access-token' };
      },
      async submit(_prepared, submission) {
        submitCalls += 1;
        const [submissionLease] = await sql<{
          claimed_at: Date | null;
          provider_submission_started_at: Date | null;
        }[]>`
          SELECT claimed_at, provider_submission_started_at
          FROM scheduler_invoice_email_deliveries
          WHERE id = 'sent-delivery'
        `;
        assert.ok(submissionLease?.claimed_at);
        assert.ok(submissionLease.provider_submission_started_at);
        assert.equal(
          submissionLease.claimed_at.getTime(),
          submissionLease.provider_submission_started_at.getTime(),
        );
        assert.ok(submissionLease.claimed_at.getTime() > exhaustedInitialLease.getTime());
        assert.equal(submission.recipient, 'accounts@example.test');
        assert.equal(submission.attachmentFilename, 'invoice.pdf');
        assert.deepEqual(submission.attachment, pdfBytes);
        return { providerMessageId: 'gmail-message-sent' };
      },
    });
    assert.equal(prepareCalls, 1);
    assert.equal(submitCalls, 1);
    const [sent] = await sql<{
      status: string;
      attempts: number;
      provider_message_id: string | null;
      sent_at: Date | null;
    }[]>`
      SELECT status, attempts, provider_message_id, sent_at
      FROM scheduler_invoice_email_deliveries WHERE id = 'sent-delivery'
    `;
    assert.deepEqual(
      [sent?.status, sent?.attempts, sent?.provider_message_id, Boolean(sent?.sent_at)],
      ['sent', 1, 'gmail-message-sent', true],
    );

    await insertDelivery({ id: 'shutdown-first-delivery' });
    await insertDelivery({ id: 'shutdown-second-delivery' });
    let preparationEntered!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      preparationEntered = resolve;
    });
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    let shutdownSubmitCalls = 0;
    const shutdownWorker = startSchedulerInvoiceEmailWorker({
      async prepare() {
        preparationEntered();
        await preparationGate;
        return { accessToken: 'shutdown-test-token' };
      },
      async submit() {
        shutdownSubmitCalls += 1;
        return { providerMessageId: 'shutdown-test-message' };
      },
    });
    await preparationStarted;
    const stopped = shutdownWorker.stop();
    releasePreparation();
    await stopped;
    assert.equal(shutdownSubmitCalls, 1);
    const shutdownStates = await sql<{ status: string; count: number }[]>`
      SELECT status, count(*)::int AS count
      FROM scheduler_invoice_email_deliveries
      WHERE id IN ('shutdown-first-delivery', 'shutdown-second-delivery')
      GROUP BY status
      ORDER BY status
    `;
    assert.deepEqual([...shutdownStates], [
      { status: 'queued', count: 1 },
      { status: 'sent', count: 1 },
    ]);
    await sql`
      DELETE FROM scheduler_invoice_email_deliveries
      WHERE id IN ('shutdown-first-delivery', 'shutdown-second-delivery')
    `;

    // Ordering one: a void transaction owns the invoice row first. The send
    // boundary must wait, observe the committed void, and never call Gmail.
    await insertDelivery({ id: 'void-first-delivery' });
    const [voidFirstClaim] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
    assert.equal(voidFirstClaim?.id, 'void-first-delivery');
    let invoiceLockAcquired!: () => void;
    const invoiceLocked = new Promise<void>((resolve) => {
      invoiceLockAcquired = resolve;
    });
    let releaseVoidTransaction!: () => void;
    const holdVoidTransaction = new Promise<void>((resolve) => {
      releaseVoidTransaction = resolve;
    });
    const voidFirstTransaction = sql.begin(async (tx) => {
      await tx`SELECT id FROM scheduler_invoices WHERE id = 'email-invoice' FOR UPDATE`;
      invoiceLockAcquired();
      await holdVoidTransaction;
      await tx`
        UPDATE scheduler_invoices
        SET status = 'void', voided_at = now(), updated_at = now()
        WHERE id = 'email-invoice'
      `;
    });
    await invoiceLocked;
    let voidFirstPrepared!: () => void;
    const voidFirstPreparationReached = new Promise<void>((resolve) => {
      voidFirstPrepared = resolve;
    });
    let voidFirstSubmitCalls = 0;
    const voidFirstProcessing = processClaimedSchedulerInvoiceEmail(voidFirstClaim!, {
      async prepare() {
        voidFirstPrepared();
        return { accessToken: 'void-first-token' };
      },
      async submit() {
        voidFirstSubmitCalls += 1;
        return { providerMessageId: 'must-not-send' };
      },
    });
    await voidFirstPreparationReached;
    releaseVoidTransaction();
    await Promise.all([voidFirstTransaction, voidFirstProcessing]);
    assert.equal(voidFirstSubmitCalls, 0);
    const [voidFirstState] = await sql<{
      invoice_status: string;
      delivery_status: string;
      last_error_code: string | null;
    }[]>`
      SELECT i.status AS invoice_status, d.status AS delivery_status, d.last_error_code
      FROM scheduler_invoices i
      JOIN scheduler_invoice_email_deliveries d ON d.invoice_id = i.id
      WHERE d.id = 'void-first-delivery'
    `;
    assert.deepEqual(voidFirstState, {
      invoice_status: 'void',
      delivery_status: 'failed',
      last_error_code: 'invoice_no_longer_sendable',
    });
    await sql`
      UPDATE scheduler_invoices
      SET status = 'issued', voided_at = null, updated_at = now()
      WHERE id = 'email-invoice'
    `;

    // Ordering two: the provider marker commits first. Both an old direct
    // writer and the current service are rejected while Gmail is in flight.
    await insertDelivery({ id: 'provider-first-delivery' });
    const [providerFirstClaim] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
    assert.equal(providerFirstClaim?.id, 'provider-first-delivery');
    let providerSubmissionEntered!: () => void;
    const providerSubmissionStarted = new Promise<void>((resolve) => {
      providerSubmissionEntered = resolve;
    });
    let finishProviderSubmission!: () => void;
    const providerSubmissionGate = new Promise<void>((resolve) => {
      finishProviderSubmission = resolve;
    });
    const providerFirstProcessing = processClaimedSchedulerInvoiceEmail(providerFirstClaim!, {
      async prepare() {
        return { accessToken: 'provider-first-token' };
      },
      async submit() {
        providerSubmissionEntered();
        await providerSubmissionGate;
        return { providerMessageId: 'provider-first-message' };
      },
    });
    await providerSubmissionStarted;
    await assert.rejects(
      sql`UPDATE scheduler_invoices SET status = 'void' WHERE id = 'email-invoice'`,
      /scheduler_invoice_email_delivery_in_progress/,
    );
    const providerFirstInvoice = await getConsolidatedSchedulerInvoice(
      emailAdmin,
      'email-invoice',
    );
    await assert.rejects(
      voidConsolidatedSchedulerInvoice(
        emailAdmin,
        'email-invoice',
        providerFirstInvoice.updatedAt,
      ),
      (error: unknown) => (
        Boolean(error)
        && typeof error === 'object'
        && (error as { statusCode?: unknown }).statusCode === 409
        && (error as { detail?: unknown }).detail
          === 'Invoice email delivery is in progress; wait for it to finish before voiding'
      ),
    );
    const [providerLiveState] = await sql<{
      invoice_status: string;
      delivery_status: string;
      claimed_at: Date | null;
      provider_submission_started_at: Date | null;
    }[]>`
      SELECT i.status AS invoice_status, d.status AS delivery_status,
             d.claimed_at, d.provider_submission_started_at
      FROM scheduler_invoices i
      JOIN scheduler_invoice_email_deliveries d ON d.invoice_id = i.id
      WHERE d.id = 'provider-first-delivery'
    `;
    assert.equal(providerLiveState?.invoice_status, 'issued');
    assert.equal(providerLiveState?.delivery_status, 'processing');
    assert.ok(providerLiveState?.claimed_at);
    assert.ok(providerLiveState.provider_submission_started_at);
    assert.equal(
      providerLiveState.claimed_at.getTime(),
      providerLiveState.provider_submission_started_at.getTime(),
    );
    finishProviderSubmission();
    await providerFirstProcessing;
    assert.equal((await sql<{ status: string }[]>`
      SELECT status FROM scheduler_invoice_email_deliveries
      WHERE id = 'provider-first-delivery'
    `)[0]?.status, 'sent');

    const runAuthorizationRevocationBeforeMarker = async (
      deliveryId: string,
      revoke: () => Promise<unknown>,
      restore: () => Promise<unknown>,
    ) => {
      await insertDelivery({ id: deliveryId });
      const [authorizationClaim] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
      assert.equal(authorizationClaim?.id, deliveryId);
      let preparationEntered!: () => void;
      const preparationStarted = new Promise<void>((resolve) => {
        preparationEntered = resolve;
      });
      let releasePreparation!: () => void;
      const preparationGate = new Promise<void>((resolve) => {
        releasePreparation = resolve;
      });
      let submitCalls = 0;
      const processing = processClaimedSchedulerInvoiceEmail(authorizationClaim!, {
        async prepare() {
          preparationEntered();
          await preparationGate;
          return { accessToken: 'revoked-before-marker-token' };
        },
        async submit() {
          submitCalls += 1;
          return { providerMessageId: 'must-not-send-after-revocation' };
        },
      });
      await preparationStarted;
      await revoke();
      releasePreparation();
      await processing;
      assert.equal(submitCalls, 0);
      const [revokedDelivery] = await sql<{
        status: string;
        last_error_code: string | null;
        provider_submission_started_at: Date | null;
      }[]>`
        SELECT status, last_error_code, provider_submission_started_at
        FROM scheduler_invoice_email_deliveries
        WHERE id = ${deliveryId}
      `;
      assert.deepEqual(revokedDelivery, {
        status: 'failed',
        last_error_code: 'requesting_admin_no_longer_active',
        provider_submission_started_at: null,
      });
      await restore();
    };

    await runAuthorizationRevocationBeforeMarker(
      'demoted-before-marker-delivery',
      () => sql`UPDATE global_users SET role = 'inspector' WHERE id = 'email-admin'`,
      () => sql`UPDATE global_users SET role = 'admin' WHERE id = 'email-admin'`,
    );
    await runAuthorizationRevocationBeforeMarker(
      'deactivated-before-marker-delivery',
      () => sql`UPDATE global_users SET is_active = false WHERE id = 'email-admin'`,
      () => sql`UPDATE global_users SET is_active = true WHERE id = 'email-admin'`,
    );
    await runAuthorizationRevocationBeforeMarker(
      'membership-revoked-before-marker-delivery',
      () => sql`
        UPDATE unified_users SET is_active = false
        WHERE id = 'email-admin-membership'
      `,
      () => sql`
        UPDATE unified_users SET is_active = true
        WHERE id = 'email-admin-membership'
      `,
    );

    const leaseStart = new Date(Date.now() + 1_000);
    await insertDelivery({ id: 'lease-first-delivery' });
    const [firstLease] = await claimDueSchedulerInvoiceEmails(leaseStart, 1);
    assert.equal(firstLease?.id, 'lease-first-delivery');
    const laterClaimAt = new Date(leaseStart.getTime() + 90_000);
    await insertDelivery({ id: 'lease-second-delivery' });
    const [secondLease] = await claimDueSchedulerInvoiceEmails(laterClaimAt, 1);
    assert.equal(secondLease?.id, 'lease-second-delivery');
    assert.ok(secondLease?.claimedAt);
    assert.equal(secondLease.claimedAt.toISOString(), laterClaimAt.toISOString());
    await claimDueSchedulerInvoiceEmails(new Date(leaseStart.getTime() + 121_000), 1);
    const leaseStates = await sql<{
      id: string;
      status: string;
      last_error_code: string | null;
    }[]>`
      SELECT id, status, last_error_code
      FROM scheduler_invoice_email_deliveries
      WHERE id IN ('lease-first-delivery', 'lease-second-delivery')
      ORDER BY id
    `;
    assert.deepEqual([...leaseStates], [
      {
        id: 'lease-first-delivery',
        status: 'queued',
        last_error_code: 'worker_interrupted_before_submit',
      },
      {
        id: 'lease-second-delivery',
        status: 'processing',
        last_error_code: null,
      },
    ]);

    const staleAt = new Date(Date.now() - 60 * 60_000);
    await insertDelivery({
      id: 'stale-before-submit',
      status: 'processing',
      attempts: 1,
      claimToken: 'stale-before-claim',
      claimedAt: staleAt,
    });
    await insertDelivery({
      id: 'stale-after-submit',
      status: 'processing',
      attempts: 1,
      claimToken: 'stale-after-claim',
      claimedAt: staleAt,
      providerSubmissionStartedAt: staleAt,
    });
    await sql.unsafe(`
      INSERT INTO pdf_jobs (
        id, app, entity_id, entity_type, user_id, params, status,
        error, created_at, updated_at
      ) VALUES (
        'failed-email-pdf', 'ecoaudit', 'email-invoice', 'scheduler_invoice',
        'email-admin-eco',
        '{"artifactType":"pdf","filename":"invoice.pdf","contentType":"application/pdf","sourceUpdatedAt":"2026-08-16T00:00:00.000Z"}'::jsonb,
        'failed', 'synthetic failure', now(), now()
      )
    `);
    await insertDelivery({ id: 'failed-pdf-delivery', pdfJobId: 'failed-email-pdf' });
    await claimDueSchedulerInvoiceEmails(new Date(), 1);
    const recovered = await sql<{
      id: string;
      status: string;
      last_error_code: string | null;
    }[]>`
      SELECT id, status, last_error_code
      FROM scheduler_invoice_email_deliveries
      WHERE id IN ('stale-before-submit', 'stale-after-submit', 'failed-pdf-delivery')
      ORDER BY id
    `;
    assert.deepEqual([...recovered], [
      { id: 'failed-pdf-delivery', status: 'failed', last_error_code: 'invoice_pdf_failed' },
      { id: 'stale-after-submit', status: 'delivery_unknown', last_error_code: 'worker_interrupted_after_submit_started' },
      { id: 'stale-before-submit', status: 'queued', last_error_code: 'worker_interrupted_before_submit' },
    ]);

    await insertDelivery({ id: 'inactive-admin-delivery' });
    const [inactiveClaim] = await claimDueSchedulerInvoiceEmails(new Date(), 1);
    assert.equal(inactiveClaim?.id, 'inactive-admin-delivery');
    await sql`UPDATE global_users SET is_active = false WHERE id = 'email-admin'`;
    let externalCalls = 0;
    await processClaimedSchedulerInvoiceEmail(inactiveClaim!, {
      async prepare() {
        externalCalls += 1;
        return { accessToken: 'must-not-be-used' };
      },
      async submit() {
        externalCalls += 1;
        return { providerMessageId: 'must-not-send' };
      },
    });
    assert.equal(externalCalls, 0);
    const [inactive] = await sql<{ status: string; last_error_code: string | null }[]>`
      SELECT status, last_error_code
      FROM scheduler_invoice_email_deliveries WHERE id = 'inactive-admin-delivery'
    `;
    assert.deepEqual(inactive, {
      status: 'failed',
      last_error_code: 'requesting_admin_no_longer_active',
    });

  } finally {
    if (closeApplicationDatabase) {
      await closeApplicationDatabase().catch(() => undefined);
    }
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE').catch(() => undefined);
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS public').catch(() => undefined);
    await sql.end();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
