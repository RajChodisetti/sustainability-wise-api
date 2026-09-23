'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createUser } from '@/api/users';
import { cloudConnectionErrorMessage } from '@/api/client';
import { AdminLayout } from '@/components/layout/ProtectedLayout';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  buildEcoAuditUserCreateBody,
  type EcoAuditUserRole,
} from '@/lib/userProvisioning';

function NewUserForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<EcoAuditUserRole>('inspector');
  const [legacyLocalId, setLegacyLocalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    let body;
    try {
      body = buildEcoAuditUserCreateBody({
        fullName,
        usernameOrEmail,
        password,
        role,
        legacyLocalId,
      });
    } catch (validationError) {
      setError(validationError instanceof Error
        ? validationError.message
        : 'Check the account details and try again.');
      return;
    }

    setBusy(true);
    try {
      await createUser(body);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('The new account can now sign in.');
      router.push('/ecoaudit/admin');
    } catch (requestError) {
      setError(cloudConnectionErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Add user"
        subtitle="Create an EcoAudit Pro inspector or administrator account."
        actions={<LinkButton href="/ecoaudit/admin" variant="secondary">Back</LinkButton>}
      />
      <Card className="max-w-md">
        <form onSubmit={handleSubmit}>
          <FieldLabel>Full name</FieldLabel>
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            required
          />

          <FieldLabel>Username or email</FieldLabel>
          <Input
            value={usernameOrEmail}
            onChange={(event) => setUsernameOrEmail(event.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            required
          />
          <FieldHint>
            A username is stored as an EcoAudit Pro account address. The user can sign in with the username or the full email.
          </FieldHint>

          <FieldLabel>Role</FieldLabel>
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as EcoAuditUserRole)}
          >
            <option value="inspector">Inspector</option>
            <option value="admin">Admin</option>
          </Select>

          <FieldLabel>Password</FieldLabel>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
          <FieldHint>Use at least 6 characters.</FieldHint>

          <details className="mt-5 rounded-[var(--radius-sm)] border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-sm font-bold text-[var(--text)]">
              Existing mobile account (advanced)
            </summary>
            <FieldLabel>Legacy local account ID</FieldLabel>
            <Input
              value={legacyLocalId}
              onChange={(event) => setLegacyLocalId(event.target.value)}
              autoCapitalize="none"
              autoComplete="off"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
            <FieldHint>
              Optional. Enter the exact local account UUID from the device to connect an existing profile without changing its identity. Leave this blank for a new user.
            </FieldHint>
          </details>

          {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create user'}
            </Button>
            <LinkButton href="/ecoaudit/admin" variant="secondary">Cancel</LinkButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function NewUserPage() {
  return (
    <AdminLayout>
      <NewUserForm />
    </AdminLayout>
  );
}
