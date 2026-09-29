'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { deleteEquipment, getEquipment, updateEquipment } from '@/api/equipment';
import { getEquipmentConfig, getWaterAssetConfig } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { EquipmentFormFields } from '@/components/equipment/EquipmentFormFields';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import type { AuditTree, AuditWriteGuard } from '@/types/domain';
import { useAuditAuthority } from '@/hooks/useAuditAuthority';
import { AuditAuthorityBanner } from '@/components/audits/AuditAuthorityBanner';
import { auditProtocolErrorMessage } from '@/lib/auditProtocol';

export default function EditEquipmentPage() {
  const { auditId, type, itemId } = useParams<{ auditId: string; type: string; itemId: string }>();
  const routeConfig = getEquipmentConfig(type!);
  const authority = useAuditAuthority(auditId);
  const itemQuery = useQuery({ queryKey: ['equipment', type, itemId], queryFn: () => getEquipment(type!, itemId!), enabled: Boolean(type && itemId && authority.authoritativeReady), staleTime: 0, refetchOnMount: 'always' });

  if (!routeConfig) return <ErrorBanner message="Unknown equipment type." />;
  if (authority.query.error) return <ErrorBanner message={cloudConnectionErrorMessage(authority.query.error)} />;
  if (!authority.authoritativeReady || itemQuery.isFetching) return <Spinner label="Checking editing access…" />;
  if (itemQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(itemQuery.error)} />;
  if (!itemQuery.data || !authority.audit || !authority.state) return <ErrorBanner message="Equipment record not found." />;

  return (
    <div>
      <PageHeader title={`Edit ${(getWaterAssetConfig(itemQuery.data.assetType) ?? routeConfig).label.slice(0, -1)}`} actions={<LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}`} variant="secondary">Back</LinkButton>} />
      <AuditAuthorityBanner
        state={authority.state}
        lease={authority.audit.editLease}
        changedSinceOpen={authority.changedSinceOpen}
        onRefresh={() => void authority.refreshAndAccept()}
        refreshing={authority.query.isFetching}
      />
      {authority.guard ? (
        <EquipmentEditForm
          key={`${itemQuery.data.id}-${authority.openedRevision}`}
          auditId={auditId}
          type={getWaterAssetConfig(itemQuery.data.assetType)?.slug ?? type}
          itemId={itemId}
          config={getWaterAssetConfig(itemQuery.data.assetType) ?? routeConfig}
          initialValues={itemQuery.data}
          guard={authority.guard}
          onMutationAccepted={authority.refreshAndAccept}
        />
      ) : null}
    </div>
  );
}

function EquipmentEditForm({
  auditId,
  type,
  itemId,
  config,
  initialValues,
  guard,
  onMutationAccepted,
}: {
  auditId: string;
  type: string;
  itemId: string;
  config: NonNullable<ReturnType<typeof getEquipmentConfig>>;
  initialValues: Record<string, unknown>;
  guard: AuditWriteGuard;
  onMutationAccepted: () => Promise<AuditTree | null>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initialValues }));
  const [busy, setBusy] = useState(false);

  function onChange(key: string, value: unknown) {
    setValues((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, zoneId, auditId: _a, createdAt, ...body } = values;
      void id; void zoneId; void _a; void createdAt;
      await updateEquipment(type!, itemId!, body, guard);
      if (!await onMutationAccepted()) {
        throw new Error('The record was saved, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success('Saved successfully.');
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}`);
    } catch (err) {
      toast.error(auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this record?')) return;
    try {
      await deleteEquipment(type!, itemId!, guard);
      if (!await onMutationAccepted()) {
        throw new Error('The record was deleted, but the latest cloud revision could not be accepted. Refresh before continuing.');
      }
      toast.success('Deleted.');
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}`);
    } catch (err) {
      toast.error(auditProtocolErrorMessage(err) ?? cloudConnectionErrorMessage(err));
    }
  }

  return (
    <Card>
        <form onSubmit={handleSave}>
          <EquipmentFormFields config={config} values={values} onChange={onChange} auditId={auditId!} entityId={itemId} guard={guard} />
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button type="button" variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </div>
        </form>
    </Card>
  );
}
