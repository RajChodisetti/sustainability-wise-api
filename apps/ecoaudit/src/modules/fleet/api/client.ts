import { API_DISPLAY_URL, API_URL } from '@/lib/config';

export class FleetAuthError extends Error {
  readonly type = 'auth' as const;
}

export class FleetNetworkError extends Error {
  readonly type = 'network' as const;
}

export class FleetApiError extends Error {
  readonly type = 'api' as const;
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const JWT_KEY = 'ww_web_jwt';
const REFRESH_KEY = 'ww_web_refresh';
let refreshInFlight: Promise<string | null> | null = null;

export type FleetAuthSessionEvent = 'saved' | 'cleared';
type FleetAuthSessionListener = (event: FleetAuthSessionEvent) => void;
const authSessionListeners = new Set<FleetAuthSessionListener>();

function notifyAuthSession(event: FleetAuthSessionEvent): void {
  for (const listener of authSessionListeners) listener(event);
}

export function subscribeAuthSession(listener: FleetAuthSessionListener): () => void {
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

export function fleetConnectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof FleetAuthError) {
    return error.message || 'Session expired or not authorised. Please sign in again.';
  }
  if (error instanceof FleetApiError) {
    if (error.status === 401) return error.detail ?? 'Incorrect username or password.';
    if (error.status === 403) return error.detail ?? 'You do not have access to Wattwatchers Fleet.';
    if (error.status === 404) return error.detail ?? 'The requested fleet record was not found.';
    if (error.status >= 500) return 'Fleet monitoring is temporarily unavailable. Try again later.';
    return error.detail ?? `Fleet API error (${error.status}): ${message}`;
  }
  if (error instanceof FleetNetworkError || /failed to fetch|networkerror|load failed/i.test(message)) {
    return `Cannot reach the API at ${API_DISPLAY_URL}. Check the portal connection and try again.`;
  }
  return message || 'An unknown fleet monitoring error occurred.';
}

export function getStoredJwt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(JWT_KEY);
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
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw new FleetNetworkError(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const parsed = parseErrorBody(text);
    if ([400, 401, 403].includes(response.status)) {
      clearTokensIfRefreshToken(refreshToken);
      return null;
    }
    throw new FleetApiError(parsed.message, response.status, parsed.detail);
  }

  const data = (await response.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) {
    throw new FleetApiError('Invalid token refresh response.', 502);
  }
  if (localStorage.getItem(REFRESH_KEY) !== refreshToken) return getStoredJwt();
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

function sessionExpiredFor(jwt: string): FleetAuthError {
  clearTokensIfAccessToken(jwt);
  return new FleetAuthError('Session expired.');
}

async function getJwt(): Promise<string> {
  const token = getStoredJwt();
  if (!token) throw new FleetAuthError('Not signed in.');
  return token;
}

async function refreshAfterUnauthorized(jwt: string): Promise<string | null> {
  const current = getStoredJwt();
  if (current && current !== jwt) return current;
  return tryRefreshToken();
}

export async function fleetRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
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
      if (fresh) return fleetRequest<T>(method, path, body, true);
      throw sessionExpiredFor(jwt);
    }
    if (response.status === 401) throw sessionExpiredFor(jwt);
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new FleetApiError(parsed.message, response.status, parsed.detail);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  } catch (error) {
    if (
      error instanceof FleetAuthError ||
      error instanceof FleetApiError ||
      error instanceof FleetNetworkError
    ) {
      throw error;
    }
    throw new FleetNetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function fleetPublicRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new FleetApiError(parsed.message, response.status, parsed.detail);
    }
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof FleetApiError) throw error;
    throw new FleetNetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function fleetRequestBlob(path: string, retried = false): Promise<Blob> {
  const jwt = await getJwt();
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (response.status === 401 && !retried) {
      const fresh = await refreshAfterUnauthorized(jwt);
      if (fresh) return fleetRequestBlob(path, true);
      throw sessionExpiredFor(jwt);
    }
    if (response.status === 401) throw sessionExpiredFor(jwt);
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      const parsed = parseErrorBody(text);
      throw new FleetApiError(parsed.message, response.status, parsed.detail);
    }
    return response.blob();
  } catch (error) {
    if (
      error instanceof FleetAuthError ||
      error instanceof FleetApiError ||
      error instanceof FleetNetworkError
    ) {
      throw error;
    }
    throw new FleetNetworkError(error instanceof Error ? error.message : String(error));
  }
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}
