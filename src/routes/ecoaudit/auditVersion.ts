import { badRequest, conflict } from '../../utils/errors.js';

export type AuditVersion = {
  updatedAt: Date;
  completedAt: Date | null;
};

export type AuditReopenPreconditions = {
  expectedUpdatedAt?: Date;
  expectedCompletedAt?: Date | null;
};

function parseIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} must be a valid ISO datetime`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${field} must be a valid ISO datetime`);
  }
  return parsed;
}

function requestRecord(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('request body must be an object');
  }
  return body as Record<string, unknown>;
}

export function parseAuditReopenPreconditions(body: unknown): AuditReopenPreconditions {
  const record = requestRecord(body);
  const expectedUpdatedAt = Object.prototype.hasOwnProperty.call(record, 'expectedUpdatedAt')
    ? parseIsoDate(record.expectedUpdatedAt, 'expectedUpdatedAt')
    : undefined;
  const expectedCompletedAt = Object.prototype.hasOwnProperty.call(record, 'expectedCompletedAt')
    ? record.expectedCompletedAt === null
      ? null
      : parseIsoDate(record.expectedCompletedAt, 'expectedCompletedAt')
    : undefined;
  return {
    ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
    ...(expectedCompletedAt !== undefined ? { expectedCompletedAt } : {}),
  };
}

export function parseExpectedAuditUpdatedAt(value: unknown, supplied: boolean): Date | undefined {
  return supplied ? parseIsoDate(value, 'expectedAuditUpdatedAt') : undefined;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

export function assertAuditReopenVersion(
  current: AuditVersion,
  expected: AuditReopenPreconditions,
): void {
  if (
    (expected.expectedUpdatedAt !== undefined
      && current.updatedAt.getTime() !== expected.expectedUpdatedAt.getTime())
    || (expected.expectedCompletedAt !== undefined
      && !sameInstant(current.completedAt, expected.expectedCompletedAt))
  ) {
    throw conflict('audit_reopen_version_changed');
  }
}

export function assertAuditSyncVersion(
  current: Pick<AuditVersion, 'updatedAt'> | undefined,
  expectedUpdatedAt: Date | undefined,
): void {
  if (expectedUpdatedAt === undefined) return;
  if (!current || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw conflict('audit_sync_version_changed');
  }
}

export function nextAuditUpdatedAt(current: Date, proposed = new Date()): Date {
  return new Date(Math.max(proposed.getTime(), current.getTime() + 1));
}
