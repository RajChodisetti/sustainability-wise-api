'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSites } from '@solar/hooks/useSites';
import { Button } from '@solar/components/ui/Button';
import { StatusBadge } from '@solar/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { Input } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';

export default function SitesPage() {
  const { data: sites, isLoading, error } = useSites();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Draft' | 'Completed'>('all');

  const filtered = useMemo(() => {
    if (!sites) return [];
    return sites.filter((s) => {
      const matchesSearch =
        !search.trim() ||
        s.siteName.toLowerCase().includes(search.toLowerCase()) ||
        (s.location ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [sites, search, statusFilter]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={cloudConnectionErrorMessage(error)} />;

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Manage solar assessment sites"
        actions={<Link href="/solar/sites/new"><Button>New site</Button></Link>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search sites…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="Draft">Draft</option>
          <option value="Completed">Completed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No sites found" description="Create your first site to get started." />
      ) : (
        <div className="space-y-3">
          {filtered.map((site) => (
            <Link key={site.id} href={`/solar/sites/${site.id}`}>
              <Card className="transition hover:border-[var(--primary)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-[var(--text)]">{site.siteName}</p>
                    <p className="text-sm text-[var(--text-sub)]">{site.location || 'No location'}</p>
                    {site.dateOfAssessment ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">{site.dateOfAssessment}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={site.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
