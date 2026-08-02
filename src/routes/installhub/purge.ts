import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  ihCompletionIdempotency,
  ihDisplayCodeClaims,
  ihElectricalAssets,
  ihFormSubmissions,
  ihGridSupplies,
  ihInstallations,
  ihMeasurementAssignmentChannels,
  ihMeasurementAssignments,
  ihMeterChannels,
  ihMeterDevices,
  ihSiteAssets,
  ihZones,
} from '../../db/schema/installhub.js';
import {
  pdfJobs,
  photoCopyReferences,
  photoRegistry,
  recordVersions,
  storageDeletionTasks,
} from '../../db/schema/shared.js';
import { drainStorageDeletionTasks } from '../../services/storageDeletionService.js';
import { badRequest, conflict } from '../../utils/errors.js';
import type { InstallHubExecutor } from './treeService.js';

type PurgeCleanupTask = {
  id: string;
  storageKey: string;
};

async function queueStorageCleanup(
  executor: InstallHubExecutor,
  storageKeys: string[],
): Promise<PurgeCleanupTask[]> {
  const keys = [...new Set(storageKeys.filter((value) => value.length > 0))];
  if (!keys.length) return [];
  await executor.insert(storageDeletionTasks).values(keys.map((storageKey) => ({
    id: randomUUID(),
    app: 'installhub',
    storageKey,
    reason: 'installation_purge',
  }))).onConflictDoNothing({ target: storageDeletionTasks.storageKey });
  return executor
    .select({ id: storageDeletionTasks.id, storageKey: storageDeletionTasks.storageKey })
    .from(storageDeletionTasks)
    .where(inArray(storageDeletionTasks.storageKey, keys));
}

