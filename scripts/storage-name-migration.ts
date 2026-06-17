import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { config } from '../src/config.js';
import { closeDb, db } from '../src/db/client.js';
import { eaAudits } from '../src/db/schema/ecoaudit.js';
import { pdfJobs, photoRegistry } from '../src/db/schema/shared.js';
import { ssSites } from '../src/db/schema/solarsense.js';
import { oneDrivePathForStorageKey } from '../src/onedrive/paths.js';
import {
  deleteOneDrivePath,
  downloadBufferFromOneDrivePath,
  requireOneDriveTarget,
  uploadBufferToOneDrivePath,
  uploadPhotoBackupToOneDrive,
  type OneDriveTarget,
} from '../src/onedrive/uploadSession.js';
import {
  contentTypeForStorageKey,
  deleteLocalFile,
  localFileBuffer,
  localFileExists,
  publicFileUrl,
  writeLocalFile,
} from '../src/storage/localFiles.js';
import {
  ecoEntityName,
  isLikelyLegacyStorageKey,
  loadStorageNameMaps,
  makeExistingPdfStorageKeyFromName,
  makeExistingPhotoStorageKeyFromNames,
  solarEntityName,
  solarParentName,
  type AppName,
  type StorageNameMaps,
} from '../src/services/storageNaming.js';

type Options = {
  dryRun: boolean;
  photosOnly: boolean;
  pdfsOnly: boolean;
  failFast: boolean;
  keepOldStorage: boolean;
  keepOldOneDrive: boolean;
  skipOneDrive: boolean;
  limit: number | null;
};

type PhotoPlan = {
  kind: 'photo';
  id: string;
  app: AppName;
  oldKey: string;
  newKey: string;
  contentType: string | null;
  status: string;
  remoteUrl: string | null;
  onedriveItemId: string | null;
};

type PdfPlan = {
  kind: 'pdf';
  app: AppName;
  parentId: string;
  oldKey: string;
  newKey: string;
};

type PlanItem = PhotoPlan | PdfPlan;

