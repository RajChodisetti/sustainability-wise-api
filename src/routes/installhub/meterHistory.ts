import {
  canonicalPayloadHash,
  type CanonicalInstallationTree,
  type MeasurementAssignment,
  type MeterDevice,
} from './canonical.js';

export type CommsReplacementTransition = {
  formSubmissionId: string;
  meterId: string;
};

export type MeterHistoryState = {
  meter: MeterDevice;
  assignments: MeasurementAssignment[];
  affectedSiteAssets: Array<{
    id: string;
    meterPresent: boolean;
    meteringState: CanonicalInstallationTree['siteAssets'][number]['meteringState'];
  }>;
};

export class MeterHistoryRestoreError extends Error {
  constructor(
    readonly code:
      | 'meter_history_installation_mismatch'
      | 'meter_history_meter_missing'
      | 'meter_history_context_changed',
  ) {
    super(code);
    this.name = 'MeterHistoryRestoreError';
  }
}

export class CommsReplacementStateError extends Error {
  constructor(
    readonly code:
      | 'comms_replacement_meter_missing'
      | 'comms_replacement_mapping_changed'
      | 'comms_replacement_state_mismatch',
  ) {
    super(code);
    this.name = 'CommsReplacementStateError';
  }
}

function sortedAssignments(
  tree: CanonicalInstallationTree,
  meterId: string,
): MeasurementAssignment[] {
  return tree.measurementAssignments
    .filter((assignment) => assignment.meterId === meterId)
    .map((assignment) => structuredClone(assignment))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function affectedSiteAssetIds(assignments: MeasurementAssignment[]): string[] {
  return [...new Set(assignments.flatMap((assignment) => (
    assignment.target.kind === 'SITE_ASSET'
      ? [assignment.target.siteAssetId]
      : []
  )))].sort();
}

export function meterHistoryState(
  tree: CanonicalInstallationTree,
  meterId: string,
): MeterHistoryState | null {
  const meter = tree.meterDevices.find((item) => item.id === meterId);
  if (!meter) return null;
  const assignments = sortedAssignments(tree, meterId);
  const assetIds = affectedSiteAssetIds(assignments);
  return {
    meter: structuredClone(meter),
    assignments,
    affectedSiteAssets: assetIds.map((assetId) => {
      const asset = tree.siteAssets.find((item) => item.id === assetId);
      if (!asset) throw new MeterHistoryRestoreError('meter_history_context_changed');
      return {
        id: asset.id,
        meterPresent: asset.meterPresent,
        meteringState: structuredClone(asset.meteringState),
      };
    }),
  };
}

export function meterHistoryStateHash(
  tree: CanonicalInstallationTree,
  meterId: string,
): string | null {
  const state = meterHistoryState(tree, meterId);
  if (!state) return null;
  const {
    installedOnBoardId: _installedOnBoardId,
    displayName: _displayName,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    ...restorableMeter
  } = state.meter;
  return canonicalPayloadHash(restorableMeter);
}

/**
 * Finds only forms that cross the Draft -> Completed boundary in this push.
 * Replays of an already-completed snapshot therefore cannot append duplicate
 * replacement provenance.
 */
export function completedCommsReplacementTransitions(input: {
  current: CanonicalInstallationTree;
  incoming: CanonicalInstallationTree;
}): CommsReplacementTransition[] {
  const currentById = new Map(
    input.current.formSubmissions.map((form) => [form.id, form]),
  );
  return input.incoming.formSubmissions
    .filter((form) => (
      form.formType === 'comms-fault'
      && form.status === 'Completed'
      && form.answers['works.replace_device'] === 'yes'
      && Boolean(form.meterId)
      && currentById.get(form.id)?.status !== 'Completed'
    ))
    .map((form) => ({
      formSubmissionId: form.id,
      meterId: form.meterId!,
    }))
    .sort((left, right) => left.formSubmissionId.localeCompare(right.formSubmissionId));
}

export function ambiguousCommsReplacementMeterIds(
  transitions: CommsReplacementTransition[],
): string[] {
  const counts = new Map<string, number>();
  for (const transition of transitions) {
    counts.set(transition.meterId, (counts.get(transition.meterId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([meterId]) => meterId)
    .sort();
}

function optionalAnswer(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

const COMMS_SENSOR_RATINGS: Readonly<Record<'A3RM' | 'A6M', ReadonlySet<string>>> = {
  A3RM: new Set([
    '10cm-200A',
    '10cm-333mV',
    '20cm-3000A',
    '30cm-3000A',
    '45cm-3000A',
    'Not Used',
    '3000A - 9cm',
    '3000A - 20cm',
    '3000A - 29cm',
  ]),
  A6M: new Set([
    'CT-60A',
    'CT-120A',
    'CT-250A',
    'CT-400A',
    'CT-600A',
    'Not Used',
    '60A',
    '120A',
    '200A',
    '400A',
    '600A',
  ]),
};

function validCommsSensorRating(model: string | undefined, rating: string | null): boolean {
  return (model === 'A3RM' || model === 'A6M')
    && rating !== null
    && COMMS_SENSOR_RATINGS[model].has(rating);
}

function carriedChannelState(channel: MeterDevice['channels'][number]) {
  return {
    phaseLabel: channel.phaseLabel ?? null,
    purpose: channel.purpose,
    loadTypeCode: channel.loadTypeCode ?? null,
    customLoadTypeName: channel.customLoadTypeName ?? null,
    description: channel.description ?? null,
    capabilities: channel.capabilities ?? {},
  };
}

function replacementMappingState(input: {
  tree: CanonicalInstallationTree;
  meterId: string;
  affectedAssetIds: ReadonlySet<string>;
}) {
  return {
    assignments: input.tree.measurementAssignments
      .filter((assignment) => assignment.meterId === input.meterId)
      .map((assignment) => {
        const {
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          deletedAt: _deletedAt,
          ...operational
        } = assignment;
        return {
          ...operational,
          channelIds: [...operational.channelIds].sort(),
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    affectedSiteAssets: [...input.affectedAssetIds].sort().map((assetId) => {
      const asset = input.tree.siteAssets.find((candidate) => candidate.id === assetId);
      return asset
        ? {
            id: asset.id,
            meterPresent: asset.meterPresent,
            meteringState: asset.meteringState.kind === 'METERED'
              ? {
                  kind: 'METERED' as const,
                  measurementAssignmentIds: [
                    ...asset.meteringState.measurementAssignmentIds,
                  ].sort(),
                }
              : asset.meteringState,
          }
        : { id: assetId, missing: true as const };
    }),
  };
}

function currentMeterAffectedSiteAssetIds(
  tree: CanonicalInstallationTree,
  meterId: string,
): Set<string> {
  const assignments = tree.measurementAssignments.filter(
    (assignment) => assignment.meterId === meterId,
  );
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  return new Set([
    ...assignments.flatMap((assignment) => (
      assignment.target.kind === 'SITE_ASSET'
        ? [assignment.target.siteAssetId]
        : []
    )),
    ...tree.siteAssets.filter((asset) => (
      asset.meteringState.kind === 'METERED'
      && asset.meteringState.measurementAssignmentIds.some((id) => assignmentIds.has(id))
    )).map((asset) => asset.id),
  ]);
}

/**
 * Proves that each completed comms form produced exactly the operational
 * transformation authored by the installed client. This is deliberately
 * stricter than checking a meter id: it is the authorization boundary that
 * permits a commissioned meter identity to change without a WW amendment.
 */
export function authorizeCommsReplacementTransitions(input: {
  current: CanonicalInstallationTree;
  incoming: CanonicalInstallationTree;
  transitions: CommsReplacementTransition[];
}): ReadonlySet<string> {
  const authorizedMeterIds = new Set<string>();
  for (const transition of input.transitions) {
    const currentMeter = input.current.meterDevices.find(
      (meter) => meter.id === transition.meterId,
    );
    const incomingMeter = input.incoming.meterDevices.find(
      (meter) => meter.id === transition.meterId,
    );
    const form = input.incoming.formSubmissions.find(
      (candidate) => candidate.id === transition.formSubmissionId,
    );
    if (!currentMeter || !incomingMeter || !form) {
      throw new CommsReplacementStateError('comms_replacement_meter_missing');
    }

    const model = form.answers['works.new_device_type'];
    const serialNumber = optionalAnswer(form.answers['works.new_device_id']) ?? '';
    const deviceNumber = optionalAnswer(form.answers['works.new_device_number'])
      ?? optionalAnswer(serialNumber);
    const sensorRating = optionalAnswer(form.answers['works.new_sensor_rating']);
    const channelCount = model === 'A3RM' ? 3 : model === 'A6M' ? 6 : 0;
    const currentByOrdinal = new Map(
      currentMeter.channels.map((channel) => [channel.ordinal, channel]),
    );
    const incomingByOrdinal = new Map(
      incomingMeter.channels.map((channel) => [channel.ordinal, channel]),
    );
    const currentBoard = input.current.electricalAssets.find(
      (board) => board.id === currentMeter.installedOnBoardId,
    );
    const expectedOrdinals = Array.from({ length: channelCount }, (_, index) => index + 1);
    const baseMatches = (
      form.formType === 'comms-fault'
      && form.status === 'Completed'
      && form.meterId === transition.meterId
      && form.boardId === currentMeter.installedOnBoardId
      && Boolean(currentBoard)
      && (!form.zoneId || form.zoneId === currentBoard?.zoneId)
      && form.answers['works.replace_device'] === 'yes'
      && serialNumber.length > 0
      && channelCount > 0
      && validCommsSensorRating(model, sensorRating)
      && currentMeter.deviceFamily === 'WATTWATCHERS'
      && incomingMeter.deviceFamily === 'WATTWATCHERS'
      && incomingMeter.deviceModel === model
      && incomingMeter.serialNumber === serialNumber
      && (incomingMeter.deviceNumber ?? null) === deviceNumber
      && incomingMeter.installedOnBoardId === currentMeter.installedOnBoardId
      && (incomingMeter.customManufacturerName ?? null)
        === (currentMeter.customManufacturerName ?? null)
      && (incomingMeter.customModelName ?? null) === (currentMeter.customModelName ?? null)
      && incomingMeter.channels.length === channelCount
      && incomingByOrdinal.size === channelCount
      && expectedOrdinals.every((ordinal) => incomingByOrdinal.has(ordinal))
    );
    if (!baseMatches) {
      throw new CommsReplacementStateError('comms_replacement_state_mismatch');
    }

    const affectedAssetIds = currentMeterAffectedSiteAssetIds(
      input.current,
      transition.meterId,
    );
    if (
      input.current.measurementAssignments.some((assignment) => (
        assignment.meterId === transition.meterId
        && assignment.channelIds.some((channelId) => (
          !incomingMeter.channels.some((channel) => channel.id === channelId)
        ))
      ))
      ||
      canonicalPayloadHash(replacementMappingState({
        tree: input.current,
        meterId: transition.meterId,
        affectedAssetIds,
      }))
      !== canonicalPayloadHash(replacementMappingState({
        tree: input.incoming,
        meterId: transition.meterId,
        affectedAssetIds,
      }))
    ) {
      throw new CommsReplacementStateError('comms_replacement_mapping_changed');
    }

    for (const ordinal of expectedOrdinals) {
      const incomingChannel = incomingByOrdinal.get(ordinal)!;
      const currentChannel = currentByOrdinal.get(ordinal);
      const expectedId = currentChannel?.id ?? `${transition.meterId}:${ordinal}`;
      const carriedMatches = currentChannel
        ? canonicalPayloadHash(carriedChannelState(incomingChannel))
          === canonicalPayloadHash(carriedChannelState(currentChannel))
        // Mobile and the current portal materialize a newly expanded channel
        // as SUB_CIRCUIT. Retain the former portal's SPARE default so a Draft
        // authored before this release can still complete without weakening
        // any identity, load, sensor, or carried-channel checks.
        : ['SUB_CIRCUIT', 'SPARE'].some((purpose) => (
          canonicalPayloadHash(carriedChannelState(incomingChannel))
          === canonicalPayloadHash({
            phaseLabel: null,
            purpose,
            loadTypeCode: null,
            customLoadTypeName: null,
            description: null,
            capabilities: {},
          })
        ));
      if (
        incomingChannel.id !== expectedId
        || (incomingChannel.sensorRating ?? null) !== sensorRating
        || !carriedMatches
      ) {
        throw new CommsReplacementStateError('comms_replacement_state_mismatch');
      }
    }
    authorizedMeterIds.add(transition.meterId);
  }
  return authorizedMeterIds;
}

function pendingDraftCommsReplacementMeterIds(
  tree: CanonicalInstallationTree,
): string[] {
  return [...new Set(tree.formSubmissions.flatMap((form) => (
    form.formType === 'comms-fault'
    && form.status === 'Draft'
    && form.answers['works.replace_device'] === 'yes'
    && form.meterId
      ? [form.meterId]
      : []
  )))].sort();
}

/**
 * Metadata staging may save form answers/evidence, but it must not make the
 * pending replacement identity operational before the final complete push.
 * Keep only the current meter state while allowing independent assignment,
 * asset and installation metadata edits to proceed.
 */
export function retainPendingCommsReplacementMeterState(input: {
  current: CanonicalInstallationTree;
  incoming: CanonicalInstallationTree;
}): string[] {
  const meterIds = pendingDraftCommsReplacementMeterIds(input.incoming);
  for (const meterId of meterIds) {
    const currentMeter = input.current.meterDevices.find((meter) => meter.id === meterId);
    const incomingMeterIndex = input.incoming.meterDevices.findIndex(
      (meter) => meter.id === meterId,
    );
    if (!currentMeter || incomingMeterIndex < 0) {
      throw new CommsReplacementStateError('comms_replacement_meter_missing');
    }

    const incomingMeter = input.incoming.meterDevices[incomingMeterIndex];
    input.incoming.meterDevices[incomingMeterIndex] = {
      ...incomingMeter,
      id: currentMeter.id,
      installationId: currentMeter.installationId,
      installedOnBoardId: currentMeter.installedOnBoardId,
      customName: currentMeter.customName,
      deviceFamily: currentMeter.deviceFamily,
      deviceModel: currentMeter.deviceModel,
      customManufacturerName: currentMeter.customManufacturerName,
      customModelName: currentMeter.customModelName,
      deviceNumber: currentMeter.deviceNumber,
      serialNumber: currentMeter.serialNumber,
      displayName: structuredClone(currentMeter.displayName),
      channels: structuredClone(currentMeter.channels),
      createdAt: currentMeter.createdAt,
      deletedAt: currentMeter.deletedAt,
    };
  }
  return meterIds;
}

/**
 * Restores only the selected meter state. Current compatible assignments stay
 * attached, so rollback never resurrects historical target relationships.
 * Installation details, forms, other devices, current board placement and the
 * server-owned display-code claim remain current. An assignment that cannot be
 * represented by the target channel layout is rejected instead of silently
 * deleting or rewriting current operational mapping.
 */
export function restoreMeterFromHistory(input: {
  current: CanonicalInstallationTree;
  target: CanonicalInstallationTree;
  meterId: string;
}): CanonicalInstallationTree {
  if (input.current.installation.id !== input.target.installation.id) {
    throw new MeterHistoryRestoreError('meter_history_installation_mismatch');
  }
  const currentState = meterHistoryState(input.current, input.meterId);
  const targetState = meterHistoryState(input.target, input.meterId);
  if (!currentState || !targetState) {
    throw new MeterHistoryRestoreError('meter_history_meter_missing');
  }
  if (
    currentState.meter.installedOnBoardId !== targetState.meter.installedOnBoardId
    || !input.current.electricalAssets.some(
      (board) => board.id === targetState.meter.installedOnBoardId,
    )
  ) {
    throw new MeterHistoryRestoreError('meter_history_context_changed');
  }

  const targetChannelIds = new Set(targetState.meter.channels.map((channel) => channel.id));
  const targetPurposeByChannel = new Map(
    targetState.meter.channels.map((channel) => [channel.id, channel.purpose]),
  );
  const assignmentFitsTargetPurpose = (assignment: MeasurementAssignment): boolean => {
    const purposes = new Set(assignment.channelIds.map(
      (channelId) => targetPurposeByChannel.get(channelId),
    ));
    if (purposes.size !== 1 || purposes.has(undefined) || purposes.has('SPARE')) return false;
    const purpose = [...purposes][0];
    if (assignment.target.kind === 'TBC') return true;
    if (purpose === 'MAIN_SUPPLY') {
      return assignment.target.kind === 'GRID_BOUNDARY'
        || (
          assignment.target.kind === 'BOARD'
          && assignment.target.boardId === currentState.meter.installedOnBoardId
        );
    }
    if (purpose === 'SUB_CIRCUIT') {
      return assignment.target.kind === 'SITE_ASSET'
        || (
          assignment.target.kind === 'BOARD'
          && assignment.target.boardId !== currentState.meter.installedOnBoardId
        );
    }
    return false;
  };
  if (
    targetChannelIds.size !== targetState.meter.channels.length
    || currentState.assignments.some((assignment) => !assignmentFitsTargetPurpose(assignment))
  ) {
    throw new MeterHistoryRestoreError('meter_history_context_changed');
  }

  const restored = structuredClone(input.current);
  restored.meterDevices = restored.meterDevices.map((meter) => (
    meter.id === input.meterId
      ? {
          ...structuredClone(targetState.meter),
          installedOnBoardId: currentState.meter.installedOnBoardId,
          displayName: structuredClone(currentState.meter.displayName),
        }
      : meter
  ));
  restored.serverDerived.virtualMeterDefinitions = [];
  return restored;
}
