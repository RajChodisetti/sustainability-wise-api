import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ELECTRICAL_MAP_ICON_NAMES,
  ELECTRICAL_MAP_ICON_VIEW_BOX,
  ELECTRICAL_MAP_LOAD_LEGEND,
  ELECTRICAL_MAP_NODE_LEGEND,
  electricalMapIconDataUri,
  electricalMapIconForNode,
  electricalMapIconScale,
  electricalMapIconSvg,
  electricalMapIconSvgDefinition,
} from './electricalMapIcons.js';

test('canonical switchboard and site-asset codes select deterministic generated icons', () => {
  const boardCases = {
    MSB: 'board-msb',
    MSSB: 'board-mssb',
    DB: 'board-db',
    HVAC_DB: 'board-hvac-db',
    LX_DB: 'board-lighting-db',
    PV_DB: 'board-pv-db',
    MCC: 'board-mcc',
    OTHER: 'board-other',
  } as const;
  const loadCases = {
    PV: 'load-pv',
    HVAC: 'load-hvac',
    LIGHTING: 'load-lighting',
    EV_CHARGER: 'load-ev-charger',
    VEHICLE_HOIST: 'load-vehicle-hoist',
    FORKLIFT: 'load-forklift',
    EXHAUST_FAN_SYSTEM: 'load-exhaust-fan',
    POWER_OUTLET: 'load-power-outlet',
    HEATER_GEYSER: 'load-hot-water',
    REFRIGERATION: 'load-refrigeration',
    COMPRESSED_AIR: 'load-compressed-air',
    OTHER: 'load-other',
  } as const;

  for (const [typeCode, expected] of Object.entries(boardCases)) {
    assert.equal(electricalMapIconForNode({ kind: 'BOARD', typeCode }), expected);
  }
  for (const [typeCode, expected] of Object.entries(loadCases)) {
    assert.equal(electricalMapIconForNode({ kind: 'SITE_ASSET', typeCode }), expected);
  }
  assert.equal(ELECTRICAL_MAP_NODE_LEGEND.length, 5);
  assert.equal(ELECTRICAL_MAP_LOAD_LEGEND.length, 14);
  assert.equal(new Set(ELECTRICAL_MAP_LOAD_LEGEND.map(([icon]) => icon)).size, 14);
  assert.equal(electricalMapIconForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'PAC-1' }), 'load-hvac-indoor');
  assert.equal(electricalMapIconForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'VRV-CU' }), 'load-hvac-condenser');
  assert.equal(electricalMapIconForNode({ kind: 'SITE_ASSET', typeCode: 'OTHER', name: 'Blast freezer' }), 'load-refrigeration');
  assert.equal(electricalMapIconForNode({ kind: 'BOARD', name: 'MSSB1 Main Switchboard' }), 'board-mssb');
});

test('server symbols retain the portal canonical registry, palette and representative geometry', () => {
  assert.deepEqual(ELECTRICAL_MAP_ICON_NAMES, [
    'node-grid', 'node-meter', 'node-residual',
    'board-msb', 'board-mssb', 'board-db', 'board-hvac-db', 'board-lighting-db',
    'board-pv-db', 'board-mcc', 'board-other',
    'load-pv', 'load-hvac', 'load-hvac-indoor', 'load-hvac-condenser',
    'load-lighting', 'load-ev-charger', 'load-vehicle-hoist', 'load-forklift',
    'load-exhaust-fan', 'load-power-outlet', 'load-hot-water', 'load-refrigeration',
    'load-compressed-air', 'load-other',
  ]);

  const grid = electricalMapIconSvgDefinition('node-grid').body;
  assert.ok(grid.includes('<rect x="3" y="3" width="58" height="58" rx="15" fill="#FFF7ED"/>'));
  assert.ok(grid.includes('d="M18 52 27 12h10l9 40M23 34h18M20 43h24M27 12l-9 13h28L37 12"'));
  assert.ok(grid.includes('d="m34 22-7 10h6l-2 9 7-11h-6l2-8Z" fill="#9A551D" fill-opacity="0.14"'));
  assert.ok(grid.includes('<line x1="14" y1="53" x2="50" y2="53"/>'));
  assert.ok(!grid.includes('M18 52L32 11'), 'the retired server-only grid artwork must not return');

  const meter = electricalMapIconSvgDefinition('node-meter').body;
  assert.ok(meter.includes('<rect x="14" y="8" width="36" height="48" rx="5"/>'));
  assert.ok(meter.includes('<circle cx="23" cy="45" r="3"/>'));
  assert.ok(meter.includes('stroke="#0F766E"'));

  const lightingBoard = electricalMapIconSvgDefinition('board-lighting-db').body;
  assert.ok(lightingBoard.includes('<rect x="9" y="7" width="46" height="50" rx="4" fill="#FFFFFF" fill-opacity="0.94" stroke="#1D4ED8" stroke-width="2.4"/>'));
  assert.ok(lightingBoard.includes('<path d="M9 18h46" fill="none" stroke="#1D4ED8" stroke-width="1.4"/>'));
  assert.ok(lightingBoard.includes('>LIGHT</text>'));
  assert.ok(lightingBoard.includes('data-board-phase-fallback="true"'));
  assert.ok(lightingBoard.includes('<line x1="23" y1="27" x2="50" y2="27" stroke="#1D4ED8" stroke-width="1.4"/>'));
  assert.ok(lightingBoard.includes('data-breaker-phase="L2" x="31" y="34" width="8" height="6" rx="1.2" fill="#DBEAFE" stroke="#1D4ED8" stroke-width="0.9"'));
  assert.ok(lightingBoard.includes('data-phase-port="L3" data-channel-port="true" data-channel-phase="L3" cx="51" cy="47" r="1.6"'));
  assert.ok(!lightingBoard.includes('x="10" y="8" width="44" height="48"'));

  const hotWater = electricalMapIconSvgDefinition('load-hot-water').body;
  assert.ok(hotWater.includes('<rect x="15" y="6" width="34" height="51" rx="12"/>'));
  assert.ok(hotWater.includes('d="M32 18s9 9 9 16a9 9 0 0 1-18 0c0-7 9-16 9-16Z" fill="#166534" fill-opacity="0.14"'));
  assert.deepEqual(ELECTRICAL_MAP_NODE_LEGEND.at(-1), ['node-residual', 'Calculated residual']);
  assert.deepEqual(ELECTRICAL_MAP_LOAD_LEGEND[9], ['load-exhaust-fan', 'Exhaust / air fan']);
});

