import type { ScheduleSourceApp } from '@/modules/scheduler/types/domain';

export const SOURCE_APP_LABEL: Record<ScheduleSourceApp, string> = {
  ecoaudit: 'Eco Audit',
  solarsense: 'Solar Sense',
  installhub: 'Field App',
  custom: 'Custom',
};

/** Chip colors aligned with EcoSense tokens. */
export function appChipClass(app: ScheduleSourceApp): string {
  switch (app) {
    case 'ecoaudit':
      return 'bg-[var(--primary-soft)] text-[var(--primary)] ring-1 ring-[var(--primary)]/25';
    case 'solarsense':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30';
    case 'installhub':
      return 'bg-teal-500/15 text-teal-800 dark:text-teal-300 ring-1 ring-teal-500/30';
    case 'custom':
    default:
      return 'bg-violet-500/15 text-violet-800 dark:text-violet-300 ring-1 ring-violet-500/30';
  }
}

export function appBarClass(app: ScheduleSourceApp): string {
  switch (app) {
    case 'ecoaudit':
      return 'bg-[var(--primary)]';
    case 'solarsense':
      return 'bg-amber-500';
    case 'installhub':
      return 'bg-teal-500';
    case 'custom':
    default:
      return 'bg-violet-500';
  }
}

/** A stable calendar-block background for each source, independent of job status. */
export function appEventSurfaceClass(app: ScheduleSourceApp): string {
  switch (app) {
    case 'ecoaudit':
      return 'border-sky-500/40 bg-sky-500/15 hover:border-sky-500/65 hover:bg-sky-500/20';
    case 'solarsense':
      return 'border-amber-500/45 bg-amber-500/15 hover:border-amber-500/70 hover:bg-amber-500/20';
    case 'installhub':
      return 'border-teal-500/45 bg-teal-500/15 hover:border-teal-500/70 hover:bg-teal-500/20';
    case 'custom':
    default:
      return 'border-violet-500/40 bg-violet-500/15 hover:border-violet-500/65 hover:bg-violet-500/20';
  }
}
