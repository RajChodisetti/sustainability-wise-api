import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/utils/crypto.js';
import { joinOneDrivePath, sanitizeOneDrivePathSegment } from '../src/onedrive/paths.js';
import {
  downloadBufferFromOneDrivePath,
  requireOneDriveTarget,
  uploadBufferToOneDrivePath,
} from '../src/onedrive/uploadSession.js';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function contentTypeForFilename(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

const sourcePath = path.resolve(
  process.cwd(),
  argValue('--file') ?? (env('ONEDRIVE_SMOKE_PHOTO_PATH') || 'src/pdf/brand-logo.png'),
);

const target = requireOneDriveTarget({
  tenantId: env('AZURE_TENANT_ID'),
  clientId: env('AZURE_CLIENT_ID'),
  clientSecret: env('AZURE_CLIENT_SECRET'),
  userEmail: env('ONEDRIVE_USER_EMAIL'),
  photosFolder: env('ONEDRIVE_PHOTOS_FOLDER') || 'SustainabilityWise/photos',
});

const body = await readFile(sourcePath);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const drivePath = joinOneDrivePath(
  target.photosFolder,
  '_smoke',
  `${stamp}-${sanitizeOneDrivePathSegment(path.basename(sourcePath))}`,
);

const upload = await uploadBufferToOneDrivePath({
  target,
  drivePath,
  body,
  contentType: contentTypeForFilename(sourcePath),
});
const downloaded = await downloadBufferFromOneDrivePath({ target, drivePath });

if (sha256(body) !== sha256(downloaded)) {
  throw new Error(`OneDrive smoke download checksum mismatch for ${drivePath}`);
}

console.log(JSON.stringify({
  ok: true,
  sourcePath,
  drivePath,
  itemId: upload.itemId,
  sizeBytes: upload.sizeBytes,
  webUrl: upload.webUrl,
  checksum: sha256(body),
}, null, 2));
