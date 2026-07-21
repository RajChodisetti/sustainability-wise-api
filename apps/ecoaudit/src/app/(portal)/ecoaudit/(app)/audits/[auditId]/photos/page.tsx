'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listAuditPhotos, exportPhotosZip } from '@/api/photos';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { downloadBlob, slugify } from '@/lib/download';
import { getAudit } from '@/api/audits';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EQUIPMENT_TYPES } from '@/lib/equipmentConfig';

export default function AuditPhotosPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const toast = useToast();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const photosQuery = useQuery({ queryKey: ['audit-photos', auditId], queryFn: () => listAuditPhotos(auditId!), enabled: Boolean(auditId) });

  if (photosQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (photosQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(photosQuery.error)} />;
  const photos = photosQuery.data?.data ?? [];

  async function handleExport() {
    if (exportBusy || photos.length === 0) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const blob = await exportPhotosZip(auditId!);
      downloadBlob(blob, `${slugify(auditQuery.data?.siteName ?? 'audit')}-photos.zip`);
      toast.success('Photo ZIP is ready. Your browser download has started.');
    } catch (e) {
      const message = cloudConnectionErrorMessage(e);
      setExportError(message);
      toast.error(message);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Audit photos"
        subtitle={`${photos.length} photo${photos.length === 1 ? '' : 's'} registered. Open the owning zone or equipment record to edit its PDF caption and large/compact size.`}
        actions={
          <>
            <Button
              variant="secondary"
              className="min-w-[9.75rem]"
              onClick={() => void handleExport()}
              disabled={exportBusy || photos.length === 0}
              aria-busy={exportBusy}
            >
              {exportBusy ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                  Preparing ZIP…
                </>
              ) : (
                <><Icon name="file-text" size={17} />Export ZIP</>
              )}
            </Button>
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      {exportBusy ? (
        <div
          className="mb-5 flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-4 py-3.5 text-sm text-[var(--primary)]"
          role="status"
          aria-live="polite"
        >
          <span className="mt-1 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
          <div>
            <p className="font-bold">Preparing photo ZIP</p>
            <p className="mt-0.5 leading-6 text-[var(--text-sub)]">
              Large audits can take a minute. Keep this tab open and the download will start automatically.
            </p>
          </div>
        </div>
      ) : null}
      {exportError ? <div className="mb-5"><ErrorBanner message={exportError} /></div> : null}
      {photos.length === 0 ? (
        <EmptyState title="No photos yet" description="Upload photos on zones or equipment records." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => {
            const uri = p.remoteUrl || p.id;
            const equipmentType = EQUIPMENT_TYPES.find((candidate) => candidate.entityType === p.entityType);
            const settingsHref = p.entityId
              ? p.entityType === 'zone'
                ? `/ecoaudit/audits/${auditId}/zones/${p.entityId}`
                : equipmentType
                  ? `/ecoaudit/audits/${auditId}/equipment/${equipmentType.slug}/${p.entityId}`
                  : null
              : null;
            return (
              <Card key={p.id} className="overflow-hidden !p-3">
                <PhotoThumb uri={uri} label={p.fieldName ?? 'Photo'} className="mb-2 w-full rounded-lg object-cover" />
                <p className="mt-2 text-xs font-bold text-[var(--text-sub)]">{p.fieldName}</p>
                <p className="mt-0.5 break-all text-xs text-[var(--muted)]">{p.originalFilename}</p>
                {settingsHref ? (
                  <LinkButton href={settingsHref} variant="secondary" className="mt-3 w-full !px-3 !text-xs">
                    Edit PDF caption &amp; size
                  </LinkButton>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
