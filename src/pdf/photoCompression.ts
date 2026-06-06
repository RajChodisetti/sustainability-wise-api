import path from 'node:path';
import sharp from 'sharp';
import { photoRegistry } from '../db/schema/shared.js';
import { localFileStream } from '../storage/localFiles.js';

const PDF_PHOTO_WIDTH = 1600;
const PDF_PHOTO_QUALITY = 82;
const PDF_PHOTO_CONCURRENCY = 2;

type PhotoRow = typeof photoRegistry.$inferSelect;

function isImagePhoto(photo: PhotoRow): boolean {
  const contentType = photo.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) return true;

  const filename = photo.storageKey ?? photo.originalFilename ?? '';
  return ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']
    .includes(path.extname(filename).toLowerCase());
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function compressedPhotoDataUri(photo: PhotoRow): Promise<string | null> {
  if (!photo.storageKey || !isImagePhoto(photo)) return null;

  try {
    const source = await streamToBuffer(await localFileStream(photo.storageKey));
    const compressed = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width: PDF_PHOTO_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: PDF_PHOTO_QUALITY, mozjpeg: true })
      .toBuffer();

    return `data:image/jpeg;base64,${compressed.toString('base64')}`;
  } catch (error) {
    console.warn('[pdf] Skipping photo that could not be compressed', {
      photoId: photo.id,
      storageKey: photo.storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function prepareCompressedPdfPhotos<T extends PhotoRow>(photos: T[]): Promise<T[]> {
  const output: T[] = new Array(photos.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < photos.length) {
      const index = nextIndex;
      nextIndex += 1;

      const photo = photos[index];
      const dataUri = await compressedPhotoDataUri(photo);
      output[index] = {
        ...photo,
        remoteUrl: dataUri,
        contentType: dataUri ? 'image/jpeg' : photo.contentType,
      };
    }
  }

  const workerCount = Math.min(PDF_PHOTO_CONCURRENCY, photos.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return output;
}
