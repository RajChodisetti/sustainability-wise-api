'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getAudit } from '@/api/audits';
import { deleteEquipment, getEquipment, updateEquipment } from '@/api/equipment';
import { getEquipmentConfig } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { EquipmentFormFields } from '@/components/equipment/EquipmentFormFields';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';

export default function EditEquipmentPage() {
  const { auditId, type, itemId } = useParams<{ auditId: string; type: string; itemId: string }>();
  const router = useRouter();
  const toast = useToast();
  const config = getEquipmentConfig(type!);
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const itemQuery = useQuery({ queryKey: ['equipment', type, itemId], queryFn: () => getEquipment(type!, itemId!), enabled: Boolean(type && itemId) });

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (itemQuery.data) setValues({ ...itemQuery.data });
  }, [itemQuery.data]);

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (itemQuery.isLoading || auditQuery.isLoading) return <Spinner />;
  if (itemQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(itemQuery.error)} />;
  const isCompleted = auditQuery.data?.status === 'Completed';

  function onChange(key: string, value: unknown) {
    setValues((p) => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, zoneId, auditId: _a, createdAt, ...body } = values;
      void id; void zoneId; void _a; void createdAt;
      await updateEquipment(type!, itemId!, body);
      toast.success('Saved successfully.');
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}`);
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this record?')) return;
    try {
      await deleteEquipment(type!, itemId!);
      toast.success('Deleted.');
      router.push(`/ecoaudit/audits/${auditId}/equipment/${type}`);
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title={`Edit ${config.label.slice(0, -1)}`} actions={<Link href={`/ecoaudit/audits/${auditId}/equipment/${type}/${itemId}`} className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card>
        <form onSubmit={handleSave}>
          <EquipmentFormFields config={config} values={values} onChange={onChange} auditId={auditId!} entityId={itemId} disabled={isCompleted} />
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
