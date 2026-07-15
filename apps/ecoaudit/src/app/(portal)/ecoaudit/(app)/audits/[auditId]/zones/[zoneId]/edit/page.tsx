'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getAudit } from '@/api/audits';
import { deleteZone, getZone, updateZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { PhotoGridField } from '@/components/photos/PhotoField';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';

export default function EditZonePage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const router = useRouter();
  const toast = useToast();
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zoneQuery = useQuery({ queryKey: ['zone', zoneId], queryFn: () => getZone(zoneId!), enabled: Boolean(zoneId) });

  const [zoneName, setZoneName] = useState('');
  const [zoneDescription, setZoneDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const z = zoneQuery.data;
    if (!z) return;
    setZoneName(z.zoneName);
    setZoneDescription(z.zoneDescription ?? '');
    setPhotos(z.photos ?? []);
  }, [zoneQuery.data]);

  if (zoneQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (zoneQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zoneQuery.error)} />;
  const isCompleted = auditQuery.data?.status === 'Completed';

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateZone(zoneId!, { zoneName, zoneDescription, photos });
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
      <PageHeader title="Edit zone" actions={<Link href={`/ecoaudit/audits/${auditId}/zones/${zoneId}`} className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-2xl">
        <form onSubmit={handleSave}>
          <FieldLabel>Zone name</FieldLabel>
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} disabled={isCompleted} required />
          <FieldLabel>Description</FieldLabel>
          <Textarea value={zoneDescription} onChange={(e) => setZoneDescription(e.target.value)} disabled={isCompleted} />
          <div className="mt-4">
            <PhotoGridField label="Zone photos" uris={photos} auditId={auditId!} entityId={zoneId} entityType="zone" fieldPrefix="photos" onChange={setPhotos} disabled={isCompleted} />
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
