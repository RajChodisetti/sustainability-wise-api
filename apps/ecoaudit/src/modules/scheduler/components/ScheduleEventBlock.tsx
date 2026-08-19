'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';
import { appBarClass, appChipClass, SOURCE_APP_LABEL } from '@/modules/scheduler/lib/colors';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export type EventDragData = {
  type: 'event';
  event: ScheduleEvent;
};

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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event:${event.id}`,
    data: { type: 'event', event } satisfies EventDragData,
    disabled: !canDrag,
  });

  const dragStyle = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{
        ...style,
        ...dragStyle,
      }}
      className={`absolute z-10 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-left shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--primary)] hover:shadow-[var(--shadow-sm)] ${
        isDragging ? 'opacity-60 ring-2 ring-[var(--primary)]' : ''
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      aria-label={`${event.title}, ${eventTimeLabel(event.scheduledStartAt)}${event.assigneeDisplayName ? `, assigned to ${event.assigneeDisplayName}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${appBarClass(event.sourceApp)}`} />
      <div className="space-y-0.5 py-1 pl-2.5 pr-1.5">
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
    </button>
  );
}

function eventTimeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
