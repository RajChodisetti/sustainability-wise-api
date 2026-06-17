import {
  GraphRequestError,
  graphBuffer,
  graphJson,
  type OneDriveCredentials,
} from './graphClient.js';
import {
  encodeOneDrivePath,
  joinOneDrivePath,
  normalizeOneDrivePath,
  oneDrivePathForStorageKey,
  parentOneDriveFolder,
} from './paths.js';

export type OneDriveTarget = OneDriveCredentials & {
  userEmail: string;
  photosFolder: string;
};

export type OneDriveUploadResult = {
  itemId: string;
  drivePath: string;
  webUrl: string | null;
  sizeBytes: number | null;
};

type DriveItem = {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  folder?: unknown;
};

const folderCache = new Set<string>();

export function missingOneDriveConfig(target: Partial<OneDriveTarget>): string[] {
  const missing: string[] = [];
  if (!target.tenantId) missing.push('AZURE_TENANT_ID');
  if (!target.clientId) missing.push('AZURE_CLIENT_ID');
  if (!target.clientSecret) missing.push('AZURE_CLIENT_SECRET');
  if (!target.userEmail) missing.push('ONEDRIVE_USER_EMAIL');
  if (!target.photosFolder) missing.push('ONEDRIVE_PHOTOS_FOLDER');
  return missing;
}

export function isOneDriveConfigured(target: Partial<OneDriveTarget>): target is OneDriveTarget {
  return missingOneDriveConfig(target).length === 0;
}

export function requireOneDriveTarget(target: Partial<OneDriveTarget>): OneDriveTarget {
  const missing = missingOneDriveConfig(target);
  if (missing.length) {
    throw new Error(`OneDrive photo backup is missing required environment variables: ${missing.join(', ')}`);
  }
  return target as OneDriveTarget;
}

function userDrivePrefix(userEmail: string): string {
  return `/users/${encodeURIComponent(userEmail)}/drive`;
}

function itemByPathPath(userEmail: string, drivePath: string): string {
  const encodedPath = encodeOneDrivePath(drivePath);
  return encodedPath
    ? `${userDrivePrefix(userEmail)}/root:/${encodedPath}`
    : `${userDrivePrefix(userEmail)}/root`;
}

function childrenByPathPath(userEmail: string, drivePath: string): string {
  const encodedPath = encodeOneDrivePath(drivePath);
  return encodedPath
    ? `${userDrivePrefix(userEmail)}/root:/${encodedPath}:/children`
    : `${userDrivePrefix(userEmail)}/root/children`;
}

function contentByPathPath(userEmail: string, drivePath: string): string {
  return `${userDrivePrefix(userEmail)}/root:/${encodeOneDrivePath(drivePath)}:/content`;
}

async function getDriveItem(target: OneDriveTarget, drivePath: string): Promise<DriveItem> {
  return graphJson<DriveItem>(target, itemByPathPath(target.userEmail, drivePath));
}

async function createFolder(target: OneDriveTarget, parentPath: string, name: string): Promise<DriveItem> {
  return graphJson<DriveItem>(target, childrenByPathPath(target.userEmail, parentPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });
}

export async function ensureOneDriveFolder(target: OneDriveTarget, folderPath: string): Promise<void> {
  const normalized = normalizeOneDrivePath(folderPath);
  if (!normalized) return;

  let currentPath = '';
  for (const segment of normalized.split('/')) {
    const parentPath = currentPath;
    currentPath = joinOneDrivePath(currentPath, segment);
    const cacheKey = `${target.userEmail}:${currentPath}`;
    if (folderCache.has(cacheKey)) continue;

    try {
      const item = await getDriveItem(target, currentPath);
      if (!item.folder) {
        throw new Error(`OneDrive path exists but is not a folder: ${currentPath}`);
      }
      folderCache.add(cacheKey);
      continue;
    } catch (error) {
      if (!(error instanceof GraphRequestError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const item = await createFolder(target, parentPath, segment);
      if (!item.folder) {
        throw new Error(`Microsoft Graph did not create a folder for: ${currentPath}`);
      }
      folderCache.add(cacheKey);
    } catch (error) {
      if (!(error instanceof GraphRequestError) || error.status !== 409) {
        throw error;
      }
      const item = await getDriveItem(target, currentPath);
      if (!item.folder) {
        throw new Error(`OneDrive path exists but is not a folder: ${currentPath}`);
      }
      folderCache.add(cacheKey);
    }
  }
}

export async function uploadBufferToOneDrivePath(args: {
  target: OneDriveTarget;
  drivePath: string;
  body: Buffer;
  contentType?: string | null;
}): Promise<OneDriveUploadResult> {
  const drivePath = normalizeOneDrivePath(args.drivePath);
  await ensureOneDriveFolder(args.target, parentOneDriveFolder(drivePath));

  const item = await graphJson<DriveItem>(
    args.target,
    contentByPathPath(args.target.userEmail, drivePath),
    {
      method: 'PUT',
      headers: { 'Content-Type': args.contentType ?? 'application/octet-stream' },
      body: args.body as unknown as BodyInit,
    },
  );

  return {
    itemId: item.id,
    drivePath,
    webUrl: item.webUrl ?? null,
    sizeBytes: typeof item.size === 'number' ? item.size : null,
  };
}

export async function downloadBufferFromOneDrivePath(args: {
  target: OneDriveTarget;
  drivePath: string;
}): Promise<Buffer> {
  return graphBuffer(args.target, contentByPathPath(args.target.userEmail, args.drivePath));
}

export async function deleteOneDrivePath(args: {
  target: OneDriveTarget;
  drivePath: string;
  ignoreNotFound?: boolean;
}): Promise<void> {
  const drivePath = normalizeOneDrivePath(args.drivePath);
  try {
    await graphJson<unknown>(
      args.target,
      itemByPathPath(args.target.userEmail, drivePath),
      { method: 'DELETE' },
    );
  } catch (error) {
    if (args.ignoreNotFound && error instanceof GraphRequestError && error.status === 404) return;
    throw error;
  }
}

export async function uploadPhotoBackupToOneDrive(args: {
  target: OneDriveTarget;
  storageKey: string;
  body: Buffer;
  contentType?: string | null;
}): Promise<OneDriveUploadResult> {
  return uploadBufferToOneDrivePath({
    target: args.target,
    drivePath: oneDrivePathForStorageKey(args.target.photosFolder, args.storageKey),
    body: args.body,
    contentType: args.contentType,
  });
}
