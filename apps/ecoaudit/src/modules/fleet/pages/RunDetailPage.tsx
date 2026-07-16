'use client';

import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetRun } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatDateTime, formatNumber, humanize } from '@/modules/fleet/lib/format';
import type { FleetRunClientResult } from '@/modules/fleet/types/domain';

function value(result: FleetRunClientResult, ...keys: string[]): unknown {
  for (const key of keys) {
    if (result[key] !== undefined && result[key] !== null) return result[key];
  }
  return null;
}

function numberValue(result: FleetRunClientResult, ...keys: string[]): number | null {
  const candidate = value(result, ...keys);
  return typeof candidate === 'number' ? candidate : null;
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const query = useFleetRun(params.runId);

  if (query.isLoading) return <Spinner label="Loading run diagnostics…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) return <EmptyState icon="activity" title="Collection run not found" />;

  const { run, clients } = query.data;

  return (
    <div>
      <PageHeader
        title={`Collection run · ${formatDate(run.reportingDate)}`}
        subtitle={`Started ${formatDateTime(run.startedAt)} · ${humanize(run.trigger)}`}
        actions={<LinkButton href="/fleet/collection" variant="secondary">Back to collection health</LinkButton>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!p-5">
          <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">Run status</p>
          <div className="mt-3"><ProcessStatusBadge status={run.status} /></div>
          <p className="mt-3 text-xs text-[var(--text-sub)]">Published {formatDateTime(run.publishedAt)}</p>
        </Card>
        <StatCard label="Clients successful" value={`${formatNumber(run.successfulClientCount)} / ${formatNumber(run.configuredClientCount)}`} icon="users" tone={run.failedClientCount > 0 ? 'warning' : 'success'} />
        <StatCard label="Observed devices" value={formatNumber(run.totalDevices)} icon="gauge" />
        <StatCard label="Errors" value={formatNumber(run.errorCount)} icon="activity" tone={run.errorCount > 0 ? 'danger' : 'success'} />
      </div>

      {run.errorSummary ? (
        <div className="mb-5"><ErrorBanner message={run.errorSummary} /></div>
      ) : null}

      <Card className="mb-5">
        <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Run totals</h2>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Requests', run.requestCount],
            ['Retries', run.retryCount],
            ['Rate limits', run.rateLimitCount],
            ['Failed clients', run.failedClientCount],
            ['Communicating', run.communicating],
            ['Delayed', run.delayed],
            ['Offline', run.offline],
            ['Unknown', run.unknown],
          ].map(([label, metric]) => (
            <div key={String(label)} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
              <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
              <dd className="mt-1 text-xl font-extrabold text-[var(--text)]">{formatNumber(metric as number)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Client collection results</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Per-client outcomes make partial coverage and repeated throttling visible.</p>
        </div>
        {clients.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No per-client results were retained for this run.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Per-client collection diagnostics</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Client</th>
                  <th className={tableHeadClass} scope="col">Status</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Requests</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Retries</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Rate limits</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Errors</th>
                  <th className={tableHeadClass} scope="col">Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client, index) => {
                  const name = value(client, 'clientName', 'name', 'clientCode', 'code');
                  const status = value(client, 'status', 'collectionStatus');
                  const diagnostic = value(client, 'error', 'errorMessage', 'errorSummary');
                  return (
                    <tr key={client.id ?? client.clientId ?? index} className="hover:bg-[var(--surface2)]/70">
                      <td className={`${tableCellClass} font-bold`}>{name ? String(name) : 'Unknown client'}</td>
                      <td className={tableCellClass}><ProcessStatusBadge status={status ? String(status) : null} /></td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(numberValue(client, 'deviceCount', 'totalDevices'))}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(numberValue(client, 'requestCount'))}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(numberValue(client, 'retryCount'))}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(numberValue(client, 'rateLimitCount'))}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(numberValue(client, 'errorCount'))}</td>
                      <td className={`${tableCellClass} max-w-80 text-xs leading-5 ${diagnostic ? 'text-[var(--red)]' : 'text-[var(--text-sub)]'}`}>
                        {diagnostic ? String(diagnostic) : 'No reported error'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
