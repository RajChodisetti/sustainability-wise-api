export const LIGHTING_CONTROLS_PHOTO_FIELD = 'switchboardControlsPhoto';
export const LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD = 'switchboardPhotoNotes';

type JsonRecord = Record<string, unknown>;

export function canonicalEcoAuditPhotoFieldName(fieldName: string): string {
  return fieldName === LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD
    ? LIGHTING_CONTROLS_PHOTO_FIELD
    : fieldName;
}

export function ecoAuditPhotoFieldAliases(fieldName: string): string[] {
  const canonical = canonicalEcoAuditPhotoFieldName(fieldName);
  return canonical === LIGHTING_CONTROLS_PHOTO_FIELD
    ? [LIGHTING_CONTROLS_PHOTO_FIELD, LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD]
    : [canonical];
}

export function canonicalizeLightingPhotoMetadata(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const metadata = { ...(value as JsonRecord) };
  if (
    LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD in metadata
    && !(LIGHTING_CONTROLS_PHOTO_FIELD in metadata)
  ) {
    metadata[LIGHTING_CONTROLS_PHOTO_FIELD] = metadata[LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD];
  }
  delete metadata[LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD];
  return metadata;
}

export function canonicalizeLightingSystemPayload<T extends JsonRecord>(input: T): T {
  const output: JsonRecord = { ...input };
  if (
    LIGHTING_CONTROLS_PHOTO_FIELD in input
    || LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD in input
  ) {
    output[LIGHTING_CONTROLS_PHOTO_FIELD] = LIGHTING_CONTROLS_PHOTO_FIELD in input
      ? input[LIGHTING_CONTROLS_PHOTO_FIELD]
      : input[LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD];
  }
  delete output[LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD];
  if ('photoDescs' in input) {
    output.photoDescs = canonicalizeLightingPhotoMetadata(input.photoDescs);
  }
  return output as T;
}

/** Keep remote import working for installed app versions that read the old key. */
export function withLegacyLightingPhotoSyncAlias<T extends JsonRecord>(input: T): T & JsonRecord {
  return {
    ...input,
    [LEGACY_LIGHTING_CONTROLS_PHOTO_FIELD]: input[LIGHTING_CONTROLS_PHOTO_FIELD] ?? null,
  };
}
