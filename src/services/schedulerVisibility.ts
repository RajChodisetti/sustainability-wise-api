import { notFound } from '../utils/errors.js';

export type SchedulerPolicySourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type SchedulerPolicyFinanceSourceApp = Exclude<SchedulerPolicySourceApp, 'custom'>;

const ALL_SOURCE_APPS = ['ecoaudit', 'solarsense', 'installhub', 'custom'] as const;

/**
 * Backend visibility is intentionally independent from the portal's source
 * selector. Eco Audit and Solar Sense may be hidden as choices for new work in
 * the UI while their existing Scheduler records and direct APIs remain usable.
 */
export function schedulerVisibleSourceApps(): SchedulerPolicySourceApp[] {
  return [...ALL_SOURCE_APPS];
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

/** Return 404 for values that are not Scheduler source applications. */
export function assertSchedulerSourceAppVisible(
  sourceApp: string,
): void {
  if (!isSchedulerSourceAppVisible(sourceApp)) {
    throw notFound('Scheduler job');
  }
}
