export type PhotoMetadata = {
  name?: string;
  largeInPdf?: boolean;
};

export type PhotoMetadataValue = string | PhotoMetadata | null | undefined;
export type PhotoMetadataMap = Record<string, PhotoMetadataValue>;

export function normalizePhotoMetadata(value: PhotoMetadataValue): PhotoMetadata {
  if (!value) return {};
  if (typeof value === 'string') return value ? { name: value } : {};
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.largeInPdf ? { largeInPdf: true } : {}),
  };
}

export function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as PhotoMetadataMap)
      .map(([key, meta]) => [key, normalizePhotoMetadata(meta)])
      .filter(([, meta]) => hasPhotoMetadata(meta as PhotoMetadata)),
  );
}

export function hasPhotoMetadata(value: PhotoMetadataValue): boolean {
  const meta = normalizePhotoMetadata(value);
  return Boolean(meta.name?.trim()) || meta.largeInPdf === true;
}

export function photoMetadataKey(fieldName: string, index?: number): string {
  return index === undefined ? fieldName : `${fieldName}.${index}`;
}

export function photoUploadFieldName(fieldName: string, index?: number): string {
  return index === undefined ? fieldName : `${fieldName}[${index}]`;
}

export function photoDisplayName(defaultName: string, value: PhotoMetadataValue): string {
  return normalizePhotoMetadata(value).name?.trim() || defaultName;
}

export function setPhotoMetadata(
  metadata: PhotoMetadataMap,
  key: string,
  value: PhotoMetadataValue,
): PhotoMetadataMap {
  const next = { ...metadata };
  const normalized = normalizePhotoMetadata(value);
  if (hasPhotoMetadata(normalized)) next[key] = normalized;
  else delete next[key];
  return next;
}

export function removePhotoMetadataIndex(
  metadata: PhotoMetadataMap,
  fieldName: string,
  removedIndex: number,
  remainingCount: number,
): PhotoMetadataMap {
  const next: PhotoMetadataMap = {};
  const prefix = `${fieldName}.`;

  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(prefix)) {
      next[key] = value;
      continue;
    }

    const index = Number(key.slice(prefix.length));
    if (!Number.isInteger(index) || index === removedIndex) continue;
    const shifted = index > removedIndex ? index - 1 : index;
    if (shifted < remainingCount) next[photoMetadataKey(fieldName, shifted)] = value;
  }

  return next;
}
