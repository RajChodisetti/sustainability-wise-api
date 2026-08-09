import { sha256 } from 'js-sha256';
import { resolveApiRequestUrl } from '@/lib/config';
import type {
  CloudStoredFile,
  InstallationAccess,
  ElectricalTreeReadModel,
  InstallationFilesResponse,
  InstallationMappingExport,
  InstallationReadiness,
  InstallationTree,
  ElectricalMapLayoutDocument,
  SavedElectricalMapLayout,
  InstallationVersionRecord,
  InstallationVersionSummary,
  InstallHubExportJob,
  InstallHubPullResponse,
  InstallHubReportDetailMode,
  InstallHubReportProvenance,
  ManagedInstallHubUser,
  MeterHistoryResponse,
  MeterHistoryRollbackResult,
  UnifiedPortalUsersResponse,
} from '@/modules/installhub/types/domain';
import {
  applyAuthoritativeTreeRevision,
  normalizeInstallationTree,
  serializeInstallationTree,
} from '@/modules/installhub/lib/workflow';
import {
  getStoredJwt,
  installHubRequest,
  installHubRequestBlob,
  uploadInstallHubBytes,
} from '@/modules/installhub/api/client';

export type PhotoIdentity = {
  installationId: string;
  entityType: 'zone' | 'electrical_asset' | 'site_asset' | 'meter_device' | 'form_submission';
  entityId: string;
  fieldName: string;
};

export const DEFAULT_TREE_SYNC_STAGE = 'metadata' as const;
export const FORM_COMPLETION_SYNC_STAGE = 'complete' as const;

export async function listInstallationTrees(): Promise<InstallationTree[]> {
  const result = await installHubRequest<InstallHubPullResponse>(
    'GET',
    '/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z',
  );
  return result.installations.map(normalizeInstallationTree);
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
  return normalizeInstallationTree(tree);
}

export function saveInstallationTree(
  tree: InstallationTree,
  syncStage: 'metadata' | 'complete' = DEFAULT_TREE_SYNC_STAGE,
): Promise<{
  installationId: string;
  versionNumber: number | null;
  recordVersionNumber?: number | null;
  treeRevision?: number;
  readiness?: InstallationReadiness;
}> {
  const wire = serializeInstallationTree(tree);
  return installHubRequest(
    'POST',
    '/v1/installhub/sync/push',
    { syncStage, ...wire },
  );
}

export function getInstallationReadiness(
  installationId: string,
  options: {
    recordVersionNumber?: number;
    offset?: number;
    limit?: number;
    q?: string;
    severity?: 'ERROR' | 'WARNING';
    entityType?: string;
    category?: 'RECONCILIATION' | 'COMPLETION';
    zoneId?: string;
  } = {},
): Promise<InstallationReadiness> {
  const query = new URLSearchParams();
  if (options.recordVersionNumber !== undefined) {
    query.set('recordVersionNumber', String(options.recordVersionNumber));
  }
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.q?.trim()) query.set('q', options.q.trim());
  if (options.severity) query.set('severity', options.severity);
  if (options.entityType?.trim()) query.set('entityType', options.entityType.trim());
  if (options.category) query.set('category', options.category);
  if (options.zoneId?.trim()) query.set('zoneId', options.zoneId.trim());
  const suffix = query.size ? `?${query}` : '';
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/readiness${suffix}`,
  );
}

export type InstallationLifecycleResult = {
  installationId: string;
  status: 'Draft' | 'Completed';
  treeRevision: number;
  recordVersionNumber?: number;
  completedFromRevision?: number;
  readiness?: InstallationReadiness;
};

export function completeInstallation(
  installationId: string,
  input: { baseTreeRevision: number; idempotencyKey: string },
): Promise<InstallationLifecycleResult> {
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/complete`,
    input,
  );
}

