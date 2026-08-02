import type { InstallHubUser } from '@/modules/installhub/types/domain';
import {
  InstallHubApiError,
  clearTokens,
  getStoredRefreshToken,
  installHubPublicRequest,
  installHubRequest,
  saveTokens,
} from '@/modules/installhub/api/client';

export function installHubEmailForUsername(username: string): string {
  const normalized = username.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safe = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safe}@installhub.users.local`;
}

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: InstallHubUser;
};

function persistAuth(data: AuthResponse): InstallHubUser {
  if (!data?.accessToken || !data?.refreshToken || !data?.user?.id) {
    throw new Error('Field App Complete authentication failed.');
  }
  saveTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function loginWithUsername(
  username: string,
  password: string,
): Promise<InstallHubUser> {
  const data = await installHubPublicRequest<AuthResponse>('POST', '/v1/auth/login', {
    app: 'installhub',
    email: installHubEmailForUsername(username),
    password,
  });
  return persistAuth(data);
}

export async function logout(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  try {
    if (refreshToken) {
      await installHubPublicRequest('POST', '/v1/auth/logout', {
        refreshToken,
        app: 'installhub',
      });
    }
  } finally {
    clearTokens();
  }
}

export async function me(): Promise<InstallHubUser> {
  try {
    return await installHubRequest<InstallHubUser>('GET', '/v1/auth/me');
  } catch (error) {
    if (error instanceof InstallHubApiError && error.status === 403) clearTokens();
    throw error;
  }
}
