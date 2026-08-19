'use client';

import { cloudConnectionErrorMessage } from '@/api/client';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { ExpenseLedger } from '@/modules/scheduler/components/ExpenseLedger';
import { FinanceSettingsPanel } from '@/modules/scheduler/components/FinanceSettingsPanel';
import { useSchedulerFinancialSummary } from '@/modules/scheduler/hooks/useScheduler';
import { draftReservedAmount, financeAppLabel, marginTone } from '@/modules/scheduler/lib/finance';
import type { FinanceOverviewItem } from '@/modules/scheduler/types/domain';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function displayDate(value: string | null): string {
  if (!value) return 'Date not set';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const marginClasses = {
  success: 'bg-[var(--green-soft)] text-[var(--green)]',
  warning: 'bg-[var(--amber-soft)] text-[var(--amber)]',
  danger: 'bg-[var(--red-soft)] text-[var(--red)]',
  neutral: 'bg-[var(--surface2)] text-[var(--text-sub)]',
};

const metricTextClasses = {
  success: 'text-[var(--green)]',
  warning: 'text-[var(--amber)]',
  danger: 'text-[var(--red)]',
  neutral: 'text-[var(--text)]',
};

export function SchedulerFinanceDetail({
  financeId,
  overview,
}: {
  financeId: string;
  overview: FinanceOverviewItem;
}) {
  const query = useSchedulerFinancialSummary(financeId);

  if (query.isLoading) return <Spinner label={`Loading finance for ${overview.jobName}…`} />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Financial summary not found." />;

  const summary = query.data;
  const overdueCount = summary.invoices.filter((invoice) => invoice.overdue && invoice.status === 'issued').length;
  const legacyHoursNeedReview = summary.time.overrideSource === 'legacy_estimate';
  const missingBillingRateNames = summary.time.missingBillingRateUsers
    .map((user) => user.displayName ?? user.userId);
  const tone = marginTone(summary.totals.marginPct);

  return (
    <div className="min-w-0 space-y-5">
      <header className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--text-sub)]">
              <span>{financeAppLabel(overview.sourceApp)}</span>
              <span aria-hidden="true">·</span>
              <span>{displayDate(overview.jobDate)}</span>
              <span aria-hidden="true">·</span>
              <span>{overview.jobStatus}</span>
              {overview.eventStatus ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">Schedule {overview.eventStatus.replace('_', ' ')}</span>
                </>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-xl font-extrabold tracking-[-0.025em] text-[var(--text)] sm:text-2xl">{overview.jobName}</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">
              {[summary.job.clientName, summary.job.siteName, summary.job.siteAddress].filter(Boolean).join(' · ') || 'Shared job commercial workspace'}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-sm font-extrabold ${marginClasses[tone]}`}>
            {summary.totals.marginPct == null ? 'Margin pending' : `${summary.totals.marginPct.toFixed(1)}% margin`}
          </span>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Commercial position">
        <Metric label="Billable (ex GST)" value={money(summary.totals.billableAmount, summary.currency)} detail={`${money(summary.totals.labourRevenue, summary.currency)} labour · ${money(summary.totals.expenseRevenue, summary.currency)} costs`} />
        <Metric label="Total cost" value={money(summary.totals.totalCost, summary.currency)} detail={`${money(summary.totals.labourCost, summary.currency)} labour · ${money(summary.totals.expenseCost, summary.currency)} expenses`} />
        <Metric label="Gross profit" value={money(summary.totals.grossProfit, summary.currency)} detail={summary.totals.marginPct == null ? 'Margin pending' : `${summary.totals.marginPct.toFixed(1)}% current margin`} tone={tone === 'neutral' ? 'neutral' : tone} />
        <Metric
          label="Unbilled"
          value={money(summary.totals.unbilledAmount, summary.currency)}
          detail={`${money(summary.totals.invoicedAmount, summary.currency)} issued/paid · ${money(draftReservedAmount(summary.totals.reservedAmount, summary.totals.invoicedAmount), summary.currency)} held in drafts`}
          tone={summary.totals.unbilledAmount > 0 ? 'warning' : 'success'}
        />
      </section>

      {(!summary.invoiceReadiness.completionSatisfied || legacyHoursNeedReview || missingBillingRateNames.length > 0 || overdueCount > 0 || summary.totals.unbilledQuoteBalance > 0) ? (
        <section className="grid gap-2 sm:grid-cols-2" aria-label="Finance attention items">
          {!summary.invoiceReadiness.completionSatisfied ? <Cue tone="warning" title="Complete the job before invoicing" detail="The source audit, assessment, or installation must be marked Completed before a draft can be created or issued." /> : null}
          {legacyHoursNeedReview ? <Cue tone="warning" title="Migrated hours need review" detail="Replace the migrated value for accurate internal reporting. It no longer blocks invoice issue or PDF generation." /> : null}
          {missingBillingRateNames.length > 0 ? <Cue tone="warning" title="Billing rates need setup" detail={`Ask an admin to set a fixed billing rate for ${missingBillingRateNames.join(', ')}.`} /> : null}
          {overdueCount > 0 ? <Cue tone="danger" title={`${overdueCount} overdue invoice${overdueCount === 1 ? '' : 's'}`} detail="Follow up or mark paid once payment is confirmed." /> : null}
          {summary.pricing.mode === 'quoted' && summary.totals.unbilledQuoteBalance > 0 ? <Cue tone="warning" title={`${money(summary.totals.unbilledQuoteBalance, summary.currency)} quote balance`} detail="Quoted value remains available for a new invoice draft." /> : null}
        </section>
      ) : null}

      <FinanceSettingsPanel
        key={[
          financeId,
          summary.pricing.mode,
          summary.pricing.quotedAmount ?? '',
          summary.pricing.notes ?? '',
          summary.currency,
          summary.time.billableHoursOverride ?? '',
          summary.time.costHoursOverride ?? '',
          summary.time.billableRate,
          summary.time.costRate,
          summary.time.overriddenAt ?? '',
          summary.billing.name ?? '',
          summary.billing.address ?? '',
          summary.billing.email ?? '',
          summary.billing.abn ?? '',
          summary.billing.reference ?? '',
        ].join(':')}
        financeId={financeId}
        summary={summary}
      />

      <ExpenseLedger
        financeId={financeId}
        currency={summary.currency}
        expenses={summary.expenses}
      />

    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-sub)]">{label}</p>
      <p className={`mt-2 text-xl font-extrabold tracking-tight ${metricTextClasses[tone]}`}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{detail}</p>
    </div>
  );
}

function Cue({ tone, title, detail }: { tone: 'warning' | 'danger'; title: string; detail: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone === 'danger' ? 'border-[var(--red)]/25 bg-[var(--red-soft)]' : 'border-[var(--amber)]/25 bg-[var(--amber-soft)]'}`}>
      <p className={`text-sm font-extrabold ${tone === 'danger' ? 'text-[var(--red)]' : 'text-[var(--amber)]'}`}>{title}</p>
      <p className="mt-0.5 text-xs leading-5 text-[var(--text-sub)]">{detail}</p>
    </div>
  );
}
