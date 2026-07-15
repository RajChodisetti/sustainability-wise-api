'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listZones } from '@/api/zones';
import { createEquipment } from '@/api/equipment';
import { getEquipmentConfig } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { EquipmentFormFields } from '@/components/equipment/EquipmentFormFields';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';

export default function NewEquipmentPage() {
  const { auditId, type } = useParams<{ auditId: string; type: string }>();
  const router = useRouter();
  const toast = useToast();
  const config = getEquipmentConfig(type!);
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });

  const [zoneId, setZoneId] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (zonesQuery.isLoading) return <Spinner />;
  const zones = zonesQuery.data?.data ?? [];

  function onChange(key: string, value: unknown) {
    setValues((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!zoneId) { toast.error('Select a zone.'); return; }
    setBusy(true);
    try {
      const item = await createEquipment(type!, auditId!, { ...values, zoneId, auditId });
      toast.success(`${config!.label} created.`);
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}/edit`);
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={`New ${config.label.slice(0, -1)}`} actions={<LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}`} variant="secondary">Back</LinkButton>} />
      <Card>
        <form onSubmit={handleSubmit}>
          <FieldLabel>Zone *</FieldLabel>
          <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
            <option value="">Select zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.zoneName}</option>)}
          </Select>
          <EquipmentFormFields config={config} values={values} onChange={onChange} auditId={auditId!} />
          <Button type="submit" className="mt-4" disabled={busy || zones.length === 0}>{busy ? 'Saving…' : 'Create'}</Button>
        </form>
      </Card>
    </div>
  );
}
