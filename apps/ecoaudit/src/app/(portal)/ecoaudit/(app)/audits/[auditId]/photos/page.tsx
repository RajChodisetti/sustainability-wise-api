'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listAuditPhotos, startPhotosZipJob, type PhotoZipMode } from '@/api/photos';
import { downloadExportJob, getExportJobStatus, getLatestExportJob } from '@/api/pdf';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { slugify } from '@/lib/download';
import { useExportJob } from '@/hooks/useExportJob';
import { getAudit } from '@/api/audits';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EQUIPMENT_TYPES } from '@/lib/equipmentConfig';

export default function AuditPhotosPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const toast = useToast();
  const [zipMode, setZipMode] = useState<PhotoZipMode>('by-zone');
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const photosQuery = useQuery({ queryKey: ['audit-photos', auditId], queryFn: () => listAuditPhotos(auditId!), enabled: Boolean(auditId) });
  const zipJob = useExportJob({
    scopeKey: ['ecoaudit', auditId ?? '', 'photos-zip'],
    loadLatest: () => getLatestExportJob(auditId!, 'photos-zip'),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id, job.contentType),
    fallbackFilename: `${slugify(auditQuery.data?.siteName ?? 'audit')}-${zipMode === 'by-zone' ? 'zone' : 'equipment'}-photos.zip`,
  });

  if (photosQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (photosQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(photosQuery.error)} />;
  if (auditQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditQuery.error)} />;
  const photos = photosQuery.data?.data ?? [];

  async function handleExport() {
    if (zipJob.active || zipJob.starting || photos.length === 0) return;
    try {
      await zipJob.start(() => startPhotosZipJob(auditId!, zipMode));
      toast.success('Photo ZIP preparation started. The download will appear here when it is ready.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  async function handleDownload() {
    try {
      await zipJob.download();
      toast.success('Photo ZIP download started.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
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
              disabled={zipJob.starting || zipJob.active || photos.length === 0}
              aria-busy={zipJob.starting || zipJob.active}
            >
              {zipJob.starting || zipJob.active ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                  Preparing ZIP...
                </>
              ) : (
                <><Icon name="file-text" size={17} />Export ZIP</>
              )}
            </Button>
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      <div className="mb-5 max-w-xs">
        <FieldLabel htmlFor="zip-folder-mode">ZIP folder structure</FieldLabel>
        <Select
          id="zip-folder-mode"
          value={zipMode}
          onChange={(event) => setZipMode(event.target.value as PhotoZipMode)}
          disabled={zipJob.starting || zipJob.active}
        >
          <option value="by-zone">By zone</option>
          <option value="by-equipment">By equipment</option>
        </Select>
      </div>
      <ExportJobStatus
        job={zipJob.job}
        artifactName="photo ZIP"
        starting={zipJob.starting}
        downloading={zipJob.downloading}
        onDownload={() => void handleDownload()}
        className="mb-5"
      />
      {zipJob.error ? <div className="mb-5"><ErrorBanner message={cloudConnectionErrorMessage(zipJob.error)} /></div> : null}
      {photos.length === 0 ? (
        <EmptyState title="No photos yet" description="Upload photos on zones or equipment records." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => {
            const uri = p.remoteUrl || p.id;
            const caption = p.caption?.trim() || '';
            const displayName = caption || p.fieldName || 'Photo';
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
                <PhotoThumb uri={uri} label={displayName} className="mb-2 w-full rounded-lg object-cover" />
                <p className="mt-2 text-sm font-bold text-[var(--text)]">{displayName}</p>
                {caption && p.fieldName ? (
                  <p className="mt-0.5 text-xs text-[var(--text-sub)]">{p.fieldName}</p>
                ) : null}
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
