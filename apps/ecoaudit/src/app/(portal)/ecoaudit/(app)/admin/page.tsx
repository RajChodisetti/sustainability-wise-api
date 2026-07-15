'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@/api/users';
import { listAudits } from '@/api/audits';
import { AdminLayout } from '@/components/layout/ProtectedLayout';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badges';
import { cloudConnectionErrorMessage } from '@/api/client';
import {
  averageDurationMs,
  formatDateTime,
  formatDuration,
  getAuditCompletedAt,
  getAuditDurationMs,
  getAuditStartedAt,
} from '@/lib/auditTiming';

function AdminDashboardContent() {
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const auditsQuery = useQuery({ queryKey: ['audits'], queryFn: listAudits });

  if (usersQuery.isLoading || auditsQuery.isLoading) return <Spinner />;
  if (usersQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(usersQuery.error)} />;
  if (auditsQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(auditsQuery.error)} />;

  const users = usersQuery.data?.data ?? [];
  const audits = auditsQuery.data?.data ?? [];
  const completed = audits.filter((a) => a.status === 'Completed');
  const draft = audits.length - completed.length;
  const avgMs = averageDurationMs(completed);
  const timedAudits = [...audits].sort((a, b) => {
    const aT = getAuditStartedAt(a)?.getTime() ?? 0;
    const bT = getAuditStartedAt(b)?.getTime() ?? 0;
    return bT - aT;
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Admin dashboard" subtitle="Users and audit time tracking" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-[var(--text-sub)]">Users</p>
          <p className="text-3xl font-bold">{users.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-sub)]">Total audits</p>
          <p className="text-3xl font-bold">{audits.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-sub)]">Completed / Draft</p>
          <p className="text-3xl font-bold">{completed.length} <span className="text-lg font-medium text-[var(--text-sub)]">/ {draft}</span></p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-sub)]">Avg time (completed)</p>
          <p className="text-3xl font-bold">{formatDuration(avgMs)}</p>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Time spent on audits</h2>
          <p className="text-xs text-[var(--text-sub)]">Start → complete duration</p>
        </div>
        {timedAudits.length === 0 ? (
          <EmptyState title="No audits yet" />
        ) : (
          <Card className="overflow-x-auto !p-0">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--text-sub)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Inspector</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Completed</th>
                  <th className="px-4 py-3 font-medium">Time spent</th>
                </tr>
              </thead>
              <tbody>
                {timedAudits.map((audit) => {
                  const durationMs = getAuditDurationMs(audit);
                  const inProgress = audit.status !== 'Completed' && Boolean(getAuditStartedAt(audit));
                  return (
                    <tr key={audit.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/ecoaudit/audits/${audit.id}`} className="font-medium text-[var(--primary)] hover:underline">
                          {audit.siteName}
                        </Link>
                        <p className="text-xs text-[var(--text-sub)]">{audit.siteAddress}</p>
                      </td>
                      <td className="px-4 py-3">{audit.inspectorName}</td>
                      <td className="px-4 py-3"><StatusBadge status={audit.status} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(getAuditStartedAt(audit))}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(getAuditCompletedAt(audit))}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium">
                        {formatDuration(durationMs)}
                        {inProgress ? <span className="ml-1 text-xs font-normal text-[var(--text-sub)]">in progress</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">User management</h2>
        {users.length === 0 ? (
          <EmptyState title="No users" />
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <Link key={u.id} href={`/ecoaudit/admin/users/${u.id}`}>
                <Card className="hover:border-[var(--primary)]">
                  <p className="font-medium">{u.fullName || u.email}</p>
                  <p className="text-sm text-[var(--text-sub)]">{u.email} · {u.role}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AdminLayout>
      <AdminDashboardContent />
    </AdminLayout>
  );
}
