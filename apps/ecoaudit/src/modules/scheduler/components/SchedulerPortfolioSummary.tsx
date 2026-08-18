'use client';

import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { useSchedulerPortfolioSummary } from '@/modules/scheduler/hooks/useScheduler';
import { draftReservedAmount, financeAppLabel, marginTone } from '@/modules/scheduler/lib/finance';
import type { FinanceSourceApp } from '@/modules/scheduler/types/domain';

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

const toneClass = {
  success: 'text-[var(--green)]',
  warning: 'text-[var(--amber)]',
  danger: 'text-[var(--red)]',
  neutral: 'text-[var(--text)]',
};

export function SchedulerPortfolioSummary({
  visibleSourceApps,
}: {
  visibleSourceApps: FinanceSourceApp[];
}) {
  const query = useSchedulerPortfolioSummary();

  if (query.isLoading) return <Spinner label="Loading portfolio financial summary…" />;
  if (query.error) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />
        <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!query.data) return null;

  const summary = query.data;
  const visibleProductLabels = visibleSourceApps.map(financeAppLabel);
  const visibleProducts = visibleProductLabels.length < 2
    ? visibleProductLabels[0] ?? 'Scheduler'
    : `${visibleProductLabels.slice(0, -1).join(', ')}, and ${visibleProductLabels.at(-1)}`;
  return (
    <section aria-labelledby="portfolio-finance-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="portfolio-finance-heading" className="text-lg font-extrabold text-[var(--text)]">
            Portfolio position
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            {summary.jobCount} job{summary.jobCount === 1 ? '' : 's'} across {visibleProducts}. Amounts are ex GST.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {summary.statusCounts.overdue > 0 ? (
            <span className="rounded-full bg-[var(--red-soft)] px-3 py-1.5 text-[var(--red)]">
              {summary.statusCounts.overdue} overdue
            </span>
          ) : null}
          <span className="rounded-full bg-[var(--surface2)] px-3 py-1.5 text-[var(--text-sub)]">
            {summary.statusCounts.draft} draft invoice{summary.statusCounts.draft === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {summary.currencies.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--text-sub)]">
          Financial totals will appear when the first job is available.
        </div>
      ) : (
        <div className="space-y-3">
          {summary.currencies.map((currencySummary) => {
            const marginPct = currencySummary.marginPct;
            const tone = marginTone(marginPct);
            return (
              <article key={currencySummary.currency} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-extrabold text-[var(--text)]">{currencySummary.currency} portfolio</h3>
                  <span className="text-xs font-bold text-[var(--text-sub)]">
                    {currencySummary.actualHours.toFixed(2)} active hours
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PortfolioMetric label="Billable" value={money(currencySummary.billableAmount, currencySummary.currency)} detail={`${currencySummary.billableHours.toFixed(2)} billable hours`} />
                  <PortfolioMetric label="Total cost" value={money(currencySummary.totalCost, currencySummary.currency)} detail={`${currencySummary.costHours.toFixed(2)} cost hours`} />
                  <PortfolioMetric label="Gross profit" value={money(currencySummary.grossProfit, currencySummary.currency)} detail={marginPct == null ? 'Margin pending' : `${marginPct.toFixed(1)}% margin`} valueClass={toneClass[tone]} />
                  <PortfolioMetric label="Unbilled" value={money(currencySummary.unbilledAmount, currencySummary.currency)} detail={`${money(currencySummary.invoicedAmount, currencySummary.currency)} issued/paid · ${money(draftReservedAmount(currencySummary.reservedAmount, currencySummary.invoicedAmount), currencySummary.currency)} held in drafts`} valueClass={currencySummary.unbilledAmount > 0 ? toneClass.warning : toneClass.success} />
                </dl>
              </article>
            );
          })}
        </div>
      )}
      {summary.currencies.length > 1 ? (
        <p className="text-xs leading-5 text-[var(--text-sub)]">
          Currency totals are intentionally shown separately and are never combined using an assumed exchange rate.
        </p>
      ) : null}
    </section>
  );
}

function PortfolioMetric({
  label,
  value,
  detail,
  valueClass = 'text-[var(--text)]',
}: {
  label: string;
  value: string;
  detail: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--surface2)] p-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-[var(--text-sub)]">{label}</dt>
      <dd className={`mt-1.5 text-xl font-extrabold tracking-tight ${valueClass}`}>{value}</dd>
      <dd className="mt-1 text-xs text-[var(--text-sub)]">{detail}</dd>
    </div>
  );
}
