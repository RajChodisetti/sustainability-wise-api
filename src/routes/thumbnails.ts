import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { authenticate, requireRole, type AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { photoRegistry } from '../db/schema/shared.js';
import { ssSites } from '../db/schema/solarsense.js';
import { assertAuditAccess } from './ecoaudit/helpers.js';
import { assertSiteAccess } from './solarsense/helpers.js';
import { localFileStream } from '../storage/localFiles.js';
import { ensurePhotoThumbnail } from '../storage/thumbnails.js';
import { thumbnailEtagForChecksum } from '../storage/thumbnailReference.js';
import { notFound } from '../utils/errors.js';

type ConfirmedPhoto = typeof photoRegistry.$inferSelect & { storageKey: string };

async function loadAuthorizedPhoto(storageKey: string, user: AuthUser): Promise<ConfirmedPhoto> {
  const [photo] = await db
    .select()
    .from(photoRegistry)
    .where(and(
      eq(photoRegistry.storageKey, storageKey),
      eq(photoRegistry.app, user.app),
      eq(photoRegistry.status, 'confirmed'),
    ))
    .limit(1);

  if (!photo?.storageKey) throw notFound('Photo');

  if (user.app === 'ecoaudit') {
    const [audit] = await db
      .select()
      .from(eaAudits)
      .where(and(eq(eaAudits.id, photo.parentId), isNull(eaAudits.deletedAt)))
      .limit(1);
    if (!audit) throw notFound('Photo');
    assertAuditAccess(audit, user);
  } else {
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, photo.parentId), isNull(ssSites.deletedAt)))
      .limit(1);
    if (!site) throw notFound('Photo');
    assertSiteAccess(site, user);
  }

  return photo as ConfirmedPhoto;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === etag || value === `W/${etag}` || value === '*');
}

export async function thumbnailRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/thumbnails/*', {
    schema: {
      tags: ['Files'],
      summary: 'Download a cached 400px thumbnail for an authenticated photo reference',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireRole('inspector')],
  }, async (request, reply) => {
    const storageKey = (request.params as { '*': string })['*'];
    const photo = await loadAuthorizedPhoto(storageKey, request.user);
    const etag = thumbnailEtagForChecksum(photo.checksum);

    if (etagMatches(request.headers['if-none-match'], etag)) {
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
  });
}
