'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@solar/api/users';
import { localUsernameFromCloudEmail } from '@solar/api/auth';
import { Button } from '@solar/components/ui/Button';
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
            <Link href="/solar/settings"><Button variant="secondary">Settings</Button></Link>
            <Link href="/solar/admin/users/new"><Button>Add user</Button></Link>
          </>
        }
      />
      {!users?.length ? (
        <EmptyState title="No users" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Link key={u.id} href={`/solar/admin/users/${u.id}`}>
              <Card className="flex items-center justify-between hover:border-[var(--primary)]">
                <div>
                  <p className="font-medium">{u.fullName || localUsernameFromCloudEmail(u.email)}</p>
                  <p className="text-sm text-[var(--text-sub)]">{u.email}</p>
                </div>
                <div className="text-right text-sm">
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
