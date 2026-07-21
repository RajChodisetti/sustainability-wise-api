'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAudit } from '@/api/audits';
import { listEquipment } from '@/api/equipment';
import { listAuditPhotos, type PhotoMeta } from '@/api/photos';
import { getZone, updateZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { PhotoMetadataManager, type PdfPhotoEntry } from '@/components/photos/PhotoMetadataManager';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { EquipmentIcon, Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { EQUIPMENT_TYPES, equipmentDisplayName } from '@/lib/equipmentConfig';
import {
  normalizePhotoDescsRecord,
  normalizePhotoMetadataMap,
  parsePhotoFieldName,
  photoMetadataKey,
  photoMetadataKeyFromUploadField,
  type PhotoMetadataMap,
} from '@/lib/photoMetadata';

function mergePhotoEntries(...entryGroups: PdfPhotoEntry[][]): PdfPhotoEntry[] {
  const byKey = new Map<string, PdfPhotoEntry>();
  for (const entries of entryGroups) {
    for (const entry of entries) byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}

function zoneRegistryPhotoLabel(fieldName: string | undefined): string {
  const parsed = parsePhotoFieldName(fieldName ?? 'photos');
  if (parsed.fieldName === 'photos' && parsed.index !== undefined) return `Zone photo ${parsed.index + 1}`;
  if (parsed.index !== undefined) return `${parsed.fieldName || 'Photo'} ${parsed.index + 1}`;
  return parsed.fieldName || 'Zone photo';
}

function zoneRegistryPhotoEntries(photos: PhotoMeta[], zoneId: string): PdfPhotoEntry[] {
  return photos.flatMap((photo) => {
    const uri = typeof photo.remoteUrl === 'string' ? photo.remoteUrl : '';
    if (photo.entityId !== zoneId || !uri) return [];
    const key = photoMetadataKeyFromUploadField(photo.fieldName);
    return key ? [{ key, uri, defaultLabel: zoneRegistryPhotoLabel(photo.fieldName) }] : [];
  });
}

export default function ZoneDetailPage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const zoneQuery = useQuery({ queryKey: ['zone', zoneId], queryFn: () => getZone(zoneId!), enabled: Boolean(zoneId) });
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const photosQuery = useQuery({
    queryKey: ['audit-photos', auditId],
    queryFn: () => listAuditPhotos(auditId!),
    enabled: Boolean(auditId),
  });
  const equipmentQueries = useQueries({
    queries: EQUIPMENT_TYPES.map((equipmentType) => ({
      queryKey: ['equipment', equipmentType.slug, auditId],
      queryFn: () => listEquipment(equipmentType.slug, auditId!),
      enabled: Boolean(auditId),
    })),
  });

  if (zoneQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (zoneQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zoneQuery.error)} />;
  const zone = zoneQuery.data!;
  const isCompleted = auditQuery.data?.status === 'Completed';
  const equipmentLoading = equipmentQueries.some((equipmentQuery) => equipmentQuery.isLoading);
  const equipmentError = equipmentQueries.find((equipmentQuery) => equipmentQuery.error)?.error;
  const equipmentByType = EQUIPMENT_TYPES.map((equipmentType, index) => ({
    equipmentType,
    items: (equipmentQueries[index].data?.data ?? []).filter((item) => item.zoneId === zoneId),
  }));
  const equipmentCount = equipmentByType.reduce((total, group) => total + group.items.length, 0);
  const zonePhotoEntries = (zone.photos ?? []).flatMap((uri, index) => (typeof uri === 'string' && uri ? [{
    key: photoMetadataKey('photos', index),
    uri,
    defaultLabel: `Zone photo ${index + 1}`,
  }] : []));
  const photoEntries = mergePhotoEntries(
    zonePhotoEntries,
    zoneRegistryPhotoEntries(photosQuery.data?.data ?? [], zone.id),
  );

  async function savePhotoMetadata(photoDescs: PhotoMetadataMap) {
    try {
      await updateZone(zoneId!, { photoDescs: normalizePhotoMetadataMap(photoDescs) });
      await queryClient.invalidateQueries({ queryKey: ['zone', zoneId] });
      await queryClient.invalidateQueries({ queryKey: ['audit-photos', auditId] });
      toast.success('Zone PDF photo settings saved.');
    } catch (error) {
      toast.error(cloudConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <PageHeader
        title={zone.zoneName}
        subtitle="Zone workspace: zone photos and all equipment assigned to this zone."
        actions={
          <>
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}/edit`}>Edit zone &amp; photos</LinkButton> : null}
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back to audit</LinkButton>
          </>
        }
      />

      <Card className="mb-5">
        <h2 className="font-semibold">Zone details</h2>
        <p className="mt-2 text-sm text-[var(--text-sub)]">{zone.zoneDescription || 'No description.'}</p>
      </Card>

      {photoEntries.length > 0 ? (
        <Card className="mb-5">
          <PhotoMetadataManager
            photos={photoEntries}
            initialMetadata={normalizePhotoDescsRecord(zone)}
            disabled={isCompleted}
            onSave={savePhotoMetadata}
          />
        </Card>
      ) : (
        <Card className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Zone photos</h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">No zone photos have been added.</p>
            </div>
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}/edit`} variant="secondary"><Icon name="camera" size={17} />Add photos</LinkButton> : null}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold">Equipment in {zone.zoneName}</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">{equipmentCount} equipment record{equipmentCount === 1 ? '' : 's'} assigned to this zone.</p>
          </div>
          <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-bold text-[var(--primary)]">{equipmentCount} total</span>
        </div>

        {equipmentLoading ? <Spinner label="Loading equipment…" /> : null}
        {equipmentError ? <ErrorBanner message={cloudConnectionErrorMessage(equipmentError)} /> : null}
        {!equipmentLoading && !equipmentError ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {equipmentByType.map(({ equipmentType, items }) => (
              <section key={equipmentType.slug} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4" aria-labelledby={`zone-${zoneId}-${equipmentType.slug}`}>
                <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
                  <div className="flex min-h-11 items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]"><EquipmentIcon slug={equipmentType.slug} /></span>
                    <div>
                      <h3 id={`zone-${zoneId}-${equipmentType.slug}`} className="font-bold">{equipmentType.label}</h3>
                      <p className="text-xs text-[var(--text-sub)]">{items.length} item{items.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                  {!isCompleted ? (
                    <LinkButton
                      href={`/ecoaudit/audits/${auditId}/equipment/${equipmentType.slug}/new?zoneId=${encodeURIComponent(zoneId)}`}
                      variant="secondary"
                      className="!px-3"
                    >
                      <Icon name="plus" size={16} />Add
                    </LinkButton>
                  ) : null}
                </div>

                {items.length === 0 ? (
                  <p className="text-sm text-[var(--text-sub)]">Nothing recorded in this category.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => (
                      <Link
                        key={item.id}
                        href={`/ecoaudit/audits/${auditId}/equipment/${equipmentType.slug}/${item.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        <span className="min-w-0 break-words">{equipmentDisplayName(item, equipmentType)}</span>
                        <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
