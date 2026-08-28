import { notFound } from '../utils/errors.js';

export type SchedulerPolicySourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type SchedulerPolicyFinanceSourceApp = Exclude<SchedulerPolicySourceApp, 'custom'>;

const VISIBLE_SOURCE_APPS = ['installhub', 'custom'] as const;

/**
 * Product rows remain stored even when they are outside Scheduler. Public
 * Scheduler reads and mutations expose Field App jobs and custom planning work
 * only; EcoAudit and SolarSense continue to use their product-specific flows.
 */
export function schedulerVisibleSourceApps(): SchedulerPolicySourceApp[] {
  return [...VISIBLE_SOURCE_APPS];
}

export function schedulerVisibleFinanceSourceApps(): SchedulerPolicyFinanceSourceApp[] {
  return schedulerVisibleSourceApps().filter(
    (app): app is SchedulerPolicyFinanceSourceApp => app !== 'custom',
  );
}

export function isSchedulerSourceAppVisible(
  sourceApp: string,
): sourceApp is SchedulerPolicySourceApp {
  return schedulerVisibleSourceApps().includes(
    sourceApp as SchedulerPolicySourceApp,
  );
}

export function areSchedulerSourceAppsVisible(
  sourceApps: readonly string[],
): boolean {
  return sourceApps.every((sourceApp) => (
    isSchedulerSourceAppVisible(sourceApp)
  ));
}

/** Return 404 for sources that are outside the public Scheduler policy. */
export function assertSchedulerSourceAppVisible(
  sourceApp: string,
): void {
  if (!isSchedulerSourceAppVisible(sourceApp)) {
    throw notFound('Scheduler job');
  }
}
