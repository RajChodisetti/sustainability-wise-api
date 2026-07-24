import type {
  PhotoMetadata,
  PhotoMetadataMap,
  PhotoMetadataValue,
} from '@solar/types/domain';

export function normalizePhotoMetadata(value: PhotoMetadataValue): PhotoMetadata {
  if (!value) return {};
  if (typeof value === 'string') return value ? { name: value } : {};
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(value.largeInPdf ? { largeInPdf: true } : {}),
  };
}

export function hasPhotoMetadata(value: PhotoMetadataValue): boolean {
  const metadata = normalizePhotoMetadata(value);
  return Boolean(metadata.name?.trim()) || metadata.largeInPdf === true;
}

export function normalizePhotoMetadataMap(value: unknown): PhotoMetadataMap {
  if (typeof value === 'string') {
    try {
      return normalizePhotoMetadataMap(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, PhotoMetadataValue>)
      .map(([key, metadata]) => [key, normalizePhotoMetadata(metadata)])
      .filter(([, metadata]) => hasPhotoMetadata(metadata as PhotoMetadata)),
  );
}

export function photoDisplayName(defaultName: string, value: PhotoMetadataValue): string {
  return normalizePhotoMetadata(value).name?.trim() || defaultName;
}

export function setPhotoMetadataName(
  value: PhotoMetadataMap,
  key: string,
  name: string,
): PhotoMetadataMap {
  const next = { ...value };
  const metadata = normalizePhotoMetadata(value[key]);
  const updated = { ...metadata };
  if (name.length > 0) updated.name = name;
  else delete updated.name;

  if (hasPhotoMetadata(updated)) next[key] = updated;
  else delete next[key];
  return next;
}

export function removePhotoMetadata(value: PhotoMetadataMap, key: string): PhotoMetadataMap {
  const next = { ...value };
  delete next[key];
  return next;
}

export function removeIndexedPhotoMetadata(
  value: PhotoMetadataMap,
  prefix: string,
  removedIndex: number,
): PhotoMetadataMap {
  const keyPrefix = `${prefix}.`;
  const next: PhotoMetadataMap = {};

  for (const [key, metadata] of Object.entries(value)) {
    if (!key.startsWith(keyPrefix)) {
      next[key] = metadata;
      continue;
    }

    const remainder = key.slice(keyPrefix.length);
    const separatorIndex = remainder.indexOf('.');
    const indexText = separatorIndex === -1 ? remainder : remainder.slice(0, separatorIndex);
    if (!/^\d+$/.test(indexText)) {
      next[key] = metadata;
      continue;
    }

    const index = Number(indexText);
    if (index === removedIndex) continue;

    const suffix = separatorIndex === -1 ? '' : remainder.slice(separatorIndex);
    const nextIndex = index > removedIndex ? index - 1 : index;
    next[`${keyPrefix}${nextIndex}${suffix}`] = metadata;
  }

  return next;
}
