'use client';

import { useMemo } from 'react';
import {
  tableCellClass,
  tableClass,
  tableHeadClass,
} from '@/modules/fleet/components/Table';
import { Spinner, ErrorBanner } from '@/components/ui/Card';
import { SOURCE_APP_LABEL, appChipClass } from '@/modules/scheduler/lib/colors';
import {
  deadlineRemainingLabel,
  formatLocalDateTime,
  sortEventsByDeadlineUrgency,
} from '@/modules/scheduler/lib/deadline';
import { useScheduleEvents } from '@/modules/scheduler/hooks/useScheduler';
import type { ScheduleEvent, ScheduleSourceApp } from '@/modules/scheduler/types/domain';

/** Stable day-level window so React Query keys don't change every render. */
function deadlineRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 0, 23, 59, 59, 999));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function DeadlineTable({
  assigneeFieldUserId,
  visibleSourceApps,
  onSelect,
}: {
  assigneeFieldUserId?: string;
  visibleSourceApps: ScheduleSourceApp[];
  onSelect?: (event: ScheduleEvent) => void;
}) {
  // Memoize once per mount — new Date() in the key would re-fetch forever while loading.
  const range = useMemo(() => deadlineRange(), []);

  const query = useScheduleEvents({
    from: range.from,
    to: range.to,
    assigneeFieldUserId,
  });

  if (query.isLoading) return <Spinner label="Loading deadlines…" />;
  if (query.error) {
    return <ErrorBanner message={(query.error as Error).message || 'Failed to load deadlines'} />;
  }

  const rows = sortEventsByDeadlineUrgency(query.data ?? []).filter(
    (event) => visibleSourceApps.includes(event.sourceApp) && event.status !== 'cancelled',
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-sub)] shadow-[var(--shadow-xs)]">
        No assigned jobs yet. Create one from the Calendar or Overview tab.
      </p>
    );
  }

  return (
    <div>
      <div className="space-y-2 md:hidden" aria-label="Deadlines">
        {rows.map((event) => (
          <DeadlineCard key={event.id} event={event} onSelect={onSelect} />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] md:block">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={tableHeadClass}>Job</th>
              <th className={tableHeadClass}>Product</th>
              <th className={tableHeadClass}>Assignee</th>
              <th className={tableHeadClass}>Scheduled</th>
              <th className={tableHeadClass}>Deadline</th>
              <th className={tableHeadClass}>Remaining</th>
              <th className={tableHeadClass}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const remaining = deadlineRemainingLabel(event.deadlineAt);
              return (
                <tr
                  key={event.id}
                  className={`${onSelect ? 'cursor-pointer' : ''} hover:bg-[var(--surface2)]`}
                  onClick={onSelect ? () => onSelect(event) : undefined}
                >
                  <td className={tableCellClass}>
                    {onSelect ? (
                      <button
                        type="button"
                        className="max-w-xs text-left font-extrabold text-[var(--text)] hover:text-[var(--primary)] hover:underline"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onSelect(event);
                        }}
                      >
                        {event.title}
                      </button>
                    ) : (
                      <p className="font-extrabold text-[var(--text)]">{event.title}</p>
                    )}
                    {event.description ? (
                      <p className="mt-0.5 max-w-xs truncate text-xs text-[var(--text-sub)]">
                        {event.description}
                      </p>
                    ) : null}
                  </td>
                  <td className={tableCellClass}>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-extrabold ${appChipClass(event.sourceApp)}`}>
                      {SOURCE_APP_LABEL[event.sourceApp]}
                    </span>
                  </td>
                  <td className={tableCellClass}>
                    {event.assigneeDisplayName || event.assigneeEmail || '—'}
                  </td>
                  <td className={tableCellClass}>{formatLocalDateTime(event.scheduledStartAt)}</td>
                  <td className={tableCellClass}>{formatLocalDateTime(event.deadlineAt)}</td>
                  <td className={`${tableCellClass} font-extrabold ${remaining.overdue ? 'text-[var(--red)]' : ''}`}>
                    {remaining.label}
                  </td>
                  <td className={tableCellClass}>
                    <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-sub)]">
                      {event.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeadlineCard({
  event,
  onSelect,
}: {
  event: ScheduleEvent;
  onSelect?: (event: ScheduleEvent) => void;
}) {
  const remaining = deadlineRemainingLabel(event.deadlineAt);
  const content = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-[var(--text)]">{event.title}</span>
          <span className="mt-1 block text-xs text-[var(--text-sub)]">
            {event.assigneeDisplayName || event.assigneeEmail || 'Unassigned'}
          </span>
          {event.description ? (
            <span className="mt-1 block line-clamp-2 text-xs text-[var(--text-sub)]">{event.description}</span>
          ) : null}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${appChipClass(event.sourceApp)}`}>
          {SOURCE_APP_LABEL[event.sourceApp]}
        </span>
      </span>
      <span className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-xs">
        <span>
          <span className="block font-bold uppercase tracking-wide text-[var(--muted)]">Scheduled</span>
          <span className="mt-1 block text-[var(--text-sub)]">{formatLocalDateTime(event.scheduledStartAt)}</span>
        </span>
        <span>
          <span className="block font-bold uppercase tracking-wide text-[var(--muted)]">Deadline</span>
          <span className="mt-1 block text-[var(--text-sub)]">{formatLocalDateTime(event.deadlineAt)}</span>
        </span>
        <span>
          <span className="block font-bold uppercase tracking-wide text-[var(--muted)]">Remaining</span>
          <span className={`mt-1 block font-extrabold ${remaining.overdue ? 'text-[var(--red)]' : 'text-[var(--text)]'}`}>
            {remaining.label}
          </span>
        </span>
        <span>
          <span className="block font-bold uppercase tracking-wide text-[var(--muted)]">Status</span>
          <span className="mt-1 block font-extrabold capitalize text-[var(--text)]">{event.status.replace('_', ' ')}</span>
        </span>
      </span>
    </>
  );

  if (!onSelect) {
    return (
      <article className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
        {content}
      </article>
    );
  }

  return (
    <button
      type="button"
      className="block min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-[var(--shadow-xs)] hover:border-[var(--primary)] hover:bg-[var(--surface2)]"
      onClick={() => onSelect(event)}
    >
      {content}
    </button>
  );
}
