import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pdfJobs, photoRegistry } from '../../db/schema/shared.js';
import { ssSites } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertSiteAccess } from './helpers.js';
import {
  makeNamedStorageKeyForFilename,
  publicFileUrl,
  sanitizeStorageSegment,
} from '../../storage/localFiles.js';
import { loadPhotoByIdOrName, loadSolarsenseSiteByIdOrName } from '../../services/storageNaming.js';
import {
  deletePhotoUnlessReferenced,
  hasAccessibleCopyReference,
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
  type PhotoRow,
} from '../../storage/photoCopyReferences.js';
import { conflict, notFound } from '../../utils/errors.js';
import { enqueueExportTask } from '../../services/exportJobQueue.js';
import { createPhotoZipStream, createStoredPhotoZip } from '../../services/photoZipExport.js';
import {
  completeJob,
  failJob,
  findActiveExportJob,
  markJobRunning,
  updateJobProgress,
  type ExportJobParams,
} from '../../services/pdfJobService.js';

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

async function runSolarSensePhotoZipJob(jobId: string, siteId: string, siteName: string): Promise<void> {
  try {
    await markJobRunning(jobId, 'Collecting photos...');
    const photos = await loadPhotosForParent({ app: 'solarsense', parentId: siteId });
    const storageKey = makeNamedStorageKeyForFilename({
      app: 'solarsense',
      parentName: siteName,
      entityType: 'exports',
      filename: `photos-${randomUUID()}.zip`,
    });
    await createStoredPhotoZip({
      photos,
      storageKey,
      entryName: zipEntryName,
      onProgress: async (current, total) => {
        if (current === total || current % 5 === 0) {
          await updateJobProgress(jobId, `Adding photos (${current} of ${total})...`, current, total);
        }
      },
      onSkipped: (photo, error) => {
        console.warn('[zip-job] Skipping unavailable SolarSense photo', {
          jobId,
          photoId: photo.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    await completeJob(jobId, publicFileUrl(storageKey), storageKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(jobId, message);
    console.error('[zip-job] SolarSense photo export failed', { jobId, siteId, error: message });
  }
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

    const archive = createPhotoZipStream(
      {
        photos,
        entryName: zipEntryName,
        onSkipped: (photo, error) => request.log.warn({ photoId: photo.id, error }, 'Skipping unavailable photo'),
      },
      (task) => task(),
    );

    return reply
      .header('Content-Disposition', `attachment; filename="solarsense-${site.id}-photos.zip"`)
      .type('application/zip')
      .send(archive);
  });

  app.post('/sites/:siteId/photos/export/jobs', {
    schema: {
      tags: ['SolarSense Photos', 'Export Jobs'],
      summary: 'Start a background SolarSense photo ZIP export',
      security: [{ bearerAuth: [] }],
      response: {
        202: {
          type: 'object',
          properties: { jobId: { type: 'string' }, reused: { type: 'boolean' } },
        },
      },
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('inspector')],
  }, async (request, reply) => {
    const { siteId: siteRef } = request.params as { siteId: string };
    const site = await loadSite(siteRef);
    assertSiteAccess(site, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'solarsense', parentId: site.id, actor: request.user });

    const params: ExportJobParams = {
      artifactType: 'photos-zip',
      filename: `${sanitizeStorageSegment(site.siteName)}-photos.zip`,
      contentType: 'application/zip',
    };
    const activeJob = await findActiveExportJob({
      app: 'solarsense',
      entityId: site.id,
      userId: request.user.userId,
      params,
    });
    if (activeJob) return reply.status(202).send({ jobId: activeJob.id, reused: true });

    const jobId = randomUUID();
    await db.insert(pdfJobs).values({
      id: jobId,
      app: 'solarsense',
      entityId: site.id,
      entityType: 'site',
      userId: request.user.userId,
      params,
      status: 'queued',
      phase: 'Queued...',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    void enqueueExportTask(() => runSolarSensePhotoZipJob(jobId, site.id, site.siteName)).catch((error) => {
      request.log.error({ jobId, error }, 'SolarSense photo ZIP queue failed');
    });
    return reply.status(202).send({ jobId, reused: false });
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
