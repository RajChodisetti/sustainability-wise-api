'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import {
  appBarClass,
  appEventSurfaceClass,
  SOURCE_APP_LABEL,
} from '@/modules/scheduler/lib/colors';
import { formatEstimatedDuration } from '@/modules/scheduler/lib/estimatedDuration';
import {
  calendarEventContentDensity,
  calendarEventLaneDensity,
  calendarEventVisualState,
  calendarPreviewPosition,
} from '@/modules/scheduler/lib/weekGrid';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

export type EventDragData = {
  type: 'event';
  event: ScheduleEvent;
};

const DETAILS_HOVER_DELAY_MS = 600;
const DETAILS_COLLAPSE_DELAY_MS = 120;
const DETAILS_PREVIEW_WIDTH_PX = 304;
const DETAILS_PREVIEW_ESTIMATED_HEIGHT_PX = 210;

export function ScheduleEventBlock({
  event,
  style,
  canDrag,
  laneWidthPercent,
  detailsAlign,
  onClick,
}: {
  event: ScheduleEvent;
  style: CSSProperties;
  canDrag: boolean;
  laneWidthPercent: number;
  detailsAlign: 'left' | 'right';
  onClick: () => void;
}) {
  const visualState = calendarEventVisualState(event.status, event.scheduledStartAt);
  const completed = visualState === 'completed';
  const overdue = visualState === 'overdue';
  const statusLabel = completed
    ? 'Completed'
    : overdue
      ? 'Needs attention'
      : event.status === 'in_progress'
        ? 'In progress'
        : 'Scheduled';
  const draggable = canDrag && !completed;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsPosition, setDetailsPosition] = useState<ReturnType<typeof calendarPreviewPosition> | null>(null);
  const detailsId = useId();
  const detailsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `event:${event.id}`,
    data: { type: 'event', event } satisfies EventDragData,
    disabled: !draggable,
  });
  const { 'aria-describedby': dragDescriptionId, ...dragAttributes } = attributes;

  const dragStyle = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;
  const showDetails = detailsExpanded && !isDragging;
  const renderedHeight = typeof style.height === 'number' ? style.height : 56;
  const contentDensity = calendarEventContentDensity(renderedHeight);
  const laneDensity = calendarEventLaneDensity(laneWidthPercent);
  const laneIsNarrow = laneDensity !== 'full';
  const laneIsTight = laneDensity === 'tight';
  const showMeta = contentDensity !== 'title' && laneDensity === 'full';
  const showAssignee = contentDensity === 'full' && laneDensity === 'full';
  const estimatedDurationLabel = formatEstimatedDuration(event.estimatedDurationMinutes);
  const describedBy = [draggable ? dragDescriptionId : undefined, showDetails ? detailsId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;

  const setTriggerNode = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);

  const positionDetailsPreview = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;
    const triggerBounds = trigger.getBoundingClientRect();
    const previewBounds = previewRef.current?.getBoundingClientRect();
    const previewWidth = previewBounds?.width
      ?? Math.min(DETAILS_PREVIEW_WIDTH_PX, Math.max(0, window.innerWidth - 24));
    const previewHeight = previewBounds?.height ?? DETAILS_PREVIEW_ESTIMATED_HEIGHT_PX;
    const nextPosition = calendarPreviewPosition({
      triggerLeft: triggerBounds.left,
      triggerRight: triggerBounds.right,
      triggerTop: triggerBounds.top,
      triggerBottom: triggerBounds.bottom,
      previewWidth,
      previewHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredAlign: detailsAlign,
    });
    setDetailsPosition((current) => (
      current
      && current.left === nextPosition.left
      && current.top === nextPosition.top
      && current.maxHeight === nextPosition.maxHeight
      && current.placement === nextPosition.placement
        ? current
        : nextPosition
    ));
  }, [detailsAlign]);

  function clearDetailsTimer() {
    if (detailsTimerRef.current !== null) {
      clearTimeout(detailsTimerRef.current);
      detailsTimerRef.current = null;
    }
  }

  function clearCollapseTimer() {
    if (collapseTimerRef.current !== null) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }

  function startDetailsTimer() {
    clearDetailsTimer();
    clearCollapseTimer();
    if (isDragging) return;
    detailsTimerRef.current = setTimeout(() => {
      positionDetailsPreview();
      setDetailsExpanded(true);
      detailsTimerRef.current = null;
    }, DETAILS_HOVER_DELAY_MS);
  }

  function collapseDetails() {
    clearDetailsTimer();
    clearCollapseTimer();
    setDetailsExpanded(false);
    setDetailsPosition(null);
  }

  function scheduleDetailsCollapse() {
    clearDetailsTimer();
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      setDetailsExpanded(false);
      setDetailsPosition(null);
      collapseTimerRef.current = null;
    }, DETAILS_COLLAPSE_DELAY_MS);
  }

  useLayoutEffect(() => {
    if (!showDetails) return;
    positionDetailsPreview();
    window.addEventListener('resize', positionDetailsPreview);
    window.addEventListener('scroll', positionDetailsPreview, true);
    return () => {
      window.removeEventListener('resize', positionDetailsPreview);
      window.removeEventListener('scroll', positionDetailsPreview, true);
    };
  }, [positionDetailsPreview, showDetails]);

  useEffect(() => {
    if (!showDetails) return;
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (detailsTimerRef.current !== null) {
        clearTimeout(detailsTimerRef.current);
        detailsTimerRef.current = null;
      }
      if (collapseTimerRef.current !== null) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      setDetailsExpanded(false);
      setDetailsPosition(null);
    }
    window.addEventListener('keydown', dismissOnEscape);
    return () => window.removeEventListener('keydown', dismissOnEscape);
  }, [showDetails]);

  useEffect(() => {
    return () => {
      if (detailsTimerRef.current !== null) clearTimeout(detailsTimerRef.current);
      if (collapseTimerRef.current !== null) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  return (
    <>
    <button
      type="button"
      ref={setTriggerNode}
      style={{
        ...style,
        ...dragStyle,
      }}
      className={`absolute rounded-[var(--radius-sm)] border text-left shadow-[var(--shadow-xs)] transition-[border-color,background-color,box-shadow] duration-200 hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 motion-reduce:transition-none ${appEventSurfaceClass(event.sourceApp)} ${
        showDetails ? 'z-20 overflow-hidden' : 'z-10 overflow-hidden'
      } ${completed ? 'ring-1 ring-emerald-600/35' : overdue ? 'ring-1 ring-amber-500/45' : ''} ${
        isDragging ? 'opacity-60 ring-2 ring-[var(--primary)]' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      aria-label={`${event.title}, ${SOURCE_APP_LABEL[event.sourceApp]}, ${eventTimeLabel(event.scheduledStartAt)}${event.assigneeDisplayName ? `, assigned to ${event.assigneeDisplayName}` : ', unassigned'}, estimated time ${estimatedDurationLabel}, ${statusLabel.toLowerCase()}`}
      aria-describedby={describedBy}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={startDetailsTimer}
      onMouseLeave={scheduleDetailsCollapse}
      onFocus={startDetailsTimer}
      onBlur={scheduleDetailsCollapse}
      onPointerDownCapture={collapseDetails}
      {...(draggable ? { ...listeners, ...dragAttributes } : {})}
    >
      <div className={`absolute inset-y-0 left-0 ${laneIsTight ? 'w-1' : 'w-1.5'} ${appBarClass(event.sourceApp)}`} />
      <div className={`h-full space-y-0.5 overflow-hidden ${
        laneIsTight
          ? 'py-1 pl-1.5 pr-2.5'
          : laneIsNarrow
            ? 'py-1.5 pl-2.5 pr-3'
            : 'py-1.5 pl-3 pr-5'
      }`}>
        <p className={`truncate font-extrabold leading-tight text-[var(--text)] ${
          laneIsTight ? 'text-[9px]' : laneIsNarrow ? 'text-[10px]' : 'text-[11px]'
        }`}>
          {event.title}
        </p>
        {showMeta ? <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[9px] font-bold text-[var(--text-sub)]">
            {eventTimeLabel(event.scheduledStartAt)}
          </span>
          <span className="min-w-0 truncate text-[9px] font-bold text-[var(--muted)]">
            {SOURCE_APP_LABEL[event.sourceApp]}
          </span>
        </div> : null}
        {showAssignee && event.assigneeDisplayName ? (
          <p className="truncate text-[9px] font-semibold text-[var(--text-sub)]">
            {event.assigneeDisplayName}
          </p>
        ) : null}
      </div>
      {laneIsNarrow ? (
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 h-1.5 w-1.5 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] ${
            overdue
              ? 'rounded-[1px] bg-amber-500'
              : completed
                ? 'rounded-[1px] bg-emerald-700'
                : 'rounded-full bg-emerald-500'
          }`}
        />
      ) : completed ? (
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
      ) : (
        <span
          aria-hidden="true"
          className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white shadow-[0_0_0_4px_rgba(16,185,129,0.14)] ${
            event.status === 'in_progress' ? 'bg-emerald-400' : 'bg-emerald-500'
          }`}
        />
      )}
    </button>
    {showDetails && detailsPosition && typeof document !== 'undefined'
      ? createPortal(
        <div
          id={detailsId}
          ref={previewRef}
          role="tooltip"
          style={{
            left: detailsPosition.left,
            top: detailsPosition.top,
            maxHeight: detailsPosition.maxHeight,
          }}
          onMouseEnter={clearCollapseTimer}
          onMouseLeave={scheduleDetailsCollapse}
          className={`pointer-events-auto fixed z-[100] max-h-[calc(100vh-1.5rem)] w-[min(19rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[var(--radius-md)] border border-emerald-200 bg-white p-4 text-slate-900 shadow-[0_18px_45px_rgba(15,23,42,0.18),0_0_0_4px_rgba(16,185,129,0.14)] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
            previewOriginClass(detailsPosition.placement)
          }`}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500" />
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 pt-1">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
                <span className={`h-2 w-2 rounded-full ${appBarClass(event.sourceApp)}`} />
                <span>{SOURCE_APP_LABEL[event.sourceApp]}</span>
              </p>
              <p className="mt-1.5 break-words text-sm font-extrabold leading-5 text-slate-900">
                {event.title}
              </p>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-extrabold ${
              overdue
                ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
                : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
            }`}>
              <span className={`h-2 w-2 rounded-full ${overdue ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              {statusLabel}
            </span>
          </div>
          <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-emerald-800">
              {eventTimeLabel(event.scheduledStartAt)}
            </p>
            <dl className="grid gap-2.5 text-xs">
              <EventDetail
                label="Assigned to"
                value={event.assigneeDisplayName?.trim() || 'Unassigned'}
              />
              <EventDetail label="Estimated time" value={estimatedDurationLabel} />
            </dl>
          </div>
        </div>,
        document.body,
      )
      : null}
    </>
  );
}

function EventDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2">
      <dt className="font-bold text-slate-600">{label}</dt>
      <dd className="break-words font-extrabold text-slate-900">{value}</dd>
    </div>
  );
}

function previewOriginClass(
  placement: ReturnType<typeof calendarPreviewPosition>['placement'],
): string {
  if (placement === 'left') return 'origin-right';
  if (placement === 'right') return 'origin-left';
  if (placement === 'top') return 'origin-bottom';
  return 'origin-top';
}

function eventTimeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
