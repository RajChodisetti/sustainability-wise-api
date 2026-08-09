import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  ELECTRICAL_MAP_SYMBOL_LABELS,
  ELECTRICAL_MAP_SYMBOL_NAMES,
  electricalMapSymbolForNode,
  electricalMapSymbolLabel,
  electricalMapSymbolPath,
  electricalMapSymbolScale,
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

test('the generated symbol registry is complete, transparent-asset paths are stable, and legacy labels stay distinct', () => {
  assert.equal(ELECTRICAL_MAP_SYMBOL_NAMES.length, 25);
  assert.equal(ELECTRICAL_MAP_NODE_SYMBOLS.length, 5);
  assert.equal(ELECTRICAL_MAP_LOAD_SYMBOLS.length, 14);
  assert.equal(new Set(ELECTRICAL_MAP_LOAD_SYMBOLS.map((item) => item.symbol)).size, 14);
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    assert.equal(electricalMapSymbolPath(symbol), `/installhub/electrical-map-icons/${symbol}.png`);
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

test('every pictogram has a clear client label and presentation scale', () => {
  assert.deepEqual(Object.keys(ELECTRICAL_MAP_SYMBOL_LABELS).sort(), [...ELECTRICAL_MAP_SYMBOL_NAMES].sort());
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    const label = electricalMapSymbolLabel(symbol);
    const scale = electricalMapSymbolScale(symbol);
    assert.ok(label.trim().length >= 4, `${symbol} needs a meaningful visible label`);
    assert.ok(scale >= 1 && scale <= 1.4, `${symbol} presentation scale must remain bounded`);
  }

  assert.equal(electricalMapSymbolLabel('load-hvac-indoor'), 'AC indoor unit');
  assert.equal(electricalMapSymbolLabel('load-hvac-condenser'), 'HVAC condenser');
  assert.equal(electricalMapSymbolLabel('board-msb'), 'Main switchboard');
  assert.ok(electricalMapSymbolScale('load-hvac') > 1);
  assert.ok(electricalMapSymbolScale('node-residual') > 1);
  assert.equal(electricalMapSymbolScale('board-pv-db'), 1);
  assert.equal(electricalMapSymbolScale('load-pv'), 1);
});
