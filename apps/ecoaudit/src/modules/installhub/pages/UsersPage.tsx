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
  StatCard,
} from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import {
  changeUserPassword,
  createUser,
  deactivateUser,
  getUser,
  listUnifiedPortalUsers,
  updateUser,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import {
  editableFieldMembership,
  filterUnifiedPortalUsers,
  membershipForApp,
} from '@/modules/installhub/lib/unifiedUsers';
import type {
  InstallHubRole,
  InstallHubUser,
  ManagedInstallHubUser,
  UnifiedPortalApp,
  UnifiedPortalMembership,
  UnifiedPortalSyncStatus,
  UnifiedPortalUser,
} from '@/modules/installhub/types/domain';

function AdminRequired() {
  return (
    <EmptyState
      title="Administrator access required"
      description="Only InstallHub administrators can manage cloud user accounts."
      icon="shield"
    />
  );
}

const portalAppLabels: Record<UnifiedPortalApp, string> = {
  ecoaudit: 'Eco Audit',
  solarsense: 'Solar Sense',
  installhub: 'Field App',
};

function userLabel(user: UnifiedPortalUser): string {
  return user.fullName?.trim() || user.displayEmail || 'Source-managed user';
}

function MembershipSummary({
  membership,
  isCurrent = false,
}: {
  membership?: UnifiedPortalMembership;
  isCurrent?: boolean;
}) {
  if (!membership) {
    return (
      <span className="text-sm font-semibold text-[var(--muted)]">
        No access
      </span>
    );
  }

  return (
    <div className="min-w-28">
      <p className="text-sm font-bold text-[var(--text)]">
        {membership.role === 'admin' ? 'Administrator' : 'Inspector'}
        {isCurrent ? (
          <span className="ml-1.5 rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[0.68rem] font-extrabold text-[var(--primary)]">
            You
          </span>
        ) : null}
      </p>
      <p
        className={`mt-1 flex items-center gap-1.5 text-xs font-bold ${
          membership.isActive
            ? 'text-[var(--green)]'
            : 'text-[var(--red)]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            membership.isActive
              ? 'bg-[var(--green)]'
              : 'bg-[var(--red)]'
          }`}
        />
        {membership.isActive ? 'Active' : 'Inactive'}
      </p>
      {membership.isSourceProjection ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          From{' '}
          {membership.sourceApp
            ? portalAppLabels[membership.sourceApp]
            : 'source app'}
        </p>
      ) : null}
    </div>
  );
}

