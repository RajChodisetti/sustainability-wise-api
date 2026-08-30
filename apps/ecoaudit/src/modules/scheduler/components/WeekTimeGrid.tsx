'use client';

import { useDroppable } from '@dnd-kit/core';
import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ScheduleEventBlock } from '@/modules/scheduler/components/ScheduleEventBlock';
import {
  dayKey,
  eventBlockStyle,
  eventLaneLayout,
  GRID_HOUR_START,
  GRID_HOUR_END,
  gridHeightPx,
  HOUR_HEIGHT_PX,
  hoursInGrid,
} from '@/modules/scheduler/lib/weekGrid';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export type SlotDropData = {
  type: 'slot';
  dayKey: string;
  day: Date;
  hour: number;
};

export function WeekTimeGrid({
  days,
  events,
  canDrag,
  onSlotClick,
  onEventClick,
  className = '',
}: {
  days: Date[];
  events: ScheduleEvent[];
  canDrag: boolean;
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: ScheduleEvent) => void;
  className?: string;
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
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const dayKeys = useMemo(() => days.map(dayKey), [days]);
  const defaultSlotKey = useMemo(() => {
    const todayIndex = days.findIndex((day) => dayKey(day) === dayKey(new Date()));
    const dayIndex = todayIndex >= 0 ? todayIndex : 0;
    const currentHour = new Date().getHours();
    const hour = Math.min(Math.max(currentHour, GRID_HOUR_START), GRID_HOUR_END - 1);
    return slotFocusKey(dayKeys[dayIndex] ?? '', hour);
  }, [dayKeys, days]);
  const activeSlotKey = focusedSlot && dayKeys.some((key) => focusedSlot.startsWith(`${key}:`))
    ? focusedSlot
    : defaultSlotKey;
  const gridTemplateColumns = `3.75rem ${days.map(() => 'minmax(7rem, 1fr)').join(' ')}`;

  function moveSlotFocus(event: KeyboardEvent<HTMLButtonElement>, dayIndex: number, hour: number) {
    let nextDay = dayIndex;
    let nextHour = hour;
    if (event.key === 'ArrowLeft') nextDay = Math.max(0, dayIndex - 1);
    else if (event.key === 'ArrowRight') nextDay = Math.min(days.length - 1, dayIndex + 1);
    else if (event.key === 'ArrowUp') nextHour = Math.max(GRID_HOUR_START, hour - 1);
    else if (event.key === 'ArrowDown') nextHour = Math.min(GRID_HOUR_END - 1, hour + 1);
    else if (event.key === 'Home') nextHour = GRID_HOUR_START;
    else if (event.key === 'End') nextHour = GRID_HOUR_END - 1;
    else return;

    event.preventDefault();
    const nextKey = slotFocusKey(dayKeys[nextDay] ?? '', nextHour);
    setFocusedSlot(nextKey);
    requestAnimationFrame(() => {
      document.getElementById(slotElementId(nextKey))?.focus();
    });
  }

  return (
    <div className={`min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] ${className}`}>
      <p id="scheduler-calendar-keyboard-hint" className="sr-only">
        Use the arrow keys to move between time slots, then press Enter to schedule a job.
      </p>
      <div className="subtle-scrollbar overflow-auto" role="region" aria-label="Weekly calendar grid" tabIndex={0}>
        <div
          className="grid min-w-[800px] transition-[grid-template-columns] duration-200 ease-out"
          style={{ gridTemplateColumns }}
        >
          {/* Header */}
          <div className="sticky left-0 top-0 z-30 border-b border-r border-[var(--border)] bg-[var(--surface)]" />
          {days.map((day) => {
            const key = dayKey(day);
            const isToday = key === dayKey(new Date());
            return (
              <div
                key={key}
                className={`sticky top-0 z-20 border-b border-l border-[var(--border)] px-1 py-2 text-center transition-colors ${
                  isToday ? 'bg-[var(--primary-soft)]' : 'bg-[var(--surface)]'
                }`}
              >
                <p className={`text-[10px] font-extrabold uppercase tracking-[0.08em] ${isToday ? 'text-[var(--primary)]' : 'text-[var(--text-sub)]'}`}>
                  {day.toLocaleDateString('en-AU', { weekday: 'short' })}
                </p>
                <p className="mt-0.5 text-base font-extrabold text-[var(--text)]">{day.getDate()}</p>
              </div>
            );
          })}

          {/* Time gutter + day columns */}
          <div className="sticky left-0 z-10 border-r border-[var(--border)] bg-[var(--surface)]" style={{ height: gridHeightPx() }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] font-bold text-[var(--muted)]"
                style={{ top: (h - GRID_HOUR_START) * HOUR_HEIGHT_PX }}
              >
                {formatHour(h)}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const key = dayKey(day);
            const dayEvents = byDay.get(key) ?? [];
            return (
              <DayColumn
                key={key}
                day={day}
                dayIndex={dayIndex}
                dayKeyStr={key}
                hours={hours}
                events={dayEvents}
                canDrag={canDrag}
                activeSlotKey={activeSlotKey}
                showNowLine={nowLine?.dayKey === key ? nowLine.top : null}
                onSlotClick={onSlotClick}
                onSlotFocus={setFocusedSlot}
                onSlotKeyDown={moveSlotFocus}
                onEventClick={onEventClick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  dayIndex,
  dayKeyStr,
  hours,
  events,
  canDrag,
  activeSlotKey,
  showNowLine,
  onSlotClick,
  onSlotFocus,
  onSlotKeyDown,
  onEventClick,
}: {
  day: Date;
  dayIndex: number;
  dayKeyStr: string;
  hours: number[];
  events: ScheduleEvent[];
  canDrag: boolean;
  activeSlotKey: string;
  showNowLine: number | null;
  onSlotClick: (day: Date, hour: number) => void;
  onSlotFocus: (key: string) => void;
  onSlotKeyDown: (event: KeyboardEvent<HTMLButtonElement>, dayIndex: number, hour: number) => void;
  onEventClick: (event: ScheduleEvent) => void;
}) {
  const laneLayout = eventLaneLayout(events);
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
          isTabStop={slotFocusKey(dayKeyStr, h) === activeSlotKey}
          onClick={() => onSlotClick(day, h)}
          onFocus={() => onSlotFocus(slotFocusKey(dayKeyStr, h))}
          onKeyDown={(event) => onSlotKeyDown(event, dayIndex, h)}
        />
      ))}
      {showNowLine != null ? (
        <div
          className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-red-500"
          style={{ top: showNowLine }}
        />
      ) : null}
      {events.map((event) => {
        const lane = laneLayout.get(event.id) ?? { leftPercent: 0, widthPercent: 100 };
        return (
          <ScheduleEventBlock
            key={event.id}
            event={event}
            style={{
              ...eventBlockStyle(
                event.scheduledStartAt,
                event.estimatedDurationMinutes,
                event.scheduledEndAt,
              ),
              left: `calc(${lane.leftPercent}% + 0.25rem)`,
              width: `calc(${lane.widthPercent}% - 0.5rem)`,
            }}
            canDrag={canDrag}
            onClick={() => onEventClick(event)}
          />
        );
      })}
    </div>
  );
}

