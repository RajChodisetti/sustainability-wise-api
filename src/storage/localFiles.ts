import { constants, createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { createConfiguredFileUrl } from '../auth/fileCapability.js';
import { badRequest, notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';

export type StorageApp = 'solarsense' | 'ecoaudit' | 'installhub';

type SpacesDestination = {
  region: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type StorageDestination = {
  id: string;
  provider: 'local' | 'spaces';
  localRoot: string | null;
  spaces: SpacesDestination | null;
};

export type StorageLocation = 'legacy' | 'isolated';

const legacyDestination: StorageDestination = {
  id: 'legacy',
  provider: config.storage.provider,
  localRoot: config.storage.provider === 'local'
    ? path.resolve(config.storage.localRoot)
    : null,
  spaces: config.storage.spaces,
};

const appDestinations = Object.fromEntries(
  Object.entries(config.storage.appDestinations).map(([app, destination]) => [
    app,
    destination
      ? {
          id: `app:${app}`,
          provider: destination.provider,
          localRoot: destination.provider === 'local'
            ? path.resolve(destination.localRoot)
            : null,
          spaces: destination.spaces,
        } satisfies StorageDestination
      : null,
  ]),
) as Record<StorageApp, StorageDestination | null>;

const spacesClients = new Map<string, S3Client>();

export type StoredFileListing = {
  storageKey: string;
  sizeBytes: number | null;
  lastModified: Date | null;
};

export function sanitizeStorageSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^[a-z0-9.]{1,12}$/.test(ext) ? ext : '';
}

export function makeLocalStorageKey(args: {
  app: StorageApp;
  parentId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  sessionId: string;
  filename: string;
}): string {
  const filename = `${sanitizeStorageSegment(args.fieldName)}-${args.sessionId}${safeExtension(args.filename)}`;
  return [
    makeStoragePrefix(args),
    sanitizeStorageSegment(args.fieldName),
    filename,
  ].join('/');
}

export function makeNamedLocalStorageKey(args: {
  app: StorageApp;
  parentName: string;
  entityType: string;
  entityName: string;
  fieldName: string;
  sessionId: string;
  filename: string;
}): string {
  const filename = `${sanitizeStorageSegment(args.fieldName)}-${args.sessionId}${safeExtension(args.filename)}`;
  return [
    makeNamedStoragePrefix(args),
    sanitizeStorageSegment(args.fieldName),
    filename,
  ].join('/');
}

export function makeNamedStorageKeyForFilename(args: {
  app: StorageApp;
  parentName: string;
  entityType?: string;
  entityName?: string;
  fieldName?: string;
  filename: string;
}): string {
  return [
    makeNamedStoragePrefix(args),
    args.fieldName ? sanitizeStorageSegment(args.fieldName) : null,
    sanitizeStorageSegment(args.filename),
  ].filter(Boolean).join('/');
}

export function makeNamedPdfStorageKey(args: {
  app: StorageApp;
  parentName: string;
  fieldName: string;
  sessionId: string;
  filename: string;
}): string {
  const filename = `${sanitizeStorageSegment(args.fieldName)}-${args.sessionId}${safeExtension(args.filename)}`;
  return [
    args.app,
    sanitizeStorageSegment(args.parentName),
    'pdfs',
    filename,
  ].join('/');
}

export function makeStoragePrefix(args: {
  app: StorageApp;
  parentId: string;
  entityType?: string;
  entityId?: string;
}): string {
  return [
    args.app,
    sanitizeStorageSegment(args.parentId),
    args.entityType ? sanitizeStorageSegment(args.entityType) : null,
    args.entityId ? sanitizeStorageSegment(args.entityId) : null,
  ].filter(Boolean).join('/');
}

export function makeNamedStoragePrefix(args: {
  app: StorageApp;
  parentName: string;
  entityType?: string;
  entityName?: string;
}): string {
  return [
    args.app,
    sanitizeStorageSegment(args.parentName),
    args.entityType ? sanitizeStorageSegment(args.entityType) : null,
    args.entityName ? sanitizeStorageSegment(args.entityName) : null,
  ].filter(Boolean).join('/');
}

export function storageAppFromKey(storageKey: string): StorageApp | null {
  const first = storageKeyToObjectKey(storageKey).split('/')[0];
  return first === 'ecoaudit' || first === 'solarsense' || first === 'installhub'
    ? first
    : null;
}

function destinationIdentity(destination: StorageDestination): string {
  return destination.provider === 'spaces'
    ? `spaces:${destination.spaces?.endpoint}:${destination.spaces?.bucket}`
    : `local:${destination.localRoot}`;
}

function distinctDestinations(
  destinations: Array<StorageDestination | null | undefined>,
): StorageDestination[] {
  const seen = new Set<string>();
  return destinations.filter((destination): destination is StorageDestination => {
    if (!destination) return false;
    const identity = destinationIdentity(destination);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function readDestinations(storageKey: string): StorageDestination[] {
  const app = storageAppFromKey(storageKey);
  const isolated = app ? appDestinations[app] : null;
  return config.storage.writeMode === 'legacy'
    ? distinctDestinations([legacyDestination, isolated])
    : distinctDestinations([isolated, legacyDestination]);
}

function writeDestinations(storageKey: string): StorageDestination[] {
  const app = storageAppFromKey(storageKey);
  const isolated = app ? appDestinations[app] : null;
  if (!isolated || config.storage.writeMode === 'legacy') {
    return [legacyDestination];
  }
  return config.storage.writeMode === 'dual'
    ? distinctDestinations([isolated, legacyDestination])
    : [isolated];
}

function migrationDestination(
  storageKey: string,
  location: StorageLocation,
): StorageDestination {
  if (location === 'legacy') return legacyDestination;
  const app = storageAppFromKey(storageKey);
  const destination = app ? appDestinations[app] : null;
  if (!app || !destination) {
    throw badRequest('Storage key has no configured isolated application destination');
  }
  return destination;
}

export function storageKeyToPath(storageKey: string): string {
  return storageKeyToPathAt(legacyDestination, storageKey);
}

function storageKeyToPathAt(
  destination: StorageDestination,
  storageKey: string,
): string {
  if (destination.provider !== 'local' || !destination.localRoot) {
    throw new Error(`Storage destination ${destination.id} is not local`);
  }
  const normalized = storageKeyToObjectKey(storageKey);
  const absolute = path.resolve(destination.localRoot, ...normalized.split('/'));
  if (
    absolute !== destination.localRoot
    && !absolute.startsWith(`${destination.localRoot}${path.sep}`)
  ) {
    throw badRequest('Invalid storage key');
  }

  return absolute;
}

function storageKeyToObjectKey(storageKey: string): string {
  const normalized = path.posix.normalize(storageKey).replace(/^\/+/, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    throw badRequest('Invalid storage key');
  }
  return normalized;
}

function isNotFoundError(error: unknown): boolean {
  const err = error as {
    name?: string;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return err?.statusCode === 404
    || err?.$metadata?.httpStatusCode === 404
    || err?.name === 'NotFound'
    || err?.name === 'NoSuchKey';
}

function requireSpaces(destination: StorageDestination) {
  if (destination.provider !== 'spaces' || !destination.spaces) {
    throw new Error(`Spaces storage is not configured for ${destination.id}`);
  }
  let client = spacesClients.get(destination.id);
  if (!client) {
    client = new S3Client({
      region: destination.spaces.region,
      endpoint: destination.spaces.endpoint,
      forcePathStyle: false,
      credentials: {
        accessKeyId: destination.spaces.accessKeyId,
        secretAccessKey: destination.spaces.secretAccessKey,
      },
    });
    spacesClients.set(destination.id, client);
  }
  return { client, spaces: destination.spaces };
}

function asNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as Readable;
  }
  throw notFound('File');
}

export function publicFileUrl(storageKey: string): string {
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${config.publicBaseUrl}/v1/files/${encoded}`;
}

export function signedFileUrl(storageKey: string): string {
  return createConfiguredFileUrl(publicFileUrl(storageKey), storageKey);
}

async function listStoredFilesAtDestination(
  prefix: string,
  destination: StorageDestination,
): Promise<StoredFileListing[]> {
  const objectPrefix = storageKeyToObjectKey(prefix).replace(/\/?$/, '/');
  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    const files: StoredFileListing[] = [];
    let ContinuationToken: string | undefined;
    do {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: spaces.bucket,
        Prefix: objectPrefix,
        ContinuationToken,
      }));
      for (const object of result.Contents ?? []) {
        if (!object.Key || object.Key.endsWith('/')) continue;
        files.push({
          storageKey: object.Key,
          sizeBytes: typeof object.Size === 'number' ? object.Size : null,
          lastModified: object.LastModified ?? null,
        });
      }
      ContinuationToken = result.NextContinuationToken;
    } while (ContinuationToken);
    return files.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
  }

  const absolutePrefix = storageKeyToPathAt(destination, objectPrefix);
  const files: StoredFileListing[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      files.push({
        storageKey: path.relative(destination.localRoot!, absolute).split(path.sep).join('/'),
        sizeBytes: info.size,
        lastModified: info.mtime,
      });
    }
  }
  await walk(absolutePrefix);
  return files.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

export async function listStoredFiles(prefix: string): Promise<StoredFileListing[]> {
  const listings = await Promise.all(
    readDestinations(prefix).map((destination) =>
      listStoredFilesAtDestination(prefix, destination)
    ),
  );
  const byKey = new Map<string, StoredFileListing>();
  for (const listing of listings) {
    for (const file of listing) {
      if (!byKey.has(file.storageKey)) byKey.set(file.storageKey, file);
    }
  }
  return [...byKey.values()].sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

export async function listStoredFilesAt(
  prefix: string,
  location: StorageLocation,
): Promise<StoredFileListing[]> {
  return listStoredFilesAtDestination(prefix, migrationDestination(prefix, location));
}

async function writeBufferAtDestination(
  storageKey: string,
  body: Buffer,
  destination: StorageDestination,
): Promise<void> {
  if (await fileExistsAtDestination(storageKey, destination)) {
    const [existingSize, existingChecksum] = await Promise.all([
      fileSizeAtDestination(storageKey, destination),
      checksumAtDestination(storageKey, destination),
    ]);
    if (existingSize === body.length && existingChecksum === sha256(body)) return;
    throw new Error(`Stored file already exists with different content: ${storageKey}`);
  }

  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    await client.send(new PutObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
      Body: body,
      ContentType: contentTypeForStorageKey(storageKey),
    }));
    return;
  }

  const absolute = storageKeyToPathAt(destination, storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await writeFile(absolute, body, { flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
    const [existingSize, existingChecksum] = await Promise.all([
      fileSizeAtDestination(storageKey, destination),
      checksumAtDestination(storageKey, destination),
    ]);
    if (existingSize !== body.length || existingChecksum !== sha256(body)) throw error;
  }
}

export async function writeLocalFile(storageKey: string, body: Buffer): Promise<{
  size: number;
  checksum: string;
}> {
  for (const destination of writeDestinations(storageKey)) {
    await writeBufferAtDestination(storageKey, body, destination);
  }
  return { size: body.length, checksum: sha256(body) };
}

async function writePathAtDestination(
  storageKey: string,
  sourcePath: string,
  sourceSize: number,
  contentType: string,
  destination: StorageDestination,
): Promise<void> {
  if (await fileExistsAtDestination(storageKey, destination)) {
    const [existingSize, existingChecksum, sourceChecksum] = await Promise.all([
      fileSizeAtDestination(storageKey, destination),
      checksumAtDestination(storageKey, destination),
      checksumForStream(createReadStream(sourcePath)),
    ]);
    if (existingSize === sourceSize && existingChecksum === sourceChecksum) return;
    throw new Error(`Stored file already exists with different content: ${storageKey}`);
  }

  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    await client.send(new PutObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
      Body: createReadStream(sourcePath),
      ContentLength: sourceSize,
      ContentType: contentType,
    }));
    return;
  }

  const absolute = storageKeyToPathAt(destination, storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await copyFile(sourcePath, absolute, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
    const [existingSize, existingChecksum, sourceChecksum] = await Promise.all([
      fileSizeAtDestination(storageKey, destination),
      checksumAtDestination(storageKey, destination),
      checksumForStream(createReadStream(sourcePath)),
    ]);
    if (existingSize !== sourceSize || existingChecksum !== sourceChecksum) throw error;
  }
}

export async function writeLocalFileFromPath(
  storageKey: string,
  sourcePath: string,
  contentType = contentTypeForStorageKey(storageKey),
): Promise<{ size: number }> {
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile()) throw badRequest('Stored export source must be a file');

  for (const destination of writeDestinations(storageKey)) {
    await writePathAtDestination(
      storageKey,
      sourcePath,
      sourceInfo.size,
      contentType,
      destination,
    );
  }
  return { size: sourceInfo.size };
}

async function fileExistsAtDestination(
  storageKey: string,
  destination: StorageDestination,
): Promise<boolean> {
  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    try {
      await client.send(new HeadObjectCommand({
        Bucket: spaces.bucket,
        Key: storageKeyToObjectKey(storageKey),
      }));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  try {
    await access(storageKeyToPathAt(destination, storageKey));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function localFileExists(storageKey: string): Promise<boolean> {
  for (const destination of readDestinations(storageKey)) {
    if (await fileExistsAtDestination(storageKey, destination)) return true;
  }
  return false;
}

async function fileSizeAtDestination(
  storageKey: string,
  destination: StorageDestination,
): Promise<number> {
  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    try {
      const head = await client.send(new HeadObjectCommand({
        Bucket: spaces.bucket,
        Key: storageKeyToObjectKey(storageKey),
      }));
      if (typeof head.ContentLength === 'number') return head.ContentLength;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    throw notFound('File');
  }

  const info = await stat(storageKeyToPathAt(destination, storageKey)).catch(() => null);
  if (!info) throw notFound('File');
  return info.size;
}

export async function localFileSize(storageKey: string): Promise<number> {
  for (const destination of readDestinations(storageKey)) {
    try {
      return await fileSizeAtDestination(storageKey, destination);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  throw notFound('File');
}

async function fileStreamAtDestination(
  storageKey: string,
  destination: StorageDestination,
): Promise<Readable> {
  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    try {
      const object = await client.send(new GetObjectCommand({
        Bucket: spaces.bucket,
        Key: storageKeyToObjectKey(storageKey),
      }));
      return asNodeReadable(object.Body);
    } catch (error) {
      if (isNotFoundError(error)) throw notFound('File');
      throw error;
    }
  }

  if (!(await fileExistsAtDestination(storageKey, destination))) throw notFound('File');
  return createReadStream(storageKeyToPathAt(destination, storageKey));
}

async function checksumForStream(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return hash.digest('hex');
}

async function checksumAtDestination(
  storageKey: string,
  destination: StorageDestination,
): Promise<string> {
  return checksumForStream(await fileStreamAtDestination(storageKey, destination));
}

export async function localFileStream(storageKey: string): Promise<Readable> {
  for (const destination of readDestinations(storageKey)) {
    try {
      return await fileStreamAtDestination(storageKey, destination);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  throw notFound('File');
}

export async function localFileBuffer(storageKey: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = await localFileStream(storageKey);
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export type StorageCopyResult =
  | { status: 'copied'; sizeBytes: number }
  | { status: 'already-present'; sizeBytes: number }
  | { status: 'missing-source'; sizeBytes: null };

export function hasIsolatedStorageDestination(app: StorageApp): boolean {
  return Boolean(appDestinations[app]);
}

export async function copyStoredFileBetweenLocations(
  storageKey: string,
  from: StorageLocation,
  to: StorageLocation,
  options: { overwrite?: boolean } = {},
): Promise<StorageCopyResult> {
  const source = migrationDestination(storageKey, from);
  const destination = migrationDestination(storageKey, to);
  if (destinationIdentity(source) === destinationIdentity(destination)) {
    const sizeBytes = await fileSizeAtDestination(storageKey, source);
    return { status: 'already-present', sizeBytes };
  }
  if (!(await fileExistsAtDestination(storageKey, source))) {
    return { status: 'missing-source', sizeBytes: null };
  }

  const sourceSize = await fileSizeAtDestination(storageKey, source);
  if (await fileExistsAtDestination(storageKey, destination)) {
    const destinationSize = await fileSizeAtDestination(storageKey, destination);
    const [sourceChecksum, destinationChecksum] = await Promise.all([
      checksumAtDestination(storageKey, source),
      checksumAtDestination(storageKey, destination),
    ]);
    if (
      destinationSize === sourceSize
      && destinationChecksum === sourceChecksum
    ) {
      return { status: 'already-present', sizeBytes: destinationSize };
    }
    if (!options.overwrite) {
      throw new Error(
        `Destination size mismatch for ${storageKey}; rerun with overwrite after review`,
      );
    }
    await deleteAtDestination(storageKey, destination);
  }

  if (source.provider === 'local' && destination.provider === 'local') {
    const destinationPath = storageKeyToPathAt(destination, storageKey);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(
      storageKeyToPathAt(source, storageKey),
      destinationPath,
      constants.COPYFILE_EXCL,
    );
  } else if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    await client.send(new PutObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
      Body: await fileStreamAtDestination(storageKey, source),
      ContentLength: sourceSize,
      ContentType: contentTypeForStorageKey(storageKey),
    }));
  } else {
    const destinationPath = storageKeyToPathAt(destination, storageKey);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await pipeline(
      await fileStreamAtDestination(storageKey, source),
      createWriteStream(destinationPath, { flags: 'wx' }),
    );
  }

  const copiedSize = await fileSizeAtDestination(storageKey, destination);
  const [sourceChecksum, copiedChecksum] = await Promise.all([
    checksumAtDestination(storageKey, source),
    checksumAtDestination(storageKey, destination),
  ]);
  if (copiedSize !== sourceSize || copiedChecksum !== sourceChecksum) {
    await deleteAtDestination(storageKey, destination);
    throw new Error(`Copied file verification failed for ${storageKey}`);
  }
  return { status: 'copied', sizeBytes: copiedSize };
}

async function deleteAtDestination(
  storageKey: string,
  destination: StorageDestination,
): Promise<void> {
  if (destination.provider === 'spaces') {
    const { client, spaces } = requireSpaces(destination);
    await client.send(new DeleteObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
    }));
    return;
  }
  await unlink(storageKeyToPathAt(destination, storageKey)).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    },
  );
}

export async function deleteLocalFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  for (const destination of readDestinations(storageKey)) {
    await deleteAtDestination(storageKey, destination);
  }
}

export function contentTypeForStorageKey(storageKey: string): string {
  switch (path.extname(storageKey).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
