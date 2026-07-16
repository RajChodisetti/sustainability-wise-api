'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { completeAudit, deleteAudit, getAudit, startAudit } from '@/api/audits';
import { listZones } from '@/api/zones';
import { listEquipment } from '@/api/equipment';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { EQUIPMENT_TYPES, equipmentDisplayName } from '@/lib/equipmentConfig';
import {
  formatDateTime,
  formatDuration,
  getAuditCompletedAt,
  getAuditDurationMs,
  getAuditStartedAt,
} from '@/lib/auditTiming';
import { EquipmentIcon, Icon } from '@/components/ui/Icon';
import type { EquipmentBase, Zone } from '@/types/domain';

export default function AuditDetailPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });
  const equipmentQueries = useQueries({
    queries: EQUIPMENT_TYPES.map((equipmentType) => ({
      queryKey: ['equipment', equipmentType.slug, auditId],
      queryFn: () => listEquipment(equipmentType.slug, auditId!),
      enabled: Boolean(auditId),
    })),
  });

  if (!auditId) return <ErrorBanner message="Audit not found." />;
  if (auditQuery.isLoading || zonesQuery.isLoading) return <Spinner />;
  if (auditQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditQuery.error)} />;
  const audit = auditQuery.data!;
  const zones = zonesQuery.data?.data ?? [];
  const isCompleted = audit.status === 'Completed';
  const startedAt = getAuditStartedAt(audit);
  const completedAt = getAuditCompletedAt(audit);
  const durationMs = getAuditDurationMs(audit);
  const needsStart = !isCompleted && !audit.startedAt;
  const equipmentLoading = equipmentQueries.some((query) => query.isLoading);
  const equipmentError = equipmentQueries.find((query) => query.error)?.error;
  const equipmentByType = EQUIPMENT_TYPES.map((equipmentType, index) => ({
    equipmentType,
    items: equipmentQueries[index].data?.data ?? [],
  }));
  const knownZoneIds = new Set(zones.map((zone) => zone.id));
  const unzonedEquipment = equipmentByType.flatMap(({ equipmentType, items }) => (
    items
      .filter((item) => !knownZoneIds.has(item.zoneId))
      .map((item) => ({ equipmentType, item }))
  ));

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['audit', auditId] }),
      queryClient.invalidateQueries({ queryKey: ['zones', auditId] }),
      queryClient.invalidateQueries({ queryKey: ['audits'] }),
    ]);
  }

  async function handleStart() {
    try {
      await startAudit(auditId);
      await refresh();
      toast.success('Audit started. Timer is running.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  async function handleComplete() {
    try {
      await completeAudit(auditId);
      await refresh();
      toast.success('Audit marked as completed.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this audit?')) return;
    try {
      await deleteAudit(auditId, true);
      toast.success('Audit deleted.');
      router.push('/ecoaudit/audits');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title={audit.siteName}
        subtitle={audit.siteAddress}
        actions={
          <>
            <StatusBadge status={audit.status} />
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/edit`} variant="secondary">Edit</LinkButton> : null}
            <LinkButton href={`/ecoaudit/audits/${auditId}/photos`} variant="secondary"><Icon name="camera" size={17} />Photos</LinkButton>
            <LinkButton href={`/ecoaudit/audits/${auditId}/report`} variant="secondary"><Icon name="file-text" size={17} />Report PDF</LinkButton>
            {needsStart ? <Button variant="secondary" onClick={() => void handleStart()}>Start</Button> : null}
            {!isCompleted ? <Button onClick={() => void handleComplete()}>Complete</Button> : null}
            <Button variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Audit details</h2>
          <p className="text-sm"><span className="text-[var(--text-sub)]">Inspector:</span> {audit.inspectorName}</p>
          <p className="text-sm"><span className="text-[var(--text-sub)]">Date:</span> {audit.auditDate ?? '—'}</p>
          <p className="mt-2 text-sm"><span className="text-[var(--text-sub)]">Started:</span> {formatDateTime(startedAt)}</p>
          <p className="text-sm"><span className="text-[var(--text-sub)]">Completed:</span> {formatDateTime(completedAt)}</p>
          <p className="text-sm"><span className="text-[var(--text-sub)]">Time spent:</span> {formatDuration(durationMs)}{!isCompleted && startedAt ? ' (in progress)' : ''}</p>
        </Card>
        <Card>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Zones ({zones.length})</h2>
            {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/new`} className="!px-3 !text-xs">Add zone</LinkButton> : null}
          </div>
          {zones.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No zones yet.</p> : (
            <ul className="space-y-2">
              {zones.map((z) => (
                <li key={z.id}>
                  <Link href={`/ecoaudit/audits/${auditId}/zones/${z.id}`} className="inline-flex min-h-11 items-center break-words text-sm font-medium text-[var(--primary)] hover:underline">{z.zoneName}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold">Equipment by zone</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">See every captured asset under the zone where it belongs.</p>
          </div>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
            {equipmentByType.reduce((total, group) => total + group.items.length, 0)} total items
          </span>
        </div>

        {equipmentLoading ? <Spinner label="Loading zone equipment…" /> : null}
        {equipmentError ? <ErrorBanner message={cloudConnectionErrorMessage(equipmentError)} /> : null}
        {!equipmentLoading && !equipmentError ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {zones.map((zone) => (
              <ZoneEquipmentCard
                key={zone.id}
                auditId={auditId}
                zone={zone}
                equipmentByType={equipmentByType}
              />
            ))}
            {unzonedEquipment.length > 0 ? (
              <section className="rounded-xl border border-[var(--amber)]/35 bg-[var(--amber-soft)] p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[var(--text)]">Unzoned or missing zone</h3>
                    <p className="text-xs text-[var(--text-sub)]">These records point to a zone that is no longer available.</p>
                  </div>
                  <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--amber)]">{unzonedEquipment.length}</span>
                </div>
                <div className="space-y-2">
                  {unzonedEquipment.map(({ equipmentType, item }) => (
                    <EquipmentItemLink key={`${equipmentType.slug}-${item.id}`} auditId={auditId} equipmentType={equipmentType} item={item} />
                  ))}
                </div>
              </section>
            ) : null}
            {zones.length === 0 && unzonedEquipment.length === 0 ? (
              <p className="text-sm text-[var(--text-sub)]">Add a zone first, then assign equipment to it.</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Equipment categories</h2>
        <p className="mb-4 text-sm text-[var(--text-sub)]">Open a category to add or manage equipment across all zones.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {equipmentByType.map(({ equipmentType: t, items }) => (
            <Link key={t.slug} href={`/ecoaudit/audits/${auditId}/equipment/${t.slug}`} className="interactive-card flex min-h-20 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]"><EquipmentIcon slug={t.slug} /></span>
              <span className="min-w-0">
                <span className="block font-bold text-[var(--text)]">{t.label}</span>
                <span className="block text-xs text-[var(--text-sub)]">{items.length} item{items.length === 1 ? '' : 's'} · View &amp; manage</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

type EquipmentGroup = {
  equipmentType: (typeof EQUIPMENT_TYPES)[number];
  items: EquipmentBase[];
};

function ZoneEquipmentCard({
  auditId,
  zone,
  equipmentByType,
}: {
  auditId: string;
  zone: Zone;
  equipmentByType: EquipmentGroup[];
}) {
  const groups = equipmentByType
    .map(({ equipmentType, items }) => ({
      equipmentType,
      items: items.filter((item) => item.zoneId === zone.id),
    }))
    .filter((group) => group.items.length > 0);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4 sm:p-5" aria-labelledby={`zone-equipment-${zone.id}`}>
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <Link
            id={`zone-equipment-${zone.id}`}
            href={`/ecoaudit/audits/${auditId}/zones/${zone.id}`}
            className="inline-flex min-h-11 items-center gap-2 break-words font-bold text-[var(--primary)] hover:underline focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
          >
            <Icon name="building" size={18} />
            {zone.zoneName}
          </Link>
          {zone.zoneDescription ? <p className="text-xs leading-5 text-[var(--text-sub)]">{zone.zoneDescription}</p> : null}
        </div>
        <span className="shrink-0 rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">{total} item{total === 1 ? '' : 's'}</span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--text-sub)]">No equipment assigned to this zone.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(({ equipmentType, items }) => (
            <div key={equipmentType.slug}>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">
                <EquipmentIcon slug={equipmentType.slug} />
                <span>{equipmentType.label}</span>
                <span className="text-[var(--muted)]">({items.length})</span>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <EquipmentItemLink key={item.id} auditId={auditId} equipmentType={equipmentType} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EquipmentItemLink({
  auditId,
  equipmentType,
  item,
}: {
  auditId: string;
  equipmentType: (typeof EQUIPMENT_TYPES)[number];
  item: EquipmentBase;
}) {
  return (
    <Link
      href={`/ecoaudit/audits/${auditId}/equipment/${equipmentType.slug}/${item.id}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] transition-colors duration-200 hover:border-[var(--primary)] hover:text-[var(--primary)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
    >
      <span className="min-w-0 break-words">{equipmentDisplayName(item, equipmentType)}</span>
      <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
    </Link>
  );
}
