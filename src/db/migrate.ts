import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client.js';

export async function runMigrations(): Promise<void> {
  console.log('[db] Running migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('[db] Migrations complete.');
}
