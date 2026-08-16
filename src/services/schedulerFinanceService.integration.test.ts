import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_FINANCE_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

const migrationsDirectory = new URL('../db/migrations/', import.meta.url);

function migrationSource(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), 'utf8');
}

function appErrorDetailIncludes(fragment: string) {
  return (error: unknown): boolean => (
    typeof error === 'object'
    && error !== null
    && 'detail' in error
    && typeof error.detail === 'string'
    && error.detail.includes(fragment)
  );
}

test('shared Scheduler finance covers all apps and enforces commercial lifecycle invariants', {
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
        ('admin-global', 'admin@example.test', 'admin-field', 'ecoaudit', 'admin-eco',
         'admin@example.test', 'Global Admin', 'admin', true),
        ('worker-global', 'worker@example.test', 'worker-field', 'ecoaudit', 'worker-eco',
         'worker@example.test', 'Recorded Worker', 'inspector', true)
    `);
    await setup.unsafe(`
      INSERT INTO unified_users (
        id, global_user_id, origin_app, origin_user_id, field_user_id, email,
        password_hash, role, is_active, source_created_at, source_updated_at
      ) VALUES
        ('admin-membership', 'admin-global', 'ecoaudit', 'admin-eco', 'admin-field',
         'admin@example.test', 'test', 'admin', true, now(), now()),
        ('worker-eco-membership', 'worker-global', 'ecoaudit', 'worker-eco', 'worker-field',
         'worker@example.test', 'test', 'inspector', true, now(), now()),
        ('worker-solar-membership', 'worker-global', 'solarsense', 'worker-solar', 'worker-field',
         'worker@example.test', 'test', 'inspector', true, now(), now()),
        ('worker-field-membership', 'worker-global', 'installhub', 'worker-installhub', 'worker-field',
         'worker@example.test', 'test', 'inspector', true, now(), now())
    `);
    await setup.unsafe(`
      INSERT INTO ea_audits (
        id, site_name, site_address, inspector_name, audit_date, status,
        assigned_inspector_user_id, created_at
      ) VALUES
        ('eco-job', 'Eco Factory', '1 Eco Road', 'Worker', '2026-08-20', 'Draft',
         'worker-eco', '2026-08-01'),
        ('eco-unscheduled', 'Unscheduled Eco', '2 Eco Road', 'Worker', '2026-08-21',
         'Draft', 'worker-eco', '2026-08-01')
    `);
    await setup.unsafe(`
      INSERT INTO ss_sites (
        id, site_name, location, date_of_assessment, status, created_at
      ) VALUES ('solar-site', 'Solar Campus', '3 Solar Road', '2026-08-22', 'Draft', '2026-08-01')
    `);
    await setup.unsafe(`
      INSERT INTO ss_rooftop_assessments (
        id, site_id, site_name, building_id_name, status,
        assigned_inspector_user_id, created_at
      ) VALUES ('solar-job', 'solar-site', 'Solar Campus', 'Building A', 'Draft',
        'worker-solar', '2026-08-01')
    `);
    await setup.unsafe(`
      INSERT INTO ih_installations (
        id, client_name, site_name, site_address, inspector_name, audit_date,
        status, assigned_inspector_user_id, created_at
      ) VALUES
        ('field-job', 'Field Client', 'Field Factory', '4 Field Road',
         'Worker', '2026-08-23', 'Draft', 'worker-installhub', '2026-08-01'),
        ('field-empty-purge', 'Empty Client', 'Empty Field Job', '5 Field Road',
         'Worker', '2026-08-24', 'Draft', 'worker-installhub', '2026-08-01'),
        ('field-expense-purge', 'Expense Client', 'Expense Field Job', '6 Field Road',
         'Worker', '2026-08-25', 'Draft', 'worker-installhub', '2026-08-01'),
        ('field-deleted-ledger', 'Deleted Client', 'Deleted Field Job', '7 Field Road',
         'Worker', '2026-08-26', 'Draft', 'worker-installhub', '2026-08-01')
    `);
    await setup.unsafe(`
      INSERT INTO ea_audit_work_sessions (
        id, audit_id, actor_user_id, started_at, last_active_at, ended_at,
        active_milliseconds, revision
      ) VALUES
        ('eco-session-1', 'eco-job', 'worker-eco', '2026-08-20 09:00',
         '2026-08-20 10:00', '2026-08-20 10:00', 3600000, 1),
        ('eco-session-2', 'eco-job', 'worker-eco', '2026-08-20 10:00',
         '2026-08-20 10:30', '2026-08-20 10:30', 1800000, 1)
    `);
    await setup.unsafe(`
      INSERT INTO ss_assessment_work_sessions (
        id, assessment_id, actor_user_id, started_at, last_active_at, ended_at,
        active_milliseconds, revision
      ) VALUES ('solar-session', 'solar-job', 'worker-solar', '2026-08-22 09:00',
        '2026-08-22 11:00', '2026-08-22 11:00', 7200000, 1)
    `);
    await setup.unsafe(`
      INSERT INTO ih_installation_work_sessions (
        id, installation_id, actor_user_id, started_at, last_active_at, ended_at,
        active_milliseconds, revision
      ) VALUES ('field-session', 'field-job', 'worker-installhub', '2026-08-23 09:00',
        '2026-08-23 12:00', '2026-08-23 12:00', 10800000, 1)
    `);
    await setup.unsafe(`
      INSERT INTO portal_schedule_events (
        id, title, source_app, source_type, source_id, assignee_field_user_id,
        scheduled_start_at, scheduled_end_at, deadline_at, status,
        created_by_user_id, created_by_app
      ) VALUES
        ('eco-event-1', 'Eco visit one', 'ecoaudit', 'audit', 'eco-job', 'worker-field',
         '2026-08-20 09:00', '2026-08-20 11:00', '2026-08-20 17:00', 'done',
         'admin-eco', 'ecoaudit'),
        ('eco-event-2', 'Eco visit two', 'ecoaudit', 'audit', 'eco-job', 'worker-field',
         '2026-08-21 09:00', '2026-08-21 10:00', '2026-08-21 17:00', 'planned',
         'admin-eco', 'ecoaudit'),
        ('solar-event', 'Solar visit', 'solarsense', 'assessment', 'solar-job', 'worker-field',
         '2026-08-22 09:00', '2026-08-22 12:00', '2026-08-22 17:00', 'planned',
         'admin-eco', 'ecoaudit'),
        ('field-event', 'Field visit', 'installhub', 'installation', 'field-job', 'worker-field',
         '2026-08-23 09:00', '2026-08-23 13:00', '2026-08-23 17:00', 'planned',
         'admin-eco', 'ecoaudit')
    `);

    const service = await import('./schedulerFinanceService.js');
    const legacyFinance = await import('./installHubFinanceService.js');
    const legacyInvoices = await import('./installHubInvoiceService.js');
    const { purgeInstallHubInstallationTree } = await import('../routes/installhub/purge.js');
    const { closeDb } = await import('../db/client.js');
    const admin = {
      userId: 'admin-eco',
      app: 'ecoaudit' as const,
      role: 'admin' as const,
      authType: 'jwt' as const,
    };
    const inspector = {
      userId: 'worker-eco',
      app: 'ecoaudit' as const,
      role: 'inspector' as const,
      authType: 'jwt' as const,
    };

    try {
      const [eco, solar, field] = await Promise.all([
        service.getSchedulerFinancialSummary(admin, 'eco-event-1'),
        service.getSchedulerFinancialSummary(admin, 'solar-event'),
        service.getSchedulerFinancialSummary(admin, 'field-event'),
      ]);
      assert.equal(eco.time.actualMilliseconds, 5_400_000);
      assert.equal(eco.time.actualHours, 1.5);
      assert.equal(eco.time.scheduledHours, 3);
      assert.equal(eco.time.hoursVariance, -1.5);
      assert.deepEqual(eco.time.actors, [{
        userId: 'worker-global',
        displayName: 'Recorded Worker',
        activeMilliseconds: 5_400_000,
        hours: 1.5,
      }]);
      assert.equal(solar.time.actualHours, 2);
      assert.equal(field.time.actualHours, 3);

      const overview = await service.listSchedulerFinanceOverview(admin, { limit: 100 });
      assert.equal(overview.items.some((item) => (
        item.sourceId === 'eco-unscheduled' && item.eventId === null
      )), true);
      assert.equal(overview.items.every((item) => typeof item.currency === 'string'), true);

      const overridden = await service.updateSchedulerFinanceById(admin, eco.financeId, {
        billableHoursOverride: 2,
        costHoursOverride: 1.75,
        overrideReason: 'Approved after timesheet review',
        billableRate: 180,
        costRate: 80,
      });
      assert.equal(overridden.time.billableHours, 2);
      assert.equal(overridden.time.actualHours, 1.5);
      assert.equal(overridden.time.overrideSource, 'admin');
      assert.equal(overridden.time.commercialHoursVariance, 0.25);

      await setup`
        INSERT INTO scheduler_job_hour_overrides (
          id, finance_id, revision, action, source, billable_milliseconds,
          cost_milliseconds, reason, actor_user_id, created_at
        ) VALUES ('solar-legacy-estimate', ${solar.financeId}, 1, 'set',
          'legacy_estimate', 7200000, 7200000, 'Legacy estimate', 'migration:0033', now())
      `;
      const unconfirmedLegacyDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { includeLabour: true },
      );
      assert.deepEqual(unconfirmedLegacyDraft.lines.map((line) => line.kind), ['labour']);
      await assert.rejects(
        service.issueSchedulerInvoiceByFinanceId(
          admin,
          solar.financeId,
          unconfirmedLegacyDraft.id,
        ),
        appErrorDetailIncludes('Confirm or replace migrated legacy hours'),
      );
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        unconfirmedLegacyDraft.id,
      );
      const confirmed = await service.updateSchedulerFinanceById(admin, solar.financeId, {
        billableHoursOverride: 2,
        costHoursOverride: 2,
        overrideReason: 'Confirmed against paper timesheet',
      });
      assert.equal(confirmed.time.overrideSource, 'admin');
      assert.equal(confirmed.time.needsHoursReview, false);
      assert.equal((await setup<{ revision: number }[]>`
        SELECT max(revision) AS revision FROM scheduler_job_hour_overrides
        WHERE finance_id = ${solar.financeId}
      `)[0]?.revision, 2);

      await assert.rejects(
        service.updateSchedulerFinanceById(admin, field.financeId, {
          pricingMode: 'quoted', quotedAmount: null,
        }),
        appErrorDetailIncludes('quotedAmount is required'),
      );
      await assert.rejects(
        service.getSchedulerFinancialSummary(inspector, 'eco-event-1'),
        appErrorDetailIncludes('Only global administrators'),
      );

      const fieldExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        field.financeId,
        {
          kind: 'supplier_bill',
          category: 'materials',
          description: 'Switchboard hardware',
          vendor: 'Parts Co',
          reference: 'BILL-7',
          costAmount: 200,
          billableAmount: 250,
          billable: true,
          incurredAt: '2026-08-23T00:00:00.000Z',
        },
      );
      await assert.rejects(
        service.updateSchedulerFinanceById(admin, field.financeId, { currency: 'USD' }),
        appErrorDetailIncludes('Currency cannot change after an expense or invoice exists'),
      );
      const fieldDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        field.financeId,
        { expenseIds: [fieldExpense.id], includeLabour: true },
      );
      assert.deepEqual(fieldDraft.lines.map((line) => line.kind), ['labour', 'expense']);
      await assert.rejects(
        service.createQuickSchedulerInvoiceByFinanceId(
          admin,
          field.financeId,
          { expenseIds: [fieldExpense.id], includeLabour: false },
        ),
        appErrorDetailIncludes('already reserved'),
      );
      const draftEdited = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldDraft.id,
        {
          expectedUpdatedAt: fieldDraft.updatedAt,
          billToName: 'Legal Field Client Pty Ltd',
          billToAddress: 'Billing Office, Sydney',
          billToEmail: 'accounts@example.test',
          purchaseOrderReference: 'PO-123',
        },
      );
      assert.equal(draftEdited.billToName, 'Legal Field Client Pty Ltd');
      assert.ok(new Date(draftEdited.updatedAt) > new Date(fieldDraft.updatedAt));
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldDraft.id,
          { expectedUpdatedAt: fieldDraft.updatedAt, notes: 'Stale overwrite' },
        ),
        appErrorDetailIncludes('Invoice changed; refresh before continuing'),
      );
      const priorDueDate = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldDraft.id,
        { expectedUpdatedAt: draftEdited.updatedAt, dueDate: '2020-01-01' },
      );
      await assert.rejects(
        service.issueSchedulerInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldDraft.id,
          priorDueDate.updatedAt,
        ),
        appErrorDetailIncludes('Invoice due date cannot be before its issue date'),
      );
      const dueToday = new Date().toISOString().slice(0, 10);
      const dueTodayDraft = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldDraft.id,
        { expectedUpdatedAt: priorDueDate.updatedAt, dueDate: dueToday },
      );
      await setup`UPDATE ih_installations SET site_name = 'Field Factory Updated' WHERE id = 'field-job'`;
      const fieldIssued = await service.issueSchedulerInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldDraft.id,
        dueTodayDraft.updatedAt,
      );
      assert.equal(fieldIssued.job.jobName, 'Field Factory Updated');
      assert.equal(fieldIssued.billToName, 'Legal Field Client Pty Ltd');
      assert.ok(fieldIssued.dueDate);
      assert.equal(fieldIssued.overdue, false);
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldIssued.id,
          { notes: 'Must not mutate' },
        ),
        appErrorDetailIncludes('Only draft invoices'),
      );
      await assert.rejects(
        service.markSchedulerInvoicePaidByFinanceId(
          admin,
          field.financeId,
          fieldIssued.id,
          '2020-01-01T00:00:00.000Z',
        ),
        appErrorDetailIncludes('paidAt cannot be before the invoice was issued'),
      );
      assert.ok(fieldIssued.issuedAt);
      const paidAtValue = fieldIssued.issuedAt;
      const paid = await service.markSchedulerInvoicePaidByFinanceId(
        admin,
        field.financeId,
        fieldIssued.id,
        paidAtValue,
      );
      assert.equal(paid.status, 'paid');
      assert.equal(paid.paidAt, paidAtValue);
      await assert.rejects(
        service.voidSchedulerInvoiceByFinanceId(admin, field.financeId, paid.id),
        appErrorDetailIncludes('Paid invoices cannot be voided'),
      );

      const solarExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        solar.financeId,
        {
          kind: 'expense', category: 'travel', description: 'Travel',
          costAmount: 50, billableAmount: 75, billable: true,
        },
      );
      await service.updateSchedulerFinanceById(admin, solar.financeId, {
        pricingMode: 'quoted', quotedAmount: 1000,
      });
      const solarDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { expenseIds: [solarExpense.id] },
      );
      assert.deepEqual(solarDraft.lines.map((line) => line.kind), ['quoted', 'expense']);
      await assert.rejects(
        service.updateSchedulerFinanceById(admin, solar.financeId, { quotedAmount: 999 }),
        appErrorDetailIncludes('Quoted amount cannot be less than reserved invoice value'),
      );
      await assert.rejects(
        service.updateSchedulerFinanceById(admin, solar.financeId, {
          pricingMode: 'charge_up',
        }),
        appErrorDetailIncludes('Pricing mode cannot change while a non-void invoice exists'),
      );
      await service.voidSchedulerInvoiceByFinanceId(admin, solar.financeId, solarDraft.id);
      const solarReplacement = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { expenseIds: [solarExpense.id] },
      );
      assert.notEqual(solarReplacement.invoiceNumber, solarDraft.invoiceNumber);

      const ecoExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        eco.financeId,
        {
          kind: 'expense', category: 'other', description: 'Eco consumables',
          costAmount: 10, billableAmount: 20, billable: true,
        },
      );
      const unscheduled = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'ecoaudit', sourceType: 'audit', sourceId: 'eco-unscheduled',
      });
      const unscheduledUsd = await service.updateSchedulerFinanceById(
        admin,
        unscheduled.financeId,
        { currency: 'usd' },
      );
      assert.equal(unscheduledUsd.currency, 'USD');
      const unscheduledExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        unscheduled.financeId,
        {
          kind: 'expense', category: 'other', description: 'Unscheduled consumables',
          costAmount: 5, billableAmount: 10, billable: true,
        },
      );
      const [ecoConcurrent, unscheduledConcurrent] = await Promise.all([
        service.createQuickSchedulerInvoiceByFinanceId(admin, eco.financeId, {
          expenseIds: [ecoExpense.id], includeLabour: false,
        }),
        service.createQuickSchedulerInvoiceByFinanceId(admin, unscheduled.financeId, {
          includeLabour: false,
          expenseIds: [unscheduledExpense.id],
        }),
      ]);
      assert.ok(ecoConcurrent.invoiceNumber);
      assert.notEqual(ecoConcurrent.invoiceNumber, unscheduledConcurrent.invoiceNumber);
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          unscheduled.financeId,
          unscheduledConcurrent.id,
          {
            lines: [{
              kind: 'other', description: 'Too precise', quantity: 0.00001,
              unitAmountExGst: 10,
            }],
          },
        ),
        appErrorDetailIncludes('quantity must be at least 0.0001'),
      );
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          unscheduled.financeId,
          unscheduledConcurrent.id,
          {
            lines: [1, 2, 3].map((ordinal) => ({
              kind: 'other' as const,
              description: `Unsafe aggregate ${ordinal}`,
              quantity: 1,
              unitAmountExGst: 45_000_000_000_000,
            })),
          },
        ),
        appErrorDetailIncludes('Invoice subtotal is too large'),
      );
      const normalizedQuantity = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        {
          lines: [{
            kind: 'other', description: 'Normalized quantity', quantity: 1.23456,
            unitAmountExGst: 10,
          }],
        },
      );
      assert.equal(normalizedQuantity.lines[0]?.quantity, 1.2346);
      assert.equal(normalizedQuantity.lines[0]?.lineTotalExGst, 12.35);
      assert.equal(normalizedQuantity.subtotalExGst, 12.35);

      const overflowExpenseA = await service.createSchedulerExpenseByFinanceId(
        admin,
        unscheduled.financeId,
        {
          kind: 'expense', category: 'other', description: 'Overflow fixture A',
          costAmount: 1, billableAmount: 1, billable: true,
        },
      );
      const overflowExpenseB = await service.createSchedulerExpenseByFinanceId(
        admin,
        unscheduled.financeId,
        {
          kind: 'expense', category: 'other', description: 'Overflow fixture B',
          costAmount: 1, billableAmount: 1, billable: true,
        },
      );
      const overflowDraftA = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        { includeLabour: false, expenseIds: [overflowExpenseA.id] },
      );
      const overflowDraftB = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        { includeLabour: false, expenseIds: [overflowExpenseB.id] },
      );
      await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        overflowDraftA.id,
        {
          expectedUpdatedAt: overflowDraftA.updatedAt,
          lines: [{
            kind: 'quoted', description: 'Safe single reservation', quantity: 1,
            unitAmountExGst: 50_000_000_000_000,
          }],
        },
      );
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          unscheduled.financeId,
          overflowDraftB.id,
          {
            expectedUpdatedAt: overflowDraftB.updatedAt,
            lines: [{
              kind: 'quoted', description: 'Unsafe aggregate reservation', quantity: 1,
              unitAmountExGst: 50_000_000_000_000,
            }],
          },
        ),
        appErrorDetailIncludes('Reserved quote value exceeds the supported accounting range'),
      );

      const oldCostCount = Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM ih_job_cost_lines WHERE installation_id = 'field-job'
      `)[0]!.count);
      const legacyLine = await legacyFinance.createCostLine(admin, 'field-job', {
        category: 'material', description: 'Legacy endpoint item', costAmount: 25,
        sellAmount: 30, billable: true,
      });
      assert.equal(Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM ih_job_cost_lines WHERE installation_id = 'field-job'
      `)[0]!.count), oldCostCount);
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_job_expenses WHERE id = ${legacyLine.id}
      `)[0]?.count, '1');
      const oldInvoiceCount = Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM ih_invoices WHERE installation_id = 'field-job'
      `)[0]!.count);
      const legacyDraft = await legacyInvoices.quickCreateInvoice(admin, 'field-job', {
        costLineIds: [legacyLine.id],
      });
      assert.equal(Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM ih_invoices WHERE installation_id = 'field-job'
      `)[0]!.count), oldInvoiceCount);
      assert.equal(legacyDraft.lines[0]?.costLineId, legacyLine.id);

      await assert.rejects(
        purgeInstallHubInstallationTree('field-job'),
        appErrorDetailIncludes('installation_commercial_history_purge_blocked'),
      );

      const expensePurge = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'installhub', sourceType: 'installation', sourceId: 'field-expense-purge',
      });
      const purgeExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        expensePurge.financeId,
        {
        kind: 'expense', category: 'materials', description: 'Retained accounting evidence',
        costAmount: 20, billableAmount: 25, billable: true,
        },
      );
      await assert.rejects(
        purgeInstallHubInstallationTree('field-expense-purge'),
        appErrorDetailIncludes('installation_commercial_history_purge_blocked'),
      );
      await service.deleteSchedulerExpenseByFinanceId(
        admin,
        expensePurge.financeId,
        purgeExpense.id,
      );
      await assert.rejects(
        purgeInstallHubInstallationTree('field-expense-purge'),
        appErrorDetailIncludes('installation_commercial_history_purge_blocked'),
      );

      const deletedLedger = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'installhub', sourceType: 'installation', sourceId: 'field-deleted-ledger',
      });
      await service.updateSchedulerFinanceById(admin, deletedLedger.financeId, {
        billableHoursOverride: 1.25,
        costHoursOverride: 1,
        overrideReason: 'Historical ledger evidence',
      });
      await service.createSchedulerExpenseByFinanceId(admin, deletedLedger.financeId, {
        kind: 'expense', category: 'other', description: 'Historical retained expense',
        costAmount: 10, billableAmount: 12, billable: true,
      });
      await setup`DELETE FROM ih_installations WHERE id = 'field-deleted-ledger'`;
      const retainedDeletedLedger = await service.getSchedulerFinancialSummaryById(
        admin,
        deletedLedger.financeId,
      );
      assert.equal(retainedDeletedLedger.job.status, 'Deleted');
      assert.match(retainedDeletedLedger.job.jobName, /field-deleted-ledger/);
      assert.equal(retainedDeletedLedger.time.billableHours, 1.25);
      assert.equal(retainedDeletedLedger.expenses.length, 1);

      const emptyPurge = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'installhub', sourceType: 'installation', sourceId: 'field-empty-purge',
      });
      await purgeInstallHubInstallationTree('field-empty-purge');
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM ih_installations WHERE id = 'field-empty-purge'
      `)[0]?.count, '0');
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_job_finance WHERE id = ${emptyPurge.financeId}
      `)[0]?.count, '0');
    } finally {
      await closeDb();
    }
  } finally {
    await setup.end({ timeout: 5 });
  }
});
