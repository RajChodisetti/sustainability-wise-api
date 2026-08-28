import { config } from '../config.js';
import { localFileBuffer } from '../storage/localFiles.js';
import {
  missingOneDriveConfig,
  uploadBufferToAvailableOneDrivePath,
  uploadBufferToOneDrivePath,
  uploadPhotoBackupToOneDrive,
  type OneDriveUploadResult,
} from './uploadSession.js';
import {
  invoicePdfOneDrivePath,
  joinOneDrivePath,
  joinOneDrivePathSegments,
  oneDrivePathForStorageKey,
} from './paths.js';

type Logger = {
  warn: (bindings: Record<string, unknown>, message?: string) => void;
};

function loggableError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: String(error) };
}

export async function mirrorStoredPhotoToOneDrive(args: {
  storageKey: string;
  contentType?: string | null;
  logger?: Logger;
}): Promise<OneDriveUploadResult | null> {
  return withOneDriveBackup('photo', args.storageKey, args.logger, async () => {
    const body = await localFileBuffer(args.storageKey);
    return uploadPhotoBackupToOneDrive({
      target: config.oneDrive,
      storageKey: args.storageKey,
      body,
      contentType: args.contentType,
    });
  });
}

export async function mirrorPdfToOneDrive(args: {
  app?: 'solarsense' | 'ecoaudit';
  parentId?: string;
  parentName?: string;
  filename: string;
  body: Buffer;
  storageKey?: string;
  logger?: Logger;
}): Promise<OneDriveUploadResult | null> {
  const drivePath = args.parentName
    ? joinOneDrivePathSegments(
      config.oneDrive.photosFolder,
      args.app,
      args.parentName,
      'pdfs',
      args.filename,
    )
    : args.storageKey
    ? oneDrivePathForStorageKey(config.oneDrive.photosFolder, args.storageKey)
    : joinOneDrivePath(
      config.oneDrive.photosFolder,
      args.app,
      args.parentId,
      'pdfs',
      args.filename,
    );

  return withOneDriveBackup('PDF', drivePath, args.logger, async () => {
    return args.parentName ? uploadBufferToAvailableOneDrivePath({
      target: config.oneDrive,
      drivePath,
      body: args.body,
      contentType: 'application/pdf',
    }) : uploadBufferToOneDrivePath({
      target: config.oneDrive,
      drivePath,
      body: args.body,
      contentType: 'application/pdf',
    });
  });
}

/**
 * Invoice folders are created lazily by the upload itself, so clients with no
 * generated invoice never receive an empty OneDrive directory.
 */
export async function mirrorInvoicePdfToOneDrive(args: {
  clientName: string;
  filename: string;
  body: Buffer;
  logger?: Logger;
}): Promise<OneDriveUploadResult | null> {
  const drivePath = invoicePdfOneDrivePath(
    config.oneDrive.invoicesFolder,
    args.clientName,
    args.filename,
  );
  return withOneDriveBackup('invoice PDF', drivePath, args.logger, async () => (
    uploadBufferToOneDrivePath({
      target: config.oneDrive,
      drivePath,
      body: args.body,
      contentType: 'application/pdf',
    })
  ));
}

async function withOneDriveBackup(
  label: string,
  targetPath: string,
  logger: Logger | undefined,
  upload: () => Promise<OneDriveUploadResult>,
): Promise<OneDriveUploadResult | null> {
  if (!config.oneDrive.enabled) return null;
  const missing = missingOneDriveConfig(config.oneDrive);
  if (missing.length) {
    if (config.oneDrive.backupRequired) {
      throw new Error(`OneDrive backup is enabled but missing required environment variables: ${missing.join(', ')}`);
    }
    return null;
  }

  try {
    return await upload();
  } catch (error) {
    if (config.oneDrive.backupRequired) throw error;
    const details = { err: loggableError(error), targetPath };
    const message = `OneDrive ${label} backup failed`;
    if (logger) logger.warn(details, message);
    else console.warn(message, details);
    return null;
  }
}
