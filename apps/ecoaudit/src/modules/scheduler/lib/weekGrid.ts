/** Week time-grid layout helpers (local timezone). */

export const GRID_HOUR_START = 5;
export const GRID_HOUR_END = 21; // exclusive end display through 20:00–21:00
export const HOUR_HEIGHT_PX = 56;

export type TimedGridItem = {
  id: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
};

export type EventLaneLayout = {
  leftPercent: number;
  widthPercent: number;
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

export function hoursInGrid(): number[] {
  const out: number[] = [];
  for (let h = GRID_HOUR_START; h < GRID_HOUR_END; h += 1) out.push(h);
  return out;
}

export function gridHeightPx(): number {
  return (GRID_HOUR_END - GRID_HOUR_START) * HOUR_HEIGHT_PX;
}

/** Position an event within the day column; clamps to visible window. */
export function eventBlockStyle(startIso: string, endIso: string | null): {
  top: number;
  height: number;
} {
  const start = new Date(startIso);
  const end = endIso
    ? new Date(endIso)
    : new Date(start.getTime() + 60 * 60 * 1000);

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
      const proposedEnd = event.scheduledEndAt
        ? new Date(event.scheduledEndAt).getTime()
        : start + 60 * 60 * 1000;
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

export function slotDateTime(day: Date, hour: number, minute = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

export function defaultEndFromStart(start: Date): Date {
  return new Date(start.getTime() + 60 * 60 * 1000);
}

export function defaultDeadlineFromStart(start: Date): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + 2);
  d.setHours(17, 0, 0, 0);
  return d;
}

export function durationMs(startIso: string, endIso: string | null): number {
  const start = new Date(startIso).getTime();
  if (!endIso) return 60 * 60 * 1000;
  return Math.max(new Date(endIso).getTime() - start, 15 * 60 * 1000);
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}
