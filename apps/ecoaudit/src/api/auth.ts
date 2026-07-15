import type { CloudUser } from '@/types/domain';
import { clearTokens, publicRequest, request, saveTokens } from '@/api/client';

const REGISTRATION_SECRET = process.env.NEXT_PUBLIC_REGISTRATION_SECRET ?? '';

export function cloudEmailForUsername(username: string): string {
  const normalized = username.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  return `${normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-')}@ecoaudit.users.local`;
}

export function localUsernameFromCloudEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  const suffix = '@ecoaudit.users.local';
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
    app: 'ecoaudit',
    email: cloudEmailForUsername(username),
    password,
  });
  return persistAuth(data);
}

export async function registerAccount(input: {
  username: string;
  password: string;
  fullName: string;
}): Promise<CloudUser> {
  if (!REGISTRATION_SECRET) {
    throw new Error('Registration is not configured. Contact your administrator.');
  }
  const data = await publicRequest<AuthResponse>(
    'POST',
    '/v1/auth/register',
    {
      app: 'ecoaudit',
      email: cloudEmailForUsername(input.username),
      password: input.password,
      fullName: input.fullName,
    },
    { 'X-Registration-Secret': REGISTRATION_SECRET },
  );
  return persistAuth(data);
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('ea_web_refresh');
  try {
    if (refreshToken) {
      await publicRequest('POST', '/v1/auth/logout', { refreshToken, app: 'ecoaudit' });
    }
  } finally {
    clearTokens();
  }
}

export function me(): Promise<CloudUser> {
  return request<CloudUser>('GET', '/v1/auth/me');
}
