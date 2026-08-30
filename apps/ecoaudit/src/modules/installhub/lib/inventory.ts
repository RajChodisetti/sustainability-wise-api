import type { InstallHubInventoryMeter } from '@/modules/installhub/types/inventory';

export function normalizeInventoryDeviceId(value: string): string {
  return value.trim().toLocaleUpperCase('en-AU');
}

export function installHubInventoryModelLabel(meter: InstallHubInventoryMeter): string {
  if (meter.deviceModel !== 'OTHER') return meter.deviceModel;
  const custom = [meter.customManufacturerName, meter.customModelName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' ');
  return custom ? `Other · ${custom}` : 'Other';
}
