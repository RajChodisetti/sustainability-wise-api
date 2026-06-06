import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as sharedSchema from './schema/shared.js';
import * as solarsenseSchema from './schema/solarsense.js';
import * as ecoauditSchema from './schema/ecoaudit.js';

const sql = postgres(config.databaseUrl, { max: 10 });

export const db = drizzle(sql, {
  schema: { ...sharedSchema, ...solarsenseSchema, ...ecoauditSchema },
});

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}

export { sql };
