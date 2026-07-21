import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { localFileStream, writeLocalFileFromPath } from '../storage/localFiles.js';

export type PhotoZipRow = {
  id: string;
  storageKey: string | null;
};

type ZipArchiveInstance = NodeJS.ReadableStream & {
  append(source: NodeJS.ReadableStream | Buffer | string, data: { name: string }): void;
  finalize(): Promise<void>;
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
  on(event: 'error' | 'warning', listener: (error: Error & { code?: string }) => void): ZipArchiveInstance;
};

type PhotoZipOptions<T extends PhotoZipRow> = {
  photos: T[];
  destination: Writable;
  entryName: (photo: T) => string;
  openStream?: (storageKey: string) => Promise<NodeJS.ReadableStream>;
  onProgress?: (current: number, total: number) => void | Promise<void>;
  onSkipped?: (photo: T, error: unknown) => void;
};

async function createZipArchive(): Promise<ZipArchiveInstance> {
  const mod = await import('archiver') as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance;
  };
  return new mod.ZipArchive({ zlib: { level: 6 } });
}

function isMissingFileError(error: unknown): boolean {
  const candidate = error as { statusCode?: number; code?: string; name?: string } | null;
  return candidate?.statusCode === 404
    || candidate?.code === 'ENOENT'
    || candidate?.name === 'NoSuchKey'
    || candidate?.name === 'NotFound';
}

export async function writePhotoZip<T extends PhotoZipRow>({
  photos,
  destination,
  entryName,
  openStream = localFileStream,
  onProgress,
  onSkipped,
}: PhotoZipOptions<T>): Promise<{ added: number; skipped: number }> {
  const archive = await createZipArchive();
  const destinationDone = finished(destination);
  let added = 0;
  let skipped = 0;

  archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') destination.destroy(error);
  });
  archive.on('error', (error) => destination.destroy(error));
  archive.pipe(destination);

  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    if (!photo.storageKey) {
      skipped += 1;
      await onProgress?.(index + 1, photos.length);
      continue;
    }

    let source: NodeJS.ReadableStream;
    try {
      source = await openStream(photo.storageKey);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      skipped += 1;
      onSkipped?.(photo, error);
      await onProgress?.(index + 1, photos.length);
      continue;
    }

    archive.append(source, { name: entryName(photo) });
    await finished(source as Readable, { cleanup: true });
    added += 1;
    await onProgress?.(index + 1, photos.length);
  }

  await archive.finalize();
  await destinationDone;
  return { added, skipped };
}

export function createPhotoZipStream<T extends PhotoZipRow>(
  options: Omit<PhotoZipOptions<T>, 'destination'>,
  run: (task: () => Promise<void>) => Promise<void>,
): PassThrough {
  const output = new PassThrough();
  void run(async () => {
    await writePhotoZip({ ...options, destination: output });
  }).catch((error) => output.destroy(error instanceof Error ? error : new Error(String(error))));
  return output;
}

export async function createStoredPhotoZip<T extends PhotoZipRow>(args: {
  photos: T[];
  storageKey: string;
  entryName: (photo: T) => string;
  onProgress?: PhotoZipOptions<T>['onProgress'];
  onSkipped?: PhotoZipOptions<T>['onSkipped'];
}): Promise<{ added: number; skipped: number }> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sw-photo-export-'));
  const tempPath = path.join(tempDirectory, 'photos.zip');
  try {
    const result = await writePhotoZip({
      photos: args.photos,
      destination: createWriteStream(tempPath, { flags: 'wx' }),
      entryName: args.entryName,
      onProgress: args.onProgress,
      onSkipped: args.onSkipped,
    });
    await writeLocalFileFromPath(args.storageKey, tempPath, 'application/zip');
    return result;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
