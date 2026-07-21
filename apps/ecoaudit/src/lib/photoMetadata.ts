export type PhotoMetadata = {
  name?: string;
  largeInPdf?: boolean;
};

export type PhotoMetadataValue = string | PhotoMetadata | null | undefined;
export type PhotoMetadataMap = Record<string, PhotoMetadataValue>;

const PHOTO_FIELD_ALIASES: Record<string, string> = {
  switchboardPhotoNotes: 'switchboardControlsPhoto',
  switchboard_photo_notes: 'switchboardControlsPhoto',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function canonicalPhotoFieldName(fieldName: string): string {
  const trimmed = fieldName.trim();
  if (!trimmed) return '';
  return PHOTO_FIELD_ALIASES[trimmed] ?? snakeToCamel(trimmed);
}

export function parsePhotoFieldName(fieldName: string): { fieldName: string; index?: number } {
  const trimmed = fieldName.trim();
  if (!trimmed) return { fieldName: '' };

  const arrayMatch = /^([A-Za-z][A-Za-z0-9_]*?)(?:\[(\d+)\]|_(\d+)|\.(\d+))$/.exec(trimmed);
  if (arrayMatch) {
    return {
      fieldName: canonicalPhotoFieldName(arrayMatch[1]),
      index: Number(arrayMatch[2] ?? arrayMatch[3] ?? arrayMatch[4]),
    };
  }

  return { fieldName: canonicalPhotoFieldName(trimmed) };
}

export function photoMetadataKeyFromUploadField(fieldName: string | null | undefined): string {
  if (!fieldName) return '';
  const parsed = parsePhotoFieldName(fieldName);
  return parsed.fieldName ? photoMetadataKey(parsed.fieldName, parsed.index) : '';
}

export function normalizePhotoMetadata(value: unknown): PhotoMetadata {
  if (!value) return {};
  if (typeof value === 'string') return value ? { name: value } : {};
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.largeInPdf ? { largeInPdf: true } : {}),
  };
}

export function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  if (!isRecord(value)) return {};

  const output: Record<string, PhotoMetadata> = {};
  const priorityByKey: Record<string, number> = {};

  for (const [rawKey, rawMeta] of Object.entries(value)) {
    const key = photoMetadataKeyFromUploadField(rawKey);
    const meta = normalizePhotoMetadata(rawMeta);
    if (!key || !hasPhotoMetadata(meta)) continue;

    const existing = normalizePhotoMetadata(output[key]);
    const rawPriority = rawKey === key ? 2 : 1;
    const previousPriority = priorityByKey[key] ?? 0;
    output[key] = rawPriority >= previousPriority
      ? { ...existing, ...meta }
      : { ...meta, ...existing };
    priorityByKey[key] = Math.max(previousPriority, rawPriority);
  }

  return output;
}

export function mergePhotoMetadataMaps(...values: unknown[]): PhotoMetadataMap {
  const output: Record<string, PhotoMetadata> = {};

  for (const value of values) {
    const metadata = normalizePhotoMetadataMap(value);
    for (const [key, meta] of Object.entries(metadata)) {
      output[key] = {
        ...normalizePhotoMetadata(output[key]),
        ...normalizePhotoMetadata(meta),
      };
    }
  }

  return output;
}

export function normalizePhotoDescsRecord(record: unknown): PhotoMetadataMap {
  if (!isRecord(record)) return {};
  return mergePhotoMetadataMaps(record.photo_descs, record.photoDescs);
}

export function hasPhotoMetadata(value: PhotoMetadataValue): boolean {
  const meta = normalizePhotoMetadata(value);
  return Boolean(meta.name?.trim()) || meta.largeInPdf === true;
}

export function photoMetadataKey(fieldName: string, index?: number): string {
  const canonicalFieldName = canonicalPhotoFieldName(fieldName);
  return index === undefined ? canonicalFieldName : `${canonicalFieldName}.${index}`;
}

export function photoUploadFieldName(fieldName: string, index?: number): string {
  const canonicalFieldName = canonicalPhotoFieldName(fieldName);
  return index === undefined ? canonicalFieldName : `${canonicalFieldName}[${index}]`;
}

export function photoDisplayName(defaultName: string, value: PhotoMetadataValue): string {
  return normalizePhotoMetadata(value).name?.trim() || defaultName;
}

export function setPhotoMetadata(
  metadata: PhotoMetadataMap,
  key: string,
  value: PhotoMetadataValue,
): PhotoMetadataMap {
  const metadataKey = photoMetadataKeyFromUploadField(key);
  const next = normalizePhotoMetadataMap(metadata);
  const normalized = normalizePhotoMetadata(value);
  if (metadataKey && hasPhotoMetadata(normalized)) next[metadataKey] = normalized;
  else if (metadataKey) delete next[metadataKey];
  return next;
}

export function removePhotoMetadataIndex(
  metadata: PhotoMetadataMap,
  fieldName: string,
  removedIndex: number,
  remainingCount: number,
): PhotoMetadataMap {
  const next: PhotoMetadataMap = {};
  const canonicalFieldName = canonicalPhotoFieldName(fieldName);
  const prefix = `${canonicalFieldName}.`;

  for (const [key, value] of Object.entries(normalizePhotoMetadataMap(metadata))) {
    if (!key.startsWith(prefix)) {
      next[key] = value;
      continue;
    }

    const index = Number(key.slice(prefix.length));
    if (!Number.isInteger(index) || index === removedIndex) continue;
    const shifted = index > removedIndex ? index - 1 : index;
    if (shifted < remainingCount) next[photoMetadataKey(canonicalFieldName, shifted)] = value;
  }

  return next;
}
