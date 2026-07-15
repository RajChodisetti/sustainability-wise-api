import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { authenticate, requireRole, type AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ssSites } from '../db/schema/solarsense.js';
import { assertAuditAccess } from './ecoaudit/helpers.js';
import { assertSiteAccess } from './solarsense/helpers.js';
import { localFileStream } from '../storage/localFiles.js';
import {
  findConfirmedPhotoById,
  resolveConfirmedPhotoReference,
  type ConfirmedPhotoReference,
} from '../storage/photoRegistryReferences.js';
import { ensurePhotoThumbnail } from '../storage/thumbnails.js';
import { thumbnailEtagForChecksum } from '../storage/thumbnailReference.js';
import { hasAccessibleCopyReference } from '../storage/photoCopyReferences.js';
import { notFound } from '../utils/errors.js';

async function authorizePhoto(
  photo: ConfirmedPhotoReference,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  let directAccessError: unknown;
  if (user.app === 'ecoaudit') {
    const [audit] = await db
      .select()
      .from(eaAudits)
      .where(and(eq(eaAudits.id, photo.parentId), isNull(eaAudits.deletedAt)))
      .limit(1);
    if (audit) {
      try {
        assertAuditAccess(audit, user);
        return photo;
      } catch (error) {
        directAccessError = error;
      }
    }
  } else {
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, photo.parentId), isNull(ssSites.deletedAt)))
      .limit(1);
    if (site) {
      try {
        assertSiteAccess(site, user);
        return photo;
      } catch (error) {
        directAccessError = error;
      }
    }
  }

  if (await hasAccessibleCopyReference(photo.id, user)) return photo;
  if (directAccessError) throw directAccessError;
  throw notFound('Photo');
}

async function loadAuthorizedPhotoByReference(
  storageKey: string,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  const photo = await resolveConfirmedPhotoReference(storageKey, user.app);
  if (!photo) throw notFound('Photo');
  return authorizePhoto(photo, user);
}

async function loadAuthorizedPhotoById(
  photoId: string,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  const photo = await findConfirmedPhotoById(photoId, user.app);
  if (!photo) throw notFound('Photo');
  return authorizePhoto(photo, user);
}

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