export function reopenInstallation(
  installationId: string,
  input: { baseTreeRevision: number; reason: string; idempotencyKey: string },
): Promise<InstallationLifecycleResult> {
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/reopen`,
    input,
  );
}

export type MeterRemovalResult = {
  tree: InstallationTree;
  readiness: InstallationReadiness;
  meterRemoval: {
    meterId: string;
    removedAssignmentIds: string[];
    affectedSiteAssetIds: string[];
    retainedFormIds: string[];
    retainedRecordVersions: Array<{
      id: string;
      recordVersionNumber: number;
    }>;
  };
};

export async function deleteInstallationMeter(
  installationId: string,
  meterId: string,
  input: { baseTreeRevision: number },
): Promise<MeterRemovalResult> {
  const response = await installHubRequest<InstallationTree & Omit<MeterRemovalResult, 'tree'>>(
    'DELETE',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/meters/${encodeURIComponent(meterId)}`,
    input,
  );
  return {
    tree: normalizeInstallationTree(response),
    readiness: response.readiness,
    meterRemoval: response.meterRemoval,
  };
}

export function getMeterHistory(
  installationId: string,
  meterId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<MeterHistoryResponse> {
  const query = new URLSearchParams();
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.size ? `?${query}` : '';
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/meters/${encodeURIComponent(meterId)}/history${suffix}`,
  );
}

export function rollbackMeterHistory(
  installationId: string,
  meterId: string,
  input: {
    targetRecordVersionNumber: number;
    baseTreeRevision: number;
    reason: string;
    idempotencyKey: string;
  },
): Promise<MeterHistoryRollbackResult> {
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/meters/${encodeURIComponent(meterId)}/history/rollback`,
    input,
  );
}

export function getInstallationMapping(
  installationId: string,
  recordVersionNumber?: number,
): Promise<InstallationMappingExport> {
  const query = new URLSearchParams();
  if (recordVersionNumber !== undefined) {
    query.set('recordVersionNumber', String(recordVersionNumber));
  }
  const suffix = query.size ? `?${query}` : '';
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/mapping${suffix}`,
  );
}

export function getInstallationElectricalTree(
  installationId: string,
  recordVersionNumber?: number,
): Promise<ElectricalTreeReadModel> {
  const query = new URLSearchParams();
  if (recordVersionNumber !== undefined) {
    query.set('recordVersionNumber', String(recordVersionNumber));
  }
  const suffix = query.size ? `?${query}` : '';
  return installHubRequest(
    'GET',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/electrical-tree${suffix}`,
  );
}

export type SaveElectricalMapLayoutResult = {
  installationId: string;
  treeRevision: number;
  mapLayout: SavedElectricalMapLayout;
};

