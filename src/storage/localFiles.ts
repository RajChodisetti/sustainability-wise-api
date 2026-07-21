import { constants, createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { badRequest, notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';

const storageRoot = path.resolve(config.storage.localRoot);
const spacesClient = config.storage.spaces
  ? new S3Client({
      region: config.storage.spaces.region,
      endpoint: config.storage.spaces.endpoint,
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.storage.spaces.accessKeyId,
        secretAccessKey: config.storage.spaces.secretAccessKey,
      },
    })
  : null;

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
  app: 'solarsense' | 'ecoaudit';
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
  app: 'solarsense' | 'ecoaudit';
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
  app: 'solarsense' | 'ecoaudit';
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
  app: 'solarsense' | 'ecoaudit';
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
  app: 'solarsense' | 'ecoaudit';
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
  app: 'solarsense' | 'ecoaudit';
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

export function storageKeyToPath(storageKey: string): string {
  const normalized = storageKeyToObjectKey(storageKey);
  const absolute = path.resolve(storageRoot, ...normalized.split('/'));
  if (absolute !== storageRoot && !absolute.startsWith(`${storageRoot}${path.sep}`)) {
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
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.$metadata?.httpStatusCode === 404
    || err?.name === 'NotFound'
    || err?.name === 'NoSuchKey';
}

function requireSpaces() {
  if (!spacesClient || !config.storage.spaces) {
    throw new Error('Spaces storage is not configured');
  }
  return { client: spacesClient, spaces: config.storage.spaces };
}

function asNodeReadable(body: unknown): NodeJS.ReadableStream {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as NodeJS.ReadableStream;
  }
  throw notFound('File');
}

export function publicFileUrl(storageKey: string): string {
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${config.publicBaseUrl}/v1/files/${encoded}`;
}

export async function listStoredFiles(prefix: string): Promise<StoredFileListing[]> {
  const objectPrefix = storageKeyToObjectKey(prefix).replace(/\/?$/, '/');
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
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

  const absolutePrefix = storageKeyToPath(objectPrefix);
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
        storageKey: path.relative(storageRoot, absolute).split(path.sep).join('/'),
        sizeBytes: info.size,
        lastModified: info.mtime,
      });
    }
  }
  await walk(absolutePrefix);
  return files.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

export async function writeLocalFile(storageKey: string, body: Buffer): Promise<{
  size: number;
  checksum: string;
}> {
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
    await client.send(new PutObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
      Body: body,
      ContentType: contentTypeForStorageKey(storageKey),
    }));
    return { size: body.length, checksum: sha256(body) };
  }

  const absolute = storageKeyToPath(storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body, { flag: 'wx' });
  return { size: body.length, checksum: sha256(body) };
}

export async function writeLocalFileFromPath(
  storageKey: string,
  sourcePath: string,
  contentType = contentTypeForStorageKey(storageKey),
): Promise<{ size: number }> {
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile()) throw badRequest('Stored export source must be a file');

  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
    await client.send(new PutObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
      Body: createReadStream(sourcePath),
      ContentLength: sourceInfo.size,
      ContentType: contentType,
    }));
    return { size: sourceInfo.size };
  }

  const absolute = storageKeyToPath(storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await copyFile(sourcePath, absolute, constants.COPYFILE_EXCL);
  return { size: sourceInfo.size };
}

export async function localFileExists(storageKey: string): Promise<boolean> {
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
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
    await access(storageKeyToPath(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function localFileSize(storageKey: string): Promise<number> {
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
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

  const info = await stat(storageKeyToPath(storageKey)).catch(() => null);
  if (!info) throw notFound('File');
  return info.size;
}

export async function localFileStream(storageKey: string): Promise<NodeJS.ReadableStream> {
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
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

  return createReadStream(storageKeyToPath(storageKey));
}

export async function localFileBuffer(storageKey: string): Promise<Buffer> {
  if (config.storage.provider !== 'spaces') {
    return readFile(storageKeyToPath(storageKey));
  }

  const chunks: Buffer[] = [];
  const stream = await localFileStream(storageKey);
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteLocalFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  if (config.storage.provider === 'spaces') {
    const { client, spaces } = requireSpaces();
    await client.send(new DeleteObjectCommand({
      Bucket: spaces.bucket,
      Key: storageKeyToObjectKey(storageKey),
    }));
    return;
  }

  await unlink(storageKeyToPath(storageKey)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
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
