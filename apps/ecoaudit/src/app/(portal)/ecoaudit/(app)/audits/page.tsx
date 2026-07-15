'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAudits } from '@/api/audits';
import { LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Icon } from '@/components/ui/Icon';

export default function AuditsPage() {
  const query = useQuery({ queryKey: ['audits'], queryFn: listAudits });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const audits = query.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Audits"
        subtitle="Create, review, and complete site energy audits."
        actions={<LinkButton href="/ecoaudit/audits/new"><Icon name="plus" size={18} />New audit</LinkButton>}
      />
      {audits.length === 0 ? (
        <EmptyState title="No audits yet" description="Create your first energy audit." />
      ) : (
        <div className="space-y-3">
          {audits.map((a) => (
            <Link key={a.id} href={`/ecoaudit/audits/${a.id}`} className="block">
              <Card className="interactive-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-[var(--text)]">{a.siteName}</p>
                    <p className="mt-1 text-sm text-[var(--text-sub)]">{a.siteAddress}</p>
                    <p className="mt-2 text-xs font-medium text-[var(--muted)]">Inspector: {a.inspectorName}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
