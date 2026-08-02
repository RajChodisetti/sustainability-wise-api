'use client';

import Link from 'next/link';
import { LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { useInstallationTrees } from '@/modules/installhub/hooks/useInstallationTree';

export function InstallHubDashboardPage() {
  const treesQuery = useInstallationTrees();
  if (treesQuery.isLoading) return <Spinner label="Loading Field App Complete…" />;
  if (treesQuery.error) return <ErrorBanner message={installHubConnectionErrorMessage(treesQuery.error)} />;

  const trees = [...(treesQuery.data ?? [])].sort(
    (a, b) => Date.parse(b.installation.updatedAt) - Date.parse(a.installation.updatedAt),
  );
  const drafts = trees.filter((tree) => tree.installation.status !== 'Completed').length;
  const completed = trees.length - drafts;
  const forms = trees.reduce((total, tree) => total + tree.formSubmissions.length, 0);

  return (
    <div>
      <PageHeader
        title="Field App Complete dashboard"
        subtitle="Cloud-backed installation, commissioning, evidence, and handover workflows."
        actions={
          <LinkButton href="/installhub/installations/new">
            <Icon name="plus" size={18} />
            New installation
          </LinkButton>
        }
      />
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Installations" value={trees.length} icon="building" />
        <StatCard label="Draft" value={drafts} icon="file-text" tone="warning" />
        <StatCard label="Completed" value={completed} icon="check" tone="success" />
        <StatCard label="Field forms" value={forms} icon="clipboard" />
      </div>

      <section aria-labelledby="recent-installations">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-installations" className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">
              Recent installations
            </h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">The same secure cloud trees used by the iOS app.</p>
          </div>
          {trees.length ? <LinkButton href="/installhub/installations" variant="ghost">View all</LinkButton> : null}
        </div>
        {trees.length === 0 ? (
          <EmptyState
            title="No cloud installations yet"
            description="Create an installation here, or enable Cloud Backup in the iOS app to make mobile work available in the portal."
            icon="tool"
            actions={<LinkButton href="/installhub/installations/new">Create installation</LinkButton>}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {trees.slice(0, 6).map(({ installation, zones, electricalAssets, siteAssets }) => (
              <Link key={installation.id} href={`/installhub/installations/${installation.id}`} className="block">
                <Card className="interactive-card h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-extrabold text-[var(--text)]">{installation.siteName}</p>
                      <p className="mt-1 break-words text-sm text-[var(--text-sub)]">{installation.clientName}</p>
                      <p className="mt-1 break-words text-xs text-[var(--muted)]">{installation.siteAddress}</p>
                    </div>
                    <StatusBadge status={installation.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 border-t border-[var(--border)] pt-3 text-xs font-semibold text-[var(--text-sub)]">
                    <span>{zones.length} zones</span>
                    <span>{electricalAssets.length} boards</span>
                    <span>{siteAssets.length} assets</span>
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
