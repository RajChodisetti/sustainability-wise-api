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
        { ordinal: 1, purpose: 'SUB_CIRCUIT', load: 'HVAC' },
        { ordinal: 2, purpose: 'SPARE', load: '' },
      ],
    }],
    unresolvedRelationships: [],
    assets: [],
    meteringRows: [],
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

function assertConnectorRoutesAvoidUnrelatedNodes(svg: string): void {
  const rectangles = [...svg.matchAll(
    /<g data-node-kind="[^"]+" data-node-id="([^"]+)"[^>]*data-layout-x="([\d.]+)" data-layout-y="([\d.]+)">\s*<rect[^>]*width="([\d.]+)" height="([\d.]+)"/g,
  )].map((match) => ({
    id: match[1],
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5]),
  }));
  const connectors = [...svg.matchAll(
    /<path data-(supply|measurement)-source="([^"]+)" data-\1-target="([^"]+)" data-route-points="([^"]+)"/g,
  )];
  assert.ok(connectors.length > 0);
  for (const connector of connectors) {
    const [, relationship, sourceId, targetId, rawPoints] = connector;
    const points = rawPoints.split(';').map((rawPoint) => {
      const [x, y] = rawPoint.split(',').map(Number);
      return { x, y };
    });
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      assert.ok(
        start.x === end.x || start.y === end.y,
        `${relationship} ${sourceId} -> ${targetId} must remain orthogonal`,
      );
      for (const rectangle of rectangles) {
        if (rectangle.id === sourceId || rectangle.id === targetId) continue;
        const horizontalIntersection = start.y === end.y
          && start.y > rectangle.y
          && start.y < rectangle.y + rectangle.height
          && Math.max(Math.min(start.x, end.x), rectangle.x)
            < Math.min(Math.max(start.x, end.x), rectangle.x + rectangle.width);
        const verticalIntersection = start.x === end.x
          && start.x > rectangle.x
          && start.x < rectangle.x + rectangle.width
          && Math.max(Math.min(start.y, end.y), rectangle.y)
            < Math.min(Math.max(start.y, end.y), rectangle.y + rectangle.height);
        assert.equal(
          horizontalIntersection || verticalIntersection,
          false,
          `${relationship} ${sourceId} -> ${targetId} intersects ${rectangle.id}`,
        );
      }
    }
  }
}

test('electrical map SVG is deterministic, escaped and visually explains every relationship', () => {
  const first = buildElectricalMapSvg(report(), 'Example & Sons');
  assert.equal(buildElectricalMapSvg(report(), 'Example & Sons'), first);
  assert.match(first, /Example &amp; Sons/);
  assert.match(first, /Main &lt;switchboard&gt;/);
  assert.match(first, /data-node-kind="GRID"/);
  assert.match(first, /data-node-kind="BOARD"/);
  assert.match(first, /data-node-kind="SITE_ASSET"/);
  assert.match(first, /data-meter-module="meter-1"/);
  assert.match(first, /fill="#DCFCE7" stroke="#4D9B68"/);
  assert.match(first, /Plant meter/);
  assert.match(first, /A6M - Ch 1/);
  assert.match(first, /stroke="#B87333" stroke-width="4"/);
  assert.match(first, /stroke="#2563EB"[^>]*stroke-dasharray="10 7"/);
  assert.match(first, /stroke="#64748B"[^>]*stroke-dasharray="2 7"/);
  assert.match(first, /Electrical supply/);
  assert.match(first, /Meter measures/);
  assert.match(first, /Calculated residual/);
  assert.doesNotMatch(first, /<script/i);
});

test('electrical map rasterizes to a deterministic PNG data URI', async () => {
  const first = await renderElectricalMapPngDataUri(report(), 'Example site');
  const second = await renderElectricalMapPngDataUri(report(), 'Example site');
  assert.equal(second, first);
  assert.match(first, /^data:image\/png;base64,iVBOR/);
});

