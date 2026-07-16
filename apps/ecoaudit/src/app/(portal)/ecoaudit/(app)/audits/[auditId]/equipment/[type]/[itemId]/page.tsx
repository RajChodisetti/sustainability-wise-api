'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getEquipment } from '@/api/equipment';
import { getZone } from '@/api/zones';
import { getEquipmentConfig, equipmentDisplayName } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import {
  normalizePhotoMetadataMap,
  photoDisplayName,
  photoMetadataKey,
} from '@/lib/photoMetadata';

export default function EquipmentDetailPage() {
  const { auditId, type, itemId } = useParams<{ auditId: string; type: string; itemId: string }>();
  const config = getEquipmentConfig(type!);
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
  if (query.isLoading || (zoneId && zoneQuery.isLoading)) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const item = query.data!;
  const zoneName = zoneQuery.data?.zoneName ?? (zoneQuery.error ? 'Zone unavailable' : 'Unzoned or unavailable');
  const photoMetadata = normalizePhotoMetadataMap(item.photoDescs);

  const photoFields = config.fields.filter((f) => f.kind === 'photo' || f.kind === 'photos');
  const hasAnyPhoto = photoFields.some((f) => {
    const val = item[f.key];
    if (f.kind === 'photos') return Array.isArray(val) && val.length > 0;
    return typeof val === 'string' && val.length > 0;
  });

  return (
    <div>
      <PageHeader
        title={equipmentDisplayName(item, config)}
        subtitle={`Zone: ${zoneName}`}
        actions={
          <>
            <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}/edit`}>Edit</LinkButton>
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
      {photoFields.length > 0 && hasAnyPhoto ? (
        <Card>
          <h2 className="mb-3 font-semibold">Photos</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {photoFields.map((f) => {
              const val = item[f.key];
              if (f.kind === 'photos' && Array.isArray(val)) {
                return val.map((uri, i) => (
                  <div key={`${f.key}-${i}`}>
                    <p className="mb-1 text-xs text-[var(--text-sub)]">
                      {photoDisplayName(`${f.label} ${i + 1}`, photoMetadata[photoMetadataKey(f.key, i)])}
                    </p>
                    <PhotoThumb uri={uri as string} label={photoDisplayName(`${f.label} ${i + 1}`, photoMetadata[photoMetadataKey(f.key, i)])} />
                  </div>
                ));
              }
              if (typeof val === 'string' && val) {
                const photoLabel = photoDisplayName(f.label, photoMetadata[f.key]);
                return (
                  <div key={f.key}>
                    <p className="mb-1 text-xs text-[var(--text-sub)]">{photoLabel}</p>
                    <PhotoThumb uri={val} label={photoLabel} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
