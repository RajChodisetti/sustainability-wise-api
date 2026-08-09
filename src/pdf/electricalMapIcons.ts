import { readFileSync } from 'node:fs';

/**
 * Transparent semi-realistic equipment portraits generated for the client map
 * and normalized to 256 px PNGs for deterministic browser and Sharp rendering.
 */
export const ELECTRICAL_MAP_ICON_NAMES = [
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

export type ElectricalMapIconName = (typeof ELECTRICAL_MAP_ICON_NAMES)[number];

/** The portal uses the same normalized optical lift for its PNG copies. */
const ELECTRICAL_MAP_ICON_SCALE = 1.08;

export function electricalMapIconScale(name: ElectricalMapIconName): number {
  void name;
  return ELECTRICAL_MAP_ICON_SCALE;
}

const BOARD_ICON_BY_CODE: Readonly<Record<string, ElectricalMapIconName>> = {
  MSB: 'board-msb',
  MSSB: 'board-mssb',
  DB: 'board-db',
  HVAC_DB: 'board-hvac-db',
  LX_DB: 'board-lighting-db',
  PV_DB: 'board-pv-db',
  MCC: 'board-mcc',
  OTHER: 'board-other',
};

const LOAD_ICON_BY_CODE: Readonly<Record<string, ElectricalMapIconName>> = {
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

export const ELECTRICAL_MAP_NODE_LEGEND: ReadonlyArray<readonly [ElectricalMapIconName, string]> = [
  ['node-grid', 'Incoming grid'],
  ['board-other', 'Switchboard'],
  ['node-meter', 'Installed meter'],
  ['load-other', 'Site asset'],
  ['node-residual', 'Virtual residual'],
];

export const ELECTRICAL_MAP_LOAD_LEGEND: ReadonlyArray<readonly [ElectricalMapIconName, string]> = [
  ['load-hvac', 'HVAC (general)'],
  ['load-hvac-indoor', 'AC indoor unit'],
  ['load-hvac-condenser', 'HVAC condenser'],
  ['load-refrigeration', 'Refrigeration'],
  ['load-lighting', 'Lighting'],
  ['load-pv', 'Solar / PV'],
  ['load-ev-charger', 'EV charger'],
  ['load-power-outlet', 'Power outlet'],
  ['load-forklift', 'Forklift'],
  ['load-exhaust-fan', 'Exhaust / fan'],
  ['load-vehicle-hoist', 'Vehicle hoist'],
  ['load-hot-water', 'Hot water / heater'],
  ['load-compressed-air', 'Compressed air'],
  ['load-other', 'Other site asset'],
];

function normalizedCode(value?: string): string {
  return value?.trim().toUpperCase().replaceAll('-', '_') ?? '';
}

function legacyBoardIcon(value: string): ElectricalMapIconName {
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

function hvacVariantIcon(value: string): ElectricalMapIconName | null {
  if (HVAC_CONDENSER_PATTERN.test(value)) return 'load-hvac-condenser';
  if (HVAC_INDOOR_PATTERN.test(value)) return 'load-hvac-indoor';
  return null;
}

function legacyLoadIcon(value: string): ElectricalMapIconName {
  if (/REFRIG|CHILL|FREEZ|COOL\s*ROOM|COLD\s*ROOM/.test(value)) return 'load-refrigeration';
  const hvacVariant = hvacVariantIcon(value);
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

export function electricalMapIconForNode(node: {
  kind: string;
  typeCode?: string;
  typeLabel?: string;
  name?: string;
}): ElectricalMapIconName {
  if (node.kind === 'GRID') return 'node-grid';
  if (node.kind === 'VIRTUAL_RESIDUAL') return 'node-residual';
  const typeCode = normalizedCode(node.typeCode);
  if (node.kind === 'BOARD') {
    return BOARD_ICON_BY_CODE[typeCode]
      ?? legacyBoardIcon(`${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase());
  }
  if (node.kind === 'SITE_ASSET') {
    const semanticLabel = `${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase();
    if (typeCode === 'HVAC') return hvacVariantIcon(semanticLabel) ?? 'load-hvac';
    if (typeCode === 'OTHER') return legacyLoadIcon(semanticLabel);
    return LOAD_ICON_BY_CODE[typeCode]
      ?? legacyLoadIcon(semanticLabel);
  }
  return 'load-other';
}

const iconDataUriCache = new Map<ElectricalMapIconName, string>();

export function electricalMapIconDataUri(name: ElectricalMapIconName): string {
  const cached = iconDataUriCache.get(name);
  if (cached) return cached;
  const fileUrl = new URL(`./electrical-map-icons/${name}.png`, import.meta.url);
  const dataUri = `data:image/png;base64,${readFileSync(fileUrl).toString('base64')}`;
  iconDataUriCache.set(name, dataUri);
  return dataUri;
}
