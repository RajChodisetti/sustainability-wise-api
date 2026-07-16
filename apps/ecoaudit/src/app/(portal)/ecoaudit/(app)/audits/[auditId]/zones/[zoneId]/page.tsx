'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { normalizePhotoMetadataMap, photoDisplayName, photoMetadataKey } from '@/lib/photoMetadata';

export default function ZoneDetailPage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const query = useQuery({ queryKey: ['zone', zoneId], queryFn: () => getZone(zoneId!), enabled: Boolean(zoneId) });

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const zone = query.data!;
  const photoMetadata = normalizePhotoMetadataMap(zone.photoDescs);

  return (
    <div>
      <PageHeader
        title={zone.zoneName}
        actions={
          <>
            <LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}/edit`}>Edit</LinkButton>
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back to audit</LinkButton>
          </>
        }
      />
      <Card>
        <p className="text-sm text-[var(--text-sub)]">{zone.zoneDescription || 'No description.'}</p>
        {zone.photos?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {zone.photos.map((uri, i) => (
              <div key={`${uri}-${i}`}>
                <p className="mb-1 text-xs font-semibold text-[var(--text-sub)]">
                  {photoDisplayName(`Zone photo ${i + 1}`, photoMetadata[photoMetadataKey('photos', i)])}
                </p>
                <PhotoThumb
                  uri={uri}
                  label={photoDisplayName(`Zone photo ${i + 1}`, photoMetadata[photoMetadataKey('photos', i)])}
                  className="rounded-lg border border-[var(--border)] object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
