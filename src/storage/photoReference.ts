import path from 'node:path';

export type PhotoApp = 'ecoaudit' | 'solarsense';

export type ParsedPhotoReference = {
  app: PhotoApp;
  photoId: string;
  /** Present on the UUID-based paths used before the storage-name migration. */
  legacyParentId: string | null;
};

export type PhotoReferenceCandidate = {
  id: string;
  app: string;
  parentId: string;
  storageKey: string | null;
  status: string;
};

export type PhotoReferenceLookup<T extends PhotoReferenceCandidate> = {
  byStorageKey: (input: { app: PhotoApp; storageKey: string }) => Promise<T | null>;
  byIdentity: (input: ParsedPhotoReference) => Promise<T | null>;
};

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
const PHOTO_ID_AT_END_RE = new RegExp(`(?:^|[-_])(${UUID_PATTERN})(?:\\.[a-z0-9]{1,12})?$`, 'i');

function safeStorageSegments(storageKey: string): string[] | null {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('\\') || storageKey.includes('\0')) {
    return null;
  }

  const segments = storageKey.split('/');
  if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  if (path.posix.normalize(storageKey) !== storageKey) return null;
  return segments;
}

export function photoAppFromStorageKey(storageKey: string): PhotoApp | null {
  const segments = safeStorageSegments(storageKey);
  if (!segments) return null;
  return segments[0] === 'ecoaudit' || segments[0] === 'solarsense'
    ? segments[0]
    : null;
}

/**
 * Photo filenames end with the upload-session UUID, which is also the immutable
 * photo_registry id. That identity survives storage-path renames.
 */
export function parsePhotoReference(storageKey: string): ParsedPhotoReference | null {
  const segments = safeStorageSegments(storageKey);
  if (!segments) return null;
  const app = photoAppFromStorageKey(storageKey);
  if (!app) return null;

  const filename = segments.at(-1) ?? '';
  const match = PHOTO_ID_AT_END_RE.exec(filename);
  if (!match?.[1]) return null;

  const parentSegment = segments[1] ?? '';
  return {
    app,
    photoId: match[1].toLowerCase(),
    legacyParentId: UUID_RE.test(parentSegment) ? parentSegment.toLowerCase() : null,
  };
}

function isUsableCandidate<T extends PhotoReferenceCandidate>(
  candidate: T | null,
  app: PhotoApp,
): candidate is T & { storageKey: string } {
  return Boolean(candidate?.storageKey && candidate.app === app && candidate.status === 'confirmed');
}

/**
 * Resolve an exact current reference first, then fall back to the immutable
 * photo id embedded in a legacy filename. The old UUID parent segment is also
 * checked when present so a stale URL cannot be rebound across audits/sites.
 */
export async function resolvePhotoReferenceWithLookup<T extends PhotoReferenceCandidate>(
  storageKey: string,
  expectedApp: PhotoApp | undefined,
  lookup: PhotoReferenceLookup<T>,
): Promise<(T & { storageKey: string }) | null> {
  const app = photoAppFromStorageKey(storageKey);
  if (!app || (expectedApp && app !== expectedApp)) return null;

  const exact = await lookup.byStorageKey({ app, storageKey });
  if (isUsableCandidate(exact, app)) return exact;

  const parsed = parsePhotoReference(storageKey);
  if (!parsed) return null;
  const candidate = await lookup.byIdentity(parsed);
  if (!isUsableCandidate(candidate, app)) return null;
  if (candidate.id.toLowerCase() !== parsed.photoId) return null;
  if (parsed.legacyParentId && candidate.parentId.toLowerCase() !== parsed.legacyParentId) return null;
  return candidate;
}
