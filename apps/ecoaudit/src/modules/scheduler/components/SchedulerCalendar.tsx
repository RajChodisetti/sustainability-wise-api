'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { appBarClass, appChipClass, SOURCE_APP_LABEL } from '@/modules/scheduler/lib/colors';
import { useScheduleEvents } from '@/modules/scheduler/hooks/useScheduler';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export function SchedulerCalendar({
  assigneeFieldUserId,
  onSlotClick,
  onEventClick,
}: {
  assigneeFieldUserId?: string;
  onSlotClick: (day: Date) => void;
  onEventClick: (event: ScheduleEvent) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [mode, setMode] = useState<'month' | 'week'>('month');

  const range = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    // expand for leading/trailing cells
    from.setDate(from.getDate() - 7);
    to.setDate(to.getDate() + 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [cursor, mode]);

  const query = useScheduleEvents({
    from: range.from,
    to: range.to,
    assigneeFieldUserId,
  });

  const days = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }
    return buildMonthGrid(cursor);
  }, [cursor, mode]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of query.data ?? []) {
      if (event.status === 'cancelled') continue;
      const key = dayKey(new Date(event.scheduledStartAt));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [query.data]);

  if (query.isLoading) return <Spinner label="Loading calendar…" />;
  if (query.error) {
    return <ErrorBanner message={(query.error as Error).message || 'Calendar failed to load'} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCursor((c) => shiftPeriod(c, mode, -1))}
          >
            ‹
          </Button>
          <p className="min-w-[10rem] text-center text-sm font-extrabold text-[var(--text)]">
            {mode === 'month'
              ? cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })
              : `Week of ${startOfWeek(cursor).toLocaleDateString()}`}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCursor((c) => shiftPeriod(c, mode, 1))}
          >
            ›
          </Button>
          <Button type="button" variant="secondary" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </Button>
        </div>
        <div className="flex rounded-full bg-[var(--surface2)] p-1">
          {(['month', 'week'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1.5 text-xs font-extrabold capitalize ${
                mode === m ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-sub)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="bg-[var(--surface2)] px-2 py-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-sub)]"
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const items = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === cursor.getMonth() || mode === 'week';
          const isToday = dayKey(day) === dayKey(new Date());
          return (
            <button
              key={key + day.getTime()}
              type="button"
              onClick={() => onSlotClick(day)}
              className={`min-h-[7.5rem] bg-[var(--surface)] p-1.5 text-left align-top transition-colors hover:bg-[var(--surface2)] ${
                !inMonth ? 'opacity-45' : ''
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                  isToday ? 'bg-[var(--primary)] text-white' : 'text-[var(--text)]'
                }`}
              >
                {day.getDate()}
              </span>
              <ul className="mt-1 space-y-1">
                {items.slice(0, mode === 'week' ? 8 : 3).map((event) => (
                  <li key={event.id}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(event);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          onEventClick(event);
                        }
                      }}
                      className={`block truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight ${appChipClass(event.sourceApp)}`}
                      title={event.title}
                    >
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${appBarClass(event.sourceApp)}`} />
                      {event.title}
                    </span>
                  </li>
                ))}
                {items.length > (mode === 'week' ? 8 : 3) ? (
                  <li className="px-1 text-[10px] font-bold text-[var(--text-sub)]">
                    +{items.length - (mode === 'week' ? 8 : 3)} more
                  </li>
                ) : null}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-bold text-[var(--text-sub)]">
        {(Object.keys(SOURCE_APP_LABEL) as Array<keyof typeof SOURCE_APP_LABEL>).map((app) => (
          <span key={app} className={`rounded-full px-2 py-1 ${appChipClass(app)}`}>
            {SOURCE_APP_LABEL[app]}
          </span>
        ))}
      </div>
    </div>
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function buildMonthGrid(monthStart: Date): Date[] {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function shiftPeriod(cursor: Date, mode: 'month' | 'week', dir: number): Date {
  const next = new Date(cursor);
  if (mode === 'month') next.setMonth(next.getMonth() + dir);
  else next.setDate(next.getDate() + dir * 7);
  return next;
}
