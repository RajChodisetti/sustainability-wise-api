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

/** An opaque calendar-block surface with source identity carried by its border. */
export function appEventSurfaceClass(app: ScheduleSourceApp): string {
  switch (app) {
    case 'ecoaudit':
      return 'border-sky-300 bg-[var(--surface)] hover:border-sky-500 hover:bg-sky-50 dark:border-sky-700 dark:hover:bg-sky-950/40';
    case 'solarsense':
      return 'border-amber-300 bg-[var(--surface)] hover:border-amber-500 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-950/40';
    case 'installhub':
      return 'border-teal-300 bg-[var(--surface)] hover:border-teal-500 hover:bg-teal-50 dark:border-teal-700 dark:hover:bg-teal-950/40';
    case 'custom':
    default:
      return 'border-violet-300 bg-[var(--surface)] hover:border-violet-500 hover:bg-violet-50 dark:border-violet-700 dark:hover:bg-violet-950/40';
  }
}
