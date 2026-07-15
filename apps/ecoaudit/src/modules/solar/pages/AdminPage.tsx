'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@solar/api/users';
import { localUsernameFromCloudEmail } from '@solar/api/auth';
import { LinkButton } from '@solar/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { cloudConnectionErrorMessage } from '@solar/api/client';

export default function AdminPage() {
  const { data: users, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={cloudConnectionErrorMessage(error)} />;

  return (
    <div>
      <PageHeader
        title="User management"
        subtitle="Admin only"
        actions={
          <>
            <LinkButton href="/solar/settings" variant="secondary">Settings</LinkButton>
            <LinkButton href="/solar/admin/users/new">Add user</LinkButton>
          </>
        }
      />
      {!users?.length ? (
        <EmptyState title="No users" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Link key={u.id} href={`/solar/admin/users/${u.id}`} className="block rounded-[var(--radius-md)]">
              <Card className="interactive-card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words font-medium">{u.fullName || localUsernameFromCloudEmail(u.email)}</p>
                  <p className="break-all text-sm text-[var(--text-sub)]">{u.email}</p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="capitalize">{u.role}</p>
                  <p className={u.isActive === false ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
                    {u.isActive === false ? 'Inactive' : 'Active'}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