function HourSlot({
  day,
  dayKeyStr,
  hour,
  canDrop,
  isTabStop,
  onClick,
  onFocus,
  onKeyDown,
}: {
  day: Date;
  dayKeyStr: string;
  hour: number;
  canDrop: boolean;
  isTabStop: boolean;
  onClick: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
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

  const key = slotFocusKey(dayKeyStr, hour);
  const sharedClassName = `absolute left-0 right-0 w-full border-t border-[var(--border)]/60 ${
    isOver ? 'bg-[var(--primary-soft)]' : canDrop ? 'hover:bg-[var(--surface2)]/80' : ''
  }`;
  const style: CSSProperties = {
    top: (hour - GRID_HOUR_START) * HOUR_HEIGHT_PX,
    height: HOUR_HEIGHT_PX,
  };

  if (!canDrop) {
    return <div ref={setNodeRef} className={sharedClassName} style={style} aria-hidden="true" />;
  }

  return (
    <button
      id={isTabStop ? slotElementId(key) : undefined}
      type="button"
      ref={setNodeRef}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      tabIndex={isTabStop ? 0 : -1}
      className={sharedClassName}
      style={style}
      aria-label={`Schedule ${dayKeyStr} at ${formatHour(hour)}`}
      aria-describedby="scheduler-calendar-keyboard-hint"
    />
  );
}

function slotFocusKey(dayKeyStr: string, hour: number): string {
  return `${dayKeyStr}:${hour}`;
}

function slotElementId(key: string): string {
  return `scheduler-slot-${key.replaceAll(':', '-')}`;
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
