'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { deleteCloudInstallation } from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { useInstallationTrees } from '@/modules/installhub/hooks/useInstallationTree';

export function InstallHubInstallationsPage() {
  const query = useInstallationTrees();
  const toast = useToast();
  const { user } = useInstallHubAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'Draft' | 'Completed'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function removeInstallation(installationId: string, siteName: string) {
    const confirmation = window.prompt(
      `Permanently delete ${siteName} from Field App Complete Cloud Backup?\n\nThis removes its zones, assets, forms, unshared originals, reports, and version history. Existing iOS copies remain on their devices but lose this server source.\n\nType the site name to confirm.`,
    );
    if (confirmation !== siteName) {
      if (confirmation !== null) toast.info('Site name did not match. Nothing was deleted.');
      return;
    }
    setDeletingId(installationId);
    try {
      await deleteCloudInstallation(installationId, true);
      toast.success('Installation permanently deleted.');
      await query.refetch();
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

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
          description={query.data?.length ? 'Try another search or status.' : 'Create the first Field App Complete installation.'}
          icon="building"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(({ installation, zones, electricalAssets, siteAssets, formSubmissions }) => (
            <Card key={installation.id}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={`/installhub/installations/${installation.id}`}
                  className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                >
                  <div className="min-w-0">
                    <p className="break-words font-extrabold text-[var(--text)]">{installation.siteName}</p>
                    <p className="mt-1 break-words text-sm text-[var(--text-sub)]">{installation.clientName} · {installation.siteAddress}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Updated {new Date(installation.updatedAt).toLocaleString()} · Inspector {installation.inspectorName}
                    </p>
                  </div>
                </Link>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-sub)]">
                    {zones.length} zones · {electricalAssets.length + siteAssets.length} assets · {formSubmissions.length} forms
                  </span>
                  <StatusBadge status={installation.status} />
                  <LinkButton href={`/installhub/installations/${installation.id}`} variant="secondary">
                    Open
                  </LinkButton>
                  {user?.role === 'admin' || installation.createdByUserId === user?.id ? (
                    <Button
                      variant="danger"
                      disabled={deletingId === installation.id}
                      onClick={() => void removeInstallation(installation.id, installation.siteName)}
                    >
                      <Icon name="trash" size={16} />
                      {deletingId === installation.id ? 'Deleting…' : 'Delete installation'}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
