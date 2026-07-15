'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listAudits } from '@/api/audits';
import { Card, PageHeader, Spinner } from '@/components/ui/Card';
import { EQUIPMENT_TYPES } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { ErrorBanner } from '@/components/ui/Card';

export default function DashboardPage() {
  const auditsQuery = useQuery({ queryKey: ['audits'], queryFn: listAudits });

  if (auditsQuery.isLoading) return <Spinner />;
  if (auditsQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditsQuery.error)} />;

  const audits = auditsQuery.data?.data ?? [];
  const draft = audits.filter((a) => a.status !== 'Completed').length;
  const completed = audits.filter((a) => a.status === 'Completed').length;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="EcoAudit Pro overview" actions={<Link href="/ecoaudit/audits/new" className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)]">New audit</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-sm text-[var(--text-sub)]">Total audits</p><p className="text-3xl font-bold">{audits.length}</p></Card>
        <Card><p className="text-sm text-[var(--text-sub)]">Draft</p><p className="text-3xl font-bold">{draft}</p></Card>
        <Card><p className="text-sm text-[var(--text-sub)]">Completed</p><p className="text-3xl font-bold text-[var(--green)]">{completed}</p></Card>
      </div>
      <Card>
        <h2 className="mb-3 font-semibold">Equipment types</h2>
        <p className="mb-4 text-sm text-[var(--text-sub)]">Open an audit to add zones and equipment records.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {EQUIPMENT_TYPES.map((t) => (
            <div key={t.slug} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <span className="mr-2">{t.icon}</span>{t.label}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
