'use client';

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

export default function AuditPhotosPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const toast = useToast();
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const photosQuery = useQuery({ queryKey: ['audit-photos', auditId], queryFn: () => listAuditPhotos(auditId!), enabled: Boolean(auditId) });

  if (photosQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (photosQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(photosQuery.error)} />;
  const photos = photosQuery.data?.data ?? [];

  async function handleExport() {
    try {
      const blob = await exportPhotosZip(auditId!);
      downloadBlob(blob, `${slugify(auditQuery.data?.siteName ?? 'audit')}-photos.zip`);
      toast.success('Photo ZIP downloaded.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Audit photos"
        subtitle={`${photos.length} photo${photos.length === 1 ? '' : 's'} registered for this audit.`}
        actions={
          <>
            <Button variant="secondary" onClick={() => void handleExport()}><Icon name="file-text" size={17} />Export ZIP</Button>
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      {photos.length === 0 ? (
        <EmptyState title="No photos yet" description="Upload photos on zones or equipment records." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => {
            const uri = p.remoteUrl || p.id;
            return (
              <Card key={p.id} className="overflow-hidden !p-3">
                <PhotoThumb uri={uri} label={p.fieldName ?? 'Photo'} className="mb-2 w-full rounded-lg object-cover" />
                <p className="mt-2 text-xs font-bold text-[var(--text-sub)]">{p.fieldName}</p>
                <p className="mt-0.5 break-all text-xs text-[var(--muted)]">{p.originalFilename}</p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
