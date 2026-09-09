export const PHOTO_NOTE_MAX_LENGTH = 500;

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
