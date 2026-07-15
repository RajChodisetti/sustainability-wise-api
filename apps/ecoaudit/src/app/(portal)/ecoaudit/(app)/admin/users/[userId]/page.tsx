'use client';

import { useEffect, useState } from 'react';
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

function UserDetailContent() {
  const { userId } = useParams<{ userId: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId!), enabled: Boolean(userId) });
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('inspector');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = query.data;
    if (!u) return;
    setFullName(u.fullName ?? '');
    setRole(u.role);
  }, [query.data]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={cloudConnectionErrorMessage(query.error)} />;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateUser(userId!, { fullName, role: role as 'admin' | 'inspector' });
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
          <Input value={query.data!.email} disabled />
          <FieldLabel>Full name</FieldLabel>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <FieldLabel>Role</FieldLabel>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
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
