import path from 'node:path';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { config } from '../src/config.js';
import { closeDb, db } from '../src/db/client.js';
import { eaAudits } from '../src/db/schema/ecoaudit.js';
import { photoRegistry } from '../src/db/schema/shared.js';
import { ssSites } from '../src/db/schema/solarsense.js';
import { joinOneDrivePath, oneDrivePathForStorageKey } from '../src/onedrive/paths.js';
import {
  requireOneDriveTarget,
  uploadBufferToOneDrivePath,
  uploadPhotoBackupToOneDrive,
  type OneDriveTarget,
} from '../src/onedrive/uploadSession.js';
import { contentTypeForStorageKey, localFileBuffer } from '../src/storage/localFiles.js';

type Options = {
  dryRun: boolean;
  photosOnly: boolean;
  pdfsOnly: boolean;
  force: boolean;
  failFast: boolean;
  limit: number | null;
};

type Summary = {
  scanned: number;
  uploaded: number;
  skipped: number;
  failed: number;
  bytesUploaded: number;
};

type PdfJob = {
  app: 'solarsense' | 'ecoaudit';
  parentId: string;
  storageKey: string;
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
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('--limit must be a positive integer');
  }
  return parsed;
}

function parseOptions(): Options {
  const options = {
    dryRun: hasFlag('--dry-run'),
    photosOnly: hasFlag('--photos-only'),
    pdfsOnly: hasFlag('--pdfs-only'),
    force: hasFlag('--force'),
    failFast: hasFlag('--fail-fast'),
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

function emptySummary(): Summary {
  return { scanned: 0, uploaded: 0, skipped: 0, failed: 0, bytesUploaded: 0 };
}

function shouldLogProgress(index: number, total: number): boolean {
  return index <= 5 || index % 25 === 0 || index === total;
}

async function backfillPhotos(target: OneDriveTarget, options: Options): Promise<Summary> {
  const summary = emptySummary();
  const where = options.force
    ? and(eq(photoRegistry.status, 'confirmed'), isNotNull(photoRegistry.storageKey))
    : and(
      eq(photoRegistry.status, 'confirmed'),
      isNotNull(photoRegistry.storageKey),
      isNull(photoRegistry.onedriveItemId),
    );

  const rows = await db
    .select()
    .from(photoRegistry)
    .where(where)
    .orderBy(asc(photoRegistry.createdAt));
  const selectedRows = options.limit ? rows.slice(0, options.limit) : rows;
  summary.scanned = selectedRows.length;

  console.log(`Photos selected: ${summary.scanned} of ${rows.length}${options.force ? ' (--force includes already mirrored rows)' : ' missing OneDrive item ids'}`);

  if (options.dryRun) {
    for (let index = 0; index < Math.min(selectedRows.length, 10); index += 1) {
      const photo = selectedRows[index];
      const storageKey = photo.storageKey ?? '';
      console.log(`[dry-run] photo ${index + 1}/${selectedRows.length}: ${storageKey} -> ${oneDrivePathForStorageKey(target.photosFolder, storageKey)}`);
    }
    if (selectedRows.length > 10) {
      console.log(`[dry-run] photo sample truncated; ${selectedRows.length - 10} more would be uploaded`);
    }
    summary.skipped = selectedRows.length;
    return summary;
  }

  for (let index = 0; index < selectedRows.length; index += 1) {
    const photo = selectedRows[index];
    const current = index + 1;
    const storageKey = photo.storageKey;
    if (!storageKey) {
      summary.skipped += 1;
      continue;
    }

    try {
      const body = await localFileBuffer(storageKey);
      const upload = await uploadPhotoBackupToOneDrive({
        target,
        storageKey,
        body,
        contentType: photo.contentType || contentTypeForStorageKey(storageKey),
      });

      await db
        .update(photoRegistry)
        .set({ onedriveItemId: upload.itemId })
        .where(eq(photoRegistry.id, photo.id));

      summary.uploaded += 1;
      summary.bytesUploaded += body.length;
      if (shouldLogProgress(current, selectedRows.length)) {
        console.log(`photo ${current}/${selectedRows.length}: uploaded ${storageKey}`);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`photo ${current}/${selectedRows.length}: failed ${storageKey}: ${errorMessage(error)}`);
      if (options.failFast) throw error;
    }
  }

  return summary;
}

async function loadPdfJobs(): Promise<PdfJob[]> {
  const [solarsenseSites, ecoauditAudits] = await Promise.all([
    db
      .select({ id: ssSites.id, storageKey: ssSites.reportPdfLocalPath })
      .from(ssSites)
      .where(and(isNotNull(ssSites.reportPdfLocalPath), isNull(ssSites.deletedAt)))
      .orderBy(asc(ssSites.createdAt)),
    db
      .select({ id: eaAudits.id, storageKey: eaAudits.reportPdfLocalPath })
      .from(eaAudits)
      .where(and(isNotNull(eaAudits.reportPdfLocalPath), isNull(eaAudits.deletedAt)))
      .orderBy(asc(eaAudits.createdAt)),
  ]);

  return [
    ...solarsenseSites.map((site): PdfJob => ({
      app: 'solarsense',
      parentId: site.id,
      storageKey: site.storageKey ?? '',
    })),
    ...ecoauditAudits.map((audit): PdfJob => ({
      app: 'ecoaudit',
      parentId: audit.id,
      storageKey: audit.storageKey ?? '',
    })),
  ].filter((job) => job.storageKey);
}

async function backfillPdfs(target: OneDriveTarget, options: Options): Promise<Summary> {
  const summary = emptySummary();
  const jobs = await loadPdfJobs();
  const selectedJobs = options.limit ? jobs.slice(0, options.limit) : jobs;
  summary.scanned = selectedJobs.length;

  console.log(`PDFs selected: ${summary.scanned} of ${jobs.length}`);

  if (options.dryRun) {
    for (let index = 0; index < Math.min(selectedJobs.length, 10); index += 1) {
      const job = selectedJobs[index];
      const drivePath = pdfDrivePath(target, job);
      console.log(`[dry-run] PDF ${index + 1}/${selectedJobs.length}: ${job.storageKey} -> ${drivePath}`);
    }
    if (selectedJobs.length > 10) {
      console.log(`[dry-run] PDF sample truncated; ${selectedJobs.length - 10} more would be uploaded`);
    }
    summary.skipped = selectedJobs.length;
    return summary;
  }

  for (let index = 0; index < selectedJobs.length; index += 1) {
    const job = selectedJobs[index];
    const current = index + 1;
    const drivePath = pdfDrivePath(target, job);

    try {
      const body = await localFileBuffer(job.storageKey);
      await uploadBufferToOneDrivePath({
        target,
        drivePath,
        body,
        contentType: 'application/pdf',
      });

      summary.uploaded += 1;
      summary.bytesUploaded += body.length;
      if (shouldLogProgress(current, selectedJobs.length)) {
        console.log(`PDF ${current}/${selectedJobs.length}: uploaded ${drivePath}`);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`PDF ${current}/${selectedJobs.length}: failed ${job.storageKey}: ${errorMessage(error)}`);
      if (options.failFast) throw error;
    }
  }

  return summary;
}

function pdfDrivePath(target: OneDriveTarget, job: PdfJob): string {
  return joinOneDrivePath(
    target.photosFolder,
    job.app,
    job.parentId,
    'pdfs',
    path.posix.basename(job.storageKey),
  );
}

function printSummary(label: string, summary: Summary): void {
  console.log(`${label}: scanned=${summary.scanned} uploaded=${summary.uploaded} skipped=${summary.skipped} failed=${summary.failed} bytes=${formatBytes(summary.bytesUploaded)}`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const target = requireOneDriveTarget(config.oneDrive);
  const runPhotos = !options.pdfsOnly;
  const runPdfs = !options.photosOnly;

  console.log(`OneDrive backfill target: user=${target.userEmail} folder=${target.photosFolder}`);
  console.log(`Options: dryRun=${options.dryRun} photos=${runPhotos} pdfs=${runPdfs} force=${options.force} limit=${options.limit ?? 'none'}`);
  if (!config.oneDrive.enabled) {
    console.warn('ONEDRIVE_PHOTO_BACKUP_ENABLED is false; backfill will still run because credentials are configured.');
  }

  const photoSummary = runPhotos ? await backfillPhotos(target, options) : emptySummary();
  const pdfSummary = runPdfs ? await backfillPdfs(target, options) : emptySummary();

  printSummary('Photos', photoSummary);
  printSummary('PDFs', pdfSummary);

  if (photoSummary.failed || pdfSummary.failed) {
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await closeDb();
}
