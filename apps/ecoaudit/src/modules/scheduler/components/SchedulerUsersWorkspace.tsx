'use client';

import { useMemo, useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { SchedulerPeopleLeaderboard } from '@/modules/scheduler/components/SchedulerPeopleLeaderboard';
import {
  usePortalAssignees,
  useUpdatePortalUserBillingRate,
} from '@/modules/scheduler/hooks/useScheduler';

const APP_LABELS = {
  ecoaudit: 'EcoAudit',
  solarsense: 'SolarSense',
  installhub: 'Field App',
} as const;

export function SchedulerUsersWorkspace() {
  const usersQuery = usePortalAssignees();
  const users = useMemo(
    () => [...(usersQuery.data ?? [])].sort((left, right) => left.label.localeCompare(right.label)),
    [usersQuery.data],
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="scheduler-default-rates-heading" className="space-y-4">
        <div>
          <h2 id="scheduler-default-rates-heading" className="section-title">Default billing rates</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-sub)]">
            Set each user&apos;s canonical customer billing rate once. Scheduler finance applies the numeric default in each job&apos;s selected currency without automatic currency conversion, and keeps an unset rate visible for administrator review.
          </p>
        </div>

        {usersQuery.isLoading ? <Spinner label="Loading Scheduler users…" /> : null}
        {usersQuery.isError ? (
          <div className="space-y-3">
            <ErrorBanner message={cloudConnectionErrorMessage(usersQuery.error)} />
            <Button type="button" variant="secondary" onClick={() => void usersQuery.refetch()}>
              <Icon name="refresh" size={17} /> Try again
            </Button>
          </div>
        ) : null}
        {!usersQuery.isLoading && !usersQuery.isError && users.length === 0 ? (
          <EmptyState
            icon="users"
            title="No active Scheduler users"
            description="Active users from EcoAudit, SolarSense, and Field App will appear here."
          />
        ) : null}
        {users.length > 0 ? (
          <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] lg:grid-cols-2 sm:p-5">
            {users.map((user) => {
              const products = user.appMemberships.map((app) => APP_LABELS[app]).join(', ');
              return (
                <BillingRateEditor
                  key={`${user.key}:${user.billingRate ?? 'unset'}`}
                  userId={user.key}
                  displayName={user.label}
                  supportingText={`${user.email}${products ? ` · ${products}` : ''}`}
                  billingRate={user.billingRate}
                />
              );
            })}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="scheduler-weekly-user-stats-heading" className="space-y-4">
        <div>
          <h2 id="scheduler-weekly-user-stats-heading" className="section-title">Weekly user statistics</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--text-sub)]">
            The report opens to the current week and shows completed, scheduled, and unscheduled jobs with each user&apos;s average completed jobs per working day. Change the reporting dates when a different period is needed.
          </p>
        </div>
        <SchedulerPeopleLeaderboard />
      </section>
    </div>
  );
}

function numberValue(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function BillingRateEditor({
  userId,
  displayName,
  supportingText,
  billingRate,
}: {
  userId: string;
  displayName: string;
  supportingText: string;
  billingRate: number | null;
}) {
  const toast = useToast();
  const update = useUpdatePortalUserBillingRate();
  const [value, setValue] = useState(billingRate?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);

  async function saveRate() {
    const next = numberValue(value);
    if (next === undefined) {
      setError('Enter an hourly rate of zero or more.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ globalUserId: userId, billingRate: next });
      toast.success(`Default billing rate saved for ${displayName}.`);
    } catch (cause) {
      setError(cloudConnectionErrorMessage(cause));
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
      <p className="text-sm font-extrabold text-[var(--text)]">{displayName}</p>
      <p className="mt-0.5 truncate text-xs text-[var(--text-sub)]">{supportingText}</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={`billing-rate-${userId}`}>Default billing rate / hour</FieldLabel>
          <Input
            id={`billing-rate-${userId}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            disabled={update.isPending}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Not set"
          />
        </div>
        <Button type="button" variant="secondary" disabled={update.isPending} onClick={() => void saveRate()}>
          {update.isPending ? 'Saving…' : 'Save default'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-sub)]">Leave blank to mark this user&apos;s default rate as not set.</p>
      {error ? <p className="mt-2 text-xs font-semibold text-[var(--red)]">{error}</p> : null}
    </div>
  );
}
