'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@/api/users';
import { listAudits } from '@/api/audits';
import { AdminLayout } from '@/components/layout/ProtectedLayout';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { cloudConnectionErrorMessage } from '@/api/client';

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

  return (
    <div className="space-y-8">
      <PageHeader title="Admin dashboard" subtitle="User access and audit oversight" />

      <div className="grid gap-4 sm:grid-cols-3">
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
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">User management</h2>
        {users.length === 0 ? (
          <EmptyState title="No users" />
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <Link key={u.id} href={`/ecoaudit/admin/users/${u.id}`} className="block rounded-[var(--radius-md)]">
                <Card className="hover:border-[var(--primary)]">
                  <p className="break-words font-medium">{u.fullName || u.email}</p>
                  <p className="break-all text-sm text-[var(--text-sub)]">{u.email} · {u.role}</p>
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
