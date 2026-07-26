'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallationTrees } from '@/modules/installhub/hooks/useInstallationTree';

export function InstallHubInstallationsPage() {
  const query = useInstallationTrees();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'Draft' | 'Completed'>('all');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .filter(({ installation }) => status === 'all' || installation.status === status)
      .filter(({ installation }) =>
        !term ||
        [installation.siteName, installation.clientName, installation.siteAddress, installation.inspectorName]
          .some((value) => value.toLowerCase().includes(term)),
      )
      .sort((a, b) => Date.parse(b.installation.updatedAt) - Date.parse(a.installation.updatedAt));
  }, [query.data, search, status]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;

  return (
    <div>
      <PageHeader
        title="Installations"
        subtitle="Browse cloud installations created in the portal or backed up from iOS."
        actions={<LinkButton href="/installhub/installations/new"><Icon name="plus" size={18} />New installation</LinkButton>}
      />
      <Card className="mb-5 !p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_13rem]">
          <div className="relative">
            <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-3.5 text-[var(--muted)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search site, client, address, or installer"
              aria-label="Search installations"
              className="pl-10"
            />
          </div>
          <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Completed">Completed</option>
          </Select>
        </div>
      </Card>
      {filtered.length === 0 ? (
        <EmptyState
          title={query.data?.length ? 'No installations match' : 'No installations yet'}
          description={query.data?.length ? 'Try another search or status.' : 'Create the first InstallHub installation.'}
          icon="building"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(({ installation, zones, electricalAssets, siteAssets, formSubmissions }) => (
            <Link key={installation.id} href={`/installhub/installations/${installation.id}`} className="block">
              <Card className="interactive-card">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-extrabold text-[var(--text)]">{installation.siteName}</p>
                    <p className="mt-1 break-words text-sm text-[var(--text-sub)]">{installation.clientName} · {installation.siteAddress}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Updated {new Date(installation.updatedAt).toLocaleString()} · Inspector {installation.inspectorName}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-sub)]">
                      {zones.length} zones · {electricalAssets.length + siteAssets.length} assets · {formSubmissions.length} forms
                    </span>
                    <StatusBadge status={installation.status} />
                    <Icon name="chevron-right" size={18} className="text-[var(--muted)]" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
