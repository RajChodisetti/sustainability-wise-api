import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildElectricalMapSvg,
  ELECTRICAL_MAP_MAX_DETAIL_PAGES,
  ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX,
  ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX,
  ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX,
  ELECTRICAL_MAP_DETAIL_THRESHOLD_PX,
  ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX,
  ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX,
  ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX,
  ELECTRICAL_MAP_DETAIL_TILE_VERTICAL_OVERLAP_PX,
  planElectricalMapRender,
  renderElectricalMapImages,
  renderElectricalMapPngDataUri,
} from './electricalMapImage.js';
import type { InstallHubCanonicalReport } from './reportHtml.js';

function report(): InstallHubCanonicalReport {
  return {
    reportSource: 'canonical-version',
    treeRevision: 4,
    recordVersionNumber: 3,
    snapshotPayloadHash: 'snapshot-3',
    mappingContentHash: 'mapping-3',
    authoritative: true,
    readyToComplete: true,
    physicalLocations: [{ id: 'zone-1', name: 'Plant & workshop' }],
    electricalNodes: [
      { id: 'grid-1', kind: 'GRID', name: 'Incoming grid' },
      {
        id: 'board-1',
        kind: 'BOARD',
        name: 'Main <switchboard>',
        displayCode: 'SITE-MSB-001',
        typeLabel: 'Main Switchboard',
        physicalLocationId: 'zone-1',
      },
      {
        id: 'asset-1',
        kind: 'SITE_ASSET',
        name: 'Workshop HVAC',
        displayCode: 'SITE-HVAC-001',
        typeLabel: 'AC / HVAC',
        physicalLocationId: 'zone-1',
        coverageState: 'DIRECT',
      },
      {
        id: 'virtual-1',
        kind: 'VIRTUAL_RESIDUAL',
        name: 'Residual load',
        displayCode: 'VIRTUAL-1',
        parentNodeId: 'board-1',
      },
    ],
    supplyEdges: [
      { sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      { sourceNodeId: 'board-1', targetNodeId: 'asset-1', relationship: 'FED_FROM' },
    ],
    measurementEdges: [{
      sourceNodeId: 'board-1',
      targetNodeId: 'asset-1',
      relationship: 'MEASURES',
    }],
    meters: [{
      id: 'meter-1',
      installedOnBoardId: 'board-1',
      name: 'Plant meter',
      model: 'A6M',
      deviceNumber: 'DD123',
      serialNumber: 'SER123',
      channels: [
        {
          id: 'channel-1',
          ordinal: 1,
          purpose: 'SUB_CIRCUIT',
          phaseLabel: 'L1',
          sensorRating: '60A',
          load: 'AC / HVAC',
        },
        { id: 'channel-2', ordinal: 2, purpose: 'SPARE', load: 'Spare / not used' },
      ],
    }],
    unresolvedRelationships: [],
    assets: [],
    meteringRows: [{
      assignmentId: 'assignment-1',
      meterId: 'meter-1',
      channelId: 'channel-1',
      meterDisplayName: 'Plant meter',
      channelOrdinal: 1,
      channelPurpose: 'SUB_CIRCUIT',
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
      direction: 'CONSUMPTION',
      status: 'CONFIRMED',
    }],
    virtualMeterDefinitions: [],
    readinessIssues: [],
  };
}

function denseAssetReport(assetCount = 10): InstallHubCanonicalReport {
  const base = report();
  const assets: InstallHubCanonicalReport['electricalNodes'] = Array.from(
    { length: assetCount },
    (_, index) => ({
      id: `asset-${String(index + 1).padStart(2, '0')}`,
      kind: 'SITE_ASSET',
      name: `Essendon connected load ${index + 1}`,
      displayCode: `E-LOAD-${String(index + 1).padStart(2, '0')}`,
      typeLabel: index % 2 === 0 ? 'AC / HVAC' : 'Lighting',
      physicalLocationId: 'zone-1',
      coverageState: 'DIRECT',
    }),
  );
  return {
    ...base,
    electricalNodes: [base.electricalNodes[0], base.electricalNodes[1], ...assets],
    supplyEdges: [
      { sourceNodeId: 'grid-1', targetNodeId: 'board-1', relationship: 'FED_FROM' },
      ...assets.map((asset) => ({
        sourceNodeId: 'board-1',
        targetNodeId: asset.id,
        relationship: 'FED_FROM',
      })),
    ],
    measurementEdges: assets.map((asset) => ({
      sourceNodeId: 'board-1',
      targetNodeId: asset.id,
      relationship: 'MEASURES',
    })),
  };
}

function deepHierarchyReport(boardCount = 9): InstallHubCanonicalReport {
  const base = report();
  const boards: InstallHubCanonicalReport['electricalNodes'] = Array.from(
    { length: boardCount },
    (_, index) => ({
      id: `board-${index + 1}`,
      kind: 'BOARD',
      name: `Distribution board level ${index + 1}`,
      displayCode: `E-DEEP-DB-${String(index + 1).padStart(2, '0')}`,
      physicalLocationId: 'zone-1',
    }),
  );
  const deepAsset: InstallHubCanonicalReport['electricalNodes'][number] = {
    id: 'deep-asset',
    kind: 'SITE_ASSET',
    name: 'Deep hierarchy terminal load',
    displayCode: 'E-DEEP-LOAD-01',
    typeLabel: 'AC / HVAC',
    physicalLocationId: 'zone-1',
    coverageState: 'DIRECT',
  };
  return {
    ...base,
    electricalNodes: [base.electricalNodes[0], ...boards, deepAsset],
    supplyEdges: [
      { sourceNodeId: 'grid-1', targetNodeId: boards[0].id, relationship: 'FED_FROM' },
      ...boards.slice(1).map((board, index) => ({
        sourceNodeId: boards[index].id,
        targetNodeId: board.id,
        relationship: 'FED_FROM',
      })),
      {
        sourceNodeId: boards.at(-1)!.id,
        targetNodeId: deepAsset.id,
        relationship: 'FED_FROM',
      },
    ],
    measurementEdges: [{
      sourceNodeId: boards.at(-1)!.id,
      targetNodeId: deepAsset.id,
      relationship: 'MEASURES',
    }],
  };
}

function tallMultiBoardReport(boardCount = 12): InstallHubCanonicalReport {
  const base = report();
  const mainBoard: InstallHubCanonicalReport['electricalNodes'][number] = {
    id: 'main-board',
    kind: 'BOARD',
    name: 'Main Switchboard',
    displayCode: 'E-TALL-MSB-01',
    physicalLocationId: 'zone-1',
  };
  const boards: InstallHubCanonicalReport['electricalNodes'] = Array.from(
    { length: boardCount },
    (_, index) => ({
      id: `branch-board-${index + 1}`,
      kind: 'BOARD',
      name: `Branch distribution board ${index + 1}`,
      displayCode: `E-TALL-DB-${String(index + 1).padStart(2, '0')}`,
      physicalLocationId: 'zone-1',
    }),
  );
  const assets: InstallHubCanonicalReport['electricalNodes'] = boards.map((_, index) => ({
    id: `branch-load-${index + 1}`,
    kind: 'SITE_ASSET',
    name: `Branch connected load ${index + 1}`,
    displayCode: `E-TALL-LOAD-${String(index + 1).padStart(2, '0')}`,
    typeLabel: index % 2 ? 'Lighting' : 'AC / HVAC',
    physicalLocationId: 'zone-1',
    coverageState: 'DIRECT',
  }));
  return {
    ...base,
    electricalNodes: [base.electricalNodes[0], mainBoard, ...boards, ...assets],
    supplyEdges: [
      { sourceNodeId: 'grid-1', targetNodeId: mainBoard.id, relationship: 'FED_FROM' },
      ...boards.map((board) => ({
        sourceNodeId: mainBoard.id,
        targetNodeId: board.id,
        relationship: 'FED_FROM',
      })),
      ...assets.map((asset, index) => ({
        sourceNodeId: boards[index].id,
        targetNodeId: asset.id,
        relationship: 'FED_FROM',
      })),
    ],
    measurementEdges: assets.map((asset, index) => ({
      sourceNodeId: boards[index].id,
      targetNodeId: asset.id,
      relationship: 'MEASURES',
    })),
  };
}

function largeSupportedReport(assetCount = 125): InstallHubCanonicalReport {
  return tallMultiBoardReport(assetCount);
}

type MarkerPlacement = {
  kind: string;
  id: string;
  depth: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  radius: number;
  angle: number;
  branchId: string;
  width: number;
  height: number;
};

function markerPlacements(svg: string): MarkerPlacement[] {
  return [...svg.matchAll(
    /<g data-visual-marker="1" data-node-kind="([^"]+)" data-node-id="([^"]+)" data-layout-depth="(\d+)" data-layout-x="([\d.-]+)" data-layout-y="([\d.-]+)" data-layout-cx="([\d.-]+)" data-layout-cy="([\d.-]+)" data-layout-radius="([\d.-]+)" data-layout-angle="([\d.-]+)" data-branch-id="([^"]+)" data-marker-width="([\d.-]+)" data-marker-height="([\d.-]+)"/g,
  )].map((match) => ({
    kind: match[1],
    id: match[2],
    depth: Number(match[3]),
    x: Number(match[4]),
    y: Number(match[5]),
    cx: Number(match[6]),
    cy: Number(match[7]),
    radius: Number(match[8]),
    angle: Number(match[9]),
    branchId: match[10],
    width: Number(match[11]),
    height: Number(match[12]),
  }));
}

