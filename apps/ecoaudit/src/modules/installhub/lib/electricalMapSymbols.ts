export const ELECTRICAL_MAP_SYMBOL_NAMES = [
  'node-grid',
  'node-meter',
  'node-residual',
  'board-msb',
  'board-mssb',
  'board-db',
  'board-hvac-db',
  'board-lighting-db',
  'board-pv-db',
  'board-mcc',
  'board-other',
  'load-pv',
  'load-hvac',
  'load-hvac-indoor',
  'load-hvac-condenser',
  'load-lighting',
  'load-ev-charger',
  'load-vehicle-hoist',
  'load-forklift',
  'load-exhaust-fan',
  'load-power-outlet',
  'load-hot-water',
  'load-refrigeration',
  'load-compressed-air',
  'load-other',
] as const;

export type ElectricalMapSymbolName = (typeof ELECTRICAL_MAP_SYMBOL_NAMES)[number];

/**
 * Client-facing names stay coupled to the pictograms rather than the often
 * broader asset type labels received from field data.
 */
export const ELECTRICAL_MAP_SYMBOL_LABELS: Readonly<Record<ElectricalMapSymbolName, string>> = {
  'node-grid': 'Incoming grid',
  'node-meter': 'Installed meter',
  'node-residual': 'Calculated residual',
  'board-msb': 'Main switchboard',
  'board-mssb': 'Sub-main switchboard',
  'board-db': 'Distribution board',
  'board-hvac-db': 'HVAC distribution board',
  'board-lighting-db': 'Lighting distribution board',
  'board-pv-db': 'Solar distribution board',
  'board-mcc': 'Motor control centre',
  'board-other': 'Switchboard',
  'load-pv': 'Solar / PV',
  'load-hvac': 'HVAC system',
  'load-hvac-indoor': 'AC indoor unit',
  'load-hvac-condenser': 'HVAC condenser',
  'load-lighting': 'Lighting',
  'load-ev-charger': 'EV charger',
  'load-vehicle-hoist': 'Vehicle hoist',
  'load-forklift': 'Forklift',
  'load-exhaust-fan': 'Exhaust / air fan',
  'load-power-outlet': 'Power outlet',
  'load-hot-water': 'Hot water / heater',
  'load-refrigeration': 'Refrigeration',
  'load-compressed-air': 'Compressed air',
  'load-other': 'Other site asset',
};

/**
 * The transparent equipment portraits are normalized to the same optical
 * canvas. A small shared lift keeps them prominent without letting any one
 * asset type escape its halo or overlap its label.
 */
const ELECTRICAL_MAP_SYMBOL_SCALE = 1.08;

export const ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES = {
  system: 30,
  load: 28,
  meterBadge: 17,
} as const;

export function electricalMapSymbolLabel(symbol: ElectricalMapSymbolName): string {
  return ELECTRICAL_MAP_SYMBOL_LABELS[symbol];
}

export function electricalMapSymbolScale(symbol: ElectricalMapSymbolName): number {
  void symbol;
  return ELECTRICAL_MAP_SYMBOL_SCALE;
}

const BOARD_SYMBOL_BY_CODE: Readonly<Record<string, ElectricalMapSymbolName>> = {
  MSB: 'board-msb',
  MSSB: 'board-mssb',
  DB: 'board-db',
  HVAC_DB: 'board-hvac-db',
  LX_DB: 'board-lighting-db',
  PV_DB: 'board-pv-db',
  MCC: 'board-mcc',
  OTHER: 'board-other',
};

const LOAD_SYMBOL_BY_CODE: Readonly<Record<string, ElectricalMapSymbolName>> = {
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
};

export const ELECTRICAL_MAP_NODE_SYMBOLS: ReadonlyArray<{
  label: string;
  symbol: ElectricalMapSymbolName;
}> = [
  { label: 'Incoming grid', symbol: 'node-grid' },
  { label: 'Switchboard', symbol: 'board-other' },
  { label: 'Installed meter', symbol: 'node-meter' },
  { label: 'Site asset', symbol: 'load-other' },
  { label: 'Calculated residual', symbol: 'node-residual' },
];

export const ELECTRICAL_MAP_LOAD_SYMBOLS: ReadonlyArray<{
  code: string;
  label: string;
  symbol: ElectricalMapSymbolName;
}> = [
  { code: 'HVAC', label: 'HVAC (general)', symbol: 'load-hvac' },
  { code: 'HVAC_INDOOR', label: 'AC indoor unit', symbol: 'load-hvac-indoor' },
  { code: 'HVAC_CONDENSER', label: 'HVAC condenser', symbol: 'load-hvac-condenser' },
  { code: 'REFRIGERATION', label: 'Refrigeration', symbol: 'load-refrigeration' },
  { code: 'LIGHTING', label: 'Lighting', symbol: 'load-lighting' },
  { code: 'PV', label: 'Solar / PV', symbol: 'load-pv' },
  { code: 'EV_CHARGER', label: 'EV charger', symbol: 'load-ev-charger' },
  { code: 'POWER_OUTLET', label: 'Power outlet', symbol: 'load-power-outlet' },
  { code: 'FORKLIFT', label: 'Forklift', symbol: 'load-forklift' },
  { code: 'EXHAUST_FAN_SYSTEM', label: 'Exhaust / air fan', symbol: 'load-exhaust-fan' },
  { code: 'VEHICLE_HOIST', label: 'Vehicle hoist', symbol: 'load-vehicle-hoist' },
  { code: 'HEATER_GEYSER', label: 'Hot water / heater', symbol: 'load-hot-water' },
  { code: 'COMPRESSED_AIR', label: 'Compressed air', symbol: 'load-compressed-air' },
  { code: 'OTHER', label: 'Other site asset', symbol: 'load-other' },
];

