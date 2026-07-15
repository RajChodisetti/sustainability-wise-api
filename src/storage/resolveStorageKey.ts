import { eq, or } from 'drizzle-orm';
import path from 'node:path';
import { db } from '../db/client.js';
import { photoRegistry } from '../db/schema/shared.js';
import { localFileExists } from './localFiles.js';

function decodeStorageKey(raw: string): string {
  return raw
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function photoIdFromBasename(basename: string): string | null {
  const match = basename.match(
    /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?$/i,
  );
  return match?.[1] ?? null;
}

/**
 * Resolve a /v1/files/* key to a storage key that actually exists.
 * Handles legacy UUID paths where the file was moved to a name-based key.
 */
export async function resolveExistingStorageKey(rawKey: string): Promise<string | null> {
  const storageKey = decodeStorageKey(rawKey);
  if (await localFileExists(storageKey)) return storageKey;

  const basename = path.posix.basename(storageKey);
  const photoId = photoIdFromBasename(basename);

  const candidates = photoId
    ? await db
        .select({ storageKey: photoRegistry.storageKey })
        .from(photoRegistry)
        .where(
          or(
            eq(photoRegistry.id, photoId),
            eq(photoRegistry.storageKey, storageKey),
            eq(photoRegistry.originalFilename, basename),
          ),
        )
    : await db
        .select({ storageKey: photoRegistry.storageKey })
        .from(photoRegistry)
        .where(
          or(
            eq(photoRegistry.storageKey, storageKey),
            eq(photoRegistry.originalFilename, basename),
          ),
        );

  for (const row of candidates) {
    if (!row.storageKey) continue;
    if (await localFileExists(row.storageKey)) return row.storageKey;
  }

  if (basename) {
    const confirmed = await db
      .select({ storageKey: photoRegistry.storageKey })
      .from(photoRegistry)
      .where(eq(photoRegistry.status, 'confirmed'));
    for (const row of confirmed) {
      if (!row.storageKey) continue;
      if (path.posix.basename(row.storageKey) !== basename) continue;
      if (await localFileExists(row.storageKey)) return row.storageKey;
    }
  }

  return null;
}