export function saveInstallationElectricalMapLayout(
  installationId: string,
  input: {
    baseTreeRevision: number;
    baseLayoutRevision: number;
    layout: ElectricalMapLayoutDocument;
  },
): Promise<SaveElectricalMapLayoutResult> {
  return installHubRequest(
    'PUT',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/electrical-map-layout`,
    input,
  );
}

export async function uploadInstallationPhoto(
  tree: InstallationTree,
  identity: PhotoIdentity,
  file: File,
): Promise<string> {
  const metadata = await saveInstallationTree(tree, 'metadata');
  const baseTreeRevision = applyAuthoritativeTreeRevision(tree, metadata.treeRevision);
  const bytes = await file.arrayBuffer();
  const checksum = sha256(bytes);
  const duplicate = await installHubRequest<{
    exists: boolean;
    remoteUrl?: string;
    treeRevision?: number;
  }>(
    'POST',
    '/v1/installhub/sync/check-photo',
    { ...identity, baseTreeRevision, checksum },
  );
  if (duplicate.exists && duplicate.remoteUrl) {
    applyAuthoritativeTreeRevision(tree, duplicate.treeRevision);
    return duplicate.remoteUrl;
  }

  const session = await installHubRequest<{
    sessionId: string;
    uploadUrl: string | null;
    alreadyExists: boolean;
    remoteUrl?: string;
    treeRevision?: number;
  }>('POST', '/v1/installhub/sync/create-upload-session', {
    ...identity,
    baseTreeRevision,
    checksum,
    filename: file.name || `${identity.fieldName}.jpg`,
    fileSizeBytes: file.size,
  });
  if (session.alreadyExists && session.remoteUrl) {
    applyAuthoritativeTreeRevision(tree, session.treeRevision);
    return session.remoteUrl;
  }
  if (!session.uploadUrl) throw new Error('The API did not return an upload URL.');

  await uploadInstallHubBytes(
    session.uploadUrl,
    bytes,
    file.type || 'image/jpeg',
  );
  const confirmed = await installHubRequest<{ remoteUrl: string; treeRevision: number }>(
    'POST',
    '/v1/installhub/sync/confirm-upload',
    { sessionId: session.sessionId, checksum },
  );
  applyAuthoritativeTreeRevision(tree, confirmed.treeRevision);
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

export function requireRecordVersionNumber(value: number | null | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1) {
    throw new Error('A pinned record version is required for authoritative report generation.');
  }
  return value!;
}

type InstallationVersionLookup = {
  list: typeof listInstallationVersions;
  get: typeof getInstallationVersion;
};

export async function findRecordVersionContainingForms(
  installationId: string,
  formIds: string[],
  preferredRecordVersionNumber: number,
  lookup: InstallationVersionLookup = {
    list: listInstallationVersions,
    get: getInstallationVersion,
  },
): Promise<number> {
  const preferred = requireRecordVersionNumber(preferredRecordVersionNumber);
  const requiredIds = [...new Set(formIds.filter(Boolean))];
  if (!requiredIds.length) return preferred;
  const listed = await lookup.list(installationId);
  const candidates = [
    preferred,
    ...listed.versions
      .map((version) => version.versionNumber)
      .sort((left, right) => right - left),
  ].filter((version, index, values) => values.indexOf(version) === index);
  for (const versionNumber of candidates) {
    try {
      const version = await lookup.get(installationId, versionNumber);
      authoritativeReportProvenanceFromVersion(version);
      const completedIds = new Set(
        version.snapshot.installationTree.formSubmissions
          .filter((form) => form.status === 'Completed')
          .map((form) => form.id),
      );
      if (requiredIds.every((formId) => completedIds.has(formId))) {
        return versionNumber;
      }
    } catch {
      // Continue through retained versions; one inaccessible version must not hide another match.
    }
  }
  throw new Error('No retained pinned record version contains every selected completed form.');
}

type ReportProvenanceFields = Pick<
  InstallHubExportJob,
  'recordVersionNumber' | 'recordVersionPayloadHash' | 'reportSource'
>;

export function matchesInstallHubReportProvenance(
  actual: ReportProvenanceFields | null | undefined,
  expected: InstallHubReportProvenance | null | undefined,
): boolean {
  return Boolean(
    actual
    && expected
    && actual.recordVersionNumber === expected.recordVersionNumber
    && actual.recordVersionPayloadHash === expected.recordVersionPayloadHash
    && actual.reportSource === expected.reportSource,
  );
}

export const INSTALLHUB_REPORT_RENDERER_VERSION = 6;

export function installHubReportVariantKey(input: {
  detailMode: InstallHubReportDetailMode;
  formIds: string[];
  sourceKey: string;
}): string {
  const formIds = [...new Set(input.formIds.filter(Boolean))].sort();
  const formSelectionDigest = sha256(JSON.stringify(formIds)).slice(0, 24);
  return `installation-pack:v${INSTALLHUB_REPORT_RENDERER_VERSION}:${input.detailMode}:map:${input.sourceKey}:forms-${formSelectionDigest}`;
}

export function matchesInstallHubInstallationReport(
  actual: Pick<InstallHubExportJob,
    | 'recordVersionNumber'
    | 'recordVersionPayloadHash'
    | 'reportSource'
    | 'detailMode'
    | 'reportVariantKey'
  > | null | undefined,
  expected: InstallHubReportProvenance | { reportSource: 'diagnostic-live' } | null | undefined,
  reportVariantKey: string,
  detailMode: InstallHubReportDetailMode,
): boolean {
  if (!actual || !expected) return false;
  const sourceMatches = expected.reportSource === 'canonical-version'
    ? actual.recordVersionNumber === expected.recordVersionNumber
      && actual.recordVersionPayloadHash === expected.recordVersionPayloadHash
      && actual.reportSource === expected.reportSource
    : actual.recordVersionNumber == null
      && actual.reportSource === 'diagnostic-live';
  return sourceMatches
    && actual.detailMode === detailMode
    && actual.reportVariantKey === reportVariantKey;
}

export function authoritativeReportProvenanceFromVersion(
  version: InstallationVersionRecord,
): InstallHubReportProvenance {
  const snapshot = version.snapshot;
  if (
    snapshot.snapshotSchema !== 'InstallationCanonicalSnapshotV2'
    || snapshot.installationTree.installation.recordVersionNumber !== version.versionNumber
    || snapshot.readiness.eligibility.authoritativeReport !== true
    || !version.payloadHash
    || snapshot.payloadHash !== version.payloadHash
  ) {
    throw new Error('The selected pinned version is not eligible for an authoritative report.');
  }
  return {
    recordVersionNumber: version.versionNumber,
    recordVersionPayloadHash: version.payloadHash,
    reportSource: 'canonical-version',
  };
}

export async function getAuthoritativeReportProvenance(
  installationId: string,
  recordVersionNumber: number,
): Promise<InstallHubReportProvenance> {
  return authoritativeReportProvenanceFromVersion(await getInstallationVersion(
    installationId,
    requireRecordVersionNumber(recordVersionNumber),
  ));
}

export type QueuedInstallHubReportJob = {
  jobId: string;
  reused?: boolean;
  recordVersionNumber: number | null;
  recordVersionPayloadHash: string | null;
  reportSource: 'canonical-version' | 'diagnostic-live';
  detailMode?: InstallHubReportDetailMode;
  reportVariantKey?: string | null;
};

export function startFormPdfJob(
  installationId: string,
  formId: string,
  recordVersionNumber: number,
): Promise<QueuedInstallHubReportJob> {
  const query = new URLSearchParams({
    recordVersionNumber: String(requireRecordVersionNumber(recordVersionNumber)),
  });
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/forms/${encodeURIComponent(formId)}/report/pdf/jobs?${query}`,
    {},
  );
}

