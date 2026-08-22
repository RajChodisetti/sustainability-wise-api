'use client';

import { useMemo, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, Spinner, StatCard } from '@/components/ui/Card';
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
  formatAnalyticsMoney,
} from '@/modules/scheduler/lib/analytics';
import type {
  SchedulerAnalyticsLeaderboardRow,
  SchedulerAnalyticsRevenueBasis,
} from '@/modules/scheduler/types/analytics';

function decimal(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(value);
}

function attributedRevenueCents(
  rows: SchedulerAnalyticsLeaderboardRow[],
  currency: string,
  basis: SchedulerAnalyticsRevenueBasis,
): number {
  return rows.reduce(
    (total, row) => total + (findAnalyticsMoneyMetric(row.revenue, currency, basis)?.amountExGstCents ?? 0),
    0,
  );
}

function RevenueValue({
  row,
  currency,
  basis,
}: {
  row: SchedulerAnalyticsLeaderboardRow;
  currency: string;
  basis: SchedulerAnalyticsRevenueBasis;
}) {
  const metric = findAnalyticsMoneyMetric(row.revenue, currency, basis);
  if (!currency || !metric) return <span className="text-[var(--muted)]">Not available</span>;
  return (
    <span>
      <span className="block font-extrabold text-[var(--text)]">
        {formatAnalyticsMoney(metric.amountExGstCents, currency)}
      </span>
      <span className="mt-0.5 block text-[11px] font-medium text-[var(--text-sub)]">
        {metric.totalIncGstCents == null
          ? 'ex GST · GST unavailable'
          : `${formatAnalyticsMoney(metric.totalIncGstCents, currency)} inc GST`}
      </span>
    </span>
  );
}

