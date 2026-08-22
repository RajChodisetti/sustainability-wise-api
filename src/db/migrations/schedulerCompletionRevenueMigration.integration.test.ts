import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_COMPLETION_REVENUE_MIGRATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('./', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

function isCheckError(error: unknown, message: string): boolean {
  const databaseError = error as { code?: string; message?: string };
  return databaseError.code === '23514' && Boolean(databaseError.message?.includes(message));
}

test('0044 enforces product retention and immutable completion facts', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 3 });
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0044_')
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
        primary_origin_user_id, display_email, full_name, role
      ) VALUES
        ('backfill-event-global', 'event@test.invalid', 'backfill-event-field',
          'installhub', 'backfill-event-origin', 'event@test.invalid',
          'Historical Event User', 'inspector'),
        ('backfill-solar-global', 'solar@test.invalid', 'backfill-solar-field',
          'solarsense', 'backfill-solar-origin', 'solar@test.invalid',
          'Historical Solar User', 'inspector'),
        ('backfill-install-global', 'install@test.invalid', 'backfill-install-field',
          'installhub', 'backfill-install-origin', 'install@test.invalid',
          'Historical Install User', 'inspector')
    `);
    await sql.unsafe(`
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id,
        email, password_hash, full_name, role, source_created_at, source_updated_at
      ) VALUES
        ('backfill-event-member', 'backfill-event-global', 'ecoaudit',
          'backfill-eco-product-origin', 'backfill-event-field',
          'event@test.invalid', 'test', 'Historical Event User', 'inspector',
          '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
        ('backfill-solar-member', 'backfill-solar-global', 'solarsense',
          'backfill-solar-origin', 'backfill-solar-field',
          'solar@test.invalid', 'test', 'Historical Solar User', 'inspector',
          '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')
    `);
    await sql.unsafe(`
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, status,
        assigned_inspector_user_id, completed_at, deleted_at
      ) VALUES
        ('backfill-eco', 'Eco site', '1 Eco Road', 'Eco Inspector', 'Completed',
          'backfill-eco-product-origin', '2026-08-10T01:00:00Z', NULL),
        ('backfill-deleted-eco', 'Archived Eco site', '2 Eco Road', 'Eco Inspector',
          'Completed', NULL, '2026-08-09T01:00:00Z', '2026-08-11T01:00:00Z'),
        ('backfill-undated-eco', 'Undated Eco site', '3 Eco Road', 'Eco Inspector',
          'Completed', NULL, NULL, NULL)
    `);
    await sql.unsafe(`
      INSERT INTO ss_sites (id, site_name, status) VALUES
        ('backfill-solar-site', 'Solar parent', 'Draft'),
        ('backfill-undated-site', 'Undated Solar parent', 'Draft'),
        ('backfill-completed-site', 'Completed undated Solar site', 'Completed')
    `);
    await sql.unsafe(`
      INSERT INTO ss_rooftop_assessments (
        id, site_id, site_name, building_id_name, status,
        assigned_inspector_user_id, completed_at
      ) VALUES
        ('backfill-solar', 'backfill-solar-site', 'Solar site', 'Building 1',
          'Completed', 'backfill-solar-origin', '2026-08-10T02:00:00Z'),
        ('backfill-undated-solar', 'backfill-undated-site', 'Undated Solar site',
          'Building 2', 'Completed', 'backfill-solar-origin', NULL)
    `);
    await sql.unsafe(`
      INSERT INTO ih_installations (
        id, external_key, client_name, site_name, site_address,
        inspector_name, audit_date, status, assigned_inspector_user_id, completed_at
      ) VALUES
        ('backfill-install', 'backfill-install-key', 'Client', 'Install site',
          '3 Install Road', 'Install Inspector', '2026-08-10', 'Completed',
          'backfill-install-field', '2026-08-10T03:00:00Z'),
        ('backfill-undated-install', 'backfill-undated-key', 'Client', 'Undated site',
          '4 Install Road', 'Install Inspector', '2026-08-10', 'Completed',
          'backfill-install-field', NULL)
    `);
    await sql.unsafe(`
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, source_id,
        assignee_field_user_id, assignee_display_name,
        scheduled_start_at, deadline_at, status, created_by_user_id, created_by_app
      ) VALUES (
        'backfill-eco-event', 'Historical Eco job', 'ecoaudit', 'audit',
        'backfill-eco', 'backfill-event-field', 'Event Snapshot Name',
        '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', 'done',
        'backfill-event-origin', 'ecoaudit'
      )
    `);
    // Seed representative legacy invoice states before 0044 installs the
    // new-invoice draft-only trigger. Existing rows remain untouched; all
    // subsequent direct writes are exercised against the forward fence.
    await sql.unsafe(`
      INSERT INTO scheduler_job_finance (
        id, source_app, source_type, source_id, pricing_mode, currency
      ) VALUES (
        'refund-fence-finance', 'ecoaudit', 'audit', 'backfill-eco',
        'charge_up', 'AUD'
      )
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency, issue_date,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
        gst_rate_bps, seller_name, bill_to_name, job_site_name, job_name,
        job_date, job_status, job_source_app, job_source_type, job_source_id,
        issued_at
      ) VALUES
        ('refund-lifecycle-invoice', 'refund-fence-finance', 'RF-001', 'issued',
          'AUD', '2026-08-20T00:00:00Z', 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Completed',
          'ecoaudit', 'audit', 'backfill-eco', '2026-08-20T00:00:00Z'),
        ('refund-wins-invoice', 'refund-fence-finance', 'RF-002', 'issued',
          'AUD', '2026-08-20T00:00:00Z', 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Completed',
          'ecoaudit', 'audit', 'backfill-eco', '2026-08-20T00:00:00Z'),
        ('void-wins-invoice', 'refund-fence-finance', 'RF-003', 'issued',
          'AUD', '2026-08-20T00:00:00Z', 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Completed',
          'ecoaudit', 'audit', 'backfill-eco', '2026-08-20T00:00:00Z'),
        ('already-void-invoice', 'refund-fence-finance', 'RF-004', 'void',
          'AUD', '2026-08-20T00:00:00Z', 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Completed',
          'ecoaudit', 'audit', 'backfill-eco', '2026-08-20T00:00:00Z'),
        ('header-paid-invoice', 'refund-fence-finance', 'RF-005', 'issued',
          'AUD', '2026-08-20T00:00:00Z', 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Completed',
          'ecoaudit', 'audit', 'backfill-eco', '2026-08-20T00:00:00Z'),
        ('header-draft-invoice', 'refund-fence-finance', 'RF-006', 'draft',
          'AUD', NULL, 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Draft',
          'ecoaudit', 'audit', 'backfill-eco', NULL),
        ('header-draft-void-invoice', 'refund-fence-finance', 'RF-007', 'draft',
          'AUD', NULL, 1000, 100, 1100, 1000,
          'Seller', 'Buyer', 'Site', 'Job', '2026-08-20', 'Draft',
          'ecoaudit', 'audit', 'backfill-eco', NULL)
    `);
    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSource('0044_integrated_scheduler_entity_features.sql'));
    });

    const backfilled = await sql<{
      source_app: string;
      source_id: string;
      completed_at: string;
      primary_global_user_id: string | null;
      assignee_field_user_id: string | null;
      attribution_source: string;
      revenue_snapshot_status: string;
    }[]>`
      SELECT source_app, source_id, completed_at::text AS completed_at, primary_global_user_id,
        assignee_field_user_id, attribution_source, revenue_snapshot_status
      FROM scheduler_job_completion_facts
      WHERE source_id LIKE 'backfill-%'
      ORDER BY source_id
    `;
    assert.deepEqual([...backfilled], [
      {
        source_app: 'ecoaudit',
        source_id: 'backfill-deleted-eco',
        completed_at: '2026-08-09 01:00:00',
        primary_global_user_id: null,
        assignee_field_user_id: null,
        attribution_source: 'unattributed',
        revenue_snapshot_status: 'unavailable',
      },
      {
        source_app: 'ecoaudit',
        source_id: 'backfill-eco',
        completed_at: '2026-08-10 01:00:00',
        primary_global_user_id: 'backfill-event-global',
        assignee_field_user_id: 'backfill-event-field',
        attribution_source: 'scheduler_event',
        revenue_snapshot_status: 'unavailable',
      },
      {
        source_app: 'installhub',
        source_id: 'backfill-install',
        completed_at: '2026-08-10 03:00:00',
        primary_global_user_id: 'backfill-install-global',
        assignee_field_user_id: 'backfill-install-field',
        attribution_source: 'product_assignment',
        revenue_snapshot_status: 'unavailable',
      },
      {
        source_app: 'solarsense',
        source_id: 'backfill-solar',
        completed_at: '2026-08-10 02:00:00',
        primary_global_user_id: 'backfill-solar-global',
        assignee_field_user_id: 'backfill-solar-field',
        attribution_source: 'product_assignment',
        revenue_snapshot_status: 'unavailable',
      },
    ]);
    const [{ count: undatedFactCount }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM scheduler_job_completion_facts
      WHERE source_id IN (
        'backfill-undated-eco',
        'backfill-undated-solar',
        'backfill-undated-install'
      )
    `;
    assert.equal(undatedFactCount, 0);
    await assert.rejects(
      sql.unsafe(`
        UPDATE ea_audits
        SET completed_at = '2026-08-22T00:00:00Z'
        WHERE id = 'backfill-undated-eco'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_historical_completion_update_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE ss_rooftop_assessments
        SET status = 'Draft'
        WHERE id = 'backfill-undated-solar'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_historical_completion_update_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE ih_installations
        SET completed_at = '2026-08-22T00:00:00Z'
        WHERE id = 'backfill-undated-install'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_historical_completion_update_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE ss_sites
        SET status = 'Draft'
        WHERE id = 'backfill-completed-site'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_historical_completion_update_blocked'),
    );
    await sql.unsafe(`
      UPDATE ea_audits
      SET status = 'Draft', completed_at = NULL
      WHERE id = 'backfill-eco'
    `);
    const [factProtectedReopen] = await sql<{ status: string; completed_at: string | null }[]>`
      SELECT status, completed_at::text AS completed_at
      FROM ea_audits
      WHERE id = 'backfill-eco'
    `;
    assert.deepEqual(factProtectedReopen, { status: 'Draft', completed_at: null });
    await sql.unsafe(`
      UPDATE ea_audits
      SET status = 'Completed', completed_at = '2026-08-10T01:00:00Z'
      WHERE id = 'backfill-eco'
    `);
    await assert.rejects(
      sql.unsafe(`
        INSERT INTO scheduler_job_completion_facts (
          id, source_app, source_type, source_id, completed_at,
          attribution_source, revenue_snapshot_status
        ) VALUES (
          'invalid-attribution-fact', 'installhub', 'installation',
          'invalid-attribution-job', '2026-08-10T04:00:00Z',
          'product_assignment', 'unavailable'
        )
      `),
      (error: unknown) => isCheckError(
        error,
        'scheduler_job_completion_facts_attribution_identity_check',
      ),
    );
    await assert.rejects(
      sql.unsafe(`
        INSERT INTO scheduler_job_completion_facts (
          id, source_app, source_type, source_id, completed_at,
          attribution_source, revenue_snapshot_status, currency,
          amount_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
          gst_rate_bps, revenue_captured_at
        ) VALUES (
          'unsafe-money-fact', 'installhub', 'installation',
          'unsafe-money-job', '2026-08-10T04:00:00Z',
          'unattributed', 'captured', 'AUD',
          9007199254740992, 0, 9007199254740992,
          0, '2026-08-10T04:00:00Z'
        )
      `),
      (error: unknown) => isCheckError(
        error,
        'scheduler_job_completion_facts_revenue_snapshot_check',
      ),
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ih_installations WHERE id = 'backfill-undated-install'`),
      (error: unknown) => isCheckError(error, 'scheduler_commercial_source_delete_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ss_sites WHERE id = 'backfill-undated-site'`),
      (error: unknown) => isCheckError(error, 'scheduler_commercial_source_delete_blocked'),
    );

    await sql.unsafe(`
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, status, completed_at
      ) VALUES (
        'fact-protected-audit', 'Protected site', 'Protected address',
        'Inspector', 'Completed', '2026-08-21T12:00:00Z'
      )
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_job_completion_facts (
        id, source_app, source_type, source_id, completed_at,
        attribution_source, revenue_snapshot_status, created_at
      ) VALUES (
        'unavailable-fact', 'ecoaudit', 'audit', 'fact-protected-audit',
        '2026-08-21T12:00:00Z', 'unattributed', 'unavailable',
        '2026-08-21T12:00:00Z'
      )
    `);

    await assert.rejects(
      sql.unsafe(`DELETE FROM ea_audits WHERE id = 'fact-protected-audit'`),
      (error: unknown) => isCheckError(error, 'scheduler_commercial_source_delete_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_job_completion_facts
        SET completed_at = '2026-08-22T12:00:00Z'
        WHERE id = 'unavailable-fact'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_completion_fact_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM scheduler_job_completion_facts WHERE id = 'unavailable-fact'`),
      (error: unknown) => isCheckError(error, 'scheduler_completion_fact_delete_blocked'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_job_completion_facts
        SET revenue_snapshot_status = 'captured', currency = 'AUD',
          amount_ex_gst_cents = 100, gst_amount_cents = 10,
          total_inc_gst_cents = 110, gst_rate_bps = 1000,
          revenue_captured_at = '2026-08-21T12:01:00Z'
        WHERE id = 'unavailable-fact'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_completion_fact_immutable'),
    );

    await sql.unsafe(`
      INSERT INTO scheduler_job_completion_facts (
        id, source_app, source_type, source_id, completed_at,
        attribution_source, revenue_snapshot_status, currency,
        amount_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
        gst_rate_bps, revenue_captured_at, created_at
      ) VALUES (
        'captured-fact', 'installhub', 'installation', 'captured-job',
        '2026-08-21T12:00:00Z', 'unattributed', 'captured', 'NZD',
        100, 10, 110, 1000, '2026-08-21T12:00:00Z',
        '2026-08-21T12:00:00Z'
      )
    `);
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_job_completion_facts
        SET amount_ex_gst_cents = 200, gst_amount_cents = 20,
          total_inc_gst_cents = 220
        WHERE id = 'captured-fact'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_completion_fact_immutable'),
    );
    const [persisted] = await sql<{
      amount_ex_gst_cents: number;
      gst_amount_cents: number;
      total_inc_gst_cents: number;
      currency: string;
      revenue_captured_at: string;
    }[]>`
      SELECT
        amount_ex_gst_cents::int,
        gst_amount_cents::int,
        total_inc_gst_cents::int,
        currency,
        revenue_captured_at::text AS revenue_captured_at
      FROM scheduler_job_completion_facts
      WHERE id = 'captured-fact'
    `;
    assert.deepEqual(persisted, {
      amount_ex_gst_cents: 100,
      gst_amount_cents: 10,
      total_inc_gst_cents: 110,
      currency: 'NZD',
      revenue_captured_at: '2026-08-21 12:00:00',
    });

    await assert.rejects(
      sql.unsafe(`
        INSERT INTO scheduler_invoices (
          id, finance_id, invoice_number, status, currency,
          subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
          gst_rate_bps, seller_name, bill_to_name, job_site_name, job_name,
          job_date, job_status, job_source_app, job_source_type, job_source_id,
          issued_at
        ) VALUES (
          'invalid-direct-issued', 'refund-fence-finance', 'RF-008', 'issued', 'AUD',
          1000, 100, 1100, 1000, 'Seller', 'Buyer', 'Site', 'Job',
          '2026-08-20', 'Completed', 'ecoaudit', 'audit', 'backfill-eco',
          statement_timestamp()
        )
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_insert_lifecycle_invalid'),
    );
    await assert.rejects(
      sql.unsafe(`
        INSERT INTO scheduler_invoices (
          id, finance_id, invoice_number, status, currency,
          subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
          gst_rate_bps, seller_name, bill_to_name, job_site_name, job_name,
          job_date, job_status, job_source_app, job_source_type, job_source_id,
          paid_at
        ) VALUES (
          'invalid-prefilled-draft', 'refund-fence-finance', 'RF-009', 'draft', 'AUD',
          1000, 100, 1100, 1000, 'Seller', 'Buyer', 'Site', 'Job',
          '2026-08-20', 'Draft', 'ecoaudit', 'audit', 'backfill-eco',
          statement_timestamp()
        )
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_insert_lifecycle_invalid'),
    );
    await sql.unsafe(`
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
        gst_rate_bps, seller_name, bill_to_name, job_site_name, job_name,
        job_date, job_status, job_source_app, job_source_type, job_source_id
      ) VALUES (
        'valid-direct-draft', 'refund-fence-finance', 'RF-010', 'draft', 'AUD',
        1000, 100, 1100, 1000, 'Seller', 'Buyer', 'Site', 'Job',
        '2026-08-20', 'Draft', 'ecoaudit', 'audit', 'backfill-eco'
      )
    `);
    await sql.unsafe(`DELETE FROM scheduler_invoices WHERE id = 'valid-direct-draft'`);

    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET invoice_number = 'RF-006-REWRITTEN'
        WHERE id = 'header-draft-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET paid_at = statement_timestamp()
        WHERE id = 'header-draft-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET status = 'issued', issue_date = statement_timestamp(),
          issued_at = statement_timestamp(), due_date = statement_timestamp() + interval '30 days',
          subtotal_ex_gst_cents = 2000,
          updated_at = updated_at + interval '1 millisecond'
        WHERE id = 'header-draft-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await sql.unsafe(`
      UPDATE scheduler_invoices
      SET status = 'issued', issue_date = statement_timestamp(),
        issued_at = statement_timestamp(), due_date = statement_timestamp() + interval '30 days',
        updated_at = updated_at + interval '1 millisecond'
      WHERE id = 'header-draft-invoice'
    `);
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET updated_at = updated_at
        WHERE id = 'header-draft-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET notes = 'Rewritten after issue'
        WHERE id = 'header-draft-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET status = 'void', issue_date = statement_timestamp(),
          voided_at = statement_timestamp(),
          updated_at = updated_at + interval '1 millisecond'
        WHERE id = 'header-draft-void-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await sql.unsafe(`
      UPDATE scheduler_invoices
      SET status = 'void', voided_at = statement_timestamp(),
        updated_at = updated_at + interval '1 millisecond'
      WHERE id = 'header-draft-void-invoice'
    `);
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET subtotal_ex_gst_cents = 2000
        WHERE id = 'refund-lifecycle-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET currency = 'NZD'
        WHERE id = 'refund-lifecycle-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET status = 'paid', updated_at = updated_at + interval '1 millisecond'
        WHERE id = 'header-paid-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await sql.unsafe(`
      UPDATE scheduler_invoices
      SET status = 'paid', paid_at = '2026-08-21T00:00:00Z',
        updated_at = updated_at + interval '1 millisecond'
      WHERE id = 'header-paid-invoice'
    `);
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET updated_at = updated_at - interval '1 second'
        WHERE id = 'header-paid-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_lifecycle_evidence_invalid'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET paid_at = '2026-08-21T01:00:00Z'
        WHERE id = 'header-paid-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM scheduler_invoices WHERE id = 'header-paid-invoice'`),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoices
        SET updated_at = updated_at + interval '1 millisecond'
        WHERE id = 'already-void-invoice'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_snapshot_immutable'),
    );
    const refundInsert = (
      refundId: string,
      invoiceId: string,
      overrides: Partial<{
        currency: string;
        amountExGstCents: number;
        gstAmountCents: number;
        totalIncGstCents: number;
        refundedAt: string;
      }> = {},
    ) => sql`
      INSERT INTO scheduler_invoice_refunds (
        id, invoice_id, idempotency_key, status, currency,
        amount_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
        refunded_at, reason, created_by_global_user_id, created_at, updated_at
      ) VALUES (
        ${refundId}, ${invoiceId}, ${refundId}, 'posted', ${overrides.currency ?? 'AUD'},
        ${overrides.amountExGstCents ?? 100}, ${overrides.gstAmountCents ?? 10},
        ${overrides.totalIncGstCents ?? 110},
        ${overrides.refundedAt ?? '2026-08-21T00:00:00Z'}, 'Test refund',
        'backfill-event-global', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z'
      )
    `;

    await refundInsert('refund-lifecycle', 'refund-lifecycle-invoice');
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoice_refunds
        SET reason = 'Rewritten reason'
        WHERE id = 'refund-lifecycle'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_core_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoice_refunds
        SET status = 'voided',
          voided_by_global_user_id = 'backfill-event-global',
          void_reason = 'Invalid early reversal',
          voided_at = '2026-08-20T23:59:59Z',
          updated_at = '2026-08-21T01:00:00Z'
        WHERE id = 'refund-lifecycle'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_void_time_invalid'),
    );
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoice_refunds
        SET status = 'voided',
          voided_by_global_user_id = 'backfill-event-global',
          void_reason = 'Invalid future reversal',
          voided_at = '2099-01-01T00:00:00Z',
          updated_at = '2099-01-01T00:00:00Z'
        WHERE id = 'refund-lifecycle'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_void_time_invalid'),
    );
    await sql.unsafe(`
      UPDATE scheduler_invoice_refunds
      SET status = 'voided',
        voided_by_global_user_id = 'backfill-event-global',
        voided_by_display_name = 'Historical Event User',
        void_reason = 'Audited reversal',
        voided_at = '2026-08-21T01:00:00Z',
        updated_at = '2026-08-21T01:00:00Z'
      WHERE id = 'refund-lifecycle'
    `);
    await assert.rejects(
      sql.unsafe(`
        UPDATE scheduler_invoice_refunds
        SET status = 'posted'
        WHERE id = 'refund-lifecycle'
      `),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_lifecycle_immutable'),
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM scheduler_invoice_refunds WHERE id = 'refund-lifecycle'`),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_delete_blocked'),
    );
    await assert.rejects(
      refundInsert('refund-against-void', 'already-void-invoice'),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_invoice_status_invalid'),
    );
    await assert.rejects(
      refundInsert('refund-currency-mismatch', 'refund-lifecycle-invoice', {
        currency: 'NZD',
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_currency_mismatch'),
    );
    await assert.rejects(
      refundInsert('refund-wrong-gst', 'refund-lifecycle-invoice', {
        gstAmountCents: 9,
        totalIncGstCents: 109,
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_gst_invalid'),
    );
    await assert.rejects(
      refundInsert('refund-before-issue', 'refund-lifecycle-invoice', {
        refundedAt: '2026-08-19T23:59:59Z',
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_time_invalid'),
    );
    await assert.rejects(
      refundInsert('refund-in-future', 'refund-lifecycle-invoice', {
        refundedAt: '2099-01-01T00:00:00Z',
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_time_invalid'),
    );
    await assert.rejects(
      refundInsert('refund-over-capacity', 'refund-lifecycle-invoice', {
        amountExGstCents: 1_001,
        gstAmountCents: 100,
        totalIncGstCents: 1_101,
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_capacity_exceeded'),
    );
    await assert.rejects(
      refundInsert('refund-unsafe-integer', 'refund-lifecycle-invoice', {
        amountExGstCents: 9_007_199_254_740_992,
        gstAmountCents: 0,
        totalIncGstCents: 9_007_199_254_740_992,
      }),
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_amount_invalid'),
    );

    let markRefundInserted!: () => void;
    const refundInserted = new Promise<void>((resolve) => {
      markRefundInserted = resolve;
    });
    let releaseRefund!: () => void;
    const refundRelease = new Promise<void>((resolve) => {
      releaseRefund = resolve;
    });
    const refundWins = sql.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_refunds (
          id, invoice_id, idempotency_key, status, currency,
          amount_ex_gst_cents, gst_amount_cents, total_inc_gst_cents,
          refunded_at, reason, created_by_global_user_id
        ) VALUES (
          'refund-wins', 'refund-wins-invoice', 'refund-wins', 'posted', 'AUD',
          100, 10, 110, '2026-08-21T00:00:00Z', 'Concurrent refund',
          'backfill-event-global'
        )
      `);
      markRefundInserted();
      await refundRelease;
    });
    await refundInserted;
    const blockedInvoiceVoid = sql.unsafe(`
      UPDATE scheduler_invoices
      SET status = 'void', voided_at = '2026-08-21T02:00:00Z',
        updated_at = updated_at + interval '1 millisecond'
      WHERE id = 'refund-wins-invoice'
    `);
    const refundFirstState = await Promise.race([
      blockedInvoiceVoid.then(() => 'completed' as const, () => 'rejected' as const),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ]);
    assert.equal(refundFirstState, 'blocked');
    releaseRefund();
    await refundWins;
    await assert.rejects(
      blockedInvoiceVoid,
      (error: unknown) => isCheckError(error, 'scheduler_invoice_posted_refund_blocks_void'),
    );

    let markInvoiceVoided!: () => void;
    const invoiceVoided = new Promise<void>((resolve) => {
      markInvoiceVoided = resolve;
    });
    let releaseInvoice!: () => void;
    const invoiceRelease = new Promise<void>((resolve) => {
      releaseInvoice = resolve;
    });
    const voidWins = sql.begin(async (tx) => {
      await tx.unsafe(`
        UPDATE scheduler_invoices
        SET status = 'void', voided_at = '2026-08-21T03:00:00Z',
          updated_at = updated_at + interval '1 millisecond'
        WHERE id = 'void-wins-invoice'
      `);
      markInvoiceVoided();
      await invoiceRelease;
    });
    await invoiceVoided;
    const blockedRefundInsert = refundInsert('void-wins-refund', 'void-wins-invoice');
    const voidFirstState = await Promise.race([
      blockedRefundInsert.then(() => 'completed' as const, () => 'rejected' as const),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ]);
    assert.equal(voidFirstState, 'blocked');
    releaseInvoice();
    await voidWins;
    await assert.rejects(
      blockedRefundInsert,
      (error: unknown) => isCheckError(error, 'scheduler_invoice_refund_invoice_status_invalid'),
    );
  } finally {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.end({ timeout: 5 });
  }
});
