import type {
  ApiErrorBody,
  AppId,
  AuthUser,
  FileTarget,
  LoginResponse,
  PaginatedResponse,
  PdfJob,
  PdfTarget,
  PhotoListResponse,
  StoredFileListingResponse,
  TokenSet,
  UploadSessionResponse,
  ZipTarget,
} from './types';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${configuredBaseUrl}${normalizedPath}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = await parseJson<ApiErrorBody>(response);
    } catch {
      body = null;
    }
    throw new ApiError(body?.error ?? response.statusText, response.status, body?.detail);
  }

  return parseJson<T>(response);
}

async function requestBlob(path: string, accessToken: string, init: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  });

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = await parseJson<ApiErrorBody>(response);
    } catch {
      body = null;
    }
    throw new ApiError(body?.error ?? response.statusText, response.status, body?.detail);
  }

  return response.blob();
}

export function login(app: AppId, email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ app, email, password }),
  });
}

export function refresh(refreshToken: string): Promise<TokenSet> {
  return request<TokenSet>('/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(refreshToken: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function me(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('/v1/auth/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function health(): Promise<{ status: string; uptime: number }> {
  return request<{ status: string; uptime: number }>('/health');
}

export async function authenticatedRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  return request<T>(path, {
    ...init,
    headers,
  });
}

export function listResource<T>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<PaginatedResponse<T>> {
  const url = new URL(apiUrl(path), window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const requestPath = configuredBaseUrl ? `${url.pathname}${url.search}` : `${url.pathname}${url.search}`;
  return authenticatedRequest<PaginatedResponse<T>>(requestPath, accessToken);
}

export function createResource<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  return authenticatedRequest<T>(path, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateResource<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  return authenticatedRequest<T>(path, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteResource(path: string, accessToken: string): Promise<void> {
  return authenticatedRequest<void>(path, accessToken, { method: 'DELETE' });
}

export function patchAction<T>(path: string, accessToken: string): Promise<T> {
  return authenticatedRequest<T>(path, accessToken, { method: 'PATCH' });
}

export function fileListingPath(target: FileTarget): string {
  if (target.app === 'solarsense' && target.type === 'site') {
    return `/v1/solarsense/sites/${encodePathSegment(target.ref)}/files`;
  }
  if (target.app === 'solarsense' && target.type === 'assessment') {
    return `/v1/solarsense/assessments/${encodePathSegment(target.ref)}/files`;
  }
  return `/v1/ecoaudit/audits/${encodePathSegment(target.ref)}/files`;
}

export function listStoredFiles(target: FileTarget, accessToken: string): Promise<StoredFileListingResponse> {
  return authenticatedRequest<StoredFileListingResponse>(fileListingPath(target), accessToken);
}

export function photoListPath(target: ZipTarget): string {
  if (target.app === 'solarsense') {
    return `/v1/solarsense/sites/${encodePathSegment(target.siteRef)}/photos`;
  }
  return `/v1/ecoaudit/audits/${encodePathSegment(target.auditRef)}/photos`;
}

export function listPhotos(target: ZipTarget, accessToken: string): Promise<PhotoListResponse> {
  return authenticatedRequest<PhotoListResponse>(photoListPath(target), accessToken);
}

export function deletePhoto(app: AppId, photoRef: string, accessToken: string): Promise<void> {
  return deleteResource(`/v1/${app}/photos/${encodePathSegment(photoRef)}`, accessToken);
}

export function zipExportPath(target: ZipTarget): string {
  if (target.app === 'solarsense') {
    return `/v1/solarsense/sites/${encodePathSegment(target.siteRef)}/photos/export`;
  }
  return `/v1/ecoaudit/audits/${encodePathSegment(target.auditRef)}/photos/export`;
}

export function downloadZip(target: ZipTarget, accessToken: string): Promise<Blob> {
  return requestBlob(zipExportPath(target), accessToken);
}

export function startPdfJob(target: PdfTarget, accessToken: string): Promise<{ jobId: string }> {
  if (target.app === 'solarsense') {
    return authenticatedRequest<{ jobId: string }>(
      `/v1/solarsense/sites/${encodePathSegment(target.siteId)}/site-pack/pdf/jobs`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          assessmentIds: target.assessmentIds ?? [],
          options: target.options ?? {},
        }),
      },
    );
  }

  return authenticatedRequest<{ jobId: string }>(
    `/v1/ecoaudit/audits/${encodePathSegment(target.auditId)}/report/pdf/jobs`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        mode: target.mode ?? 'by-equipment',
        zoneIds: target.zoneIds ?? [],
      }),
    },
  );
}

export function getPdfJob(jobId: string, accessToken: string): Promise<PdfJob> {
  return authenticatedRequest<PdfJob>(`/v1/pdf/jobs/${encodePathSegment(jobId)}`, accessToken);
}

export function downloadPdfJob(jobId: string, accessToken: string): Promise<Blob> {
  return requestBlob(`/v1/pdf/jobs/${encodePathSegment(jobId)}/download`, accessToken);
}

export function createUploadSession(
  app: AppId,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<UploadSessionResponse> {
  return authenticatedRequest<UploadSessionResponse>(`/v1/${app}/sync/create-upload-session`, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function uploadRawFile(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }
}

export function confirmUploadSession(
  app: AppId,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ remoteUrl: string }> {
  return authenticatedRequest<{ remoteUrl: string }>(`/v1/${app}/sync/confirm-upload`, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
