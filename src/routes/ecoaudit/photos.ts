import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess } from './helpers.js';
import { localFileExists, localFileStream } from '../../storage/localFiles.js';
import { loadEcoAuditByIdOrName, loadPhotoByIdOrName } from '../../services/storageNaming.js';
import {
  deletePhotoUnlessReferenced,
  hasAccessibleCopyReference,
  loadPhotosForParent,
  reconcilePhotoCopyReferencesForParent,
  type PhotoRow,
} from '../../storage/photoCopyReferences.js';
import { conflict, notFound } from '../../utils/errors.js';
import { canonicalEcoAuditPhotoFieldName } from './lightingPhotoField.js';

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

function photoMetadata(photo: PhotoRow) {
  return {
    id: photo.id, checksum: photo.checksum, remoteUrl: photo.remoteUrl,
    contentType: photo.contentType, originalFilename: photo.originalFilename,
    app: photo.app, parentId: photo.parentId, entityType: photo.entityType,
    entityId: photo.entityId, fieldName: canonicalEcoAuditPhotoFieldName(photo.fieldName),
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

export async function eaPhotoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audits/:auditId/photos', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: audit.id, actor: request.user });
    const photos = (await loadPhotosForParent({ app: 'ecoaudit', parentId: audit.id })).map(photoMetadata);
    return reply.send({ auditRef, auditId: audit.id, auditName: audit.siteName, data: photos });
  });

  app.get('/audits/:auditId/photos/export', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    await reconcilePhotoCopyReferencesForParent({ app: 'ecoaudit', parentId: audit.id, actor: request.user });
    const photos = await loadPhotosForParent({ app: 'ecoaudit', parentId: audit.id });
    const archive = await createZipArchive();
    for (const photo of photos) {
      if (photo.storageKey && await localFileExists(photo.storageKey)) {
        const name = [photo.entityType, photo.entityId, photo.fieldName, photo.originalFilename || `${photo.fieldName}-${photo.id}`].join('/').replace(/[^\w/.()-]+/g, '-');
        archive.append(await localFileStream(photo.storageKey), { name });
      }
    }
    void archive.finalize();
    return reply
      .header('Content-Disposition', `attachment; filename="ecoaudit-${audit.id}-photos.zip"`)
      .type('application/zip')
      .send(archive);
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