function normalizedCode(value?: string): string {
  return value?.trim().toUpperCase().replaceAll('-', '_') ?? '';
}

function legacyBoardSymbol(value: string): ElectricalMapSymbolName {
  if (/\bMSSB(?:[-_ ]?\d+)?\b|SUB.?MAIN/.test(value)) return 'board-mssb';
  if (/\bMSB\b|MAIN\s+SWITCHBOARD/.test(value)) return 'board-msb';
  if (/HVAC/.test(value)) return 'board-hvac-db';
  if (/LIGHT|\bLX\b/.test(value)) return 'board-lighting-db';
  if (/SOLAR|\bPV\b/.test(value)) return 'board-pv-db';
  if (/MOTOR|\bMCC\b/.test(value)) return 'board-mcc';
  if (/DISTRIBUTION|\bDB\b/.test(value)) return 'board-db';
  return 'board-other';
}

const HVAC_CONDENSER_PATTERN = /\b(?:VRV|VRF)[-_ ]?CU\b|\bCONDENS(?:ING|ER)?(?: UNIT)?\b|\bOUTDOOR(?: UNIT)?\b|\bODU\b/;
const HVAC_INDOOR_PATTERN = /\bPAC[-_ ]?\d+\b|\bINDOOR(?: UNIT)?\b|\bIDU\b|\bFAN[- ]?COIL\b|\bFCU\b|\bCASSETTE\b|\bAIR[- ]?HANDLER\b|\bAHU\b|\b(?:VRV|VRF)\b.*\bUNITS?\b/;

function hvacVariantSymbol(value: string): ElectricalMapSymbolName | null {
  if (HVAC_CONDENSER_PATTERN.test(value)) return 'load-hvac-condenser';
  if (HVAC_INDOOR_PATTERN.test(value)) return 'load-hvac-indoor';
  return null;
}

function legacyLoadSymbol(value: string): ElectricalMapSymbolName {
  if (/REFRIG|CHILL|FREEZ|COOL\s*ROOM|COLD\s*ROOM/.test(value)) return 'load-refrigeration';
  const hvacVariant = hvacVariantSymbol(value);
  if (hvacVariant) return hvacVariant;
  if (/HVAC|AIR\s*CON|VRV|VRF|SPLIT/.test(value)) return 'load-hvac';
  if (/LIGHT/.test(value)) return 'load-lighting';
  if (/SOLAR|\bPV\b/.test(value)) return 'load-pv';
  if (/FORKLIFT|BATTER/.test(value)) return 'load-forklift';
  if (/POWER\s*OUTLET|GENERAL\s*POWER|\bGPO\b|\bSOCKET\b/.test(value)) return 'load-power-outlet';
  if (/\bEV\b|CHARG/.test(value)) return 'load-ev-charger';
  if (/EXHAUST|\bFAN\b/.test(value)) return 'load-exhaust-fan';
  if (/HOIST|VEHICLE\s*LIFT/.test(value)) return 'load-vehicle-hoist';
  if (/COMPRESS/.test(value)) return 'load-compressed-air';
  if (/HOT\s*WATER|HEATER|GEYSER/.test(value)) return 'load-hot-water';
  return 'load-other';
}

export function electricalMapSymbolForNode(node: {
  kind: string;
  typeCode?: string;
  typeLabel?: string;
  name?: string;
}): ElectricalMapSymbolName {
  if (node.kind === 'GRID') return 'node-grid';
  if (node.kind === 'VIRTUAL_RESIDUAL') return 'node-residual';
  const typeCode = normalizedCode(node.typeCode);
  if (node.kind === 'BOARD') {
    return BOARD_SYMBOL_BY_CODE[typeCode]
      ?? legacyBoardSymbol(`${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase());
  }
  if (node.kind === 'SITE_ASSET') {
    const semanticLabel = `${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase();
    if (typeCode === 'HVAC') return hvacVariantSymbol(semanticLabel) ?? 'load-hvac';
    if (typeCode === 'OTHER') return legacyLoadSymbol(semanticLabel);
    return LOAD_SYMBOL_BY_CODE[typeCode]
      ?? legacyLoadSymbol(semanticLabel);
  }
  return 'load-other';
}

export function electricalMapSymbolPath(symbol: ElectricalMapSymbolName): string {
  return `/installhub/electrical-map-icons/${symbol}.png`;
}
