'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetScopeFilters } from '@/modules/fleet/components/FleetScopeFilters';
import {
  FleetStatusBadge,
  fleetStatusColor,
} from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients, useFleetSummary, useFleetTrends } from '@/modules/fleet/hooks/useFleet';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  isoDateDaysAgo,
  isoDateToday,
} from '@/modules/fleet/lib/format';
import type { FleetStatus } from '@/modules/fleet/types/domain';

const statusKeys: FleetStatus[] = ['communicating', 'delayed', 'offline', 'inactive', 'unknown'];

export default function DashboardPage() {
  const [clientId, setClientId] = useState('');
  const [maas, setMaas] = useState<'' | 'true' | 'false'>('');
  const scope = useMemo(() => ({ clientId, maas }), [clientId, maas]);
  const summaryQuery = useFleetSummary(scope);
  const trendsQuery = useFleetTrends({
    ...scope,
    from: isoDateDaysAgo(30),
    to: isoDateToday(),
  });
  const clientsQuery = useFleetClients();
  const summary = summaryQuery.data?.summary;
  const run = summaryQuery.data?.run;
  const clients = clientsQuery.data?.data ?? [];
  const trends = trendsQuery.data?.data ?? [];
  const latestTrendRows = [...trends].slice(-14).reverse();

  if (summaryQuery.isLoading && !summaryQuery.data) {
    return <Spinner label="Loading fleet snapshot…" />;
  }

  const primaryError = summaryQuery.error ?? clientsQuery.error;

  return (
    <div>
      <PageHeader
        title="Wattwatchers overview"
        subtitle="Connectivity at the latest published scan, daily changes, and report cohorts across Wattwatchers devices."
        actions={(
          <Button
            variant="secondary"
            disabled={summaryQuery.isFetching || trendsQuery.isFetching || clientsQuery.isFetching}
            onClick={() => {
              void summaryQuery.refetch();
              void trendsQuery.refetch();
              void clientsQuery.refetch();
            }}
          >
            <Icon name="activity" size={17} />
            {summaryQuery.isFetching ? 'Refreshing…' : 'Refresh data'}
          </Button>
        )}
      />

      {primaryError ? (
        <div className="mb-5">
          <ErrorBanner message={fleetConnectionErrorMessage(primaryError)} />
        </div>
      ) : null}

      <FleetScopeFilters
        clients={clients}
        clientId={clientId}
        maas={maas}
        onClientChange={setClientId}
        onMaasChange={setMaas}
        className="mb-5"
      />

      {!summary || !run ? (
        <EmptyState
          icon="activity"
          title="No published fleet snapshot yet"
          description="The dashboard will populate after the first complete Wattwatchers collection run is published. Partial runs remain visible under Collection health."
          actions={<LinkButton href="/fleet/collection" variant="secondary">View collection health</LinkButton>}
        />
      ) : (
        <>
          <section
            className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]"
            aria-label="Fleet availability summary"
          >
            <Card className="relative overflow-hidden !p-5 sm:!p-7">
              <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-blue-500/10 blur-3xl" aria-hidden="true" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--primary)]">
                    Availability at scan
                  </p>
                  <p className="mt-2 text-4xl font-extrabold tracking-[-0.05em] text-[var(--text)] sm:text-5xl">
                    {formatPercent(summary.availabilityPercent)}
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-sub)]">
                    Communicating devices divided by devices with a known active heartbeat. Inactive and unknown devices are excluded.
                  </p>
                </div>
                <div className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-sm">
                  <p className="font-bold text-[var(--text)]">Snapshot {formatDate(run.reportingDate)}</p>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">Published {formatDateTime(run.publishedAt)}</p>
                </div>
              </div>
            </Card>

            <Card className="!p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">24-hour operational cohort</p>
              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">{formatNumber(summary.reportOffline)}</p>
                  <p className="mt-1 text-sm font-bold text-[var(--text)]">Offline meters observed</p>
                  <p className="mt-1 text-xs text-[var(--text-sub)]">No signal for {run.reportOfflineThresholdHours ?? 24}+ hours</p>
                </div>
                <span className="rounded-full bg-[var(--red-soft)] px-3 py-1.5 text-xs font-extrabold text-[var(--red)]">
                  {run.reportOfflineThresholdHours ?? 24}+ hours
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4 border-t border-[var(--border)] pt-4">
                <div>
                  <p className="text-2xl font-extrabold tracking-[-0.03em] text-[var(--text)]">{formatNumber(summary.maasReportOffline)}</p>
                  <p className="mt-1 text-sm font-bold text-[var(--text)]">MaaS offline devices</p>
                </div>
                <p className="max-w-36 text-right text-xs leading-5 text-[var(--text-sub)]">MaaS members in the same 24-hour cohort</p>
              </div>
            </Card>
          </section>

          <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Fleet status counts">
            <StatCard label="Total meters" value={formatNumber(summary.totalDevices)} icon="gauge" />
            <StatCard label="Communicating" value={formatNumber(summary.communicating)} icon="wifi" tone="success" />
            <StatCard label="Delayed" value={formatNumber(summary.delayed)} icon="activity" tone="warning" />
            <StatCard label="Offline" value={formatNumber(summary.offline)} icon="wifi-off" tone="danger" />
            <StatCard label="Inactive" value={formatNumber(summary.inactive)} icon="plug" />
            <StatCard label="Unknown" value={formatNumber(summary.unknown)} icon="cloud" tone="warning" />
          </section>

          <section className="mb-5 grid gap-4 sm:grid-cols-3" aria-label="Daily fleet changes">
            <StatCard label="Newly report offline" value={formatNumber(summary.reportNewlyOffline)} icon="wifi-off" tone="danger" />
            <StatCard label="Still report offline" value={formatNumber(summary.reportStillOffline)} icon="activity" tone="warning" />
            <StatCard label="Recovered" value={formatNumber(summary.reportRecovered)} icon="check" tone="success" />
          </section>

          <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
            <Card className="min-w-0 !p-0">
              <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">Status distribution</h2>
                  <p className="mt-1 text-sm text-[var(--text-sub)]">Every device in the selected published snapshot.</p>
                </div>
                <Link href="/fleet/devices" className="text-sm font-bold text-[var(--primary)] hover:underline">View devices</Link>
              </div>
              <div className="p-5 sm:p-6">
                <div className="mb-6 flex h-4 overflow-hidden rounded-full bg-[var(--surface2)]" aria-hidden="true">
                  {statusKeys.map((status) => {
                    const value = summary[status];
                    const width = summary.totalDevices > 0 ? (value / summary.totalDevices) * 100 : 0;
                    return <span key={status} className={fleetStatusColor[status]} style={{ width: `${width}%` }} />;
                  })}
                </div>
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <caption className="sr-only">Device status distribution with counts and share of the fleet</caption>
                    <thead>
                      <tr>
                        <th className={tableHeadClass} scope="col">Status</th>
                        <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                        <th className={`${tableHeadClass} text-right`} scope="col">Fleet share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusKeys.map((status) => (
                        <tr key={status}>
                          <td className={tableCellClass}><FleetStatusBadge status={status} /></td>
                          <td className={`${tableCellClass} text-right font-bold`}>{formatNumber(summary[status])}</td>
                          <td className={`${tableCellClass} text-right`}>
                            {formatPercent(summary.totalDevices ? (summary[status] / summary.totalDevices) * 100 : 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            <Card className="!p-5 sm:!p-6">
              <h2 className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">How status is classified</h2>
              <dl className="mt-5 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-bold text-[var(--text)]">Communicating</dt>
                  <dd className="text-right text-[var(--text-sub)]">Heard within {run.delayedThresholdMinutes ?? 15} min</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-bold text-[var(--text)]">Delayed</dt>
                  <dd className="text-right text-[var(--text-sub)]">Up to {run.offlineThresholdMinutes ?? 60} min</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-bold text-[var(--text)]">Offline</dt>
                  <dd className="text-right text-[var(--text-sub)]">Over {run.offlineThresholdMinutes ?? 60} min</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-bold text-[var(--text)]">Inactive</dt>
                  <dd className="text-right text-[var(--text-sub)]">Never initialised or heard</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-bold text-[var(--text)]">Unknown</dt>
                  <dd className="text-right text-[var(--text-sub)]">Could not be observed</dd>
                </div>
              </dl>
              <LinkButton href="/fleet/collection" variant="secondary" className="mt-6 w-full">Check collection health</LinkButton>
            </Card>
          </section>

          <Card className="min-w-0 !p-0">
            <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div>
                <h2 className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">Recent daily comparison</h2>
                <p className="mt-1 text-sm text-[var(--text-sub)]">Availability at scan and movement in the 24-hour report cohort.</p>
              </div>
              <Link href="/fleet/reports" className="text-sm font-bold text-[var(--primary)] hover:underline">View reports</Link>
            </div>
            {trendsQuery.error ? (
              <div className="p-5"><ErrorBanner message={fleetConnectionErrorMessage(trendsQuery.error)} /></div>
            ) : latestTrendRows.length === 0 ? (
              <div className="p-5 text-sm text-[var(--text-sub)]">No daily trend is available for this scope yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <caption className="sr-only">Recent daily availability and report cohort changes</caption>
                  <thead>
                    <tr>
                      <th className={tableHeadClass} scope="col">Date</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Availability at scan</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Report offline</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Newly offline</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Recovered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestTrendRows.map((point) => (
                      <tr key={point.runId}>
                        <td className={`${tableCellClass} font-bold`}>{formatDate(point.reportingDate)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatPercent(point.availabilityPercent)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatNumber(point.reportOffline)}</td>
                        <td className={`${tableCellClass} text-right text-[var(--red)]`}>{formatNumber(point.reportNewlyOffline)}</td>
                        <td className={`${tableCellClass} text-right text-[var(--green)]`}>{formatNumber(point.reportRecovered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
