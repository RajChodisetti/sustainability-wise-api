import { request } from '@/api/client';
import type { CloudUser } from '@/types/domain';

export function listUsers(): Promise<{ data: CloudUser[] }> {
  return request<{ data: CloudUser[] }>('GET', '/v1/ecoaudit/users');
}

export function getUser(id: string): Promise<CloudUser> {
  return request<CloudUser>('GET', `/v1/ecoaudit/users/${encodeURIComponent(id)}`);
}

export function createUser(body: {
  email: string;
  password: string;
  fullName?: string;
  role?: string;
}): Promise<CloudUser> {
  return request<CloudUser>('POST', '/v1/ecoaudit/users', body);
}

export function updateUser(id: string, body: Partial<CloudUser>): Promise<CloudUser> {
  return request<CloudUser>('PATCH', `/v1/ecoaudit/users/${encodeURIComponent(id)}`, body);
}

export function deactivateUser(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/ecoaudit/users/${encodeURIComponent(id)}`);
}

export function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  return request<void>('PATCH', `/v1/ecoaudit/users/${encodeURIComponent(userId)}/password`, {
    currentPassword,
    newPassword,
  });
}
