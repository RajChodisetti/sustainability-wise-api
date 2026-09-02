'use client';

import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import {
  BusinessSiteDetailsCard,
  FleetStatusSummaryCards,
  RelatedDevicesTable,
  RelatedInstallationsTable,
  RelatedJobsTable,
} from '@/modules/fleet/components/BusinessDrilldowns';
import { useFleetBusinessSite } from '@/modules/fleet/hooks/useFleet';
import { formatNumber } from '@/modules/fleet/lib/format';

export default function SiteDetailPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = params.siteId;
  const query = useFleetBusinessSite(siteId);

  if (query.isLoading) return <Spinner label="Loading site details…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) {
    return <EmptyState icon="map-pin" title="Site not found" description="This site is not linked to a retained Fleet placement." />;
  }

  const { site, client, summary, jobs, installations, devices } = query.data;

  return (
    <div>
      <PageHeader
        title={site.name}
        subtitle={`Site ${site.id} · ${site.address}`}
        actions={(
          <LinkButton href={`/fleet/clients/${encodeURIComponent(client.id)}`} variant="secondary">
            View {client.name}
          </LinkButton>
        )}
      />

      <FleetStatusSummaryCards summary={summary} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <StatCard label="Jobs" value={formatNumber(summary.jobCount)} icon="clipboard" />
        <StatCard label="Field installations" value={formatNumber(summary.installationCount)} icon="tool" />
      </div>

      <div className="mb-5"><BusinessSiteDetailsCard site={site} /></div>
      <div className="mb-5"><RelatedDevicesTable devices={devices} /></div>
      <div className="mb-5"><RelatedJobsTable jobs={jobs} installations={installations} /></div>
      <RelatedInstallationsTable installations={installations} />
    </div>
  );
}
