import type { WattwatcherChannel } from '@/modules/installhub/types/domain';

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
