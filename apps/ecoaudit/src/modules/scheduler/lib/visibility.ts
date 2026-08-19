import type {
  FinanceSourceApp,
  ScheduleSourceApp,
} from '@/modules/scheduler/types/domain';

const ALL_SOURCE_APPS = ['ecoaudit', 'solarsense', 'installhub', 'custom'] as const;
const SELECTABLE_SOURCE_APPS = ['installhub', 'custom'] as const;

/**
 * Sources whose already-linked work can be rendered in Scheduler.
 *
 * EcoAudit and SolarSense remain displayable so historical and existing work
 * does not disappear from calendar, deadline, and finance views.
 */
export function schedulerVisibleSourceApps(): ScheduleSourceApp[] {
  return [...ALL_SOURCE_APPS];
}

/** Sources that can appear as explicit choices in Scheduler controls. */
export function schedulerSelectableSourceApps(): ScheduleSourceApp[] {
  return [...SELECTABLE_SOURCE_APPS];
}

export function schedulerVisibleFinanceSourceApps(
  sourceApps: readonly ScheduleSourceApp[],
): FinanceSourceApp[] {
  return sourceApps.filter(
    (app): app is FinanceSourceApp => app !== 'custom',
  );
}

export function schedulerSourceAppIsVisible(
  sourceApps: readonly ScheduleSourceApp[],
  sourceApp: ScheduleSourceApp,
): boolean {
  return sourceApps.includes(sourceApp);
}

export function schedulerSourceAppIsSelectable(
  sourceApps: readonly ScheduleSourceApp[],
  sourceApp: ScheduleSourceApp,
): boolean {
  return sourceApps.includes(sourceApp);
}

export function schedulerDefaultSourceApp(
  sourceApps: readonly ScheduleSourceApp[],
): ScheduleSourceApp {
  if (sourceApps.includes('installhub')) return 'installhub';
  if (sourceApps.includes('custom')) return 'custom';
  return sourceApps[0] ?? 'custom';
}

export function schedulerIsFieldOnly(
  sourceApps: readonly ScheduleSourceApp[],
): boolean {
  const financeApps = schedulerVisibleFinanceSourceApps(sourceApps);
  return financeApps.length === 1 && financeApps[0] === 'installhub';
}
