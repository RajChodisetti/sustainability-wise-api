import { sha256 } from 'js-sha256';
import { resolveApiRequestUrl } from '@/lib/config';
import type {
  CloudStoredFile,
  InstallationAccess,
  InstallationFilesResponse,
  InstallationTree,
  InstallationVersionRecord,
  InstallationVersionSummary,
  InstallHubExportJob,
  InstallHubPullResponse,
  ManagedInstallHubUser,
} from '@/modules/installhub/types/domain';
import {
  getStoredJwt,
  installHubRequest,
  installHubRequestBlob,
  uploadInstallHubBytes,
} from '@/modules/installhub/api/client';

export type PhotoIdentity = {
  installationId: string;
  entityType: 'zone' | 'electrical_asset' | 'site_asset' | 'form_submission';
  entityId: string;
  fieldName: string;
};

export async function listInstallationTrees(): Promise<InstallationTree[]> {
  const result = await installHubRequest<InstallHubPullResponse>(
    'GET',
    '/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z',
  );
  return result.installations;
}

export async function getInstallationTree(
  installationId: string,
): Promise<InstallationTree> {
  const query = new URLSearchParams({
    since: '1970-01-01T00:00:00.000Z',
    installationId,
  });
  const result = await installHubRequest<InstallHubPullResponse>(
    'GET',
    `/v1/installhub/sync/pull?${query}`,
  );
  const tree = result.installations[0];
  if (!tree) throw new Error('Installation not found.');
  return tree;
}

export function saveInstallationTree(
  tree: InstallationTree,
  syncStage: 'metadata' | 'complete' = 'complete',
): Promise<{
  installationId: string;
  versionNumber: number | null;
}> {
  return installHubRequest(
    'POST',
    '/v1/installhub/sync/push',
    { syncStage, ...tree },
  );
}

export async function uploadInstallationPhoto(
  tree: InstallationTree,
  identity: PhotoIdentity,
  file: File,
): Promise<string> {
  await saveInstallationTree(tree, 'metadata');
  const bytes = await file.arrayBuffer();
  const checksum = sha256(bytes);
  const duplicate = await installHubRequest<{ exists: boolean; remoteUrl?: string }>(
    'POST',
    '/v1/installhub/sync/check-photo',
    { ...identity, checksum },
  );
  if (duplicate.exists && duplicate.remoteUrl) return duplicate.remoteUrl;

  const session = await installHubRequest<{
    sessionId: string;
    uploadUrl: string | null;
    alreadyExists: boolean;
    remoteUrl?: string;
  }>('POST', '/v1/installhub/sync/create-upload-session', {
    ...identity,
    checksum,
    filename: file.name || `${identity.fieldName}.jpg`,
    fileSizeBytes: file.size,
  });
  if (session.alreadyExists && session.remoteUrl) return session.remoteUrl;
  if (!session.uploadUrl) throw new Error('The API did not return an upload URL.');

  await uploadInstallHubBytes(
    session.uploadUrl,
    bytes,
    file.type || 'image/jpeg',
  );
  const confirmed = await installHubRequest<{ remoteUrl: string }>(
    'POST',
    '/v1/installhub/sync/confirm-upload',
    { sessionId: session.sessionId, checksum },
  );
  return confirmed.remoteUrl;
}

export function deleteCloudInstallation(
  installationId: string,
  purge = false,
): Promise<void> {
  return installHubRequest(
    'DELETE',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}${
      purge ? '?purge=true' : ''
    }`,
  );
}

export function startFormPdfJob(
  installationId: string,
  formId: string,
): Promise<{ jobId: string; reused?: boolean }> {
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/forms/${encodeURIComponent(formId)}/report/pdf/jobs`,
    {},
  );
}

