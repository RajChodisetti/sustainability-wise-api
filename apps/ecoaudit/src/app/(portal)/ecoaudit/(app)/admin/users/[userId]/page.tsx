'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getUser, updateUser, deactivateUser } from '@/api/users';
import { AdminLayout } from '@/components/layout/ProtectedLayout';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import type { CloudUser } from '@/types/domain';

function UserDetailContent() {
  const { userId } = useParams<{ userId: string }>();
  const query = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId!), enabled: Boolean(userId) });

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="User not found." />;

  return <UserEditForm key={query.data.id} userId={userId} user={query.data} />;
}

function UserEditForm({ userId, user }: { userId: string; user: CloudUser }) {
  const router = useRouter();
  const toast = useToast();
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [role, setRole] = useState<'admin' | 'inspector'>(user.role === 'admin' ? 'admin' : 'inspector');
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateUser(userId, { fullName, role });
      toast.success('User updated.');
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm('Deactivate this user?')) return;
    try {
      await deactivateUser(userId!);
      toast.success('User deactivated.');
      router.push('/ecoaudit/admin');
    } catch (err) {
      toast.error(cloudConnectionErrorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title="Edit user" actions={<Link href="/ecoaudit/admin" className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-md">
        <form onSubmit={handleSave}>
          <FieldLabel>Email</FieldLabel>
          <Input value={user.email} disabled />
          <FieldLabel>Full name</FieldLabel>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <FieldLabel>Role</FieldLabel>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'inspector')}>
            <option value="inspector">Inspector</option>
            <option value="admin">Admin</option>
          </Select>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>Save</Button>
            <Button type="button" variant="danger" onClick={() => void handleDeactivate()}>Deactivate</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <AdminLayout>
      <UserDetailContent />
    </AdminLayout>
  );
}
