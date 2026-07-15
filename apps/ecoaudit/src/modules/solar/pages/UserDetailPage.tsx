'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { createUser, deactivateUser, listUsers, updateUser } from '@solar/api/users';
import { cloudEmailForUsername, localUsernameFromCloudEmail } from '@solar/api/auth';
import { Button, LinkButton } from '@solar/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { FieldLabel, Input, Select } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import type { CloudUser } from '@solar/types/domain';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


export default function UserDetailPage() {
  const params = useParams();
  const userId = asId(params.userId);
  const isNew = userId === 'new';

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: !isNew });
  const user = usersQuery.data?.find((u) => u.id === userId);

  if (!isNew && usersQuery.isLoading) return <Spinner />;
  if (usersQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(usersQuery.error)} />;
  if (!isNew && !user) return <ErrorBanner message="User not found." />;

  return <UserEditor key={userId ?? 'new'} userId={userId} isNew={isNew} user={user} />;
}

function UserEditor({
  userId,
  isNew,
  user,
}: {
  userId?: string;
  isNew: boolean;
  user?: CloudUser;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(user ? localUsernameFromCloudEmail(user.email) : '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [role, setRole] = useState<'admin' | 'inspector'>(user?.role === 'admin' ? 'admin' : 'inspector');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <PageHeader title={isNew ? 'Add user' : 'Edit user'} actions={<LinkButton href="/solar/admin" variant="secondary">Back</LinkButton>} />
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
