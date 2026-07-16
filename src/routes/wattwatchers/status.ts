export type FleetStatus = 'communicating' | 'delayed' | 'offline' | 'inactive' | 'unknown';
export type ReportTransition =
  | 'online'
  | 'newly_offline'
  | 'still_offline'
  | 'recovered'
  | 'baseline_offline'
  | 'unknown';

export type FleetThresholds = {
  delayedThresholdMinutes: number;
  offlineThresholdMinutes: number;
  reportOfflineThresholdHours: number;
};

export function lastUsableReportOffline(
  observations: Array<{ status: FleetStatus; reportOffline: boolean }>,
): boolean | null {
  const usable = observations.find(
    (observation) => observation.status !== 'unknown' && observation.status !== 'inactive',
  );
  return usable?.reportOffline ?? null;
}

export function parseOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function classifyFleetObservation(input: {
  fetchStatus: string;
  uninitialised: boolean;
  observedAt: Date;
  lastHeardAt: Date | null;
  thresholds: FleetThresholds;
}): { status: FleetStatus; reportOffline: boolean; communicationAgeSeconds: number | null } {
  if (input.fetchStatus !== 'ok') {
    return { status: 'unknown', reportOffline: false, communicationAgeSeconds: null };
  }
  if (!input.lastHeardAt) {
    return { status: 'inactive', reportOffline: false, communicationAgeSeconds: null };
  }

  const communicationAgeSeconds = Math.max(
    0,
    Math.floor((input.observedAt.getTime() - input.lastHeardAt.getTime()) / 1_000),
  );
  const delayedSeconds = input.thresholds.delayedThresholdMinutes * 60;
  const offlineSeconds = input.thresholds.offlineThresholdMinutes * 60;
  const reportOfflineSeconds = input.thresholds.reportOfflineThresholdHours * 60 * 60;

  // Live connectivity keeps uninitialised devices in the inactive cohort, but
  // the daily report flag deliberately follows the legacy email definition:
  // any usable heartbeat older than the report threshold belongs to that
  // cohort, independently of its live-status label.
  const status: FleetStatus = input.uninitialised
    ? 'inactive'
    : communicationAgeSeconds >= offlineSeconds
      ? 'offline'
      : communicationAgeSeconds >= delayedSeconds
        ? 'delayed'
        : 'communicating';

  return {
    status,
    reportOffline: communicationAgeSeconds >= reportOfflineSeconds,
    communicationAgeSeconds,
  };
}

export function reportTransition(
  previousReportOffline: boolean | null,
  currentReportOffline: boolean,
  currentStatus: FleetStatus,
): ReportTransition {
  if (currentStatus === 'unknown' || currentStatus === 'inactive') return 'unknown';
  if (previousReportOffline === null) {
    return currentReportOffline ? 'baseline_offline' : 'online';
  }
  if (currentReportOffline) {
    return previousReportOffline ? 'still_offline' : 'newly_offline';
  }
  return previousReportOffline ? 'recovered' : 'online';
}

export function availabilityPercent(counts: {
  communicating: number;
  delayed: number;
  offline: number;
}): number | null {
  const denominator = counts.communicating + counts.delayed + counts.offline;
  if (denominator === 0) return null;
  return Math.round((counts.communicating / denominator) * 10_000) / 100;
}
