import sharp from 'sharp';
import {
  ELECTRICAL_MAP_ICON_NAMES,
  electricalMapIconDataUri,
  electricalMapIconForNode,
  electricalMapIconScale,
  type ElectricalMapIconName,
} from '../../pdf/electricalMapIcons.js';
import type {
  InstallHubCanonicalReport,
  InstallHubElectricalMapImages,
} from './reportHtml.js';
import {
  clientElectricalMapNodeIds,
  electricalMapLayoutMatchesNodeIds,
  type ElectricalMapLayoutDocument,
} from './electricalMapLayout.js';

const MARGIN_X = 42;
const HEADER_HEIGHT = 76;
const LEGEND_HEIGHT = 86;
const BODY_BOTTOM_PADDING = 24;
const MIN_DIAGRAM_WIDTH = 1_120;
const MIN_BODY_HALF_WIDTH = 520;
const MIN_BODY_HALF_HEIGHT = 300;
const RADIAL_INNER_RADIUS = 180;
const RADIAL_RING_GAP = 160;
const RADIAL_X_SCALE = 1.32;
const RADIAL_Y_SCALE = 0.68;
const RADIAL_USABLE_SPAN = Math.PI * (5 / 3);
const RADIAL_BRANCH_GAP = Math.PI / 24;
const RADIAL_COLLISION_STEP = 22;
const RADIAL_COLLISION_MARGIN = 18;
const RADIAL_MAX_COLLISION_STEPS = 180;
const GRID_MARKER_WIDTH = 184;
const GRID_MARKER_HEIGHT = 234;
const BOARD_MARKER_WIDTH = 190;
const BOARD_MARKER_BASE_HEIGHT = 210;
const ASSET_MARKER_WIDTH = 164;
const ASSET_MARKER_HEIGHT = 208;
const RESIDUAL_MARKER_WIDTH = 160;
const RESIDUAL_MARKER_HEIGHT = 196;
const GRID_MEDALLION_RADIUS = 90;
const BOARD_MEDALLION_RADIUS = 72;
const ASSET_MEDALLION_RADIUS = 60;
const RESIDUAL_MEDALLION_RADIUS = 60;
const METER_SATELLITE_ROW_HEIGHT = 34;
const METER_SATELLITE_COLUMNS = 2;
export const ELECTRICAL_MAP_DETAIL_THRESHOLD_PX = 1_400;
export const ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX = 1_080;
export const ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX = 140;
export const ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX = 720;
export const ELECTRICAL_MAP_DETAIL_TILE_VERTICAL_OVERLAP_PX = 96;
export const ELECTRICAL_MAP_MAX_DETAIL_PAGES = 24;
/**
 * A deep supply chain is legitimately wide, so width alone must not force the
 * overview to downscale. Peak rasterization stays bounded by the area cap.
 */
export const ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX = 4_800;
export const ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX = 2_400;
export const ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX = 5_000_000;

type DiagramNode = InstallHubCanonicalReport['electricalNodes'][number];
type DiagramMeter = InstallHubCanonicalReport['meters'][number];
type DiagramPosition = {
  cx: number;
  cy: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  radius: number;
  angle: number;
  branchId: string;
};
type RoutePoint = { x: number; y: number };

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(1, limit - 1)).trimEnd()}...`;
}

/**
 * Approximate Helvetica/Arial advance widths. Sharp rasterizes without a text
 * measurement API, so marker labels are fitted before they are emitted; this
 * keeps long client-facing names inside their reserved footprint.
 */
function characterWidthRatio(character: string): number {
  if (character === ' ') return 0.28;
  if ('ijlI.,:;|!\'`'.includes(character)) return 0.3;
  if ('ftr()[]{}-/\\'.includes(character)) return 0.38;
  if ('MW'.includes(character)) return 0.86;
  if ('mw'.includes(character)) return 0.84;
  if (character >= 'A' && character <= 'Z') return 0.68;
  if (character >= '0' && character <= '9') return 0.56;
  if (character >= 'a' && character <= 'z') return 0.545;
  return 0.6;
}

export function electricalMapTextWidth(value: string, fontSize: number, weight = 400): number {
  let ratio = 0;
  for (const character of value) ratio += characterWidthRatio(character);
  return ratio * fontSize * (weight >= 700 ? 1.045 : 1);
}

const textWidth = electricalMapTextWidth;

/** Trims to the widest prefix that fits `maxWidth`, keeping an ASCII ellipsis. */
function fitText(value: string, maxWidth: number, fontSize: number, weight = 400): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact || maxWidth <= 0) return '';
  if (textWidth(compact, fontSize, weight) <= maxWidth) return compact;
  const ellipsisWidth = textWidth('...', fontSize, weight);
  let width = 0;
  let end = 0;
  for (const character of compact) {
    const next = width + characterWidthRatio(character) * fontSize * (weight >= 700 ? 1.045 : 1);
    if (next + ellipsisWidth > maxWidth) break;
    width = next;
    end += character.length;
  }
  return end > 0 ? `${compact.slice(0, end).trimEnd()}...` : '';
}

function routePointsAttribute(points: RoutePoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(';');
}

function overlappingTileStarts(total: number, maximum: number, overlap: number): number[] {
  if (total <= maximum) return [0];
  const step = maximum - overlap;
  const count = 1 + Math.ceil((total - maximum) / step);
  const maximumStart = total - maximum;
  return Array.from({ length: count }, (_, index) => (
    index === count - 1 ? maximumStart : Math.round((maximumStart * index) / (count - 1))
  ));
}

export type ElectricalMapRenderPlan = {
  sourceWidth: number;
  sourceHeight: number;
  overviewWidth: number;
  overviewHeight: number;
  cropTop: number;
  cropHeight: number;
  rowCount: number;
  columnCount: number;
  totalDetailWindows: number;
  omittedDetailWindows: number;
  windows: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    row: number;
    column: number;
    rowCount: number;
    columnCount: number;
    windowIndex: number;
    windowCount: number;
  }>;
};

export function planElectricalMapRender(
  sourceWidth: number,
  sourceHeight: number,
): ElectricalMapRenderPlan {
  const areaScale = Math.sqrt(
    ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX / Math.max(1, sourceWidth * sourceHeight),
  );
  const overviewScale = Math.min(
    1,
    ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX / Math.max(1, sourceWidth),
    ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX / Math.max(1, sourceHeight),
    areaScale,
  );
  const overviewWidth = Math.max(1, Math.floor(sourceWidth * overviewScale));
  const overviewHeight = Math.max(1, Math.floor(sourceHeight * overviewScale));
  const cropTop = Math.max(0, HEADER_HEIGHT - 8);
  const cropHeight = Math.max(1, sourceHeight - LEGEND_HEIGHT - cropTop);
  const needsDetailWindows = sourceWidth > ELECTRICAL_MAP_DETAIL_THRESHOLD_PX
    || cropHeight > ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX;
  if (!needsDetailWindows) {
    return {
      sourceWidth,
      sourceHeight,
      overviewWidth,
      overviewHeight,
      cropTop,
      cropHeight,
      rowCount: 0,
      columnCount: 0,
      totalDetailWindows: 0,
      omittedDetailWindows: 0,
      windows: [],
    };
  }

  const tileWidth = Math.min(ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX, sourceWidth);
  const tileHeight = Math.min(ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX, cropHeight);
  const horizontalStarts = overlappingTileStarts(
    sourceWidth,
    tileWidth,
    ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX,
  );
  const verticalStarts = overlappingTileStarts(
    cropHeight,
    tileHeight,
    ELECTRICAL_MAP_DETAIL_TILE_VERTICAL_OVERLAP_PX,
  );
  const totalDetailWindows = horizontalStarts.length * verticalStarts.length;
  const selectedCount = Math.min(totalDetailWindows, ELECTRICAL_MAP_MAX_DETAIL_PAGES);
  const selectedIndexes = Array.from({ length: selectedCount }, (_, index) => (
    selectedCount === 1
      ? 0
      : Math.round((index * (totalDetailWindows - 1)) / (selectedCount - 1))
  ));
  const windows = selectedIndexes.map((flatIndex) => {
    const rowIndex = Math.floor(flatIndex / horizontalStarts.length);
    const columnIndex = flatIndex % horizontalStarts.length;
    return {
      left: horizontalStarts[columnIndex],
      top: cropTop + verticalStarts[rowIndex],
      width: tileWidth,
      height: tileHeight,
      row: rowIndex + 1,
      column: columnIndex + 1,
      rowCount: verticalStarts.length,
      columnCount: horizontalStarts.length,
      windowIndex: flatIndex + 1,
      windowCount: totalDetailWindows,
    };
  });
  return {
    sourceWidth,
    sourceHeight,
    overviewWidth,
    overviewHeight,
    cropTop,
    cropHeight,
    rowCount: verticalStarts.length,
    columnCount: horizontalStarts.length,
    totalDetailWindows,
    omittedDetailWindows: totalDetailWindows - windows.length,
    windows,
  };
}

