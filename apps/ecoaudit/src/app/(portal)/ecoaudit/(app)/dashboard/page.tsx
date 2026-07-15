'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAudits } from '@/api/audits';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { cloudConnectionErrorMessage } from '@/api/client';
import { LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Icon } from '@/components/ui/Icon';

export default function DashboardPage() {
  const auditsQuery = useQuery({ queryKey: ['audits'], queryFn: listAudits });

  if (auditsQuery.isLoading) return <Spinner />;
  if (auditsQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditsQuery.error)} />;

  const audits = auditsQuery.data?.data ?? [];
  const draft = audits.filter((a) => a.status !== 'Completed').length;
  const completed = audits.filter((a) => a.status === 'Completed').length;

  return (
    <div>
      <PageHeader
        title="Eco Audit dashboard"
        subtitle="Track audit progress and open any site audit from one place."
        actions={<LinkButton href="/ecoaudit/audits/new"><Icon name="plus" size={18} />New audit</LinkButton>}
      />
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total audits" value={audits.length} icon="clipboard" />
        <StatCard label="Draft" value={draft} icon="file-text" tone="warning" />
        <StatCard label="Completed" value={completed} icon="check" tone="success" />
      </div>
      <section aria-labelledby="dashboard-audits-heading">
        <div className="mb-4">
          <h2 id="dashboard-audits-heading" className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">
            Audits
          </h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Open an audit to review its site, zones, equipment, photos, and report.</p>
        </div>
        {audits.length === 0 ? (
          <EmptyState
            title="No audits yet"
            description="Create your first energy audit."
            actions={<LinkButton href="/ecoaudit/audits/new"><Icon name="plus" size={18} />New audit</LinkButton>}
          />
        ) : (
          <div className="space-y-3">
            {audits.map((audit) => (
              <Link key={audit.id} href={`/ecoaudit/audits/${audit.id}`} className="block">
                <Card className="interactive-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-extrabold text-[var(--text)]">{audit.siteName}</p>
                      <p className="mt-1 break-words text-sm text-[var(--text-sub)]">{audit.siteAddress}</p>
                      <p className="mt-2 text-xs font-medium text-[var(--muted)]">Inspector: {audit.inspectorName}</p>
                    </div>
                    <StatusBadge status={audit.status} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