function assertMarkersDoNotOverlap(svg: string): void {
  const markers = markerPlacements(svg);
  assert.ok(markers.length > 0);
  for (let leftIndex = 0; leftIndex < markers.length; leftIndex += 1) {
    const left = markers[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < markers.length; rightIndex += 1) {
      const right = markers[rightIndex];
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
      assert.equal(overlaps, false, `${left.id} overlaps ${right.id}`);
    }
  }
}

function crowdedBoardReport(): InstallHubCanonicalReport {
  const base = report();
  return {
    ...base,
    meters: Array.from({ length: 4 }, (_, meterIndex) => ({
      id: `meter-${meterIndex + 1}`,
      installedOnBoardId: 'board-1',
      name: `E-BASEMENT-0${meterIndex + 1}-MSB-DISTRIBUTION-METER`,
      model: meterIndex % 2 ? 'A6M' : 'A3RM',
      serialNumber: `DD4371014872${meterIndex}`,
      channels: Array.from({ length: 6 }, (_, channelIndex) => ({
        ordinal: channelIndex + 1,
        purpose: channelIndex === 5 ? 'SPARE' : 'SUB_CIRCUIT',
        load: channelIndex === 5 ? '' : 'HVAC',
        ...(channelIndex === 5 ? {} : { description: `Rooftop packaged unit ${channelIndex + 1}` }),
      })),
    })),
  };
}

