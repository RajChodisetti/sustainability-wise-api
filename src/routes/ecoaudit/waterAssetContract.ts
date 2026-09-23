import { badRequest } from '../../utils/errors.js';

export const WATER_ASSET_TYPES = [
  'water_meter',
  'water_submeter_logger',
  'water_fixture',
  'water_asset_system',
] as const;

export type WaterAssetType = typeof WATER_ASSET_TYPES[number];

const WATER_ASSET_TYPE_SET = new Set<string>(WATER_ASSET_TYPES);

export function requiredWaterAssetType(value: unknown): WaterAssetType {
  if (typeof value !== 'string' || !WATER_ASSET_TYPE_SET.has(value)) {
    throw badRequest(`assetType must be one of: ${WATER_ASSET_TYPES.join(', ')}`);
  }
  return value as WaterAssetType;
}

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function customFieldBusinessShape(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const withoutPhotoMetadata = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(withoutPhotoMetadata);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(([key]) => key !== 'photoDescs' && key !== 'photo_descs')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, withoutPhotoMetadata(nested)]),
    );
  };
  return value.map(withoutPhotoMetadata);
}

export function isWaterAssetPhotoMetadataOnlyPatch(
  existingCustomFields: unknown,
  body: Record<string, unknown>,
): boolean {
  const keys = Object.keys(body);
  if (keys.length === 0 || !keys.every((key) => key === 'photoDescs' || key === 'customFields')) {
    return false;
  }
  const existingShape = customFieldBusinessShape(existingCustomFields);
  const incomingShape = 'customFields' in body
    ? customFieldBusinessShape(body.customFields)
    : existingShape;
  return existingShape !== null
    && incomingShape !== null
    && JSON.stringify(existingShape) === JSON.stringify(incomingShape);
}
