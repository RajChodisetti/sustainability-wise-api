const invalidSegmentChars = /[/"*:<>?\\|#%\u0000-\u001F]+/g;
const preservedExtensionPattern = /^(.*)(\.[A-Za-z0-9]{1,8})$/;
const preservedExtensions = new Set([
  '.bmp',
  '.csv',
  '.doc',
  '.docx',
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.tif',
  '.tiff',
  '.txt',
  '.webp',
  '.xls',
  '.xlsx',
  '.zip',
]);

function splitPreservedExtension(value: string): { stem: string; extension: string } {
  const match = value.match(preservedExtensionPattern);
  if (!match?.[1]) return { stem: value, extension: '' };
  if (!preservedExtensions.has(match[2].toLowerCase())) {
    return { stem: value, extension: '' };
  }
  return { stem: match[1], extension: match[2] };
}

function truncateSegment(stem: string, extension: string): string {
  const maxLength = 120;
  if (stem.length + extension.length <= maxLength) return `${stem}${extension}`;
  if (!extension) return stem.slice(0, maxLength);

  const maxStemLength = Math.max(1, maxLength - extension.length);
  return `${stem.slice(0, maxStemLength)}${extension}`;
}

export function sanitizeOneDrivePathSegment(value: string): string {
  const { stem, extension } = splitPreservedExtension(value.trim());
  const sanitizedStem = stem
    .trim()
    .replace(invalidSegmentChars, '_')
    .replace(/\./g, '_')
    .replace(/^~+/, (match) => '_'.repeat(match.length))
    .replace(/\s+/g, ' ');

  return truncateSegment(sanitizedStem || 'item', extension);
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

export function joinOneDrivePathSegments(
  rootPath: string,
  ...segments: Array<string | null | undefined>
): string {
  const normalizedRoot = normalizeOneDrivePath(rootPath);
  const normalizedSegments = segments
    .filter((segment): segment is string => Boolean(segment))
    .map(sanitizeOneDrivePathSegment)
    .filter(Boolean)
    .join('/');

  return [normalizedRoot, normalizedSegments].filter(Boolean).join('/');
}

export function oneDrivePathForStorageKey(rootFolder: string, storageKey: string): string {
  return joinOneDrivePath(rootFolder, storageKey);
}

export function invoicePdfOneDrivePath(
  invoicesFolder: string,
  clientName: string,
  filename: string,
): string {
  return joinOneDrivePathSegments(invoicesFolder, clientName, filename);
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
