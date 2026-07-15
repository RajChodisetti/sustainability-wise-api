'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { completeAudit, deleteAudit, getAudit, startAudit } from '@/api/audits';
import { listZones } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { EQUIPMENT_TYPES } from '@/lib/equipmentConfig';
import {
  formatDateTime,
  formatDuration,
  getAuditCompletedAt,
  getAuditDurationMs,
  getAuditStartedAt,
} from '@/lib/auditTiming';
import { EquipmentIcon, Icon } from '@/components/ui/Icon';

export default function AuditDetailPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const auditQuery = useQuery({ queryKey: ['audit', auditId], queryFn: () => getAudit(auditId!), enabled: Boolean(auditId) });
  const zonesQuery = useQuery({ queryKey: ['zones', auditId], queryFn: () => listZones(auditId!), enabled: Boolean(auditId) });

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

      <Card>
        <h2 className="mb-4 font-semibold">Equipment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EQUIPMENT_TYPES.map((t) => (
            <Link key={t.slug} href={`/ecoaudit/audits/${auditId}/equipment/${t.slug}`} className="interactive-card flex min-h-20 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]"><EquipmentIcon slug={t.slug} /></span>
              <span className="min-w-0">
                <span className="block font-bold text-[var(--text)]">{t.label}</span>
                <span className="block text-xs text-[var(--text-sub)]">View &amp; manage</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
