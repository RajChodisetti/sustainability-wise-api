import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ELECTRICAL_MAP_ICON_NAMES,
  ELECTRICAL_MAP_LOAD_LEGEND,
  ELECTRICAL_MAP_NODE_LEGEND,
  electricalMapIconDataUri,
  electricalMapIconForNode,
  electricalMapIconScale,
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

test('every generated icon is a transparent 256 px PNG without a square background', async () => {
  assert.equal(ELECTRICAL_MAP_ICON_NAMES.length, 25);
  const imageHashOwner = new Map<string, string>();
  for (const name of ELECTRICAL_MAP_ICON_NAMES) {
    const fileUrl = new URL(`./electrical-map-icons/${name}.png`, import.meta.url);
    const portalFileUrl = new URL(`../../apps/ecoaudit/public/installhub/electrical-map-icons/${name}.png`, import.meta.url);
    const filePath = fileURLToPath(fileUrl);
    const fileBuffer = readFileSync(fileUrl);
    const imageHash = createHash('sha256').update(fileBuffer).digest('hex');
    assert.equal(imageHashOwner.get(imageHash), undefined, `${name} must have its own meaningful image`);
    imageHashOwner.set(imageHash, name);
    const image = sharp(fileBuffer);
    const metadata = await image.metadata();
    assert.equal(metadata.format, 'png', `${name} must remain a PNG`);
    assert.equal(metadata.width, 256, `${name} width`);
    assert.equal(metadata.height, 256, `${name} height`);
    assert.equal(metadata.hasAlpha, true, `${name} must retain alpha transparency`);
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cornerAlpha = [
      [0, 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1],
    ].map(([x, y]) => data[(y * info.width + x) * info.channels + 3]);
    assert.deepEqual(cornerAlpha, [0, 0, 0, 0], `${name} must not contain a square background`);
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    assert.ok(maxX >= minX && maxY >= minY, `${name} must contain visible equipment artwork`);
    assert.ok(
      Math.max(maxX - minX + 1, maxY - minY + 1) >= 218,
      `${name} artwork must substantially fill the transparent canvas`,
    );
    assert.deepEqual(readFileSync(portalFileUrl), fileBuffer, `${name} must match the portal copy`);
    assert.match(electricalMapIconDataUri(name), /^data:image\/png;base64,iVBOR/);
  }
});

test('normalized equipment portraits use the same bounded optical scale in PDF maps', () => {
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