export function startInstallationPdfJob(
  installationId: string,
  formSubmissionIds?: string[],
): Promise<{ jobId: string; reused?: boolean }> {
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/report/pdf/jobs`,
    {
      formSubmissionIds:
        formSubmissionIds?.length ? [...new Set(formSubmissionIds)] : undefined,
    },
  );
}

export function getExportJobStatus(jobId: string): Promise<InstallHubExportJob> {
  return installHubRequest(
    'GET',
    `/v1/export/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function getLatestExportJob(
  entityId: string,
): Promise<InstallHubExportJob | null> {
  const query = new URLSearchParams({ entityId, artifactType: 'pdf' });
  const result = await installHubRequest<{ job: InstallHubExportJob | null }>(
    'GET',
    `/v1/export/jobs/latest?${query}`,
  );
  return result.job;
}

export function downloadExportJob(jobId: string): Promise<Blob> {
  return installHubRequestBlob(
    'GET',
    `/v1/export/jobs/${encodeURIComponent(jobId)}/download`,
  );
}

export function listUsers(): Promise<{ data: ManagedInstallHubUser[] }> {
  return installHubRequest('GET', '/v1/installhub/users');
}

export function createUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: ManagedInstallHubUser['role'];
}): Promise<ManagedInstallHubUser> {
  return installHubRequest('POST', '/v1/installhub/users', input);
}

export function getUser(id: string): Promise<ManagedInstallHubUser> {
  return installHubRequest('GET', `/v1/installhub/users/${encodeURIComponent(id)}`);
}

export function updateUser(
  id: string,
  patch: Partial<
    Pick<ManagedInstallHubUser, 'email' | 'fullName' | 'role' | 'isActive'>
  >,
): Promise<ManagedInstallHubUser> {
  return installHubRequest(
    'PATCH',
    `/v1/installhub/users/${encodeURIComponent(id)}`,
    patch,
  );
}

export function changeUserPassword(
  id: string,
  input: { currentPassword?: string; newPassword: string },
): Promise<ManagedInstallHubUser> {
  return installHubRequest(
    'PATCH',
    `/v1/installhub/users/${encodeURIComponent(id)}/password`,
    input,
  );
}

export function deactivateUser(id: string): Promise<void> {
  return installHubRequest(
    'DELETE',
    `/v1/installhub/users/${encodeURIComponent(id)}`,
  );
}

export function getInstallationAccess(
  installationId: string,
): Promise<InstallationAccess> {
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/access`,
  );
}

export function setInstallationAccess(
  installationId: string,
  assignedInspectorUserId: string | null,
): Promise<InstallationAccess> {
  return installHubRequest(
    'PATCH',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/access`,
    { assignedInspectorUserId },
  );
}

export function listInstallationFiles(
  installationId: string,
): Promise<InstallationFilesResponse> {
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/files`,
  );
}

export function listInstallationVersions(
  installationId: string,
): Promise<{
  app: 'installhub';
  entityType: 'installation';
  entityId: string;
  versions: InstallationVersionSummary[];
}> {
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/versions`,
  );
}

export function getInstallationVersion(
  installationId: string,
  versionNumber: number,
): Promise<InstallationVersionRecord> {
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/versions/${versionNumber}`,
  );
}

export async function downloadStoredFile(file: CloudStoredFile): Promise<Blob> {
  const apiPath = pathFromInstallHubFileUri(file.downloadUrl);
  if (apiPath) {
    return installHubRequestBlob('GET', apiPath);
  }
  const target = resolveApiRequestUrl(file.downloadUrl);
  const token = getStoredJwt();
  const response = await fetch(target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(await response.text().catch(() => response.statusText));
  }
  return response.blob();
}

export function pathFromInstallHubFileUri(uri: string): string | null {
  try {
    const parsed = new URL(uri, window.location.origin);
    const marker = parsed.pathname.indexOf('/v1/');
    if (marker < 0) return null;
    return `${parsed.pathname.slice(marker)}${parsed.search}`;
  } catch {
    return uri.startsWith('/v1/') ? uri : null;
  }
}
