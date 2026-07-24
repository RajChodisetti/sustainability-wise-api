import type { AuthUser } from '../../auth/middleware.js';
import { forbidden, notFound, badRequest } from '../../utils/errors.js';

export type JsonRecord = Record<string, unknown>;

export function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

export function assertInstallationAccess(
  installation: {
    createdByUserId: string | null;
    assignedInspectorUserId?: string | null;
  },
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (
    installation.createdByUserId !== user.userId
    && installation.assignedInspectorUserId !== user.userId
  ) {
    throw forbidden('Installation belongs to another user');
  }
}

export function assertInstallationDeletionAccess(
  installation: { createdByUserId: string | null },
  user: AuthUser,
): void {
  if (isElevated(user) || installation.createdByUserId === user.userId) return;
  throw forbidden('Only the installation creator or an administrator can delete this Cloud Backup');
}

export function shouldPurgeQuery(query?: Record<string, unknown>): boolean {
  const value = query?.purge;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
  return false;
}

export type AdminRemovalGuard = 'self' | 'last_admin' | null;

export function installHubAdminRemovalGuard(input: {
  actorId: string;
  targetId: string;
  currentRole: string;
  currentIsActive: boolean;
  nextRole: string;
  nextIsActive: boolean;
  activeAdminCount: number;
}): AdminRemovalGuard {
  if (
    input.actorId === input.targetId
    && (input.nextRole !== 'admin' || !input.nextIsActive)
  ) {
    return 'self';
  }
  const removesActiveAdmin = input.currentRole === 'admin'
    && input.currentIsActive
    && (input.nextRole !== 'admin' || !input.nextIsActive);
  if (!removesActiveAdmin) return null;
  return input.activeAdminCount <= 1 ? 'last_admin' : null;
}

export function installHubPasswordChangeMode(
  targetUserId: string,
  actor: AuthUser,
): 'self' | 'admin_reset' {
  if (targetUserId === actor.userId) return 'self';
  if (actor.role === 'admin') return 'admin_reset';
  throw forbidden('Cannot change another user password');
}

export function assertFound<T>(value: T | undefined | null, resource: string): T {
  if (!value) throw notFound(resource);
  return value;
}

export function requiredString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${key} is required`);
  return value.trim();
}

export function optionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function optionalDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest('Invalid ISO date');
  return date;
}

export function jsonArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function jsonObject<T extends JsonRecord = JsonRecord>(value: unknown): T {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : {} as T;
}
