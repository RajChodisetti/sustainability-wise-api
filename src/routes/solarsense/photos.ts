import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertSiteAccess } from './helpers.js';
import { deleteLocalFile, localFileExists, localFileStream } from '../../storage/localFiles.js';

type ZipArchiveInstance = NodeJS.ReadableStream & {
  append(source: NodeJS.ReadableStream | Buffer | string, data: { name: string }): void;
  file(source: string, data: { name: string }): void;
  finalize(): Promise<void>;
};

async function createZipArchive(): Promise<ZipArchiveInstance> {
  const mod = await import('archiver') as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance;
  };
  return new mod.ZipArchive({ zlib: { level: 9 } });
}

async function loadSite(siteId: string) {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, siteId), isNull(ssSites.deletedAt)));
  return assertFound(site, 'Site');
}

function zipEntryName(photo: typeof photoRegistry.$inferSelect): string {
  const filename = photo.originalFilename || `${photo.fieldName}-${photo.id}`;
  return [
    photo.entityType,
    photo.entityId,
    photo.fieldName,
    filename.replace(/[^\w .()-]+/g, '-'),
  ].join('/');
}

export async function solarsensePhotoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sites/:siteId/photos', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'List SolarSense photos for a site',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const site = await loadSite(siteId);
    assertSiteAccess(site, request.user);

    const photos = await db
      .select({
        id: photoRegistry.id,
        checksum: photoRegistry.checksum,
        remoteUrl: photoRegistry.remoteUrl,
        contentType: photoRegistry.contentType,
        originalFilename: photoRegistry.originalFilename,
        app: photoRegistry.app,
        parentId: photoRegistry.parentId,
        entityType: photoRegistry.entityType,
        entityId: photoRegistry.entityId,
        fieldName: photoRegistry.fieldName,
        fileSizeBytes: photoRegistry.fileSizeBytes,
        status: photoRegistry.status,
        uploadedAt: photoRegistry.uploadedAt,
        createdAt: photoRegistry.createdAt,
      })
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.parentId, siteId),
        eq(photoRegistry.status, 'confirmed'),
      ));

    return reply.send({ data: photos });
  });

  app.get('/sites/:siteId/photos/export', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'Export SolarSense photos for a site as ZIP',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const site = await loadSite(siteId);
    assertSiteAccess(site, request.user);

    const photos = await db
      .select()
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'solarsense'),
        eq(photoRegistry.parentId, siteId),
        eq(photoRegistry.status, 'confirmed'),
      ));

    const archive = await createZipArchive();
    for (const photo of photos) {
      if (photo.storageKey && await localFileExists(photo.storageKey)) {
        archive.append(await localFileStream(photo.storageKey), { name: zipEntryName(photo) });
      }
    }
    void archive.finalize();

    return reply
      .header('Content-Disposition', `attachment; filename="solarsense-${siteId}-photos.zip"`)
      .type('application/zip')
      .send(archive);
  });

  app.delete('/photos/:photoId', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'Delete a SolarSense photo',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const [photo] = await db
      .select()
      .from(photoRegistry)
      .where(and(eq(photoRegistry.id, photoId), eq(photoRegistry.app, 'solarsense')));
    const found = assertFound(photo, 'Photo');

    await deleteLocalFile(found.storageKey);
    await db.delete(photoRegistry).where(eq(photoRegistry.id, photoId));

    return reply.status(204).send();
  });
}
