import { randomUUID } from 'node:crypto';

type DbRecord = Record<string, unknown>;

const defaultBlockedCopyKeys = new Set([
  'id',
  'serverId',
  'syncStatus',
  'updatedAt',
  'deletedAt',
  'createdAt',
  'createdByUserId',
  'reportPdfLocalPath',
  'reportPdfRemoteUrl',
  'startedAt',
  'completedAt',
]);

function hasOwn(record: DbRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function copyableBodyOverrides(
  source: DbRecord,
  body: DbRecord,
  blockedKeys: string[] = [],
): DbRecord {
  const blocked = new Set([...defaultBlockedCopyKeys, ...blockedKeys]);
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => hasOwn(source, key) && !blocked.has(key)),
  );
}

export function cloneRecordForInsert(
  source: DbRecord,
  overrides: DbRecord = {},
  blockedKeys: string[] = [],
): DbRecord {
  const blocked = new Set([...defaultBlockedCopyKeys, ...blockedKeys]);
  const base = Object.fromEntries(
    Object.entries(source).filter(([key]) => !blocked.has(key)),
  );

  return {
    ...base,
    ...overrides,
    id: randomUUID(),
    serverId: randomUUID(),
    syncStatus: 'synced',
    updatedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
  };
}

export function copyNameWithSuffix(name: string): string {
  return `${name.trim()} ${randomUUID().replace(/-/g, '').slice(0, 4)}`;
}
