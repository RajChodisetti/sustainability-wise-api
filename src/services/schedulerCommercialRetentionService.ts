import { and, eq, or, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eaAuditWorkSessions } from '../db/schema/ecoaudit.js';
import {
  schedulerExpenseAttachments,
  schedulerInvoiceJobs,
  schedulerInvoices,
  schedulerJobExpenses,
  schedulerJobFinance,
  schedulerJobHourOverrides,
  portalScheduleEvents,
} from '../db/schema/shared.js';
import { ssAssessmentWorkSessions } from '../db/schema/solarsense.js';
import { ihInstallationWorkSessions } from '../db/schema/installhub.js';
import { conflict } from '../utils/errors.js';
import type { FinanceSource } from './schedulerFinanceService.js';

type RetentionExecutor = Pick<typeof db, 'delete' | 'execute' | 'select'>;

const PURGE_BLOCKED = 'job_commercial_history_purge_blocked';

async function hasRecordedWorkSession(
  executor: RetentionExecutor,
  source: FinanceSource,
): Promise<boolean> {
  if (source.sourceApp === 'ecoaudit') {
    const [session] = await executor.select({ id: eaAuditWorkSessions.id })
      .from(eaAuditWorkSessions)
      .where(eq(eaAuditWorkSessions.auditId, source.sourceId))
      .limit(1);
    return Boolean(session);
  }
  if (source.sourceApp === 'solarsense') {
    const [session] = await executor.select({ id: ssAssessmentWorkSessions.id })
      .from(ssAssessmentWorkSessions)
      .where(eq(ssAssessmentWorkSessions.assessmentId, source.sourceId))
      .limit(1);
    return Boolean(session);
  }
  const [session] = await executor.select({ id: ihInstallationWorkSessions.id })
    .from(ihInstallationWorkSessions)
    .where(eq(ihInstallationWorkSessions.installationId, source.sourceId))
    .limit(1);
  return Boolean(session);
}

/**
 * Protects the recorded-time and accounting evidence for a product job.
 *
 * The caller must first lock the product source row and keep this check in the
 * same transaction as the source-tree deletion. An empty automatically-created
 * finance header is removed so its restrictive foreign-key semantics do not
 * prevent a legitimate purge that has never accumulated commercial evidence.
 */
export async function assertNoSchedulerCommercialEvidenceBeforePurge(
  executor: RetentionExecutor,
  source: FinanceSource,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(
      ${`scheduler-finance:${source.sourceApp}:${source.sourceType}:${source.sourceId}`},
      0
    ))
  `);
  if (await hasRecordedWorkSession(executor, source)) throw conflict(PURGE_BLOCKED);

  // A Scheduler item is retained business history and would otherwise let the
  // overview fallback recreate a ledger for a source that no longer exists.
  const [event] = await executor.select({ id: portalScheduleEvents.id })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, source.sourceApp),
      eq(portalScheduleEvents.sourceType, source.sourceType),
      eq(portalScheduleEvents.sourceId, source.sourceId),
    ))
    .limit(1);
  if (event) throw conflict(PURGE_BLOCKED);

  const [finance] = await executor.select()
    .from(schedulerJobFinance)
    .where(and(
      eq(schedulerJobFinance.sourceApp, source.sourceApp),
      eq(schedulerJobFinance.sourceType, source.sourceType),
      eq(schedulerJobFinance.sourceId, source.sourceId),
    ))
    .for('update')
    .limit(1);
  if (!finance) return;

  const [[hourOverride], [expense], [attachment], [invoice]] = await Promise.all([
    executor.select({ id: schedulerJobHourOverrides.id })
      .from(schedulerJobHourOverrides)
      .where(eq(schedulerJobHourOverrides.financeId, finance.id))
      .limit(1),
    executor.select({ id: schedulerJobExpenses.id })
      .from(schedulerJobExpenses)
      .where(eq(schedulerJobExpenses.financeId, finance.id))
      .limit(1),
    executor.select({ id: schedulerExpenseAttachments.id })
      .from(schedulerExpenseAttachments)
      .innerJoin(
        schedulerJobExpenses,
        eq(schedulerExpenseAttachments.expenseId, schedulerJobExpenses.id),
      )
      .where(eq(schedulerJobExpenses.financeId, finance.id))
      .limit(1),
    executor.select({ id: schedulerInvoices.id })
      .from(schedulerInvoices)
      .leftJoin(schedulerInvoiceJobs, eq(schedulerInvoiceJobs.invoiceId, schedulerInvoices.id))
      .where(or(
        eq(schedulerInvoices.financeId, finance.id),
        eq(schedulerInvoiceJobs.financeId, finance.id),
      ))
      .limit(1),
  ]);
  if (hourOverride || expense || attachment || invoice) throw conflict(PURGE_BLOCKED);

  const pristineAutoLedger = finance.createdAt.getTime() === finance.updatedAt.getTime()
    && finance.updatedByUserId === null
    && finance.updatedByDisplayName === null
    && finance.pricingMode === 'charge_up'
    && finance.quotedAmountCents === null
    && finance.currency === 'AUD'
    && finance.notes === null
    && finance.billToAbn === null
    && finance.billToEmail === null
    && finance.billingReference === null
    && finance.billableRateCents === Math.round(config.schedulerFinance.defaultBillableRate * 100)
    && finance.costRateCents === Math.round(config.schedulerFinance.defaultCostRate * 100);
  if (!pristineAutoLedger) throw conflict(PURGE_BLOCKED);

  // PostgreSQL also fences old-binary finance deletes. This transaction-local
  // marker is set only after the current service has locked the source/ledger
  // and proved that the auto-created ledger has no retained evidence.
  await executor.execute(sql`
    SELECT set_config('sustainability.scheduler_purge_writer', 'on', true)
  `);
  await executor.delete(schedulerJobFinance).where(eq(schedulerJobFinance.id, finance.id));
}
