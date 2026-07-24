import sharp from 'sharp';
import {
  deleteLocalFile,
  localFileBuffer,
  localFileExists,
  localFileSize,
  writeLocalFile,
} from './localFiles.js';
import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_WIDTH_PX,
  thumbnailStorageKeyForChecksum,
} from './thumbnailReference.js';
import type { StorageApp } from './localFiles.js';

const inFlightBuilds = new Map<string, Promise<void>>();
const MAX_CONCURRENT_BUILDS = 3;
const buildWaiters: Array<() => void> = [];
let activeBuilds = 0;

async function withBuildSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeBuilds >= MAX_CONCURRENT_BUILDS) {
    await new Promise<void>((resolve) => buildWaiters.push(resolve));
  } else {
    activeBuilds += 1;
  }
  try {
    return await work();
  } finally {
    const next = buildWaiters.shift();
    if (next) next();
    else activeBuilds -= 1;
  }
}

async function hasUsableCachedFile(storageKey: string): Promise<boolean> {
  if (!(await localFileExists(storageKey))) return false;
  return (await localFileSize(storageKey)) > 0;
}

export async function renderThumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input, {
    // Existing field photos can contain harmless decoder warnings. Preview
    // generation should salvage those images instead of creating a permanent
    // retry loop for mobile background jobs.
    failOn: 'none',
    limitInputPixels: 100_000_000,
  })
    .rotate()
    .resize({
      width: THUMBNAIL_WIDTH_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: THUMBNAIL_JPEG_QUALITY,
      progressive: true,
      mozjpeg: true,
    })
    .toBuffer();
}

async function buildAndCacheThumbnail(args: {
  originalStorageKey: string;
  thumbnailStorageKey: string;
}): Promise<void> {
  const original = await localFileBuffer(args.originalStorageKey);
  const thumbnail = await renderThumbnail(original);

  try {
    await writeLocalFile(args.thumbnailStorageKey, thumbnail);
  } catch (error) {
    // Multiple API workers can race to populate the same content-addressed
    // cache entry. A completed entry from the other worker is success.
    if (!(await hasUsableCachedFile(args.thumbnailStorageKey))) throw error;
  }
}

export async function ensurePhotoThumbnail(args: {
  app: StorageApp;
  originalStorageKey: string;
  checksum: string;
}): Promise<{ storageKey: string; size: number }> {
  const thumbnailStorageKey = thumbnailStorageKeyForChecksum(args.app, args.checksum);

  if (!(await hasUsableCachedFile(thumbnailStorageKey))) {
    // Remove a zero-byte/incomplete entry before rebuilding it.
    if (await localFileExists(thumbnailStorageKey)) {
      await deleteLocalFile(thumbnailStorageKey);
    }

    let build = inFlightBuilds.get(thumbnailStorageKey);
    if (!build) {
      build = withBuildSlot(() => buildAndCacheThumbnail({
        originalStorageKey: args.originalStorageKey,
        thumbnailStorageKey,
      })).finally(() => {
        inFlightBuilds.delete(thumbnailStorageKey);
      });
      inFlightBuilds.set(thumbnailStorageKey, build);
    }
    await build;
  }

  return {
    storageKey: thumbnailStorageKey,
    size: await localFileSize(thumbnailStorageKey),
  };
}
