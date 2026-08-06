import type { Meter, WattwatcherChannel } from '@/modules/installhub/types/domain';

export function showsWattwatchersCommissioningSections(
  deviceType: Meter['deviceType'],
): boolean {
  return deviceType === 'A3RM' || deviceType === 'A6M';
}

export function suggestedDeviceDisplayName(input: {
  siteName: string;
  zoneName: string;
  deviceModel: string;
  serialNumber?: string | null;
}): string {
  const label = [
    input.siteName.trim(),
    input.zoneName.trim(),
    input.deviceModel.trim() || 'Metering device',
    input.serialNumber?.trim(),
  ].filter(Boolean).join(' · ');
  if (label.length <= 64) return label;
  return `${label.slice(0, 63).trimEnd()}…`;
}

export function unassignedChannelMessage(
  channels: WattwatcherChannel[],
  channelIds: string[],
): string {
  const ordinalById = new Map(
    channels.map((channel, index) => [channel.id, channel.ordinal ?? index + 1]),
  );
  const labels = channelIds.map((channelId, index) => (
    `Channel ${ordinalById.get(channelId) ?? index + 1}`
  ));
  const joined = new Intl.ListFormat('en-AU', { style: 'long', type: 'conjunction' }).format(labels);
  return `Assign every active channel. ${joined} ${labels.length === 1 ? 'is' : 'are'} unresolved.`;
}

export function nextMeterChannelId(
  meterId: string,
  channels: Array<Pick<WattwatcherChannel, 'id'>>,
): string {
  const used = new Set(channels.map((channel) => channel.id).filter(Boolean));
  let ordinal = 1;
  while (used.has(`${meterId}:${ordinal}`)) ordinal += 1;
  return `${meterId}:${ordinal}`;
}

export function renamedMeterCapabilities(
  capabilities: Record<string, unknown>,
  priorKey: string,
  requestedKey: string,
): { capabilities: Record<string, unknown>; error?: string } {
  const nextKey = requestedKey.trim();
  if (!nextKey) {
    return { capabilities, error: 'Capability name cannot be blank.' };
  }
  if (nextKey !== priorKey && Object.prototype.hasOwnProperty.call(capabilities, nextKey)) {
    return { capabilities, error: `Capability “${nextKey}” already exists.` };
  }
  if (nextKey === priorKey) return { capabilities };
  const renamed = { ...capabilities };
  const value = renamed[priorKey];
  delete renamed[priorKey];
  renamed[nextKey] = value;
  return { capabilities: renamed };
}