function rewriteSvgViewport(
  svg: string,
  width: number,
  height: number,
  viewBox: string,
): string {
  return svg
    .replace(/width="[\d.]+"/, `width="${width}"`)
    .replace(/height="[\d.]+"/, `height="${height}"`)
    .replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`);
}

function svgSourceDimensions(svg: string): { width: number; height: number } {
  const match = /<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg);
  if (!match) throw new Error('electrical_map_svg_dimensions_missing');
  return { width: Number(match[1]), height: Number(match[2]) };
}

function assetIcon(node: DiagramNode): ElectricalMapIconName {
  return electricalMapIconForNode(node);
}

function nodeColors(node: DiagramNode): { fill: string; stroke: string; accent: string } {
  if (node.kind === 'GRID') return { fill: '#F1F5F9', stroke: '#475569', accent: '#334155' };
  if (node.kind === 'BOARD') return { fill: '#EFF6FF', stroke: '#1D4ED8', accent: '#1E3A8A' };
  if (node.kind === 'VIRTUAL_RESIDUAL') return { fill: '#F8FAFC', stroke: '#94A3B8', accent: '#475569' };
  return { fill: '#F0FDF4', stroke: '#4D9B68', accent: '#166534' };
}

function nodeKindLabel(kind: string): string {
  if (kind === 'GRID') return 'INCOMING GRID';
  if (kind === 'BOARD') return 'SWITCHBOARD';
  if (kind === 'VIRTUAL_RESIDUAL') return 'VIRTUAL RESIDUAL';
  if (kind === 'SITE_ASSET') return 'CONNECTED LOAD';
  return kind.replaceAll('_', ' ');
}

function coveragePresentation(coverage?: string): { label: string; fill: string; text: string } | null {
  if (!coverage) return null;
  if (coverage === 'DIRECT') return { label: 'DIRECT', fill: '#DCFCE7', text: '#166534' };
  if (coverage === 'VIRTUAL') return { label: 'VIRTUAL', fill: '#DBEAFE', text: '#1D4ED8' };
  if (coverage === 'INVALID') return { label: 'ISSUE', fill: '#FEE2E2', text: '#B91C1C' };
  if (coverage === 'TBC') return { label: 'TBC', fill: '#FDE68A', text: '#854D0E' };
  if (coverage === 'UNMETERED') return { label: 'UNMETERED', fill: '#FEF3C7', text: '#92400E' };
  return { label: truncate(coverage.replaceAll('_', ' ').toUpperCase(), 12), fill: '#E2E8F0', text: '#334155' };
}

function targetNodeId(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null;
  const value = target as Record<string, unknown>;
  if (value.kind === 'BOARD') return typeof value.boardId === 'string' ? value.boardId : null;
  if (value.kind === 'SITE_ASSET') return typeof value.siteAssetId === 'string' ? value.siteAssetId : null;
  if (value.kind === 'GRID_BOUNDARY') return typeof value.gridSupplyId === 'string' ? value.gridSupplyId : null;
  return null;
}

function compactChannelLabel(ordinals: number[]): string {
  const sorted = [...new Set(ordinals)].sort((left, right) => left - right);
  if (!sorted.length) return '';
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const ordinal of sorted.slice(1)) {
    if (ordinal === end + 1) {
      end = ordinal;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = ordinal;
    end = ordinal;
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `Ch ${ranges.join(', ')}`;
}

function channelLoadLabel(
  channel: DiagramMeter['channels'][number],
): string {
  const load = channel.load.trim();
  if (load) return load;
  if (channel.purpose === 'SPARE') return 'Spare / not used';
  if (channel.purpose === 'MAIN_SUPPLY') return 'Main supply';
  return 'Unclassified load';
}

function meterChannelAllocationSummary(meter: DiagramMeter): {
  channelSummary: string;
  loadSummary: string;
} {
  const active = meter.channels
    .filter((channel) => channel.purpose !== 'SPARE')
    .slice()
    .sort((left, right) => left.ordinal - right.ordinal);
  if (!active.length) {
    return { channelSummary: 'No active channels', loadSummary: 'No active load' };
  }
  const ordinalsByLoad = new Map<string, number[]>();
  for (const channel of active) {
    const load = channelLoadLabel(channel);
    const ordinals = ordinalsByLoad.get(load) ?? [];
    ordinals.push(channel.ordinal);
    ordinalsByLoad.set(load, ordinals);
  }
  const allocations = [...ordinalsByLoad.entries()]
    .sort(([, left], [, right]) => Math.min(...left) - Math.min(...right))
    .map(([load, ordinals]) => `${compactChannelLabel(ordinals)} · ${load}`);
  return {
    channelSummary: allocations.join(' / '),
    loadSummary: [...ordinalsByLoad.keys()].join(' / '),
  };
}

function diagramDepths(report: InstallHubCanonicalReport): Map<string, number> {
  const nodeIds = new Set(report.electricalNodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const connect = (sourceNodeId: string, targetNodeId: string) => {
    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) return;
    const targets = adjacency.get(sourceNodeId) ?? new Set<string>();
    targets.add(targetNodeId);
    adjacency.set(sourceNodeId, targets);
    const sources = incoming.get(targetNodeId) ?? new Set<string>();
    sources.add(sourceNodeId);
    incoming.set(targetNodeId, sources);
  };
  for (const edge of report.supplyEdges) connect(edge.sourceNodeId, edge.targetNodeId);
  for (const node of report.electricalNodes) {
    if (node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId) {
      connect(node.parentNodeId, node.id);
    }
  }

  const depths = new Map<string, number>();
  const seedBreadthFirst = (seedIds: string[], seedDepth: number) => {
    const queue: string[] = [];
    for (const seedId of seedIds) {
      if (depths.has(seedId)) continue;
      depths.set(seedId, seedDepth);
      queue.push(seedId);
    }
    for (let index = 0; index < queue.length; index += 1) {
      const sourceNodeId = queue[index];
      const sourceDepth = depths.get(sourceNodeId)!;
      const targets = [...(adjacency.get(sourceNodeId) ?? [])].sort((left, right) => left.localeCompare(right));
      for (const targetNodeId of targets) {
        if (depths.has(targetNodeId)) continue;
        depths.set(targetNodeId, sourceDepth + 1);
        queue.push(targetNodeId);
      }
    }
  };

  const gridIds = report.electricalNodes
    .filter((node) => node.kind === 'GRID')
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  seedBreadthFirst(gridIds, 0);

  while (depths.size < report.electricalNodes.length) {
    const unvisited = report.electricalNodes
      .map((node) => node.id)
      .filter((nodeId) => !depths.has(nodeId))
      .sort((left, right) => left.localeCompare(right));
    const unvisitedSet = new Set(unvisited);
    const componentRoots = unvisited.filter((nodeId) => (
      ![...(incoming.get(nodeId) ?? [])].some((sourceNodeId) => unvisitedSet.has(sourceNodeId))
    ));
    // A component with no root is cyclic. Seeding its stable first ID bounds the
    // layout while the visited set ensures each node receives one shortest depth.
    seedBreadthFirst(componentRoots.length ? componentRoots : [unvisited[0]], 1);
  }
  return depths;
}

type MeterSatellite = {
  meter: DiagramMeter;
  alias: string;
  channelSummary: string;
  loadSummary: string;
};

type VisualMarker = {
  node: DiagramNode;
  width: number;
  height: number;
  icon: ElectricalMapIconName;
  title: string;
  subtitle: string;
  measurement: string;
  meters: MeterSatellite[];
};

type RadialSector = {
  branchId: string;
  start: number;
  end: number;
  maxRadius: number;
  index: number;
};

type LayoutResult = {
  source: 'auto' | 'saved';
  positions: Map<string, DiagramPosition>;
  parentById: Map<string, string>;
  sectors: RadialSector[];
  bodyHeight: number;
  bodyTop: number;
  centerX: number;
  centerY: number;
  width: number;
};

type PlannedMarker = {
  nodeId: string;
  parentId?: string;
  branchId: string;
  depth: number;
  angle: number;
  minimumRadius: number;
  sectorStart: number;
  sectorEnd: number;
};

function markerDimensions(node: DiagramNode, meterCount: number): { width: number; height: number } {
  if (node.kind === 'GRID') return { width: GRID_MARKER_WIDTH, height: GRID_MARKER_HEIGHT };
  if (node.kind === 'BOARD') {
    const meterRows = Math.ceil(meterCount / METER_SATELLITE_COLUMNS);
    return {
      width: BOARD_MARKER_WIDTH,
      height: BOARD_MARKER_BASE_HEIGHT + meterRows * METER_SATELLITE_ROW_HEIGHT,
    };
  }
  if (node.kind === 'VIRTUAL_RESIDUAL') {
    return { width: RESIDUAL_MARKER_WIDTH, height: RESIDUAL_MARKER_HEIGHT };
  }
  return { width: ASSET_MARKER_WIDTH, height: ASSET_MARKER_HEIGHT };
}

function buildVisualMarkers(report: InstallHubCanonicalReport): Map<string, VisualMarker> {
  const zoneNames = new Map(report.physicalLocations.map((zone) => [zone.id, zone.name]));
  const nodeNames = new Map(report.electricalNodes.map((node) => [
    node.id,
    node.name || node.displayCode || node.id,
  ]));
  const sortedMeters = report.meters.slice().sort((left, right) => (
    left.installedOnBoardId.localeCompare(right.installedOnBoardId)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id)
  ));
  const meterById = new Map(sortedMeters.map((meter) => [meter.id, meter]));
  const meterAliasById = new Map<string, string>();
  const meterAliasByName = new Map<string, string>();
  const metersByBoard = new Map<string, MeterSatellite[]>();
  sortedMeters.forEach((meter, index) => {
    const alias = `M${index + 1}`;
    meterAliasById.set(meter.id, alias);
    if (!meterAliasByName.has(meter.name)) meterAliasByName.set(meter.name, alias);
    const allocation = meterChannelAllocationSummary(meter);
    const satellite: MeterSatellite = {
      meter,
      alias,
      ...allocation,
    };
    const entries = metersByBoard.get(meter.installedOnBoardId) ?? [];
    entries.push(satellite);
    metersByBoard.set(meter.installedOnBoardId, entries);
  });

  const measuredBy = new Map<string, Map<string, { ordinals: number[]; loads: string[] }>>();
  for (const row of report.meteringRows) {
    // Live diagnostics also expose TBC assignments. They remain in the indexed
    // schedule with their status, but must not be presented as confirmed
    // metering on the client-facing map.
    if (row.status && row.status !== 'CONFIRMED') continue;
    const nodeId = targetNodeId(row.target);
    if (!nodeId) continue;
    const byMeter = measuredBy.get(nodeId)
      ?? new Map<string, { ordinals: number[]; loads: string[] }>();
    const meter = row.meterId ? meterById.get(row.meterId) : undefined;
    const alias = (row.meterId ? meterAliasById.get(row.meterId) : undefined)
      ?? meterAliasByName.get(row.meterDisplayName)
      ?? row.meterDisplayName;
    const allocation = byMeter.get(alias) ?? { ordinals: [], loads: [] };
    if (typeof row.channelOrdinal === 'number') allocation.ordinals.push(row.channelOrdinal);
    const channel = meter?.channels.find((candidate) => (
      row.channelId ? candidate.id === row.channelId : candidate.ordinal === row.channelOrdinal
    ));
    if (channel && channel.purpose !== 'SPARE') {
      const load = channelLoadLabel(channel);
      if (!allocation.loads.includes(load)) allocation.loads.push(load);
    }
    byMeter.set(alias, allocation);
    measuredBy.set(nodeId, byMeter);
  }
  const measuredFromBoard = new Map<string, string[]>();
  for (const edge of report.measurementEdges) {
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    const boardName = nodeNames.get(edge.sourceNodeId);
    if (!boardName) continue;
    const entries = measuredFromBoard.get(edge.targetNodeId) ?? [];
    if (!entries.includes(boardName)) entries.push(boardName);
    measuredFromBoard.set(edge.targetNodeId, entries);
  }

  const markers = new Map<string, VisualMarker>();
  for (const node of report.electricalNodes) {
    const meters = metersByBoard.get(node.id) ?? [];
    const dimensions = markerDimensions(node, meters.length);
    const zone = node.physicalLocationId ? zoneNames.get(node.physicalLocationId) ?? '' : '';
    let subtitle = [node.typeLabel, zone].filter(Boolean).join(' · ');
    if (node.kind === 'GRID') subtitle = 'Incoming electrical supply';
    if (node.kind === 'SITE_ASSET') {
      subtitle = [node.typeLabel ? `Load · ${node.typeLabel}` : 'Electrical load', zone]
        .filter(Boolean)
        .join(' · ');
    }
    if (node.kind === 'VIRTUAL_RESIDUAL') {
      const parentName = node.parentNodeId ? nodeNames.get(node.parentNodeId) : undefined;
      subtitle = parentName ? `Calculated on ${parentName}` : 'Calculated residual load';
    }
    const measurementRows = measuredBy.get(node.id);
    let measurement = '';
    if (measurementRows?.size) {
      measurement = [...measurementRows.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([meterAlias, allocation]) => {
          const channels = compactChannelLabel(allocation.ordinals);
          const loads = allocation.loads.join(' / ');
          return [meterAlias, channels, loads].filter(Boolean).join(' · ');
        })
        .join(' / ');
    } else if (measuredFromBoard.has(node.id)) {
      measurement = `Metered from ${measuredFromBoard.get(node.id)!.join(', ')}`;
    } else if (node.kind === 'SITE_ASSET') {
      measurement = 'No confirmed meter';
    }
    markers.set(node.id, {
      node,
      ...dimensions,
      icon: assetIcon(node),
      title: node.name || node.displayCode || node.id,
      subtitle,
      measurement,
      meters,
    });
  }
  return markers;
}

function nodeKindRank(node: DiagramNode): number {
  if (node.kind === 'GRID') return 0;
  if (node.kind === 'BOARD') return 1;
  if (node.kind === 'SITE_ASSET') return 2;
  if (node.kind === 'VIRTUAL_RESIDUAL') return 3;
  return 4;
}

function stableNodeOrder(left: DiagramNode, right: DiagramNode): number {
  return nodeKindRank(left) - nodeKindRank(right)
    || (left.displayCode || left.name).localeCompare(right.displayCode || right.name)
    || left.id.localeCompare(right.id);
}

function radialHierarchy(
  report: InstallHubCanonicalReport,
  depths: Map<string, number>,
): { parentById: Map<string, string>; childrenById: Map<string, string[]> } {
  const nodeById = new Map(report.electricalNodes.map((node) => [node.id, node]));
  const depthOf = (nodeId: string) => depths.get(nodeId) ?? 1;
  const candidatesById = new Map<string, string[]>();
  const addCandidate = (childId: string, parentId: string) => {
    if (!nodeById.has(childId) || !nodeById.has(parentId) || childId === parentId) return;
    const entries = candidatesById.get(childId) ?? [];
    if (!entries.includes(parentId)) entries.push(parentId);
    candidatesById.set(childId, entries);
  };
  for (const edge of report.supplyEdges.slice().sort((left, right) => (
    left.targetNodeId.localeCompare(right.targetNodeId)
      || left.sourceNodeId.localeCompare(right.sourceNodeId)
  ))) addCandidate(edge.targetNodeId, edge.sourceNodeId);
  for (const node of report.electricalNodes) {
    if (node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId) addCandidate(node.id, node.parentNodeId);
  }

  const parentById = new Map<string, string>();
  const childrenById = new Map<string, string[]>();
  for (const node of report.electricalNodes.slice().sort(stableNodeOrder)) {
    const candidates = (candidatesById.get(node.id) ?? []).slice().sort((left, right) => (
      depthOf(left) - depthOf(right) || left.localeCompare(right)
    ));
    const parentId = candidates.find((candidate) => depthOf(candidate) === depthOf(node.id) - 1)
      ?? candidates.find((candidate) => depthOf(candidate) < depthOf(node.id));
    if (!parentId) continue;
    parentById.set(node.id, parentId);
    const entries = childrenById.get(parentId) ?? [];
    entries.push(node.id);
    childrenById.set(parentId, entries);
  }
  for (const children of childrenById.values()) {
    children.sort((left, right) => stableNodeOrder(nodeById.get(left)!, nodeById.get(right)!));
  }
  return { parentById, childrenById };
}

function partitionRadialSector(
  nodeIds: string[],
  start: number,
  end: number,
  weightOf: (nodeId: string) => number,
): Array<{ nodeId: string; start: number; end: number }> {
  if (!nodeIds.length) return [];
  if (nodeIds.length === 1) return [{ nodeId: nodeIds[0], start, end }];
  const span = Math.max(0.01, end - start);
  const gap = Math.min(RADIAL_BRANCH_GAP, span / (nodeIds.length * 5));
  const usable = Math.max(span * 0.55, span - gap * (nodeIds.length - 1));
  const totalWeight = nodeIds.reduce((total, nodeId) => total + weightOf(nodeId), 0);
  let cursor = start;
  return nodeIds.map((nodeId, index) => {
    const itemSpan = index === nodeIds.length - 1
      ? end - cursor
      : usable * (weightOf(nodeId) / Math.max(0.001, totalWeight));
    const sector = { nodeId, start: cursor, end: Math.min(end, cursor + itemSpan) };
    cursor = sector.end + gap;
    return sector;
  });
}

function markerBoxAt(
  marker: VisualMarker,
  radius: number,
  angle: number,
): DiagramPosition {
  const cx = radius * Math.cos(angle) * RADIAL_X_SCALE;
  const cy = radius * Math.sin(angle) * RADIAL_Y_SCALE;
  return {
    cx,
    cy,
    x: cx - marker.width / 2,
    y: cy - marker.height / 2,
    width: marker.width,
    height: marker.height,
    depth: 0,
    radius,
    angle,
    branchId: '',
  };
}

function markerBoxesOverlap(left: DiagramPosition, right: DiagramPosition): boolean {
  return left.x - RADIAL_COLLISION_MARGIN < right.x + right.width
    && left.x + left.width + RADIAL_COLLISION_MARGIN > right.x
    && left.y - RADIAL_COLLISION_MARGIN < right.y + right.height
    && left.y + left.height + RADIAL_COLLISION_MARGIN > right.y;
}

function buildRadialLayout(
  report: InstallHubCanonicalReport,
  markers: Map<string, VisualMarker>,
  depths: Map<string, number>,
): LayoutResult {
  const nodeById = new Map(report.electricalNodes.map((node) => [node.id, node]));
  const { parentById, childrenById } = radialHierarchy(report, depths);
  const subtreeWeightCache = new Map<string, number>();
  const subtreeWeight = (nodeId: string): number => {
    const cached = subtreeWeightCache.get(nodeId);
    if (cached !== undefined) return cached;
    const marker = markers.get(nodeId)!;
    const ownWeight = Math.max(1, marker.width / 150) + marker.meters.length * 0.42;
    subtreeWeightCache.set(nodeId, ownWeight);
    const value = ownWeight + (childrenById.get(nodeId) ?? [])
      .reduce((total, childId) => total + subtreeWeight(childId), 0);
    subtreeWeightCache.set(nodeId, value);
    return value;
  };

  const grids = report.electricalNodes
    .filter((node) => node.kind === 'GRID')
    .sort(stableNodeOrder);
  const roots = report.electricalNodes
    .filter((node) => node.kind !== 'GRID' && (
      !parentById.has(node.id)
        || nodeById.get(parentById.get(node.id)!)?.kind === 'GRID'
    ))
    .sort((left, right) => subtreeWeight(right.id) - subtreeWeight(left.id) || stableNodeOrder(left, right));

  const rootWeights = roots.map((root) => subtreeWeight(root.id));
  const rootGap = roots.length > 1
    ? Math.min(RADIAL_BRANCH_GAP, RADIAL_USABLE_SPAN / (roots.length * 5))
    : 0;
  const rootUsableSpan = Math.max(
    RADIAL_USABLE_SPAN * 0.55,
    RADIAL_USABLE_SPAN - rootGap * Math.max(0, roots.length - 1),
  );
  const rootWeightTotal = rootWeights.reduce((total, value) => total + value, 0);
  const rootSpans = rootWeights.map((weight) => (
    rootUsableSpan * (weight / Math.max(0.001, rootWeightTotal))
  ));
  const rootSectors = new Map<string, { start: number; end: number; index: number }>();
  if (roots.length) {
    let leftBoundary = -Math.PI / 2 - rootSpans[0] / 2;
    let rightBoundary = -Math.PI / 2 + rootSpans[0] / 2;
    rootSectors.set(roots[0].id, { start: leftBoundary, end: rightBoundary, index: 0 });
    for (let index = 1; index < roots.length; index += 1) {
      if (index % 2 === 1) {
        const start = rightBoundary + rootGap;
        const end = start + rootSpans[index];
        rootSectors.set(roots[index].id, { start, end, index });
        rightBoundary = end;
      } else {
        const end = leftBoundary - rootGap;
        const start = end - rootSpans[index];
        rootSectors.set(roots[index].id, { start, end, index });
        leftBoundary = start;
      }
    }
  }

  const plans: PlannedMarker[] = [];
  const planned = new Set<string>();
  const planSubtree = (
    nodeId: string,
    parentId: string | undefined,
    branchId: string,
    depth: number,
    start: number,
    end: number,
    parentRadius: number,
  ) => {
    if (planned.has(nodeId)) return;
    planned.add(nodeId);
    const marker = markers.get(nodeId)!;
    const span = Math.max(0.025, end - start);
    const angleBias = parentId && (childrenById.get(parentId)?.length ?? 0) === 1
      ? (depth % 2 === 0 ? -1 : 1) * Math.min(Math.PI / 18, span * 0.07)
      : 0;
    const angle = (start + end) / 2 + angleBias;
    const arcRadius = (marker.width + RADIAL_COLLISION_MARGIN * 2) / span;
    const minimumRadius = Math.max(
      RADIAL_INNER_RADIUS + Math.max(0, depth - 1) * RADIAL_RING_GAP,
      parentRadius + (parentId ? RADIAL_RING_GAP : 0),
      arcRadius,
    );
    plans.push({
      nodeId,
      parentId,
      branchId,
      depth,
      angle,
      minimumRadius,
      sectorStart: start,
      sectorEnd: end,
    });
    const children = childrenById.get(nodeId) ?? [];
    for (const childSector of partitionRadialSector(children, start, end, subtreeWeight)) {
      planSubtree(
        childSector.nodeId,
        nodeId,
        branchId,
        depth + 1,
        childSector.start,
        childSector.end,
        minimumRadius,
      );
    }
  };

  for (const root of roots) {
    const sector = rootSectors.get(root.id)!;
    planSubtree(root.id, parentById.get(root.id), root.id, 1, sector.start, sector.end, 0);
  }
  // A malformed Draft graph may leave a node outside the selected radial forest.
  // Give every such node its own stable sector rather than dropping it.
  const unplanned = report.electricalNodes
    .filter((node) => node.kind !== 'GRID' && !planned.has(node.id))
    .sort(stableNodeOrder);
  unplanned.forEach((node, index) => {
    const center = -Math.PI / 2 + ((index + 1) * Math.PI * 2) / Math.max(2, unplanned.length + 1);
    planSubtree(node.id, undefined, node.id, 1, center - 0.18, center + 0.18, 0);
  });

  const relativePositions = new Map<string, DiagramPosition>();
  grids.forEach((grid, index) => {
    const marker = markers.get(grid.id)!;
    const radius = index === 0 ? 0 : 150 + Math.floor((index - 1) / 6) * 110;
    const angle = index === 0 ? 0 : -Math.PI / 2 + ((index - 1) * Math.PI * 2) / Math.max(1, grids.length - 1);
    relativePositions.set(grid.id, {
      ...markerBoxAt(marker, radius, angle),
      depth: 0,
      branchId: grid.id,
    });
  });

  const placed: DiagramPosition[] = [...relativePositions.values()];
  for (const plan of plans.slice().sort((left, right) => (
    left.depth - right.depth
      || left.branchId.localeCompare(right.branchId)
      || left.angle - right.angle
      || left.nodeId.localeCompare(right.nodeId)
  ))) {
    const marker = markers.get(plan.nodeId)!;
    const parent = plan.parentId ? relativePositions.get(plan.parentId) : undefined;
    let radius = Math.max(
      plan.minimumRadius,
      parent ? parent.radius + RADIAL_RING_GAP : 0,
    );
    let candidate = markerBoxAt(marker, radius, plan.angle);
    let step = 0;
    while (placed.some((position) => markerBoxesOverlap(candidate, position))
      && step < RADIAL_MAX_COLLISION_STEPS) {
      radius += RADIAL_COLLISION_STEP;
      candidate = markerBoxAt(marker, radius, plan.angle);
      step += 1;
    }
    const position = {
      ...candidate,
      depth: plan.depth,
      radius,
      angle: plan.angle,
      branchId: plan.branchId,
    };
    relativePositions.set(plan.nodeId, position);
    placed.push(position);
  }

  const horizontalExtent = Math.max(
    MIN_BODY_HALF_WIDTH,
    ...[...relativePositions.values()].map((position) => Math.max(
      Math.abs(position.x),
      Math.abs(position.x + position.width),
    ) + MARGIN_X),
  );
  const verticalExtent = Math.max(
    MIN_BODY_HALF_HEIGHT,
    ...[...relativePositions.values()].map((position) => Math.max(
      Math.abs(position.y),
      Math.abs(position.y + position.height),
    ) + 34),
  );
  const width = Math.max(MIN_DIAGRAM_WIDTH, Math.ceil(horizontalExtent * 2));
  const bodyHeight = Math.ceil(verticalExtent * 2);
  const centerX = width / 2;
  const centerY = HEADER_HEIGHT + verticalExtent;
  const positions = new Map<string, DiagramPosition>();
  for (const [nodeId, position] of relativePositions) {
    positions.set(nodeId, {
      ...position,
      cx: position.cx + centerX,
      cy: position.cy + centerY,
      x: position.x + centerX,
      y: position.y + centerY,
    });
  }
  const sectors: RadialSector[] = roots.map((root) => {
    const sector = rootSectors.get(root.id)!;
    return {
      branchId: root.id,
      start: sector.start,
      end: sector.end,
      index: sector.index,
      maxRadius: Math.max(
        RADIAL_INNER_RADIUS,
        ...[...positions.values()]
          .filter((position) => position.branchId === root.id)
          .map((position) => position.radius),
      ),
    };
  });
  return {
    source: 'auto',
    positions,
    parentById,
    sectors,
    bodyTop: HEADER_HEIGHT,
    bodyHeight,
    centerX,
    centerY,
    width,
  };
}

function applySavedElectricalMapLayout(
  automatic: LayoutResult,
  report: InstallHubCanonicalReport,
  markers: Map<string, VisualMarker>,
  saved: ElectricalMapLayoutDocument | undefined,
): LayoutResult | null {
  if (!saved || !electricalMapLayoutMatchesNodeIds(
    saved,
    report.electricalNodes.map((node) => node.id),
  )) return null;

  const savedById = new Map(saved.nodes.map((node) => [node.nodeId, node]));
  const rawPositions = new Map<string, DiagramPosition>();
  const referenceGrid = report.electricalNodes.find((node) => node.kind === 'GRID');
  const referencePoint = referenceGrid ? savedById.get(referenceGrid.id) : saved.nodes[0];
  if (!referencePoint) return null;

  for (const node of report.electricalNodes) {
    const point = savedById.get(node.id);
    const marker = markers.get(node.id);
    const automaticPosition = automatic.positions.get(node.id);
    if (!point || !marker || !automaticPosition) return null;
    const dx = point.centerX - referencePoint.centerX;
    const dy = point.centerY - referencePoint.centerY;
    rawPositions.set(node.id, {
      cx: point.centerX,
      cy: point.centerY,
      x: point.centerX - marker.width / 2,
      y: point.centerY - marker.height / 2,
      width: marker.width,
      height: marker.height,
      depth: automaticPosition.depth,
      radius: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx),
      branchId: automaticPosition.branchId,
    });
  }

  // The design canvas is an editing boundary, not printable content. Crop the
  // report image to the arranged markers so unused workspace does not shrink
  // the client-facing overview, while preserving every relative coordinate.
  const rawMinX = Math.min(...[...rawPositions.values()].map((position) => position.x));
  const rawMaxX = Math.max(
    ...[...rawPositions.values()].map((position) => position.x + position.width),
  );
  const rawMinY = Math.min(...[...rawPositions.values()].map((position) => position.y));
  const rawMaxY = Math.max(
    ...[...rawPositions.values()].map((position) => position.y + position.height),
  );
  const compositionWidth = rawMaxX - rawMinX;
  const compositionHeight = rawMaxY - rawMinY;
  const width = Math.max(MIN_DIAGRAM_WIDTH, Math.ceil(compositionWidth + MARGIN_X * 2));
  const bodyHeight = Math.max(MIN_BODY_HALF_HEIGHT * 2, Math.ceil(compositionHeight + 68));
  const offsetX = (width - compositionWidth) / 2 - rawMinX;
  const offsetY = HEADER_HEIGHT + 34 - rawMinY;
  const positions = new Map<string, DiagramPosition>();
  for (const [nodeId, position] of rawPositions) {
    positions.set(nodeId, {
      ...position,
      cx: position.cx + offsetX,
      cy: position.cy + offsetY,
      x: position.x + offsetX,
      y: position.y + offsetY,
    });
  }
  const translatedReference = positions.get(referenceGrid?.id ?? saved.nodes[0].nodeId);
  return {
    source: 'saved',
    positions,
    parentById: automatic.parentById,
    sectors: [],
    bodyTop: HEADER_HEIGHT,
    bodyHeight,
    centerX: translatedReference?.cx ?? width / 2,
    centerY: translatedReference?.cy ?? HEADER_HEIGHT + bodyHeight / 2,
    width,
  };
}

function medallionRadius(node: DiagramNode): number {
  if (node.kind === 'GRID') return GRID_MEDALLION_RADIUS;
  if (node.kind === 'BOARD') return BOARD_MEDALLION_RADIUS;
  if (node.kind === 'VIRTUAL_RESIDUAL') return RESIDUAL_MEDALLION_RADIUS;
  return ASSET_MEDALLION_RADIUS;
}

function medallionCenter(position: DiagramPosition, node: DiagramNode): RoutePoint {
  const radius = medallionRadius(node);
  return {
    x: position.x + position.width / 2,
    y: position.y + radius + 5,
  };
}

function routeStraightEdge(
  source: DiagramPosition,
  target: DiagramPosition,
  sourceNode: DiagramNode,
  targetNode: DiagramNode,
): { path: string; samples: RoutePoint[] } {
  const sourceCenter = medallionCenter(source, sourceNode);
  const targetCenter = medallionCenter(target, targetNode);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const sourceRadius = medallionRadius(sourceNode);
  const targetRadius = medallionRadius(targetNode);
  const separated = distance > sourceRadius + targetRadius;
  const sourceOffset = separated ? sourceRadius : distance / 2;
  const targetOffset = separated ? targetRadius : distance / 2;
  const start = {
    x: sourceCenter.x + ux * sourceOffset,
    y: sourceCenter.y + uy * sourceOffset,
  };
  const end = {
    x: targetCenter.x - ux * targetOffset,
    y: targetCenter.y - uy * targetOffset,
  };
  return {
    path: `M${start.x.toFixed(1)} ${start.y.toFixed(1)} L${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    samples: [start, end],
  };
}

