'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAllAssessments, useSites } from '@solar/hooks/useSites';
import { computeDashboardMetrics } from '@solar/lib/metrics';
import { pullSync } from '@solar/api/sync';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { useToast } from '@/contexts/ToastContext';
import { RemoteSitesPanel } from '@solar/components/cloud/RemoteSitesPanel';
import { Button } from '@solar/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const sitesQuery = useSites();
  const assessmentsQuery = useAllAssessments();
  const metrics = useMemo(() => {
    if (!sitesQuery.data || !assessmentsQuery.data) return null;
    return computeDashboardMetrics(sitesQuery.data, assessmentsQuery.data);
  }, [sitesQuery.data, assessmentsQuery.data]);

  const error = sitesQuery.error || assessmentsQuery.error;
  const loading = sitesQuery.isLoading || assessmentsQuery.isLoading;

  async function handleImportAll() {
    setImporting(true);
    try {
      await pullSync();
      await queryClient.invalidateQueries();
      await sitesQuery.refetch();
      await assessmentsQuery.refetch();
      toast.success('Cloud import completed successfully.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setImporting(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={cloudConnectionErrorMessage(error)} />;
  if (!metrics) return <EmptyState title="No data" />;

  const statCards = [
    { label: 'Sites', value: metrics.siteCount },
    { label: 'Assessments', value: metrics.assessmentCount },
    { label: 'Viable', value: metrics.viableCount },
    { label: 'TBD', value: metrics.tbdCount },
    { label: 'Excluded', value: metrics.excludedCount },
    { label: 'Total AC kW', value: metrics.totalAcKw.toFixed(1) },
    { label: 'Potential AC kW', value: metrics.totalPotentialAcKw.toFixed(1) },
    { label: 'RAG Green', value: metrics.ragGreen },
    { label: 'RAG Amber', value: metrics.ragAmber },
    { label: 'RAG Red', value: metrics.ragRed },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Solar assessment overview"
        actions={
          <Button variant="secondary" onClick={() => void handleImportAll()} disabled={importing}>
            {importing ? 'Importing…' : 'Import from Cloud'}
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-sub)]">{s.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--text)]">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-6">
        <RemoteSitesPanel />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">Site capacity</h2>
        {metrics.siteCapacity.length === 0 ? (
          <EmptyState title="No site capacity data" description="Create sites and assessments to see capacity breakdown." />
        ) : (
          <div className="space-y-2">
            {metrics.siteCapacity.map((s) => (
              <Card key={`${s.siteId}-${s.siteName}`} className="flex items-center justify-between !py-3">
                <div>
                  <p className="font-medium text-[var(--text)]">{s.siteName}</p>
                  <p className="text-xs text-[var(--text-sub)]">{s.buildingCount} building(s)</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-[var(--green)]">{s.viableKw.toFixed(1)} kW</p>
                  {s.siteId ? (
                    <Link href={`/solar/sites/${s.siteId}`} className="text-xs text-[var(--primary)] hover:underline">
                      View site
                    </Link>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