async function pinnedVersionReferencesPhoto(
  executor: InstallHubExecutor,
  photoId: string,
): Promise<boolean> {
  const [reference] = await executor
    .select({ id: recordVersions.id })
    .from(recordVersions)
    .where(sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(${recordVersions.snapshot}->'mediaManifest', '[]'::jsonb)) AS media
      WHERE media->>'id' = ${photoId}
    )`)
    .limit(1);
  return Boolean(reference);
}

/**
 * Permanently removes one Field App Complete server tree.
 *
 * The installation row is the lifecycle mutex shared with completion and PDF
 * enqueue. All database rows and durable file-cleanup tasks commit atomically;
 * physical bytes are removed only after commit and unfinished work is replayed
 * by startup cleanup.
 */
export async function purgeInstallHubInstallationTree(
  installationId: string,
): Promise<void> {
  const cleanupTasks = await db.transaction(async (tx) => {
    const [installation] = await tx
      .select({
        id: ihInstallations.id,
        status: ihInstallations.status,
      })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId))
      .for('update')
      .limit(1);
    if (!installation) throw badRequest('Installation was already purged');
    if (installation.status === 'Completed') {
      throw conflict('installation_completed_reopen_required');
    }

    const tombstonedAt = new Date();
    await tx.update(ihInstallations).set({
      deletedAt: tombstonedAt,
      updatedAt: tombstonedAt,
      syncStatus: 'local',
    }).where(eq(ihInstallations.id, installation.id));

    const forms = await tx
      .select({ id: ihFormSubmissions.id })
      .from(ihFormSubmissions)
      .where(eq(ihFormSubmissions.installationId, installation.id));
    const formIds = forms.map((form) => form.id);
    const installationJobCondition = and(
      eq(pdfJobs.app, 'installhub'),
      eq(pdfJobs.entityType, 'installation'),
      eq(pdfJobs.entityId, installation.id),
    );
    const jobs = await tx
      .select({
        id: pdfJobs.id,
        status: pdfJobs.status,
        storageKey: pdfJobs.storageKey,
      })
      .from(pdfJobs)
      .where(formIds.length
        ? or(
            installationJobCondition,
            and(
              eq(pdfJobs.app, 'installhub'),
              eq(pdfJobs.entityType, 'form_submission'),
              inArray(pdfJobs.entityId, formIds),
            ),
          )
        : installationJobCondition)
      .for('update');
    if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
      throw badRequest('Wait for active Field App Complete PDF jobs to finish before deleting this Cloud Backup');
    }

    const releasedLinks = await tx
      .select({ photoId: photoCopyReferences.photoId })
      .from(photoCopyReferences)
      .where(and(
        eq(photoCopyReferences.app, 'installhub'),
        eq(photoCopyReferences.targetParentId, installation.id),
      ))
      .for('update');
    await tx.delete(photoCopyReferences).where(and(
      eq(photoCopyReferences.app, 'installhub'),
      eq(photoCopyReferences.targetParentId, installation.id),
    ));

    // Purging is the only operation that releases immutable canonical-version
    // evidence. Remove manifests before evaluating the photo deletion fence.
    await tx.delete(recordVersions).where(and(
      eq(recordVersions.app, 'installhub'),
      eq(recordVersions.entityType, 'installation'),
      eq(recordVersions.entityId, installation.id),
    ));

    const ownedPhotos = await tx
      .select({ id: photoRegistry.id })
      .from(photoRegistry)
      .where(and(
        eq(photoRegistry.app, 'installhub'),
        eq(photoRegistry.parentId, installation.id),
      ));
    const candidatePhotoIds = [...new Set([
      ...ownedPhotos.map((photo) => photo.id),
      ...releasedLinks.map((link) => link.photoId),
    ])];
    const photos = candidatePhotoIds.length
      ? await tx
        .select()
        .from(photoRegistry)
        .where(inArray(photoRegistry.id, candidatePhotoIds))
        .for('update')
      : [];
    const photosToDelete: typeof photos = [];
    for (const photo of photos) {
      if (photo.app !== 'installhub') continue;
      const [copyReference] = await tx
        .select({ id: photoCopyReferences.id })
        .from(photoCopyReferences)
        .where(eq(photoCopyReferences.photoId, photo.id))
        .limit(1);
      if (copyReference || await pinnedVersionReferencesPhoto(tx, photo.id)) continue;
      const ownedByPurgedInstallation = photo.parentId === installation.id;
      const [originalParent] = ownedByPurgedInstallation
        ? []
        : await tx
          .select({ id: ihInstallations.id })
          .from(ihInstallations)
          .where(eq(ihInstallations.id, photo.parentId))
          .limit(1);
      if (ownedByPurgedInstallation || !originalParent) photosToDelete.push(photo);
    }

    const cleanup = await queueStorageCleanup(tx, [
      ...photosToDelete.flatMap((photo) => photo.storageKey ? [photo.storageKey] : []),
      ...jobs.flatMap((job) => job.storageKey ? [job.storageKey] : []),
    ]);
    if (photosToDelete.length) {
      await tx.delete(photoRegistry).where(inArray(
        photoRegistry.id,
        photosToDelete.map((photo) => photo.id),
      ));
    }
    if (jobs.length) {
      await tx.delete(pdfJobs).where(inArray(pdfJobs.id, jobs.map((job) => job.id)));
    }

    await tx.delete(ihFormSubmissions).where(eq(ihFormSubmissions.installationId, installation.id));
    await tx.delete(ihMeasurementAssignmentChannels).where(eq(ihMeasurementAssignmentChannels.installationId, installation.id));
    await tx.delete(ihMeasurementAssignments).where(eq(ihMeasurementAssignments.installationId, installation.id));
    await tx.delete(ihMeterChannels).where(eq(ihMeterChannels.installationId, installation.id));
    await tx.delete(ihMeterDevices).where(eq(ihMeterDevices.installationId, installation.id));
    await tx.delete(ihCompletionIdempotency).where(eq(ihCompletionIdempotency.installationId, installation.id));
    await tx.delete(ihDisplayCodeClaims).where(eq(ihDisplayCodeClaims.installationId, installation.id));
    await tx.delete(ihSiteAssets).where(eq(ihSiteAssets.installationId, installation.id));
    await tx.delete(ihElectricalAssets).where(eq(ihElectricalAssets.installationId, installation.id));
    await tx.delete(ihGridSupplies).where(eq(ihGridSupplies.installationId, installation.id));
    await tx.delete(ihZones).where(eq(ihZones.installationId, installation.id));
    await tx.delete(ihInstallations).where(and(
      eq(ihInstallations.id, installation.id),
      eq(ihInstallations.deletedAt, tombstonedAt),
    ));
    return cleanup;
  });

  if (cleanupTasks.length) {
    await drainStorageDeletionTasks({
      ids: cleanupTasks.map((task) => task.id),
      app: 'installhub',
    });
  }
}
