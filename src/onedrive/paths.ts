const invalidSegmentChars = /["*:<>?\\|]+/g;

export function sanitizeOneDrivePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(invalidSegmentChars, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '');

  return sanitized.slice(0, 120) || 'item';
}

export function normalizeOneDrivePath(value: string): string {
  return value
    .trim()
    .replace(/^[a-zA-Z0-9_-]+:/, '')
    .split(/[\\/]+/)
    .map(sanitizeOneDrivePathSegment)
    .filter(Boolean)
    .join('/');
}

export function joinOneDrivePath(...parts: Array<string | null | undefined>): string {
  return normalizeOneDrivePath(parts.filter(Boolean).join('/'));
}

export function oneDrivePathForStorageKey(rootFolder: string, storageKey: string): string {
  return joinOneDrivePath(rootFolder, storageKey);
}

export function encodeOneDrivePath(value: string): string {
  return normalizeOneDrivePath(value)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

export function parentOneDriveFolder(value: string): string {
  const segments = normalizeOneDrivePath(value).split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}
