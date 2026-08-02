'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import {
  Card,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import { useToast } from '@/contexts/ToastContext';
import {
  getInstallationAccess,
  listUsers,
  setInstallationAccess,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import type {
  InstallationAccess,
  ManagedInstallHubUser,
} from '@/modules/installhub/types/domain';

function userLabel(
  user: Pick<ManagedInstallHubUser, 'email' | 'fullName'>,
): string {
  return user.fullName?.trim() || user.email;
}

type AccessData = {
  access: InstallationAccess;
  users: ManagedInstallHubUser[];
};

export function InstallHubAccessPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const { user } = useInstallHubAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const [selectionOverride, setSelectionOverride] = useState<
    string | null | undefined
  >(undefined);
  const [saving, setSaving] = useState(false);
  const query = useQuery<AccessData>({
    queryKey: ['installhub', 'installation-access', installationId, isAdmin],
    queryFn: async () => {
      if (!isAdmin) {
        return {
          access: await getInstallationAccess(installationId),
          users: [],
        };
      }
      const [access, users] = await Promise.all([
        getInstallationAccess(installationId),
        listUsers(),
      ]);
      return { access, users: users.data };
    },
  });

  if (query.isLoading) return <Spinner />;
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
  if (!query.data) return <ErrorBanner message="Access record not found." />;

  const access = query.data.access;
  const selectedUserId =
    selectionOverride === undefined
      ? access.assignedInspectorUserId
      : selectionOverride;
  const unchanged = selectedUserId === access.assignedInspectorUserId;
  const activeUsers = query.data.users
    .filter((candidate) => candidate.isActive)
    .sort((left, right) =>
      userLabel(left).localeCompare(userLabel(right), undefined, {
        sensitivity: 'base',
      }),
    );

  async function save() {
    setSaving(true);
    try {
      const updated = await setInstallationAccess(
        installationId,
        selectedUserId,
      );
      setSelectionOverride(updated.assignedInspectorUserId);
      await query.refetch();
      setSelectionOverride(undefined);
      toast.success(
        updated.assignedInspector
          ? `${userLabel(updated.assignedInspector)} can now access this installation.`
          : 'Assigned-user access removed.',
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const currentAssignment = access.assignedInspector;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          {
            label: 'Installation',
            href: `/installhub/installations/${installationId}`,
          },
          { label: 'Access' },
        ]}
      />
      <PageHeader
        title="Installation access"
        subtitle="See who can open this cloud installation and, for administrators, assign it to an inspector."
      />

      <InlineNotice>
        Assignment lets that user see the cloud installation. The owner and
        Field App Complete administrators retain access.
      </InlineNotice>

      <Card className="mt-5">
        <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
          Current assignment
        </p>
        <p className="mt-2 text-lg font-extrabold text-[var(--text)]">
          {currentAssignment ? userLabel(currentAssignment) : 'Unassigned'}
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
          {currentAssignment
            ? `${currentAssignment.email} · ${currentAssignment.role}${
                currentAssignment.isActive ? '' : ' · inactive'
              }`
            : 'Only the owner and administrators currently have access.'}
        </p>
      </Card>

      {!isAdmin ? (
        <Card className="mt-5">
          <p className="font-extrabold text-[var(--text)]">
            Administrator controls
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            Inspectors can view the current assignment. A Field App Complete
            administrator is required to change it.
          </p>
        </Card>
      ) : (
        <section className="mt-7" aria-labelledby="assign-access-heading">
          <h2
            id="assign-access-heading"
            className="mb-3 text-lg font-extrabold text-[var(--text)]"
          >
            Assign to
          </h2>
          <div
            className="space-y-2"
            role="radiogroup"
            aria-label="Assigned inspector"
          >
            <label
              className={`flex min-h-[68px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border p-4 ${
                selectedUserId === null
                  ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              <input
                type="radio"
                name="assignedInspector"
                checked={selectedUserId === null}
                disabled={saving}
                onChange={() => setSelectionOverride(null)}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              <span>
                <span className="block font-extrabold text-[var(--text)]">
                  Unassigned
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">
                  Remove assigned-user access while retaining owner and
                  administrator access.
                </span>
              </span>
            </label>

            {activeUsers.map((candidate) => (
              <label
                key={candidate.id}
                className={`flex min-h-[68px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border p-4 ${
                  selectedUserId === candidate.id
                    ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                <input
                  type="radio"
                  name="assignedInspector"
                  checked={selectedUserId === candidate.id}
                  disabled={saving}
                  onChange={() => setSelectionOverride(candidate.id)}
                  className="h-5 w-5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-extrabold text-[var(--text)]">
                    {userLabel(candidate)}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">
                    {candidate.email} · {candidate.role}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Button
            className="mt-4 w-full sm:w-auto"
            disabled={saving || unchanged}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save access'}
          </Button>
        </section>
      )}
    </div>
  );
}
