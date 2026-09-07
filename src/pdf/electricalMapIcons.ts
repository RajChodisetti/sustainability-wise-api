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
  ['node-residual', 'Calculated residual'],
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
  ['load-exhaust-fan', 'Exhaust / air fan'],
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
  accent: string;
  tint: string;
}>>> = {
  grid: { accent: '#9A551D', tint: '#FFF7ED' },
  meter: { accent: '#0F766E', tint: '#ECFDF5' },
  residual: { accent: '#475569', tint: '#F8FAFC' },
  board: { accent: '#1D4ED8', tint: '#EFF6FF' },
  load: { accent: '#166534', tint: '#F0FDF4' },
};

function filled(accent: string): string {
  return ` fill="${accent}" fill-opacity="0.14"`;
}

function schematicIcon(
  name: ElectricalMapIconName,
  category: Exclude<SchematicCategory, 'board'>,
  drawing: (accent: string) => string,
): string {
  const palette = SCHEMATIC_PALETTE[category];
  return `<g data-schematic-icon="${name}"><rect x="3" y="3" width="58" height="58" rx="15" fill="${palette.tint}"/><g fill="none" stroke="${palette.accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${drawing(palette.accent)}</g></g>`;
}

function phaseRow(phase: 'L1' | 'L2' | 'L3', y: number, accent: string): string {
  return `<g data-phase-rail="${phase}"><text x="14" y="${y + 1.7}" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="4.4" font-weight="900">${phase}</text><line x1="23" y1="${y}" x2="50" y2="${y}" stroke="${accent}" stroke-width="1.4"/><rect data-breaker-phase="${phase}" x="31" y="${y - 3}" width="8" height="6" rx="1.2" fill="#DBEAFE" stroke="${accent}" stroke-width="0.9"/><circle data-phase-port="${phase}" data-channel-port="true" data-channel-phase="${phase}" cx="51" cy="${y}" r="1.6" fill="${accent}"/></g>`;
}

function boardIcon(
  name: Extract<ElectricalMapIconName, `board-${string}`>,
  code: string,
): string {
  const { accent, tint } = SCHEMATIC_PALETTE.board;
  return `<g data-schematic-icon="${name}"><rect x="3" y="3" width="58" height="58" rx="15" fill="${tint}"/><rect x="9" y="7" width="46" height="50" rx="4" fill="#FFFFFF" fill-opacity="0.94" stroke="${accent}" stroke-width="2.4"/><path d="M9 18h46" fill="none" stroke="${accent}" stroke-width="1.4"/><circle cx="49" cy="12.5" r="1.7" fill="${accent}" opacity="0.88"/><text x="14" y="14.8" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="5.2" font-weight="900" letter-spacing="0.18">${code}</text><g data-board-phase-rails="true" data-board-phase-fallback="true">${phaseRow('L1', 27, accent)}${phaseRow('L2', 37, accent)}${phaseRow('L3', 47, accent)}</g></g>`;
}

