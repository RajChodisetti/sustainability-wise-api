import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  ihElectricalAssets,
  ihFormSubmissions,
  ihInstallations,
  ihSiteAssets,
  ihZones,
} from '../../db/schema/installhub.js';
import { pdfJobs, recordVersions } from '../../db/schema/shared.js';
import { deleteLocalFile } from '../../storage/localFiles.js';
import {
  deleteOwnedPhotosUnlessReferenced,
  releaseCopyReferencesForParent,
} from '../../storage/photoCopyReferences.js';
import { badRequest } from '../../utils/errors.js';

type PdfJobRow = Pick<
  typeof pdfJobs.$inferSelect,
  'id' | 'status' | 'storageKey'
>;

async function installHubPdfJobs(
  installationId: string,
  formIds: string[],
): Promise<PdfJobRow[]> {
  const installationJobs = await db
    .select({
      id: pdfJobs.id,
      status: pdfJobs.status,
      storageKey: pdfJobs.storageKey,
    })
    .from(pdfJobs)
    .where(and(
      eq(pdfJobs.app, 'installhub'),
      eq(pdfJobs.entityType, 'installation'),
      eq(pdfJobs.entityId, installationId),
    ));
  if (!formIds.length) return installationJobs;
  const formJobs = await db
    .select({
      id: pdfJobs.id,
      status: pdfJobs.status,
      storageKey: pdfJobs.storageKey,
    })
    .from(pdfJobs)
    .where(and(
      eq(pdfJobs.app, 'installhub'),
      eq(pdfJobs.entityType, 'form_submission'),
      inArray(pdfJobs.entityId, formIds),
    ));
  return [...installationJobs, ...formJobs];
}

/**
 * Permanently removes one InstallHub server tree while retaining immutable
 * originals that are still referenced by an authorized copied installation.
 */
export async function purgeInstallHubInstallationTree(
  installationId: string,
): Promise<void> {
  const forms = await db
    .select({ id: ihFormSubmissions.id })
    .from(ihFormSubmissions)
    .where(eq(ihFormSubmissions.installationId, installationId));
  const formIds = forms.map((form) => form.id);
  const jobs = await installHubPdfJobs(installationId, formIds);
  if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
    throw badRequest('Wait for active InstallHub PDF jobs to finish before deleting this Cloud Backup');
  }

  await releaseCopyReferencesForParent('installhub', installationId);
  await deleteOwnedPhotosUnlessReferenced({
    app: 'installhub',
    parentId: installationId,
  });

  for (const storageKey of new Set(
    jobs.map((job) => job.storageKey).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  )) {
    await deleteLocalFile(storageKey);
  }

  await db.delete(pdfJobs).where(and(
    eq(pdfJobs.app, 'installhub'),
    eq(pdfJobs.entityType, 'installation'),
    eq(pdfJobs.entityId, installationId),
  ));
  if (formIds.length) {
    await db.delete(pdfJobs).where(and(
      eq(pdfJobs.app, 'installhub'),
      eq(pdfJobs.entityType, 'form_submission'),
      inArray(pdfJobs.entityId, formIds),
    ));
  }
  await db.delete(recordVersions).where(and(
    eq(recordVersions.app, 'installhub'),
    eq(recordVersions.entityType, 'installation'),
    eq(recordVersions.entityId, installationId),
  ));
  await db
    .delete(ihFormSubmissions)
    .where(eq(ihFormSubmissions.installationId, installationId));
  await db
    .delete(ihElectricalAssets)
    .where(eq(ihElectricalAssets.installationId, installationId));
  await db
    .delete(ihSiteAssets)
    .where(eq(ihSiteAssets.installationId, installationId));
  await db
    .delete(ihZones)
    .where(eq(ihZones.installationId, installationId));
  await db
    .delete(ihInstallations)
    .where(eq(ihInstallations.id, installationId));
}
