import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_FINANCE_MIGRATION_PG_INTEGRATION_URL;
const migrationsDirectory = new URL('./', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

function invoiceValues(args: {
  id: string;
  financeId: string;
  number: string;
  name: string;
  sourceId: string;
}): string {
  return `(
    '${args.id}', '${args.financeId}', '${args.number}', 'draft', 'AUD',
    0, 0, 0, 1000, 'Sustainability Wise', 'Recipient',
    '${args.name}', '1 Test Road', '${args.name}', '2026-08-16', 'Client', 'Draft',
    'ecoaudit', 'audit', '${args.sourceId}', now(), now()
  )`;
}

function isCommercialPurgeConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { statusCode?: unknown }).statusCode === 409
    && (error as { detail?: unknown }).detail === 'job_commercial_history_purge_blocked',
  );
}

test('0034 backfills legacy invoices and fences old writers across consolidated jobs', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 2 });
  let closeApplicationDatabase: (() => Promise<void>) | null = null;
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0034_')
    .sort();
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    for (const migration of priorMigrations) {
      await sql.begin(async (tx) => tx.unsafe(migrationSource(migration)));
    }
    await sql.unsafe(`
      INSERT INTO scheduler_job_finance (
        id, source_app, source_type, source_id, pricing_mode, quoted_amount_cents,
        currency, bill_to_name, billing_reference, billable_rate_cents, cost_rate_cents
      ) VALUES
        ('finance-a', 'ecoaudit', 'audit', 'job-a', 'quoted', 10000, 'AUD', 'Recipient', 'JOB-A-PO', 10000, 5000),
        ('finance-b', 'ecoaudit', 'audit', 'job-b', 'quoted', 10000, 'AUD', 'Recipient', 'JOB-B-PO', 10000, 5000),
        ('finance-c', 'ecoaudit', 'audit', 'job-c', 'quoted', 10000, 'AUD', 'Recipient', 'JOB-C-PO', 10000, 5000),
        ('finance-expense-only', 'ecoaudit', 'audit', 'job-expense-only', 'charge_up', NULL, 'AUD', 'Recipient', NULL, 15000, 7500)
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
        seller_name, bill_to_name, job_site_name, job_site_address, job_name,
        job_date, job_client_name, job_status, job_source_app, job_source_type,
        job_source_id, created_at, updated_at
      ) VALUES ${invoiceValues({
        id: 'legacy-invoice',
        financeId: 'finance-a',
        number: 'INV-2026-0001',
        name: 'Legacy A',
        sourceId: 'job-a',
      })}
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_job_expenses (
        id, finance_id, kind, category, description, cost_amount_cents,
        billable_amount_cents, billable, invoiced
      ) VALUES (
        'expense-b', 'finance-b', 'supplier_bill', 'materials', 'B materials',
        1000, 1500, true, false
      ), (
        'expense-only-soft-deleted', 'finance-expense-only', 'expense', 'other',
        'Retained deleted expense', 500, 600, true, false
      )
    `);
    await sql.unsafe(`
      UPDATE scheduler_job_expenses
      SET deleted_at = now()
      WHERE id = 'expense-only-soft-deleted'
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_invoice_lines (
        id, invoice_id, sort_order, kind, description, quantity,
        unit_amount_ex_gst_cents, line_total_ex_gst_cents
      ) VALUES
        ('legacy-line', 'legacy-invoice', 0, 'quoted', 'Legacy quote', 1, 2000, 2000),
        ('legacy-other-line', 'legacy-invoice', 1, 'other', 'Legacy manual charge', 1, 500, 500)
    `);

    await sql.begin(async (tx) => tx.unsafe(migrationSource('0034_thankful_pestilence.sql')));

    await sql.unsafe(`
      INSERT INTO ea_audits (id, site_name, site_address, inspector_name)
      VALUES
        ('job-b', 'Eco B', '2 Test Road', 'Inspector'),
        ('session-only-audit', 'Session audit', '3 Test Road', 'Inspector'),
        ('scheduled-audit', 'Scheduled audit', '4 Test Road', 'Inspector'),
        ('edited-ledger-audit', 'Edited ledger', '5 Test Road', 'Inspector'),
        ('pristine-ledger-audit', 'Pristine ledger', '6 Test Road', 'Inspector');
      INSERT INTO ea_audit_work_sessions (
        id, audit_id, actor_user_id, started_at, last_active_at,
        active_milliseconds, revision
      ) VALUES (
        'session-1', 'session-only-audit', 'actor-1', now(), now(), 1000, 1
      );
      INSERT INTO ss_sites (id, site_name, status)
      VALUES ('solar-site', 'Solar site', 'Draft');
      INSERT INTO ss_rooftop_assessments (
        id, site_id, site_name, building_id_name, status
      ) VALUES ('solar-assessment', 'solar-site', 'Solar site', 'Roof A', 'Draft');
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date
      ) VALUES
        ('old-ih-session', 'Client', 'IH session', '7 Test Road', 'Inspector', '2026-08-16'),
        ('old-ih-edited', 'Client', 'IH edited', '8 Test Road', 'Inspector', '2026-08-16');
      INSERT INTO ih_installation_work_sessions (
        id, installation_id, actor_user_id, started_at, last_active_at,
        active_milliseconds, revision
      ) VALUES (
        'ih-session-1', 'old-ih-session', 'actor-1', now(), now(), 1000, 1
      );
      INSERT INTO scheduler_job_finance (
        id, source_app, source_type, source_id, pricing_mode, quoted_amount_cents,
        currency, bill_to_name, billing_reference, billable_rate_cents, cost_rate_cents
      ) VALUES (
        'finance-solar', 'solarsense', 'assessment', 'solar-assessment', 'quoted',
        10000, 'AUD', 'Recipient', 'SOLAR-PO', 10000, 5000
      ), (
        'finance-edited', 'ecoaudit', 'audit', 'edited-ledger-audit', 'charge_up',
        NULL, 'AUD', 'Recipient', NULL, 15000, 7500
      ), (
        'finance-pristine', 'ecoaudit', 'audit', 'pristine-ledger-audit', 'charge_up',
        NULL, 'AUD', NULL, NULL, 15000, 7500
      ), (
        'finance-ih-edited', 'installhub', 'installation', 'old-ih-edited', 'charge_up',
        NULL, 'AUD', NULL, NULL, 15000, 7500
      );
      UPDATE scheduler_job_finance
      SET notes = 'commercial setup', updated_at = updated_at + interval '1 second'
      WHERE id IN ('finance-edited', 'finance-ih-edited');
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, source_id, assignee_field_user_id,
        scheduled_start_at, deadline_at, status, created_by_user_id, created_by_app
      ) VALUES (
        'event-scheduled-audit', 'Scheduled audit', 'ecoaudit', 'audit',
        'scheduled-audit', 'field-user', now(), now() + interval '1 day',
        'planned', 'admin-user', 'ecoaudit'
      )
    `);

    assert.deepEqual([...await sql<{
      invoice_id: string;
      finance_id: string;
      billing_reference: string | null;
    }[]>`
      SELECT invoice_id, finance_id, billing_reference
      FROM scheduler_invoice_jobs WHERE invoice_id = 'legacy-invoice'
    `], [{
      invoice_id: 'legacy-invoice',
      finance_id: 'finance-a',
      billing_reference: 'JOB-A-PO',
    }]);
    assert.equal((await sql<{ finance_id: string }[]>`
      SELECT finance_id FROM scheduler_invoice_lines WHERE id = 'legacy-line'
    `)[0]?.finance_id, 'finance-a');
    assert.equal((await sql<{ finance_id: string }[]>`
      SELECT finance_id FROM scheduler_invoice_lines WHERE id = 'legacy-other-line'
    `)[0]?.finance_id, 'finance-a');

    await assert.rejects(sql.begin(async (tx) => {
      await tx.unsafe(`DELETE FROM scheduler_invoice_lines WHERE invoice_id = 'legacy-invoice'`);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES (
          'legacy-other-rewrite', 'legacy-invoice', 0, 'other',
          'Changed legacy manual charge', 1, 600, 600
        )
      `);
      await tx.unsafe(`UPDATE scheduler_invoices SET status = 'issued' WHERE id = 'legacy-invoice'`);
    }), /scheduler_invoice_lines_immutable/);
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM scheduler_invoice_lines
      WHERE invoice_id = 'legacy-invoice'
    `)[0]?.count, 2);
    // Current code issues the immutable legacy snapshot without rewriting it.
    await sql.unsafe(`UPDATE scheduler_invoices SET status = 'issued' WHERE id = 'legacy-invoice'`);

    // Replaying the data portion is idempotent.
    await sql.unsafe(`
      INSERT INTO scheduler_invoice_jobs (
        invoice_id, finance_id, sort_order, billing_reference, job_site_name,
        job_site_address, job_name, job_date, job_client_name, job_status,
        job_source_app, job_source_type, job_source_id, created_at
      )
      SELECT invoice.id, invoice.finance_id, 0, finance.billing_reference,
        invoice.job_site_name, invoice.job_site_address, invoice.job_name,
        invoice.job_date, invoice.job_client_name, invoice.job_status,
        invoice.job_source_app, invoice.job_source_type, invoice.job_source_id,
        invoice.created_at
      FROM scheduler_invoices invoice
      JOIN scheduler_job_finance finance ON finance.id = invoice.finance_id
      ON CONFLICT (invoice_id, finance_id) DO NOTHING
    `);
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM scheduler_invoice_jobs
      WHERE invoice_id = 'legacy-invoice'
    `)[0]?.count, 1);

    // A d89-shaped header and line insert still works post-migration.
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO scheduler_invoices (
          id, finance_id, invoice_number, status, currency,
          subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
          seller_name, bill_to_name, job_site_name, job_site_address, job_name,
          job_date, job_client_name, job_status, job_source_app, job_source_type,
          job_source_id, created_at, updated_at
        ) VALUES ${invoiceValues({
          id: 'old-single',
          financeId: 'finance-c',
          number: 'INV-2026-0002',
          name: 'Old C',
          sourceId: 'job-c',
        })}
      `);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES ('old-single-line', 'old-single', 0, 'quoted', 'Old quote', 1, 4000, 4000)
      `);
    });
    assert.equal((await sql<{ finance_id: string }[]>`
      SELECT finance_id FROM scheduler_invoice_lines WHERE id = 'old-single-line'
    `)[0]?.finance_id, 'finance-c');
    await assert.rejects(sql.begin(async (tx) => {
      await tx.unsafe(`DELETE FROM scheduler_invoice_lines WHERE invoice_id = 'old-single'`);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES (
          'old-single-line-replaced', 'old-single', 0, 'quoted',
          'Old quote replaced', 1, 4000, 4000
        )
      `);
    }), /scheduler_invoice_lines_immutable/);
    await sql.unsafe(`
      UPDATE scheduler_invoices
      SET status = 'issued', job_name = 'Issued C snapshot', updated_at = now()
      WHERE id = 'old-single'
    `);
    assert.equal((await sql<{ job_name: string }[]>`
      SELECT job_name FROM scheduler_invoice_jobs WHERE invoice_id = 'old-single'
    `)[0]?.job_name, 'Issued C snapshot');

    // Create A+B with line-level B provenance, as the new service does.
    await sql.unsafe(`
      INSERT INTO scheduler_invoices (
        id, finance_id, invoice_number, status, currency,
        subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
        seller_name, bill_to_name, job_site_name, job_site_address, job_name,
        job_date, job_client_name, job_status, job_source_app, job_source_type,
        job_source_id, created_at, updated_at
      ) VALUES ${invoiceValues({
        id: 'consolidated',
        financeId: 'finance-a',
        number: 'INV-2026-0003',
        name: 'Consolidated A',
        sourceId: 'job-a',
      })}
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_invoice_jobs (
        invoice_id, finance_id, sort_order, billing_reference, job_site_name,
        job_site_address, job_name, job_date, job_client_name, job_status,
        job_source_app, job_source_type, job_source_id
      ) VALUES (
        'consolidated', 'finance-b', 1, 'JOB-B-PO', 'B site', '2 Test Road',
        'Consolidated B', '2026-08-16', 'Client', 'Draft', 'ecoaudit', 'audit', 'job-b'
      ), (
        'consolidated', 'finance-solar', 2, 'SOLAR-PO', 'Solar site', '4 Test Road',
        'Solar assessment', '2026-08-16', 'Client', 'Draft',
        'solarsense', 'assessment', 'solar-assessment'
      )
    `);
    await sql.unsafe(`
      INSERT INTO scheduler_invoice_lines (
        id, invoice_id, finance_id, sort_order, kind, description, quantity,
        unit_amount_ex_gst_cents, line_total_ex_gst_cents, expense_id
      ) VALUES
        ('consolidated-a-line', 'consolidated', 'finance-a', 0, 'quoted', 'A quote', 1, 1000, 1000, NULL),
        ('consolidated-b-line', 'consolidated', 'finance-b', 1, 'quoted', 'B quote', 1, 6000, 6000, NULL),
        ('consolidated-b-expense', 'consolidated', 'finance-b', 2, 'expense', 'B materials', 1, 1500, 1500, 'expense-b'),
        ('consolidated-solar-line', 'consolidated', 'finance-solar', 3, 'quoted', 'Solar quote', 1, 1000, 1000, NULL)
    `);

    // The exact d89 draft-save/issue algorithm deletes all lines and then
    // reinserts without finance_id. It now fails closed for both single and
    // consolidated drafts; current code issues immutable derived snapshots
    // without rewriting them.
    await assert.rejects(sql.begin(async (tx) => {
      await tx.unsafe(`DELETE FROM scheduler_invoice_lines WHERE invoice_id = 'consolidated'`);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES (
          'old-consolidated-rewrite', 'consolidated', 0, 'quoted',
          'Old collapsed quote', 1, 7000, 7000
        )
      `);
      await tx.unsafe(`
        UPDATE scheduler_invoices SET status = 'issued' WHERE id = 'consolidated'
      `);
    }), /scheduler_invoice_lines_immutable/);
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM scheduler_invoice_lines
      WHERE invoice_id = 'consolidated' AND finance_id IN ('finance-b', 'finance-solar')
    `)[0]?.count, 3);

    // A pre-0034 process can see the anchor header but must not perform a
    // consolidated lifecycle transition without the current-writer marker.
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_invoices SET status = 'issued' WHERE id = 'consolidated'`),
      /scheduler_consolidated_invoice_status_requires_current_writer/,
    );
    await sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('sustainability.scheduler_multi_job_writer', 'on', true)`);
      await tx.unsafe(`UPDATE scheduler_invoices SET status = 'issued' WHERE id = 'consolidated'`);
    });

    // Product purge paths must recognize secondary consolidated membership and
    // recorded time before releasing any source or storage evidence.
    process.env.DATABASE_URL = integrationDatabase!;
    process.env.JWT_SECRET ??= 'integration-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET ??= 'integration-test-refresh-secret';
    const [ecoHelpers, solarHelpers, database] = await Promise.all([
      import('../../routes/ecoaudit/helpers.js'),
      import('../../routes/solarsense/helpers.js'),
      import('../client.js'),
    ]);
    closeApplicationDatabase = database.closeDb;
    await assert.rejects(
      ecoHelpers.purgeEcoauditAuditTree('job-b'),
      isCommercialPurgeConflict,
    );
    await assert.rejects(
      ecoHelpers.purgeEcoauditAuditTree('session-only-audit'),
      isCommercialPurgeConflict,
    );
    await assert.rejects(
      solarHelpers.purgeSolarsenseSiteTree('solar-site'),
      isCommercialPurgeConflict,
    );
    await assert.rejects(
      ecoHelpers.purgeEcoauditAuditTree('scheduled-audit'),
      isCommercialPurgeConflict,
    );
    await assert.rejects(
      ecoHelpers.purgeEcoauditAuditTree('edited-ledger-audit'),
      isCommercialPurgeConflict,
    );
    await ecoHelpers.purgeEcoauditAuditTree('pristine-ledger-audit');
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM scheduler_job_finance
      WHERE id = 'finance-pristine'
    `)[0]?.count, 0);
    assert.equal((await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ea_audits
      WHERE id = 'pristine-ledger-audit'
    `)[0]?.count, 0);
    await database.closeDb();
    closeApplicationDatabase = null;

    // Exact old-binary purge shapes fail closed at the database boundary. Old
    // Eco/Solar code explicitly removed sessions/children before the parent;
    // old InstallHub code could remove an edited ledger before its parent.
    await assert.rejects(
      sql.unsafe(`DELETE FROM ea_audit_work_sessions WHERE audit_id = 'session-only-audit'`),
      /scheduler_work_session_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ea_audits WHERE id = 'scheduled-audit'`),
      /scheduler_commercial_source_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ss_rooftop_assessments WHERE id = 'solar-assessment'`),
      /scheduler_commercial_source_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ss_sites WHERE id = 'solar-site'`),
      /scheduler_commercial_source_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ih_installation_work_sessions WHERE installation_id = 'old-ih-session'`),
      /scheduler_work_session_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ih_installations WHERE id = 'old-ih-session'`),
      /scheduler_commercial_source_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM scheduler_job_finance WHERE id = 'finance-ih-edited'`),
      /scheduler_commercial_evidence_delete_blocked/,
    );
    await assert.rejects(
      sql.unsafe(`DELETE FROM ih_installations WHERE id = 'old-ih-edited'`),
      /scheduler_commercial_source_delete_blocked/,
    );

    // An old B-side writer cannot miss the consolidated reservation.
    await assert.rejects(sql.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO scheduler_invoices (
          id, finance_id, invoice_number, status, currency,
          subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
          seller_name, bill_to_name, job_site_name, job_site_address, job_name,
          job_date, job_client_name, job_status, job_source_app, job_source_type,
          job_source_id, created_at, updated_at
        ) VALUES ${invoiceValues({
          id: 'old-b-overbook',
          financeId: 'finance-b',
          number: 'INV-2026-0004',
          name: 'Old B overbook',
          sourceId: 'job-b',
        })}
      `);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES ('old-b-overbook-line', 'old-b-overbook', 0, 'quoted', 'Missed B quote', 1, 5000, 5000)
      `);
    }), /scheduler_invoice_quote_over_reserved/);

    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_finance SET currency = 'NZD' WHERE id = 'finance-b'`),
      /scheduler_finance_currency_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_finance SET currency = 'NZD' WHERE id = 'finance-expense-only'`),
      /scheduler_finance_currency_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_finance SET pricing_mode = 'charge_up' WHERE id = 'finance-b'`),
      /scheduler_finance_rates_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_finance SET quoted_amount_cents = 12000 WHERE id = 'finance-b'`),
      /scheduler_finance_rates_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_finance SET billable_rate_cents = 12000 WHERE id = 'finance-b'`),
      /scheduler_finance_rates_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_expenses SET description = 'Changed by old B writer' WHERE id = 'expense-b'`),
      /scheduler_expense_locked_by_invoice/,
    );
    await assert.rejects(
      sql.unsafe(`UPDATE scheduler_job_expenses SET deleted_at = now() WHERE id = 'expense-b'`),
      /scheduler_expense_locked_by_invoice/,
    );

    await sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('sustainability.scheduler_multi_job_writer', 'on', true)`);
      await tx.unsafe(`UPDATE scheduler_invoices SET status = 'void' WHERE id = 'consolidated'`);
    });
    await sql.unsafe(`
      UPDATE scheduler_job_expenses
      SET description = 'Editable after void'
      WHERE id = 'expense-b'
    `);
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO scheduler_invoices (
          id, finance_id, invoice_number, status, currency,
          subtotal_ex_gst_cents, gst_amount_cents, total_inc_gst_cents, gst_rate_bps,
          seller_name, bill_to_name, job_site_name, job_site_address, job_name,
          job_date, job_client_name, job_status, job_source_app, job_source_type,
          job_source_id, created_at, updated_at
        ) VALUES ${invoiceValues({
          id: 'old-b-after-void',
          financeId: 'finance-b',
          number: 'INV-2026-0005',
          name: 'Old B after void',
          sourceId: 'job-b',
        })}
      `);
      await tx.unsafe(`
        INSERT INTO scheduler_invoice_lines (
          id, invoice_id, sort_order, kind, description, quantity,
          unit_amount_ex_gst_cents, line_total_ex_gst_cents
        ) VALUES ('old-b-after-void-line', 'old-b-after-void', 0, 'quoted', 'Released B quote', 1, 5000, 5000)
      `);
    });
  } finally {
    if (closeApplicationDatabase) await closeApplicationDatabase();
    await sql.end();
  }
});
