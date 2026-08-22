import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_FINANCE_PG_INTEGRATION_URL;
if (integrationDatabase) {
  // Exercise UTC-date accounting while the application connection is on the
  // opposite calendar day. The setup connection intentionally keeps the
  // server default zone.
  const applicationDatabaseUrl = new URL(integrationDatabase);
  applicationDatabaseUrl.searchParams.set('options', '-c TimeZone=Pacific/Kiritimati');
  process.env.DATABASE_URL = applicationDatabaseUrl.toString();
}
process.env.SCHEDULER_INVOICE_SELLER_ABN ??= '12 345 678 901';

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
    await setup.unsafe(`SET TIME ZONE 'Pacific/Kiritimati'`);

    await setup.unsafe(`
      INSERT INTO global_users (
        id, login_key, field_user_id, primary_origin_app, primary_origin_user_id,
        display_email, full_name, role, is_active, billing_rate_cents
      ) VALUES
        ('admin-global', 'admin@example.test', 'admin-field', 'ecoaudit', 'admin-eco',
         'admin@example.test', 'Global Admin', 'admin', true, NULL),
        ('worker-global', 'worker@example.test', 'worker-field', 'ecoaudit', 'worker-eco',
         'worker@example.test', 'Recorded Worker', 'inspector', true, 15000)
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
         'Worker', '2026-08-26', 'Draft', 'worker-installhub', '2026-08-01'),
        ('field-event-purge', 'Event Client', 'Event Field Job', '8 Field Road',
         'Worker', '2026-08-27', 'Draft', 'worker-installhub', '2026-08-01'),
        ('field-edited-purge', 'Edited Client', 'Edited Field Job', '9 Field Road',
         'Worker', '2026-08-28', 'Draft', 'worker-installhub', '2026-08-01')
    `);
    await setup.unsafe(`
      INSERT INTO ea_audit_work_sessions (
        id, audit_id, actor_user_id, started_at, last_active_at, ended_at,
        active_milliseconds, revision
      ) VALUES
        ('eco-session-1', 'eco-job', 'worker-eco', '2026-08-20 09:00',
         '2026-08-20 10:15', '2026-08-20 10:15', 3600000, 1),
        ('eco-session-2', 'eco-job', 'worker-eco', '2026-08-20 10:30',
         '2026-08-20 11:00', '2026-08-20 11:00', 1800000, 1)
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
        ('solar-event', 'Solar visit', 'solarsense', 'assessment', 'solar-job', 'worker-field',
         '2026-08-22 09:00', '2026-08-22 12:00', '2026-08-22 17:00', 'planned',
         'admin-eco', 'ecoaudit'),
        ('field-event', 'Field visit', 'installhub', 'installation', 'field-job', 'worker-field',
         '2026-08-23 09:00', '2026-08-23 13:00', '2026-08-23 17:00', 'planned',
         'admin-eco', 'ecoaudit'),
        ('field-purge-event', 'Retained Field visit', 'installhub', 'installation',
         'field-event-purge', 'worker-field', '2026-08-27 09:00', '2026-08-27 10:00',
         '2026-08-27 17:00', 'planned',
         'admin-eco', 'ecoaudit')
    `);

    const service = await import('./schedulerFinanceService.js');
    const analyticsService = await import('./schedulerAnalyticsService.js');
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
      assert.equal(eco.time.scheduledHours, 2);
      assert.equal(eco.time.hoursVariance, -0.5);
      assert.deepEqual(eco.time.actors, [{
        userId: 'worker-global',
        displayName: 'Recorded Worker',
        activeMilliseconds: 5_400_000,
        hours: 1.5,
        billingRate: 150,
        labourAmount: 225,
        billingRateEditable: true,
      }]);
      assert.equal(eco.time.billableHours, 0);
      assert.equal(solar.time.actualHours, 2);
      assert.equal(field.time.actualHours, 3);
      assert.equal(eco.invoiceReadiness.completionSatisfied, false);
      assert.equal(eco.invoiceReadiness.hoursSatisfied, true);
      assert.equal(eco.invoiceReadiness.ready, false);

      const analytics = await analyticsService.getSchedulerAnalytics(admin, {
        from: '2026-08-20',
        to: '2026-08-23',
        timezone: 'UTC',
      });
      const workerAnalytics = analytics.leaderboard.find(
        (row) => row.userId === 'worker-global',
      );
      assert.ok(workerAnalytics);
      assert.equal(analytics.quality.sessions.included, 4);
      assert.equal(workerAnalytics.workingHoursOnSiteMilliseconds, 23_400_000);
      assert.equal(workerAnalytics.workingHoursOnSite, 6.5);

      const incompleteEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [eco.financeId, solar.financeId, field.financeId],
      );
      assert.equal(incompleteEligibility.eligible, false);
      assert.deepEqual(
        incompleteEligibility.issues
          .filter((issue) => issue.code === 'job_not_completed')
          .map((issue) => issue.financeId)
          .sort(),
        [eco.financeId, field.financeId, solar.financeId].sort(),
      );
      for (const summary of [eco, solar, field]) {
        await assert.rejects(
          service.createQuickSchedulerInvoiceByFinanceId(admin, summary.financeId, {
            includeLabour: true,
          }),
          appErrorDetailIncludes('complete before generating an invoice'),
        );
      }

      await setup.unsafe(`
        UPDATE ea_audits
        SET status = 'Completed', completed_at = now()
        WHERE id = 'eco-job';
        UPDATE ih_installations
        SET status = 'Completed', completed_at = now()
        WHERE id = 'field-job';
        UPDATE ss_rooftop_assessments
        SET status = 'Completed', completed_at = now()
        WHERE id = 'solar-job';
      `);
      // Current lifecycle code records immutable completion facts in the same
      // transaction as the first completion. Seed that evidence before this
      // finance-focused test exercises supported reopen/recomplete states.
      await setup.unsafe(`
        INSERT INTO scheduler_job_completion_facts (
          id, source_app, source_type, source_id, completed_at,
          primary_global_user_id, assignee_field_user_id,
          assignee_display_name, attribution_source
        )
        SELECT 'eco-completion-fact', 'ecoaudit', 'audit', id, completed_at,
          'worker-global', 'worker-field', 'Recorded Worker', 'product_assignment'
        FROM ea_audits WHERE id = 'eco-job'
        UNION ALL
        SELECT 'solar-completion-fact', 'solarsense', 'assessment', id, completed_at,
          'worker-global', 'worker-field', 'Recorded Worker', 'product_assignment'
        FROM ss_rooftop_assessments WHERE id = 'solar-job'
        UNION ALL
        SELECT 'field-completion-fact', 'installhub', 'installation', id, completed_at,
          'worker-global', 'worker-field', 'Recorded Worker', 'product_assignment'
        FROM ih_installations WHERE id = 'field-job'
      `);
      const [completedEco, completedSolar, completedField] = await Promise.all([
        service.getSchedulerFinancialSummaryById(admin, eco.financeId),
        service.getSchedulerFinancialSummaryById(admin, solar.financeId),
        service.getSchedulerFinancialSummaryById(admin, field.financeId),
      ]);
      assert.deepEqual(completedEco.invoiceReadiness, {
        completionSatisfied: true,
        completionBasis: 'job',
        hoursSatisfied: true,
        hoursBasis: 'app_time',
        ready: true,
      });
      assert.equal(completedSolar.job.status, 'Completed');
      assert.equal(completedSolar.invoiceReadiness.completionBasis, 'job');
      assert.equal(completedSolar.invoiceReadiness.ready, true);
      assert.equal(completedField.invoiceReadiness.completionBasis, 'job');

      const overview = await service.listSchedulerFinanceOverview(admin, { limit: 100 });
      assert.equal(overview.items.some((item) => (
        item.sourceId === 'eco-unscheduled' && item.eventId === null
      )), true);
      assert.equal(overview.items.every((item) => typeof item.currency === 'string'), true);
      assert.equal(
        overview.items.find((item) => item.sourceId === 'solar-job')
          ?.invoiceReadiness.completionBasis,
        'job',
      );

      const incomplete = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: 'field-empty-purge',
      });
      const incompleteJobEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [incomplete.financeId],
      );
      assert.equal(incompleteJobEligibility.eligible, false);
      assert.equal(
        incompleteJobEligibility.issues.some((issue) => issue.code === 'job_not_completed'),
        true,
      );
      await assert.rejects(
        service.createQuickSchedulerInvoiceByFinanceId(
          admin,
          incomplete.financeId,
          { includeLabour: false },
        ),
        appErrorDetailIncludes('must be completed before an invoice can be generated'),
      );

      await assert.rejects(
        service.updateSchedulerFinanceById(admin, eco.financeId, {
          billableHoursOverride: 1.25,
          overrideReason: 'Fractional billing hours must not be stored',
        }),
        appErrorDetailIncludes('billableHoursOverride must be a nonnegative integer'),
      );

      const overridden = await service.updateSchedulerFinanceById(admin, eco.financeId, {
        billableHoursOverride: 2,
        costHoursOverride: 1.75,
        overrideReason: 'Approved after timesheet review',
        costRate: 80,
      });
      assert.equal(overridden.time.billableHours, 2);
      assert.equal(overridden.time.actualHours, 1.5);
      assert.equal(overridden.time.overrideSource, 'admin');
      assert.equal(overridden.time.commercialHoursVariance, 0.25);
      assert.equal(overridden.time.billableRate, 150);

      await setup`
        INSERT INTO scheduler_job_hour_overrides (
          id, finance_id, revision, action, source, billable_milliseconds,
          cost_milliseconds, reason, actor_user_id, created_at
        ) VALUES ('solar-legacy-estimate', ${solar.financeId}, 1, 'set',
          'legacy_estimate', 7200000, 7200000, 'Legacy estimate', 'migration:0033', now())
      `;
      const legacyEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [solar.financeId],
      );
      assert.equal(legacyEligibility.eligible, true);
      assert.equal(legacyEligibility.jobs[0]?.invoiceReadiness.hoursSatisfied, false);
      assert.deepEqual(legacyEligibility.issues, []);
      const legacyHoursDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { includeLabour: true },
      );
      assert.equal(legacyHoursDraft.status, 'draft');
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        legacyHoursDraft.id,
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

      await service.updateSchedulerFinanceById(admin, field.financeId, {
        billableHoursOverride: 3,
        costHoursOverride: 3,
        overrideReason: 'Approved app-recorded time',
      });

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
      assert.equal(fieldDraft.xeroInvoiceNumber, null);
      assert.equal(fieldDraft.xeroDate, null);
      await setup`UPDATE ih_installations SET status = 'Draft' WHERE id = 'field-job'`;
      const reopenedFieldDraft = await service.getSchedulerInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldDraft.id,
      );
      assert.equal(reopenedFieldDraft.jobs[0]?.currentStatus, 'Draft');
      await assert.rejects(
        service.getSchedulerInvoicePdfByFinanceId(admin, field.financeId, fieldDraft.id),
        appErrorDetailIncludes('must be completed before an invoice can be generated'),
      );
      await setup`UPDATE ih_installations SET status = 'Completed' WHERE id = 'field-job'`;
      await assert.rejects(
        service.createQuickSchedulerInvoiceByFinanceId(
          admin,
          field.financeId,
          { expenseIds: [fieldExpense.id], includeLabour: false },
        ),
        appErrorDetailIncludes('already reserved'),
      );
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldDraft.id,
          { expectedUpdatedAt: fieldDraft.updatedAt, xeroDate: '2026-02-30' },
        ),
        appErrorDetailIncludes('xeroDate must be a valid YYYY-MM-DD calendar date'),
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
          xeroInvoiceNumber: 'INV-1001',
          xeroDate: '2026-08-23',
        },
      );
      assert.equal(draftEdited.billToName, 'Legal Field Client Pty Ltd');
      assert.equal(draftEdited.xeroInvoiceNumber, 'INV-1001');
      assert.equal(draftEdited.xeroDate, '2026-08-23');
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
      assert.equal(fieldIssued.xeroInvoiceNumber, 'INV-1001');
      assert.equal(fieldIssued.xeroDate, '2026-08-23');
      assert.ok(fieldIssued.dueDate);
      assert.equal(fieldIssued.issueDate?.slice(0, 10), dueToday);
      assert.equal(fieldIssued.dueDate.slice(0, 10), dueToday);
      assert.ok(fieldIssued.issuedAt);
      assert.ok(new Date(fieldIssued.updatedAt) > new Date(fieldIssued.issuedAt));
      assert.equal(fieldIssued.overdue, false);
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldIssued.id,
          { expectedUpdatedAt: fieldIssued.updatedAt, notes: 'Must not mutate' },
        ),
        appErrorDetailIncludes('Only draft invoice content'),
      );
      const reconciledIssued = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        field.financeId,
        fieldIssued.id,
        {
          expectedUpdatedAt: fieldIssued.updatedAt,
          xeroInvoiceNumber: 'INV-1001-FINAL',
          xeroDate: '2026-08-24',
        },
      );
      assert.equal(reconciledIssued.status, 'issued');
      assert.equal(reconciledIssued.xeroInvoiceNumber, 'INV-1001-FINAL');
      assert.equal(reconciledIssued.xeroDate, '2026-08-24');
      assert.equal(reconciledIssued.notes, fieldIssued.notes);
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          field.financeId,
          fieldIssued.id,
          {
            expectedUpdatedAt: fieldIssued.updatedAt,
            xeroInvoiceNumber: 'STALE-XERO-UPDATE',
          },
        ),
        appErrorDetailIncludes('Invoice changed; refresh before continuing'),
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
        reconciledIssued.updatedAt,
      );
      assert.equal(paid.status, 'paid');
      assert.equal(paid.paidAt, paidAtValue);
      const clearedPaidReconciliation = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        field.financeId,
        paid.id,
        {
          expectedUpdatedAt: paid.updatedAt,
          xeroInvoiceNumber: null,
          xeroDate: null,
        },
      );
      assert.equal(clearedPaidReconciliation.status, 'paid');
      assert.equal(clearedPaidReconciliation.xeroInvoiceNumber, null);
      assert.equal(clearedPaidReconciliation.xeroDate, null);
      await assert.rejects(
        service.voidSchedulerInvoiceByFinanceId(
          admin,
          field.financeId,
          paid.id,
          clearedPaidReconciliation.updatedAt,
        ),
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
      const repricedWhileDraftExists = await service.updateSchedulerFinanceById(
        admin,
        solar.financeId,
        { quotedAmount: 999 },
      );
      assert.equal(repricedWhileDraftExists.pricing.quotedAmount, 999);
      const switchedWhileDraftExists = await service.updateSchedulerFinanceById(
        admin,
        solar.financeId,
        { pricingMode: 'charge_up' },
      );
      assert.equal(switchedWhileDraftExists.pricing.mode, 'charge_up');
      assert.equal(
        (await service.getSchedulerInvoiceByFinanceId(admin, solar.financeId, solarDraft.id))
          .subtotalExGst,
        solarDraft.subtotalExGst,
      );
      const voidedSolar = await service.voidSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        solarDraft.id,
        solarDraft.updatedAt,
      );
      await assert.rejects(
        service.updateSchedulerDraftInvoiceByFinanceId(
          admin,
          solar.financeId,
          solarDraft.id,
          {
            expectedUpdatedAt: voidedSolar.updatedAt,
            xeroInvoiceNumber: 'VOID-MUST-NOT-CHANGE',
          },
        ),
        appErrorDetailIncludes('Void invoices cannot be edited'),
      );
      const solarReplacement = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { expenseIds: [solarExpense.id] },
      );
      assert.notEqual(solarReplacement.invoiceNumber, solarDraft.invoiceNumber);
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        solarReplacement.id,
        solarReplacement.updatedAt,
      );

      const consolidatedEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [eco.financeId, solar.financeId],
      );
      assert.equal(consolidatedEligibility.eligible, true);
      assert.equal(consolidatedEligibility.requiresExplicitBillTo, true);
      assert.equal(consolidatedEligibility.commonCurrency, 'AUD');
      assert.equal(consolidatedEligibility.jobs.length, 2);
      await assert.rejects(
        service.createConsolidatedSchedulerInvoice(admin, {
          jobs: [
            { financeId: eco.financeId, includeLabour: true, expenseIds: [] },
            { financeId: solar.financeId, includeLabour: true, expenseIds: [solarExpense.id] },
          ],
        }),
        appErrorDetailIncludes('explicit billTo snapshot'),
      );
      const editableEmptyJobDraft = await service.createConsolidatedSchedulerInvoice(admin, {
        jobs: [
          { financeId: eco.financeId, includeLabour: true, expenseIds: [] },
          { financeId: solar.financeId, includeLabour: false, expenseIds: [] },
        ],
        billTo: { name: 'Consolidated Client' },
      });
      assert.equal(
        editableEmptyJobDraft.lines.some((line) => line.financeId === solar.financeId),
        false,
      );
      await assert.rejects(
        service.issueConsolidatedSchedulerInvoice(
          admin,
          editableEmptyJobDraft.id,
          editableEmptyJobDraft.updatedAt,
        ),
        appErrorDetailIncludes('Every invoice job must contain a positive-value line'),
      );
      await service.voidConsolidatedSchedulerInvoice(
        admin,
        editableEmptyJobDraft.id,
        editableEmptyJobDraft.updatedAt,
      );
      await assert.rejects(
        service.createConsolidatedSchedulerInvoice(admin, {
          jobs: [
            { financeId: eco.financeId },
            { financeId: eco.financeId },
          ],
          billTo: { name: 'Consolidated Client' },
        }),
        appErrorDetailIncludes('Each financeId can appear only once'),
      );
      const consolidatedDraft = await service.createConsolidatedSchedulerInvoice(admin, {
        jobs: [
          { financeId: eco.financeId, includeLabour: true, expenseIds: [] },
          { financeId: solar.financeId, includeLabour: true, expenseIds: [solarExpense.id] },
        ],
        billTo: {
          name: 'Consolidated Client Pty Ltd',
          abn: '12 345 678 901',
          address: '10 Billing Street',
          email: 'accounts@consolidated.example',
          purchaseOrderReference: 'GROUP-PO-1',
        },
      });
      assert.equal(consolidatedDraft.jobs.length, 2);
      assert.equal(consolidatedDraft.billToAbn, '12 345 678 901');
      assert.equal(consolidatedDraft.lines.every((line) => Boolean(line.financeId)), true);
      assert.equal(
        (await service.getSchedulerInvoiceByFinanceId(
          admin,
          solar.financeId,
          consolidatedDraft.id,
        )).id,
        consolidatedDraft.id,
      );
      assert.equal(
        (await service.listSchedulerInvoicesByFinanceId(admin, solar.financeId))
          .some((invoice) => invoice.id === consolidatedDraft.id && invoice.jobCount === 2),
        true,
      );
      assert.equal(
        (await service.updateSchedulerFinanceById(
          admin,
          solar.financeId,
          { quotedAmount: 1100 },
        )).pricing.quotedAmount,
        1100,
      );
      await assert.rejects(
        service.voidConsolidatedSchedulerInvoice(
          admin,
          consolidatedDraft.id,
          '2020-01-01T00:00:00.000Z',
        ),
        appErrorDetailIncludes('Invoice changed; refresh before continuing'),
      );
      const consolidatedHeader = await service.updateConsolidatedSchedulerDraftInvoice(
        admin,
        consolidatedDraft.id,
        {
          expectedUpdatedAt: consolidatedDraft.updatedAt,
          notes: 'Two-job invoice',
        },
      );
      const consolidatedVoided = await service.voidConsolidatedSchedulerInvoice(
        admin,
        consolidatedDraft.id,
        consolidatedHeader.updatedAt,
      );
      assert.equal(consolidatedVoided.status, 'void');

      const consolidatedRecreated = await service.createConsolidatedSchedulerInvoice(admin, {
        jobs: [
          { financeId: eco.financeId, includeLabour: true, expenseIds: [] },
          { financeId: solar.financeId, includeLabour: true, expenseIds: [solarExpense.id] },
        ],
        billTo: { name: 'Consolidated Client Pty Ltd', address: '10 Billing Street' },
      });
      const consolidatedIssued = await service.issueConsolidatedSchedulerInvoice(
        admin,
        consolidatedRecreated.id,
        consolidatedRecreated.updatedAt,
      );
      assert.equal(consolidatedIssued.status, 'issued');
      assert.equal(consolidatedIssued.jobs.length, 2);
      await setup`UPDATE ea_audits SET status = 'Draft', completed_at = null WHERE id = 'eco-job'`;
      const immutableIssuedSnapshot = await service.loadSchedulerInvoiceExportSnapshot(
        admin,
        null,
        consolidatedIssued.id,
        consolidatedIssued.updatedAt,
      );
      assert.equal(immutableIssuedSnapshot.status, 'issued');
      await setup`UPDATE ea_audits SET status = 'Completed', completed_at = now() WHERE id = 'eco-job'`;
      const consolidatedPaid = await service.markConsolidatedSchedulerInvoicePaid(
        admin,
        consolidatedIssued.id,
        consolidatedIssued.issuedAt,
        consolidatedIssued.updatedAt,
      );
      assert.equal(consolidatedPaid.status, 'paid');
      const consolidatedPortfolio = await service.listSchedulerInvoicePortfolio(admin, {
        limit: 10,
        search: 'Consolidated Client Pty Ltd',
      });
      const paidPortfolioInvoice = consolidatedPortfolio.items.find(
        (invoice) => invoice.id === consolidatedPaid.id,
      );
      assert.equal(paidPortfolioInvoice?.status, 'paid');
      assert.equal(paidPortfolioInvoice?.financeIds.includes(eco.financeId), true);
      assert.equal(paidPortfolioInvoice?.financeIds.includes(solar.financeId), true);
      await assert.rejects(
        service.voidConsolidatedSchedulerInvoice(
          admin,
          consolidatedPaid.id,
          consolidatedPaid.updatedAt,
        ),
        appErrorDetailIncludes('Paid invoices cannot be voided'),
      );
      await assert.rejects(
        service.uploadSchedulerExpenseAttachment(admin, solarExpense.id, {
          filename: 'paid-bill.pdf',
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        }),
        appErrorDetailIncludes('Attachments cannot be added after an expense is invoiced'),
      );

      const attachmentExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        eco.financeId,
        {
          kind: 'supplier_bill',
          category: 'materials',
          description: 'Attachment lifecycle fixture',
          vendor: 'Evidence Co',
          costAmount: 25,
          billableAmount: 30,
          billable: true,
        },
      );
      await assert.rejects(
        service.uploadSchedulerExpenseAttachment(inspector, attachmentExpense.id, {
          filename: 'inspector.pdf',
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        }),
        appErrorDetailIncludes('Only global administrators'),
      );
      await assert.rejects(
        service.uploadSchedulerExpenseAttachment(admin, attachmentExpense.id, {
          filename: 'mismatch.png',
          contentType: 'image/png',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        }),
        appErrorDetailIncludes('content type does not match'),
      );
      const attachment = await service.uploadSchedulerExpenseAttachment(
        admin,
        attachmentExpense.id,
        {
          filename: '../supplier-bill.pdf',
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        },
      );
      assert.equal(attachment.filename, 'supplier-bill.pdf');
      assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
      const downloaded = await service.downloadSchedulerExpenseAttachment(
        admin,
        attachmentExpense.id,
        attachment.id,
      );
      const downloadedChunks: Buffer[] = [];
      for await (const chunk of downloaded.stream) downloadedChunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(downloadedChunks).toString('utf8'), '%PDF-1.4\n%%EOF');
      await service.deleteSchedulerExpenseAttachment(
        admin,
        attachmentExpense.id,
        attachment.id,
      );
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_expense_attachments
        WHERE id = ${attachment.id}
      `)[0]?.count, '0');

      const ambiguousExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        eco.financeId,
        {
          kind: 'supplier_bill', category: 'other', description: 'Ambiguous confirm fixture',
          costAmount: 5, billableAmount: 6, billable: true,
        },
      );
      await assert.rejects(
        service.uploadSchedulerExpenseAttachment(
          admin,
          ambiguousExpense.id,
          {
            filename: 'confirmed-before-ack.pdf',
            contentType: 'application/pdf',
            body: Buffer.from('%PDF-1.4\n%%EOF'),
          },
          {
            afterConfirmationCommitted: async () => {
              throw new Error('simulated confirmation acknowledgement failure');
            },
            beforeFailureInspection: async () => {
              throw new Error('simulated confirmation status read failure');
            },
          },
        ),
        /simulated confirmation acknowledgement failure/,
      );
      const [survivingConfirmed] = await setup<{ id: string; status: string }[]>`
        SELECT id, status FROM scheduler_expense_attachments
        WHERE expense_id = ${ambiguousExpense.id}
      `;
      assert.equal(survivingConfirmed?.status, 'confirmed');
      await service.deleteSchedulerExpenseAttachment(
        admin,
        ambiguousExpense.id,
        survivingConfirmed!.id,
      );

      const uploadRaceExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        eco.financeId,
        {
          kind: 'expense', category: 'other', description: 'Upload reservation race',
          costAmount: 8, billableAmount: 9, billable: true,
        },
      );
      let signalPending!: () => void;
      let releaseUpload!: () => void;
      const pendingPersisted = new Promise<void>((resolve) => { signalPending = resolve; });
      const uploadRelease = new Promise<void>((resolve) => { releaseUpload = resolve; });
      const racingUpload = service.uploadSchedulerExpenseAttachment(
        admin,
        uploadRaceExpense.id,
        {
          filename: 'racing-upload.pdf',
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        },
        {
          afterPendingPersisted: async () => {
            signalPending();
            await uploadRelease;
          },
        },
      );
      await pendingPersisted;
      const raceDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        eco.financeId,
        { includeLabour: false, expenseIds: [uploadRaceExpense.id] },
      );
      releaseUpload();
      const confirmedRacingUpload = await racingUpload;
      assert.equal(confirmedRacingUpload.expenseId, uploadRaceExpense.id);
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_expense_attachments
        WHERE expense_id = ${uploadRaceExpense.id} AND status = 'confirmed'
      `)[0]?.count, '1');
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        eco.financeId,
        raceDraft.id,
        raceDraft.updatedAt,
      );
      const abnGateDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        eco.financeId,
        { includeLabour: false, expenseIds: [uploadRaceExpense.id] },
      );
      const runtimeConfig = (await import('../config.js')).config;
      const configuredSellerAbn = runtimeConfig.schedulerInvoice.sellerAbn;
      (runtimeConfig.schedulerInvoice as { sellerAbn: string }).sellerAbn = '';
      try {
        await assert.rejects(
          service.issueSchedulerInvoiceByFinanceId(
            admin,
            eco.financeId,
            abnGateDraft.id,
            abnGateDraft.updatedAt,
          ),
          appErrorDetailIncludes('seller ABN'),
        );
      } finally {
        (runtimeConfig.schedulerInvoice as { sellerAbn: string }).sellerAbn = configuredSellerAbn;
      }
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        eco.financeId,
        abnGateDraft.id,
        abnGateDraft.updatedAt,
      );

      const attachmentForExpenseDelete = await service.uploadSchedulerExpenseAttachment(
        admin,
        attachmentExpense.id,
        {
          filename: 'delete-with-expense.pdf',
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%%EOF'),
        },
      );
      await service.deleteSchedulerExpenseByFinanceId(
        admin,
        eco.financeId,
        attachmentExpense.id,
      );
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_expense_attachments
        WHERE id = ${attachmentForExpenseDelete.id}
      `)[0]?.count, '0');

      await setup`
        INSERT INTO scheduler_expense_attachments (
          id, expense_id, status, filename, content_type, size_bytes, storage_key,
          created_by_user_id, created_at
        ) VALUES (
          'stale-pending-attachment', ${attachmentExpense.id}, 'pending', 'stale.pdf',
          'application/pdf', 10, 'ecoaudit/eco-job/stale-pending.pdf',
          'admin-global', now() - interval '2 hours'
        )
      `;
      assert.equal(await service.reconcilePendingSchedulerExpenseAttachments(), 1);
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_expense_attachments
        WHERE id = 'stale-pending-attachment'
      `)[0]?.count, '0');

      await setup`
        INSERT INTO scheduler_expense_attachments (
          id, expense_id, status, filename, content_type, size_bytes, storage_key,
          created_by_user_id, created_at
        ) VALUES (
          'fresh-pending-attachment', ${attachmentExpense.id}, 'pending', 'fresh.pdf',
          'application/pdf', 10, 'ecoaudit/eco-job/fresh-pending.pdf',
          'admin-global', now()
        )
      `;
      assert.equal(await service.reconcilePendingSchedulerExpenseAttachments(), 0);
      assert.equal((await setup<{ count: string }[]>`
        SELECT count(*) AS count FROM scheduler_expense_attachments
        WHERE id = 'fresh-pending-attachment'
      `)[0]?.count, '1');
      assert.equal(await service.reconcilePendingSchedulerExpenseAttachments({
        now: new Date(Date.now() + 2 * 60 * 60 * 1_000),
      }), 1);

      await setup`
        INSERT INTO scheduler_expense_attachments (
          id, expense_id, status, filename, content_type, size_bytes, storage_key,
          created_by_user_id, created_at
        ) VALUES (
          'confirm-during-sweep', ${attachmentExpense.id}, 'pending', 'confirm.pdf',
          'application/pdf', 10, 'ecoaudit/eco-job/confirm-during-sweep.pdf',
          'admin-global', now() - interval '2 hours'
        )
      `;
      let signalSweepCandidate!: () => void;
      let releaseSweep!: () => void;
      const sweepCandidateSelected = new Promise<void>((resolve) => {
        signalSweepCandidate = resolve;
      });
      const sweepRelease = new Promise<void>((resolve) => { releaseSweep = resolve; });
      const racingSweep = service.reconcilePendingSchedulerExpenseAttachments({
        afterCandidateSelected: async (attachmentId) => {
          if (attachmentId !== 'confirm-during-sweep') return;
          signalSweepCandidate();
          await sweepRelease;
        },
      });
      await sweepCandidateSelected;
      await setup`
        UPDATE scheduler_expense_attachments
        SET status = 'confirmed', confirmed_at = now(), sha256 = ${'a'.repeat(64)}
        WHERE id = 'confirm-during-sweep'
      `;
      releaseSweep();
      assert.equal(await racingSweep, 0);
      assert.equal((await setup<{ status: string }[]>`
        SELECT status FROM scheduler_expense_attachments
        WHERE id = 'confirm-during-sweep'
      `)[0]?.status, 'confirmed');
      await setup`DELETE FROM scheduler_expense_attachments WHERE id = 'confirm-during-sweep'`;

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
      assert.equal(unscheduled.time.actors[0]?.userId, 'worker-global');
      assert.equal(unscheduled.time.actors[0]?.billingRate, 150);
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
      const mixedEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [eco.financeId, unscheduled.financeId],
      );
      assert.equal(mixedEligibility.eligible, false);
      assert.equal(mixedEligibility.issues.some((issue) => issue.code === 'mixed_currency'), true);
      await assert.rejects(
        service.createConsolidatedSchedulerInvoice(admin, {
          jobs: [
            { financeId: eco.financeId },
            { financeId: unscheduled.financeId },
          ],
          billTo: { name: 'Mixed Currency Client' },
        }),
        appErrorDetailIncludes('same currency'),
      );
      await setup`
        UPDATE ea_audits
        SET status = 'Completed', completed_at = now()
        WHERE id = 'eco-unscheduled'
      `;
      const missingTime = await service.getSchedulerFinancialSummaryById(
        admin,
        unscheduled.financeId,
      );
      assert.deepEqual(missingTime.invoiceReadiness, {
        completionSatisfied: true,
        completionBasis: 'job',
        hoursSatisfied: false,
        hoursBasis: null,
        ready: true,
      });
      const missingTimeEligibility = await service.getConsolidatedInvoiceEligibility(
        admin,
        [unscheduled.financeId],
      );
      assert.equal(missingTimeEligibility.eligible, true);
      assert.deepEqual(missingTimeEligibility.issues, []);
      const unreviewedHoursDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        {
          includeLabour: false,
          expenseIds: [unscheduledExpense.id],
        },
      );
      assert.equal(unreviewedHoursDraft.status, 'draft');
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unreviewedHoursDraft.id,
      );
      const zeroHoursReviewed = await service.updateSchedulerFinanceById(
        admin,
        unscheduled.financeId,
        {
          billableHoursOverride: 0,
          costHoursOverride: 0,
          overrideReason: 'No labour required; expense-only job',
        },
      );
      assert.equal(zeroHoursReviewed.time.billableHours, 0);
      assert.equal(zeroHoursReviewed.time.costHours, 0);
      assert.deepEqual(zeroHoursReviewed.invoiceReadiness, {
        completionSatisfied: true,
        completionBasis: 'job',
        hoursSatisfied: true,
        hoursBasis: 'admin_override',
        ready: true,
      });
      await setup`
        INSERT INTO scheduler_job_expenses (
          id, finance_id, kind, category, description, cost_amount_cents,
          billable_amount_cents, billable, invoiced, created_at, updated_at
        )
        SELECT
          'job-search-expense-' || ordinal::text,
          ${field.financeId},
          'expense', 'other', 'Generic portfolio cost', 100, 100, true, false,
          now() - (ordinal::text || ' minutes')::interval,
          now() - (ordinal::text || ' minutes')::interval
        FROM generate_series(1, 30) AS ordinal
      `;
      const searchedExpenseIds: string[] = [];
      let expenseCursor: string | undefined;
      do {
        const page = await service.listSchedulerExpensePortfolio(admin, {
          limit: 7,
          cursor: expenseCursor,
          search: 'Generic portfolio cost',
        });
        searchedExpenseIds.push(...page.items.map((expense) => expense.id));
        expenseCursor = page.nextCursor ?? undefined;
      } while (expenseCursor);
      assert.equal(searchedExpenseIds.includes(unscheduledExpense.id), false);
      assert.equal(searchedExpenseIds.length, 30);
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
      const derivedLine = unscheduledConcurrent.lines[0]!;
      const adjustedDraft = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        {
          expectedUpdatedAt: unscheduledConcurrent.updatedAt,
          lines: [{
            id: derivedLine.id,
            financeId: derivedLine.financeId,
            kind: derivedLine.kind,
            description: derivedLine.description,
            quantity: derivedLine.quantity,
            unitAmountExGst: derivedLine.unitAmountExGst + 1,
            showQuantityAndRate: false,
            expenseId: derivedLine.expenseId,
          }],
        },
      );
      assert.equal(adjustedDraft.lines[0]?.unitAmountExGst, derivedLine.unitAmountExGst + 1);
      const extendedDraft = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        {
          expectedUpdatedAt: adjustedDraft.updatedAt,
          lines: [
            {
              id: adjustedDraft.lines[0]!.id,
              financeId: adjustedDraft.lines[0]!.financeId,
              kind: adjustedDraft.lines[0]!.kind,
              description: adjustedDraft.lines[0]!.description,
              quantity: adjustedDraft.lines[0]!.quantity,
              unitAmountExGst: adjustedDraft.lines[0]!.unitAmountExGst,
              showQuantityAndRate: false,
              expenseId: adjustedDraft.lines[0]!.expenseId,
            },
            {
              kind: 'other',
              financeId: unscheduled.financeId,
              description: 'Manual adjustment',
              quantity: 1,
              unitAmountExGst: 10,
              showQuantityAndRate: false,
            },
          ],
        },
      );
      assert.equal(extendedDraft.lines.some((line) => line.kind === 'other'), true);

      await setup`UPDATE ea_audits SET status = 'Draft', completed_at = null WHERE id = 'eco-job'`;
      await assert.rejects(
        service.loadSchedulerInvoiceExportSnapshot(
          admin,
          eco.financeId,
          ecoConcurrent.id,
          ecoConcurrent.updatedAt,
        ),
        appErrorDetailIncludes('complete before generating an invoice'),
      );
      await assert.rejects(
        service.issueSchedulerInvoiceByFinanceId(
          admin,
          eco.financeId,
          ecoConcurrent.id,
          ecoConcurrent.updatedAt,
        ),
        appErrorDetailIncludes('complete before generating an invoice'),
      );
      await setup`UPDATE ea_audits SET status = 'Completed', completed_at = now() WHERE id = 'eco-job'`;

      await service.updateSchedulerFinanceById(admin, unscheduled.financeId, {
        billableHoursOverride: null,
        costHoursOverride: null,
      });
      const expenseOnlyDraftSnapshot = await service.loadSchedulerInvoiceExportSnapshot(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        extendedDraft.updatedAt,
      );
      assert.equal(expenseOnlyDraftSnapshot.status, 'draft');
      assert.equal(expenseOnlyDraftSnapshot.id, extendedDraft.id);
      assert.equal(
        expenseOnlyDraftSnapshot.lines.some((line) => (
          line.kind === 'labour' || line.kind === 'quoted'
        )),
        false,
      );
      const expenseOnlyIssued = await service.issueSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        extendedDraft.updatedAt,
      );
      assert.equal(expenseOnlyIssued.status, 'issued');
      assert.ok(expenseOnlyIssued.updatedAt !== extendedDraft.updatedAt);
      await service.updateSchedulerFinanceById(admin, unscheduled.financeId, {
        billableHoursOverride: 0,
        costHoursOverride: 0,
        overrideReason: 'Reconfirmed expense-only job after invoice readiness review',
      });
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        eco.financeId,
        ecoConcurrent.id,
        ecoConcurrent.updatedAt,
      );
      await service.voidSchedulerInvoiceByFinanceId(
        admin,
        unscheduled.financeId,
        unscheduledConcurrent.id,
        expenseOnlyIssued.updatedAt,
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

      await setup`UPDATE ih_installations SET status = 'Draft', completed_at = null WHERE id = 'field-job'`;
      await assert.rejects(
        purgeInstallHubInstallationTree('field-job'),
        appErrorDetailIncludes('installation_commercial_history_purge_blocked'),
      );
      await assert.rejects(
        purgeInstallHubInstallationTree('field-event-purge'),
        appErrorDetailIncludes('installation_commercial_history_purge_blocked'),
      );
      const editedPurgeLedger = await service.getSchedulerFinancialSummaryForSource(admin, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: 'field-edited-purge',
      });
      await service.updateSchedulerFinanceById(admin, editedPurgeLedger.financeId, {
        notes: 'Commercial setup must be retained',
      });
      await assert.rejects(
        purgeInstallHubInstallationTree('field-edited-purge'),
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
        billableHoursOverride: 1,
        costHoursOverride: 1,
        overrideReason: 'Historical ledger evidence',
      });
      await service.createSchedulerExpenseByFinanceId(admin, deletedLedger.financeId, {
        kind: 'expense', category: 'other', description: 'Historical retained expense',
        costAmount: 10, billableAmount: 12, billable: true,
      });
      await setup`
        UPDATE ih_installations
        SET deleted_at = now(), updated_at = now()
        WHERE id = 'field-deleted-ledger'
      `;
      const retainedDeletedLedger = await service.getSchedulerFinancialSummaryById(
        admin,
        deletedLedger.financeId,
      );
      assert.equal(retainedDeletedLedger.job.status, 'Deleted');
      assert.equal(retainedDeletedLedger.job.jobName, 'Deleted Field Job');
      assert.equal(retainedDeletedLedger.time.billableHours, 1);
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

      await setup.unsafe(`
        INSERT INTO ih_installations (
          id, client_name, site_name, site_address, inspector_name, audit_date,
          status, assigned_inspector_user_id, created_at
        )
        SELECT
          'portfolio-installation-' || ordinal::text,
          'Portfolio Client ' || ordinal::text,
          'Portfolio Installation ' || ordinal::text,
          ordinal::text || ' Portfolio Road',
          'Worker', '2026-08-30', 'Completed', 'worker-installhub', '2026-08-01'
        FROM generate_series(1, 105) AS ordinal
      `);
      const sameDaySolarExpense = await service.createSchedulerExpenseByFinanceId(
        admin,
        solar.financeId,
        {
          kind: 'expense',
          category: 'travel',
          description: 'Same-day due-date portfolio fixture',
          costAmount: 10,
          billableAmount: 12,
          billable: true,
        },
      );
      const sameDaySolarDraft = await service.createQuickSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        { includeLabour: false, expenseIds: [sameDaySolarExpense.id] },
      );
      const sameDaySolarDated = await service.updateSchedulerDraftInvoiceByFinanceId(
        admin,
        solar.financeId,
        sameDaySolarDraft.id,
        { expectedUpdatedAt: sameDaySolarDraft.updatedAt, dueDate: dueToday },
      );
      const sameDaySolarIssued = await service.issueSchedulerInvoiceByFinanceId(
        admin,
        solar.financeId,
        sameDaySolarDraft.id,
        sameDaySolarDated.updatedAt,
      );
      assert.equal(sameDaySolarIssued.status, 'issued');
      assert.equal(sameDaySolarIssued.dueDate?.slice(0, 10), dueToday);
      assert.equal(sameDaySolarIssued.overdue, false);
      const portfolioSummary = await service.getSchedulerFinancePortfolioSummary(admin);
      assert.equal(portfolioSummary.complete, true);
      assert.equal(portfolioSummary.jobCount > 100, true);
      assert.deepEqual(
        portfolioSummary.currencies.map((currency) => currency.currency).sort(),
        ['AUD', 'USD'],
      );
      const databasePaidCount = Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count
        FROM scheduler_invoices AS invoice
        WHERE invoice.status = 'paid'
      `)[0]?.count ?? 0);
      assert.equal(portfolioSummary.statusCounts.paid, databasePaidCount);
      const databaseOverdueCount = Number((await setup<{ count: string }[]>`
        SELECT count(*) AS count
        FROM scheduler_invoices AS invoice
        WHERE invoice.status = 'issued'
          AND invoice.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
      `)[0]?.count ?? 0);
      assert.equal(portfolioSummary.statusCounts.overdue, databaseOverdueCount);
    } finally {
      await closeDb();
    }
  } finally {
    await setup.end({ timeout: 5 });
  }
});
