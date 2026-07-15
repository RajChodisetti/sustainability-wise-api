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
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@solar/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';

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

  const statCards: Array<{ label: string; value: string | number; icon: IconName; tone?: 'primary' | 'success' | 'warning' | 'danger' }> = [
    { label: 'Sites', value: metrics.siteCount, icon: 'building' },
    { label: 'Assessments', value: metrics.assessmentCount, icon: 'clipboard' },
    { label: 'Viable', value: metrics.viableCount, icon: 'check', tone: 'success' },
    { label: 'TBD', value: metrics.tbdCount, icon: 'activity', tone: 'warning' },
    { label: 'Excluded', value: metrics.excludedCount, icon: 'close', tone: 'danger' },
    { label: 'Total AC kW', value: metrics.totalAcKw.toFixed(1), icon: 'zap' },
    { label: 'Potential AC kW', value: metrics.totalPotentialAcKw.toFixed(1), icon: 'sun' },
    { label: 'RAG Green', value: metrics.ragGreen, icon: 'check', tone: 'success' },
    { label: 'RAG Amber', value: metrics.ragAmber, icon: 'activity', tone: 'warning' },
    { label: 'RAG Red', value: metrics.ragRed, icon: 'activity', tone: 'danger' },
  ];

  return (
    <div>
      <PageHeader
        title="Solar Sense dashboard"
        subtitle="Review site viability, generation capacity, and cloud assessment activity."
        actions={
          <Button variant="secondary" onClick={() => void handleImportAll()} disabled={importing}>
            <Icon name="cloud" size={18} />
            {importing ? 'Importing…' : 'Import from Cloud'}
          </Button>
        }
      />

      <div className="mb-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} />
        ))}
      </div>

      <div className="mb-6">
        <RemoteSitesPanel />
      </div>

      <div>
        <div className="mb-3">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Site capacity</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Viable capacity by assessed site.</p>
        </div>
        {metrics.siteCapacity.length === 0 ? (
          <EmptyState title="No site capacity data" description="Create sites and assessments to see capacity breakdown." />
        ) : (
          <div className="space-y-2">
            {metrics.siteCapacity.map((s) => (
              <Card key={`${s.siteId}-${s.siteName}`} className="interactive-card flex items-center justify-between gap-4 !p-4">
                <div className="min-w-0">
                  <p className="break-words font-medium text-[var(--text)]">{s.siteName}</p>
                  <p className="text-xs text-[var(--text-sub)]">{s.buildingCount} building(s)</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-[var(--green)]">{s.viableKw.toFixed(1)} kW</p>
                  {s.siteId ? (
                    <Link href={`/solar/sites/${s.siteId}`} className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--primary)] hover:underline">
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
