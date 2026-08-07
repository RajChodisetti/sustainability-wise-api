import type {
  MeasurementAssignment,
  Meter,
  WattwatcherChannel,
} from '@/modules/installhub/types/domain';

export function assignmentApprovalSignature(assignment: MeasurementAssignment): string {
  return JSON.stringify({
    ...assignment,
    channelIds: [...assignment.channelIds].sort(),
  });
}

export function assignmentCollectionConcurrencySignature(
  assignments: MeasurementAssignment[],
): string {
  return JSON.stringify(
    [...assignments]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((assignment) => ({
        ...assignment,
        channelIds: [...assignment.channelIds].sort(),
      })),
  );
}

/**
 * Turns optional editor rows into assignments accepted by the structural write
 * contract. Empty rows disappear. Malformed groups keep the first usable,
 * unique, same-purpose channel subset and become explicit TBC work instead of
 * blocking an otherwise unrelated meter save.
 */
export function structurallySavableMeterAssignments(
  assignments: MeasurementAssignment[],
  channels: WattwatcherChannel[],
): MeasurementAssignment[] {
  const purposeById = new Map(channels.map((channel) => [channel.id, channel.purpose]));
  const usedChannelIds = new Set<string>();

  return assignments.flatMap((assignment) => {
    if (!assignment.channelIds.length) return [];
    const retained: string[] = [];
    const localIds = new Set<string>();
    let sharedPurpose: WattwatcherChannel['purpose'] | undefined;
    let structurallyChanged = false;

    for (const channelId of assignment.channelIds) {
      const purpose = purposeById.get(channelId);
      if (
        localIds.has(channelId)
        || usedChannelIds.has(channelId)
        || !purpose
        || purpose === 'SPARE'
        || (sharedPurpose !== undefined && purpose !== sharedPurpose)
      ) {
        structurallyChanged = true;
        continue;
      }
      localIds.add(channelId);
      usedChannelIds.add(channelId);
      sharedPurpose = purpose;
      retained.push(channelId);
    }

    if (!retained.length) return [];
    const phaseMode = retained.length === 1
      ? 'SINGLE_PHASE'
      : retained.length === 3
        ? 'THREE_PHASE'
        : 'OTHER';
    structurallyChanged ||= phaseMode !== assignment.phaseMode
      || retained.length !== assignment.channelIds.length;
    const target = structurallyChanged ? { kind: 'TBC' as const } : assignment.target;
    return [{
      ...assignment,
      channelIds: retained,
      phaseMode,
      target,
      status: target.kind === 'TBC' ? 'TBC' : 'CONFIRMED',
    }];
  });
}

export function meterStructuralConcurrencySignature(
  meter: Meter | null | undefined,
): string {
  if (!meter) return '';
  const nonMedia = { ...meter };
  delete nonMedia.wwPhotos;
  return JSON.stringify(nonMedia);
}

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
