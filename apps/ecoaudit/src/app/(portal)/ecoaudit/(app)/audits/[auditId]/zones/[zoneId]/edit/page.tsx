'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { deleteZone, getZone, updateZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { PhotoGridField } from '@/components/photos/PhotoField';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import type { AuditTree, AuditWriteGuard, Zone } from '@/types/domain';
import { normalizePhotoDescsRecord, normalizePhotoMetadataMap } from '@/lib/photoMetadata';
import { useAuditAuthority } from '@/hooks/useAuditAuthority';
import { AuditAuthorityBanner } from '@/components/audits/AuditAuthorityBanner';
import { auditProtocolErrorMessage } from '@/lib/auditProtocol';

export default function EditZonePage() {
  const { auditId, zoneId } = useParams<{ auditId: string; zoneId: string }>();
  const authority = useAuditAuthority(auditId);
  const zoneQuery = useQuery({
    queryKey: ['zone', zoneId],
    queryFn: () => getZone(zoneId!),
    enabled: Boolean(zoneId && authority.authoritativeReady),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (authority.query.error) return <ErrorBanner message={cloudConnectionErrorMessage(authority.query.error)} />;
  if (!authority.authoritativeReady || zoneQuery.isFetching) return <Spinner label="Checking editing access…" />;
  if (zoneQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zoneQuery.error)} />;
  if (!zoneQuery.data || !authority.audit || !authority.state) return <ErrorBanner message="Zone not found." />;

  return (
    <div>
      <PageHeader title="Edit zone" actions={<LinkButton href={`/ecoaudit/audits/${auditId}/zones/${zoneId}`} variant="secondary">Back</LinkButton>} />
      <AuditAuthorityBanner
        state={authority.state}
        lease={authority.audit.editLease}
        changedSinceOpen={authority.changedSinceOpen}
        onRefresh={() => void authority.refreshAndAccept()}
        refreshing={authority.query.isFetching}
      />
      {authority.guard ? (
        <ZoneEditForm
          key={`${zoneQuery.data.id}-${authority.openedRevision}`}
          auditId={auditId}
          zoneId={zoneId}
          zone={zoneQuery.data}
          guard={authority.guard}
          onMutationAccepted={authority.refreshAndAccept}
        />
      ) : null}
    </div>
  );
}

function ZoneEditForm({
  auditId,
  zoneId,
  zone,
  guard,
  onMutationAccepted,
}: {
  auditId: string;
  zoneId: string;
  zone: Zone;
  guard: AuditWriteGuard;
  onMutationAccepted: () => Promise<AuditTree | null>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [zoneName, setZoneName] = useState(zone.zoneName);
  const [zoneDescription, setZoneDescription] = useState(zone.zoneDescription ?? '');
  const [photos, setPhotos] = useState<string[]>(zone.photos ?? []);
  const [photoDescs, setPhotoDescs] = useState(() => normalizePhotoDescsRecord(zone));
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateZone(zoneId!, { zoneName, zoneDescription, photos, photoDescs: normalizePhotoMetadataMap(photoDescs) }, guard);
      if (!await onMutationAccepted()) {
        throw new Error('The zone was saved, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success('Zone saved.');
      router.push(`/ecoaudit/audits/${auditId}/zones/${zoneId}`);
    } catch (err) {
      toast.error(auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this zone?')) return;
    try {
      await deleteZone(zoneId!, guard);
      if (!await onMutationAccepted()) {
        throw new Error('The zone was deleted, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success('Zone deleted.');
      router.push(`/ecoaudit/audits/${auditId}`);
    } catch (err) {
      toast.error(auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err));
    }
  }

  return (
    <Card className="max-w-2xl">
        <form onSubmit={handleSave}>
          <FieldLabel>Zone name</FieldLabel>
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} required />
          <FieldLabel>Description</FieldLabel>
          <Textarea value={zoneDescription} onChange={(e) => setZoneDescription(e.target.value)} />
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
              guard={guard}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button type="button" variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </div>
        </form>
    </Card>
  );
}