function svgText(
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    weight?: number;
    letterSpacing?: number;
    anchor?: 'start' | 'middle' | 'end';
  } = {},
): string {
  if (!value) return '';
  return `<text x="${x}" y="${y}" fill="${options.color ?? '#0F172A'}" font-size="${options.size ?? 10}" font-weight="${options.weight ?? 500}"${options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : ''}${options.anchor ? ` text-anchor="${options.anchor}"` : ''}>${escapeXml(value)}</text>`;
}

function electricalMapIconDefs(): string {
  return `<defs>${ELECTRICAL_MAP_ICON_NAMES.map((name) => (
    `<symbol id="electrical-map-icon-${name}" viewBox="0 0 256 256"><image width="256" height="256" href="${electricalMapIconDataUri(name)}" preserveAspectRatio="xMidYMid meet"/></symbol>`
  )).join('')}</defs>`;
}

function svgIcon(name: ElectricalMapIconName, x: number, y: number, size: number): string {
  const scale = electricalMapIconScale(name);
  const renderedSize = Number((size * scale).toFixed(2));
  const offset = Number(((renderedSize - size) / 2).toFixed(2));
  const renderedX = Number((x - offset).toFixed(2));
  const renderedY = Number((y - offset).toFixed(2));
  return `<use data-electrical-map-icon="${name}" data-icon-box-size="${size}" data-icon-scale="${scale}" href="#electrical-map-icon-${name}" x="${renderedX}" y="${renderedY}" width="${renderedSize}" height="${renderedSize}"/>`;
}

