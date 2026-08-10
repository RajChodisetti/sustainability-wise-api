/**
 * Stable semantic names shared by the client map and server-rendered reports.
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

export const ELECTRICAL_MAP_ICON_VIEW_BOX = '0 0 64 64' as const;

export type ElectricalMapIconSvgDefinition = Readonly<{
  name: ElectricalMapIconName;
  viewBox: typeof ELECTRICAL_MAP_ICON_VIEW_BOX;
  body: string;
}>;

/** The portal uses the same normalized optical lift for its schematic symbols. */
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

type SchematicCategory = 'board' | 'grid' | 'load' | 'meter' | 'residual';

const SCHEMATIC_PALETTE: Readonly<Record<SchematicCategory, Readonly<{
  stroke: string;
  tint: string;
}>>> = {
  grid: { stroke: '#9A551D', tint: '#FFF7ED' },
  meter: { stroke: '#0F766E', tint: '#ECFDF5' },
  residual: { stroke: '#475569', tint: '#F8FAFC' },
  board: { stroke: '#1D4ED8', tint: '#EFF6FF' },
  load: { stroke: '#166534', tint: '#F0FDF4' },
};

function schematicIcon(
  name: ElectricalMapIconName,
  category: SchematicCategory,
  drawing: string,
): string {
  const palette = SCHEMATIC_PALETTE[category];
  return `<g data-schematic-icon="${name}"><rect x="3" y="3" width="58" height="58" rx="15" fill="${palette.tint}" stroke="${palette.stroke}" stroke-width="1.4"/><g fill="none" stroke="${palette.stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></g>`;
}

function phaseRow(phase: 'L1' | 'L2' | 'L3', y: number): string {
  return `<g data-phase-rail="${phase}"><text x="13" y="${y + 2}" fill="#1D4ED8" stroke="none" font-family="Arial,Helvetica,sans-serif" font-size="5" font-weight="700">${phase}</text><path d="M23 ${y}H49"/><rect data-breaker-phase="${phase}" x="31" y="${y - 3}" width="8" height="6" rx="1.2" fill="#DBEAFE"/><circle data-phase-port="${phase}" cx="49" cy="${y}" r="1.8" fill="#1D4ED8" stroke="none"/></g>`;
}

function boardIcon(
  name: Extract<ElectricalMapIconName, `board-${string}`>,
  code: string,
  cue: string,
): string {
  return schematicIcon(name, 'board', `<rect x="10" y="8" width="44" height="48" rx="4" fill="#FFFFFF"/><path d="M10 19H54"/><text x="14" y="15.5" fill="#1D4ED8" stroke="none" font-family="Arial,Helvetica,sans-serif" font-size="5.5" font-weight="700">${code}</text>${cue}<g data-board-phase-rails="true">${phaseRow('L1', 28)}${phaseRow('L2', 38)}${phaseRow('L3', 48)}</g>`);
}

