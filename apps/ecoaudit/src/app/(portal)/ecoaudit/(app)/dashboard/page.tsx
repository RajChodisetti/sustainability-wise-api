'use client';

import { useQuery } from '@tanstack/react-query';
import { listAudits } from '@/api/audits';
import { Card, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { EQUIPMENT_TYPES } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { ErrorBanner } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { EquipmentIcon, Icon } from '@/components/ui/Icon';

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
        subtitle="Track audit progress and the equipment categories captured across your sites."
        actions={<LinkButton href="/ecoaudit/audits/new"><Icon name="plus" size={18} />New audit</LinkButton>}
      />
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total audits" value={audits.length} icon="clipboard" />
        <StatCard label="Draft" value={draft} icon="file-text" tone="warning" />
        <StatCard label="Completed" value={completed} icon="check" tone="success" />
      </div>
      <Card>
        <div className="mb-5">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Equipment types</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Open an audit to add zones and equipment records.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EQUIPMENT_TYPES.map((t) => (
            <div key={t.slug} className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                <EquipmentIcon slug={t.slug} />
              </span>
              {t.label}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
