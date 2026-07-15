'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function ZoneDetailPage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const query = useQuery({ queryKey: ['zone', zoneId], queryFn: () => getZone(zoneId!), enabled: Boolean(zoneId) });

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  const zone = query.data!;

  return (
    <div>
      <PageHeader
        title={zone.zoneName}
        actions={
          <>
            <Link href={`/ecoaudit/audits/${auditId}/zones/${zoneId}/edit`}><Button>Edit</Button></Link>
            <Link href={`/ecoaudit/audits/${auditId}`} className="text-sm text-[var(--primary)]">Back to audit</Link>
          </>
        }
      />
      <Card>
        <p className="text-sm text-[var(--text-sub)]">{zone.zoneDescription || 'No description.'}</p>
        {zone.photos?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {zone.photos.map((uri, i) => (
              <PhotoThumb key={i} uri={uri} label={`Zone photo ${i + 1}`} className="rounded-lg object-cover" />
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
