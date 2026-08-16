'use client';

import { useDroppable } from '@dnd-kit/core';
import { useMemo } from 'react';
import { ScheduleEventBlock } from '@/modules/scheduler/components/ScheduleEventBlock';
import { initials } from '@/modules/scheduler/lib/weekGrid';
import {
  dayKey,
  eventBlockStyle,
  GRID_HOUR_START,
  GRID_HOUR_END,
  gridHeightPx,
  HOUR_HEIGHT_PX,
  hoursInGrid,
} from '@/modules/scheduler/lib/weekGrid';
import type { PortalDirectoryUser, ScheduleEvent } from '@/modules/scheduler/types/domain';

export type SlotDropData = {
  type: 'slot';
  dayKey: string;
  day: Date;
  hour: number;
};

export type StaffDropData = {
  type: 'staff';
  fieldUserId: string;
};

export function WeekTimeGrid({
  days,
  events,
  staff,
  canDrag,
  onSlotClick,
  onEventClick,
}: {
  days: Date[];
  events: ScheduleEvent[];
  staff: PortalDirectoryUser[];
  canDrag: boolean;
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: ScheduleEvent) => void;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of events) {
      if (event.status === 'cancelled') continue;
      const key = dayKey(new Date(event.scheduledStartAt));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const hours = hoursInGrid();
  const nowLine = useMemo(() => nowLineOffset(days), [days]);

  return (
    <div className="min-w-0 flex-1 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div
        className="grid min-w-[720px]"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]" />
        {days.map((day) => {
          const key = dayKey(day);
          const chips = staff.slice(0, 8);
          return (
            <div
              key={key}
              className="sticky top-0 z-20 border-b border-l border-[var(--border)] bg-[var(--surface)] px-1 py-2 text-center"
            >
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-sub)]">
                {day.toLocaleDateString(undefined, { weekday: 'short' })}
              </p>
              <p className="text-sm font-extrabold text-[var(--text)]">{day.getDate()}</p>
              <div className="mt-1 flex flex-wrap justify-center gap-0.5">
                {chips.map((c) => (
                  <StaffChipDrop
                    key={`${key}:${c.fieldUserId}`}
                    id={`staff:${key}:${c.fieldUserId}`}
                    user={c}
                    enabled={canDrag}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Time gutter + day columns */}
        <div className="relative border-r border-[var(--border)]" style={{ height: gridHeightPx() }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 text-[10px] font-bold text-[var(--muted)]"
              style={{ top: (h - GRID_HOUR_START) * HOUR_HEIGHT_PX }}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const key = dayKey(day);
          const dayEvents = byDay.get(key) ?? [];
          return (
            <DayColumn
              key={key}
              day={day}
              dayKeyStr={key}
              hours={hours}
              events={dayEvents}
              canDrag={canDrag}
              showNowLine={nowLine?.dayKey === key ? nowLine.top : null}
              onSlotClick={onSlotClick}
              onEventClick={onEventClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  dayKeyStr,
  hours,
  events,
  canDrag,
  showNowLine,
  onSlotClick,
  onEventClick,
}: {
  day: Date;
  dayKeyStr: string;
  hours: number[];
  events: ScheduleEvent[];
  canDrag: boolean;
  showNowLine: number | null;
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: ScheduleEvent) => void;
}) {
  return (
    <div
      className="relative border-l border-[var(--border)]"
      style={{ height: gridHeightPx() }}
    >
      {hours.map((h) => (
        <HourSlot
          key={h}
          day={day}
          dayKeyStr={dayKeyStr}
          hour={h}
          canDrop={canDrag}
          onClick={() => onSlotClick(day, h)}
        />
      ))}
      {showNowLine != null ? (
        <div
          className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-red-500"
          style={{ top: showNowLine }}
        />
      ) : null}
      {events.map((event) => (
        <ScheduleEventBlock
          key={event.id}
          event={event}
          style={eventBlockStyle(event.scheduledStartAt, event.scheduledEndAt)}
          canDrag={canDrag}
          onClick={() => onEventClick(event)}
        />
      ))}
    </div>
  );
}

function HourSlot({
  day,
  dayKeyStr,
  hour,
  canDrop,
  onClick,
}: {
  day: Date;
  dayKeyStr: string;
  hour: number;
  canDrop: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${dayKeyStr}:${hour}`,
    data: {
      type: 'slot',
      dayKey: dayKeyStr,
      day,
      hour,
    } satisfies SlotDropData,
    disabled: !canDrop,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onClick}
      className={`absolute left-0 right-0 w-full border-t border-[var(--border)]/60 ${
        isOver ? 'bg-[var(--primary-soft)]' : 'hover:bg-[var(--surface2)]/80'
      }`}
      style={{
        top: (hour - GRID_HOUR_START) * HOUR_HEIGHT_PX,
        height: HOUR_HEIGHT_PX,
      }}
      aria-label={`Schedule ${dayKeyStr} at ${formatHour(hour)}`}
    />
  );
}

function StaffChipDrop({
  id,
  user,
  enabled,
}: {
  id: string;
  user: PortalDirectoryUser;
  enabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'staff', fieldUserId: user.fieldUserId } satisfies StaffDropData,
    disabled: !enabled,
  });

  return (
    <span
      ref={setNodeRef}
      title={user.label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-extrabold ${
        isOver
          ? 'bg-[var(--primary)] text-[var(--primary-fg)] ring-2 ring-[var(--primary)]'
          : 'bg-[var(--surface2)] text-[var(--text-sub)]'
      }`}
    >
      {initials(user.label)}
    </span>
  );
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

function nowLineOffset(days: Date[]): { dayKey: string; top: number } | null {
  const now = new Date();
  const key = dayKey(now);
  if (!days.some((d) => dayKey(d) === key)) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startMin = GRID_HOUR_START * 60;
  const endMin = GRID_HOUR_END * 60;
  if (minutes < startMin || minutes > endMin) return null;
  const top = ((minutes - startMin) / 60) * HOUR_HEIGHT_PX;
  return { dayKey: key, top };
}
