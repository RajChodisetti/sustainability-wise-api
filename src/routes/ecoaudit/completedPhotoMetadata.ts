import { badRequest } from '../../utils/errors.js';

function isPresentPhoto(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function referencesExistingPhoto(record: object, key: string): boolean {
  const match = /^([A-Za-z][A-Za-z0-9]*)(?:\.(0|[1-9]\d*))?$/.exec(key);
  if (!match) return false;

  const [, fieldName, rawIndex] = match;
  if (!fieldName.toLowerCase().includes('photo')) return false;
  const value = (record as Record<string, unknown>)[fieldName];

  if (rawIndex === undefined) return isPresentPhoto(value);
  if (!Array.isArray(value)) return false;
  return isPresentPhoto(value[Number(rawIndex)]);
}

/**
 * Completed-record corrections may describe only photos that are already on
 * the record. Draft writes deliberately do not call this validator so their
 * existing compatibility and authoring behavior remains unchanged.
 */
export function assertCompletedPhotoMetadataReferencesExistingPhotos(
  record: object,
  photoDescs: unknown,
  path = 'photoDescs',
): void {
  if (!photoDescs || typeof photoDescs !== 'object' || Array.isArray(photoDescs)) {
    throw badRequest(`${path} must be an object`);
  }

  for (const key of Object.keys(photoDescs)) {
    if (!referencesExistingPhoto(record, key)) {
      throw badRequest(`${path}.${key} does not reference an existing photo`);
    }
  }
}
