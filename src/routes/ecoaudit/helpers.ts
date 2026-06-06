import type { AuthUser } from '../../auth/middleware.js';
import { forbidden, notFound, badRequest } from '../../utils/errors.js';

export type JsonRecord = Record<string, unknown>;

export function isElevated(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'service_account';
}

export function assertAuditAccess(
  audit: { createdByUserId: string | null; assignedInspectorUserId?: string | null },
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (audit.createdByUserId === user.userId || audit.assignedInspectorUserId === user.userId) return;
  throw forbidden('Audit belongs to another user');
}

export function assertZoneAccess(
  zone: { auditId: string },
  auditOwnerUserId: string | null,
  user: AuthUser,
): void {
  if (isElevated(user)) return;
  if (auditOwnerUserId !== user.userId) throw forbidden('Zone belongs to another user');
}

export function assertSelfOrAdmin(targetUserId: string, user: AuthUser): void {
  if (user.role === 'admin' || targetUserId === user.userId) return;
  throw forbidden('Cannot access another user');
}

export function assertFound<T>(value: T | undefined | null, resource: string): T {
  if (!value) throw notFound(resource);
  return value;
}

export function requiredString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${key} is required`);
  }
  return value.trim();
}

export function optionalString(body: JsonRecord, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

export function optionalNumber(body: JsonRecord, key: string): number | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${key} must be a number`);
  return n;
}

export function optionalStringArray(body: JsonRecord, key: string): string[] | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

export function optionalJson<T>(body: JsonRecord, key: string, fallback: T): T | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null || value === undefined) return fallback;
  return value as T;
}

export function dateOrNow(value: unknown): Date {
  if (!value) return new Date();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function requireCompleted(records: Array<{ id?: string; status?: unknown }>, label: string): void {
  const bad = records.find(r => r.status !== 'Completed');
  if (bad) throw badRequest(`${label} ${bad.id ?? ''} must be Completed before sync`);
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String);
}
