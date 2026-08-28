import type {
  FinanceSourceApp,
  ScheduleEvent,
  ScheduleSourceApp,
} from '@/modules/scheduler/types/domain';

const VISIBLE_SOURCE_APPS = ['installhub', 'custom'] as const;
const SELECTABLE_SOURCE_APPS = ['installhub', 'custom'] as const;

/**
 * Sources that can be rendered in Scheduler. EcoAudit and SolarSense records
 * remain in their product flows and are intentionally absent from Scheduler.
 */
export function schedulerVisibleSourceApps(): ScheduleSourceApp[] {
  return [...VISIBLE_SOURCE_APPS];
}

/**
 * Sources that can appear as explicit choices in Scheduler controls.
 */
export function schedulerSelectableSourceApps(): ScheduleSourceApp[] {
  return [...SELECTABLE_SOURCE_APPS];
}

/**
 * Creating EcoAudit or SolarSense product rows requires an active identity in
 * that product. Field App and custom rows use the shared Field identity.
 */
export function schedulerCreatableSourceApps(
  sourceApps: readonly ScheduleSourceApp[],
  activeProductApps: readonly ScheduleSourceApp[],
): ScheduleSourceApp[] {
  return sourceApps.filter((app) => (
    app === 'custom'
    || app === 'installhub'
    || activeProductApps.includes(app)
  ));
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

/** Product-backed jobs that can receive Scheduler push notifications. */
export function schedulerEventSupportsMobileNotifications(
  event: Pick<ScheduleEvent, 'sourceApp' | 'sourceType' | 'sourceId'>,
): boolean {
  if (typeof event.sourceId !== 'string' || !event.sourceId.trim()) return false;
  return event.sourceApp === 'installhub' && event.sourceType === 'installation';
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
