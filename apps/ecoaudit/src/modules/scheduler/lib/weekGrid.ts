/** Week time-grid layout helpers (local timezone). */

export const GRID_HOUR_START = 5;
export const GRID_HOUR_END = 21; // exclusive end display through 20:00–21:00
export const HOUR_HEIGHT_PX = 56;

export type TimedGridItem = {
  id: string;
  scheduledStartAt: string;
  estimatedDurationMinutes: number | null;
  scheduledEndAt: string | null;
};

export type EventLaneLayout = {
  leftPercent: number;
  widthPercent: number;
};

export type CalendarEventVisualState = 'default' | 'completed' | 'overdue';
export type CalendarEventContentDensity = 'title' | 'meta' | 'full';
export type CalendarEventLaneDensity = 'tight' | 'compact' | 'full';
export type CalendarPreviewPosition = {
  left: number;
  top: number;
  maxHeight: number;
  placement: 'left' | 'right' | 'top' | 'bottom';
};

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function weekDays(cursor: Date): Date[] {
  const start = startOfWeekMonday(cursor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function calendarEventVisualState(
  status: 'planned' | 'in_progress' | 'done' | 'cancelled',
  scheduledStartAt: string,
  now = new Date(),
): CalendarEventVisualState {
  if (status === 'done') return 'completed';
  if (status === 'cancelled') return 'default';
  const scheduledDay = new Date(scheduledStartAt);
  if (Number.isNaN(scheduledDay.getTime())) return 'default';
  return dayKey(scheduledDay) < dayKey(now) ? 'overdue' : 'default';
}

/** Keep short and overlapping calendar blocks legible instead of clipping extra rows. */
export function calendarEventContentDensity(heightPx: number): CalendarEventContentDensity {
  if (heightPx < 40) return 'title';
  if (heightPx < 68) return 'meta';
  return 'full';
}

/** Reduce card chrome as overlapping events are assigned progressively narrower lanes. */
export function calendarEventLaneDensity(widthPercent: number): CalendarEventLaneDensity {
  if (widthPercent < 40) return 'tight';
  if (widthPercent < 70) return 'compact';
  return 'full';
}

/** Keep the expanded event preview inside the visible browser viewport. */
export function calendarPreviewPosition({
  triggerLeft,
  triggerRight,
  triggerTop,
  triggerBottom,
  previewWidth,
  previewHeight,
  viewportWidth,
  viewportHeight,
  preferredAlign,
  margin = 12,
  gap = 8,
}: {
  triggerLeft: number;
  triggerRight: number;
  triggerTop: number;
  triggerBottom: number;
  previewWidth: number;
  previewHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredAlign: 'left' | 'right';
  margin?: number;
  gap?: number;
}): CalendarPreviewPosition {
  const fullMaxHeight = Math.max(0, viewportHeight - (margin * 2));
  const renderedHeight = Math.min(previewHeight, fullMaxHeight);
  const maxTop = Math.max(margin, viewportHeight - renderedHeight - margin);
  const sideTop = Math.min(Math.max(triggerTop, margin), maxTop);
  const roomRight = viewportWidth - triggerRight - margin;
  const roomLeft = triggerLeft - margin;
  const rightFits = roomRight >= previewWidth + gap;
  const leftFits = roomLeft >= previewWidth + gap;

  if (preferredAlign === 'left' && rightFits) {
    return {
      left: triggerRight + gap,
      top: sideTop,
      maxHeight: fullMaxHeight,
      placement: 'right',
    };
  }
  if (preferredAlign === 'right' && leftFits) {
    return {
      left: triggerLeft - previewWidth - gap,
      top: sideTop,
      maxHeight: fullMaxHeight,
      placement: 'left',
    };
  }
  if (rightFits) {
    return {
      left: triggerRight + gap,
      top: sideTop,
      maxHeight: fullMaxHeight,
      placement: 'right',
    };
  }
  if (leftFits) {
    return {
      left: triggerLeft - previewWidth - gap,
      top: sideTop,
      maxHeight: fullMaxHeight,
      placement: 'left',
    };
  }

  const maxLeft = Math.max(margin, viewportWidth - previewWidth - margin);
  const preferredLeft = preferredAlign === 'right'
    ? triggerRight - previewWidth
    : triggerLeft;
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
  const roomBelow = Math.max(0, viewportHeight - triggerBottom - gap - margin);
  const roomAbove = Math.max(0, triggerTop - gap - margin);
  if (roomBelow >= roomAbove) {
    return {
      left,
      top: triggerBottom + gap,
      maxHeight: roomBelow,
      placement: 'bottom',
    };
  }
  const aboveHeight = Math.min(previewHeight, roomAbove);
  return {
    left,
    top: Math.max(margin, triggerTop - gap - aboveHeight),
    maxHeight: roomAbove,
    placement: 'top',
  };
}

export function hoursInGrid(): number[] {
  const out: number[] = [];
  for (let h = GRID_HOUR_START; h < GRID_HOUR_END; h += 1) out.push(h);
  return out;
}

export function gridHeightPx(): number {
  return (GRID_HOUR_END - GRID_HOUR_START) * HOUR_HEIGHT_PX;
}

/** Position an event within the day column; clamps to visible window. */
export function eventBlockStyle(
  startIso: string,
  estimatedDurationMinutes: number | null,
  legacyEndIso: string | null,
): {
  top: number;
  height: number;
} {
  const start = new Date(startIso);
  const end = new Date(calendarEventEndMs(
    start.getTime(),
    estimatedDurationMinutes,
    legacyEndIso,
  ));

  const dayStart = new Date(start);
  dayStart.setHours(GRID_HOUR_START, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(GRID_HOUR_END, 0, 0, 0);

  const clampedStart = Math.max(start.getTime(), dayStart.getTime());
  const clampedEnd = Math.min(end.getTime(), dayEnd.getTime());
  const topMs = clampedStart - dayStart.getTime();
  const durMs = Math.max(clampedEnd - clampedStart, 15 * 60 * 1000);
  const pxPerMs = HOUR_HEIGHT_PX / (60 * 60 * 1000);
  return {
    top: topMs * pxPerMs,
    height: Math.max(durMs * pxPerMs, 28),
  };
}

/**
 * Assign overlapping events to side-by-side lanes instead of painting them on
 * top of one another. Transitive overlaps share a stable lane width.
 */
export function eventLaneLayout<T extends TimedGridItem>(events: T[]): Map<string, EventLaneLayout> {
  const normalized = events
    .map((event) => {
      const start = new Date(event.scheduledStartAt).getTime();
      const proposedEnd = calendarEventEndMs(
        start,
        event.estimatedDurationMinutes,
        event.scheduledEndAt,
      );
      return {
        event,
        start,
        end: Math.max(proposedEnd, start + 15 * 60 * 1000),
      };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end || left.event.id.localeCompare(right.event.id));

  const groups: Array<typeof normalized> = [];
  let current: typeof normalized = [];
  let currentEnd = Number.NEGATIVE_INFINITY;

  for (const item of normalized) {
    if (current.length > 0 && item.start >= currentEnd) {
      groups.push(current);
      current = [];
      currentEnd = Number.NEGATIVE_INFINITY;
    }
    current.push(item);
    currentEnd = Math.max(currentEnd, item.end);
  }
  if (current.length > 0) groups.push(current);

  const layout = new Map<string, EventLaneLayout>();
  for (const group of groups) {
    const laneEnds: number[] = [];
    const placements = group.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      return { id: item.event.id, lane };
    });
    const laneCount = Math.max(laneEnds.length, 1);
    for (const placement of placements) {
      layout.set(placement.id, {
        leftPercent: (placement.lane / laneCount) * 100,
        widthPercent: 100 / laneCount,
      });
    }
  }
  return layout;
}

/** Widen busy days so four or more simultaneous jobs remain usable instead of becoming slivers. */
export function calendarDayMinWidthRem<T extends TimedGridItem>(events: T[]): number {
  const layout = eventLaneLayout(events);
  const narrowestLane = Math.min(
    100,
    ...Array.from(layout.values(), ({ widthPercent }) => widthPercent),
  );
  const laneCount = Math.max(1, Math.round(100 / narrowestLane));
  return Math.max(8, laneCount * 3);
}

export function slotDateTime(day: Date, hour: number, minute = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

export function defaultDeadlineFromStart(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 2);
  d.setHours(17, 0, 0, 0);
  return d;
}

function calendarEventEndMs(
  startMs: number,
  estimatedDurationMinutes: number | null,
  legacyEndIso: string | null,
): number {
  if (
    Number.isInteger(estimatedDurationMinutes)
    && estimatedDurationMinutes !== null
    && estimatedDurationMinutes > 0
  ) {
    return startMs + estimatedDurationMinutes * 60 * 1000;
  }

  if (legacyEndIso) {
    const legacyEndMs = new Date(legacyEndIso).getTime();
    if (Number.isFinite(legacyEndMs) && legacyEndMs >= startMs) return legacyEndMs;
  }

  // No estimate means no assumed duration. Layout still applies its existing
  // 15-minute minimum so an unsized job remains visible and selectable.
  return startMs;
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}
