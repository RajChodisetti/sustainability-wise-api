import { API_DISPLAY_URL, API_URL, resolveApiRequestUrl } from '@/lib/config';

export class InstallHubAuthError extends Error {
  readonly type = 'auth' as const;
}

export class InstallHubNetworkError extends Error {
  readonly type = 'network' as const;
}

export class InstallHubApiError extends Error {
  readonly type = 'api' as const;
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const JWT_KEY = 'ih_web_jwt';
const REFRESH_KEY = 'ih_web_refresh';
const APP = 'installhub';
let refreshInFlight: Promise<string | null> | null = null;

export type InstallHubAuthSessionEvent = 'saved' | 'cleared';
type AuthSessionListener = (event: InstallHubAuthSessionEvent) => void;
const authSessionListeners = new Set<AuthSessionListener>();

function notifyAuthSession(event: InstallHubAuthSessionEvent): void {
  for (const listener of authSessionListeners) listener(event);
}

export function subscribeAuthSession(listener: AuthSessionListener): () => void {
  authSessionListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === JWT_KEY) listener(event.newValue ? 'saved' : 'cleared');
    if (event.key === null) listener('cleared');
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    authSessionListeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

function parseErrorBody(text: string): { message: string; detail?: string } {
  try {
    const json = JSON.parse(text) as { detail?: string; error?: string; message?: string };
    const detail = json.detail ?? json.message ?? json.error;
    return { message: detail ?? text, detail };
  } catch {
    return { message: text };
  }
}

export function installHubConnectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof InstallHubAuthError) {
    return error.message || 'Your InstallHub session expired. Please sign in again.';
  }
  if (error instanceof InstallHubApiError) {
    if (error.status === 401) return error.detail ?? 'Incorrect username or password.';
    if (error.status === 403) return error.detail ?? 'You do not have access to this InstallHub record.';
    if (error.status === 404) return error.detail ?? 'The requested InstallHub record was not found.';
    if (error.status === 409) return error.detail ?? 'The requested change conflicts with current InstallHub data.';
    if (error.status >= 500) return 'InstallHub is temporarily unavailable. Try again later.';
    return error.detail ?? `InstallHub API error (${error.status}): ${message}`;
  }
  if (
    error instanceof InstallHubNetworkError ||
    /failed to fetch|networkerror|load failed/i.test(message)
  ) {
    return `Cannot reach the API at ${API_DISPLAY_URL}. Check the portal connection and try again.`;
  }
  return message || 'An unknown InstallHub error occurred.';
}

export function getStoredJwt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(JWT_KEY);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function saveTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(JWT_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  notifyAuthSession('saved');
}

export function clearTokens(): void {
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem(REFRESH_KEY);
  notifyAuthSession('cleared');
}

function clearTokensIfRefreshToken(expected: string): void {
  if (localStorage.getItem(REFRESH_KEY) === expected) clearTokens();
}

function clearTokensIfAccessToken(expected: string): void {
  if (localStorage.getItem(JWT_KEY) === expected) clearTokens();
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, app: APP }),
    });
  } catch (error) {
    throw new InstallHubNetworkError(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const parsed = parseErrorBody(text);
    if ([400, 401, 403].includes(response.status)) {
      clearTokensIfRefreshToken(refreshToken);
      return null;
    }
    throw new InstallHubApiError(parsed.message, response.status, parsed.detail);
  }

  const data = (await response.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) {
    throw new InstallHubApiError('Invalid token refresh response.', 502);
  }
  if (localStorage.getItem(REFRESH_KEY) !== refreshToken) return getStoredJwt();
  saveTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

export async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  const pending = refreshAccessToken(refreshToken);
  refreshInFlight = pending;
  try {
    return await pending;
  } finally {
    if (refreshInFlight === pending) refreshInFlight = null;
  }
}

function sessionExpiredFor(jwt: string): InstallHubAuthError {
  clearTokensIfAccessToken(jwt);
  return new InstallHubAuthError('InstallHub session expired.');
}

async function getJwt(): Promise<string> {
  const token = getStoredJwt();
  if (!token) throw new InstallHubAuthError('Not signed in to InstallHub.');
  return token;
}

async function refreshAfterUnauthorized(jwt: string): Promise<string | null> {
  const current = getStoredJwt();
  if (current && current !== jwt) return current;
  return tryRefreshToken();
}

async function authenticatedFetch(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<Response> {
  const jwt = await getJwt();
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && !retried) {
      const fresh = await refreshAfterUnauthorized(jwt);
      if (fresh) return authenticatedFetch(method, path, body, true);
      throw sessionExpiredFor(jwt);
    }
    if (response.status === 401) throw sessionExpiredFor(jwt);
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new InstallHubApiError(parsed.message, response.status, parsed.detail);
    }
    return response;
  } catch (error) {
    if (
      error instanceof InstallHubAuthError ||
      error instanceof InstallHubApiError ||
      error instanceof InstallHubNetworkError
    ) {
      throw error;
    }
    throw new InstallHubNetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function installHubRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await authenticatedFetch(method, path, body);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text.trim() ? JSON.parse(text) as T : undefined as T;
}

export async function installHubRequestBlob(
  method: string,
  path: string,
  body?: unknown,
): Promise<Blob> {
  const response = await authenticatedFetch(method, path, body);
  return response.blob();
}

export async function installHubPublicRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new InstallHubApiError(parsed.message, response.status, parsed.detail);
    }
    const text = await response.text();
    return text.trim() ? JSON.parse(text) as T : undefined as T;
  } catch (error) {
    if (error instanceof InstallHubApiError) throw error;
    throw new InstallHubNetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function uploadInstallHubBytes(
  uploadUrl: string,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  try {
    const response = await fetch(resolveApiRequestUrl(uploadUrl), {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new InstallHubApiError(parsed.message, response.status, parsed.detail);
    }
  } catch (error) {
    if (error instanceof InstallHubApiError) throw error;
    throw new InstallHubNetworkError(error instanceof Error ? error.message : String(error));
  }
}
