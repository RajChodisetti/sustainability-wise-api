'use client';

import { useState } from 'react';
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
  const [selectedZoneId, setSelectedZoneId] = useState('all');
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
  const zones = zonesQuery.data?.data ?? [];
  const knownZoneIds = new Set(zones.map((zone) => zone.id));
  const visibleZones = selectedZoneId === 'all' ? zones : zones.filter((zone) => zone.id === selectedZoneId);
  const orphanItems = items.filter((item) => !knownZoneIds.has(item.zoneId));

  return (
    <div>
      <PageHeader
        title={config.label}
        subtitle="Choose a zone to see only this equipment type within that zone."
        actions={
          <>
            {!isCompleted && zones.length > 0 ? <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/new`}>Add equipment</LinkButton> : null}
            <LinkButton href={`/ecoaudit/audits/${auditId}`} variant="secondary">Back</LinkButton>
          </>
        }
      />
      {zones.length === 0 ? (
        <EmptyState
          title="Add a zone first"
          description="Equipment in the mobile app and portal belongs directly to a zone."
          actions={!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/new`}>Add zone</LinkButton> : undefined}
        />
      ) : (
        <div>
          <Card className="mb-5 !p-3 sm:!p-4">
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-sub)]">Filter by zone</p>
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={`${config.label} zones`}>
              <ZoneTab
                label={`All zones (${items.filter((item) => knownZoneIds.has(item.zoneId)).length})`}
                selected={selectedZoneId === 'all'}
                onClick={() => setSelectedZoneId('all')}
              />
              {zones.map((zone) => (
                <ZoneTab
                  key={zone.id}
                  label={`${zone.zoneName} (${items.filter((item) => item.zoneId === zone.id).length})`}
                  selected={selectedZoneId === zone.id}
                  onClick={() => setSelectedZoneId(zone.id)}
                />
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            {visibleZones.map((zone) => {
              const zoneItems = items.filter((item) => item.zoneId === zone.id);
              return (
                <Card key={zone.id}>
                  <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link
                        href={`/ecoaudit/audits/${auditId}/zones/${zone.id}`}
                        className="inline-flex min-h-11 items-center gap-2 font-bold text-[var(--primary)] hover:underline"
                      >
                        <Icon name="building" size={17} />
                        {zone.zoneName}
                      </Link>
                      {zone.zoneDescription ? <p className="text-sm text-[var(--text-sub)]">{zone.zoneDescription}</p> : null}
                    </div>
                    {!isCompleted ? (
                      <LinkButton href={`/ecoaudit/audits/${auditId}/equipment/${type}/new?zoneId=${encodeURIComponent(zone.id)}`} className="shrink-0">
                        <Icon name="plus" size={17} />Add to {zone.zoneName}
                      </LinkButton>
                    ) : null}
                  </div>

                  {zoneItems.length === 0 ? (
                    <p className="text-sm text-[var(--text-sub)]">No {config.label.toLowerCase()} recorded in this zone.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {zoneItems.map((item) => (
                        <Link
                          key={item.id}
                          href={`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}`}
                          className="interactive-card flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3"
                        >
                          <span className="min-w-0 break-words font-bold text-[var(--text)]">{equipmentDisplayName(item, config)}</span>
                          <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}

            {selectedZoneId === 'all' && orphanItems.length > 0 ? (
              <Card className="border-[var(--amber)]/35 bg-[var(--amber-soft)]">
                <h2 className="font-bold">Unzoned or unavailable zone ({orphanItems.length})</h2>
                <p className="mb-3 mt-1 text-sm text-[var(--text-sub)]">These records reference a zone that no longer exists.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {orphanItems.map((item) => (
                    <Link key={item.id} href={`/ecoaudit/audits/${auditId}/equipment/${type}/${item.id}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 font-bold">
                      {equipmentDisplayName(item, config)}
                    </Link>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneTab({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-lg border px-4 text-sm font-bold transition ${selected ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]'}`}
    >
      {label}
    </button>
  );
}
