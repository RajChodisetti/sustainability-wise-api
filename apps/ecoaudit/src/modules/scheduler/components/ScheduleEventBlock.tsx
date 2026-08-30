'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  appBarClass,
  appChipClass,
  appEventSurfaceClass,
  SOURCE_APP_LABEL,
} from '@/modules/scheduler/lib/colors';
import { formatEstimatedDuration } from '@/modules/scheduler/lib/estimatedDuration';
import { calendarEventVisualState } from '@/modules/scheduler/lib/weekGrid';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export type EventDragData = {
  type: 'event';
  event: ScheduleEvent;
};

const DETAILS_HOVER_DELAY_MS = 1_200;

export function ScheduleEventBlock({
  event,
  style,
  canDrag,
  onClick,
}: {
  event: ScheduleEvent;
  style: CSSProperties;
  canDrag: boolean;
  onClick: () => void;
}) {
  const visualState = calendarEventVisualState(event.status, event.scheduledStartAt);
  const completed = visualState === 'completed';
  const overdue = visualState === 'overdue';
  const draggable = canDrag && !completed;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event:${event.id}`,
    data: { type: 'event', event } satisfies EventDragData,
    disabled: !draggable,
  });

  const dragStyle = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;
  const showDetails = detailsExpanded && !isDragging;

  function clearDetailsTimer() {
    if (detailsTimerRef.current !== null) {
      clearTimeout(detailsTimerRef.current);
      detailsTimerRef.current = null;
    }
  }

  function startDetailsTimer() {
    clearDetailsTimer();
    if (isDragging) return;
    detailsTimerRef.current = setTimeout(() => {
      setDetailsExpanded(true);
      detailsTimerRef.current = null;
    }, DETAILS_HOVER_DELAY_MS);
  }

  function collapseDetails() {
    clearDetailsTimer();
    setDetailsExpanded(false);
  }

  useEffect(() => {
    return () => {
      if (detailsTimerRef.current !== null) clearTimeout(detailsTimerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{
        ...style,
        ...dragStyle,
      }}
      className={`absolute rounded-[var(--radius-sm)] border text-left shadow-[var(--shadow-xs)] transition-[border-color,background-color,box-shadow] hover:shadow-[var(--shadow-sm)] ${appEventSurfaceClass(event.sourceApp)} ${
        showDetails ? 'z-40 overflow-visible' : 'z-10 overflow-hidden'
      } ${completed ? 'ring-1 ring-emerald-600/35' : overdue ? 'ring-1 ring-amber-500/45' : ''} ${
        isDragging ? 'opacity-60 ring-2 ring-[var(--primary)]' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      aria-label={`${event.title}, ${eventTimeLabel(event.scheduledStartAt)}${event.assigneeDisplayName ? `, assigned to ${event.assigneeDisplayName}` : ''}${completed ? ', completed' : overdue ? ', scheduled day passed and not complete' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={startDetailsTimer}
      onMouseLeave={collapseDetails}
      onFocus={startDetailsTimer}
      onBlur={collapseDetails}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${appBarClass(event.sourceApp)}`} />
      <div className="h-full space-y-0.5 overflow-hidden py-1 pl-2.5 pr-7">
        <p className="truncate text-[11px] font-extrabold leading-tight text-[var(--text)]">
          {event.title}
        </p>
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-[9px] font-bold text-[var(--text-sub)]">
            {eventTimeLabel(event.scheduledStartAt)}
          </span>
          <span
            className={`min-w-0 truncate rounded-full px-1.5 py-0.5 text-[8px] font-extrabold ${appChipClass(event.sourceApp)}`}
          >
            {SOURCE_APP_LABEL[event.sourceApp]}
          </span>
        </div>
        {event.assigneeDisplayName ? (
          <p className="truncate text-[9px] font-semibold text-[var(--text-sub)]">
            {event.assigneeDisplayName}
          </p>
        ) : null}
      </div>
      {completed ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"
          title="Completed"
        >
          <Icon name="check" size={13} />
        </span>
      ) : overdue ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black text-amber-950 shadow-sm"
          title="Scheduled day passed; not complete"
        >
          !
        </span>
      ) : null}
      <div
        aria-hidden={!showDetails}
        className={`pointer-events-none absolute left-0 top-0 z-50 w-[min(18rem,calc(100vw-2rem))] origin-top-left rounded-[var(--radius-md)] border p-3.5 shadow-[var(--shadow-md)] transition-[opacity,transform] duration-500 ease-out ${appEventSurfaceClass(event.sourceApp)} ${
          showDetails ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-current/10 pb-2.5">
          <div className="min-w-0">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-sub)]">
              {SOURCE_APP_LABEL[event.sourceApp]}
            </p>
            <p className="mt-1 break-words text-sm font-extrabold leading-5 text-[var(--text)]">
              {event.title}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-extrabold ${appChipClass(event.sourceApp)}`}>
            {eventTimeLabel(event.scheduledStartAt)}
          </span>
        </div>
        <dl className="mt-2.5 grid gap-2 text-xs">
          <EventDetail label="Assigned to" value={event.assigneeDisplayName?.trim() || 'Unassigned'} />
          <EventDetail label="Estimated time" value={formatEstimatedDuration(event.estimatedDurationMinutes)} />
        </dl>
      </div>
    </button>
  );
}

function EventDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2">
      <dt className="font-bold text-[var(--text-sub)]">{label}</dt>
      <dd className="break-words font-extrabold text-[var(--text)]">{value}</dd>
    </div>
  );
}

function eventTimeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