function SyncBadge({
  status,
  possibleDuplicateCount,
}: {
  status: UnifiedPortalSyncStatus;
  possibleDuplicateCount: number;
}) {
  const configs: Record<
    UnifiedPortalSyncStatus,
    { label: string; className: string }
  > = {
    synced: {
      label: 'Synced',
      className:
        'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]',
    },
    field_only: {
      label: 'Field only',
      className:
        'border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--primary)]',
    },
    drifted: {
      label: 'Role or status drift',
      className:
        'border-[var(--amber)]/30 bg-[var(--amber-soft)] text-[var(--amber)]',
    },
    missing_projection: {
      label: 'Missing Field access',
      className:
        'border-[var(--amber)]/30 bg-[var(--amber-soft)] text-[var(--amber)]',
    },
    orphaned_projection: {
      label: 'Orphaned Field access',
      className:
        'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]',
    },
    unlinked: {
      label: 'Unlinked',
      className:
        'border-[var(--amber)]/30 bg-[var(--amber-soft)] text-[var(--amber)]',
    },
  };
  const config = configs[status];

  return (
    <div>
      <span
        className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-extrabold ${config.className}`}
      >
        {config.label}
      </span>
      {possibleDuplicateCount > 0 ? (
        <p className="mt-1.5 max-w-36 text-xs font-semibold leading-5 text-[var(--amber)]">
          Possible match with {possibleDuplicateCount}{' '}
          {possibleDuplicateCount === 1 ? 'other account' : 'other accounts'}
        </p>
      ) : null}
    </div>
  );
}

function UserIdentity({ user }: { user: UnifiedPortalUser }) {
  return (
    <div className="min-w-0">
      <p className="font-extrabold text-[var(--text)]">{userLabel(user)}</p>
      <p className="mt-1 break-all text-sm leading-5 text-[var(--text-sub)]">
        {user.displayEmail ||
          (user.syncStatus === 'orphaned_projection'
            ? 'Source login unavailable'
            : 'Login unavailable')}
      </p>
    </div>
  );
}

function UserEditorAction({ user }: { user: UnifiedPortalUser }) {
  const editable = editableFieldMembership(user);
  if (editable) {
    return (
      <LinkButton
        href={`/installhub/admin/users/${encodeURIComponent(editable.userId)}`}
        variant="secondary"
      >
        Edit Field user
      </LinkButton>
    );
  }

  const fieldMembership = membershipForApp(user, 'installhub');
  let managementLabel = 'Managed in its source app';
  if (user.syncStatus === 'orphaned_projection') {
    managementLabel = 'Source account unavailable';
  } else if (fieldMembership?.isSourceProjection) {
    managementLabel = `Managed from ${
      fieldMembership.sourceApp
        ? portalAppLabels[fieldMembership.sourceApp]
        : 'source app'
    }`;
  }

  return (
    <p className="max-w-36 text-xs font-semibold leading-5 text-[var(--muted)]">
      {managementLabel}
    </p>
  );
}

export function InstallHubUsersPage() {
  const { user: currentUser } = useInstallHubAuth();
  const [search, setSearch] = useState('');
  const isAdmin = currentUser?.role === 'admin';
  const query = useQuery({
    queryKey: ['portal', 'unified-users'],
    queryFn: listUnifiedPortalUsers,
    enabled: isAdmin,
  });

  if (!isAdmin) return <AdminRequired />;
  if (query.isLoading) return <Spinner label="Loading unified users…" />;
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
  const summary = query.data?.summary;
  const identityCount = summary?.total ?? users.length;
  const membershipCount = summary
    ? Object.values(summary.byApp).reduce(
        (total, appSummary) => total + appSummary.total,
        0,
      )
    : users.reduce(
        (total, user) => total + user.memberships.length,
        0,
      );
  const activeCount =
    summary?.active ??
    users.filter((user) =>
      user.memberships.some((membership) => membership.isActive),
    ).length;
  const adminCount =
    summary?.admins ??
    users.filter((user) =>
      user.memberships.some((membership) => membership.role === 'admin'),
    ).length;
  const needsAttentionCount =
    summary?.needsAttention ??
    users.filter(
      (user) =>
        user.syncStatus !== 'synced' && user.syncStatus !== 'field_only',
    ).length;
  const filtered = filterUnifiedPortalUsers(users, search);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'InstallHub', href: '/installhub/dashboard' },
          { label: 'Unified users' },
        ]}
      />
      <PageHeader
        title="Unified user directory"
        subtitle="Review roles and access across Eco Audit, Solar Sense, and the Field App from one directory. Solar memberships remain visible here even when the Solar Sense application is hidden."
        actions={
          <LinkButton href="/installhub/admin/users/new">
            <Icon name="plus" size={17} />
            Add Field user
          </LinkButton>
        }
      />

      <div
        className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Unified user summary"
      >
        <StatCard
          label="Identities"
          value={identityCount}
          icon="users"
        />
        <StatCard
          label="Memberships"
          value={membershipCount}
          icon="apps"
        />
        <StatCard
          label="Active users"
          value={activeCount}
          icon="check"
          tone="success"
        />
        <StatCard label="Administrators" value={adminCount} icon="shield" />
        <StatCard
          label="Needs attention"
          value={needsAttentionCount}
          icon="activity"
          tone={needsAttentionCount ? 'warning' : 'success'}
        />
      </div>

      <Card className="mb-5 !p-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <label
            className="text-sm font-extrabold text-[var(--text)]"
            htmlFor="unified-user-search"
          >
            Search directory
          </label>
          <p
            className="text-xs font-semibold text-[var(--text-sub)]"
            role="status"
            aria-live="polite"
          >
            {filtered.length} of {users.length}{' '}
            {users.length === 1 ? 'identity' : 'identities'}
          </p>
        </div>
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <Input
            id="unified-user-search"
            className="pl-10"
            type="search"
            value={search}
            placeholder="Search name, login, app, role, status, or sync state"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No matching users' : 'No directory users'}
          description={
            search
              ? 'Try a different name, login, application, role, or status.'
              : 'Add the first Field App account.'
          }
          icon="users"
        />
      ) : (
        <section aria-labelledby="application-access-heading">
          <div className="mb-3">
            <h2
              id="application-access-heading"
              className="text-lg font-extrabold text-[var(--text)]"
            >
              Application access
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              Each row is one directory identity. Roles and active status are
              shown separately for every application membership.
            </p>
          </div>

          <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] lg:block">
            <table className="w-full min-w-[1020px] border-collapse text-left">
              <caption className="sr-only">
                Unified user roles and access status for Eco Audit, Solar
                Sense, and the Field App
              </caption>
              <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                <tr>
                  <th
                    className="w-[23%] border-b border-[var(--border)] px-4 py-3 font-extrabold"
                    scope="col"
                  >
                    User
                  </th>
                  {(['Eco Audit', 'Solar Sense', 'Field App'] as const).map(
                    (label) => (
                      <th
                        key={label}
                        className="w-[15%] border-b border-[var(--border)] px-4 py-3 font-extrabold"
                        scope="col"
                      >
                        {label}
                      </th>
                    ),
                  )}
                  <th
                    className="w-[13%] border-b border-[var(--border)] px-4 py-3 font-extrabold"
                    scope="col"
                  >
                    Sync state
                  </th>
                  <th
                    className="w-[19%] border-b border-[var(--border)] px-4 py-3 font-extrabold"
                    scope="col"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const fieldMembership = membershipForApp(user, 'installhub');
                  return (
                    <tr
                      key={user.key}
                      className="border-b border-[var(--border)] align-top last:border-0 hover:bg-[var(--surface2)]"
                    >
                      <th
                        className="px-4 py-4 text-left font-normal"
                        scope="row"
                      >
                        <UserIdentity user={user} />
                      </th>
                      <td className="px-4 py-4">
                        <MembershipSummary
                          membership={membershipForApp(user, 'ecoaudit')}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <MembershipSummary
                          membership={membershipForApp(user, 'solarsense')}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <MembershipSummary
                          membership={fieldMembership}
                          isCurrent={fieldMembership?.userId === currentUser.id}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <SyncBadge
                          status={user.syncStatus}
                          possibleDuplicateCount={user.possibleDuplicateCount}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <UserEditorAction user={user} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {filtered.map((user) => {
              const fieldMembership = membershipForApp(user, 'installhub');
              return (
                <Card key={user.key} className="!p-4">
                  <div className="flex items-start justify-between gap-3">
                    <UserIdentity user={user} />
                    <SyncBadge
                      status={user.syncStatus}
                      possibleDuplicateCount={user.possibleDuplicateCount}
                    />
                  </div>
                  <dl className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {(
                      [
                        ['Eco Audit', 'ecoaudit'],
                        ['Solar Sense', 'solarsense'],
                        ['Field App', 'installhub'],
                      ] as const
                    ).map(([label, app]) => (
                      <div
                        key={app}
                        className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-3 py-3"
                      >
                        <dt className="text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--text-sub)]">
                          {label}
                        </dt>
                        <dd>
                          <MembershipSummary
                            membership={membershipForApp(user, app)}
                            isCurrent={
                              app === 'installhub' &&
                              fieldMembership?.userId === currentUser.id
                            }
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4">
                    <UserEditorAction user={user} />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
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
  if (mode === 'edit' && query.data?.sourceManaged) {
    return (
      <SourceManagedFieldUserDetails
        user={query.data}
        isCurrentUser={query.data.id === currentUser.id}
      />
    );
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

function SourceManagedFieldUserDetails({
  user,
  isCurrentUser,
}: {
  user: ManagedInstallHubUser;
  isCurrentUser: boolean;
}) {
  const sourceName = user.sourceApp
    ? portalAppLabels[user.sourceApp]
    : 'source application';
  const sourceUnavailable = user.sourceState === 'orphaned';

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        items={[
          {
            label: 'User management',
            href: '/installhub/admin/users',
          },
          { label: 'User details' },
        ]}
      />
      <PageHeader
        title={user.fullName?.trim() || user.email || 'Source-managed user'}
        subtitle="Review this account's shared Field access. Its authoritative account remains in the source application."
        actions={
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
              user.isActive
                ? 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
                : 'border-[var(--red)]/25 bg-[var(--red-soft)] text-[var(--red)]'
            }`}
          >
            {user.isActive ? 'Active' : 'Inactive'}
          </span>
        }
      />

      <InlineNotice>
        {sourceUnavailable
          ? 'The source account is unavailable. This inactive Field record is retained only for traceability and cannot be edited or used to sign in.'
          : `This account is managed in ${sourceName}. Profile, role, status, and administrator password resets are read-only here; source changes update its shared Field access automatically.`}
      </InlineNotice>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Account details
          </h2>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold text-[var(--text-sub)]">
            Read only
          </span>
        </div>
        <dl className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {[
            ['Full name', user.fullName?.trim() || 'Not provided'],
            ['Login', user.email || 'Source account unavailable'],
            [
              'Role',
              user.role === 'admin' ? 'Administrator' : 'Inspector',
            ],
            ['Status', user.isActive ? 'Active' : 'Inactive'],
            ['Managed by', sourceUnavailable ? 'Source unavailable' : sourceName],
          ].map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
            >
              <dt className="text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--text-sub)]">
                {label}
              </dt>
              <dd className="break-all text-sm font-semibold text-[var(--text)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <LinkButton href="/installhub/admin/users" variant="secondary">
            Back to users
          </LinkButton>
          {isCurrentUser && !sourceUnavailable ? (
            <LinkButton href="/installhub/settings/password">
              Change my password
            </LinkButton>
          ) : null}
        </div>
      </Card>
    </div>
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