function wrapText(value: string, maxWidth: number, fontSize: number, weight: number): string[] {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return [];
  if (textWidth(compact, fontSize, weight) <= maxWidth) return [compact];
  const words = compact.split(' ');
  let first = '';
  let consumed = 0;
  for (const word of words) {
    const candidate = first ? `${first} ${word}` : word;
    if (textWidth(candidate, fontSize, weight) > maxWidth) break;
    first = candidate;
    consumed += 1;
  }
  if (!first) return [fitText(compact, maxWidth, fontSize, weight)];
  const remainder = words.slice(consumed).join(' ');
  return [first, fitText(remainder, maxWidth, fontSize, weight)].filter(Boolean);
}

function renderMeterSatellites(marker: VisualMarker, position: DiagramPosition): string {
  if (!marker.meters.length) return '';
  const columnWidth = BOARD_MARKER_WIDTH / METER_SATELLITE_COLUMNS;
  return marker.meters.map((satellite, index) => {
    const column = index % METER_SATELLITE_COLUMNS;
    const row = Math.floor(index / METER_SATELLITE_COLUMNS);
    const x = position.x + column * columnWidth + 4;
    const y = position.y + BOARD_MARKER_BASE_HEIGHT + row * METER_SATELLITE_ROW_HEIGHT + 3;
    return `<g data-meter-satellite="${escapeXml(satellite.meter.id)}" data-meter-alias="${escapeXml(satellite.alias)}" data-meter-channel-summary="${escapeXml(satellite.channelSummary)}" data-meter-load-summary="${escapeXml(satellite.loadSummary)}">
      <circle cx="${x + 12}" cy="${y + 12}" r="11" fill="#FFFFFF" stroke="#4D9B68" stroke-width="1.3"/>
      ${svgIcon('node-meter', x + 3, y + 3, 18)}
      ${svgText(fitText(`${satellite.alias} ${satellite.meter.model}`, columnWidth - 31, 6.8, 800), x + 27, y + 10, { size: 6.8, weight: 800, color: '#14532D' })}
      ${svgText(fitText(satellite.channelSummary, columnWidth - 31, 6.2, 600), x + 27, y + 20, { size: 6.2, weight: 600, color: '#475569' })}
    </g>`;
  }).join('');
}

