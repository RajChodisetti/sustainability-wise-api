import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { photoRegistry } from '../../db/schema/shared.js';
import { eaAudits } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { assertFound, assertAuditAccess } from './helpers.js';
import { deleteLocalFile, localFileExists, localFileStream } from '../../storage/localFiles.js';
import { loadEcoAuditByIdOrName, loadPhotoByIdOrName } from '../../services/storageNaming.js';

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

export async function eaPhotoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audits/:auditId/photos', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    const photos = await db.select({
      id: photoRegistry.id, checksum: photoRegistry.checksum, remoteUrl: photoRegistry.remoteUrl,
      contentType: photoRegistry.contentType, originalFilename: photoRegistry.originalFilename,
      app: photoRegistry.app, parentId: photoRegistry.parentId, entityType: photoRegistry.entityType,
      entityId: photoRegistry.entityId, fieldName: photoRegistry.fieldName,
      fileSizeBytes: photoRegistry.fileSizeBytes, status: photoRegistry.status,
      uploadedAt: photoRegistry.uploadedAt, createdAt: photoRegistry.createdAt,
    }).from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.parentId, audit.id),
      eq(photoRegistry.status, 'confirmed'),
    ));
    return reply.send({ auditRef, auditId: audit.id, auditName: audit.siteName, data: photos });
  });

  app.get('/audits/:auditId/photos/export', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('inspector')],
  }, async (request, reply) => {
    const { auditId: auditRef } = request.params as { auditId: string };
    const audit = await loadEcoAuditByIdOrName(auditRef);
    assertAuditAccess(audit, request.user);
    const photos = await db.select().from(photoRegistry).where(and(
      eq(photoRegistry.app, 'ecoaudit'),
      eq(photoRegistry.parentId, audit.id),
      eq(photoRegistry.status, 'confirmed'),
    ));
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
    const [audit] = await db.select().from(eaAudits).where(and(eq(eaAudits.id, photo.parentId), isNull(eaAudits.deletedAt)));
    assertAuditAccess(assertFound(audit, 'Audit'), request.user);
    return reply.send(photo);
  });

  app.delete('/photos/:photoId', {
    schema: { tags: ['EcoAudit Photos'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const { photoId } = request.params as { photoId: string };
    const found = await loadPhotoByIdOrName('ecoaudit', photoId);
    await deleteLocalFile(found.storageKey);
    await db.delete(photoRegistry).where(eq(photoRegistry.id, found.id));
    return reply.status(204).send();
  });
}
