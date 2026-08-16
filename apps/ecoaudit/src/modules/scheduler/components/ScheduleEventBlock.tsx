'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
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
  style: { top: number; height: number };
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
        top: style.top,
        height: style.height,
        ...dragStyle,
      }}
      className={`absolute left-1 right-1 z-10 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] text-left shadow-sm ${
        isDragging ? 'opacity-60 ring-2 ring-[var(--primary)]' : ''
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
    >
      <div className={`h-1 w-full ${appBarClass(event.sourceApp)}`} />
      <div className="space-y-0.5 px-1.5 py-1">
        <p className="truncate text-[11px] font-extrabold leading-tight text-[var(--text)]">
          {event.title}
        </p>
        <span
          className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-extrabold ${appChipClass(event.sourceApp)}`}
        >
          {SOURCE_APP_LABEL[event.sourceApp]}
        </span>
        {event.assigneeDisplayName ? (
          <p className="truncate text-[9px] font-semibold text-[var(--text-sub)]">
            {event.assigneeDisplayName}
          </p>
        ) : null}
      </div>
    </button>
  );
}