function renderVisualMarker(marker: VisualMarker, position: DiagramPosition): string {
  const { node } = marker;
  const colors = nodeColors(node);
  const radius = medallionRadius(node);
  const iconSize = node.kind === 'GRID' ? 156 : node.kind === 'BOARD' ? 124 : 100;
  const centerX = position.x + position.width / 2;
  const centerY = position.y + radius + 5;
  const kindY = centerY + radius + 13;
  const titleLines = wrapText(marker.title, position.width - 10, 10.6, 800).slice(0, 2);
  const titleMarkup = titleLines.map((line, index) => svgText(
    line,
    centerX,
    kindY + 15 + index * 12,
    { size: 10.6, weight: 800, color: '#0F172A', anchor: 'middle' },
  )).join('');
  const titleBottom = kindY + 15 + Math.max(0, titleLines.length - 1) * 12;
  const subtitleY = titleBottom + 13;
  const coverage = coveragePresentation(node.coverageState);
  const pillWidth = coverage ? Math.max(42, Math.round(textWidth(coverage.label, 6.6, 800) + 14)) : 0;
  const coverageMarkup = coverage
    ? `<rect x="${centerX + radius - pillWidth * 0.6}" y="${position.y + 2}" width="${pillWidth}" height="15" rx="7.5" fill="${coverage.fill}" stroke="#FFFFFF" stroke-width="1"/>${svgText(coverage.label, centerX + radius - pillWidth * 0.1, position.y + 12.5, { size: 6.6, weight: 800, color: coverage.text, anchor: 'middle' })}`
    : '';
  const measurementLabel = fitText(marker.measurement, position.width - 26, 7.1, 600);
  const measurementWidth = textWidth(measurementLabel, 7.1, 600);
  const measurementX = centerX - Math.min(position.width - 12, measurementWidth + 16) / 2;
  const measurementMarkup = measurementLabel
    ? `<g data-measurement-chip="${escapeXml(node.id)}">
        ${svgIcon('node-meter', measurementX, subtitleY + 3, 12)}
        ${svgText(measurementLabel, measurementX + 16, subtitleY + 13, { size: 7.1, weight: 600, color: marker.measurement === 'No confirmed meter' ? '#92400E' : '#166534' })}
      </g>`
    : '';
  return `<g data-visual-marker="1" data-node-kind="${escapeXml(node.kind)}" data-node-id="${escapeXml(node.id)}" data-layout-depth="${position.depth}" data-layout-x="${position.x.toFixed(1)}" data-layout-y="${position.y.toFixed(1)}" data-layout-cx="${position.cx.toFixed(1)}" data-layout-cy="${position.cy.toFixed(1)}" data-layout-radius="${position.radius.toFixed(1)}" data-layout-angle="${position.angle.toFixed(5)}" data-branch-id="${escapeXml(position.branchId)}" data-marker-width="${position.width}" data-marker-height="${position.height}">
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="#FFFFFF" stroke="${colors.stroke}" stroke-width="2.4"${node.kind === 'VIRTUAL_RESIDUAL' ? ' stroke-dasharray="6 4"' : ''}/>
      <circle cx="${centerX}" cy="${centerY}" r="${Math.max(10, radius - 5)}" fill="${colors.fill}" opacity="0.82"/>
      ${svgIcon(marker.icon, centerX - iconSize / 2, centerY - iconSize / 2, iconSize)}
      ${coverageMarkup}
      ${svgText(nodeKindLabel(node.kind), centerX, kindY, { size: 6.8, weight: 800, color: colors.accent, letterSpacing: 0.65, anchor: 'middle' })}
      ${titleMarkup}
      ${svgText(fitText(marker.subtitle, position.width - 14, 7.3, 500), centerX, subtitleY, { size: 7.3, weight: 500, color: '#64748B', anchor: 'middle' })}
      ${measurementMarkup}
      ${renderMeterSatellites(marker, position)}
    </g>`;
}

