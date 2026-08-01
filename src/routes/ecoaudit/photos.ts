import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pdfJobs } from '../../db/schema/shared.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertAuditAccess } from './helpers.js';
import {
  makeNamedStorageKeyForFilename,
  publicFileUrl,
  sanitizeStorageSegment,
} from '../../storage/localFiles.js';
import { loadEcoAuditByIdOrName, loadPhotoByIdOrName } from '../../services/storageNaming.js';
import {
  deletePhotoUnlessReferenced,
  hasAccessibleCopyReference,
  loadCurrentPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
  type PhotoRow,
} from '../../storage/photoCopyReferences.js';
import { conflict, notFound } from '../../utils/errors.js';
import { canonicalEcoAuditPhotoFieldName } from './lightingPhotoField.js';
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
import {
  createEcoAuditPhotoZipEntryNamer,
  loadEcoAuditPhotoZipContext,
  parseEcoAuditPhotoZipMode,
  resolveEcoAuditPhotoCaption,
  type EcoAuditPhotoZipContext,
  type EcoAuditPhotoZipMode,
} from './photoZipHierarchy.js';

function photoMetadata(photo: PhotoRow, context?: EcoAuditPhotoZipContext) {
  return {
    id: photo.id, checksum: photo.checksum, remoteUrl: photo.remoteUrl,
    contentType: photo.contentType, originalFilename: photo.originalFilename,
    app: photo.app, parentId: photo.parentId, entityType: photo.entityType,
    entityId: photo.entityId, fieldName: canonicalEcoAuditPhotoFieldName(photo.fieldName),
    caption: context ? resolveEcoAuditPhotoCaption(context, photo) : null,
    fileSizeBytes: photo.fileSizeBytes, status: photo.status,
    uploadedAt: photo.uploadedAt, createdAt: photo.createdAt,
  };
}

async function assertPhotoAccess(photo: PhotoRow, user: Parameters<typeof assertAuditAccess>[1]): Promise<void> {
  const [audit] = await db.select().from(eaAudits).where(and(
    eq(eaAudits.id, photo.parentId),
    isNull(eaAudits.deletedAt),
  ));
  let directError: unknown;
  if (audit) {
    try {
      assertAuditAccess(audit, user);
      return;
    } catch (error) {
      directError = error;
    }
  }
  if (await hasAccessibleCopyReference(photo.id, user)) return;
  if (directError) throw directError;
  throw notFound('Photo');
}

async function runEcoAuditPhotoZipJob(
  jobId: string,
  auditId: string,
  auditName: string,
  mode: EcoAuditPhotoZipMode,
): Promise<void> {
  try {
    await markJobRunning(jobId, 'Collecting photos...');
    const [photos, hierarchy] = await Promise.all([
      loadCurrentPhotosForParent({ app: 'ecoaudit', parentId: auditId }),
      loadEcoAuditPhotoZipContext(auditId),
    ]);
    const storageKey = makeNamedStorageKeyForFilename({
      app: 'ecoaudit',
      parentName: auditName,
      entityType: 'exports',
      filename: `photos-${randomUUID()}.zip`,
    });
    await createStoredPhotoZip({
      photos,
      storageKey,
      entryName: createEcoAuditPhotoZipEntryNamer(hierarchy, mode),
      onProgress: async (current, total) => {
        if (current === total || current % 5 === 0) {
          await updateJobProgress(jobId, `Adding photos (${current} of ${total})...`, current, total);
        }
      },
      onSkipped: (photo, error) => {
        console.warn('[zip-job] Skipping unavailable EcoAudit photo', {
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
    console.error('[zip-job] EcoAudit photo export failed', { jobId, auditId, error: message });
  }
}

export async function eaPhotoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audits/:auditId/photos', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: audit.id, actor: request.user });
    const [photoRows, context] = await Promise.all([
      loadCurrentPhotosForParent({ app: 'ecoaudit', parentId: audit.id }),
      loadEcoAuditPhotoZipContext(audit.id),
    ]);
    const photos = photoRows.map((photo) => photoMetadata(photo, context));
    return reply.send({ auditRef, auditId: audit.id, auditName: audit.siteName, data: photos });
  });

  app.get('/audits/:auditId/photos/export', {
    schema: {
      tags: ['EcoAudit Photos'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['by-zone', 'by-equipment'] } },
      },
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const mode = parseEcoAuditPhotoZipMode((request.query as { mode?: string }).mode);
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: audit.id, actor: request.user });
    const [photos, hierarchy] = await Promise.all([
      loadCurrentPhotosForParent({ app: 'ecoaudit', parentId: audit.id }),
      loadEcoAuditPhotoZipContext(audit.id),
    ]);
    const archive = createPhotoZipStream(
      {
        photos,
        entryName: createEcoAuditPhotoZipEntryNamer(hierarchy, mode),
        onSkipped: (photo, error) => request.log.warn({ photoId: photo.id, error }, 'Skipping unavailable photo'),
      },
      (task) => task(),
    );
    const modeName = mode === 'by-zone' ? 'zone' : 'equipment';
    return reply
      .header('Content-Disposition', `attachment; filename="${sanitizeStorageSegment(audit.siteName)}-${modeName}-photos.zip"`)
      .type('application/zip')
      .send(archive);
  });

  app.post('/audits/:auditId/photos/export/jobs', {
    schema: {
      tags: ['EcoAudit Photos', 'Export Jobs'],
      summary: 'Start a background EcoAudit photo ZIP export',
      security: [{ bearerAuth: [] }],
      body: {
        anyOf: [
          {
            type: 'object',
            properties: { mode: { type: 'string', enum: ['by-zone', 'by-equipment'] } },
          },
          { type: 'null' },
        ],
      },
      response: {
        202: {
          type: 'object',
          properties: { jobId: { type: 'string' }, reused: { type: 'boolean' } },
        },
      },
    },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const mode = parseEcoAuditPhotoZipMode((request.body as { mode?: string } | undefined)?.mode);
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: audit.id, actor: request.user });

    const params: ExportJobParams = {
      artifactType: 'photos-zip',
      filename: `${sanitizeStorageSegment(audit.siteName)}-${mode === 'by-zone' ? 'zone' : 'equipment'}-photos.zip`,
      contentType: 'application/zip',
      mode,
    };
    const activeJob = await findActiveExportJob({
      app: 'ecoaudit',
      entityId: audit.id,
      userId: request.user.userId,
      params,
    });
    if (activeJob) return reply.status(202).send({ jobId: activeJob.id, reused: true });

    const jobId = randomUUID();
    await db.insert(pdfJobs).values({
      id: jobId,
      app: 'ecoaudit',
      entityId: audit.id,
      entityType: 'audit',
      userId: request.user.userId,
      params,
      status: 'queued',
      phase: 'Queued...',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    void enqueueExportTask(() => runEcoAuditPhotoZipJob(jobId, audit.id, audit.siteName, mode)).catch((error) => {
      request.log.error({ jobId, error }, 'EcoAudit photo ZIP queue failed');
    });
    return reply.status(202).send({ jobId, reused: false });
  });

  app.get('/photos/:photoId', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const photo = await loadPhotoByIdOrName('ecoaudit', photoId);
    await assertPhotoAccess(photo, request.user);
    return reply.send(photo);
  });

  app.delete('/photos/:photoId', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const found = await loadPhotoByIdOrName('ecoaudit', photoId);
    if (!(await deletePhotoUnlessReferenced(found))) {
      throw conflict('Photo is still referenced by one or more copied audits');
    }
    return reply.status(204).send();
  });
}
