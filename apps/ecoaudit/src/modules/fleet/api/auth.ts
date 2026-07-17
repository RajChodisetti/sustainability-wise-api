import type { FleetUser } from '@/modules/fleet/types/domain';
import {
  FleetApiError,
  clearTokens,
  fleetPublicRequest,
  fleetRequest,
  getStoredRefreshToken,
  saveTokens,
} from '@/modules/fleet/api/client';

export function fleetEmailForUsername(username: string): string {
  const normalized = username.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safe = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safe}@wattwatchers.users.local`;
}

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: FleetUser;
};

function persistAuth(data: AuthResponse): FleetUser {
  if (!data?.accessToken || !data?.refreshToken || !data?.user?.id) {
    throw new Error('Authentication failed.');
  }
  saveTokens(data.accessToken, data.refreshToken);
  return data.user;
}

export async function loginWithUsername(username: string, password: string): Promise<FleetUser> {
  const data = await fleetPublicRequest<AuthResponse>('POST', '/v1/auth/login', {
    app: 'wattwatchers',
    email: fleetEmailForUsername(username),
    password,
  });
  return persistAuth(data);
}

export async function logout(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  try {
    if (refreshToken) {
      await fleetPublicRequest('POST', '/v1/auth/logout', { refreshToken });
    }
  } finally {
    clearTokens();
  }
}

export async function me(): Promise<FleetUser> {
  try {
    return await fleetRequest<FleetUser>('GET', '/v1/auth/me');
  } catch (error) {
    if (error instanceof FleetApiError && error.status === 403) clearTokens();
    throw error;
  }
}