/** Exact canonical geometry used by the portal's code-native symbol registry. */
const SCHEMATIC_BODIES = {
  'node-grid': schematicIcon('node-grid', 'grid', (accent) => `<path d="M18 52 27 12h10l9 40M23 34h18M20 43h24M27 12l-9 13h28L37 12"/><path d="m34 22-7 10h6l-2 9 7-11h-6l2-8Z"${filled(accent)}/><line x1="14" y1="53" x2="50" y2="53"/>`),
  'node-meter': schematicIcon('node-meter', 'meter', (accent) => `<rect x="14" y="8" width="36" height="48" rx="5"/><rect x="20" y="15" width="24" height="12" rx="2"${filled(accent)}/><line x1="23" y1="32" x2="41" y2="32"/><circle cx="23" cy="45" r="3"/><circle cx="32" cy="45" r="3"/><circle cx="41" cy="45" r="3"/><line x1="23" y1="48" x2="23" y2="54"/><line x1="32" y1="48" x2="32" y2="54"/><line x1="41" y1="48" x2="41" y2="54"/>`),
  'node-residual': schematicIcon('node-residual', 'residual', () => `<circle cx="32" cy="32" r="22" stroke-dasharray="4 3"/><path d="M13 34h8l5-14 10 27 6-15h9"/><polyline points="45,26 51,32 45,38"/>`),
  'board-msb': boardIcon('board-msb', 'MSB'),
  'board-mssb': boardIcon('board-mssb', 'MSSB'),
  'board-db': boardIcon('board-db', 'DB'),
  'board-hvac-db': boardIcon('board-hvac-db', 'HVAC'),
  'board-lighting-db': boardIcon('board-lighting-db', 'LIGHT'),
  'board-pv-db': boardIcon('board-pv-db', 'PV'),
  'board-mcc': boardIcon('board-mcc', 'MCC'),
  'board-other': boardIcon('board-other', 'SWB'),
  'load-pv': schematicIcon('load-pv', 'load', () => `<circle cx="18" cy="17" r="6"/><line x1="18" y1="7" x2="18" y2="4"/><line x1="8" y1="17" x2="5" y2="17"/><line x1="25" y1="10" x2="28" y2="7"/><polyline points="14,30 49,30 54,51 9,51 14,30"/><line x1="21" y1="30" x2="18" y2="51"/><line x1="32" y1="30" x2="32" y2="51"/><line x1="43" y1="30" x2="47" y2="51"/><line x1="11" y1="41" x2="52" y2="41"/>`),
  'load-hvac': schematicIcon('load-hvac', 'load', (accent) => `<circle cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="3"${filled(accent)}/><path d="M32 29c-3-12 8-15 13-8 4 6-3 10-10 11M35 32c12-3 15 8 8 13-6 4-10-3-11-10M32 35c3 12-8 15-13 8-4-6 3-10 10-11M29 32c-12 3-15-8-8-13 6-4 10 3 11 10"/>`),
  'load-hvac-indoor': schematicIcon('load-hvac-indoor', 'load', () => `<rect x="8" y="17" width="48" height="24" rx="5"/><line x1="14" y1="25" x2="50" y2="25"/><line x1="17" y1="32" x2="47" y2="32"/><path d="M18 47c3-4 6-4 9 0M30 47c3-4 6-4 9 0M42 47c3-4 6-4 9 0"/>`),
  'load-hvac-condenser': schematicIcon('load-hvac-condenser', 'load', (accent) => `<rect x="9" y="10" width="46" height="43" rx="4"/><circle cx="32" cy="31" r="15"/><circle cx="32" cy="31" r="3"${filled(accent)}/><path d="M32 28c-2-9 6-11 10-6 3 5-2 8-8 9M35 31c9-2 11 6 6 10-5 3-8-2-9-8M32 34c2 9-6 11-10 6-3-5 2-8 8-9"/><line x1="17" y1="53" x2="17" y2="57"/><line x1="47" y1="53" x2="47" y2="57"/>`),
  'load-lighting': schematicIcon('load-lighting', 'load', () => `<path d="M21 27a11 11 0 1 1 22 0c0 6-6 8-6 13H27c0-5-6-7-6-13ZM27 46h10M29 52h6"/><line x1="32" y1="7" x2="32" y2="3"/><line x1="14" y1="13" x2="11" y2="10"/><line x1="50" y1="13" x2="53" y2="10"/><line x1="10" y1="28" x2="5" y2="28"/><line x1="54" y1="28" x2="59" y2="28"/>`),
  'load-ev-charger': schematicIcon('load-ev-charger', 'load', (accent) => `<rect x="10" y="11" width="29" height="42" rx="5"/><rect x="16" y="18" width="17" height="10" rx="2"${filled(accent)}/><path d="m27 33-7 9h6l-2 7 8-10h-6l1-6Z"${filled(accent)}/><path d="M39 26h5c6 0 7 5 7 10v8M47 17v8M55 17v8M45 25h12"/>`),
  'load-vehicle-hoist': schematicIcon('load-vehicle-hoist', 'load', (accent) => `<line x1="13" y1="12" x2="13" y2="53"/><line x1="51" y1="12" x2="51" y2="53"/><line x1="9" y1="12" x2="17" y2="12"/><line x1="47" y1="12" x2="55" y2="12"/><path d="M17 40h30l-3-10H22l-5 10Z"${filled(accent)}/><circle cx="23" cy="42" r="4"/><circle cx="41" cy="42" r="4"/><line x1="13" y1="48" x2="51" y2="48"/>`),
  'load-forklift': schematicIcon('load-forklift', 'load', (accent) => `<path d="M10 18h21v24H10V18Zm21 11h10l7 13H31V29Z"${filled(accent)}/><line x1="49" y1="12" x2="49" y2="43"/><line x1="49" y1="43" x2="57" y2="43"/><circle cx="18" cy="48" r="6"/><circle cx="40" cy="48" r="6"/><line x1="17" y1="18" x2="17" y2="10"/><line x1="17" y1="10" x2="34" y2="10"/>`),
  'load-exhaust-fan': schematicIcon('load-exhaust-fan', 'load', (accent) => `<rect x="8" y="8" width="48" height="48" rx="5"/><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="3"${filled(accent)}/><path d="M32 29c-3-12 9-14 13-7 3 6-4 9-10 10M35 32c12-3 14 9 7 13-6 3-9-4-10-10M32 35c3 12-9 14-13 7-3-6 4-9 10-10"/>`),
  'load-power-outlet': schematicIcon('load-power-outlet', 'load', () => `<rect x="12" y="9" width="40" height="46" rx="7"/><line x1="24" y1="23" x2="24" y2="32"/><line x1="40" y1="23" x2="40" y2="32"/><path d="M26 41h12M32 37v8"/><circle cx="32" cy="41" r="12"/>`),
  'load-hot-water': schematicIcon('load-hot-water', 'load', (accent) => `<rect x="15" y="6" width="34" height="51" rx="12"/><path d="M32 18s9 9 9 16a9 9 0 0 1-18 0c0-7 9-16 9-16Z"${filled(accent)}/><line x1="22" y1="11" x2="42" y2="11"/><line x1="22" y1="52" x2="42" y2="52"/>`),
  'load-refrigeration': schematicIcon('load-refrigeration', 'load', () => `<rect x="14" y="6" width="36" height="52" rx="5"/><line x1="14" y1="29" x2="50" y2="29"/><line x1="22" y1="16" x2="22" y2="24"/><line x1="22" y1="36" x2="22" y2="44"/><path d="M38 12v12M32 15l12 6M44 15l-12 6"/>`),
  'load-compressed-air': schematicIcon('load-compressed-air', 'load', () => `<rect x="9" y="23" width="46" height="27" rx="13"/><circle cx="32" cy="17" r="8"/><line x1="32" y1="17" x2="37" y2="13"/><line x1="18" y1="50" x2="18" y2="56"/><line x1="46" y1="50" x2="46" y2="56"/><path d="M14 35h7l4-5h15l4 5h6"/>`),
  'load-other': schematicIcon('load-other', 'load', (accent) => `<path d="M10 54V19l20-9v44M30 27h24v27M17 25h5M17 34h5M17 43h5M38 35h8M38 44h8M7 54h50"/><path d="m43 13-6 9h6l-2 8 8-10h-6l0-7Z"${filled(accent)}/>`),
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
