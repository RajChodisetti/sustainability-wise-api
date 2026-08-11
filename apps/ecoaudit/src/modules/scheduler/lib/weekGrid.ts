/** Week time-grid layout helpers (local timezone). */

export const GRID_HOUR_START = 5;
export const GRID_HOUR_END = 21; // exclusive end display through 20:00–21:00
export const HOUR_HEIGHT_PX = 56;

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
