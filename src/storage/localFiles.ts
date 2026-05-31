import { createReadStream } from 'node:fs';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest, notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';

const storageRoot = path.resolve(config.storage.localRoot);

function sanitizeSegment(value: string): string {
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
  const filename = `${sanitizeSegment(args.fieldName)}-${args.sessionId}${safeExtension(args.filename)}`;
  return [
    args.app,
    sanitizeSegment(args.parentId),
    sanitizeSegment(args.entityType),
    sanitizeSegment(args.entityId),
    sanitizeSegment(args.fieldName),
    filename,
  ].join('/');
}

export function storageKeyToPath(storageKey: string): string {
  const normalized = path.posix.normalize(storageKey).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw badRequest('Invalid storage key');
  }

  const absolute = path.resolve(storageRoot, ...normalized.split('/'));
  if (absolute !== storageRoot && !absolute.startsWith(`${storageRoot}${path.sep}`)) {
    throw badRequest('Invalid storage key');
  }

  return absolute;
}

export function publicFileUrl(storageKey: string): string {
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${config.publicBaseUrl}/v1/files/${encoded}`;
}

export async function writeLocalFile(storageKey: string, body: Buffer): Promise<{
  size: number;
  checksum: string;
}> {
  const absolute = storageKeyToPath(storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body, { flag: 'wx' });
  return { size: body.length, checksum: sha256(body) };
}

export async function localFileExists(storageKey: string): Promise<boolean> {
  try {
    await access(storageKeyToPath(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function localFileSize(storageKey: string): Promise<number> {
  const info = await stat(storageKeyToPath(storageKey)).catch(() => null);
  if (!info) throw notFound('File');
  return info.size;
}

export function localFileStream(storageKey: string) {
  return createReadStream(storageKeyToPath(storageKey));
}

export async function deleteLocalFile(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
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