const LEGEND_COVERAGE: Array<[string, string, string]> = [
  ['DIRECT', '#DCFCE7', '#166534'],
  ['VIRTUAL', '#DBEAFE', '#1D4ED8'],
  ['UNMETERED', '#FEF3C7', '#92400E'],
  ['TBC', '#FDE68A', '#854D0E'],
  ['ISSUE', '#FEE2E2', '#B91C1C'],
];

function renderLegend(width: number, height: number): string {
  const top = height - LEGEND_HEIGHT;
  const labelX = MARGIN_X;
  const itemX = MARGIN_X + 92;
  const connectionsY = top + 30;
  const coverageY = top + 62;
  let coverageX = itemX;
  const coveragePills = LEGEND_COVERAGE.map(([label, fill, text]) => {
    const pillWidth = Math.round(textWidth(label, 7.4, 800) + 16);
    const pill = `<rect x="${coverageX}" y="${coverageY - 11}" width="${pillWidth}" height="16" rx="8" fill="${fill}"/>${svgText(label, coverageX + pillWidth / 2, coverageY, { size: 7.4, weight: 800, color: text, anchor: 'middle' })}`;
    coverageX += pillWidth + 7;
    return pill;
  }).join('');
  return `<g data-diagram-key="1">
    <line x1="${MARGIN_X}" y1="${top + 6}" x2="${width - MARGIN_X}" y2="${top + 6}" stroke="#E2E8F0" stroke-width="1.5"/>
    ${svgText('HOW TO READ', labelX, connectionsY, { size: 8, weight: 800, color: '#1E3A8A', letterSpacing: 0.6 })}
    <line x1="${itemX}" y1="${connectionsY - 5}" x2="${itemX + 34}" y2="${connectionsY - 5}" stroke="#B87333" stroke-width="3.5" stroke-linecap="round"/>${svgText('Supplied from', itemX + 42, connectionsY, { size: 8.6, weight: 600, color: '#334155' })}
    ${svgIcon('node-meter', itemX + 145, connectionsY - 17, 21)}${svgText('Meter / channel / load', itemX + 171, connectionsY, { size: 8.6, weight: 600, color: '#334155' })}
    <line x1="${itemX + 357}" y1="${connectionsY - 5}" x2="${itemX + 391}" y2="${connectionsY - 5}" stroke="#64748B" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>${svgText('Calculated residual', itemX + 400, connectionsY, { size: 8.6, weight: 600, color: '#334155' })}
    ${svgText('METERING COVERAGE', labelX, coverageY, { size: 8, weight: 800, color: '#1E3A8A', letterSpacing: 0.6 })}${coveragePills}
  </g>`;
}

