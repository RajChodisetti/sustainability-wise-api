import { badRequest } from '../../utils/errors.js';
import { photoMetadata } from './helpers.js';
import { assertCompletedPhotoMetadataReferencesExistingPhotos } from './completedPhotoMetadata.js';

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

function customFieldIdentity(entry: unknown, index: number): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const id = (entry as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id.trim() : `custom-${index + 1}`;
}

function isPhotoMetadataMap(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseCustomFieldPhotoMetadataPatch(
  existingCustomFields: unknown,
  patch: unknown,
): Map<string, unknown> | null {
  if (!Array.isArray(existingCustomFields) || !Array.isArray(patch)) return null;
  const existingIds = new Set(existingCustomFields.map(customFieldIdentity));
  if (existingIds.has(null)) return null;

  const result = new Map<string, unknown>();
  for (const entry of patch) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'photoDescs') return null;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || !existingIds.has(id) || result.has(id) || !isPhotoMetadataMap(record.photoDescs)) {
      return null;
    }
    result.set(id, record.photoDescs);
  }
  return result;
}

export function isWaterAssetPhotoMetadataOnlyPatch(
  existingCustomFields: unknown,
  body: Record<string, unknown>,
): boolean {
  const keys = Object.keys(body);
  if (keys.length === 0 || !keys.every((key) => key === 'photoDescs' || key === 'customFields')) {
    return false;
  }
  if ('photoDescs' in body && !isPhotoMetadataMap(body.photoDescs)) return false;
  return !('customFields' in body)
    || parseCustomFieldPhotoMetadataPatch(existingCustomFields, body.customFields) !== null;
}

/**
 * Apply only nested custom-field photo presentation metadata. The patch cannot
 * carry questions, answers, photo arrays, or any other custom-field content.
 */
export function mergeWaterAssetCustomFieldPhotoMetadata(
  existingCustomFields: unknown,
  patch: unknown,
): unknown[] {
  const parsed = parseCustomFieldPhotoMetadataPatch(existingCustomFields, patch);
  if (!parsed || !Array.isArray(existingCustomFields)) {
    throw badRequest('customFields may contain only existing id and photoDescs values');
  }
  return existingCustomFields.map((entry, index) => {
    const id = customFieldIdentity(entry, index);
    if (!id || !parsed.has(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    return {
      ...(entry as Record<string, unknown>),
      photoDescs: photoMetadata(parsed.get(id)),
    };
  });
}

export function assertWaterAssetCompletedPhotoMetadataReferencesExistingPhotos(
  existing: { photos?: unknown; customFields?: unknown },
  body: Record<string, unknown>,
): void {
  if ('photoDescs' in body) {
    assertCompletedPhotoMetadataReferencesExistingPhotos(existing, body.photoDescs);
  }

  if (!('customFields' in body)) return;
  const parsed = parseCustomFieldPhotoMetadataPatch(existing.customFields, body.customFields);
  if (!parsed || !Array.isArray(existing.customFields)) {
    throw badRequest('customFields may contain only existing id and photoDescs values');
  }

  for (const [id, metadata] of parsed) {
    const customField = existing.customFields.find(
      (entry, index) => customFieldIdentity(entry, index) === id,
    );
    if (!customField || typeof customField !== 'object' || Array.isArray(customField)) {
      throw badRequest(`customFields.${id} does not reference an existing custom field`);
    }
    assertCompletedPhotoMetadataReferencesExistingPhotos(
      customField,
      metadata,
      `customFields.${id}.photoDescs`,
    );
  }
}
