'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getAudit } from '@/api/audits';
import { deleteZone, getZone, updateZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { PhotoGridField } from '@/components/photos/PhotoField';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import type { Zone } from '@/types/domain';
import { normalizePhotoMetadataMap } from '@/lib/photoMetadata';

export default function EditZonePage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zoneQuery = useQuery({ queryKey: ['zone', zoneId], queryFn: () => getZone(zoneId!), enabled: Boolean(zoneId) });

  if (zoneQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (zoneQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zoneQuery.error)} />;
  if (!zoneQuery.data) return <ErrorBanner message="Zone not found." />;

  return (
    <ZoneEditForm
      key={zoneQuery.data.id}
      auditId={auditId}
      zoneId={zoneId}
      zone={zoneQuery.data}
      isCompleted={auditQuery.data?.status === 'Completed'}
    />
  );
}

function ZoneEditForm({
  auditId,
  zoneId,
  zone,
  isCompleted,
}: {
  auditId: string;
  zoneId: string;
  zone: Zone;
  isCompleted: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [zoneName, setZoneName] = useState(zone.zoneName);
  const [zoneDescription, setZoneDescription] = useState(zone.zoneDescription ?? '');
  const [photos, setPhotos] = useState<string[]>(zone.photos ?? []);
  const [photoDescs, setPhotoDescs] = useState(() => normalizePhotoMetadataMap(zone.photoDescs));
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateZone(zoneId!, { zoneName, zoneDescription, photos, photoDescs });
      toast.success('Zone saved.');
      router.push(`/ecoaudit/audits/${auditId}/zones/${zoneId}`);
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this zone?')) return;
    try {
      await deleteZone(zoneId!);
      toast.success('Zone deleted.');
      router.push(`/ecoaudit/audits/${auditId}`);
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title="Edit zone" actions={<LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}`} variant="secondary">Back</LinkButton>} />
      <Card className="max-w-2xl">
        <form onSubmit={handleSave}>
          <FieldLabel>Zone name</FieldLabel>
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} disabled={isCompleted} required />
          <FieldLabel>Description</FieldLabel>
          <Textarea value={zoneDescription} onChange={(e) => setZoneDescription(e.target.value)} disabled={isCompleted} />
          <div className="mt-4">
            <PhotoGridField
              label="Zone photos"
              uris={photos}
              auditId={auditId!}
              entityId={zoneId}
              entityType="zone"
              fieldPrefix="photos"
              onChange={setPhotos}
              photoMetadata={photoDescs}
              onPhotoMetadataChange={setPhotoDescs}
              disabled={isCompleted}
            />
          </div>
          {!isCompleted ? (
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              <Button type="button" variant="danger" onClick={() => void handleDelete()}>Delete</Button>
            </div>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
