'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { completeAudit, deleteAudit, getAudit, reopenAudit, startAudit } from '@/api/audits';
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
  const [workspaceView, setWorkspaceView] = useState<'zones' | 'equipment'>('zones');
  const [statusAction, setStatusAction] = useState<'complete' | 'reopen' | null>(null);

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

  async function refreshStatus() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['audit', auditId] }),
      queryClient.invalidateQueries({ queryKey: ['audits'] }),
    ]);
  }

  async function handleStart() {
    try {
      await startAudit(auditId);
      await refreshStatus();
      toast.success('Audit started. Timer is running.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    }
  }

  async function handleComplete() {
    if (statusAction) return;
    setStatusAction('complete');
    try {
      await completeAudit(auditId);
      await refreshStatus();
      toast.success('Audit marked as completed.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setStatusAction(null);
    }
  }

  async function handleReopen() {
    if (statusAction) return;
    if (!confirm('Change this audit to In Progress? This will unlock its details, zones, equipment, and photos for editing.')) return;
    setStatusAction('reopen');
    try {
      await reopenAudit(auditId);
      await refreshStatus();
      toast.success('Audit changed to In Progress.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setStatusAction(null);
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
            {!isCompleted ? (
              <Button
                onClick={() => void handleComplete()}
                disabled={statusAction !== null}
                aria-busy={statusAction === 'complete'}
              >
                {statusAction === 'complete' ? 'Completing…' : 'Complete'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void handleReopen()}
                disabled={statusAction !== null}
                aria-busy={statusAction === 'reopen'}
              >
                {statusAction === 'reopen' ? 'Changing…' : 'Change to In Progress'}
              </Button>
            )}
            <Button variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </>
        }
      />

      <Card className="mb-6">
          <h2 className="mb-2 font-semibold">Audit details</h2>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            <p className="text-sm"><span className="text-[var(--text-sub)]">Inspector:</span> {audit.inspectorName}</p>
            <p className="text-sm"><span className="text-[var(--text-sub)]">Date:</span> {audit.auditDate ?? '—'}</p>
            <p className="text-sm"><span className="text-[var(--text-sub)]">Started:</span> {formatDateTime(startedAt)}</p>
            <p className="text-sm"><span className="text-[var(--text-sub)]">Completed:</span> {formatDateTime(completedAt)}</p>
            <p className="text-sm"><span className="text-[var(--text-sub)]">Time spent:</span> {formatDuration(durationMs)}{!isCompleted && startedAt ? ' (in progress)' : ''}</p>
          </div>
      </Card>

      <Card className="mb-6">
        <div className="mb-5 flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold">Audit workspace</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Switch between the zone workspace and equipment categories.</p>
          </div>
          <div className="inline-flex w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface2)] p-1 sm:w-auto" role="tablist" aria-label="Audit workspace view">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceView === 'zones'}
              onClick={() => setWorkspaceView('zones')}
              className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-bold transition sm:flex-none ${workspaceView === 'zones' ? 'bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-sub)] hover:bg-[var(--surface)] hover:text-[var(--text)]'}`}
            >
              Zones ({zones.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceView === 'equipment'}
              onClick={() => setWorkspaceView('equipment')}
              className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-bold transition sm:flex-none ${workspaceView === 'equipment' ? 'bg-[var(--primary)] text-[var(--primary-fg)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-sub)] hover:bg-[var(--surface)] hover:text-[var(--text)]'}`}
            >
              Equipment
            </button>
          </div>
        </div>

        {workspaceView === 'zones' ? (
          <div role="tabpanel">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold">Zones and their equipment</h3>
                <p className="mt-1 text-sm text-[var(--text-sub)]">Open a zone to manage its photos and every equipment record assigned to it.</p>
              </div>
              {!isCompleted ? <LinkButton href={`/ecoaudit/audits/${auditId}/zones/new`}><Icon name="plus" size={17} />Add zone</LinkButton> : null}
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
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center xl:col-span-2">
                    <p className="font-bold">No zones yet</p>
                    <p className="mt-1 text-sm text-[var(--text-sub)]">Add a zone first, then add equipment from its workspace.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div role="tabpanel">
            <div className="mb-4">
              <h3 className="font-bold">Equipment categories</h3>
              <p className="mt-1 text-sm text-[var(--text-sub)]">Open a category to view its equipment grouped under the correct zones.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {equipmentByType.map(({ equipmentType: t, items }) => {
                const zoneCount = new Set(items.map((item) => item.zoneId).filter((zoneId) => knownZoneIds.has(zoneId))).size;
                return (
                  <Link key={t.slug} href={`/ecoaudit/audits/${auditId}/equipment/${t.slug}`} className="interactive-card flex min-h-20 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]"><EquipmentIcon slug={t.slug} /></span>
                    <span className="min-w-0">
                      <span className="block font-bold text-[var(--text)]">{t.label}</span>
                      <span className="block text-xs text-[var(--text-sub)]">{items.length} item{items.length === 1 ? '' : 's'} across {zoneCount} zone{zoneCount === 1 ? '' : 's'}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
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