test('every icon is a unique deterministic inline SVG schematic', async () => {
  const { default: sharp } = await import('sharp');
  assert.equal(ELECTRICAL_MAP_ICON_NAMES.length, 25);
  const imageHashOwner = new Map<string, string>();
  for (const name of ELECTRICAL_MAP_ICON_NAMES) {
    const definition = electricalMapIconSvgDefinition(name);
    assert.equal(definition.name, name);
    assert.equal(definition.viewBox, ELECTRICAL_MAP_ICON_VIEW_BOX);
    assert.match(definition.body, new RegExp(`data-schematic-icon="${name}"`));
    if (name.startsWith('board-')) {
      assert.match(definition.body, /stroke="#1D4ED8" stroke-width="2\.4"/);
    } else {
      assert.match(definition.body, /stroke-width="2\.4" stroke-linecap="round" stroke-linejoin="round"/);
    }
    assert.doesNotMatch(definition.body, /<image\b|data:image\/|<foreignObject\b|<filter\b|<linearGradient\b/);

    const svg = electricalMapIconSvg(name);
    const imageHash = createHash('sha256').update(svg).digest('hex');
    assert.equal(imageHashOwner.get(imageHash), undefined, `${name} must have its own meaningful schematic`);
    imageHashOwner.set(imageHash, name);
    assert.equal(electricalMapIconSvg(name), svg, `${name} SVG must be deterministic`);

    const image = sharp(Buffer.from(svg));
    const metadata = await image.metadata();
    assert.equal(metadata.format, 'svg', `${name} must remain vector artwork`);
    assert.equal(metadata.width, 64, `${name} width`);
    assert.equal(metadata.height, 64, `${name} height`);
    assert.equal(metadata.hasAlpha, true, `${name} must retain alpha transparency`);

    const dataUri = electricalMapIconDataUri(name);
    const prefix = 'data:image/svg+xml;charset=utf-8,';
    assert.ok(dataUri.startsWith(prefix));
    assert.equal(decodeURIComponent(dataUri.slice(prefix.length)), svg);
  }
});

test('every switchboard schematic exposes visible L1, L2 and L3 rails and breakers', () => {
  const boards = ELECTRICAL_MAP_ICON_NAMES.filter((name) => name.startsWith('board-'));
  assert.equal(boards.length, 8);
  for (const name of boards) {
    const body = electricalMapIconSvgDefinition(name).body;
    assert.match(body, /data-board-phase-rails="true"/);
    for (const phase of ['L1', 'L2', 'L3']) {
      assert.match(body, new RegExp(`data-phase-rail="${phase}"`), `${name} ${phase} rail`);
      assert.match(body, new RegExp(`data-breaker-phase="${phase}"`), `${name} ${phase} breaker`);
      assert.match(body, new RegExp(`data-phase-port="${phase}"`), `${name} ${phase} connection port`);
    }
  }
});

test('normalized schematic symbols use the same bounded optical scale in PDF maps', () => {
  for (const name of ELECTRICAL_MAP_ICON_NAMES) {
    const scale = electricalMapIconScale(name);
    assert.equal(scale, 1.08, `${name} optical scale must stay normalized`);
  }
  assert.equal(electricalMapIconScale('board-msb'), 1.08);
  assert.equal(electricalMapIconScale('load-pv'), 1.08);
  assert.equal(electricalMapIconScale('node-grid'), electricalMapIconScale('node-meter'));
  assert.equal(electricalMapIconScale('load-hvac'), electricalMapIconScale('load-hvac-indoor'));
  assert.equal(electricalMapIconScale('node-residual'), electricalMapIconScale('load-other'));
});
