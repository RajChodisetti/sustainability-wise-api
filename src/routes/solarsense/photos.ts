import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertSiteAccess } from './helpers.js';
import { localFileExists, localFileStream } from '../../storage/localFiles.js';
import { loadPhotoByIdOrName, loadSolarsenseSiteByIdOrName } from '../../services/storageNaming.js';
import {
  deletePhotoUnlessReferenced,
  hasAccessibleCopyReference,
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
  type PhotoRow,
} from '../../storage/photoCopyReferences.js';
import { conflict, notFound } from '../../utils/errors.js';

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
  return loadSolarsenseSiteByIdOrName(siteId);
}

function photoMetadata(photo: PhotoRow) {
  return {
    id: photo.id,
    checksum: photo.checksum,
    remoteUrl: photo.remoteUrl,
    contentType: photo.contentType,
    originalFilename: photo.originalFilename,
    app: photo.app,
    parentId: photo.parentId,
    entityType: photo.entityType,
    entityId: photo.entityId,
    fieldName: photo.fieldName,
    fileSizeBytes: photo.fileSizeBytes,
    status: photo.status,
    uploadedAt: photo.uploadedAt,
    createdAt: photo.createdAt,
  };
}

async function assertPhotoAccess(photo: PhotoRow, user: Parameters<typeof assertSiteAccess>[1]): Promise<void> {
  const [site] = await db
    .select()
    .from(ssSites)
    .where(and(eq(ssSites.id, photo.parentId), isNull(ssSites.deletedAt)));
  let directError: unknown;
  if (site) {
    try {
      assertSiteAccess(site, user);
      return;
    } catch (error) {
      directError = error;
    }
  }
  if (await hasAccessibleCopyReference(photo.id, user)) return;
  if (directError) throw directError;
  throw notFound('Photo');
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
    const { siteId: siteRef } = request.params as { siteId: string };
    const site = await loadSite(siteRef);
    assertSiteAccess(site, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: site.id, actor: request.user });

    const photos = (await loadPhotosForParent({ app: 'solarsense', parentId: site.id })).map(photoMetadata);

    return reply.send({ siteRef, siteId: site.id, siteName: site.siteName, data: photos });
  });

  app.get('/sites/:siteId/photos/export', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'Export SolarSense photos for a site as ZIP',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId: siteRef } = request.params as { siteId: string };
    const site = await loadSite(siteRef);
    assertSiteAccess(site, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: site.id, actor: request.user });

    const photos = await loadPhotosForParent({ app: 'solarsense', parentId: site.id });

    const archive = await createZipArchive();
    for (const photo of photos) {
      if (photo.storageKey && await localFileExists(photo.storageKey)) {
        archive.append(await localFileStream(photo.storageKey), { name: zipEntryName(photo) });
      }
    }
    void archive.finalize();

    return reply
      .header('Content-Disposition', `attachment; filename="solarsense-${site.id}-photos.zip"`)
      .type('application/zip')
      .send(archive);
  });

  app.get('/photos/:photoId', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'Get a SolarSense photo by id, original filename, or storage key',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const photo = await loadPhotoByIdOrName('solarsense', photoId);
    await assertPhotoAccess(photo, request.user);
    return reply.send(photo);
  });

  app.delete('/photos/:photoId', {
    schema: {
      tags: ['SolarSense Photos'],
      summary: 'Delete a SolarSense photo by id, original filename, or storage key',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const found = await loadPhotoByIdOrName('solarsense', photoId);

    if (!(await deletePhotoUnlessReferenced(found))) {
      throw conflict('Photo is still referenced by one or more copied sites');
    }

    return reply.status(204).send();
  });
}
