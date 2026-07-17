import type { FleetEmailDelta } from '@/modules/fleet/types/domain';

export type FleetReportCohort = {
  key: 'offline' | 'newlyOffline' | 'recovered';
  title: string;
  description: string;
  deviceIds: string[];
  archivedCount: number | null;
};

function retainedDeviceIds(value?: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((deviceId): deviceId is string => (
    typeof deviceId === 'string' && deviceId.length > 0
  ));
}

function retainedCount(value?: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function fleetReportCohorts(delta?: FleetEmailDelta | null): FleetReportCohort[] {
  return [
    {
      key: 'offline',
      title: 'All report-offline',
      description: 'Every device included in the latest email’s report-offline cohort.',
      deviceIds: retainedDeviceIds(delta?.offlineDeviceIds),
      archivedCount: retainedCount(delta?.offlineCount),
    },
    {
      key: 'newlyOffline',
      title: 'Newly offline',
      description: 'Devices newly added to the report-offline cohort in this email.',
      deviceIds: retainedDeviceIds(delta?.newlyOfflineDeviceIds),
      archivedCount: retainedCount(delta?.newlyOfflineCount),
    },
    {
      key: 'recovered',
      title: 'Recovered',
      description: 'Devices removed from the report-offline cohort in this email.',
      deviceIds: retainedDeviceIds(delta?.recoveredDeviceIds),
      archivedCount: retainedCount(delta?.recoveredCount),
    },
  ];
}
