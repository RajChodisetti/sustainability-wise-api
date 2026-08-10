/** Remaining duration label; overdue first UX uses negative remaining. */
export function deadlineRemainingLabel(deadlineAt: string, now = new Date()): {
  label: string;
  overdue: boolean;
  remainingMs: number;
} {
  const remainingMs = new Date(deadlineAt).getTime() - now.getTime();
  const overdue = remainingMs < 0;
  const abs = Math.abs(remainingMs);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let unit: string;
  if (days >= 1) unit = `${days}d ${hours % 24}h`;
  else if (hours >= 1) unit = `${hours}h ${minutes % 60}m`;
  else unit = `${Math.max(1, minutes)}m`;

  return {
    remainingMs,
    overdue,
    label: overdue ? `Overdue by ${unit}` : `${unit} left`,
  };
}

export function sortEventsByDeadlineUrgency<T extends { deadlineAt: string; status: string }>(
  events: T[],
  now = new Date(),
): T[] {
  const nowMs = now.getTime();
  return [...events].sort((a, b) => {
    const aDone = a.status === 'done' || a.status === 'cancelled' ? 1 : 0;
    const bDone = b.status === 'done' || b.status === 'cancelled' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (new Date(a.deadlineAt).getTime() - nowMs) - (new Date(b.deadlineAt).getTime() - nowMs);
  });
}

export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
