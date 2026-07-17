import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import { eaUsers } from '../src/db/schema/ecoaudit.js';
import { ssUsers } from '../src/db/schema/solarsense.js';
import { wwUsers } from '../src/db/schema/wattwatchers.js';

type SourceApp = 'ecoaudit' | 'solarsense';
type FleetRole = 'viewer' | 'admin';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localEmail(app: SourceApp | 'wattwatchers', value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const username = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${username}@${app}.users.local`;
}

function fleetEmail(value: string): string {
  const normalized = value.toLowerCase().trim();
  const localIdentity = /^([^@]+)@(ecoaudit|solarsense|wattwatchers)\.users\.local$/.exec(normalized);
  if (localIdentity) return `${localIdentity[1]}@wattwatchers.users.local`;
  return localEmail('wattwatchers', normalized);
}

async function main(): Promise<void> {
  const sourceApp = (process.env.SOURCE_APP?.trim() || 'ecoaudit') as SourceApp;
  if (!['ecoaudit', 'solarsense'].includes(sourceApp)) {
    throw new Error('SOURCE_APP must be ecoaudit or solarsense');
  }

  const role = (process.env.ROLE?.trim() || 'viewer') as FleetRole;
  if (!['viewer', 'admin'].includes(role)) {
    throw new Error('ROLE must be viewer or admin');
  }

  const username = required('USERNAME');
  const sourceTable = sourceApp === 'ecoaudit' ? eaUsers : ssUsers;
  const sourceEmail = localEmail(sourceApp, username);
  const [source] = await db.select().from(sourceTable).where(eq(sourceTable.email, sourceEmail));
  if (!source) throw new Error(`No ${sourceApp} user exists for ${sourceEmail}`);

  // Preserve real email identities; only app-local aliases change namespace.
  const targetEmail = fleetEmail(username);
  const [existing] = await db.select().from(wwUsers).where(eq(wwUsers.email, targetEmail));
  const now = new Date();

  if (existing) {
    await db.update(wwUsers).set({
      passwordHash: source.passwordHash,
      fullName: source.fullName,
      role,
      isActive: true,
      updatedAt: now,
    }).where(eq(wwUsers.id, existing.id));
  } else {
    await db.insert(wwUsers).values({
      id: randomUUID(),
      email: targetEmail,
      passwordHash: source.passwordHash,
      fullName: source.fullName,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log(JSON.stringify({
    sourceApp,
    sourceEmail,
    targetEmail,
    role,
    created: !existing,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
