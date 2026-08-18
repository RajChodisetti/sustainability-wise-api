import type {
  FinanceSourceApp,
  ScheduleSourceApp,
} from '@/modules/scheduler/types/domain';

const ALL_SOURCE_APPS = ['ecoaudit', 'solarsense', 'installhub', 'custom'] as const;
const FIELD_ONLY_SOURCE_APPS = ['installhub', 'custom'] as const;

export function schedulerFlagEnabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value ?? '');
}

export function schedulerVisibleSourceApps(
  hideEcoAuditSolarSenseJobs: boolean,
): ScheduleSourceApp[] {
  return hideEcoAuditSolarSenseJobs
    ? [...FIELD_ONLY_SOURCE_APPS]
    : [...ALL_SOURCE_APPS];
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

export function schedulerDefaultSourceApp(
  sourceApps: readonly ScheduleSourceApp[],
): ScheduleSourceApp {
  if (sourceApps.includes('ecoaudit')) return 'ecoaudit';
  if (sourceApps.includes('installhub')) return 'installhub';
  return sourceApps[0] ?? 'custom';
}

export function schedulerIsFieldOnly(
  sourceApps: readonly ScheduleSourceApp[],
): boolean {
  const financeApps = schedulerVisibleFinanceSourceApps(sourceApps);
  return financeApps.length === 1 && financeApps[0] === 'installhub';
}
