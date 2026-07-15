import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteSite } from '@solar/api/sites';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { listRemoteSites, pullSync, type RemoteSiteSummary } from '@solar/api/sync';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@solar/components/ui/Button';
import { StatusBadge } from '@solar/components/ui/Badges';
import { Card } from '@solar/components/ui/Card';

export function RemoteSitesPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const { data: remoteSites, isLoading, error, refetch } = useQuery({
    queryKey: ['remote-sites'],
    queryFn: listRemoteSites,
  });

  async function handleImport(site: RemoteSiteSummary) {
    setImportingId(site.id);
    try {
      await pullSync('1970-01-01T00:00:00.000Z', site.id);
      await queryClient.invalidateQueries();
      toast.success(`"${site.siteName}" imported from cloud successfully.`);
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setImportingId(null);
    }
  }

  async function handleDelete(site: RemoteSiteSummary) {
    if (!confirm(`Permanently delete "${site.siteName}" from the cloud server?`)) return;
    setDeletingId(site.id);
    try {
      await deleteSite(site.id, true);
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`"${site.siteName}" deleted from cloud.`);
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading) {
    return (
      <Card className={compact ? '!p-3' : undefined}>
        <p className="text-sm text-[var(--text-sub)]">Loading server sites…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-amber-300/50 bg-amber-50 dark:bg-amber-950/20">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {cloudConnectionErrorMessage(error)}
        </p>
      </Card>
    );
  }

  if (!remoteSites?.length) return null;

  return (
    <Card className={compact ? '!p-0 overflow-hidden' : '!p-0 overflow-hidden'}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface2)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[var(--primary)]">☁</span>
          <span className="text-sm font-bold text-[var(--text)]">Available on Server</span>
          <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-bold text-[var(--primary-fg)]">
            {remoteSites.length}
          </span>
        </div>
        <span className="text-[var(--muted)]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded ? (
        <div className="border-t border-[var(--border)]">
          {remoteSites.map((site) => {
            const busy = importingId === site.id || deletingId === site.id;
            return (
              <div key={site.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--text)]">{site.siteName}</p>
                  {site.location ? <p className="text-xs text-[var(--text-sub)]">{site.location}</p> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">{site.dateOfAssessment ?? '—'}</span>
                    <StatusBadge status={site.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/solar/sites/${site.id}`}>
                    <Button variant="secondary" className="!px-3 !py-1.5 !text-xs">Open</Button>
                  </Link>
                  <Button
                    variant="primary"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={busy}
                    onClick={() => void handleImport(site)}
                  >
                    {importingId === site.id ? 'Importing…' : 'Import'}
                  </Button>
                  <Button
                    variant="danger"
                    className="!px-3 !py-1.5 !text-xs"
                    disabled={busy}
                    onClick={() => void handleDelete(site)}
                  >
                    {deletingId === site.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
