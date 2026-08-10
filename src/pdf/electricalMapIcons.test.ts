import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
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

test('every icon is a unique deterministic inline SVG schematic', async () => {
  assert.equal(ELECTRICAL_MAP_ICON_NAMES.length, 25);
  const imageHashOwner = new Map<string, string>();
  for (const name of ELECTRICAL_MAP_ICON_NAMES) {
    const definition = electricalMapIconSvgDefinition(name);
    assert.equal(definition.name, name);
    assert.equal(definition.viewBox, ELECTRICAL_MAP_ICON_VIEW_BOX);
    assert.match(definition.body, new RegExp(`data-schematic-icon="${name}"`));
    assert.match(definition.body, /stroke-width="2\.4" stroke-linecap="round" stroke-linejoin="round"/);
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
