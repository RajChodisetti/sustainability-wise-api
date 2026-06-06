import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { recordVersions } from '../db/schema/shared.js';

type VersionInput = {
  app: 'ecoaudit' | 'solarsense';
  entityType: 'audit' | 'site';
  entityId: string;
  snapshot: unknown;
  userId: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function saveRecordVersion(input: VersionInput): Promise<number> {
  const [latest] = await db
    .select()
    .from(recordVersions)
    .where(and(
      eq(recordVersions.app, input.app),
      eq(recordVersions.entityType, input.entityType),
      eq(recordVersions.entityId, input.entityId),
    ))
    .orderBy(desc(recordVersions.versionNumber))
    .limit(1);

  if (latest && stableStringify(latest.snapshot) === stableStringify(input.snapshot)) {
    return latest.versionNumber;
  }

  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  await db.insert(recordVersions).values({
    id: randomUUID(),
    app: input.app,
    entityType: input.entityType,
    entityId: input.entityId,
    versionNumber,
    snapshot: input.snapshot,
    createdByUserId: input.userId,
  });
  return versionNumber;
}
