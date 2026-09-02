'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import {
  BusinessClientContactCard,
  FleetStatusSummaryCards,
  RelatedDevicesTable,
  RelatedInstallationsTable,
  RelatedJobsTable,
} from '@/modules/fleet/components/BusinessDrilldowns';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetBusinessClient } from '@/modules/fleet/hooks/useFleet';
import { formatNumber } from '@/modules/fleet/lib/format';

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;
  const query = useFleetBusinessClient(clientId);

  if (query.isLoading) return <Spinner label="Loading client details…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) {
    return <EmptyState icon="users" title="Client not found" description="This end-customer client is not linked to a retained Fleet placement." />;
  }

  const { client, summary, sites, jobs, installations, devices } = query.data;

  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={`End-customer client · ${formatNumber(summary.siteCount)} site${summary.siteCount === 1 ? '' : 's'}`}
        actions={<LinkButton href="/fleet/devices" variant="secondary">Back to devices</LinkButton>}
      />

      <FleetStatusSummaryCards summary={summary} />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Sites" value={formatNumber(summary.siteCount)} icon="map-pin" />
        <StatCard label="Jobs" value={formatNumber(summary.jobCount)} icon="clipboard" />
        <StatCard label="Field installations" value={formatNumber(summary.installationCount)} icon="tool" />
      </div>

      <div className="mb-5">
        <BusinessClientContactCard client={client} />
      </div>

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Sites</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">A client can have multiple independently addressable sites.</p>
        </div>
        {sites.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No canonical sites are linked to this client.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Sites belonging to this end-customer client</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Site ID</th>
                  <th className={tableHeadClass} scope="col">Site</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Communicating</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Offline</th>
                  <th className={`${tableHeadClass} text-right`} scope="col">Jobs / installations</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id} className="hover:bg-[var(--surface2)]/70">
                    <td className={tableCellClass}>
                      <Link href={`/fleet/sites/${encodeURIComponent(site.id)}`} className="break-all font-bold text-[var(--primary)] hover:underline">
                        {site.id}
                      </Link>
                    </td>
                    <td className={`${tableCellClass} min-w-72`}>
                      <p className="font-bold text-[var(--text)]">{site.name}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{site.address}</p>
                    </td>
                    <td className={`${tableCellClass} text-right font-bold`}>{formatNumber(site.status.totalDevices)}</td>
                    <td className={`${tableCellClass} text-right text-[var(--green)]`}>{formatNumber(site.status.communicating)}</td>
                    <td className={`${tableCellClass} text-right font-bold text-[var(--red)]`}>{formatNumber(site.status.offline)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap text-right`}>
                      {formatNumber(site.jobCount)} / {formatNumber(site.installationCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-5"><RelatedDevicesTable devices={devices} /></div>
      <div className="mb-5"><RelatedJobsTable jobs={jobs} installations={installations} /></div>
      <RelatedInstallationsTable installations={installations} />
    </div>
  );
}
