import { request } from '@solar/api/client';
import { cloudEmailForUsername } from '@solar/api/auth';
import type { CloudUser } from '@solar/types/domain';
import { unwrapList } from '@solar/lib/normalize';

function normalizeUser(raw: Record<string, unknown>): CloudUser {
  return {
    id: String(raw.id ?? ''),
    email: String(raw.email ?? ''),
    fullName: (raw.fullName ?? raw.full_name ?? null) as string | null,
    role: String(raw.role ?? 'inspector'),
    isActive: raw.isActive !== false && raw.is_active !== false && raw.isActive !== 0,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
  };
}

export async function listUsers(): Promise<CloudUser[]> {
  const payload = await request<unknown>('GET', '/v1/solarsense/users/');
  return unwrapList(payload, normalizeUser);
}

export async function createUser(input: {
  id?: string;
  username: string;
  password: string;
  fullName: string;
  role: 'admin' | 'inspector';
}): Promise<CloudUser> {
  const payload = await request<Record<string, unknown>>('POST', '/v1/solarsense/users/', {
    id: input.id,
    email: cloudEmailForUsername(input.username),
    password: input.password,
    fullName: input.fullName,
    role: input.role,
  });
  return normalizeUser(payload);
}

export async function updateUser(
  id: string,
  input: { username?: string; fullName?: string; role?: 'admin' | 'inspector'; isActive?: boolean },
): Promise<CloudUser> {
  const body: Record<string, unknown> = {};
  if (input.username) body.email = cloudEmailForUsername(input.username);
  if (input.fullName !== undefined) body.fullName = input.fullName;
  if (input.role) body.role = input.role;
  if (input.isActive !== undefined) body.isActive = input.isActive;
  const payload = await request<Record<string, unknown>>('PATCH', `/v1/solarsense/users/${encodeURIComponent(id)}`, body);
  return normalizeUser(payload);
}

export async function deactivateUser(id: string): Promise<void> {
  await request('DELETE', `/v1/solarsense/users/${encodeURIComponent(id)}`);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  await request('PATCH', `/v1/solarsense/users/${encodeURIComponent(userId)}/password`, {
    currentPassword,
    newPassword,
  });
}