const SCHEMATIC_BODIES = {
  'node-grid': schematicIcon('node-grid', 'grid', `<path d="M18 52L32 11l14 41M22 41h20M25 32h14M28 23h8M13 18h38M18 18l7 7m21-7-7 7"/><path d="M34 25l-7 11h7l-5 10 11-14h-7z" fill="#FFEDD5"/>`),
  'node-meter': schematicIcon('node-meter', 'meter', `<rect x="14" y="9" width="36" height="45" rx="5" fill="#FFFFFF"/><rect x="20" y="15" width="24" height="12" rx="2" fill="#CCFBF1"/><path d="M23 33h18M21 39h22"/><circle cx="22" cy="47" r="2.5" fill="#A7F3D0"/><circle cx="32" cy="47" r="2.5" fill="#A7F3D0"/><circle cx="42" cy="47" r="2.5" fill="#A7F3D0"/><path d="M33 16l-4 6h4l-2 4 6-7h-4z" fill="#0F766E"/>`),
  'node-residual': schematicIcon('node-residual', 'residual', `<path d="M16 17h31L29 32l18 15H16"/><path d="M18 54c8-7 20-7 28 0" stroke-dasharray="3 4"/><circle cx="16" cy="17" r="2" fill="#475569"/><circle cx="16" cy="47" r="2" fill="#475569"/>`),
  'board-msb': boardIcon('board-msb', 'MSB', `<path d="M44 11v5m-3-2.5h6"/>`),
  'board-mssb': boardIcon('board-mssb', 'MSSB', `<path d="M43 11v5m0-2.5h5m-5 0h-4"/>`),
  'board-db': boardIcon('board-db', 'DB', `<rect x="40" y="11" width="4" height="4" rx=".6" fill="#DBEAFE"/><rect x="47" y="11" width="4" height="4" rx=".6" fill="#DBEAFE"/>`),
  'board-hvac-db': boardIcon('board-hvac-db', 'HVAC', `<circle cx="47" cy="13.5" r="3"/><path d="M47 10.5v6m-2.6-4.5 5.2 3m0-3-5.2 3"/>`),
  'board-lighting-db': boardIcon('board-lighting-db', 'LX', `<circle cx="47" cy="12.5" r="2.5"/><path d="M45 16h4m-2-7V7.5m-4.2 2.3-1-1m9.4 1 1-1"/>`),
  'board-pv-db': boardIcon('board-pv-db', 'PV', `<path d="M41 15h9l-1.5-5h-6zM44 10l-1 5m3.5-5-1 5"/>`),
  'board-mcc': boardIcon('board-mcc', 'MCC', `<circle cx="41" cy="13" r="2" fill="#DBEAFE"/><circle cx="47" cy="13" r="2" fill="#DBEAFE"/><circle cx="53" cy="13" r="2" fill="#DBEAFE"/>`),
  'board-other': boardIcon('board-other', 'SWB', `<path d="M41 11h10m-10 5h10M44 11v5m4-5v5"/>`),
  'load-pv': schematicIcon('load-pv', 'load', `<path d="M13 44h38l-5-25H18z" fill="#DCFCE7"/><path d="M25 19l-3 25m17-25 3 25M15 32h34M32 44v8m-8 0h16"/><circle cx="49" cy="14" r="4" fill="#FEF3C7"/><path d="M49 7V5m0 18v-2m7-7h2m-18 0h2m11.8-4.8 1.5-1.5M42.7 20.3l1.5-1.5"/>`),
  'load-hvac': schematicIcon('load-hvac', 'load', `<circle cx="32" cy="32" r="18" fill="#FFFFFF"/><circle cx="32" cy="32" r="3" fill="#166534"/><path d="M32 29c-2-9 2-12 7-10 4 3 1 9-7 10zM35 33c9-2 12 2 10 7-3 4-9 1-10-7zM30 35c2 9-2 12-7 10-4-3-1-9 7-10zM29 30c-9 2-12-2-10-7 3-4 9-1 10 7z" fill="#BBF7D0"/>`),
  'load-hvac-indoor': schematicIcon('load-hvac-indoor', 'load', `<rect x="10" y="16" width="44" height="23" rx="5" fill="#FFFFFF"/><path d="M16 23h32M18 31h28M21 39c0 6-5 6-5 11m16-11c0 6-5 6-5 11m16-11c0 6-5 6-5 11"/><circle cx="47" cy="27" r="1.5" fill="#166534" stroke="none"/>`),
  'load-hvac-condenser': schematicIcon('load-hvac-condenser', 'load', `<rect x="10" y="10" width="44" height="44" rx="5" fill="#FFFFFF"/><circle cx="32" cy="32" r="14"/><circle cx="32" cy="32" r="2.5" fill="#166534"/><path d="M32 29c-2-7 2-9 6-7 3 3 0 7-6 7zM35 33c7-2 9 2 7 6-3 3-7 0-7-6zM30 35c2 7-2 9-6 7-3-3 0-7 6-7zM29 30c-7 2-9-2-7-6 3-3 7 0 7 6z" fill="#BBF7D0"/><path d="M15 49h34"/>`),
  'load-lighting': schematicIcon('load-lighting', 'load', `<path d="M21 27a11 11 0 1 1 22 0c0 6-5 8-7 13h-8c-2-5-7-7-7-13z" fill="#FEF3C7"/><path d="M27 45h10m-9 5h8M32 8v5m17 14h5M10 27h5m29-13-4 4M20 18l-4-4"/>`),
  'load-ev-charger': schematicIcon('load-ev-charger', 'load', `<rect x="13" y="10" width="29" height="44" rx="5" fill="#FFFFFF"/><rect x="19" y="16" width="17" height="11" rx="2" fill="#DCFCE7"/><path d="M29 17l-5 7h5l-3 6 8-9h-5z" fill="#166534"/><path d="M42 23h4c4 0 6 3 6 7v10c0 4-2 7-6 7h-4M49 17v7m-3-4h6"/><circle cx="27.5" cy="44" r="3"/>`),
  'load-vehicle-hoist': schematicIcon('load-vehicle-hoist', 'load', `<path d="M13 12v42m38-42v42M10 18h9m26 0h9M18 45h28"/><path d="M20 37l5-8h14l5 8z" fill="#DCFCE7"/><circle cx="25" cy="39" r="3" fill="#FFFFFF"/><circle cx="39" cy="39" r="3" fill="#FFFFFF"/><path d="M17 22h30"/>`),
  'load-forklift': schematicIcon('load-forklift', 'load', `<path d="M10 45h39M15 42V25h18l6 17M18 25v-8h10l5 8M39 16v26m0-23h8m0-6v32m0 0h8"/><circle cx="21" cy="46" r="5" fill="#FFFFFF"/><circle cx="39" cy="46" r="4" fill="#FFFFFF"/><path d="M17 31h17"/>`),
  'load-exhaust-fan': schematicIcon('load-exhaust-fan', 'load', `<path d="M9 22h11m24 0h11M9 42h11m24 0h11"/><circle cx="32" cy="32" r="17" fill="#FFFFFF"/><circle cx="32" cy="32" r="3" fill="#166534"/><path d="M32 29c-2-9 3-12 8-9 4 4 0 9-8 9zM35 32c9-2 12 3 9 8-4 4-9 0-9-8zM32 35c2 9-3 12-8 9-4-4 0-9 8-9zM29 32c-9 2-12-3-9-8 4-4 9 0 9 8z" fill="#BBF7D0"/>`),
  'load-power-outlet': schematicIcon('load-power-outlet', 'load', `<rect x="14" y="9" width="36" height="46" rx="7" fill="#FFFFFF"/><path d="M24 22v8m16-8v8M24 39c5 6 11 6 16 0"/><circle cx="32" cy="41" r="2" fill="#166534"/><path d="M20 15h24"/>`),
  'load-hot-water': schematicIcon('load-hot-water', 'load', `<rect x="18" y="11" width="28" height="43" rx="12" fill="#FFFFFF"/><path d="M25 7c-3 4 3 5 0 9m8-9c-3 4 3 5 0 9m8-9c-3 4 3 5 0 9M18 43h28"/><path d="M32 22c5 6 7 9 7 13a7 7 0 0 1-14 0c0-4 2-7 7-13z" fill="#DCFCE7"/>`),
  'load-refrigeration': schematicIcon('load-refrigeration', 'load', `<rect x="14" y="7" width="36" height="50" rx="5" fill="#FFFFFF"/><path d="M14 31h36M21 20h4m-4 21h4M32 15v32m-8-28 16 24m0-24L24 43"/><circle cx="32" cy="31" r="3" fill="#DCFCE7"/>`),
  'load-compressed-air': schematicIcon('load-compressed-air', 'load', `<rect x="14" y="22" width="38" height="27" rx="13" fill="#FFFFFF"/><circle cx="23" cy="19" r="8" fill="#DCFCE7"/><path d="M23 19l4-3M23 11V8m-9 11h-3m12 30v6m20-6v6M31 22v-7h13v7m8 13h4m-44 0H8"/>`),
  'load-other': schematicIcon('load-other', 'load', `<path d="M10 52V25l14-8v8l14-8v9l16-8v34z" fill="#FFFFFF"/><path d="M16 33h5m7 0h5m7 0h5M16 41h5m7 0h5m7 0h5M25 52V41h12v11"/><path d="M46 12v8m-4-4h8"/>`),
} satisfies Readonly<Record<ElectricalMapIconName, string>>;

const SVG_DEFINITIONS = Object.fromEntries(ELECTRICAL_MAP_ICON_NAMES.map((name) => [
  name,
  Object.freeze({
    name,
    viewBox: ELECTRICAL_MAP_ICON_VIEW_BOX,
    body: SCHEMATIC_BODIES[name],
  }),
])) as Readonly<Record<ElectricalMapIconName, ElectricalMapIconSvgDefinition>>;

export function electricalMapIconSvgDefinition(
  name: ElectricalMapIconName,
): ElectricalMapIconSvgDefinition {
  return SVG_DEFINITIONS[name];
}

export function electricalMapIconSvg(name: ElectricalMapIconName): string {
  const definition = electricalMapIconSvgDefinition(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${definition.viewBox}">${definition.body}</svg>`;
}

const iconDataUriCache = new Map<ElectricalMapIconName, string>();

export function electricalMapIconDataUri(name: ElectricalMapIconName): string {
  const cached = iconDataUriCache.get(name);
  if (cached) return cached;
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(electricalMapIconSvg(name))}`;
  iconDataUriCache.set(name, dataUri);
  return dataUri;
}
