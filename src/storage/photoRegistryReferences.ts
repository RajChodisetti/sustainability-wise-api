import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { photoRegistry } from '../db/schema/shared.js';
import {
  resolvePhotoReferenceWithLookup,
  type ParsedPhotoReference,
  type PhotoApp,
} from './photoReference.js';

export type ConfirmedPhotoReference = typeof photoRegistry.$inferSelect & { storageKey: string };

async function findByStorageKey(input: {
  app: PhotoApp;
  storageKey: string;
}): Promise<typeof photoRegistry.$inferSelect | null> {
  const [photo] = await db
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.storageKey, input.storageKey),
      eq(photoRegistry.app, input.app),
      eq(photoRegistry.status, 'confirmed'),
    ))
    .limit(1);
  return photo ?? null;
}

async function findByIdentity(input: ParsedPhotoReference): Promise<typeof photoRegistry.$inferSelect | null> {
  const conditions = [
    eq(photoRegistry.id, input.photoId),
    eq(photoRegistry.app, input.app),
    eq(photoRegistry.status, 'confirmed'),
  ];
  if (input.legacyParentId) conditions.push(eq(photoRegistry.parentId, input.legacyParentId));

  const [photo] = await db
    .select()
    .from(photoRegistry)
    .where(and(...conditions))
    .limit(1);
  return photo ?? null;
}

export async function resolveConfirmedPhotoReference(
  storageKey: string,
  expectedApp?: PhotoApp,
): Promise<ConfirmedPhotoReference | null> {
  return resolvePhotoReferenceWithLookup(storageKey, expectedApp, {
    byStorageKey: findByStorageKey,
    byIdentity: findByIdentity,
  });
}