export function SchedulerPeopleLeaderboard() {
  const [filters, setFilters] = useState(currentWeekAnalyticsFilters);
  const [currency, setCurrency] = useState('');
  const [basis, setBasis] = useState<SchedulerAnalyticsRevenueBasis>('completedWork');
  const query = useSchedulerAnalytics(filters);
  const data = query.data;
  const currencyOptions = useMemo(
    () => (data?.financials.currencies.map((entry) => entry.currency).sort() ?? []),
    [data?.financials.currencies],
  );
  const activeCurrency = currencyOptions.includes(currency) ? currency : (currencyOptions[0] ?? '');
  const rows = data?.leaderboard ?? [];
  const teamHours = rows.reduce((total, row) => total + row.workingHoursOnSite, 0);
  const completedJobs = rows.reduce((total, row) => total + row.completedJobs, 0);
  const revenueCents = attributedRevenueCents(rows, activeCurrency, basis);

  return (
    <div className="space-y-5">
      <SchedulerAnalyticsFilters
        idPrefix="team-performance"
        filters={filters}
        isFetching={query.isFetching}
        onApply={setFilters}
      />

      {query.isLoading ? <Spinner label="Loading team performance…" /> : null}
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
          <section aria-labelledby="team-performance-summary" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="team-performance-summary" className="section-title">Team performance</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                  {data.window.from} to {data.window.to} · {data.window.dayCount} inclusive day{data.window.dayCount === 1 ? '' : 's'} · {data.window.timezone}
                </p>
              </div>
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[34rem]">
                <div>
                  <FieldLabel htmlFor="leaderboard-revenue-basis" className="!mt-0">Revenue basis</FieldLabel>
                  <Select
                    id="leaderboard-revenue-basis"
                    value={basis}
                    onChange={(event) => setBasis(event.target.value as SchedulerAnalyticsRevenueBasis)}
                  >
                    {ANALYTICS_REVENUE_BASIS_OPTIONS.slice(0, 5).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <FieldLabel htmlFor="leaderboard-currency" className="!mt-0">Currency</FieldLabel>
                  <Select
                    id="leaderboard-currency"
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

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Team members" value={rows.length} icon="users" />
              <StatCard label="Working hours on site" value={`${decimal(teamHours)} h`} icon="map-pin" />
              <StatCard label="Completed jobs" value={completedJobs} icon="check" tone="success" />
              <StatCard
                label={`${analyticsRevenueBasisLabel(basis)} · ex GST`}
                value={activeCurrency ? formatAnalyticsMoney(revenueCents, activeCurrency) : 'Not available'}
                icon="activity"
              />
            </div>
          </section>

          {rows.length === 0 ? (
            <EmptyState
              icon="users"
              title="No team activity in this window"
              description="Try a wider reporting window or check that work sessions and completed jobs have been recorded."
            />
          ) : (
            <section aria-labelledby="leaderboard-heading" className="space-y-3">
              <div>
                <h2 id="leaderboard-heading" className="section-title">Leaderboard</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                  Revenue is shown only for {activeCurrency || 'the selected currency'} and is never combined across currencies.
                </p>
              </div>

              <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] lg:block">
                <table className="w-full min-w-[72rem] border-collapse text-left text-sm">
                  <caption className="sr-only">Team performance leaderboard for the selected reporting window</caption>
                  <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-extrabold">Rank / technician</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">Working hours on site</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">Completed / avg daily</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">Working days</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">Backlog</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">Pipeline</th>
                      <th scope="col" className="px-4 py-3 font-extrabold">{analyticsRevenueBasisLabel(basis)} · ex GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {rows.map((row) => (
                      <tr key={row.userId} className="transition-colors hover:bg-[var(--surface2)]">
                        <th scope="row" className="px-4 py-4 font-normal">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-sm font-extrabold text-[var(--primary)]">{row.rank}</span>
                            <span className="min-w-0">
                              <span className="block font-extrabold text-[var(--text)]">{row.displayName}</span>
                              <span className="block max-w-52 truncate text-xs text-[var(--text-sub)]">{row.email}</span>
                            </span>
                          </div>
                        </th>
                        <td className="px-4 py-4 align-top">
                          <strong className="text-[var(--text)]">{decimal(row.workingHoursOnSite)} h</strong>
                          <span className="mt-0.5 block text-xs text-[var(--text-sub)]">{decimal(row.averageWorkingHoursOnSitePerWorkingDay)} h / working day</span>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <strong className="text-[var(--text)]">{row.completedJobs}</strong>
                          <span className="mt-0.5 block text-xs text-[var(--text-sub)]">{decimal(row.averageDailyJobs)} avg daily</span>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <strong className="text-[var(--text)]">{row.workingDays} of {row.scheduledWorkingDays}</strong>
                          <span className="mt-0.5 block text-xs text-[var(--text-sub)]">{row.approvedLeaveWorkingDays} approved leave</span>
                        </td>
                        <td className="px-4 py-4 align-top font-extrabold text-[var(--text)]">{row.backlogJobs}</td>
                        <td className="px-4 py-4 align-top">
                          <strong className="text-[var(--text)]">{row.pipelineJobs0To7Days}</strong>
                          <span className="mt-0.5 block text-xs text-[var(--text-sub)]">next 7 days</span>
                          <span className="block text-xs text-[var(--text-sub)]">{row.pipelineJobs8To30Days} in days 8–30</span>
                        </td>
                        <td className="px-4 py-4 align-top"><RevenueValue row={row} currency={activeCurrency} basis={basis} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 lg:hidden">
                {rows.map((row) => (
                  <Card key={row.userId} className="!p-4 sm:!p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-[var(--text)]">{row.displayName}</p>
                        <p className="truncate text-xs text-[var(--text-sub)]">{row.email}</p>
                      </div>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-extrabold text-[var(--primary)]" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <Metric label="Working hours on site" value={`${decimal(row.workingHoursOnSite)} h`} detail={`${decimal(row.averageWorkingHoursOnSitePerWorkingDay)} h / working day`} />
                      <Metric label="Completed jobs" value={String(row.completedJobs)} detail={`${decimal(row.averageDailyJobs)} avg daily`} />
                      <Metric label="Working days" value={`${row.workingDays} of ${row.scheduledWorkingDays}`} detail={`${row.approvedLeaveWorkingDays} approved leave`} />
                      <Metric label="Backlog" value={String(row.backlogJobs)} />
                      <Metric label="Pipeline · 0–7 days" value={String(row.pipelineJobs0To7Days)} detail={`${row.pipelineJobs8To30Days} in days 8–30`} />
                      <div className="rounded-xl bg-[var(--surface2)] p-3">
                        <dt className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-sub)]">{analyticsRevenueBasisLabel(basis)}</dt>
                        <dd className="mt-1"><RevenueValue row={row} currency={activeCurrency} basis={basis} /></dd>
                      </div>
                    </dl>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {(data.quality.sessions.unattributed > 0 || data.quality.completedJobs.unattributed > 0 || data.quality.financialAllocation.unattributedDocuments > 0) ? (
            <div className="rounded-[var(--radius-sm)] border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-4 py-3 text-sm leading-6 text-[var(--text)]" role="status">
              <strong>Attribution review:</strong> {data.quality.sessions.unattributed} session{data.quality.sessions.unattributed === 1 ? '' : 's'}, {data.quality.completedJobs.unattributed} completed job{data.quality.completedJobs.unattributed === 1 ? '' : 's'}, and {data.quality.financialAllocation.unattributedDocuments} financial document{data.quality.financialAllocation.unattributedDocuments === 1 ? '' : 's'} could not be assigned to a technician.
            </div>
          ) : null}

          {basis === 'completedWork' ? (
            <SchedulerCompletedWorkQualityNotice quality={data.quality.completedWorkRevenue} />
          ) : null}

          <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-sub)] shadow-[var(--shadow-xs)]">
            <summary className="cursor-pointer font-bold text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20">How these people metrics are calculated</summary>
            <dl className="mt-3 grid gap-3 leading-6 md:grid-cols-2">
              <Definition label="Working hours on site" value={data.definitions.workingHoursOnSite} />
              <Definition label="Average daily jobs" value={data.definitions.averageDailyJobs} />
              <Definition label="Working days" value={data.definitions.workingDays} />
              <Definition label="Technician attribution" value={data.definitions.technicianAttribution} />
              <Definition label="Backlog" value={data.definitions.backlog} />
              <Definition label="Pipeline" value={`${data.definitions.pipeline0To7Days} ${data.definitions.pipeline8To30Days}`} />
            </dl>
          </details>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface2)] p-3">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-sub)]">{label}</dt>
      <dd className="mt-1 text-lg font-extrabold text-[var(--text)]">{value}</dd>
      {detail ? <dd className="mt-0.5 text-xs text-[var(--text-sub)]">{detail}</dd> : null}
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
