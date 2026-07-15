'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createZone } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';

export default function NewZonePage() {
  const { auditId } = useParams<{ auditId: string }>();
  const router = useRouter();
  const toast = useToast();
  const [zoneName, setZoneName] = useState('');
  const [zoneDescription, setZoneDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auditId) return;
    setBusy(true);
    try {
      const zone = await createZone(auditId, { zoneName, zoneDescription, photos: [] });
      toast.success('Zone created.');
      router.push(`/ecoaudit/audits/${auditId}/zones/${zone.id}/edit`);
    } catch (err) {
      const msg = cloudConnectionErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="New zone" actions={<LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>} />
      <Card className="max-w-xl">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Zone name *</FieldLabel>
          <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} required />
          <FieldLabel>Description</FieldLabel>
          <Textarea value={zoneDescription} onChange={(e) => setZoneDescription(e.target.value)} />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <Button type="submit" className="mt-4" disabled={busy}>{busy ? 'Saving…' : 'Create zone'}</Button>
        </form>
      </Card>
    </div>
  );
}
