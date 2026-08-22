'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import {
  DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE,
  MAX_SCHEDULER_ANALYTICS_DAYS,
  type SchedulerAnalyticsFilters,
} from '@/modules/scheduler/types/analytics';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE_SUGGESTIONS = [
  'Australia/Sydney',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Darwin',
  'Pacific/Auckland',
  'UTC',
] as const;

function dateKeyInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateSpanDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

function validDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function currentWeekAnalyticsFilters(
  timezone = DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE,
  now = new Date(),
): SchedulerAnalyticsFilters {
  const safeTimezone = validIanaTimezone(timezone)
    ? timezone
    : DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE;
  const today = dateKeyInTimezone(now, safeTimezone);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const monday = addCalendarDays(today, -((weekday + 6) % 7));
  return {
    from: monday,
    to: addCalendarDays(monday, 6),
    timezone: safeTimezone,
  };
}

export function SchedulerAnalyticsFilters({
  filters,
  onApply,
  isFetching = false,
  idPrefix,
}: {
  filters: SchedulerAnalyticsFilters;
  onApply: (filters: SchedulerAnalyticsFilters) => void;
  isFetching?: boolean;
  idPrefix: string;
}) {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [timezone, setTimezone] = useState(filters.timezone);
  const [error, setError] = useState<string | null>(null);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedTimezone = timezone.trim();
    if (!validDateKey(from) || !validDateKey(to) || from > to) {
      setError('Choose an inclusive date range with the end date on or after the start date.');
      return;
    }
    if (dateSpanDays(from, to) > MAX_SCHEDULER_ANALYTICS_DAYS) {
      setError(`Choose a window of ${MAX_SCHEDULER_ANALYTICS_DAYS} days or fewer.`);
      return;
    }
    if (normalizedTimezone.length > 100 || !validIanaTimezone(normalizedTimezone)) {
      setError('Enter a valid IANA timezone, such as Australia/Sydney.');
      return;
    }
    onApply({ from, to, timezone: normalizedTimezone });
  }

  function useCurrentWeek() {
    const next = currentWeekAnalyticsFilters(timezone.trim());
    setError(null);
    setFrom(next.from);
    setTo(next.to);
    setTimezone(next.timezone);
    onApply(next);
  }

  function useLastThirtyDays() {
    const safeTimezone = validIanaTimezone(timezone.trim())
      ? timezone.trim()
      : DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE;
    const today = dateKeyInTimezone(new Date(), safeTimezone);
    const next = { from: addCalendarDays(today, -29), to: today, timezone: safeTimezone };
    setError(null);
    setFrom(next.from);
    setTo(next.to);
    setTimezone(next.timezone);
    onApply(next);
  }

  const timezoneListId = `${idPrefix}-timezones`;
  return (
    <section
      aria-label="Analytics reporting window"
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5"
    >
      <form onSubmit={apply}>
        <div className="grid gap-x-3 gap-y-3 md:grid-cols-2 xl:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(14rem,1fr)_auto] xl:items-end">
          <div>
            <FieldLabel htmlFor={`${idPrefix}-from`} className="!mt-0">From</FieldLabel>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`${idPrefix}-to`} className="!mt-0">To</FieldLabel>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`${idPrefix}-timezone`} className="!mt-0">Timezone</FieldLabel>
            <Input
              id={`${idPrefix}-timezone`}
              list={timezoneListId}
              value={timezone}
              maxLength={100}
              spellCheck={false}
              placeholder="Australia/Sydney"
              onChange={(event) => setTimezone(event.target.value)}
            />
            <datalist id={timezoneListId}>
              {TIMEZONE_SUGGESTIONS.map((value) => <option key={value} value={value} />)}
            </datalist>
          </div>
          <Button type="submit" className="w-full xl:w-auto" disabled={isFetching}>
            <Icon name="refresh" size={17} />
            {isFetching ? 'Updating…' : 'Apply window'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <FieldHint>
            Dates are inclusive in the selected timezone. Maximum {MAX_SCHEDULER_ANALYTICS_DAYS} days.
          </FieldHint>
          <div className="flex flex-wrap gap-2" aria-label="Quick reporting windows">
            <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 text-xs" onClick={useCurrentWeek}>
              This week
            </Button>
            <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 text-xs" onClick={useLastThirtyDays}>
              Last 30 days
            </Button>
          </div>
        </div>
        {error ? <p className="mt-2 text-sm font-semibold text-[var(--red)]" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
