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
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

/** Stable day-level window so React Query keys don't change every render. */
function deadlineRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 13, 0, 23, 59, 59, 999));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function DeadlineTable({
  assigneeFieldUserId,
  onSelect,
}: {
  assigneeFieldUserId?: string;
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
    (e) => e.status !== 'cancelled',
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-sub)]">
        No assigned jobs yet. Create one from the Calendar or Overview tab.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={tableHeadClass}>Job</th>
            <th className={tableHeadClass}>App</th>
            <th className={tableHeadClass}>Assignee</th>
            <th className={tableHeadClass}>Scheduled</th>
            <th className={tableHeadClass}>Deadline</th>
            <th className={tableHeadClass}>Remaining</th>
            <th className={tableHeadClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => {
            const rem = deadlineRemainingLabel(event.deadlineAt);
            return (
              <tr
                key={event.id}
                className={onSelect ? 'cursor-pointer hover:bg-[var(--surface2)]' : undefined}
                onClick={() => onSelect?.(event)}
              >
                <td className={tableCellClass}>
                  <p className="font-extrabold text-[var(--text)]">{event.title}</p>
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
                <td className={`${tableCellClass} font-extrabold ${rem.overdue ? 'text-[var(--red)]' : ''}`}>
                  {rem.label}
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
  );
}