test('deep hierarchies retain one overview and add overlapping bounded-width detail tiles', async () => {
  const deep = await renderElectricalMapImages(deepHierarchyReport(), 'Deep hierarchy');
  assert.ok(deep.sourceWidth > ELECTRICAL_MAP_DETAIL_THRESHOLD_PX);
  assert.ok(deep.detailTiles.length > 1);
  assert.match(deep.overviewDataUri, /^data:image\/png;base64,iVBOR/);
  assert.equal(deep.detailTiles[0].left, 0);
  assert.equal(deep.overviewWidth, deep.sourceWidth);
  assert.equal(deep.overviewHeight, deep.sourceHeight);
  assert.equal(deep.totalDetailWindows, deep.detailTiles.length);
  assert.equal(deep.omittedDetailWindows, 0);
  assert.equal(
    deep.detailTiles.at(-1)!.left + deep.detailTiles.at(-1)!.width,
    deep.sourceWidth,
  );
  for (const [index, tile] of deep.detailTiles.entries()) {
    assert.ok(tile.width <= ELECTRICAL_MAP_DETAIL_TILE_MAX_WIDTH_PX);
    assert.ok(tile.width < deep.sourceWidth);
    assert.ok(tile.height < deep.sourceHeight);
    assert.match(tile.dataUri, /^data:image\/png;base64,iVBOR/);
    assert.equal(tile.row, 1);
    assert.equal(tile.rowCount, 1);
    assert.equal(tile.column, index + 1);
    assert.equal(tile.columnCount, deep.detailTiles.length);
    if (index === 0) continue;
    const previous = deep.detailTiles[index - 1];
    assert.ok(previous.left < tile.left);
    assert.ok(
      previous.left + previous.width - tile.left >= ELECTRICAL_MAP_DETAIL_TILE_OVERLAP_PX,
    );
  }

  const essendon = await renderElectricalMapImages(denseAssetReport(10), 'Essendon Electric Map');
  assert.ok(essendon.sourceWidth <= ELECTRICAL_MAP_DETAIL_THRESHOLD_PX);
  assert.deepEqual(essendon.detailTiles, []);
});

test('tall nonterminal board hierarchies produce deterministic bounded 2D detail windows', async () => {
  const tall = await renderElectricalMapImages(tallMultiBoardReport(12), 'Tall hierarchy');
  assert.ok(tall.detailTiles.length > 1);
  const rowCount = tall.detailTiles[0].rowCount;
  const columnCount = tall.detailTiles[0].columnCount;
  assert.ok(rowCount > 1, 'tall hierarchy should be split into overlapping rows');
  assert.ok(columnCount > 1, 'wide branches should retain overlapping columns');
  assert.equal(tall.detailTiles.length, rowCount * columnCount);
  assert.equal(rowCount, 3);
  assert.equal(columnCount, 2);
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

test('dense Essendon-scale terminal loads balance into readable presentation columns', () => {
  for (const [assetCount, expectedRows, maximumHeight] of [
    [8, 4, 760],
    [10, 5, 900],
  ] as const) {
    const svg = buildElectricalMapSvg(denseAssetReport(assetCount), 'Essendon Electric Map');
    const dimensions = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
    assert.ok(dimensions);
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    assert.ok(height <= maximumHeight, `dense diagram height ${height}px should remain A4-readable`);
    assert.ok(width / height >= 1.3, 'dense diagram should use a landscape, image-led footprint');

    const assetPlacements = [...svg.matchAll(
      /<g data-node-kind="SITE_ASSET"[^>]*data-layout-depth="(\d+)" data-layout-x="([\d.]+)" data-layout-y="([\d.]+)"/g,
    )];
    assert.equal(assetPlacements.length, assetCount);
    assert.deepEqual(new Set(assetPlacements.map((match) => match[1])), new Set(['2']));
    assert.equal(new Set(assetPlacements.map((match) => match[2])).size, 2);
    assert.equal(new Set(assetPlacements.map((match) => match[3])).size, expectedRows);
    assert.equal(
      (svg.match(/stroke="#B87333" stroke-width="4"/g) ?? []).length,
      assetCount + 2,
    );
    assertConnectorRoutesAvoidUnrelatedNodes(svg);
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
  assert.ok(Number(dimensions[1]) < 1_200);
});

test('main-supply MEASURES self-edges loop entirely below the switchboard', () => {
  const selfMeasured = report();
  selfMeasured.measurementEdges.push({
    sourceNodeId: 'board-1',
    targetNodeId: 'board-1',
    relationship: 'MEASURES',
  });
  const svg = buildElectricalMapSvg(selfMeasured, 'Main supply');
  const board = /<g data-node-kind="BOARD"[^>]*data-layout-y="([\d.]+)">\s*<rect[^>]*height="([\d.]+)"/.exec(svg);
  const loop = /data-measurement-self-loop="board-1" d="([^"]+)"/.exec(svg);
  assert.ok(board);
  assert.ok(loop);
  const boardBottom = Number(board[1]) + Number(board[2]);
  const pathNumbers = loop[1].match(/[\d.]+/g)?.map(Number) ?? [];
  const pathYCoordinates = pathNumbers.filter((_, index) => index % 2 === 1);
  assert.ok(pathYCoordinates.length > 0);
  assert.ok(pathYCoordinates.every((value) => value >= boardBottom));
  assert.ok(pathYCoordinates.some((value) => value > boardBottom));
});
