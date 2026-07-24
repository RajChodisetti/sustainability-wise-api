import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../auth/middleware.js';
import { localFileStream, type StorageApp } from '../storage/localFiles.js';
import {
  type ConfirmedPhotoReference,
} from '../storage/photoRegistryReferences.js';
import { ensurePhotoThumbnail } from '../storage/thumbnails.js';
import { thumbnailEtagForChecksum } from '../storage/thumbnailReference.js';
import {
  loadAuthorizedPhotoById,
  loadAuthorizedPhotoByReference,
} from '../storage/photoAuthorization.js';

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === etag || value === `W/${etag}` || value === '*');
}

function addAuthorizationVary(reply: FastifyReply): void {
  const existingHeader = reply.getHeader('Vary');
  const existing = Array.isArray(existingHeader)
    ? existingHeader.join(',')
    : String(existingHeader ?? '');
  const fields = existing
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.includes('*')) return;
  if (!fields.some((field) => field.toLowerCase() === 'authorization')) {
    fields.push('Authorization');
  }
  reply.header('Vary', fields.join(', '));
}

async function sendThumbnail(
  photo: ConfirmedPhotoReference,
  ifNoneMatch: string | undefined,
  reply: FastifyReply,
) {
  const etag = thumbnailEtagForChecksum(photo.checksum);
  addAuthorizationVary(reply);

  if (etagMatches(ifNoneMatch, etag)) {
    return reply
      .header('ETag', etag)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .status(304)
      .send();
  }

  const thumbnail = await ensurePhotoThumbnail({
    app: photo.app as StorageApp,
    originalStorageKey: photo.storageKey,
    checksum: photo.checksum,
  });
  const stream = await localFileStream(thumbnail.storageKey);

  return reply
    .header('Content-Length', String(thumbnail.size))
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .header('ETag', etag)
    .header('X-Original-Checksum', photo.checksum)
    .type('image/jpeg')
    .send(stream);
}

const thumbnailRateLimit = { max: 5_000, timeWindow: '1 minute' } as const;

export async function thumbnailRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/photo-thumbnails/:photoId', {
    config: { rateLimit: thumbnailRateLimit },
    schema: {
      tags: ['Files'],
      summary: 'Download a cached 400px thumbnail by authenticated photo id',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireRole('inspector')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const photo = await loadAuthorizedPhotoById(photoId, request.user);
    return sendThumbnail(photo, request.headers['if-none-match'], reply);
  });

  app.get('/v1/thumbnails/*', {
    config: {
      // A single imported audit can legitimately enqueue hundreds of previews.
      // Keep abuse protection while avoiding the much lower global API limit.
      rateLimit: thumbnailRateLimit,
    },
    schema: {
      tags: ['Files'],
      summary: 'Download a cached 400px thumbnail for an authenticated photo reference',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireRole('inspector')],
  }, async (request, reply) => {
    const storageKey = (request.params as { '*': string })['*'];
    const photo = await loadAuthorizedPhotoByReference(storageKey, request.user);
    return sendThumbnail(photo, request.headers['if-none-match'], reply);
  });
}
