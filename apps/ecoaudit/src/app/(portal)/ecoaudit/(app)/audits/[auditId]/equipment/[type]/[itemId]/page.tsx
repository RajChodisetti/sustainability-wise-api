'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAudit } from '@/api/audits';
import { getEquipment, updateEquipment } from '@/api/equipment';
import { getZone } from '@/api/zones';
import { getEquipmentConfig, equipmentDisplayName } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { PhotoMetadataManager } from '@/components/photos/PhotoMetadataManager';
import { LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { photoMetadataKey, type PhotoMetadataMap } from '@/lib/photoMetadata';

export default function EquipmentDetailPage() {
  const { auditId, type, itemId } = useParams<{ auditId: string; type: string; itemId: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const config = getEquipmentConfig(type!);
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const query = useQuery({
    queryKey: ['equipment', type, itemId],
    queryFn: () => getEquipment(type!, itemId!),
    enabled: Boolean(type && itemId),
  });
  const zoneId = query.data?.zoneId;
  const zoneQuery = useQuery({
    queryKey: ['zone', zoneId],
    queryFn: () => getZone(zoneId!),
    enabled: Boolean(zoneId),
  });

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (query.isLoading || auditQuery.isLoading || (zoneId && zoneQuery.isLoading)) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const item = query.data!;
  const zoneName = zoneQuery.data?.zoneName ?? (zoneQuery.error ? 'Zone unavailable' : 'Unzoned or unavailable');
  const isCompleted = auditQuery.data?.status === 'Completed';

  const photoFields = config.fields.filter((f) => f.kind === 'photo' || f.kind === 'photos');
  const photoEntries = photoFields.flatMap((f) => {
    const val = item[f.key];
    if (f.kind === 'photos' && Array.isArray(val)) {
      return val.flatMap((uri, index) => typeof uri === 'string' && uri ? [{ key: photoMetadataKey(f.key, index), uri, defaultLabel: `${f.label} ${index + 1}` }] : []);
    }
    return typeof val === 'string' && val ? [{ key: f.key, uri: val, defaultLabel: f.label }] : [];
  });

  async function savePhotoMetadata(photoDescs: PhotoMetadataMap) {
    try {
      await updateEquipment(type!, itemId!, { photoDescs });
      await queryClient.invalidateQueries({ queryKey: ['equipment', type, itemId] });
      toast.success('Equipment PDF photo settings saved.');
    } catch (error) {
      toast.error(cloudConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <PageHeader
        title={equipmentDisplayName(item, config)}
        subtitle={`Zone: ${zoneName}`}
        actions={
          <>
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}/edit`}>Edit equipment &amp; photos</LinkButton> : null}
            {zoneId ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}`} variant="secondary">Open zone</LinkButton> : null}
            <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      <Card className="mb-4">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2.5 text-sm font-bold text-[var(--primary)]">
          <Icon name="building" size={17} />
          <span>Zone: {zoneName}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {config.fields.filter((f) => f.kind !== 'photo' && f.kind !== 'photos').map((f) => (
            <div key={f.key}>
              <p className="text-xs text-[var(--text-sub)]">{f.label}</p>
              <p className="text-sm">{String(item[f.key] ?? '—')}</p>
            </div>
          ))}
        </div>
      </Card>
      {photoEntries.length > 0 ? (
        <Card>
          <PhotoMetadataManager
            photos={photoEntries}
            initialMetadata={item.photoDescs}
            disabled={isCompleted}
            onSave={savePhotoMetadata}
          />
        </Card>
      ) : null}
    </div>
  );
}
