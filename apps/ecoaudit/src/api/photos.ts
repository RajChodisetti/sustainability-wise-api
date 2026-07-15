import { request } from '@/api/client';
import { API_URL, API_DISPLAY_URL, resolveApiRequestUrl } from '@/lib/config';
import { getStoredJwt } from '@/api/client';
import type { PhotoRecord } from '@/types/domain';

export type CheckPhotoArgs = {
  checksum: string;
  auditId: string;
  fieldName: string;
  entityId?: string;
  entityType?: string;
};

export type CheckPhotoResult = {
  exists: boolean;
  remoteUrl?: string;
  fileSizeBytes?: number;
  photoId?: string;
};

export type CreateSessionArgs = {
  checksum: string;
  auditId: string;
  fieldName: string;
  filename: string;
  fileSizeBytes: number;
  entityId?: string;
  entityType?: string;
};

export type CreateSessionResult = {
  sessionId: string;
  uploadUrl: string | null;
  alreadyExists: boolean;
  remoteUrl?: string;
};

export function checkPhoto(args: CheckPhotoArgs): Promise<CheckPhotoResult> {
  return request<CheckPhotoResult>('POST', '/v1/ecoaudit/sync/check-photo', args);
}

export function createUploadSession(args: CreateSessionArgs): Promise<CreateSessionResult> {
  return request<CreateSessionResult>('POST', '/v1/ecoaudit/sync/create-upload-session', args);
}

export async function uploadPhotoBytes(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
  const target = resolveApiRequestUrl(uploadUrl);
  const res = await fetch(target, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
}

export function confirmUpload(args: { sessionId: string; checksum: string }): Promise<{ remoteUrl: string }> {
  return request<{ remoteUrl: string }>('POST', '/v1/ecoaudit/sync/confirm-upload', args);
}

export type PhotoMeta = PhotoRecord & {
  storageKey?: string | null;
  status?: string;
  contentType?: string | null;
};

export function listAuditPhotos(auditId: string): Promise<{ data: PhotoMeta[] }> {
  return request<{ data: PhotoMeta[] }>('GET', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/photos`);
}

export function getPhoto(photoId: string): Promise<PhotoMeta> {
  return request<PhotoMeta>('GET', `/v1/ecoaudit/photos/${encodeURIComponent(photoId)}`);
}

/** Extract photo registry id from a remote/local photo URI filename. */
export function extractPhotoIdFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const base = uri.split('?')[0]?.split('/').pop() ?? '';
  const match = base.match(
    /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?$/i,
  );
  return match?.[1] ?? null;
}

export async function exportPhotosZip(auditId: string): Promise<Blob> {
  const jwt = getStoredJwt();
  const res = await fetch(`${API_URL}/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/photos/export`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}

export function deletePhoto(photoId: string): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/photos/${encodeURIComponent(photoId)}`);
}

/** Mobile-local paths cannot be shown in the browser. */
export function isLocalDeviceUri(uri: string): boolean {
  return /^(file:|content:|ph:|assets-library:|\/var\/|\/data\/|file:\/\/)/i.test(uri);
}

/**
 * Resolve a photo field to a browser-loadable URL.
 * Routes API file URLs through /api/media so CORP headers from the API do not break <img>.
 */
export function resolvePhotoUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (isLocalDeviceUri(uri)) return null;

  let absolute: string;
  if (/^https?:\/\//i.test(uri)) {
    absolute = uri;
  } else if (uri.startsWith('/v1/')) {
    absolute = `${API_DISPLAY_URL}${uri}`;
  } else if (uri.startsWith('/')) {
    absolute = `${API_DISPLAY_URL}${uri}`;
  } else {
    const encoded = uri.split('/').map(encodeURIComponent).join('/');
    absolute = `${API_DISPLAY_URL}/v1/files/${encoded}`;
  }

  try {
    const parsed = new URL(absolute);
    const apiHost = new URL(API_DISPLAY_URL).host;
    if (parsed.host === apiHost) {
      // Always use same-origin media proxy (works for localhost + strips CORP)
      return `/api/media?url=${encodeURIComponent(absolute)}`;
    }
  } catch {
    // fall through
  }

  return resolveApiRequestUrl(absolute);
}