type Summary = {
  planned: number;
  changed: number;
  skipped: number;
  failed: number;
  bytesCopied: number;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseLimit(): number | null {
  const raw = argValue('--limit');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error('--limit must be a positive integer');
  return parsed;
}

function parseOptions(): Options {
  const options = {
    dryRun: hasFlag('--dry-run'),
    photosOnly: hasFlag('--photos-only'),
    pdfsOnly: hasFlag('--pdfs-only'),
    failFast: hasFlag('--fail-fast'),
    keepOldStorage: hasFlag('--keep-old-storage'),
    keepOldOneDrive: hasFlag('--keep-old-onedrive'),
    skipOneDrive: hasFlag('--skip-onedrive'),
    limit: parseLimit(),
  };
  if (options.photosOnly && options.pdfsOnly) {
    throw new Error('Use either --photos-only or --pdfs-only, not both');
  }
  return options;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value < 10 ? 2 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function oldParentPrefix(item: PlanItem): string | null {
  const [app, parent] = item.oldKey.split('/');
  if ((app !== 'solarsense' && app !== 'ecoaudit') || !parent) return null;
  if (!isLikelyLegacyStorageKey(item.oldKey)) return null;
  return `${app}/${parent}`;
}

function applyLimit<T>(items: T[], limit: number | null): T[] {
  return limit ? items.slice(0, limit) : items;
}

function assertNoTargetCollisions(items: PlanItem[]): void {
  const seen = new Map<string, PlanItem>();
  for (const item of items) {
    const existing = seen.get(item.newKey);
    if (!existing) {
      seen.set(item.newKey, item);
      continue;
    }
    if (existing.oldKey !== item.oldKey) {
      throw new Error(`Refusing migration because two records target the same storage key: ${item.newKey}`);
    }
  }
}

async function buildPhotoPlan(maps: StorageNameMaps): Promise<PhotoPlan[]> {
  const rows = await db
    .select()
    .from(photoRegistry)
    .where(isNotNull(photoRegistry.storageKey))
    .orderBy(asc(photoRegistry.createdAt));
  const plan: PhotoPlan[] = [];

  for (const photo of rows) {
    const oldKey = photo.storageKey;
    if (!oldKey) continue;
    let parentName: string;
    let entityName: string;
    if (photo.app === 'solarsense') {
      const site = maps.solarSites.get(photo.parentId);
      const assessment = maps.solarAssessments.get(photo.entityId);
      parentName = solarParentName(site, photo.parentId);
      entityName = solarEntityName({
        entityType: photo.entityType,
        entityId: photo.entityId,
        site,
        assessment,
      });
    } else if (photo.app === 'ecoaudit') {
      const audit = maps.ecoAudits.get(photo.parentId);
      parentName = audit?.siteName || photo.parentId;
      entityName = ecoEntityName({
        entityType: photo.entityType,
        entityId: photo.entityId,
        audit,
        maps: maps.ecoEntities,
      });
    } else {
      continue;
    }

    const newKey = makeExistingPhotoStorageKeyFromNames({
      app: photo.app as AppName,
      parentName,
      entityType: photo.entityType,
      entityName,
      fieldName: photo.fieldName,
      currentStorageKey: oldKey,
    });
    if (newKey === oldKey) continue;
    plan.push({
      kind: 'photo',
      id: photo.id,
      app: photo.app as AppName,
      oldKey,
      newKey,
      contentType: photo.contentType,
      status: photo.status,
      remoteUrl: photo.remoteUrl,
      onedriveItemId: photo.onedriveItemId,
    });
  }

  return plan;
}

async function buildPdfPlan(maps: StorageNameMaps): Promise<PdfPlan[]> {
  const [sites, audits] = await Promise.all([
    db
      .select({ id: ssSites.id, siteName: ssSites.siteName, storageKey: ssSites.reportPdfLocalPath })
      .from(ssSites)
      .where(isNotNull(ssSites.reportPdfLocalPath)),
    db
      .select({ id: eaAudits.id, siteName: eaAudits.siteName, storageKey: eaAudits.reportPdfLocalPath })
      .from(eaAudits)
      .where(isNotNull(eaAudits.reportPdfLocalPath)),
  ]);

  const plan: PdfPlan[] = [];
  for (const site of sites) {
    if (!site.storageKey) continue;
    const siteName = maps.solarSites.get(site.id)?.siteName || site.siteName || site.id;
    const newKey = makeExistingPdfStorageKeyFromName({
      app: 'solarsense',
      parentName: siteName,
      currentStorageKey: site.storageKey,
    });
    if (newKey !== site.storageKey) {
      plan.push({ kind: 'pdf', app: 'solarsense', parentId: site.id, oldKey: site.storageKey, newKey });
    }
  }
  for (const audit of audits) {
    if (!audit.storageKey) continue;
    const auditName = maps.ecoAudits.get(audit.id)?.siteName || audit.siteName || audit.id;
    const newKey = makeExistingPdfStorageKeyFromName({
      app: 'ecoaudit',
      parentName: auditName,
      currentStorageKey: audit.storageKey,
    });
    if (newKey !== audit.storageKey) {
      plan.push({ kind: 'pdf', app: 'ecoaudit', parentId: audit.id, oldKey: audit.storageKey, newKey });
    }
  }
  return plan;
}

function oldOneDriveDrivePath(item: PlanItem, target: OneDriveTarget): string {
  if (item.kind === 'photo') {
    return oneDrivePathForStorageKey(target.photosFolder, item.oldKey);
  }
  return oneDrivePathForStorageKey(
    target.photosFolder,
    `${item.app}/${item.parentId}/pdfs/${item.oldKey.split('/').pop() ?? 'report.pdf'}`,
  );
}

async function readMigrationBody(item: PlanItem, target: OneDriveTarget | null): Promise<Buffer | null> {
  if (await localFileExists(item.oldKey)) return localFileBuffer(item.oldKey);
  if (await localFileExists(item.newKey)) return localFileBuffer(item.newKey);
  if (target && (item.kind === 'pdf' || item.status === 'confirmed')) {
    const drivePath = oldOneDriveDrivePath(item, target);
    console.warn(`local source missing; downloading old OneDrive copy: ${drivePath}`);
    return downloadBufferFromOneDrivePath({ target, drivePath });
  }
  if (item.kind === 'photo' && item.status !== 'confirmed') {
    console.warn(`local source missing for non-confirmed photo; updating DB path only: ${item.oldKey}`);
    return null;
  }
  throw new Error(`Neither old nor new storage object exists for ${item.oldKey}`);
}

async function ensureNewStorageObject(item: PlanItem, body: Buffer): Promise<void> {
  if (await localFileExists(item.newKey)) return;
  await writeLocalFile(item.newKey, body);
}

async function uploadToOneDrive(item: PlanItem, body: Buffer, target: OneDriveTarget | null): Promise<string | null> {
  if (!target) return null;
  if (item.kind === 'photo' && item.status === 'confirmed') {
    const upload = await uploadPhotoBackupToOneDrive({
      target,
      storageKey: item.newKey,
      body,
      contentType: item.contentType || contentTypeForStorageKey(item.newKey),
    });
    return upload.itemId;
  }
  if (item.kind === 'pdf') {
    const upload = await uploadBufferToOneDrivePath({
      target,
      drivePath: oneDrivePathForStorageKey(target.photosFolder, item.newKey),
      body,
      contentType: 'application/pdf',
    });
    return upload.itemId;
  }
  return null;
}

async function updateDatabase(item: PlanItem, oneDriveItemId: string | null): Promise<void> {
  if (item.kind === 'photo') {
    await db
      .update(photoRegistry)
      .set({
        storageKey: item.newKey,
        remoteUrl: item.remoteUrl || item.status === 'confirmed' ? publicFileUrl(item.newKey) : item.remoteUrl,
        onedriveItemId: oneDriveItemId ?? item.onedriveItemId,
      })
      .where(eq(photoRegistry.id, item.id));
    return;
  }

  if (item.app === 'solarsense') {
    await db
      .update(ssSites)
      .set({ reportPdfLocalPath: item.newKey, reportPdfRemoteUrl: publicFileUrl(item.newKey), updatedAt: new Date() })
      .where(eq(ssSites.id, item.parentId));
  } else {
    await db
      .update(eaAudits)
      .set({ reportPdfLocalPath: item.newKey, reportPdfRemoteUrl: publicFileUrl(item.newKey), updatedAt: new Date() })
      .where(eq(eaAudits.id, item.parentId));
  }

  await db
    .update(pdfJobs)
    .set({ storageKey: item.newKey, pdfUrl: publicFileUrl(item.newKey), updatedAt: new Date() })
    .where(eq(pdfJobs.storageKey, item.oldKey));
}

async function migrateItems(items: PlanItem[], options: Options, target: OneDriveTarget | null): Promise<Summary> {
  const summary: Summary = { planned: items.length, changed: 0, skipped: 0, failed: 0, bytesCopied: 0 };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const current = index + 1;
    if (options.dryRun) {
      if (current <= 25 || current === items.length) {
        console.log(`[dry-run] ${item.kind} ${current}/${items.length}: ${item.oldKey} -> ${item.newKey}`);
      }
      summary.skipped += 1;
      continue;
    }

    try {
      const body = await readMigrationBody(item, target);
      if (body) await ensureNewStorageObject(item, body);
      const oneDriveItemId = body ? await uploadToOneDrive(item, body, target) : null;
      await updateDatabase(item, oneDriveItemId);
      if (body && !options.keepOldStorage && item.oldKey !== item.newKey) {
        await deleteLocalFile(item.oldKey);
      }
      summary.changed += 1;
      summary.bytesCopied += body?.length ?? 0;
      if (current <= 5 || current % 25 === 0 || current === items.length) {
        console.log(`${item.kind} ${current}/${items.length}: migrated ${item.oldKey} -> ${item.newKey}`);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`${item.kind} ${current}/${items.length}: failed ${item.oldKey}: ${errorMessage(error)}`);
      if (options.failFast) throw error;
    }
  }
  return summary;
}

async function deleteOldOneDriveFolders(items: PlanItem[], target: OneDriveTarget | null, options: Options): Promise<void> {
  if (!target || options.keepOldOneDrive || options.skipOneDrive || options.dryRun) return;
  const oldPrefixes = [...new Set(items.map(oldParentPrefix).filter((value): value is string => Boolean(value)))].sort();
  for (let index = 0; index < oldPrefixes.length; index += 1) {
    const oldPrefix = oldPrefixes[index];
    const drivePath = oneDrivePathForStorageKey(target.photosFolder, oldPrefix);
    try {
      await deleteOneDrivePath({ target, drivePath, ignoreNotFound: true });
      if (index < 5 || (index + 1) % 25 === 0 || index + 1 === oldPrefixes.length) {
        console.log(`deleted old OneDrive folder ${index + 1}/${oldPrefixes.length}: ${drivePath}`);
      }
    } catch (error) {
      console.warn(`failed to delete old OneDrive folder ${drivePath}: ${errorMessage(error)}`);
    }
  }
}

function printSummary(label: string, summary: Summary): void {
  console.log(`${label}: planned=${summary.planned} changed=${summary.changed} skipped=${summary.skipped} failed=${summary.failed} bytes=${formatBytes(summary.bytesCopied)}`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const target = options.skipOneDrive ? null : requireOneDriveTarget(config.oneDrive);
  const maps = await loadStorageNameMaps();
  const photoPlan = options.pdfsOnly ? [] : await buildPhotoPlan(maps);
  const pdfPlan = options.photosOnly ? [] : await buildPdfPlan(maps);
  const plan = applyLimit([...photoPlan, ...pdfPlan], options.limit);
  assertNoTargetCollisions(plan);

  console.log(`Storage name migration: dryRun=${options.dryRun} photos=${!options.pdfsOnly} pdfs=${!options.photosOnly} limit=${options.limit ?? 'none'} skipOneDrive=${options.skipOneDrive}`);
  console.log(`Planned changes: photos=${photoPlan.length} pdfs=${pdfPlan.length} selected=${plan.length}`);

  const summary = await migrateItems(plan, options, target);
  printSummary('Storage rename', summary);

  if (summary.failed === 0) {
    await deleteOldOneDriveFolders(plan, target, options);
  } else {
    console.warn('Skipping old OneDrive folder cleanup because migration had failures.');
  }

  if (summary.failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closeDb();
}
