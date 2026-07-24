import { createHash } from 'node:crypto';
import type { StorageApp } from './localFiles.js';

export const THUMBNAIL_WIDTH_PX = 400;
export const THUMBNAIL_JPEG_QUALITY = 52;
export const THUMBNAIL_CACHE_VERSION = 'v2';

const ORIGINAL_FILE_PATH_MARKER = '/v1/files/';
const THUMBNAIL_PATH_MARKER = '/v1/thumbnails/';

function cacheIdentity(checksum: string): string {
  return createHash('sha256')
    .update(`${THUMBNAIL_CACHE_VERSION}:${checksum.trim().toLowerCase()}`)
    .digest('hex');
}

export function thumbnailStorageKeyForChecksum(
  app: StorageApp,
  checksum: string,
): string {
  const identity = cacheIdentity(checksum);
  return [
    app,
    '_thumbnails',
    THUMBNAIL_CACHE_VERSION,
    identity.slice(0, 2),
    `${identity}-w${THUMBNAIL_WIDTH_PX}-q${THUMBNAIL_JPEG_QUALITY}.jpg`,
  ].join('/');
}

export function thumbnailEtagForChecksum(checksum: string): string {
  return `"${cacheIdentity(checksum)}-${THUMBNAIL_CACHE_VERSION}-w${THUMBNAIL_WIDTH_PX}-q${THUMBNAIL_JPEG_QUALITY}"`;
}

/**
 * Mobile clients derive the thumbnail endpoint without changing the stored
 * original reference. Query strings are preserved for forward compatibility.
 */
export function thumbnailUrlForOriginalFileUrl(originalUrl: string): string | null {
  const queryIndex = originalUrl.indexOf('?');
  const fragmentIndex = originalUrl.indexOf('#');
  const suffixIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const pathEnd = suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : originalUrl.length;
  const pathAndOrigin = originalUrl.slice(0, pathEnd);
  const markerIndex = pathAndOrigin.indexOf(ORIGINAL_FILE_PATH_MARKER);
  if (markerIndex < 0) return null;
  return `${pathAndOrigin.slice(0, markerIndex)}${THUMBNAIL_PATH_MARKER}${originalUrl.slice(markerIndex + ORIGINAL_FILE_PATH_MARKER.length)}`;
}
