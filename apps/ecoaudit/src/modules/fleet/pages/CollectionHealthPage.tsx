'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetRuns } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatDateTime, formatDuration, formatNumber } from '@/modules/fleet/lib/format';

const pageSize = 50;

function elapsedSeconds(start?: string | null, finish?: string | null): number | null {
  if (!start || !finish) return null;
  const seconds = (new Date(finish).getTime() - new Date(start).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export default function CollectionHealthPage() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useFleetRuns({ limit: pageSize, offset, status });
  const runs = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? 0;
  const latest = runs[0];

  if (query.isLoading && !query.data) return <Spinner label="Loading collection health…" />;

  return (
    <div>
      <PageHeader
        title="Collection health"
        subtitle="Confirm client coverage, retries, rate limits, and failures before trusting a published fleet snapshot."
        actions={(
          <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <Icon name="activity" size={17} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      <div className="mb-5 rounded-[var(--radius-sm)] border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-4 py-3 text-sm leading-6 text-[var(--text)]">
        Only complete runs are published to operational dashboards. If a client fails, known-but-unobserved devices remain Unknown and the previous complete snapshot stays active.
      </div>

      {query.error ? <ErrorBanner message={fleetConnectionErrorMessage(query.error)} /> : null}

      {latest ? (
        <div className="my-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="!p-5">
            <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">Latest run</p>
            <div className="mt-3"><ProcessStatusBadge status={latest.status} /></div>
            <p className="mt-3 text-xs text-[var(--text-sub)]">{formatDateTime(latest.startedAt)}</p>
          </Card>
          <StatCard label="Successful clients" value={`${formatNumber(latest.successfulClientCount)} / ${formatNumber(latest.configuredClientCount)}`} icon="users" tone={latest.failedClientCount > 0 ? 'warning' : 'success'} />
          <StatCard label="Retries / rate limits" value={`${formatNumber(latest.retryCount)} / ${formatNumber(latest.rateLimitCount)}`} icon="activity" tone={latest.rateLimitCount > 0 ? 'warning' : 'primary'} />
          <StatCard label="Collection errors" value={formatNumber(latest.errorCount)} icon="activity" tone={latest.errorCount > 0 ? 'danger' : 'success'} />
        </div>
      ) : null}

      <Card className="mb-5 !p-4">
        <label className="block max-w-sm text-xs font-bold text-[var(--text-sub)]">
          Run status
          <Select className="mt-1.5" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="collecting">Collecting</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
          </Select>
        </label>
      </Card>

      {!query.error && runs.length === 0 ? (
        <EmptyState icon="activity" title="No collection runs found" description="The collector has not uploaded a run matching this status." />
      ) : runs.length > 0 ? (
        <Card className="min-w-0 !p-0">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Wattwatchers collection run quality and diagnostics</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Reporting date</th>
                  <th className={tableHeadClass} scope="col">Status</th>
                  <th className={tableHeadClass} scope="col">Duration</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Clients successful</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Requests</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Retries</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Rate limits</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-[var(--surface2)]/70">
                    <td className={tableCellClass}>
                      <Link href={`/fleet/collection/${encodeURIComponent(run.id)}`} className="font-bold text-[var(--primary)] hover:underline">{formatDate(run.reportingDate)}</Link>
                      <p className="mt-1 whitespace-nowrap text-xs text-[var(--text-sub)]">{formatDateTime(run.startedAt)}</p>
                    </td>
                    <td className={tableCellClass}>
                      <ProcessStatusBadge status={run.status} />
                      {run.errorSummary ? <p className="mt-2 max-w-64 text-xs leading-5 text-[var(--red)]">{run.errorSummary}</p> : null}
                    </td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDuration(elapsedSeconds(run.startedAt, run.finishedAt))}</td>
                    <td className={`${tableCellClass} text-right font-semibold`}>
                      {formatNumber(run.successfulClientCount)} / {formatNumber(run.configuredClientCount)}
                      {run.failedClientCount > 0 ? <p className="mt-1 text-xs text-[var(--red)]">{formatNumber(run.failedClientCount)} failed</p> : null}
                    </td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(run.totalDevices)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(run.requestCount)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(run.retryCount)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(run.rateLimitCount)}</td>
                    <td className={`${tableCellClass} text-right font-bold ${run.errorCount > 0 ? 'text-[var(--red)]' : ''}`}>{formatNumber(run.errorCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--text-sub)]">
              Showing {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + pageSize, total))} of {formatNumber(total)}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
              <Button variant="secondary" disabled={offset + pageSize >= total || query.isFetching} onClick={() => setOffset(offset + pageSize)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
