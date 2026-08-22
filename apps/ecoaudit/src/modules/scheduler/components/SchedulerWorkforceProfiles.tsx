'use client';

import { useMemo, useState } from 'react';
import { ApiError, cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { validIanaTimezone } from '@/modules/scheduler/components/SchedulerAnalyticsFilters';
import {
  usePortalAssignees,
  useUpdatePortalUserWorkforceProfile,
} from '@/modules/scheduler/hooks/useScheduler';
import type { PortalDirectoryUser } from '@/modules/scheduler/types/domain';

const WEEKDAYS = [
  { bit: 2, short: 'Mon', long: 'Monday' },
  { bit: 4, short: 'Tue', long: 'Tuesday' },
  { bit: 8, short: 'Wed', long: 'Wednesday' },
  { bit: 16, short: 'Thu', long: 'Thursday' },
  { bit: 32, short: 'Fri', long: 'Friday' },
  { bit: 64, short: 'Sat', long: 'Saturday' },
  { bit: 1, short: 'Sun', long: 'Sunday' },
] as const;

const TIMEZONE_SUGGESTIONS = [
  'Australia/Sydney',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Darwin',
  'Pacific/Auckland',
  'UTC',
] as const;

function workforceErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError
    && error.status === 409
    && (error.detail ?? error.message) === 'workforce_profile_version_conflict'
  ) {
    return 'This profile changed while you were editing it. Refresh the directory and try again.';
  }
  return cloudConnectionErrorMessage(error);
}

export function SchedulerWorkforceProfiles() {
  const query = usePortalAssignees();
  const users = useMemo(
    () => [...(query.data ?? [])].sort((left, right) => left.label.localeCompare(right.label)),
    [query.data],
  );

  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)]">
      <summary className="cursor-pointer list-none px-4 py-4 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 sm:px-5">
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="section-title block">Workforce rules</span>
            <span className="mt-1 block text-sm font-normal leading-6 text-[var(--text-sub)]">
              Set each user&apos;s timezone and normal working days for leave and people analytics.
            </span>
          </span>
          <Icon name="settings" size={20} className="mt-1 shrink-0 text-[var(--primary)]" />
        </span>
      </summary>
      <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">
        {query.isLoading ? <Spinner label="Loading workforce profiles…" /> : null}
        {query.isError ? <ErrorBanner message={cloudConnectionErrorMessage(query.error)} /> : null}
        {!query.isLoading && !query.isError && users.length === 0 ? (
          <EmptyState
            icon="users"
            title="No active workforce profiles"
            description="Active canonical users will appear here."
          />
        ) : null}
        <div className="grid gap-3 xl:grid-cols-2">
          {users.map((user) => (
            <WorkforceProfileEditor key={`${user.key}:${user.updatedAt}`} user={user} />
          ))}
        </div>
      </div>
    </details>
  );
}

function WorkforceProfileEditor({ user }: { user: PortalDirectoryUser }) {
  const update = useUpdatePortalUserWorkforceProfile();
  const [timezone, setTimezone] = useState(user.timezone);
  const [workingDaysMask, setWorkingDaysMask] = useState(user.workingDaysMask);
  const [error, setError] = useState<string | null>(null);
  const timezoneListId = `workforce-timezones-${user.key}`;

  const normalizedTimezone = timezone.trim();
  const valid = normalizedTimezone.length <= 100
    && validIanaTimezone(normalizedTimezone)
    && workingDaysMask >= 1
    && workingDaysMask <= 127;
  const dirty = normalizedTimezone !== user.timezone
    || workingDaysMask !== user.workingDaysMask;

  function toggleDay(bit: number) {
    setWorkingDaysMask((current) => current ^ bit);
  }

  async function save() {
    setError(null);
    if (!valid) {
      setError('Choose at least one working day and enter a valid IANA timezone.');
      return;
    }
    try {
      await update.mutateAsync({
        globalUserId: user.key,
        timezone: normalizedTimezone,
        workingDaysMask,
        expectedUpdatedAt: user.updatedAt,
      });
    } catch (cause) {
      setError(workforceErrorMessage(cause));
    }
  }

  return (
    <Card className="!p-4">
      <div>
        <h3 className="font-extrabold text-[var(--text)]">{user.label}</h3>
        <p className="mt-0.5 truncate text-xs text-[var(--text-sub)]">{user.email}</p>
      </div>
      <FieldLabel htmlFor={`workforce-timezone-${user.key}`}>Timezone</FieldLabel>
      <Input
        id={`workforce-timezone-${user.key}`}
        list={timezoneListId}
        maxLength={100}
        value={timezone}
        spellCheck={false}
        disabled={update.isPending}
        onChange={(event) => setTimezone(event.target.value)}
      />
      <datalist id={timezoneListId}>
        {TIMEZONE_SUGGESTIONS.map((value) => <option key={value} value={value} />)}
      </datalist>
      <fieldset className="mt-4">
        <legend className="text-xs font-bold text-[var(--text)]">Normal working days</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const checked = (workingDaysMask & day.bit) !== 0;
            return (
              <label key={day.bit} className={`inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3 text-xs font-extrabold transition-colors ${checked ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-sub)]'}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={update.isPending}
                  aria-label={day.long}
                  onChange={() => toggleDay(day.bit)}
                />
                {day.short}
              </label>
            );
          })}
        </div>
      </fieldset>
      <FieldHint>Approved leave subtracts only dates that are normally working days.</FieldHint>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="secondary" disabled={!dirty || !valid || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Saving…' : 'Save workforce rules'}
        </Button>
      </div>
    </Card>
  );
}
