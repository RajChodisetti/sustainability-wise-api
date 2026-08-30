'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, Spinner, StatCard } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import {
  currentWeekAnalyticsFilters,
  yearToDateAnalyticsFilters,
} from '@/modules/scheduler/components/SchedulerAnalyticsFilters';
import {
  useSchedulerAnalytics,
  useSchedulerAnnualTarget,
  useUpdateSchedulerAnnualTarget,
} from '@/modules/scheduler/hooks/useScheduler';
import { findAnalyticsMoneyMetric, formatAnalyticsMoney } from '@/modules/scheduler/lib/analytics';

const JOB_TYPES = [
  ['newMaasInstalls', 'New MaaS installs'],
  ['otherInstalls', 'Other installs'],
  ['communicationsFaults', 'Comms faults'],
  ['replacements', 'Replacements'],
  ['other', 'Other · audits'],
] as const;

function decimal(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(value);
}

function percent(value: number | null): string {
  if (value == null) return 'Target not set';
  return new Intl.NumberFormat('en-AU', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export function SchedulerOperationalDashboard() {
  const weeklyFilters = useMemo(() => currentWeekAnalyticsFilters(), []);
  const yearToDateFilters = useMemo(() => yearToDateAnalyticsFilters(), []);
  const year = Number(yearToDateFilters.from.slice(0, 4));
  const weekly = useSchedulerAnalytics(weeklyFilters);
  const yearToDate = useSchedulerAnalytics(yearToDateFilters);
  const targetQuery = useSchedulerAnnualTarget(year);
  const updateTarget = useUpdateSchedulerAnnualTarget();
  const target = targetQuery.data?.target ?? null;
  const currency = target?.currency ?? 'AUD';
  const weeklyRevenue = findAnalyticsMoneyMetric(
    weekly.data?.financials.currencies ?? [],
    currency,
    'completedWork',
  );
  const yearToDateRevenue = findAnalyticsMoneyMetric(
    yearToDate.data?.financials.currencies ?? [],
    currency,
    'completedWork',
  );
  const [targetError, setTargetError] = useState<string | null>(null);

  if ((weekly.isLoading && !weekly.data)
    || (yearToDate.isLoading && !yearToDate.data)
    || (targetQuery.isLoading && !targetQuery.data)) {
    return <Spinner label="Loading weekly operations…" />;
  }
  const queryError = weekly.error ?? yearToDate.error ?? targetQuery.error;
  if (queryError || !weekly.data || !yearToDate.data) {
    return <ErrorBanner message={cloudConnectionErrorMessage(queryError)} />;
  }
  if (!weekly.data.operations) {
    return <ErrorBanner message="Operational metrics are not available from the connected API yet." />;
  }

  const operations = weekly.data.operations;
  const operationalJobTypes = operations.completedJobsByOperationalType ?? {
    newMaasInstalls: 0,
    otherInstalls: operations.completedJobsByType.installs,
    communicationsFaults: operations.completedJobsByType.faults,
    replacements: 0,
    other: operations.completedJobsByType.upgrades
      + operations.completedJobsByType.audits
      + operations.completedJobsByType.other,
  };
  const newMeters = operations.newMeters ?? {
    maas: 0,
    general: 0,
    unclassified: operations.newMetersEstablished,
    unattributed: operations.newMetersEstablished,
    byStaff: [],
  };
  const maximumJobType = Math.max(1, ...Object.values(operationalJobTypes));
  const weeklyTargetCents = target ? Math.round(target.amountExGstCents / 52) : null;
  const targetProgress = target
    ? (yearToDateRevenue?.amountExGstCents ?? 0) / target.amountExGstCents
    : null;
  const attributedStaff = weekly.data.leaderboard.filter((row) => (
    row.completedJobs > 0
    || row.workingHoursOnSite > 0
    || (row.futureScheduledJobs ?? (row.pipelineJobs0To7Days + row.pipelineJobs8To30Days)) > 0
  ));

  async function saveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTargetError(null);
    const dollars = Number(new FormData(event.currentTarget).get('annualTargetDollars'));
    const amountExGstCents = Math.round(dollars * 100);
    if (!Number.isFinite(dollars) || dollars <= 0 || !Number.isSafeInteger(amountExGstCents)) {
      setTargetError('Enter a positive annual target amount.');
      return;
    }
    try {
      await updateTarget.mutateAsync({ year, amountExGstCents, currency });
    } catch (error) {
      setTargetError(cloudConnectionErrorMessage(error));
    }
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="weekly-operations-heading" className="space-y-3">
        <div>
          <h2 id="weekly-operations-heading" className="section-title">Weekly operational performance</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            Supply period {weekly.data.window.from} to {weekly.data.window.to} · {weekly.data.window.timezone}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Scheduled · next week" value={operations.pipelineUpcomingWeek} icon="calendar" />
          <StatCard label="Total scheduled" value={operations.totalScheduled ?? operations.pipelineUpcomingWeek} icon="clipboard" />
        </div>
      </section>

      <section aria-labelledby="new-meters-heading" className="space-y-3">
        <div>
          <h2 id="new-meters-heading" className="section-title">New meters established</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Installed inventory meters in this supply period, split by the saved MaaS classification and completion actor.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="New meters · total" value={operations.newMetersEstablished} icon="gauge" tone="success" />
          <StatCard label="MaaS" value={newMeters.maas} icon="activity" />
          <StatCard label="General · non-MaaS" value={newMeters.general} icon="clipboard" />
          <StatCard label="MaaS not classified" value={newMeters.unclassified} icon="users" />
        </div>
        <Card className="!p-0">
          {newMeters.byStaff.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-sub)]">No new-meter activity can be attributed to an active staff member for this supply period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <caption className="sr-only">New meters established by staff and MaaS classification</caption>
                <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-extrabold sm:px-6">Staff member</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">Total</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">MaaS</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">General</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold sm:px-6">Not classified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {newMeters.byStaff.map((row) => (
                    <tr key={row.userId}>
                      <th scope="row" className="px-5 py-4 font-normal sm:px-6">
                        <span className="block font-extrabold text-[var(--text)]">{row.displayName}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{row.email}</span>
                      </th>
                      <td className="px-5 py-4 text-right font-extrabold tabular-nums text-[var(--text)]">{row.total}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[var(--text)]">{row.maas}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[var(--text)]">{row.general}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[var(--text)] sm:px-6">{row.unclassified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {newMeters.unattributed > 0 ? (
            <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-sub)] sm:px-6">{newMeters.unattributed} meter{newMeters.unattributed === 1 ? '' : 's'} could not be attributed to an active canonical staff profile.</p>
          ) : null}
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <Card className="!p-0">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <h2 className="font-extrabold text-[var(--text)]">Completed jobs by type</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Jobs completed inside the current supply period.</p>
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            {JOB_TYPES.map(([key, label]) => {
              const value = operationalJobTypes[key];
              return (
                <div key={key} className="grid grid-cols-[minmax(8rem,1fr)_minmax(7rem,2fr)_2.5rem] items-center gap-3">
                  <span className="text-sm font-bold text-[var(--text)]">{label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-[var(--surface3)]" aria-hidden="true">
                    <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${(value / maximumJobType) * 100}%` }} />
                  </span>
                  <span className="text-right text-sm font-extrabold tabular-nums text-[var(--text)]">{value}</span>
                </div>
              );
            })}
            <p className="border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--text-sub)]">
              New MaaS installs are M1 jobs saved as MaaS. Other installs are remaining M1 jobs, including jobs where MaaS was left blank. A completed comms-fault form that records a device replacement takes precedence over the M2 comms-fault category. M3 inspections, M4, M5, and unmatched scopes are grouped under Other.
            </p>
          </div>
        </Card>

        <Card className="!p-5 sm:!p-6">
          <h2 className="font-extrabold text-[var(--text)]">SLA coverage</h2>
          <p className="mt-3 text-2xl font-extrabold text-[var(--muted)]">Not available</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            Completion time is retained, but there is no canonical initial Request Date. The dashboard will not substitute job creation or schedule dates because that would change the requested SLA definition.
          </p>
        </Card>
      </section>

      <section aria-labelledby="revenue-pacing-heading" className="space-y-3">
        <div>
          <h2 id="revenue-pacing-heading" className="section-title">Revenue and annual pacing</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Completed-work revenue · ex GST · {currency}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Immediate revenue · weekly" value={formatAnalyticsMoney(weeklyRevenue?.amountExGstCents ?? 0, currency)} icon="activity" tone="success" />
          <Card className="!p-4 sm:!p-5">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Annual recurring revenue · MaaS</p>
            <p className="mt-2 text-lg font-extrabold text-[var(--muted)]">Not available</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">No subscription price, term, or hybrid allocation is stored.</p>
          </Card>
          <StatCard label="Weekly pacing target" value={weeklyTargetCents == null ? 'Target not set' : formatAnalyticsMoney(weeklyTargetCents, currency)} icon="calendar" />
          <StatCard label={`${year} actual revenue`} value={formatAnalyticsMoney(yearToDateRevenue?.amountExGstCents ?? 0, currency)} icon="clipboard" />
          <StatCard label="% of annual target" value={percent(targetProgress)} icon="gauge" tone={targetProgress != null && targetProgress >= 1 ? 'success' : undefined} />
        </div>
        <Card className="!p-4 sm:!p-5">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={saveTarget}>
            <div className="flex-1">
              <FieldLabel htmlFor="scheduler-annual-target">{year} annual target · {currency} ex GST</FieldLabel>
              <Input
                key={target?.updatedAt ?? 'unset'}
                id="scheduler-annual-target"
                name="annualTargetDollars"
                inputMode="decimal"
                defaultValue={target ? (target.amountExGstCents / 100).toFixed(2) : ''}
                placeholder="e.g. 1000000.00"
              />
              <FieldHint>Saved centrally for this calendar year. Weekly target is annual target ÷ 52.</FieldHint>
            </div>
            <Button type="submit" disabled={updateTarget.isPending}>
              {updateTarget.isPending ? 'Saving…' : 'Save annual target'}
            </Button>
          </form>
          {targetError ? <p className="mt-3 text-sm font-bold text-[var(--red)]" role="alert">{targetError}</p> : null}
        </Card>
      </section>

      <section aria-labelledby="staff-attribution-heading" className="space-y-3">
        <div>
          <h2 id="staff-attribution-heading" className="section-title">Staff attribution</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Averages and future workload are shown per canonical staff member only.</p>
        </div>
        <Card className="!p-0">
          {attributedStaff.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-sub)]">No attributed staff activity is available for this supply period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <caption className="sr-only">Current-week staff operational attribution</caption>
                <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-extrabold sm:px-6">Staff member</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">Completed</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">Avg. jobs / day</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold">Future jobs</th>
                    <th scope="col" className="px-5 py-3 text-right font-extrabold sm:px-6">Avg. hours / site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {attributedStaff.map((row) => (
                    <tr key={row.userId}>
                      <th scope="row" className="px-5 py-4 font-normal sm:px-6">
                        <span className="block font-extrabold text-[var(--text)]">{row.displayName}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{row.email}</span>
                      </th>
                      <td className="px-5 py-4 text-right font-extrabold tabular-nums text-[var(--text)]">{row.completedJobs}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[var(--text)]">{decimal(row.averageDailyJobs)}</td>
                      <td className="px-5 py-4 text-right font-extrabold tabular-nums text-[var(--primary)]">{row.futureScheduledJobs ?? (row.pipelineJobs0To7Days + row.pipelineJobs8To30Days)}</td>
                      <td className="px-5 py-4 text-right tabular-nums text-[var(--text)] sm:px-6">{decimal(row.averageHoursOnSitePerSite ?? 0)} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-sub)] shadow-[var(--shadow-xs)]">
        <summary className="cursor-pointer font-bold text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20">How the operational metrics are calculated</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-6">
          <li>New meters established counts distinct registered stock meters moved to Installed during this supply period.</li>
          <li>Each staff member&apos;s daily average is their completed jobs divided by their configured working days in the period after approved leave.</li>
          <li>Average hours per site is that staff member&apos;s persisted Field App active-session time divided by distinct jobs/sites worked. Exact check-in/check-out timestamps are not currently captured.</li>
          <li>Weekly and year-to-date revenue use immutable completed-work snapshots and exclude GST. Jobs without a captured revenue snapshot remain visible in the quality totals but contribute no invented amount.</li>
          <li>Hybrid MaaS and annual recurring revenue remain unavailable because MaaS is currently a nullable yes/no job flag and no subscription price or term is captured.</li>
        </ul>
      </details>
    </div>
  );
}