function crossColumnMeasurementReport(): InstallHubCanonicalReport {
  const base = tallMultiBoardReport(6);
  return {
    ...base,
    measurementEdges: [
      ...base.measurementEdges,
      // A meter on the main board measuring a load two columns downstream.
      { sourceNodeId: 'main-board', targetNodeId: 'branch-load-1', relationship: 'MEASURES' },
      { sourceNodeId: 'main-board', targetNodeId: 'branch-load-6', relationship: 'MEASURES' },
      // A downstream board measuring back up to its own supply.
      { sourceNodeId: 'branch-board-3', targetNodeId: 'main-board', relationship: 'MEASURES' },
    ],
  };
}

test('switchboards present every installed meter as a concise visual satellite', () => {
  const crowded = crowdedBoardReport();
  const svg = buildElectricalMapSvg(crowded, 'Complete device schedule');
  for (const meter of crowded.meters) {
    assert.match(svg, new RegExp(`data-meter-satellite="${meter.id}"`));
    assert.ok(svg.includes(meter.model), `${meter.model} must appear beside its meter symbol`);
  }
  assert.equal(
    (svg.match(/data-meter-satellite=/g) ?? []).length,
    crowded.meters.length,
    'every installed meter receives one satellite',
  );
  assert.doesNotMatch(svg, /data-meter-module=/);
  assert.doesNotMatch(svg, /Rooftop packaged unit|DD4371014872/);
  assert.match(svg, /1 switchboard {2}- {2}4 meters {2}- {2}24 channels {2}- {2}1 connected load/);
  assertMarkersDoNotOverlap(svg);
});

test('compact visual markers do not overlap across representative topologies', () => {
  for (const [label, input] of [
    ['essendon dense', denseAssetReport(10)],
    ['deep hierarchy', deepHierarchyReport()],
    ['tall hierarchy', tallMultiBoardReport(6)],
    ['crowded switchboard', crowdedBoardReport()],
  ] as const) {
    assert.doesNotThrow(
      () => assertMarkersDoNotOverlap(buildElectricalMapSvg(input, `${label} site`)),
      `${label} must keep every marker footprint clear`,
    );
  }
});

