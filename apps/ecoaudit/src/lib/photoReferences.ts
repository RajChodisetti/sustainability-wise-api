export type PhotoApp = 'ecoaudit' | 'solarsense';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_ID_AT_END_RE = new RegExp(
  `(?:^|[-_])(${UUID_PATTERN})(?:\\.[a-z0-9]{1,12})?$`,
  'i',
);
const STORAGE_PREFIX_RE = /^(?:\/)?v1\/(?:files|thumbnails)\//i;

function withoutQueryOrFragment(value: string): string {
  const suffixAt = [value.indexOf('?'), value.indexOf('#')]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);
  return value.slice(0, suffixAt);
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function pathFromPhotoUri(uri: string): string | null {
  const value = uri.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const pathname = new URL(value).pathname;
      const marker = /\/v1\/(?:files|thumbnails)\//i.exec(pathname);
      return marker ? pathname.slice(marker.index).replace(STORAGE_PREFIX_RE, '') : null;
    } catch {
      return null;
    }
  }

  return withoutQueryOrFragment(value).replace(STORAGE_PREFIX_RE, '').replace(/^\//, '');
}

/**
 * Return the API storage reference without mutating the value held by the audit.
 * Only safe Eco Audit and Solar Sense keys are accepted for the thumbnail proxy.
 */
export function extractPhotoStorageKey(
  uri: string | null | undefined,
  expectedApp?: PhotoApp,
): string | null {
  if (!uri) return null;
  const path = pathFromPhotoUri(uri);
  if (!path) return null;

  const segments = path.split('/').map(decodeSegment);
  if (segments.length < 2 || segments.some((segment) => segment === null)) return null;

  const safeSegments = segments as string[];
  const app = safeSegments[0];
  if (app !== 'ecoaudit' && app !== 'solarsense') return null;
  if (expectedApp && app !== expectedApp) return null;
  return safeSegments.join('/');
}

/**
 * Photo filenames end in their immutable registry UUID. Legacy clients used
 * both `field-<uuid>.jpg` and `field_<uuid>.jpg`, so accept both delimiters in
 * exactly the same way as the API resolver.
 */
export function extractPhotoIdFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const path = pathFromPhotoUri(uri) ?? withoutQueryOrFragment(uri.trim());
  const encodedFilename = path.split('/').at(-1) ?? '';
  const filename = decodeSegment(encodedFilename);
  if (!filename) return null;
  const match = PHOTO_ID_AT_END_RE.exec(filename);
  return match?.[1]?.toLowerCase() ?? null;
}
