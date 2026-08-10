'use client';

import { useMemo } from 'react';
import { Spinner, StatCard, ErrorBanner } from '@/components/ui/Card';
import { SOURCE_APP_LABEL, appChipClass } from '@/modules/scheduler/lib/colors';
import {
  deadlineRemainingLabel,
  formatLocalDateTime,
  sortEventsByDeadlineUrgency,
} from '@/modules/scheduler/lib/deadline';
import { useScheduleEvents, useScheduleSummary } from '@/modules/scheduler/hooks/useScheduler';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export function SchedulerDashboard({
  onOpenDeadlines,
  onCreate,
}: {
  onOpenDeadlines: () => void;
  onCreate: () => void;
}) {
  const summary = useScheduleSummary();
  const range = useMemo(() => monthRange(), []);
  const events = useScheduleEvents({ from: range.from, to: range.to });

  if (summary.isLoading || events.isLoading) {
    return <Spinner label="Loading dashboard…" />;
  }
  if (summary.error || events.error) {
    return (
      <ErrorBanner
        message={
          (summary.error as Error)?.message
          || (events.error as Error)?.message
          || 'Could not load scheduler overview.'
        }
      />
    );
  }

  const s = summary.data!;
  const upcoming = sortEventsByDeadlineUrgency(events.data ?? [])
    .filter((e) => e.status !== 'done' && e.status !== 'cancelled')
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today" value={String(s.today)} />
        <StatCard label="This week" value={String(s.thisWeek)} />
        <StatCard label="Overdue" value={String(s.overdue)} tone="danger" />
        <StatCard
          label="Active"
          value={String(s.planned + s.inProgress)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(s.byApp) as Array<keyof typeof s.byApp>).map((app) => (
          <div
            key={app}
            className={`rounded-2xl px-4 py-3 text-sm font-bold ${appChipClass(app)}`}
          >
            <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] opacity-80">
              {SOURCE_APP_LABEL[app]}
            </p>
            <p className="mt-1 text-2xl font-extrabold tracking-[-0.03em]">{s.byApp[app]}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
            Next deadlines
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onOpenDeadlines}
              className="text-sm font-bold text-[var(--primary)] hover:underline"
            >
              View all
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-extrabold text-white"
            >
              + Add job
            </button>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--text-sub)]">No open deadlines in this calendar window.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {upcoming.map((event) => (
              <DeadlineRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeadlineRow({ event }: { event: ScheduleEvent }) {
  const rem = deadlineRemainingLabel(event.deadlineAt);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-extrabold text-[var(--text)]">{event.title}</p>
        <p className="mt-0.5 text-xs text-[var(--text-sub)]">
          {event.assigneeDisplayName || event.assigneeEmail || 'Unnamed'} · due{' '}
          {formatLocalDateTime(event.deadlineAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${appChipClass(event.sourceApp)}`}>
          {SOURCE_APP_LABEL[event.sourceApp]}
        </span>
        <span
          className={`text-xs font-extrabold ${rem.overdue ? 'text-[var(--red)]' : 'text-[var(--text-sub)]'}`}
        >
          {rem.label}
        </span>
      </div>
    </li>
  );
}

function monthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59));
  return { from: from.toISOString(), to: to.toISOString() };
}
