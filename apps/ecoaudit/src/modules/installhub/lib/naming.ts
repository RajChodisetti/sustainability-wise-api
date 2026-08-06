import type {
  DisplayCodeMetadata,
  InstallationTree,
  Zone,
} from '@/modules/installhub/types/domain';

export const ZONE_CODE_MAX_LENGTH = 16;
export const ENTITY_NAME_MAX_LENGTH = 64;
export const DISPLAY_CODE_MAX_LENGTH = 64;
export const ZONE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function identifierSegment(value: string, maxLength: number): string {
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function normalizedZoneCode(value: string): string {
  return identifierSegment(value, ZONE_CODE_MAX_LENGTH) || 'ZONE';
}

export function isValidZoneCode(value: string): boolean {
  return value.length > 0
    && value.length <= ZONE_CODE_MAX_LENGTH
    && ZONE_CODE_PATTERN.test(value);
}

function uniqueDerivedZoneCode(baseValue: string, used: Set<string>): string {
  const base = normalizedZoneCode(baseValue);
  if (!used.has(base)) return base;
  for (let ordinal = 2; ; ordinal += 1) {
    const suffix = `-${ordinal}`;
    const candidate = `${base.slice(0, ZONE_CODE_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Resolve legacy zones without a persisted code in the same stable order as
 * the canonical API. Explicit valid codes are reserved before derivation.
 */
export function resolvedZoneCodes(
  zones: readonly Pick<Zone, 'id' | 'zoneName' | 'zoneCode'>[],
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const zone of zones) {
    const explicit = zone.zoneCode?.trim().toUpperCase() || '';
    if (!isValidZoneCode(explicit) || used.has(explicit)) continue;
    result.set(zone.id, explicit);
    used.add(explicit);
  }
  for (const zone of [...zones].sort((left, right) => left.id.localeCompare(right.id))) {
    if (result.has(zone.id)) continue;
    const derived = uniqueDerivedZoneCode(zone.zoneName, used);
    result.set(zone.id, derived);
    used.add(derived);
  }
  return result;
}

export function availableZoneCode(
  tree: Pick<InstallationTree, 'zones'>,
  zoneName: string,
  excludeZoneId?: string,
): string {
  const resolved = resolvedZoneCodes(tree.zones);
  const used = new Set(
    [...resolved.entries()]
      .filter(([id]) => id !== excludeZoneId)
      .map(([, code]) => code),
  );
  return uniqueDerivedZoneCode(zoneName, used);
}

export function isZoneCodeAvailable(
  tree: Pick<InstallationTree, 'zones'>,
  zoneCode: string,
  excludeZoneId?: string,
): boolean {
  const candidate = zoneCode.trim().toUpperCase();
  if (!isValidZoneCode(candidate)) return false;
  const otherZones = tree.zones.filter((zone) => zone.id !== excludeZoneId);
  return ![...resolvedZoneCodes(otherZones).values()].includes(candidate);
}

export function normalizedCustomName(value: string, fallback: string): string {
  return identifierSegment(value, DISPLAY_CODE_MAX_LENGTH)
    || identifierSegment(fallback, DISPLAY_CODE_MAX_LENGTH)
    || 'ASSET';
}

export function defaultCustomNameForType(
  options: readonly { code: string; label: string }[],
  typeCode: string,
  customTypeName?: string | null,
): string {
  const label = options.find((option) => option.code === typeCode)?.label
    || typeCode
    || 'Asset';
  return typeCode === 'OTHER'
    ? customTypeName?.trim() || label
    : label;
}

/** Keep an installer edit, but advance an untouched type-derived default. */
export function nameAfterTypeChange(
  currentName: string,
  previousDefault: string,
  nextDefault: string,
): string {
  const current = currentName.trim();
  return !current || current === previousDefault.trim()
    ? nextDefault
    : currentName;
}

export function defaultMeterCustomName(input: {
  deviceModel: 'A3RM' | 'A6M' | 'OTHER' | 'Other';
  customManufacturerName?: string | null;
  customModelName?: string | null;
}): string {
  if (input.deviceModel === 'A3RM') return 'A3RM Meter';
  if (input.deviceModel === 'A6M') return 'A6M Meter';
  return input.customModelName?.trim()
    || input.customManufacturerName?.trim()
    || 'Other Meter';
}

function sitePrefix(tree: Pick<InstallationTree, 'installation'>): string {
  const explicit = identifierSegment(tree.installation.siteCode || '', 16);
  if (explicit) return explicit;
  const words = tree.installation.siteName.match(/[A-Za-z0-9]+/g) || [];
  return words.map((word) => word[0]).join('').toUpperCase().slice(0, 8) || 'SITE';
}

function displayedCodes(
  tree: InstallationTree,
  excludeId?: string,
): string[] {
  const values = [
    ...tree.electricalAssets
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => entity.displayCodeMeta?.value || entity.displayCode),
    ...tree.siteAssets
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => entity.displayCodeMeta?.value || entity.displayCode || ''),
  ];
  if (tree.meterDevices) {
    values.push(...tree.meterDevices
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => entity.displayName.value));
  } else {
    values.push(...tree.electricalAssets.flatMap((board) => board.meters
      .filter((entity) => entity.id !== excludeId)
      .map((entity) => entity.deviceName)));
  }
  return values.filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sequenceForPrefix(value: string, prefix: string): number | undefined {
  const match = value.match(new RegExp(`^${escapeRegExp(prefix)}-(\\d+)-`, 'i'));
  if (!match) return undefined;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
}

function largestSequenceForZone(
  tree: InstallationTree,
  zoneId: string,
  excludeId?: string,
): number {
  const zoneCode = resolvedZoneCodes(tree.zones).get(zoneId) || 'ZONE';
  const prefix = `${sitePrefix(tree)}-${zoneCode}`;
  return displayedCodes(tree, excludeId).reduce(
    (largest, value) => Math.max(
      largest,
      sequenceForPrefix(value, prefix) ?? 0,
    ),
    0,
  );
}

function generatedWithSequence(
  tree: InstallationTree,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
  },
  sequence: number,
): string {
  const zoneCode = resolvedZoneCodes(tree.zones).get(input.zoneId) || 'ZONE';
  const prefix = `${sitePrefix(tree)}-${zoneCode}`;
  const ordinal = String(sequence).padStart(2, '0');
  const fixedPrefix = `${prefix}-${ordinal}-`;
  const fallback = normalizedCustomName(input.fallbackType, 'ASSET');
  const available = Math.max(1, DISPLAY_CODE_MAX_LENGTH - fixedPrefix.length);
  const suffix = normalizedCustomName(input.customName, fallback)
    .slice(0, available)
    .replace(/-+$/g, '')
    || fallback.slice(0, available);
  return `${fixedPrefix}${suffix}`
    .slice(0, DISPLAY_CODE_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export function generatedDisplayCodeV2(
  tree: InstallationTree,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
    excludeId?: string;
  },
): string {
  return generatedWithSequence(
    tree,
    input,
    largestSequenceForZone(tree, input.zoneId, input.excludeId) + 1,
  );
}

export function provisionalDisplayCodeV2(
  tree: InstallationTree,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
    excludeId?: string;
    current?: DisplayCodeMetadata;
    previousZoneCode?: string;
  },
): DisplayCodeMetadata {
  if (input.current && (
    input.current.isOverridden
    || input.current.provisional !== true
    || input.current.ruleVersion < 2
  )) {
    return input.current;
  }
  const currentValue = input.current?.generatedValue || input.current?.value || '';
  const zoneCode = resolvedZoneCodes(tree.zones).get(input.zoneId) || 'ZONE';
  const currentPrefix = `${sitePrefix(tree)}-${zoneCode}`;
  const previousPrefix = input.previousZoneCode
    ? `${sitePrefix(tree)}-${normalizedZoneCode(input.previousZoneCode)}`
    : '';
  const retainedSequence = sequenceForPrefix(currentValue, currentPrefix)
    ?? (previousPrefix
      ? sequenceForPrefix(currentValue, previousPrefix)
      : undefined);
  const generatedValue = generatedWithSequence(
    tree,
    input,
    retainedSequence
      ?? largestSequenceForZone(tree, input.zoneId, input.excludeId) + 1,
  );
  return {
    value: generatedValue,
    generatedValue,
    isOverridden: false,
    ruleVersion: 2,
    provisional: true,
  };
}

/** Re-project only unconfirmed v2 identities after a zone-code edit. */
export function refreshProvisionalCodesForZone(
  tree: InstallationTree,
  zoneId: string,
  previousZoneCode?: string,
): void {
  for (const board of tree.electricalAssets.filter((item) => item.zoneId === zoneId)) {
    const display = provisionalDisplayCodeV2(tree, {
      zoneId,
      customName: board.assetName,
      fallbackType: board.typeCode || board.assetType,
      excludeId: board.id,
      current: board.displayCodeMeta,
      previousZoneCode,
    });
    board.displayCodeMeta = display;
    board.displayCode = display.value;
  }
  for (const asset of tree.siteAssets.filter((item) => item.zoneId === zoneId)) {
    const display = provisionalDisplayCodeV2(tree, {
      zoneId,
      customName: asset.assetName,
      fallbackType: asset.typeCode || asset.assetType,
      excludeId: asset.id,
      current: asset.displayCodeMeta,
      previousZoneCode,
    });
    asset.displayCodeMeta = display;
    asset.displayCode = display.value;
  }
  const boardIds = new Set(
    tree.electricalAssets
      .filter((item) => item.zoneId === zoneId)
      .map((item) => item.id),
  );
  for (const meter of (tree.meterDevices || []).filter((item) => (
    boardIds.has(item.installedOnBoardId)
  ))) {
    const fallback = defaultMeterCustomName(meter);
    const customName = meter.customName?.trim() || fallback;
    meter.customName = customName;
    meter.displayName = provisionalDisplayCodeV2(tree, {
      zoneId,
      customName,
      fallbackType: fallback,
      excludeId: meter.id,
      current: meter.displayName,
      previousZoneCode,
    });
  }
}
