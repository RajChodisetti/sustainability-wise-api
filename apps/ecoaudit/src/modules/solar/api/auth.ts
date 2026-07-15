import type { CloudUser } from '@solar/types/domain';
import {
  ApiError,
  clearTokens,
  publicRequest,
  request,
  saveTokens,
} from '@solar/api/client';
import { registerThroughPortal } from '@/api/portalRegistration';

export function cloudEmailForUsername(username: string): string {
  const normalized = username.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  return `${normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-')}@solarsense.users.local`;
}

export function localUsernameFromCloudEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  const suffix = '@solarsense.users.local';
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : normalized;
}

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: CloudUser;
};

function persistAuth(data: AuthResponse): CloudUser {
  if (!data?.accessToken || !data?.refreshToken || !data?.user?.id) {
    throw new Error('Authentication failed.');
  }
  saveTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function loginWithUsername(username: string, password: string): Promise<CloudUser> {
  const data = await publicRequest<AuthResponse>('POST', '/v1/auth/login', {
    app: 'solarsense',
    email: cloudEmailForUsername(username),
    password,
  });
  return persistAuth(data);
}

/** @deprecated use loginWithUsername */
export async function login(email: string, password: string): Promise<CloudUser> {
  return loginWithUsername(email, password);
}

export async function registerAccount(input: {
  username: string;
  password: string;
  fullName: string;
}): Promise<CloudUser> {
  const data = await registerThroughPortal<AuthResponse>({
      app: 'solarsense',
      username: input.username,
      password: input.password,
      fullName: input.fullName.trim(),
  });
  return persistAuth(data);
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('ss_web_refresh');
  if (refreshToken) {
    try {
      await publicRequest('POST', '/v1/auth/logout', { refreshToken, app: 'solarsense' });
    } catch {
      // ignore logout errors
    }
  }
  clearTokens();
}

export async function me(): Promise<CloudUser> {
  try {
    return await request<CloudUser>('GET', '/v1/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      clearTokens();
    }
    throw error;
  }
}
