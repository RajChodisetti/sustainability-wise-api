import type { FleetStatus } from '@/modules/fleet/types/domain';
import { humanize, statusLabel } from '@/modules/fleet/lib/format';

const statusTone: Record<FleetStatus, string> = {
  communicating: 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  delayed: 'border-amber-600/25 bg-amber-500/12 text-amber-700 dark:text-amber-300',
  offline: 'border-red-600/25 bg-red-500/10 text-red-700 dark:text-red-300',
  inactive: 'border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  unknown: 'border-violet-600/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

const dotTone: Record<FleetStatus, string> = {
  communicating: 'bg-emerald-500',
  delayed: 'bg-amber-500',
  offline: 'bg-red-500',
  inactive: 'bg-slate-500',
  unknown: 'bg-violet-500',
};

export function FleetStatusBadge({ status }: { status: FleetStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone[status]}`}
    >
      <span className={`h-2 w-2 rounded-full ${dotTone[status]}`} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

export function ProcessStatusBadge({ status }: { status?: string | null }) {
  const normalized = status?.toLowerCase() ?? 'unknown';
  const success = ['published', 'complete', 'completed', 'sent', 'success', 'successful'].includes(normalized);
  const warning = ['running', 'collecting', 'pending', 'partial', 'queued', 'processing'].includes(normalized);
  const failed = ['failed', 'failure', 'error', 'cancelled'].includes(normalized);
  const tone = success
    ? 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : warning
      ? 'border-amber-600/25 bg-amber-500/12 text-amber-700 dark:text-amber-300'
      : failed
        ? 'border-red-600/25 bg-red-500/10 text-red-700 dark:text-red-300'
        : 'border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300';
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>
      {humanize(status ?? 'Unknown')}
    </span>
  );
}

export const fleetStatusColor: Record<FleetStatus, string> = {
  communicating: 'bg-emerald-500',
  delayed: 'bg-amber-500',
  offline: 'bg-red-500',
  inactive: 'bg-slate-500',
  unknown: 'bg-violet-500',
};
