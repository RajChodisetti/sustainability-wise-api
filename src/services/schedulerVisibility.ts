import { config } from '../config.js';
import { notFound } from '../utils/errors.js';

export type SchedulerPolicySourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type SchedulerPolicyFinanceSourceApp = Exclude<SchedulerPolicySourceApp, 'custom'>;

const ALL_SOURCE_APPS = ['ecoaudit', 'solarsense', 'installhub', 'custom'] as const;
const FIELD_ONLY_SOURCE_APPS = ['installhub', 'custom'] as const;

export function schedulerVisibleSourceApps(
  hideEcoAuditSolarSenseJobs = config.schedulerHideEcoAuditSolarSenseJobs,
): SchedulerPolicySourceApp[] {
  return hideEcoAuditSolarSenseJobs
    ? [...FIELD_ONLY_SOURCE_APPS]
    : [...ALL_SOURCE_APPS];
}

export function schedulerVisibleFinanceSourceApps(
  hideEcoAuditSolarSenseJobs = config.schedulerHideEcoAuditSolarSenseJobs,
): SchedulerPolicyFinanceSourceApp[] {
  return schedulerVisibleSourceApps(hideEcoAuditSolarSenseJobs).filter(
    (app): app is SchedulerPolicyFinanceSourceApp => app !== 'custom',
  );
}

export function isSchedulerSourceAppVisible(
  sourceApp: string,
  hideEcoAuditSolarSenseJobs = config.schedulerHideEcoAuditSolarSenseJobs,
): sourceApp is SchedulerPolicySourceApp {
  return schedulerVisibleSourceApps(hideEcoAuditSolarSenseJobs).includes(
    sourceApp as SchedulerPolicySourceApp,
  );
}

export function areSchedulerSourceAppsVisible(
  sourceApps: readonly string[],
  hideEcoAuditSolarSenseJobs = config.schedulerHideEcoAuditSolarSenseJobs,
): boolean {
  return sourceApps.every((sourceApp) => (
    isSchedulerSourceAppVisible(sourceApp, hideEcoAuditSolarSenseJobs)
  ));
}

/** Return 404 so hidden Scheduler records cannot be discovered through known IDs. */
export function assertSchedulerSourceAppVisible(
  sourceApp: string,
  hideEcoAuditSolarSenseJobs = config.schedulerHideEcoAuditSolarSenseJobs,
): void {
  if (!isSchedulerSourceAppVisible(sourceApp, hideEcoAuditSolarSenseJobs)) {
    throw notFound('Scheduler job');
  }
}
