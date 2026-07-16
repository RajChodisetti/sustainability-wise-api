'use client';

import { useMemo, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { downloadReportCsv } from '@/modules/fleet/api/fleet';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetScopeFilters } from '@/modules/fleet/components/FleetScopeFilters';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients, useFleetReports, useFleetTrends } from '@/modules/fleet/hooks/useFleet';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  isoDateDaysAgo,
  isoDateToday,
} from '@/modules/fleet/lib/format';

const reportPageSize = 25;

export default function ReportsPage() {
  const [clientId, setClientId] = useState('');
  const [maas, setMaas] = useState<'' | 'true' | 'false'>('');
  const [offset, setOffset] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const scope = useMemo(() => ({ clientId, maas }), [clientId, maas]);
  const trendsQuery = useFleetTrends({
    ...scope,
    from: isoDateDaysAgo(60),
    to: isoDateToday(),
  });
  const clientsQuery = useFleetClients();
  const reportsQuery = useFleetReports({ limit: reportPageSize, offset });
  const clients = clientsQuery.data?.data ?? [];
  const trends = trendsQuery.data?.data ?? [];
  const comparisonRows = [...trends].reverse();
  const reports = reportsQuery.data?.data ?? [];
  const reportTotal = reportsQuery.data?.meta?.total ?? 0;
  const latest = trends.at(-1);

  async function handleDownload(reportId: string, reportingDate: string) {
    setDownloading(reportId);
    setDownloadError(null);
    try {
      const blob = await downloadReportCsv(reportId, scope);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `wattwatchers-fleet-${reportingDate}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(fleetConnectionErrorMessage(error));
    } finally {
      setDownloading(null);
    }
  }

  if (trendsQuery.isLoading && reportsQuery.isLoading) {
    return <Spinner label="Loading fleet reports…" />;
  }

  return (
    <div>
      <PageHeader
        title="Daily comparison & reports"
        subtitle="Compare the same offline report cohort across days, then review email delivery and download the retained CSV."
        actions={(
          <Button
            variant="secondary"
            disabled={trendsQuery.isFetching || reportsQuery.isFetching}
            onClick={() => {
              void trendsQuery.refetch();
              void reportsQuery.refetch();
            }}
          >
            <Icon name="activity" size={17} />
            {trendsQuery.isFetching || reportsQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {downloadError ? <div className="mb-5"><ErrorBanner message={downloadError} /></div> : null}
      {trendsQuery.error ? <div className="mb-5"><ErrorBanner message={fleetConnectionErrorMessage(trendsQuery.error)} /></div> : null}

      <FleetScopeFilters
        clients={clients}
        clientId={clientId}
        maas={maas}
        onClientChange={setClientId}
        onMaasChange={setMaas}
        className="mb-5"
      />

      {latest ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Availability at scan" value={formatPercent(latest.availabilityPercent)} icon="gauge" />
          <StatCard label="Report offline" value={formatNumber(latest.reportOffline)} icon="wifi-off" tone="danger" />
          <StatCard label="Newly report offline" value={formatNumber(latest.reportNewlyOffline)} icon="activity" tone="warning" />
          <StatCard label="Recovered" value={formatNumber(latest.reportRecovered)} icon="check" tone="success" />
        </div>
      ) : null}

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">Daily cohort comparison</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            “Report offline” uses the retained email threshold, normally 24 hours. It is not the same as the current one-hour Offline state.
          </p>
        </div>
        {comparisonRows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon="file-text" title="No daily comparison yet" description="Published daily runs will appear here for the selected client and MaaS scope." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Daily fleet comparison for the selected client and MaaS scope</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Date</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Availability at scan</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Report offline</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Newly offline</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Recovered</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Current offline</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Unknown</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((point) => (
                  <tr key={point.runId} className="hover:bg-[var(--surface2)]/70">
                    <td className={`${tableCellClass} whitespace-nowrap font-bold`}>{formatDate(point.reportingDate)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(point.totalDevices)}</td>
                    <td className={`${tableCellClass} text-right font-semibold`}>{formatPercent(point.availabilityPercent)}</td>
                    <td className={`${tableCellClass} text-right font-bold text-[var(--red)]`}>{formatNumber(point.reportOffline)}</td>
                    <td className={`${tableCellClass} text-right text-[var(--red)]`}>{formatNumber(point.reportNewlyOffline)}</td>
                    <td className={`${tableCellClass} text-right text-[var(--green)]`}>{formatNumber(point.reportRecovered)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(point.offline)}</td>
                    <td className={`${tableCellClass} text-right`}>{formatNumber(point.unknown)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">Email report archive</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            This archive records the global email exactly as sent. The client and MaaS scope above applies to the daily comparison and each CSV export.
          </p>
        </div>
        {reportsQuery.error ? (
          <div className="p-5"><ErrorBanner message={fleetConnectionErrorMessage(reportsQuery.error)} /></div>
        ) : reports.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No generated reports are available yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <caption className="sr-only">Generated fleet email reports and delivery status</caption>
                <thead>
                  <tr>
                    <th className={tableHeadClass} scope="col">Report date</th>
                    <th className={tableHeadClass} scope="col">Subject</th>
                    <th className={tableHeadClass} scope="col">Generation</th>
                    <th className={tableHeadClass} scope="col">Email delivery</th>
                    <th className={`${tableHeadClass} text-right`} scope="col">Email offline</th>
                    <th className={`${tableHeadClass} text-right`} scope="col">Email newly offline</th>
                    <th className={`${tableHeadClass} text-right`} scope="col">Email recovered</th>
                    <th className={tableHeadClass} scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-[var(--surface2)]/70">
                      <td className={`${tableCellClass} whitespace-nowrap font-bold`}>{formatDate(report.reportingDate)}</td>
                      <td className={tableCellClass}>{report.subject || 'Fleet status report'}</td>
                      <td className={tableCellClass}>
                        <ProcessStatusBadge status={report.status} />
                        <p className="mt-2 whitespace-nowrap text-xs text-[var(--text-sub)]">{formatDateTime(report.generatedAt)}</p>
                      </td>
                      <td className={tableCellClass}>
                        <ProcessStatusBadge status={report.latestDelivery?.status ?? 'not sent'} />
                        {report.latestDelivery?.error ? <p className="mt-2 max-w-56 text-xs leading-5 text-[var(--red)]">{report.latestDelivery.error}</p> : null}
                      </td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(report.latestDelivery?.emailDelta?.offlineCount ?? report.summary?.reportOffline)}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(report.latestDelivery?.emailDelta?.newlyOfflineCount ?? report.summary?.reportNewlyOffline)}</td>
                      <td className={`${tableCellClass} text-right`}>{formatNumber(report.latestDelivery?.emailDelta?.recoveredCount ?? report.summary?.reportRecovered)}</td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-2">
                          <LinkButton
                            href={`/fleet/reports/${encodeURIComponent(report.id)}`}
                            variant="secondary"
                          >
                            Details
                            <Icon name="chevron-right" size={16} />
                          </LinkButton>
                          <Button
                            variant="secondary"
                            disabled={downloading === report.id}
                            onClick={() => void handleDownload(report.id, report.reportingDate)}
                          >
                            <Icon name="file-text" size={16} />
                            {downloading === report.id ? 'Preparing…' : 'CSV'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--text-sub)]">
                Showing {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + reportPageSize, reportTotal))} of {formatNumber(reportTotal)}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={offset === 0 || reportsQuery.isFetching} onClick={() => setOffset(Math.max(0, offset - reportPageSize))}>Previous</Button>
                <Button variant="secondary" disabled={offset + reportPageSize >= reportTotal || reportsQuery.isFetching} onClick={() => setOffset(offset + reportPageSize)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
