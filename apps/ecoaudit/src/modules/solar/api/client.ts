import { API_DISPLAY_URL, API_URL } from '@solar/lib/config';

export class AuthError extends Error {
  readonly type = 'auth' as const;
}

export class NetworkError extends Error {
  readonly type = 'network' as const;
}

export class ApiError extends Error {
  readonly type = 'api' as const;
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const JWT_KEY = 'ss_web_jwt';
const REFRESH_KEY = 'ss_web_refresh';
let refreshInFlight: Promise<string | null> | null = null;
export type AuthSessionEvent = 'saved' | 'cleared';
type AuthSessionListener = (event: AuthSessionEvent) => void;
const authSessionListeners = new Set<AuthSessionListener>();

function notifyAuthSession(event: AuthSessionEvent): void {
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

export function cloudConnectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof AuthError) {
    return error.message || 'Session expired or not authorised. Please sign in again.';
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return error.detail ?? 'Incorrect username or password.';
    }
    if (error.status === 403) return error.detail ?? 'Not authorised for this action.';
    if (error.status === 404) return error.detail ?? 'The requested resource was not found.';
    if (error.status === 409) return error.detail ?? 'This account already exists.';
    if (error.status === 410) return error.detail ?? 'Registration is closed. Contact your administrator.';
    if (error.status >= 500) return 'The API server is unavailable. Try again later.';
    return error.detail ?? `API error (${error.status}): ${message}`;
  }
  if (
    error instanceof NetworkError ||
    /failed to fetch|networkerror|load failed/i.test(message)
  ) {
    return `Cannot reach the API at ${API_DISPLAY_URL}. If you are running locally, restart the dev server so the Next.js same-origin portal proxy is active.`;
  }
  return message || 'An unknown error occurred.';
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
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, app: 'solarsense' }),
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const parsed = parseErrorBody(text);
    if ([400, 401, 403].includes(res.status)) {
      clearTokensIfRefreshToken(refreshToken);
      return null;
    }
    throw new ApiError(parsed.message, res.status, parsed.detail);
  }

  const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) {
    throw new ApiError('Invalid token refresh response.', 502);
  }
  if (localStorage.getItem(REFRESH_KEY) !== refreshToken) {
    return getStoredJwt();
  }
  saveTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

export async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  const pending = refreshAccessToken(refreshToken);
  refreshInFlight = pending;
  try {
    return await pending;
  } finally {
    if (refreshInFlight === pending) refreshInFlight = null;
  }
}

function sessionExpiredFor(jwt: string): AuthError {
  clearTokensIfAccessToken(jwt);
  return new AuthError('Session expired.');
}

async function refreshAfterUnauthorized(jwt: string): Promise<string | null> {
  const current = getStoredJwt();
  if (current && current !== jwt) return current;
  return tryRefreshToken();
}

async function getJwt(): Promise<string> {
  const token = getStoredJwt();
  if (!token) throw new AuthError('Not signed in.');
  return token;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const jwt = await getJwt();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      const fresh = await refreshAfterUnauthorized(jwt);
      if (fresh) return request<T>(method, path, body, true);
      throw sessionExpiredFor(jwt);
    }
    if (res.status === 401) throw sessionExpiredFor(jwt);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const parsed = parseErrorBody(text);
      throw new ApiError(parsed.message, res.status, parsed.detail);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof AuthError || e instanceof ApiError || e instanceof NetworkError) throw e;
    throw new NetworkError(String(e));
  }
}

export async function requestBinary(method: string, path: string, body?: unknown, retried = false): Promise<ArrayBuffer> {
  const jwt = await getJwt();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      const fresh = await refreshAfterUnauthorized(jwt);
      if (fresh) return requestBinary(method, path, body, true);
      throw sessionExpiredFor(jwt);
    }
    if (res.status === 401) throw sessionExpiredFor(jwt);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const parsed = parseErrorBody(text);
      throw new ApiError(parsed.message, res.status, parsed.detail);
    }
    return res.arrayBuffer();
  } catch (e) {
    if (e instanceof AuthError || e instanceof ApiError || e instanceof NetworkError) throw e;
    throw new NetworkError(String(e));
  }
}

export async function requestDownload(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<{ blob: Blob; contentDisposition: string | null }> {
  const jwt = await getJwt();
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      const fresh = await refreshAfterUnauthorized(jwt);
      if (fresh) return requestDownload(method, path, body, true);
      throw sessionExpiredFor(jwt);
    }
    if (res.status === 401) throw sessionExpiredFor(jwt);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const parsed = parseErrorBody(text);
      throw new ApiError(parsed.message, res.status, parsed.detail);
    }
    return {
      blob: await res.blob(),
      contentDisposition: res.headers.get('Content-Disposition'),
    };
  } catch (e) {
    if (e instanceof AuthError || e instanceof ApiError || e instanceof NetworkError) throw e;
    throw new NetworkError(String(e));
  }
}

export async function publicRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const parsed = parseErrorBody(text);
      throw new ApiError(parsed.message, res.status, parsed.detail);
    }
    const text = await res.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new NetworkError(String(e));
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