test('electrical supply uses straight clipped copper paths and measurement stays local', () => {
  for (const input of [
    deepHierarchyReport(),
    tallMultiBoardReport(6),
    crossColumnMeasurementReport(),
    crowdedBoardReport(),
  ]) {
    const svg = buildElectricalMapSvg(input, 'Routing site');
    const supplyPaths = [...svg.matchAll(/<path data-supply-source="[^"]+"[^>]* d="([^"]+)"/g)];
    assert.ok(supplyPaths.length > 0);
    assert.ok(supplyPaths.every((match) => /^M[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+$/.test(match[1])));
    assert.match(svg, /data-connector-style="straight"/);
    assert.doesNotMatch(svg, /data-supply-source="[^"]+"[^>]* d="[^"]+ C/);
    assert.doesNotMatch(svg, /data-measurement-source=|data-measurement-self-loop=/);
    assert.doesNotMatch(svg, /stroke="#2563EB"[^>]*stroke-dasharray/);
  }
});

test('the compact key explains supply, local metering, residuals and coverage', () => {
  const svg = buildElectricalMapSvg(report(), 'Legend site');
  for (const label of [
    'HOW TO READ',
    'Supplied from',
    'Meter / channel / load',
    'Calculated residual',
    'METERING COVERAGE',
    'DIRECT',
    'UNMETERED',
    'ISSUE',
  ]) {
    assert.ok(svg.includes(label), `the diagram key must name ${label}`);
  }
  assert.doesNotMatch(svg, /NODE SYMBOLS|LOAD SYMBOLS|Meter measures/);
  assert.match(svg, /data-node-kind="SITE_ASSET"[\s\S]{0,1500}?fill="#DCFCE7"/);
});

test('electrical map SVG is deterministic, centered and visually explains every item', () => {
  const first = buildElectricalMapSvg(report(), 'Example & Sons');
  assert.equal(buildElectricalMapSvg(report(), 'Example & Sons'), first);
  assert.match(first, /data-layout-source="auto"/);
  assert.match(first, /Example &amp; Sons/);
  assert.match(first, /Main &lt;switchboard&gt;/);
  assert.match(first, /data-node-kind="GRID"/);
  assert.match(first, /data-node-kind="BOARD"/);
  assert.match(first, /data-node-kind="SITE_ASSET"/);
  assert.match(first, /data-electrical-map-icon="node-grid"/);
  assert.match(first, /data-electrical-map-icon="board-msb"/);
  assert.match(first, /data-electrical-map-icon="load-hvac"/);
  assert.match(first, /data-electrical-map-icon="node-residual"/);
  assert.match(first, /<symbol id="electrical-map-icon-load-power-outlet"/);
  assert.doesNotMatch(first, /data-electrical-map-icon-frame/);
  assert.match(first, /data-visual-marker="1"/);
  assert.match(first, /data-meter-satellite="meter-1"/);
  assert.match(first, /data-meter-channel-summary="Ch 1 · AC \/ HVAC"/);
  assert.match(first, /data-meter-load-summary="AC \/ HVAC"/);
  assert.match(first, /data-measurement-chip="asset-1"/);
  assert.match(first, /CONNECTED LOAD/);
  assert.match(first, /Load · AC \/ HVAC/);
  assert.match(first, /stroke="#B87333" stroke-width="3.5"/);
  assert.match(first, /data-supply-source="grid-1"[^>]*d="M[^"]+ L/);
  assert.doesNotMatch(first, /data-meter-module=|data-measurement-source=|data-measurement-self-loop=/);
  assert.doesNotMatch(first, /stroke="#2563EB"[^>]*stroke-dasharray/);
  assert.match(first, /stroke="#64748B"[^>]*stroke-dasharray="2 7"/);
  assert.match(first, /Supplied from/);
  assert.match(first, /Calculated residual/);
  const dimensions = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(first);
  assert.ok(dimensions);
  const grid = markerPlacements(first).find((marker) => marker.id === 'grid-1');
  assert.ok(grid);
  assert.ok(Math.abs(grid.cx - Number(dimensions[1]) / 2) <= 1);
  assert.ok(grid.cy > Number(dimensions[2]) * 0.4 && grid.cy < Number(dimensions[2]) * 0.6);
  assert.equal(markerPlacements(first).length, report().electricalNodes.length);
  assertMarkersDoNotOverlap(first);
  assert.doesNotMatch(first, /<script/i);
});

test('TBC assignments are not presented as confirmed map allocations', () => {
  const pending = report();
  pending.meteringRows[0].status = 'TBC';
  pending.measurementEdges = pending.measurementEdges.filter((edge) => edge.targetNodeId !== 'asset-1');
  const svg = buildElectricalMapSvg(pending, 'Pending assignment');
  assert.match(svg, /data-measurement-chip="asset-1"[\s\S]{0,500}?No confirmed meter/);
  assert.doesNotMatch(svg, /data-measurement-chip="asset-1"[\s\S]{0,500}?M1 · Ch 1 · AC \/ HVAC/);
});

test('saved client coordinates drive the exact PDF map arrangement', () => {
  const saved = report();
  saved.electricalMapLayout = {
    version: 1,
    canvas: { width: 1_400, height: 820 },
    nodes: [
      { nodeId: 'asset-1', centerX: 1_060, centerY: 220 },
      { nodeId: 'board-1', centerX: 700, centerY: 410 },
      { nodeId: 'grid-1', centerX: 260, centerY: 410 },
      { nodeId: 'virtual-1', centerX: 1_060, centerY: 620 },
    ],
  };
  const svg = buildElectricalMapSvg(saved, 'Saved arrangement');
  const positions = new Map(markerPlacements(svg).map((marker) => [marker.id, marker]));
  assert.match(svg, /data-layout-source="saved"/);
  assert.match(svg, /data-saved-layout-backdrop="1"/);
  assert.equal(positions.get('board-1')!.cx - positions.get('grid-1')!.cx, 440);
  assert.equal(positions.get('asset-1')!.cx - positions.get('board-1')!.cx, 360);
  assert.equal(positions.get('virtual-1')!.cy - positions.get('asset-1')!.cy, 400);
  assert.match(svg, /data-meter-satellite="meter-1"/);
  assert.match(svg, /data-measurement-chip="asset-1"/);
  assert.match(svg, /data-supply-source="grid-1"[^>]*d="M[^"]+ L/);
  const dimensions = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
  assert.ok(dimensions);
  assert.ok(Number(dimensions[1]) < saved.electricalMapLayout.canvas.width + 120);
  assert.ok(Number(dimensions[2]) < saved.electricalMapLayout.canvas.height + 350);
});

test('an incomplete saved layout falls back wholly to deterministic auto-arrangement', () => {
  const stale = report();
  stale.electricalMapLayout = {
    version: 1,
    canvas: { width: 1_200, height: 800 },
    nodes: [{ nodeId: 'grid-1', centerX: 200, centerY: 400 }],
  };
  const first = buildElectricalMapSvg(stale, 'Stale arrangement');
  const second = buildElectricalMapSvg(stale, 'Stale arrangement');
  assert.equal(second, first);
  assert.match(first, /data-layout-source="auto"/);
  assert.doesNotMatch(first, /data-saved-layout-backdrop/);
});

test('saved PDF arrangements use the same confirmed client node set as the portal', () => {
  const saved = report();
  saved.electricalNodes.push({
    id: 'invalid-asset',
    kind: 'SITE_ASSET',
    name: 'Broken legacy load',
    typeCode: 'OTHER',
    coverageState: 'INVALID',
  });
  saved.supplyEdges.push({
    sourceNodeId: 'board-1',
    targetNodeId: 'invalid-asset',
    relationship: 'FED_FROM',
  });
  saved.unresolvedRelationships.push({
    id: 'unresolved-invalid-asset',
    subjectType: 'SITE_ASSET',
    subjectId: 'invalid-asset',
    relation: 'SUPPLY',
    missingEnd: 'TARGET',
    reason: 'INVALID',
  });
  saved.electricalMapLayout = {
    version: 1,
    canvas: { width: 1_400, height: 820 },
    nodes: [
      { nodeId: 'asset-1', centerX: 1_060, centerY: 220 },
      { nodeId: 'board-1', centerX: 700, centerY: 410 },
      { nodeId: 'grid-1', centerX: 260, centerY: 410 },
      { nodeId: 'virtual-1', centerX: 1_060, centerY: 620 },
    ],
  };

  const svg = buildElectricalMapSvg(saved, 'Confirmed client map');
  assert.match(svg, /data-layout-source="saved"/);
  assert.doesNotMatch(svg, /data-node-id="invalid-asset"/);
  assert.equal(markerPlacements(svg).length, saved.electricalMapLayout.nodes.length);
});

test('electrical map rasterizes to a deterministic PNG data URI', async () => {
  const first = await renderElectricalMapPngDataUri(report(), 'Example site');
  const second = await renderElectricalMapPngDataUri(report(), 'Example site');
  assert.equal(second, first);
  assert.match(first, /^data:image\/png;base64,iVBOR/);
});

test('deep hierarchies retain one overview and add overlapping bounded-width detail tiles', async () => {
  const deep = await renderElectricalMapImages(deepHierarchyReport(), 'Deep hierarchy');
  assert.ok(
    deep.sourceWidth > ELECTRICAL_MAP_DETAIL_THRESHOLD_PX
      || deep.sourceHeight > ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX,
  );
  assert.ok(deep.detailTiles.length > 1);
  assert.match(deep.overviewDataUri, /^data:image\/png;base64,iVBOR/);
  assert.equal(deep.detailTiles[0].left, 0);
  assert.equal(deep.totalDetailWindows, deep.detailTiles.length);
  assert.equal(deep.omittedDetailWindows, 0);
  const rowCount = deep.detailTiles[0].rowCount;
  const columnCount = deep.detailTiles[0].columnCount;
  assert.ok(rowCount > 1 || columnCount > 1);
  for (const tile of deep.detailTiles) {
    assert.ok(tile.width <= ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX);
    assert.ok(tile.height <= ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX);
    assert.match(tile.dataUri, /^data:image\/png;base64,iVBOR/);
    assert.equal(tile.rowCount, rowCount);
    assert.equal(tile.columnCount, columnCount);
  }
});

test('tall nonterminal board hierarchies produce deterministic bounded 2D detail windows', async () => {
  const tall = await renderElectricalMapImages(tallMultiBoardReport(12), 'Tall hierarchy');
  assert.ok(tall.detailTiles.length > 1);
  const rowCount = tall.detailTiles[0].rowCount;
  const columnCount = tall.detailTiles[0].columnCount;
  assert.ok(rowCount > 1, 'tall hierarchy should be split into overlapping rows');
  assert.ok(columnCount > 1, 'wide branches should retain overlapping columns');
  assert.equal(tall.detailTiles.length, rowCount * columnCount);
  assert.equal(tall.omittedDetailWindows, 0);
  assert.equal(new Set(tall.detailTiles.map((tile) => tile.row)).size, rowCount);
  assert.equal(new Set(tall.detailTiles.map((tile) => tile.column)).size, columnCount);
  for (const tile of tall.detailTiles) {
    assert.ok(tile.width <= ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX);
    assert.ok(tile.height <= ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX);
    assert.ok(tile.top > 0);
    assert.ok(tile.left >= 0);
    assert.match(tile.dataUri, /^data:image\/png;base64,iVBOR/);
  }
  for (let row = 1; row <= rowCount; row += 1) {
    const rowTiles = tall.detailTiles.filter((tile) => tile.row === row);
    for (let index = 1; index < rowTiles.length; index += 1) {
      assert.ok(
        rowTiles[index - 1].left + rowTiles[index - 1].width - rowTiles[index].left
          >= ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX,
      );
    }
  }
  for (let column = 1; column <= columnCount; column += 1) {
    const columnTiles = tall.detailTiles.filter((tile) => tile.column === column);
    for (let index = 1; index < columnTiles.length; index += 1) {
      assert.ok(
        columnTiles[index - 1].top + columnTiles[index - 1].height - columnTiles[index].top
          >= ELECTRICAL_MAP_DETAIL_TILE_VERTICAL_OVERLAP_PX,
      );
    }
  }
});

test('large supported maps cap pages and bound overview allocation before rasterization', async () => {
  const purePlan = planElectricalMapRender(7_500, 18_000);
  assert.equal(purePlan.windows.length, ELECTRICAL_MAP_MAX_DETAIL_PAGES);
  assert.ok(purePlan.omittedDetailWindows > 0);
  assert.ok(purePlan.overviewWidth <= ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX);
  assert.ok(purePlan.overviewHeight <= ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX);
  assert.ok(purePlan.overviewWidth * purePlan.overviewHeight <= ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX);
  assert.equal(purePlan.windows[0].windowIndex, 1);
  assert.equal(purePlan.windows.at(-1)!.windowIndex, purePlan.totalDetailWindows);

  const large = await renderElectricalMapImages(largeSupportedReport(), 'Large supported site');
  assert.equal(large.detailTiles.length, ELECTRICAL_MAP_MAX_DETAIL_PAGES);
  assert.ok(large.omittedDetailWindows > 0);
  assert.equal(
    large.detailTiles.length + large.omittedDetailWindows,
    large.totalDetailWindows,
  );
  assert.ok(large.overviewWidth <= ELECTRICAL_MAP_OVERVIEW_MAX_WIDTH_PX);
  assert.ok(large.overviewHeight <= ELECTRICAL_MAP_OVERVIEW_MAX_HEIGHT_PX);
  assert.ok(large.overviewWidth * large.overviewHeight <= ELECTRICAL_MAP_OVERVIEW_MAX_AREA_PX);
  const overviewBuffer = Buffer.from(large.overviewDataUri.split(',')[1], 'base64');
  const metadata = await sharp(overviewBuffer).metadata();
  assert.equal(metadata.width, large.overviewWidth);
  assert.equal(metadata.height, large.overviewHeight);
  for (const tile of large.detailTiles) {
    assert.ok(tile.width <= ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX);
    assert.ok(tile.height <= ELECTRICAL_MAP_DETAIL_TILE_MAX_HEIGHT_PX);
    assert.equal(tile.windowCount, large.totalDetailWindows);
  }
});

test('dense Essendon-scale loads occupy a balanced multi-quadrant radial composition', () => {
  for (const assetCount of [8, 10] as const) {
    const svg = buildElectricalMapSvg(denseAssetReport(assetCount), 'Essendon Electric Map');
    const dimensions = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
    assert.ok(dimensions);
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    assert.ok(width > height, 'dense radial overview should retain a landscape footprint');
    const markers = markerPlacements(svg);
    const grid = markers.find((marker) => marker.kind === 'GRID');
    const assets = markers.filter((marker) => marker.kind === 'SITE_ASSET');
    assert.ok(grid);
    assert.equal(assets.length, assetCount);
    assert.deepEqual(new Set(assets.map((marker) => marker.depth)), new Set([2]));
    const quadrants = new Set(assets.map((marker) => (
      `${marker.cx < grid.cx ? 'L' : 'R'}${marker.cy < grid.cy ? 'T' : 'B'}`
    )));
    assert.ok(quadrants.size >= 3, `radial overview used only ${quadrants.size} quadrants`);
    for (const asset of assets) assert.ok(asset.radius > grid.radius);
    assert.equal(
      (svg.match(/stroke="#B87333" stroke-width="3.5"/g) ?? []).length,
      assetCount + 2,
    );
    assertMarkersDoNotOverlap(svg);
  }
});

test('cycle-safe depths stay bounded for a reachable Draft supply cycle', () => {
  const cyclic = report();
  cyclic.supplyEdges.push({
    sourceNodeId: 'asset-1',
    targetNodeId: 'board-1',
    relationship: 'FED_FROM',
  });
  const svg = buildElectricalMapSvg(cyclic, 'Draft diagnostic');
  assert.match(svg, /data-node-id="grid-1"[^>]*data-layout-depth="0"/);
  assert.match(svg, /data-node-id="board-1"[^>]*data-layout-depth="1"/);
  assert.match(svg, /data-node-id="asset-1"[^>]*data-layout-depth="2"/);
  const dimensions = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
  assert.ok(dimensions);
  assert.ok(Number(dimensions[1]) < 2_000);
  assert.ok(Number(dimensions[2]) < 1_500);
});

test('main-supply self measurement stays local without a diagram loop', () => {
  const selfMeasured = report();
  selfMeasured.measurementEdges.push({
    sourceNodeId: 'board-1',
    targetNodeId: 'board-1',
    relationship: 'MEASURES',
  });
  const svg = buildElectricalMapSvg(selfMeasured, 'Main supply');
  assert.match(svg, /data-meter-satellite="meter-1"/);
  assert.doesNotMatch(svg, /data-measurement-self-loop=|data-measurement-source=/);
  assert.doesNotMatch(svg, /stroke="#2563EB"[^>]*stroke-dasharray/);
});
