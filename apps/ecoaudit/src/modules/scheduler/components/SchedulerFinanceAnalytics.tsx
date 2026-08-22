'use client';

import { useMemo, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, Spinner, StatCard } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import {
  SchedulerAnalyticsFilters,
  currentWeekAnalyticsFilters,
} from '@/modules/scheduler/components/SchedulerAnalyticsFilters';
import { SchedulerCompletedWorkQualityNotice } from '@/modules/scheduler/components/SchedulerCompletedWorkQualityNotice';
import { useSchedulerAnalytics } from '@/modules/scheduler/hooks/useScheduler';
import {
  ANALYTICS_REVENUE_BASIS_OPTIONS,
  analyticsRevenueBasisLabel,
  findAnalyticsMoneyMetric,
  formatAnalyticsDate,
  formatAnalyticsMoney,
} from '@/modules/scheduler/lib/analytics';
import type {
  SchedulerAnalyticsCurrencyMetrics,
  SchedulerAnalyticsRevenueBasis,
  SchedulerMoneyMetric,
} from '@/modules/scheduler/types/analytics';

function emptyMetric(): SchedulerMoneyMetric {
  return {
    amountExGstCents: 0,
    gstAmountCents: 0,
    totalIncGstCents: 0,
    count: 0,
  };
}

function basisTone(basis: SchedulerAnalyticsRevenueBasis): string {
  if (basis === 'paid' || basis === 'netPaid' || basis === 'completedWork') return 'bg-[var(--green)]';
  if (basis === 'voided' || basis === 'refunded') return 'bg-[var(--red)]';
  if (basis === 'refundReversed') return 'bg-[var(--amber)]';
  return 'bg-[var(--primary)]';
}

function gstValue(cents: number | null, currency: string): string {
  return cents == null ? 'Not available' : formatAnalyticsMoney(cents, currency);
}

function LifecycleMetric({
  metrics,
  basis,
  active,
}: {
  metrics: SchedulerAnalyticsCurrencyMetrics;
  basis: SchedulerAnalyticsRevenueBasis;
  active: boolean;
}) {
  const metric = metrics[basis];
  return (
    <article className={`rounded-xl border p-3 ${active ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface2)]'}`}>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-sub)]">
        {analyticsRevenueBasisLabel(basis)}
      </p>
      <p className="mt-1.5 text-lg font-extrabold tracking-tight text-[var(--text)]">
        {formatAnalyticsMoney(metric.amountExGstCents, metrics.currency)}
      </p>
      <p className="mt-0.5 text-xs text-[var(--text-sub)]">
        ex GST · {metric.count} record{metric.count === 1 ? '' : 's'}
      </p>
      <p className="mt-1 text-xs font-semibold text-[var(--text-sub)]">
        {metric.totalIncGstCents == null
          ? 'GST / inc GST not available'
          : `${formatAnalyticsMoney(metric.totalIncGstCents, metrics.currency)} inc GST`}
      </p>
    </article>
  );
}

