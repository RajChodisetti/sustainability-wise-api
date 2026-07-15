'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAudits } from '@/api/audits';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { cloudConnectionErrorMessage } from '@/api/client';

export default function AuditsPage() {
  const query = useQuery({ queryKey: ['audits'], queryFn: listAudits });
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const audits = query.data?.data ?? [];

  return (
    <div>
      <PageHeader title="Audits" actions={<Link href="/ecoaudit/audits/new"><Button>New audit</Button></Link>} />
      {audits.length === 0 ? (
        <EmptyState title="No audits yet" description="Create your first energy audit." />
      ) : (
        <div className="space-y-3">
          {audits.map((a) => (
            <Link key={a.id} href={`/ecoaudit/audits/${a.id}`} className="block">
              <Card className="transition hover:border-[var(--primary)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{a.siteName}</p>
                    <p className="text-sm text-[var(--text-sub)]">{a.siteAddress}</p>
                    <p className="text-xs text-[var(--muted)]">Inspector: {a.inspectorName}</p>
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