function ellipticalPoint(layout: LayoutResult, radius: number, angle: number): RoutePoint {
  return {
    x: layout.centerX + radius * Math.cos(angle) * RADIAL_X_SCALE,
    y: layout.centerY + radius * Math.sin(angle) * RADIAL_Y_SCALE,
  };
}

function renderBranchHalos(layout: LayoutResult): string {
  if (layout.source === 'saved') {
    return `<rect data-saved-layout-backdrop="1" x="${MARGIN_X}" y="${layout.bodyTop}" width="${layout.width - MARGIN_X * 2}" height="${layout.bodyHeight}" rx="36" fill="#F8FAFC" opacity="0.58"/>`;
  }
  if (layout.sectors.length === 1) {
    const radius = layout.sectors[0].maxRadius + 48;
    return `<ellipse data-radial-backdrop="1" cx="${layout.centerX}" cy="${layout.centerY}" rx="${(radius * RADIAL_X_SCALE).toFixed(1)}" ry="${(radius * RADIAL_Y_SCALE).toFixed(1)}" fill="#F8FAFC" opacity="0.58"/>`;
  }
  return layout.sectors.map((sector) => {
    const innerRadius = 125;
    const outerRadius = sector.maxRadius + 52;
    const innerStart = ellipticalPoint(layout, innerRadius, sector.start);
    const outerStart = ellipticalPoint(layout, outerRadius, sector.start);
    const outerEnd = ellipticalPoint(layout, outerRadius, sector.end);
    const innerEnd = ellipticalPoint(layout, innerRadius, sector.end);
    const largeArc = sector.end - sector.start > Math.PI ? 1 : 0;
    const fill = sector.index % 2 === 0 ? '#F8FAFC' : '#F3F8FF';
    return `<path data-branch-halo="${escapeXml(sector.branchId)}" d="M${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)} L${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)} A${(outerRadius * RADIAL_X_SCALE).toFixed(1)} ${(outerRadius * RADIAL_Y_SCALE).toFixed(1)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)} L${innerEnd.x.toFixed(1)} ${innerEnd.y.toFixed(1)} A${(innerRadius * RADIAL_X_SCALE).toFixed(1)} ${(innerRadius * RADIAL_Y_SCALE).toFixed(1)} 0 ${largeArc} 0 ${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)} Z" fill="${fill}" opacity="0.52"/>`;
  }).join('');
}

