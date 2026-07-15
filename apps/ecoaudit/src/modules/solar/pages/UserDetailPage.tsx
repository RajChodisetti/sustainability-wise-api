'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { createUser, deactivateUser, listUsers, updateUser } from '@solar/api/users';
import { cloudEmailForUsername, localUsernameFromCloudEmail } from '@solar/api/auth';
import { Button } from '@solar/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { FieldLabel, Input, Select } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


export default function UserDetailPage() {
  const params = useParams();
  const userId = asId(params.userId);
  const isNew = userId === 'new';
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'admin' | 'inspector'>('inspector');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: !isNew });
  const user = usersQuery.data?.find((u) => u.id === userId);

  useEffect(() => {
    if (!user) return;
    setUsername(localUsernameFromCloudEmail(user.email));
    setFullName(user.fullName ?? '');
    setRole(user.role === 'admin' ? 'admin' : 'inspector');
  }, [user]);

  if (!isNew && usersQuery.isLoading) return <Spinner />;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        if (!password) throw new Error('Password is required for new users.');
        await createUser({ username, password, fullName, role });
      } else if (userId) {
        await updateUser(userId, { username, fullName, role });
      }
      router.push('/solar/admin');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    if (!userId || isNew) return;
    if (!confirm('Deactivate this user?')) return;
    try {
      await deactivateUser(userId);
      router.push('/solar/admin');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    }
  }

  async function handleReactivate() {
    if (!userId || isNew) return;
    try {
      await updateUser(userId, { isActive: true });
      router.push('/solar/admin');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title={isNew ? 'Add user' : 'Edit user'} actions={<Link href="/solar/admin" className="text-sm text-[var(--primary)]">Back</Link>} />
      <Card className="max-w-md">
        <form onSubmit={handleSave}>
          <FieldLabel>Username</FieldLabel>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          {!isNew ? <p className="text-xs text-[var(--muted)]">Email: {cloudEmailForUsername(username)}</p> : null}
          <FieldLabel>Full name</FieldLabel>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <FieldLabel>Role</FieldLabel>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'inspector')}>
            <option value="inspector">Inspector</option>
            <option value="admin">Admin</option>
          </Select>
          {isNew ? (
            <>
              <FieldLabel>Password</FieldLabel>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          ) : null}
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            {!isNew && user?.isActive !== false ? (
              <Button type="button" variant="danger" onClick={() => void handleDeactivate()}>Deactivate</Button>
            ) : null}
            {!isNew && user?.isActive === false ? (
              <Button type="button" variant="secondary" onClick={() => void handleReactivate()}>Reactivate</Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
