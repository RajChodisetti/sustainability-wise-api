import { request } from '@solar/api/client';
import { API_URL, resolveApiRequestUrl } from '@solar/lib/config';

export type CheckPhotoArgs = {
  checksum: string;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
};

export type CheckPhotoResult = {
  exists: boolean;
  remoteUrl?: string;
  fileSizeBytes?: number;
  photoId?: string;
};

export type CreateSessionArgs = {
  checksum: string;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
  filename: string;
  fileSizeBytes: number;
};

export type CreateSessionResult = {
  sessionId: string;
  uploadUrl: string | null;
  alreadyExists: boolean;
  remoteUrl?: string;
};

export type ConfirmArgs = {
  sessionId: string;
  checksum: string;
};

export type ConfirmResult = {
  remoteUrl: string;
};

export function checkPhoto(args: CheckPhotoArgs): Promise<CheckPhotoResult> {
  return request<CheckPhotoResult>('POST', '/v1/solarsense/sync/check-photo', args);
}

export function createUploadSession(args: CreateSessionArgs): Promise<CreateSessionResult> {
  return request<CreateSessionResult>('POST', '/v1/solarsense/sync/create-upload-session', args);
}

export async function uploadPhotoBytes(uploadUrl: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
  const target = resolveApiRequestUrl(uploadUrl);
  const res = await fetch(target, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
}

export function confirmUpload(args: ConfirmArgs): Promise<ConfirmResult> {
  return request<ConfirmResult>('POST', '/v1/solarsense/sync/confirm-upload', args);
}

export async function exportPhotosZip(siteId: string): Promise<Blob> {
  const jwt = localStorage.getItem('ss_web_jwt');
  const res = await fetch(`${API_URL}/v1/solarsense/sites/${encodeURIComponent(siteId)}/photos/export`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}

export function startPhotosZipJob(siteId: string): Promise<{ jobId: string; reused?: boolean }> {
  return request<{ jobId: string; reused?: boolean }>(
    'POST',
    `/v1/solarsense/sites/${encodeURIComponent(siteId)}/photos/export/jobs`,
  );
}
