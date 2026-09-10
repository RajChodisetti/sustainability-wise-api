import type { InstallHubPhotoMetadataMap } from '@/modules/installhub/types/domain';

export const PHOTO_NOTE_MAX_LENGTH = 500;

export function planPrimaryAndAdditionalPhotoFields({
  primaryField,
  primaryOccupied,
  additionalFieldPrefix,
  existingAdditionalCount,
  fileCount,
}: {
  primaryField: string;
  primaryOccupied: boolean;
  additionalFieldPrefix: string;
  existingAdditionalCount: number;
  fileCount: number;
}): string[] {
  let primaryAvailable = !primaryOccupied;
  let additionalIndex = Math.max(0, existingAdditionalCount);
  return Array.from({ length: Math.max(0, fileCount) }, () => {
    if (primaryAvailable) {
      primaryAvailable = false;
      return primaryField;
    }
    return `${additionalFieldPrefix}[${additionalIndex++}]`;
  });
}

export function photoNote(
  notes: Record<string, string> | null | undefined,
  fieldName: string,
): string {
  return notes?.[fieldName] ?? '';
}

export function setPhotoNote(
  notes: Record<string, string> | null | undefined,
  fieldName: string,
  value: string,
): Record<string, string> {
  const next = { ...(notes ?? {}) };
  const normalized = value.trim();
  if (normalized) next[fieldName] = normalized.slice(0, PHOTO_NOTE_MAX_LENGTH);
  else delete next[fieldName];
  return next;
}

export function removeIndexedPhotoNote(
  notes: Record<string, string> | null | undefined,
  fieldPrefix: string,
  removedIndex: number,
): Record<string, string> {
  const next: Record<string, string> = {};
  const escapedPrefix = fieldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}\\[(\\d+)\\]$`);
  for (const [key, value] of Object.entries(notes ?? {})) {
    const match = key.match(pattern);
    if (!match) {
      next[key] = value;
      continue;
    }
    const index = Number(match[1]);
    if (index < removedIndex) next[key] = value;
    else if (index > removedIndex) next[`${fieldPrefix}[${index - 1}]`] = value;
  }
  return next;
}

export function photoLargeInPdf(
  metadata: InstallHubPhotoMetadataMap | null | undefined,
  fieldName: string,
): boolean {
  return metadata?.[fieldName]?.largeInPdf === true;
}

export function setPhotoLargeInPdf(
  metadata: InstallHubPhotoMetadataMap | null | undefined,
  fieldName: string,
  largeInPdf: boolean,
): InstallHubPhotoMetadataMap {
  const next = { ...(metadata ?? {}) };
  next[fieldName] = { largeInPdf };
  return next;
}

export function removePhotoMetadata(
  metadata: InstallHubPhotoMetadataMap | null | undefined,
  fieldName: string,
): InstallHubPhotoMetadataMap {
  const next = { ...(metadata ?? {}) };
  delete next[fieldName];
  return next;
}

export function removeIndexedPhotoMetadata(
  metadata: InstallHubPhotoMetadataMap | null | undefined,
  fieldPrefix: string,
  removedIndex: number,
): InstallHubPhotoMetadataMap {
  const next: InstallHubPhotoMetadataMap = {};
  const escapedPrefix = fieldPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}\\[(\\d+)\\]$`);
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const match = key.match(pattern);
    if (!match) {
      next[key] = value;
      continue;
    }
    const index = Number(match[1]);
    if (index < removedIndex) next[key] = value;
    else if (index > removedIndex) next[`${fieldPrefix}[${index - 1}]`] = value;
  }
  return next;
}
