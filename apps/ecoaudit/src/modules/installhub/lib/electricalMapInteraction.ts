import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeterDeviceChannel,
} from '@/modules/installhub/types/domain';
import {
  electricalTreeNodeCardSummary,
  resolvedElectricalMeasurementDetails,
} from '@/modules/installhub/lib/electricalTreeLayout';
import { meterDeviceName, meterDevices } from '@/modules/installhub/lib/workflow';

type ElectricalNode = ElectricalTreeReadModel['nodes'][number];

export type ElectricalMapInteractionChannel = {
  id: string;
  ordinal: number;
  label: string;
};

export type ElectricalMapInteractionMeter = {
  id: string;
  name: string;
  serialNumber?: string;
  installedChannelCount: number;
  assignedChannels: ElectricalMapInteractionChannel[];
};

export type ElectricalMapNodeInteractionSummary = {
  loadLabels: string[];
  downstreamLoadCount: number;
  meters: ElectricalMapInteractionMeter[];
  meterCount: number;
  installedChannelCount: number;
  activeChannelCount: number;
  assignedChannelCount: number;
};

function readableCode(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => /^(AC|CT|DB|EV|HVAC|PV)$/i.test(word)
      ? word.toUpperCase()
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function channelLoadLabel(channel: MeterDeviceChannel): string {
  return channel.customLoadTypeName?.trim()
    || readableCode(channel.loadTypeCode)
    || channel.description?.trim()
    || (channel.purpose === 'MAIN_SUPPLY'
      ? 'Main supply'
      : channel.purpose === 'SUB_CIRCUIT'
        ? 'Sub-circuit'
        : 'Spare');
}

function channelPurposeLabel(channel: MeterDeviceChannel): string {
  if (channel.purpose === 'MAIN_SUPPLY') return 'Main supply';
  if (channel.purpose === 'SUB_CIRCUIT') return 'Sub-circuit';
  if (channel.purpose === 'SPARE') return 'Spare';
  return readableCode(channel.purpose) || 'Unknown purpose';
}

function interactionScopeNodeIds(
  model: ElectricalTreeReadModel,
  node: ElectricalNode,
): Set<string> {
  const scoped = new Set<string>([node.id]);
  if (node.kind !== 'GRID' && node.kind !== 'BOARD') return scoped;

  const children = new Map<string, string[]>();
  for (const edge of model.edges) {
    if (edge.relationship !== 'FED_FROM') continue;
    const targetIds = children.get(edge.sourceNodeId) || [];
    targetIds.push(edge.targetNodeId);
    children.set(edge.sourceNodeId, targetIds);
  }
  for (const candidate of model.nodes) {
    if (candidate.kind !== 'VIRTUAL_RESIDUAL' || !candidate.parentNodeId) continue;
    const targetIds = children.get(candidate.parentNodeId) || [];
    targetIds.push(candidate.id);
    children.set(candidate.parentNodeId, targetIds);
  }

  const queued = [...(children.get(node.id) || [])];
  while (queued.length) {
    const nodeId = queued.shift();
    if (!nodeId || scoped.has(nodeId)) continue;
    scoped.add(nodeId);
    queued.push(...(children.get(nodeId) || []));
  }
  return scoped;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

/**
 * Client-facing facts shared by map tooltips and the selected-item panel.
 * Only canonical MEASURES relationships contribute assigned channels.
 */
export function electricalMapNodeInteractionSummary(
  tree: InstallationTree,
  model: ElectricalTreeReadModel,
  nodeId: string,
): ElectricalMapNodeInteractionSummary {
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return {
      loadLabels: [],
      downstreamLoadCount: 0,
      meters: [],
      meterCount: 0,
      installedChannelCount: 0,
      activeChannelCount: 0,
      assignedChannelCount: 0,
    };
  }

  const scopeIds = interactionScopeNodeIds(model, node);
  const scopeNodes = model.nodes.filter((candidate) => scopeIds.has(candidate.id));
  const detailByAssignmentId = new Map(scopeNodes.flatMap((candidate) => (
    resolvedElectricalMeasurementDetails(tree, model, candidate.id)
      .map((detail) => [detail.assignment.id, detail] as const)
  )));
  let details = [...detailByAssignmentId.values()];

  const meterBoardIds = new Set<string>();
  if (node.kind === 'BOARD') meterBoardIds.add(node.id);
  if (node.kind === 'GRID') {
    scopeNodes
      .filter((candidate) => candidate.kind === 'BOARD')
      .forEach((candidate) => meterBoardIds.add(candidate.id));
  }
  if (node.kind === 'BOARD') {
    details = details.filter((detail) => detail.meter.installedOnBoardId === node.id);
  }

  const allMeters = meterDevices(tree);
  const meterById = new Map(allMeters.map((meter) => [meter.id, meter]));
  const relevantMeterIds = new Set(details.map((detail) => detail.meter.id));
  for (const meter of allMeters) {
    if (
      meterBoardIds.has(meter.installedOnBoardId)
      && (meter.lifecycleState ?? 'ACTIVE') === 'ACTIVE'
    ) relevantMeterIds.add(meter.id);
  }

  const meters = [...relevantMeterIds].flatMap((meterId) => {
    const meter = meterById.get(meterId);
    if (!meter) return [];
    if (
      (node.kind === 'GRID' || node.kind === 'BOARD')
      && (meter.lifecycleState ?? 'ACTIVE') !== 'ACTIVE'
    ) return [];
    const assignedById = new Map(details
      .filter((detail) => detail.meter.id === meterId)
      .flatMap((detail) => detail.channels.map((channel) => [channel.id, channel] as const)));
    const assignedChannels = [...assignedById.values()]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        label: [...new Set([
          `Ch ${channel.ordinal}`,
          channel.phaseLabel?.trim(),
          channelPurposeLabel(channel),
          channelLoadLabel(channel),
        ].filter(Boolean))].join(' · '),
      }));
    return [{
      id: meter.id,
      name: meterDeviceName(meter),
      ...(meter.serialNumber.trim() ? { serialNumber: meter.serialNumber.trim() } : {}),
      installedChannelCount: meter.channels.length,
      assignedChannels,
    }];
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const summaryNodeIds = new Set<string>();
  if (node.kind === 'SITE_ASSET') summaryNodeIds.add(node.id);
  scopeNodes
    .filter((candidate) => candidate.kind === 'SITE_ASSET')
    .forEach((candidate) => summaryNodeIds.add(candidate.id));
  if (!summaryNodeIds.size) summaryNodeIds.add(node.id);
  const loadLabels = sortedUnique([...summaryNodeIds].flatMap((targetId) => (
    electricalTreeNodeCardSummary(tree, model, targetId).loadLabels
  )));
  if (!loadLabels.length && node.kind === 'SITE_ASSET' && node.typeLabel?.trim()) {
    loadLabels.push(node.typeLabel.trim());
  }

  return {
    loadLabels,
    downstreamLoadCount: node.kind === 'SITE_ASSET'
      ? 1
      : scopeNodes.filter((candidate) => candidate.kind === 'SITE_ASSET').length,
    meters,
    meterCount: meters.length,
    installedChannelCount: meters.reduce((total, meter) => total + meter.installedChannelCount, 0),
    activeChannelCount: meters.reduce((total, meter) => {
      const source = meterById.get(meter.id);
      return total + (source?.channels.filter((channel) => channel.purpose !== 'SPARE').length || 0);
    }, 0),
    assignedChannelCount: meters.reduce((total, meter) => total + meter.assignedChannels.length, 0),
  };
}
