import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_FINANCE_MIGRATION_PG_INTEGRATION_URL;
const migrationsDirectory = new URL('./', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

test('0033 migrates Field commercial history, review provenance, and counters', {
  skip: !integrationDatabase,
  timeout: 180_000,
}, async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(integrationDatabase!, { max: 1 });
  const priorMigrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < '0033_')
    .sort();

  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');
    for (const migration of priorMigrations) {
      await sql.begin(async (tx) => tx.unsafe(migrationSource(migration)));
    }

    await sql.unsafe(`
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date,
        status, created_at, updated_at
      ) VALUES
        ('legacy-issued-only', 'Issued Client', 'Historic Job', '3 Archive Road',
         'Inspector', '2026-08-09', 'Completed', '2026-08-01', '2026-08-12'),
        ('legacy-no-session', 'Legacy Client', 'Legacy Factory', '1 Old Road',
         'Inspector', '2026-08-10', 'Draft', '2026-08-01', '2026-08-12'),
        ('legacy-with-session', 'Tracked Client', 'Tracked Factory', '2 New Road',
         'Inspector', '2026-08-11', 'Draft', '2026-08-01', '2026-08-12')
    `);
    await sql.unsafe(`
      INSERT INTO ih_job_finance (
        installation_id, pricing_mode, priced_amount, currency, notes,
        created_at, updated_at
      ) VALUES
        ('legacy-issued-only', 'charge_up', null, 'aud', 'Issued-only history',
         '2026-08-01', '2026-08-12'),
        ('legacy-no-session', 'quoted', 1200.50, 'AUD', 'Legacy quote',
         '2026-08-01', '2026-08-12'),
        ('legacy-with-session', 'charge_up', null, 'NZD', null,
         '2026-08-01', '2026-08-12')
    `);
    await sql.unsafe(`
      INSERT INTO ih_job_cost_lines (
        id, installation_id, category, description, cost_amount, sell_amount,
        hours, billable, invoiced, source, incurred_at, created_at, updated_at
      ) VALUES
        ('issued-only-auto', 'legacy-issued-only', 'labour', 'Issued-only labour',
         250, 400, 5, true, true, 'auto_labour', '2026-08-09',
         '2026-08-09', '2026-08-12'),
        ('manual-expense', 'legacy-no-session', 'material', 'Legacy panels',
         100.25, 150.75, null, true, true, 'manual', '2026-08-09',
         '2026-08-09', '2026-08-09'),
        ('legacy-auto', 'legacy-no-session', 'labour', 'Old calendar labour',
         600, 600, 8, true, false, 'auto_labour', '2026-08-10',
         '2026-08-10', '2026-08-12'),
        ('legacy-invoiced-auto', 'legacy-no-session', 'labour', 'Old invoiced labour',
         300, 300, 4, true, true, 'auto_labour', '2026-08-10',
         '2026-08-10', '2026-08-11'),
        ('tracked-auto', 'legacy-with-session', 'labour', 'Old tracked labour',
         500, 1000, 10, true, false, 'auto_labour', '2026-08-11',
         '2026-08-11', '2026-08-12')
    `);
    await sql.unsafe(`
      INSERT INTO ih_installation_work_sessions (
        id, installation_id, actor_user_id, started_at, last_active_at,
        ended_at, active_milliseconds, revision
      ) VALUES (
        'tracked-session', 'legacy-with-session', 'actor', '2026-08-11 09:00',
        '2026-08-11 11:00', '2026-08-11 11:00', 7200000, 1
      )
    `);
    await sql.unsafe(`
      INSERT INTO ih_invoices (
        id, installation_id, invoice_number, status, currency, issue_date,
        due_date, subtotal_ex_gst, gst_amount, total_inc_gst, gst_rate, notes,
        seller_name, seller_abn, seller_address, seller_email,
        created_at, updated_at, issued_at, voided_at
      ) VALUES
        ('issued-only-invoice', 'legacy-issued-only', 'INV-2024-0007', 'issued', 'aud',
         '2026-08-12', '2026-08-26', 400, 40, 440, 0.10,
         'Issued-only snapshot', 'Legacy Seller', null, null, null,
         '2026-08-12', '2026-08-12', '2026-08-12', null),
        ('legacy-issued', 'legacy-no-session', 'INV-2026-0042', 'issued', 'AUD',
         '2026-08-12', '2026-08-26', 450.75, 45.08, 495.83, 0.10,
         'Issued snapshot', 'Legacy Seller', '12 345 678 901', 'Seller Road',
         'billing@example.test', '2026-08-12', '2026-08-12', '2026-08-12', null),
        ('legacy-draft', 'legacy-no-session', 'INV-2026-0043', 'draft', 'AUD',
         null, null, 600, 60, 660, 0.10, 'Draft snapshot', null, null, null,
         null, '2026-08-13', '2026-08-13', null, null),
        ('legacy-void', 'legacy-no-session', 'INV-2025-0009', 'void', 'AUD',
         '2025-12-01', '2025-12-15', 25, 2.5, 27.5, 0.10, null,
         null, null, null, null, '2025-12-01', '2025-12-02',
         '2025-12-01', '2025-12-02')
    `);
    await sql.unsafe(`
      INSERT INTO ih_invoice_lines (
        id, invoice_id, sort_order, description, quantity, unit_amount_ex_gst,
        line_total_ex_gst, cost_line_id, category, created_at
      ) VALUES
        ('issued-only-line', 'issued-only-invoice', 0, 'Issued-only labour', 5, 80,
         400, 'issued-only-auto', 'labour', '2026-08-12'),
        ('legacy-issued-line', 'legacy-issued', 0, 'Legacy panels', 1, 150.75,
         150.75, 'manual-expense', 'material', '2026-08-12'),
        ('legacy-issued-labour', 'legacy-issued', 1, 'Old invoiced labour', 4, 75,
         300, 'legacy-invoiced-auto', 'labour', '2026-08-12'),
        ('legacy-draft-line', 'legacy-draft', 0, 'Old calendar labour', 8, 75,
         600, 'legacy-auto', 'labour', '2026-08-13'),
        ('legacy-void-line', 'legacy-void', 0, 'Archived adjustment', 0.00001, 2500000,
         25, null, 'other', '2025-12-01')
    `);

    const migration = migrationSource('0033_abandoned_gressill.sql');
    await sql.begin(async (tx) => tx.unsafe(migration));

    const finance = await sql<{
      id: string;
      source_id: string;
      pricing_mode: string;
      quoted_amount_cents: string | null;
      currency: string;
      bill_to_name: string | null;
      billable_rate_cents: string;
      cost_rate_cents: string;
    }[]>`
      SELECT id, source_id, pricing_mode, quoted_amount_cents, currency, bill_to_name,
             billable_rate_cents, cost_rate_cents
      FROM scheduler_job_finance ORDER BY source_id
    `;
    assert.deepEqual([...finance], [
      {
        id: 'legacy-installhub:legacy-issued-only',
        source_id: 'legacy-issued-only',
        pricing_mode: 'charge_up',
        quoted_amount_cents: null,
        currency: 'AUD',
        bill_to_name: 'Issued Client',
        billable_rate_cents: '8000',
        cost_rate_cents: '5000',
      },
      {
        id: 'legacy-installhub:legacy-no-session',
        source_id: 'legacy-no-session',
        pricing_mode: 'quoted',
        quoted_amount_cents: '120050',
        currency: 'AUD',
        bill_to_name: 'Legacy Client',
        billable_rate_cents: '7500',
        cost_rate_cents: '7500',
      },
      {
        id: 'legacy-installhub:legacy-with-session',
        source_id: 'legacy-with-session',
        pricing_mode: 'charge_up',
        quoted_amount_cents: null,
        currency: 'NZD',
        bill_to_name: 'Tracked Client',
        billable_rate_cents: '10000',
        cost_rate_cents: '5000',
      },
    ]);

    const expenses = await sql<{
      id: string;
      category: string;
      cost_amount_cents: string;
      billable_amount_cents: string | null;
      invoiced: boolean;
    }[]>`
      SELECT id, category, cost_amount_cents, billable_amount_cents, invoiced
      FROM scheduler_job_expenses ORDER BY id
    `;
    assert.deepEqual([...expenses], [{
      id: 'manual-expense',
      category: 'materials',
      cost_amount_cents: '10025',
      billable_amount_cents: '15075',
      invoiced: true,
    }]);

    const overrides = await sql<{
      source_id: string;
      revision: number;
      source: string;
      billable_milliseconds: string;
      reason: string;
    }[]>`
      SELECT finance.source_id, override.revision, override.source,
             override.billable_milliseconds, override.reason
      FROM scheduler_job_hour_overrides override
      JOIN scheduler_job_finance finance ON finance.id = override.finance_id
      ORDER BY finance.source_id
    `;
    assert.deepEqual([...overrides], [
      {
        source_id: 'legacy-issued-only',
        revision: 1,
        source: 'legacy_estimate',
        billable_milliseconds: '18000000',
        reason: 'Legacy calendar-day estimate migrated for review',
      },
      {
        source_id: 'legacy-no-session',
        revision: 1,
        source: 'legacy_estimate',
        billable_milliseconds: '28800000',
        reason: 'Legacy calendar-day estimate migrated for review',
      },
    ]);

    const invoices = await sql<{
      id: string;
      invoice_number: string;
      status: string;
      subtotal_ex_gst_cents: string;
      bill_to_name: string;
      job_name: string;
      job_date: string;
      seller_name: string;
    }[]>`
      SELECT id, invoice_number, status, subtotal_ex_gst_cents, bill_to_name,
             job_name, job_date, seller_name
      FROM scheduler_invoices ORDER BY id
    `;
    assert.equal(invoices.length, 4);
    assert.deepEqual(invoices.find((row) => row.id === 'legacy-issued'), {
      id: 'legacy-issued',
      invoice_number: 'INV-2026-0042',
      status: 'issued',
      subtotal_ex_gst_cents: '45075',
      bill_to_name: 'Legacy Client',
      job_name: 'Legacy Factory',
      job_date: '2026-08-10',
      seller_name: 'Legacy Seller',
    });
    assert.deepEqual(
      [...await sql<{ id: string; kind: string; expense_id: string | null }[]>`
        SELECT id, kind, expense_id FROM scheduler_invoice_lines ORDER BY id
      `],
      [
        { id: 'issued-only-line', kind: 'labour', expense_id: null },
        { id: 'legacy-draft-line', kind: 'quoted', expense_id: null },
        { id: 'legacy-issued-labour', kind: 'quoted', expense_id: null },
        { id: 'legacy-issued-line', kind: 'expense', expense_id: 'manual-expense' },
        { id: 'legacy-void-line', kind: 'other', expense_id: null },
      ],
    );
    assert.equal((await sql<{ quantity: number }[]>`
      SELECT quantity FROM scheduler_invoice_lines WHERE id = 'legacy-void-line'
    `)[0]?.quantity, 0.00001);
    assert.deepEqual(
      [...await sql<{ issued_quote_cents: string; remaining_quote_cents: string }[]>`
        SELECT
          COALESCE(sum(line.line_total_ex_gst_cents), 0)::text AS issued_quote_cents,
          (
            finance.quoted_amount_cents
            - COALESCE(sum(line.line_total_ex_gst_cents), 0)
          )::text AS remaining_quote_cents
        FROM scheduler_job_finance finance
        LEFT JOIN scheduler_invoices invoice
          ON invoice.finance_id = finance.id
          AND invoice.status IN ('issued', 'paid')
        LEFT JOIN scheduler_invoice_lines line
          ON line.invoice_id = invoice.id
          AND line.kind = 'quoted'
        WHERE finance.source_id = 'legacy-no-session'
        GROUP BY finance.quoted_amount_cents
      `],
      [{ issued_quote_cents: '30000', remaining_quote_cents: '90050' }],
    );
    assert.deepEqual(
      [...await sql<{ year: number; last_value: number }[]>`
        SELECT year, last_value FROM scheduler_invoice_counters ORDER BY year
      `],
      [
        { year: 2024, last_value: 7 },
        { year: 2025, last_value: 9 },
        { year: 2026, last_value: 43 },
      ],
    );

    const dataSection = migration.slice(migration.indexOf('-- Preserve every legacy'));
    await sql.begin(async (tx) => tx.unsafe(dataSection));
    const counts = await sql<{
      finance_count: string;
      expense_count: string;
      override_count: string;
      invoice_count: string;
      line_count: string;
    }[]>`
      SELECT
        (SELECT count(*) FROM scheduler_job_finance) AS finance_count,
        (SELECT count(*) FROM scheduler_job_expenses) AS expense_count,
        (SELECT count(*) FROM scheduler_job_hour_overrides) AS override_count,
        (SELECT count(*) FROM scheduler_invoices) AS invoice_count,
        (SELECT count(*) FROM scheduler_invoice_lines) AS line_count
    `;
    assert.deepEqual(counts[0], {
      finance_count: '3',
      expense_count: '1',
      override_count: '2',
      invoice_count: '4',
      line_count: '5',
    });
    assert.equal((await sql<{ exists: string | null }[]>`
      SELECT to_regclass('public.ih_invoices')::text AS exists
    `)[0]?.exists, 'ih_invoices');

    await sql.unsafe(`
      INSERT INTO ih_job_cost_lines (
        id, installation_id, category, description, cost_amount, source
      ) VALUES (
        'invalid-accounting-line', 'legacy-no-session', 'other',
        'Must fail closed', 'NaN'::real, 'manual'
      )
    `);
    const preflightStart = migration.indexOf('DO $$');
    const preflightEnd = migration.indexOf('--> statement-breakpoint', preflightStart);
    await assert.rejects(
      sql.begin(async (tx) => tx.unsafe(migration.slice(preflightStart, preflightEnd))),
      /legacy cost line has nonfinite, negative, or out-of-range accounting values/,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
});
