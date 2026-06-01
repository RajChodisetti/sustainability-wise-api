import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess } from './helpers.js';
import { deleteLocalFile, localFileExists, storageKeyToPath } from '../../storage/localFiles.js';

type ZipArchiveInstance = NodeJS.ReadableStream & {
  file(source: string, data: { name: string }): void;
  finalize(): Promise<void>;
};

async function createZipArchive(): Promise<ZipArchiveInstance> {
  const mod = await import('archiver') as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance;
  };
  return new mod.ZipArchive({ zlib: { level: 9 } });
}

export async function eaPhotoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audits/:auditId/photos', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    const photos = await db.select({
      id: photoRegistry.id, checksum: photoRegistry.checksum, remoteUrl: photoRegistry.remoteUrl,
      contentType: photoRegistry.contentType, originalFilename: photoRegistry.originalFilename,
      app: photoRegistry.app, parentId: photoRegistry.parentId, entityType: photoRegistry.entityType,
      entityId: photoRegistry.entityId, fieldName: photoRegistry.fieldName,
      fileSizeBytes: photoRegistry.fileSizeBytes, status: photoRegistry.status,
      uploadedAt: photoRegistry.uploadedAt, createdAt: photoRegistry.createdAt,
    }).from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.parentId, auditId),
      eq(photoRegistry.status, 'confirmed'),
    ));
    return reply.send({ data: photos });
  });

  app.get('/audits/:auditId/photos/export', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId } = request.params as { auditId: string };
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, auditId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    const photos = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.parentId, auditId),
      eq(photoRegistry.status, 'confirmed'),
    ));
    const archive = await createZipArchive();
    for (const photo of photos) {
      if (photo.storageKey && await localFileExists(photo.storageKey)) {
        const name = [photo.entityType, photo.entityId, photo.fieldName, photo.originalFilename || `${photo.fieldName}-${photo.id}`].join('/').replace(/[^\w/.()-]+/g, '-');
        archive.file(storageKeyToPath(photo.storageKey), { name });
      }
    }
    void archive.finalize();
    return reply
      .header('Content-Disposition', `attachment; filename="ecoaudit-${auditId}-photos.zip"`)
      .type('application/zip')
      .send(archive);
  });

  app.delete('/photos/:photoId', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const [photo] = await db.select().from(photoRegistry).where(and(eq(photoRegistry.id, photoId), eq(photoRegistry.app, 'ecoaudit')));
    const found = assertFound(photo, 'Photo');
    await deleteLocalFile(found.storageKey);
    await db.delete(photoRegistry).where(eq(photoRegistry.id, photoId));
    return reply.status(204).send();
  });
}