export function startInstallationPdfJob(
  installationId: string,
  input: ({
    recordVersionNumber: number;
    liveMode?: never;
  } | {
    recordVersionNumber?: never;
    liveMode: true;
  }) & {
    formSubmissionIds?: string[];
    detailMode?: InstallHubReportDetailMode;
  },
): Promise<QueuedInstallHubReportJob> {
  const formSubmissionIds = input.formSubmissionIds?.length
    ? [...new Set(input.formSubmissionIds)].sort()
    : undefined;
  return installHubRequest(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/report/pdf/jobs`,
    {
      ...('liveMode' in input && input.liveMode
        ? { liveMode: true }
        : { recordVersionNumber: requireRecordVersionNumber(input.recordVersionNumber) }),
      formSubmissionIds,
      detailMode: input.detailMode ?? 'by-electrical-hierarchy',
    },
  );
}

export async function getLatestInstallationReportJob(
  entityId: string,
  expected: InstallHubReportProvenance | { reportSource: 'diagnostic-live' },
  reportVariantKey: string,
): Promise<InstallHubExportJob | null> {
  const query = new URLSearchParams({
    entityId,
    artifactType: 'pdf',
    reportVariantKey,
  });
  if (expected.reportSource === 'canonical-version') {
    query.set('recordVersionNumber', String(expected.recordVersionNumber));
    query.set('recordVersionPayloadHash', expected.recordVersionPayloadHash);
    query.set('reportSource', expected.reportSource);
  } else {
    query.set('reportSourceFilter', 'diagnostic-live');
  }
  const result = await installHubRequest<{ job: InstallHubExportJob | null }>(
    'GET',
    `/v1/export/jobs/latest?${query}`,
  );
  return result.job;
}

export function getExportJobStatus(jobId: string): Promise<InstallHubExportJob> {
  return installHubRequest(
    'GET',
    `/v1/export/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function getLatestExportJob(
  entityId: string,
  expected: InstallHubReportProvenance,
): Promise<InstallHubExportJob | null> {
  const query = new URLSearchParams({
    entityId,
    artifactType: 'pdf',
    recordVersionNumber: String(expected.recordVersionNumber),
    recordVersionPayloadHash: expected.recordVersionPayloadHash,
    reportSource: expected.reportSource,
  });
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

export function listUnifiedPortalUsers(): Promise<UnifiedPortalUsersResponse> {
  return installHubRequest('GET', '/v1/portal/users');
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