export function SchedulerFinanceAnalytics() {
  const [filters, setFilters] = useState(currentWeekAnalyticsFilters);
  const [currency, setCurrency] = useState('');
  const [basis, setBasis] = useState<SchedulerAnalyticsRevenueBasis>('paid');
  const query = useSchedulerAnalytics(filters);
  const data = query.data;
  const currencyOptions = useMemo(
    () => (data?.financials.currencies.map((entry) => entry.currency).sort() ?? []),
    [data?.financials.currencies],
  );
  const activeCurrency = currencyOptions.includes(currency) ? currency : (currencyOptions[0] ?? '');
  const selectedCurrencyMetrics = data?.financials.currencies.find((entry) => entry.currency === activeCurrency);
  const selectedMetric = selectedCurrencyMetrics?.[basis];
  const dailyValues = useMemo(() => (
    (data?.financials.daily ?? []).map((day) => ({
      date: day.date,
      metric: findAnalyticsMoneyMetric(day.currencies, activeCurrency, basis) ?? emptyMetric(),
    }))
  ), [activeCurrency, basis, data?.financials.daily]);
  const chartMaximum = Math.max(
    1,
    ...dailyValues.map(({ metric }) => Math.abs(metric.amountExGstCents)),
  );

  return (
    <div className="space-y-5">
      <SchedulerAnalyticsFilters
        idPrefix="finance-analytics"
        filters={filters}
        isFetching={query.isFetching}
        onApply={setFilters}
      />

      {query.isLoading ? <Spinner label="Loading financial analytics…" /> : null}
      {query.isError ? (
        <div className="space-y-3">
          <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            <Icon name="refresh" size={17} /> Try again
          </Button>
        </div>
      ) : null}

      {data ? (
        <>
          <section aria-labelledby="financial-analytics-summary" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="financial-analytics-summary" className="section-title">Financial progress</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                  {data.window.from} to {data.window.to} · {data.window.dayCount} inclusive day{data.window.dayCount === 1 ? '' : 's'} · {data.window.timezone}
                </p>
              </div>
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[34rem]">
                <div>
                  <FieldLabel htmlFor="financial-revenue-basis" className="!mt-0">Revenue basis</FieldLabel>
                  <Select
                    id="financial-revenue-basis"
                    value={basis}
                    onChange={(event) => setBasis(event.target.value as SchedulerAnalyticsRevenueBasis)}
                  >
                    {ANALYTICS_REVENUE_BASIS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="financial-currency" className="!mt-0">Currency</FieldLabel>
                  <Select
                    id="financial-currency"
                    value={activeCurrency}
                    disabled={currencyOptions.length === 0}
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    {currencyOptions.length === 0 ? <option value="">No currency data</option> : null}
                    {currencyOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </Select>
                </div>
              </div>
            </div>

            {selectedMetric && activeCurrency ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite">
                <StatCard label={`${analyticsRevenueBasisLabel(basis)} · ex GST`} value={formatAnalyticsMoney(selectedMetric.amountExGstCents, activeCurrency)} icon="activity" />
                <StatCard label="GST amount" value={gstValue(selectedMetric.gstAmountCents, activeCurrency)} icon="clipboard" />
                <StatCard label="Total · inc GST" value={gstValue(selectedMetric.totalIncGstCents, activeCurrency)} icon="check" tone="success" />
                <StatCard label="Records" value={selectedMetric.count} icon="file-text" />
              </div>
            ) : null}
          </section>

          {!selectedCurrencyMetrics || !activeCurrency ? (
            <EmptyState
              icon="activity"
              title="No financial activity in this window"
              description="Financial totals will appear when completed work, invoices, payments, voids, or refunds fall inside the selected dates."
            />
          ) : (
            <>
              <section aria-labelledby="lifecycle-heading" className="space-y-3">
                <div>
                  <h2 id="lifecycle-heading" className="section-title">Revenue lifecycle · {activeCurrency}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                    Each lifecycle stage is a separate measure. Amounts from other currencies are excluded from this view.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {ANALYTICS_REVENUE_BASIS_OPTIONS.map((option) => (
                    <LifecycleMetric
                      key={option.value}
                      metrics={selectedCurrencyMetrics}
                      basis={option.value}
                      active={option.value === basis}
                    />
                  ))}
                </div>
              </section>

              <section aria-labelledby="daily-trend-heading" className="space-y-3">
                <div>
                  <h2 id="daily-trend-heading" className="section-title">Daily trend</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                    {analyticsRevenueBasisLabel(basis)} by local calendar day · {activeCurrency} · ex GST.
                  </p>
                </div>
                <figure className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
                  <figcaption className="sr-only">
                    Daily {analyticsRevenueBasisLabel(basis)} amounts in {activeCurrency}, excluding GST
                  </figcaption>
                  <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                    {dailyValues.map(({ date, metric }) => {
                      const width = metric.amountExGstCents === 0
                        ? 0
                        : Math.max(2, (Math.abs(metric.amountExGstCents) / chartMaximum) * 100);
                      return (
                        <div key={date} className="grid grid-cols-[4.5rem_minmax(6rem,1fr)] items-center gap-3 sm:grid-cols-[5.5rem_minmax(8rem,1fr)_8.5rem]">
                          <span className="text-xs font-bold text-[var(--text-sub)]">{formatAnalyticsDate(date)}</span>
                          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface3)]" aria-hidden="true">
                            <div
                              className={`h-full rounded-full ${metric.amountExGstCents < 0 ? 'bg-[var(--red)]' : basisTone(basis)}`}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="col-start-2 text-xs font-extrabold tabular-nums text-[var(--text)] sm:col-start-auto sm:text-right">
                            {formatAnalyticsMoney(metric.amountExGstCents, activeCurrency)}
                            <span className="ml-1 font-medium text-[var(--text-sub)]">({metric.count})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </figure>

                <div className="max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)]">
                  <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                    <caption className="sr-only">Exact daily financial values shown in the chart</caption>
                    <thead className="sticky top-0 bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-extrabold">Date</th>
                        <th scope="col" className="px-4 py-3 text-right font-extrabold">Ex GST</th>
                        <th scope="col" className="px-4 py-3 text-right font-extrabold">GST</th>
                        <th scope="col" className="px-4 py-3 text-right font-extrabold">Inc GST</th>
                        <th scope="col" className="px-4 py-3 text-right font-extrabold">Records</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dailyValues.map(({ date, metric }) => (
                        <tr key={date}>
                          <th scope="row" className="px-4 py-3 font-bold text-[var(--text)]">{date}</th>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text)]">{formatAnalyticsMoney(metric.amountExGstCents, activeCurrency)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-sub)]">{gstValue(metric.gstAmountCents, activeCurrency)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-sub)]">{gstValue(metric.totalIncGstCents, activeCurrency)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-sub)]">{metric.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {(data.quality.financialAllocation.zeroWeightDocuments > 0 || data.quality.financialAllocation.unattributedDocuments > 0) ? (
            <div className="rounded-[var(--radius-sm)] border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-4 py-3 text-sm leading-6 text-[var(--text)]" role="status">
              <strong>Allocation review:</strong> {data.quality.financialAllocation.zeroWeightDocuments} document{data.quality.financialAllocation.zeroWeightDocuments === 1 ? '' : 's'} had no allocation weight and {data.quality.financialAllocation.unattributedDocuments} document{data.quality.financialAllocation.unattributedDocuments === 1 ? '' : 's'} could not be attributed to a technician. Portfolio lifecycle totals above still include those documents.
            </div>
          ) : null}

          <SchedulerCompletedWorkQualityNotice quality={data.quality.completedWorkRevenue} />

          <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-sub)] shadow-[var(--shadow-xs)]">
            <summary className="cursor-pointer font-bold text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20">How financial metrics are calculated</summary>
            <dl className="mt-3 grid gap-3 leading-6 md:grid-cols-2">
              <Definition label="Completed-work revenue" value={data.definitions.completedWorkRevenue} />
              <Definition label="Invoiced" value={data.definitions.invoiceCreated} />
              <Definition label="Issued" value={data.definitions.issued} />
              <Definition label="Paid" value={data.definitions.paid} />
              <Definition label="Voided" value={data.definitions.voided} />
              <Definition label="Refunds posted" value={data.definitions.refunded} />
              <Definition label="Refund reversals" value={data.definitions.refundReversed} />
              <Definition label="Net paid" value={data.definitions.netPaid} />
              <Definition label="Currency" value={data.definitions.currency} />
            </dl>
          </details>
        </>
      ) : null}
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[var(--text)]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
