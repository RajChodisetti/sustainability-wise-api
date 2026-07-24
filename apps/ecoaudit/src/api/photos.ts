import { request } from '@/api/client';
import { API_URL, resolveApiRequestUrl } from '@/lib/config';
import { getStoredJwt } from '@/api/client';
import type { PhotoRecord } from '@/types/domain';

export { extractPhotoIdFromUri } from '@/lib/photoReferences';

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
  caption?: string | null;
};

export type PhotoZipMode = 'by-zone' | 'by-equipment';

export function listAuditPhotos(auditId: string): Promise<{ data: PhotoMeta[] }> {
  return request<{ data: PhotoMeta[] }>('GET', `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/photos`);
}

export function startPhotosZipJob(
  auditId: string,
  mode: PhotoZipMode = 'by-zone',
): Promise<{ jobId: string; reused?: boolean }> {
  return request<{ jobId: string; reused?: boolean }>(
    'POST',
    `/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/photos/export/jobs`,
    { mode },
  );
}

export function getPhoto(photoId: string): Promise<PhotoMeta> {
  return request<PhotoMeta>('GET', `/v1/ecoaudit/photos/${encodeURIComponent(photoId)}`);
}

export async function exportPhotosZip(auditId: string, mode: PhotoZipMode = 'by-zone'): Promise<Blob> {
  const jwt = getStoredJwt();
  const query = new URLSearchParams({ mode });
  const res = await fetch(`${API_URL}/v1/ecoaudit/audits/${encodeURIComponent(auditId)}/photos/export?${query}`, {
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
