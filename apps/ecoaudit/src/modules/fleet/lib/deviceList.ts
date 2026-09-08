import type { DeviceObservation } from '@/modules/fleet/types/domain';

export type DeviceGroupBy = '' | 'client' | 'site';

export type DeviceListGroup = {
  key: string;
  label: string | null;
  devices: DeviceObservation[];
};

export function groupFleetDevices(
  devices: DeviceObservation[],
  groupBy: DeviceGroupBy,
): DeviceListGroup[] {
  if (!groupBy) return [{ key: 'all', label: null, devices }];
  const groups: DeviceListGroup[] = [];
  const groupsByKey = new Map<string, DeviceListGroup>();
  for (const device of devices) {
    const placement = device.currentPlacement;
    const key = groupBy === 'client'
      ? placement?.businessClient.id ?? 'unlinked-client'
      : placement?.site
        ? `${placement.businessClient.id}:${placement.site.id}`
        : 'unlinked-site';
    const label = groupBy === 'client'
      ? placement?.businessClient.name ?? 'Client not linked'
      : placement?.site
        ? `${placement.site.name} · ${placement.businessClient.name}`
        : 'Site not linked';
    const current = groupsByKey.get(key);
    if (current) {
      current.devices.push(device);
    } else {
      const group = { key, label, devices: [device] };
      groups.push(group);
      groupsByKey.set(key, group);
    }
  }
  return groups;
}
