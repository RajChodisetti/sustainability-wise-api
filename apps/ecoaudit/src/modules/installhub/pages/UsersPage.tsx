'use client';

import { useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import {
  changeUserPassword,
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  updateUser,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import type {
  InstallHubRole,
  InstallHubUser,
  ManagedInstallHubUser,
} from '@/modules/installhub/types/domain';

function accountLabel(user: ManagedInstallHubUser): string {
  return user.fullName?.trim() || user.email;
}

function AdminRequired() {
  return (
    <EmptyState
      title="Administrator access required"
      description="Only InstallHub administrators can manage cloud user accounts."
      icon="shield"
    />
  );
}

export function InstallHubUsersPage() {
  const { user: currentUser } = useInstallHubAuth();
  const [search, setSearch] = useState('');
  const isAdmin = currentUser?.role === 'admin';
  const query = useQuery({
    queryKey: ['installhub', 'users'],
    queryFn: listUsers,
    enabled: isAdmin,
  });

  if (!isAdmin) return <AdminRequired />;
  if (query.isLoading) return <Spinner label="Loading InstallHub users…" />;
  if (query.error) {
    return (
      <div>
        <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => void query.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  const users = query.data?.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const filtered = users.filter((user) =>
    !needle
      ? true
      : [user.fullName ?? '', user.email, user.role].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
  );

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'InstallHub', href: '/installhub/dashboard' },
          { label: 'User management' },
        ]}
      />
      <PageHeader
        title="User management"
        subtitle="Create accounts, assign roles, reset passwords, and control access to InstallHub cloud records."
        actions={
          <LinkButton href="/installhub/admin/users/new">
            <Icon name="plus" size={17} />
            Add user
          </LinkButton>
        }
      />

      <Card className="mb-5 !p-4">
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <Input
            className="pl-10"
            type="search"
            value={search}
            placeholder="Search name, email, or role"
            aria-label="Search users"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No matching users' : 'No cloud users'}
          description={
            search
              ? 'Try a different name, email address, or role.'
              : 'Add the first InstallHub account.'
          }
          icon="users"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((user) => {
            const isCurrent = user.id === currentUser.id;
            return (
              <Card key={user.id} className="!p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-extrabold text-[var(--text)]">
                      {accountLabel(user)}
                    </p>
                    <p className="mt-1 break-all text-sm text-[var(--text-sub)]">
                      {user.email}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${
                      user.isActive
                        ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
                        : 'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]'
                    }`}
                  >
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="mt-3 text-xs font-semibold text-[var(--muted)]">
                  {user.role === 'admin' ? 'Administrator' : 'Inspector'}
                  {isCurrent ? ' · You' : ''}
                </p>
                <LinkButton
                  className="mt-4 w-full"
                  href={`/installhub/admin/users/${user.id}`}
                  variant="secondary"
                >
                  Edit user
                </LinkButton>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type EditorMode = 'new' | 'edit';

export function InstallHubUserEditorPage({ mode }: { mode: EditorMode }) {
  const { user: currentUser } = useInstallHubAuth();
  const { userId } = useParams<{ userId?: string }>();
  const isAdmin = currentUser?.role === 'admin';
  const query = useQuery({
    queryKey: ['installhub', 'user', userId ?? 'new'],
    queryFn: () => getUser(userId!),
    enabled: isAdmin && mode === 'edit' && Boolean(userId),
  });

  if (!isAdmin) return <AdminRequired />;
  if (mode === 'edit' && query.isLoading) {
    return <Spinner label="Loading user…" />;
  }
  if (mode === 'edit' && query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (mode === 'edit' && !query.data) {
    return <ErrorBanner message="InstallHub user not found." />;
  }

  return (
    <UserEditorForm
      key={query.data?.id ?? 'new'}
      mode={mode}
      source={query.data}
      currentUser={currentUser}
    />
  );
}

function UserEditorForm({
  mode,
  source,
  currentUser,
}: {
  mode: EditorMode;
  source?: ManagedInstallHubUser;
  currentUser: InstallHubUser;
}) {
  const router = useRouter();
  const toast = useToast();
  const [account, setAccount] = useState(source);
  const [email, setEmail] = useState(source?.email ?? '');
  const [fullName, setFullName] = useState(source?.fullName ?? '');
  const [role, setRole] = useState<InstallHubRole>(
    source?.role ?? 'inspector',
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingAccess, setChangingAccess] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const isEditing = mode === 'edit';
  const isCurrentUser = account?.id === currentUser.id;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (!isEditing && password.length < 6) {
      toast.error('The temporary password must be at least 6 characters.');
      return;
    }
    if (!isEditing && password !== confirmPassword) {
      toast.error('The temporary passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      if (account) {
        const updated = await updateUser(account.id, {
          email: email.trim().toLowerCase(),
          fullName: fullName.trim() || null,
          role,
        });
        setAccount(updated);
        toast.success('User account updated.');
      } else {
        await createUser({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role,
          password,
        });
        toast.success('The new account can now sign in.');
        router.replace('/installhub/admin/users');
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function setAccountActive(isActive: boolean) {
    if (!account) return;
    setChangingAccess(true);
    try {
      if (isActive) {
        setAccount(await updateUser(account.id, { isActive: true }));
      } else {
        await deactivateUser(account.id);
        setAccount({ ...account, isActive: false });
      }
      toast.success(
        isActive
          ? 'The account can sign in again.'
          : 'The account was deactivated and its refresh sessions were revoked.',
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setChangingAccess(false);
    }
  }

  function confirmAccessChange() {
    if (!account) return;
    if (!account.isActive) {
      void setAccountActive(true);
      return;
    }
    if (
      window.confirm(
        'Deactivate this user? Their InstallHub refresh sessions will be revoked, while existing backed-up data is retained.',
      )
    ) {
      void setAccountActive(false);
    }
  }

  async function resetAnotherUserPassword(event: FormEvent) {
    event.preventDefault();
    if (!account || isCurrentUser) return;
    if (resetPassword.length < 6) {
      toast.error('The temporary password must be at least 6 characters.');
      return;
    }
    if (resetPassword !== confirmResetPassword) {
      toast.error('The temporary passwords do not match.');
      return;
    }
    setResettingPassword(true);
    try {
      await changeUserPassword(account.id, { newPassword: resetPassword });
      setResetPassword('');
      setConfirmResetPassword('');
      toast.success(
        'Password reset. Existing refresh sessions were revoked.',
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setResettingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        items={[
          {
            label: 'User management',
            href: '/installhub/admin/users',
          },
          { label: isEditing ? 'Edit user' : 'Add user' },
        ]}
      />
      <PageHeader
        title={isEditing ? 'Edit user' : 'Add user'}
        subtitle={
          isEditing
            ? 'Update account details, access state, and password security.'
            : 'Create an InstallHub inspector or administrator account.'
        }
        actions={
          account ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                account.isActive
                  ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
                  : 'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]'
              }`}
            >
              {account.isActive ? 'Active' : 'Inactive'}
            </span>
          ) : undefined
        }
      />

      <form onSubmit={(event) => void save(event)}>
        <Card>
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Account details
          </h2>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="ih-user-full-name">Full name</FieldLabel>
              <Input
                id="ih-user-full-name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="ih-user-email">Email</FieldLabel>
              <Input
                id="ih-user-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="ih-user-role">Role</FieldLabel>
              <Select
                id="ih-user-role"
                value={role}
                disabled={isCurrentUser}
                onChange={(event) =>
                  setRole(event.target.value as InstallHubRole)
                }
              >
                <option value="inspector">Inspector</option>
                <option value="admin">Administrator</option>
              </Select>
              {isCurrentUser ? (
                <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">
                  Administrators cannot demote their own active account.
                </p>
              ) : null}
            </div>
          </div>

          {!isEditing ? (
            <div className="mt-5 grid gap-x-4 border-t border-[var(--border)] pt-1 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="ih-user-password">
                  Temporary password
                </FieldLabel>
                <Input
                  id="ih-user-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="ih-user-confirm-password">
                  Confirm temporary password
                </FieldLabel>
                <Input
                  id="ih-user-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <LinkButton
              href="/installhub/admin/users"
              variant="secondary"
            >
              Cancel
            </LinkButton>
            <Button
              type="submit"
              disabled={saving || changingAccess || resettingPassword}
            >
              {saving
                ? 'Saving…'
                : isEditing
                  ? 'Save changes'
                  : 'Create user'}
            </Button>
          </div>
        </Card>
      </form>

      {account ? (
        <Card className="mt-5">
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Password
          </h2>
          {isCurrentUser ? (
            <>
              <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
                Changing your own password requires your current password and
                signs out existing InstallHub cloud sessions.
              </p>
              <LinkButton
                className="mt-4"
                href="/installhub/settings/password"
                variant="secondary"
              >
                Change my password
              </LinkButton>
            </>
          ) : (
            <form
              className="mt-4"
              onSubmit={(event) => void resetAnotherUserPassword(event)}
            >
              <InlineNotice>
                Resetting another user revokes their existing refresh sessions.
                Share the temporary password securely.
              </InlineNotice>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="ih-reset-password">
                    New temporary password
                  </FieldLabel>
                  <Input
                    id="ih-reset-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ih-reset-confirm-password">
                    Confirm temporary password
                  </FieldLabel>
                  <Input
                    id="ih-reset-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={confirmResetPassword}
                    onChange={(event) =>
                      setConfirmResetPassword(event.target.value)
                    }
                  />
                </div>
              </div>
              <Button
                className="mt-5"
                type="submit"
                variant="secondary"
                disabled={saving || changingAccess || resettingPassword}
              >
                {resettingPassword ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>
          )}
        </Card>
      ) : null}

      {account && !isCurrentUser ? (
        <Card className="mt-5">
          <h2 className="text-lg font-extrabold text-[var(--text)]">Access</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            {account.isActive
              ? 'Deactivation blocks sign-in without deleting backed-up installations.'
              : 'Reactivation lets this account sign in again.'}
          </p>
          <Button
            className="mt-4"
            variant={account.isActive ? 'danger' : 'secondary'}
            disabled={saving || changingAccess || resettingPassword}
            onClick={confirmAccessChange}
          >
            {changingAccess
              ? 'Updating…'
              : account.isActive
                ? 'Deactivate user'
                : 'Reactivate user'}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
