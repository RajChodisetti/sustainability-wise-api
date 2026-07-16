import type { FleetStatus } from '@/modules/fleet/types/domain';

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatNumber(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-AU').format(value)
    : '—';
}

export function formatPercent(value?: number | null, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(digits)}%`
    : '—';
}

export function formatDuration(seconds?: number | null): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 48) return `${hours} hr`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days} days`;
}

export function statusLabel(status: FleetStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function humanize(value?: string | null): string {
  if (!value) return '—';
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isoDateDaysAgo(days: number): string {
  return melbourneIsoDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

export function isoDateToday(): string {
  return melbourneIsoDate(new Date());
}

function melbourneIsoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
