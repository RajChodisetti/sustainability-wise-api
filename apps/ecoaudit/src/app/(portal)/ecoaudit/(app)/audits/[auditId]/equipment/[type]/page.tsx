'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listEquipment } from '@/api/equipment';
import { getEquipmentConfig, equipmentDisplayName } from '@/lib/equipmentConfig';
import { cloudConnectionErrorMessage } from '@/api/client';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { getAudit } from '@/api/audits';
import { listZones } from '@/api/zones';
import { Icon } from '@/components/ui/Icon';

export default function EquipmentListPage() {
  const { auditId, type } = useParams<{ auditId: string; type: string }>();
  const config = getEquipmentConfig(type!);
  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });
  const listQuery = useQuery({
    queryKey: ['equipment', type, auditId],
    queryFn: () => listEquipment(type!, auditId!),
    enabled: Boolean(auditId && type && config),
  });

  if (!config) return <ErrorBanner message="Unknown equipment type." />;
  if (auditQuery.isLoading || listQuery.isLoading || zonesQuery.isLoading) return <Spinner />;
  if (listQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(listQuery.error)} />;
  if (zonesQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(zonesQuery.error)} />;
  const items = listQuery.data?.data ?? [];
  const isCompleted = auditQuery.data?.status === 'Completed';
  const zoneNames = new Map((zonesQuery.data?.data ?? []).map((zone) => [zone.id, zone.zoneName]));

  return (
    <div>
      <PageHeader
        title={config.label}
        subtitle="Equipment is labelled with its assigned zone. Open an item for full details."
        actions={
          <>
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/new`}>Add {config.label.slice(0, -1)}</LinkButton> : null}
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState title={`No ${config.label.toLowerCase()} yet`} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Link key={item.id} href={`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}`} className="block">
              <Card className="interactive-card">
                <p className="font-bold">{equipmentDisplayName(item, config)}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">
                  <Icon name="building" size={14} />
                  Zone: {zoneNames.get(item.zoneId) ?? 'Unzoned or unavailable'}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
