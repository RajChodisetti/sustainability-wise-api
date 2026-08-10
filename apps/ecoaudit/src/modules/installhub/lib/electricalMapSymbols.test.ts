import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElectricalMapSymbol } from '../components/ElectricalMapSymbol';
import {
  ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES,
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  ELECTRICAL_MAP_SYMBOL_DEFINITIONS,
  ELECTRICAL_MAP_SYMBOL_LABELS,
  ELECTRICAL_MAP_SYMBOL_NAMES,
  electricalMapSymbolDefinition,
  electricalMapSymbolForNode,
  electricalMapSymbolLabel,
} from './electricalMapSymbols';

test('every canonical switchboard and load code selects its own map symbol', () => {
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
    assert.equal(electricalMapSymbolForNode({ kind: 'BOARD', typeCode }), expected);
  }
  for (const [typeCode, expected] of Object.entries(loadCases)) {
    assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode }), expected);
  }
});

test('the schematic symbol registry is complete and legacy labels stay distinct', () => {
  assert.equal(ELECTRICAL_MAP_SYMBOL_NAMES.length, 25);
  assert.equal(ELECTRICAL_MAP_NODE_SYMBOLS.length, 5);
  assert.equal(ELECTRICAL_MAP_LOAD_SYMBOLS.length, 14);
  assert.equal(new Set(ELECTRICAL_MAP_LOAD_SYMBOLS.map((item) => item.symbol)).size, 14);
  assert.deepEqual(Object.keys(ELECTRICAL_MAP_SYMBOL_DEFINITIONS).sort(), [...ELECTRICAL_MAP_SYMBOL_NAMES].sort());
  const definitionSignatures = new Set<string>();
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    const definition = electricalMapSymbolDefinition(symbol);
    assert.ok(definition.primitives.length > 0, `${symbol} needs schematic vector primitives`);
    assert.match(definition.accent, /^#[0-9A-F]{6}$/i);
    assert.match(definition.tint, /^#[0-9A-F]{6}$/i);
    const signature = JSON.stringify([definition.category, definition.boardCode, definition.primitives]);
    assert.equal(definitionSignatures.has(signature), false, `${symbol} needs distinct schematic artwork`);
    definitionSignatures.add(signature);
  }

  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'Commercial refrigeration' }),
    'load-refrigeration',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'HVAC packaged unit' }),
    'load-hvac',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'EV charger' }),
    'load-ev-charger',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'General power outlet' }),
    'load-power-outlet',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'PAC-10' }),
    'load-hvac-indoor',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'VRV-CU' }),
    'load-hvac-condenser',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'OTHER', name: 'Blast freezer' }),
    'load-refrigeration',
  );
  assert.equal(
    electricalMapSymbolForNode({ kind: 'BOARD', name: 'MSSB1 Main Switchboard' }),
    'board-mssb',
  );
});

test('every schematic pictogram has a clear client label and stable legend sizes', () => {
  assert.deepEqual(Object.keys(ELECTRICAL_MAP_SYMBOL_LABELS).sort(), [...ELECTRICAL_MAP_SYMBOL_NAMES].sort());
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    const label = electricalMapSymbolLabel(symbol);
    assert.ok(label.trim().length >= 4, `${symbol} needs a meaningful visible label`);
  }

  assert.equal(electricalMapSymbolLabel('load-hvac-indoor'), 'AC indoor unit');
  assert.equal(electricalMapSymbolLabel('load-hvac-condenser'), 'HVAC condenser');
  assert.equal(electricalMapSymbolLabel('board-msb'), 'Main switchboard');
  assert.deepEqual(ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES, {
    system: 30,
    load: 28,
    meterBadge: 17,
  });
});

test('native SVG symbols avoid raster portraits and expose real switchboard channel ports', () => {
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    const symbolMarkup = renderToStaticMarkup(createElement(ElectricalMapSymbol, {
      name: symbol,
      size: 64,
    }));
    assert.match(symbolMarkup, /^<svg\b/);
    assert.match(symbolMarkup, new RegExp(`data-electrical-map-symbol="${symbol}"`));
    assert.doesNotMatch(symbolMarkup, /<img\b|\.png\b|data-symbol-scale=/);
  }

  const markup = renderToStaticMarkup(createElement(ElectricalMapSymbol, {
    name: 'board-msb',
    size: 252,
    channels: [
      { id: 'channel-l1', meterLabel: 'M1', ordinal: 1, phaseLabel: 'L1', purpose: 'SUB_CIRCUIT', assigned: true },
      { id: 'channel-spare', ordinal: 2, phaseLabel: 'L2', purpose: 'SPARE', assigned: false },
    ],
  }));

  assert.match(markup, /^<svg\b/);
  assert.match(markup, /viewBox="0 0 64 64"/);
  assert.match(markup, /data-electrical-map-symbol="board-msb"/);
  assert.match(markup, /data-symbol-style="schematic"/);
  assert.match(markup, /data-channel-id="channel-l1"/);
  assert.match(markup, /data-channel-phase="L1"/);
  assert.match(markup, /data-channel-state="assigned"/);
  assert.match(markup, /data-channel-id="channel-spare"/);
  assert.match(markup, /data-channel-state="spare"/);
  assert.match(markup, /data-channel-port="true"/);
  assert.match(markup, /data-meter-label="M1"/);
  assert.match(markup, /M1 · CH 1 · L1/);

  const emptyBoardMarkup = renderToStaticMarkup(createElement(ElectricalMapSymbol, {
    name: 'board-other',
    size: 252,
  }));
  assert.match(emptyBoardMarkup, /data-board-phase-fallback="true"/);
  for (const phase of ['L1', 'L2', 'L3']) {
    assert.match(emptyBoardMarkup, new RegExp(`data-phase-rail="${phase}"`));
  }
  assert.match(markup, /L1/);
});
