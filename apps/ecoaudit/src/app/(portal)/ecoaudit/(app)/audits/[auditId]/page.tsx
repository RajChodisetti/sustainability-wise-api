'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { completeAudit, deleteAudit, getAudit, startAudit } from '@/api/audits';
import { listZones } from '@/api/zones';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
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
            {!isCompleted ? <Link href={`/ecoaudit/audits/${auditId}/edit`}><Button variant="secondary">Edit</Button></Link> : null}
            <Link href={`/ecoaudit/audits/${auditId}/photos`}><Button variant="secondary">Photos</Button></Link>
            <Link href={`/ecoaudit/audits/${auditId}/report`}><Button variant="secondary">Report PDF</Button></Link>
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
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Zones ({zones.length})</h2>
            {!isCompleted ? <Link href={`/ecoaudit/audits/${auditId}/zones/new`}><Button className="!px-3 !py-1.5 !text-xs">Add zone</Button></Link> : null}
          </div>
          {zones.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No zones yet.</p> : (
            <ul className="space-y-2">
              {zones.map((z) => (
                <li key={z.id}>
                  <Link href={`/ecoaudit/audits/${auditId}/zones/${z.id}`} className="text-sm font-medium text-[var(--primary)] hover:underline">{z.zoneName}</Link>
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
            <Link key={t.slug} href={`/ecoaudit/audits/${auditId}/equipment/${t.slug}`} className="rounded-lg border border-[var(--border)] p-3 transition hover:border-[var(--primary)]">
              <p className="font-medium">{t.icon} {t.label}</p>
              <p className="text-xs text-[var(--text-sub)]">View & manage</p>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
