import sharp from 'sharp';
import {
  pdfEquipmentIconMarkup,
  type PdfEquipmentIconName,
} from '../../pdf/equipmentIcons.js';
import type {
  InstallHubCanonicalReport,
  InstallHubElectricalMapImages,
} from './reportHtml.js';

const NODE_WIDTH = 224;
const NODE_HEIGHT = 116;
const COLUMN_GAP = 78;
const ROW_GAP = 26;
const MARGIN_X = 42;
const HEADER_HEIGHT = 76;
const LEGEND_HEIGHT = 66;
const DENSE_TERMINAL_MAX_ROWS = 5;
const DENSE_COLUMN_GAP = 32;
const SELF_LOOP_DROP = 16;
export const ELECTRICAL_MAP_DETAIL_THRESHOLD_PX = 1_400;
export const ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX = 1_080;
export const ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX = 140;
export const ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX = 720;
export const ELECTRICAL_MAP_DETAIL_TILE_VERTICAL_OVERLAP_PX = 96;
export const ELECTRICAL_MAP_MAX_DETAIL_PAGES = 24;
export const ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX = 3_600;
export const ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX = 2_400;
export const ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX = 5_000_000;

type DiagramNode = InstallHubCanonicalReport['electricalNodes'][number];
type DiagramPosition = {
  x: number;
  y: number;
  depth: number;
  lane: number;
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

function routePath(points: RoutePoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
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

function assetIcon(node: DiagramNode): PdfEquipmentIconName {
  if (node.kind === 'BOARD') return 'switchboard';
  if (node.kind === 'GRID' || node.kind === 'VIRTUAL_RESIDUAL') return 'electricity';
  const value = `${node.typeLabel ?? ''} ${node.name}`.toUpperCase();
  if (/HVAC|AIR\s*CON|REFRIG|CHILL|FREEZ|COOL/.test(value)) return 'hvac';
  if (/LIGHT/.test(value)) return 'lighting';
  if (/SOLAR|\bPV\b/.test(value)) return 'solar';
  if (/EV|CHARG|FORKLIFT|BATTER|OUTLET|PLUG/.test(value)) return 'charger';
  if (/HOT\s*WATER|HEAT|GEYSER/.test(value)) return 'hot-water';
  if (/WATER/.test(value)) return 'water';
  return 'electricity';
}

function nodeColors(node: DiagramNode): { fill: string; stroke: string; accent: string } {
  if (node.kind === 'GRID') return { fill: '#F8FAFC', stroke: '#64748B', accent: '#334155' };
  if (node.kind === 'BOARD') return { fill: '#EFF6FF', stroke: '#1D4ED8', accent: '#1E3A8A' };
  if (node.kind === 'VIRTUAL_RESIDUAL') return { fill: '#F8FAFC', stroke: '#94A3B8', accent: '#475569' };
  return { fill: '#F0FDF4', stroke: '#4D9B68', accent: '#166534' };
}

function targetNodeId(target: unknown): string | null {
  if (!target || typeof target !== 'object') return null;
  const value = target as Record<string, unknown>;
  if (value.kind === 'BOARD') return typeof value.boardId === 'string' ? value.boardId : null;
  if (value.kind === 'SITE_ASSET') return typeof value.siteAssetId === 'string' ? value.siteAssetId : null;
  if (value.kind === 'GRID_BOUNDARY') return typeof value.gridSupplyId === 'string' ? value.gridSupplyId : null;
  return null;
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

export function buildElectricalMapSvg(
  report: InstallHubCanonicalReport,
  siteName: string,
): string {
  const depths = diagramDepths(report);
  const columns = new Map<number, DiagramNode[]>();
  for (const node of report.electricalNodes) {
    const depth = depths.get(node.id) ?? 1;
    const items = columns.get(depth) ?? [];
    items.push(node);
    columns.set(depth, items);
  }
  const firstSupplyParent = new Map<string, string>();
  for (const edge of report.supplyEdges
    .slice()
    .sort((left, right) => left.sourceNodeId.localeCompare(right.sourceNodeId)
      || left.targetNodeId.localeCompare(right.targetNodeId))) {
    if (!firstSupplyParent.has(edge.targetNodeId)) {
      firstSupplyParent.set(edge.targetNodeId, edge.sourceNodeId);
    }
  }
  for (const items of columns.values()) {
    items.sort((left, right) => left.kind.localeCompare(right.kind)
      || (firstSupplyParent.get(left.id) ?? '').localeCompare(firstSupplyParent.get(right.id) ?? '')
      || left.id.localeCompare(right.id));
  }
  const maxDepth = Math.max(0, ...columns.keys());
  const outgoingSupply = new Set(report.supplyEdges.map((edge) => edge.sourceNodeId));
  for (const node of report.electricalNodes) {
    if (node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId) outgoingSupply.add(node.parentNodeId);
  }
  const presentationColumns: Array<{
    depth: number;
    lane: number;
    items: DiagramNode[];
  }> = [];
  for (const [depth, items] of [...columns.entries()].sort(([left], [right]) => left - right)) {
    const balanceTerminalColumn = depth === maxDepth
      && items.length > DENSE_TERMINAL_MAX_ROWS
      && items.every((node) => !outgoingSupply.has(node.id));
    const laneCount = balanceTerminalColumn
      ? Math.ceil(items.length / DENSE_TERMINAL_MAX_ROWS)
      : 1;
    const rowsPerLane = Math.ceil(items.length / laneCount);
    for (let lane = 0; lane < laneCount; lane += 1) {
      presentationColumns.push({
        depth,
        lane,
        items: items.slice(lane * rowsPerLane, (lane + 1) * rowsPerLane),
      });
    }
  }
  const maxRows = Math.max(1, ...presentationColumns.map((column) => column.items.length));
  const furthestX = Math.max(MARGIN_X, ...presentationColumns.map(({ depth, lane }) => (
    MARGIN_X
      + depth * (NODE_WIDTH + COLUMN_GAP)
      + lane * (NODE_WIDTH + DENSE_COLUMN_GAP)
  )));
  const width = Math.max(760, furthestX + NODE_WIDTH + MARGIN_X);
  const bodyHeight = maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;
  const height = HEADER_HEIGHT + bodyHeight + LEGEND_HEIGHT + 28;
  const positions = new Map<string, DiagramPosition>();
  for (const { depth, lane, items } of presentationColumns) {
    const columnHeight = items.length * NODE_HEIGHT + Math.max(0, items.length - 1) * ROW_GAP;
    const startY = lane > 0
      ? HEADER_HEIGHT
      : HEADER_HEIGHT + Math.max(0, (bodyHeight - columnHeight) / 2);
    items.forEach((node, index) => {
      positions.set(node.id, {
        x: MARGIN_X
          + depth * (NODE_WIDTH + COLUMN_GAP)
          + lane * (NODE_WIDTH + DENSE_COLUMN_GAP),
        y: startY + index * (NODE_HEIGHT + ROW_GAP),
        depth,
        lane,
      });
    });
  }

  const supplyLines = report.supplyEdges.map((edge) => {
    const source = positions.get(edge.sourceNodeId);
    const target = positions.get(edge.targetNodeId);
    if (!source || !target) return '';
    const sourcePoint = { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 };
    const points: RoutePoint[] = target.lane > 0
      ? (() => {
          const laneZeroX = target.x - target.lane * (NODE_WIDTH + DENSE_COLUMN_GAP);
          const busX = laneZeroX - COLUMN_GAP / 2;
          const gapY = target.y + NODE_HEIGHT + ROW_GAP * .34;
          const targetX = target.x + NODE_WIDTH * .5;
          return [
            sourcePoint,
            { x: busX, y: sourcePoint.y },
            { x: busX, y: gapY },
            { x: targetX, y: gapY },
            { x: targetX, y: target.y + NODE_HEIGHT },
          ];
        })()
      : (() => {
          const targetPoint = { x: target.x, y: target.y + NODE_HEIGHT / 2 };
          const mid = sourcePoint.x + (targetPoint.x - sourcePoint.x) / 2;
          return [
            sourcePoint,
            { x: mid, y: sourcePoint.y },
            { x: mid, y: targetPoint.y },
            targetPoint,
          ];
        })();
    return `<path data-supply-source="${escapeXml(edge.sourceNodeId)}" data-supply-target="${escapeXml(edge.targetNodeId)}" data-route-points="${routePointsAttribute(points)}" d="${routePath(points)}" fill="none" stroke="#B87333" stroke-width="4" stroke-linejoin="round"/>`;
  }).join('');
  const measurementLines = report.measurementEdges.map((edge) => {
    const source = positions.get(edge.sourceNodeId);
    const target = positions.get(edge.targetNodeId);
    if (!source || !target) return '';
    if (edge.sourceNodeId === edge.targetNodeId) {
      const bottom = source.y + NODE_HEIGHT;
      const startX = source.x + NODE_WIDTH * .72;
      const endX = source.x + NODE_WIDTH * .28;
      return `<path data-measurement-self-loop="${escapeXml(edge.sourceNodeId)}" d="M${startX} ${bottom} C${startX} ${bottom + SELF_LOOP_DROP},${endX} ${bottom + SELF_LOOP_DROP},${endX} ${bottom}" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-dasharray="10 7"/>`;
    }
    const sourcePoint = { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT * .72 };
    const points: RoutePoint[] = target.lane > 0
      ? (() => {
          const laneZeroX = target.x - target.lane * (NODE_WIDTH + DENSE_COLUMN_GAP);
          const busX = laneZeroX - COLUMN_GAP * .28;
          const gapY = target.y + NODE_HEIGHT + ROW_GAP * .7;
          const targetX = target.x + NODE_WIDTH * .72;
          return [
            sourcePoint,
            { x: busX, y: sourcePoint.y },
            { x: busX, y: gapY },
            { x: targetX, y: gapY },
            { x: targetX, y: target.y + NODE_HEIGHT },
          ];
        })()
      : (() => {
          const targetPoint = { x: target.x, y: target.y + NODE_HEIGHT * .72 };
          const mid = sourcePoint.x + (targetPoint.x - sourcePoint.x) / 2 + 8;
          return [
            sourcePoint,
            { x: mid, y: sourcePoint.y },
            { x: mid, y: targetPoint.y },
            targetPoint,
          ];
        })();
    return `<path data-measurement-source="${escapeXml(edge.sourceNodeId)}" data-measurement-target="${escapeXml(edge.targetNodeId)}" data-route-points="${routePointsAttribute(points)}" d="${routePath(points)}" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-dasharray="10 7" stroke-linejoin="round"/>`;
  }).join('');
  const residualLines = report.electricalNodes.flatMap((node) => {
    if (node.kind !== 'VIRTUAL_RESIDUAL' || !node.parentNodeId) return [];
    const source = positions.get(node.parentNodeId);
    const target = positions.get(node.id);
    if (!source || !target) return [];
    return [`<path d="M${source.x + NODE_WIDTH} ${source.y + NODE_HEIGHT / 2} H${target.x}" fill="none" stroke="#64748B" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>`];
  }).join('');

  const zoneNames = new Map(report.physicalLocations.map((zone) => [zone.id, zone.name]));
  const metersByBoard = new Map<string, InstallHubCanonicalReport['meters']>();
  for (const meter of report.meters) {
    const entries = metersByBoard.get(meter.installedOnBoardId) ?? [];
    entries.push(meter);
    metersByBoard.set(meter.installedOnBoardId, entries);
  }
  const nodes = report.electricalNodes.map((node) => {
    const position = positions.get(node.id)!;
    const colors = nodeColors(node);
    const icon = assetIcon(node);
    const meters = metersByBoard.get(node.id) ?? [];
    const subtitle = node.kind === 'BOARD' && meters.length
      ? truncate(meters.map((meter) => `${meter.name} - ${meter.model}`).join(', '), 43)
      : node.kind === 'SITE_ASSET'
        ? truncate(`${node.typeLabel ?? 'Load'} - ${node.coverageState ?? 'Unmetered'}`, 43)
        : node.kind === 'VIRTUAL_RESIDUAL'
          ? 'Calculated residual load'
          : 'Incoming electrical supply';
    const zone = node.physicalLocationId
      ? zoneNames.get(node.physicalLocationId) ?? ''
      : '';
    const meterModules = node.kind === 'BOARD' && meters.length
      ? meters.slice(0, 2).map((meter, meterIndex) => {
          const moduleWidth = meters.length > 1 ? 92 : 194;
          const x = position.x + 15 + meterIndex * 102;
          const channels = meter.channels
            .filter((channel) => channel.purpose !== 'SPARE')
            .map((channel) => channel.ordinal)
            .join(',');
          return `<g data-meter-module="${escapeXml(meter.id)}">
            <rect x="${x}" y="${position.y + 76}" width="${moduleWidth}" height="27" rx="6" fill="#DCFCE7" stroke="#4D9B68"/>
            <text x="${x + 7}" y="${position.y + 87}" fill="#166534" font-size="8.5" font-weight="800">${escapeXml(truncate(meter.name, meters.length > 1 ? 13 : 29))}</text>
            <text x="${x + 7}" y="${position.y + 98}" fill="#166534" font-size="7.5">${escapeXml(truncate(`${meter.model}${channels ? ` - Ch ${channels}` : ''}`, meters.length > 1 ? 15 : 32))}</text>
          </g>`;
        }).join('')
      : '';
    return `<g data-node-kind="${escapeXml(node.kind)}" data-node-id="${escapeXml(node.id)}" data-layout-depth="${depths.get(node.id) ?? 1}" data-layout-x="${position.x}" data-layout-y="${position.y}">
      <rect x="${position.x}" y="${position.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="13" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2"/>
      <circle cx="${position.x + 31}" cy="${position.y + 31}" r="19" fill="${colors.accent}"/>
      <svg x="${position.x + 19}" y="${position.y + 19}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pdfEquipmentIconMarkup(icon)}</svg>
      <text x="${position.x + 59}" y="${position.y + 22}" fill="${colors.accent}" font-size="10" font-weight="800" letter-spacing=".7">${escapeXml(node.kind.replaceAll('_', ' '))}</text>
      <text x="${position.x + 59}" y="${position.y + 43}" fill="#0F172A" font-size="13" font-weight="800">${escapeXml(truncate(node.displayCode || node.name, 27))}</text>
      <text x="${position.x + 15}" y="${position.y + 66}" fill="#334155" font-size="11" font-weight="600">${escapeXml(truncate(node.displayCode ? node.name : subtitle, 42))}</text>
      ${meterModules || `<text x="${position.x + 15}" y="${position.y + 88}" fill="#64748B" font-size="9.5">${escapeXml(truncate(node.displayCode ? [subtitle, zone].filter(Boolean).join(' - ') : zone, 47))}</text>`}
    </g>`;
  }).join('');

  const legendY = height - 39;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Electrical map for ${escapeXml(siteName)}">
    <rect width="${width}" height="${height}" fill="#FFFFFF"/>
    <text x="${MARGIN_X}" y="31" fill="#142F70" font-size="22" font-weight="900">${escapeXml(truncate(siteName, 72))}</text>
    <text x="${MARGIN_X}" y="53" fill="#64748B" font-size="12">Electrical supply, metering and connected loads</text>
    ${supplyLines}${measurementLines}${residualLines}${nodes}
    <line x1="${MARGIN_X}" y1="${legendY - 20}" x2="${width - MARGIN_X}" y2="${legendY - 20}" stroke="#E2E8F0"/>
    <g font-family="Arial, sans-serif" font-size="11" fill="#334155">
      <line x1="${MARGIN_X}" y1="${legendY}" x2="${MARGIN_X + 34}" y2="${legendY}" stroke="#B87333" stroke-width="4"/><text x="${MARGIN_X + 43}" y="${legendY + 4}">Electrical supply</text>
      <line x1="${MARGIN_X + 174}" y1="${legendY}" x2="${MARGIN_X + 208}" y2="${legendY}" stroke="#2563EB" stroke-width="2.5" stroke-dasharray="10 7"/><text x="${MARGIN_X + 217}" y="${legendY + 4}">Meter measures</text>
      <line x1="${MARGIN_X + 343}" y1="${legendY}" x2="${MARGIN_X + 377}" y2="${legendY}" stroke="#64748B" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/><text x="${MARGIN_X + 386}" y="${legendY + 4}">Calculated residual</text>
      <rect x="${MARGIN_X + 535}" y="${legendY - 10}" width="20" height="20" rx="5" fill="#EFF6FF" stroke="#1D4ED8"/><text x="${MARGIN_X + 564}" y="${legendY + 4}">Switchboard</text>
      <rect x="${MARGIN_X + 660}" y="${legendY - 10}" width="20" height="20" rx="5" fill="#F0FDF4" stroke="#4D9B68"/><text x="${MARGIN_X + 689}" y="${legendY + 4}">Load / asset</text>
    </g>
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
