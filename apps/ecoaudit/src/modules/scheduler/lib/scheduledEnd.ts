import { fromDatetimeLocalValue, toDatetimeLocalValue } from './deadline';

export function scheduledEndLocalParts(value: string | null): {
  date: string;
  time: string;
} {
  if (!value) return { date: '', time: '' };
  const local = toDatetimeLocalValue(value);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function scheduledEndAtFromLocal(
  startLocal: string,
  endDate: string,
  endTime: string,
): string | null {
  if (!endTime) return null;
  const effectiveDate = endDate || startLocal.slice(0, 10);
  const localValue = `${effectiveDate}T${endTime}`;
  return Number.isFinite(new Date(localValue).getTime())
    ? fromDatetimeLocalValue(localValue)
    : null;
}

export function scheduledEndError(
  startLocal: string,
  endDate: string,
  endTime: string,
): string | null {
  if (!endTime) return null;
  if (!Number.isFinite(new Date(startLocal).getTime())) {
    return 'Select a valid start date and time.';
  }
  const end = scheduledEndAtFromLocal(startLocal, endDate, endTime);
  if (!end) return 'Select a valid end date and time.';
  if (new Date(end).getTime() <= new Date(startLocal).getTime()) {
    return 'End time must be after the start time.';
  }
  return null;
}

export function scheduledEndUpdate(
  current: string | null,
  next: string | null,
): { scheduledEndAt?: string | null } {
  return current === next ? {} : { scheduledEndAt: next };
}
