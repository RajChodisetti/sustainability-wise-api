'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listEquipment } from '@/api/equipment';
import { getEquipmentConfig, equipmentDisplayName } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { getAudit } from '@/api/audits';

export default function EquipmentListPage() {
  const { auditId, type } = useParams<{ auditId: string; type: string }>();
  const config = getEquipmentConfig(type!);
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const listQuery = useQuery({
    queryKey: ['equipment', type, auditId],
    queryFn: () => listEquipment(type!, auditId!),
    enabled: Boolean(auditId && type && config),
  });

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (auditQuery.isLoading || listQuery.isLoading) return <Spinner />;
  if (listQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(listQuery.error)} />;
  const items = listQuery.data?.data ?? [];
  const isCompleted = auditQuery.data?.status === 'Completed';

  return (
    <div>
      <PageHeader
        title={config.label}
        actions={
          <>
            {!isCompleted ? <Link href={`/ecoaudit/audits/${auditId}/equipment/${type}/new`}><Button>Add {config.label.slice(0, -1)}</Button></Link> : null}
            <Link href={`/ecoaudit/audits/${auditId}`} className="text-sm text-[var(--primary)]">Back</Link>
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState title={`No ${config.label.toLowerCase()} yet`} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Link key={item.id} href={`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}`} className="block">
              <Card className="hover:border-[var(--primary)]">
                <p className="font-medium">{equipmentDisplayName(item, config)}</p>
                <p className="text-xs text-[var(--text-sub)]">Zone: {item.zoneId}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
