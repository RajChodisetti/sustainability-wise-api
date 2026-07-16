import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import { eaUsers } from '../src/db/schema/ecoaudit.js';
import { ssUsers } from '../src/db/schema/solarsense.js';
import { wwUsers } from '../src/db/schema/wattwatchers.js';
import { hashPassword } from '../src/auth/apiKey.js';

type AppName = 'ecoaudit' | 'solarsense' | 'wattwatchers';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeEmail(app: AppName, value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safeUsername}@${app}.users.local`;
}

async function main() {
  const app = required('APP') as AppName;
  if (!['ecoaudit', 'solarsense', 'wattwatchers'].includes(app)) {
    throw new Error('APP must be ecoaudit, solarsense, or wattwatchers');
  }

  const email = normalizeEmail(app, required('EMAIL'));
  const password = required('PASSWORD');
  if (password.length < 8) throw new Error('PASSWORD must be at least 8 characters');

  const fullName = process.env.FULL_NAME?.trim() || null;
  const id = process.env.USER_ID?.trim() || randomUUID();
  const table = app === 'ecoaudit'
    ? eaUsers
    : app === 'solarsense'
      ? ssUsers
      : wwUsers;

  const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.email, email));
  if (existing) throw new Error(`Admin already exists for ${email}`);

  await db.insert(table).values({
    id,
    email,
    passwordHash: await hashPassword(password),
    fullName,
    role: 'admin',
    isActive: true,
  });

  console.log(JSON.stringify({ id, email, app, role: 'admin' }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