function headerSummary(report: InstallHubCanonicalReport): string {
  const boards = report.electricalNodes.filter((node) => node.kind === 'BOARD').length;
  const assets = report.electricalNodes.filter((node) => node.kind === 'SITE_ASSET').length;
  const residuals = report.electricalNodes.filter((node) => node.kind === 'VIRTUAL_RESIDUAL').length;
  const channels = report.meters.reduce((total, meter) => total + meter.channels.length, 0);
  const plural = (count: number, singular: string, suffix = 's') => (
    `${count} ${singular}${count === 1 ? '' : suffix}`
  );
  return [
    plural(boards, 'switchboard'),
    plural(report.meters.length, 'meter'),
    plural(channels, 'channel'),
    plural(assets, 'connected load'),
    residuals ? plural(residuals, 'residual') : '',
  ].filter(Boolean).join('  -  ');
}

export function buildElectricalMapSvg(
  inputReport: InstallHubCanonicalReport,
  siteName: string,
): string {
  const clientNodeIds = clientElectricalMapNodeIds({
    nodes: inputReport.electricalNodes,
    edges: [...inputReport.supplyEdges, ...inputReport.measurementEdges],
    unresolved: inputReport.unresolvedRelationships,
  });
  const report: InstallHubCanonicalReport = {
    ...inputReport,
    electricalNodes: inputReport.electricalNodes.filter((node) => clientNodeIds.has(node.id)),
    supplyEdges: inputReport.supplyEdges.filter((edge) => (
      clientNodeIds.has(edge.sourceNodeId) && clientNodeIds.has(edge.targetNodeId)
    )),
    measurementEdges: inputReport.measurementEdges.filter((edge) => (
      clientNodeIds.has(edge.sourceNodeId) && clientNodeIds.has(edge.targetNodeId)
    )),
    meters: inputReport.meters.filter((meter) => clientNodeIds.has(meter.installedOnBoardId)),
  };
  const depths = diagramDepths(report);
  const markers = buildVisualMarkers(report);
  const nodeById = new Map(report.electricalNodes.map((node) => [node.id, node]));
  const residualEdges = report.electricalNodes.flatMap((node) => (
    node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId
      ? [{ sourceNodeId: node.parentNodeId, targetNodeId: node.id }]
      : []
  ));
  const automaticLayout = buildRadialLayout(report, markers, depths);
  const layout = applySavedElectricalMapLayout(
    automaticLayout,
    report,
    markers,
    report.electricalMapLayout,
  ) ?? automaticLayout;
  const height = layout.bodyTop + layout.bodyHeight + BODY_BOTTOM_PADDING + LEGEND_HEIGHT;
  const width = layout.width;

  const connector = (
    sourceNodeId: string,
    targetNodeId: string,
    relationship: 'supply' | 'residual',
  ): string => {
    const source = layout.positions.get(sourceNodeId);
    const target = layout.positions.get(targetNodeId);
    const sourceNode = nodeById.get(sourceNodeId);
    const targetNode = nodeById.get(targetNodeId);
    if (!source || !target || !sourceNode || !targetNode || sourceNodeId === targetNodeId) return '';
    const route = routeStraightEdge(source, target, sourceNode, targetNode);
    const stroke = relationship === 'supply'
      ? ' stroke="#B87333" stroke-width="3.5"'
      : ' stroke="#64748B" stroke-width="2.3" stroke-dasharray="2 7"';
    return `<path data-${relationship}-source="${escapeXml(sourceNodeId)}" data-${relationship}-target="${escapeXml(targetNodeId)}" data-connector-style="straight" data-route-points="${routePointsAttribute(route.samples)}" d="${route.path}" fill="none"${stroke} stroke-linecap="round"/>`;
  };

  const supplyLines = report.supplyEdges
    .map((edge) => connector(edge.sourceNodeId, edge.targetNodeId, 'supply'))
    .join('');
  const residualLines = residualEdges
    .map((edge) => connector(edge.sourceNodeId, edge.targetNodeId, 'residual'))
    .join('');
  const nodes = report.electricalNodes.map((node) => renderVisualMarker(
    markers.get(node.id)!,
    layout.positions.get(node.id)!,
  )).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Electrical map for ${escapeXml(siteName)}" data-layout-source="${layout.source}" font-family="Arial, Helvetica, sans-serif">
    ${electricalMapIconDefs()}
    <rect width="${width}" height="${height}" fill="#FFFFFF"/>
    ${svgText(fitText(siteName, width - MARGIN_X * 2 - 380, 22, 900), MARGIN_X, 31, { size: 22, weight: 900, color: '#142F70' })}
    ${svgText('Electrical site overview', MARGIN_X, 53, { size: 12, weight: 500, color: '#64748B' })}
    ${svgText(headerSummary(report), width - MARGIN_X, 31, { size: 10.5, weight: 700, color: '#1E3A8A', anchor: 'end' })}
    ${svgText('Confirmed infrastructure - every switchboard, meter and connected load is represented', width - MARGIN_X, 50, { size: 9, weight: 500, color: '#94A3B8', anchor: 'end' })}
    ${renderBranchHalos(layout)}
    ${supplyLines}${residualLines}${nodes}
    ${renderLegend(width, height)}
  </svg>`;
}

export async function renderElectricalMapPngDataUri(
  report: InstallHubCanonicalReport,
  siteName: string,
): Promise<string> {
  return (await renderElectricalMapImages(report, siteName)).overviewDataUri;
}

export async function renderElectricalMapImages(
  report: InstallHubCanonicalReport,
  siteName: string,
): Promise<InstallHubElectricalMapImages> {
  const svg = buildElectricalMapSvg(report, siteName);
  const source = svgSourceDimensions(svg);
  const plan = planElectricalMapRender(source.width, source.height);
  const overviewSvg = rewriteSvgViewport(
    svg,
    plan.overviewWidth,
    plan.overviewHeight,
    `0 0 ${plan.sourceWidth} ${plan.sourceHeight}`,
  );
  const overview = await sharp(Buffer.from(overviewSvg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  const overviewDataUri = `data:image/png;base64,${overview.toString('base64')}`;
  const detailTiles: InstallHubElectricalMapImages['detailTiles'] = [];
  // Render one bounded viewBox at a time. This keeps peak Sharp allocation
  // independent of the supported installation size and avoids Promise fan-out.
  for (const window of plan.windows) {
    const tileSvg = rewriteSvgViewport(
      svg,
      window.width,
      window.height,
      `${window.left} ${window.top} ${window.width} ${window.height}`,
    );
    const data = await sharp(Buffer.from(tileSvg))
      .png({ compressionLevel: 9 })
      .toBuffer();
    detailTiles.push({
      dataUri: `data:image/png;base64,${data.toString('base64')}`,
      ...window,
    });
  }
  return {
    overviewDataUri,
    sourceWidth: plan.sourceWidth,
    sourceHeight: plan.sourceHeight,
    overviewWidth: plan.overviewWidth,
    overviewHeight: plan.overviewHeight,
    totalDetailWindows: plan.totalDetailWindows,
    omittedDetailWindows: plan.omittedDetailWindows,
    detailTiles,
  };
}
