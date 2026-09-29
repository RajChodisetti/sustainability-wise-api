'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import { useAuditAuthority } from '@/hooks/useAuditAuthority';
import { AuditAuthorityBanner } from '@/components/audits/AuditAuthorityBanner';
import { auditProtocolErrorMessage } from '@/lib/auditProtocol';

export default function NewEquipmentPage() {
  const { auditId, type } = useParams<{ auditId: string; type: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const config = getEquipmentConfig(type!);
  const authority = useAuditAuthority(auditId);
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId && authority.authoritativeReady), staleTime: 0, refetchOnMount: 'always' });

  const [zoneId, setZoneId] = useState(() => searchParams.get('zoneId') ?? '');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (authority.query.error) return <ErrorBanner message={cloudConnectionErrorMessage(authority.query.error)} />;
  if (!authority.authoritativeReady || zonesQuery.isFetching) return <Spinner label="Checking editing access…" />;
  if (!authority.audit || !authority.state) return <ErrorBanner message="Audit not found." />;
  const zones = zonesQuery.data?.data ?? [];
  const selectedZone = zones.find((zone) => zone.id === zoneId);

  function onChange(key: string, value: unknown) {
    setValues((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!zoneId) { toast.error('Select a zone.'); return; }
    if (!authority.guard) return;
    setBusy(true);
    try {
      const item = await createEquipment(type!, auditId!, { ...values, zoneId, auditId }, authority.guard);
      if (!await authority.refreshAndAccept()) {
        throw new Error('The record was created, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success(`${config!.label} created.`);
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}/edit`);
    } catch (err) {
      toast.error(auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`New ${config.label}`}
        subtitle={selectedZone ? `This record will be added to ${selectedZone.zoneName}.` : 'Select the zone this equipment belongs to.'}
        actions={<LinkButton href={selectedZone ? `/ecoaudit/audits/${auditId}/zones/${selectedZone.id}` : `/ecoaudit/audits/${auditId}/equipment/${type}`} variant="secondary">Back</LinkButton>}
      />
      <AuditAuthorityBanner
        state={authority.state}
        lease={authority.audit.editLease}
        changedSinceOpen={authority.changedSinceOpen}
        onRefresh={() => void authority.refreshAndAccept()}
        refreshing={authority.query.isFetching}
      />
      {authority.guard ? <Card>
        <form onSubmit={handleSubmit}>
          <FieldLabel>Zone *</FieldLabel>
          <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
            <option value="">Select zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.zoneName}</option>)}
          </Select>
          <EquipmentFormFields config={config} values={values} onChange={onChange} auditId={auditId!} guard={authority.guard} />
          <Button type="submit" className="mt-4" disabled={busy || zones.length === 0}>{busy ? 'Saving…' : 'Create'}</Button>
        </form>
      </Card> : null}
    </div>
  );
}
