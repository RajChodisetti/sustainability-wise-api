import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';

async function main() {
  await runMigrations();

  const app = await buildApp();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[server] Listening on port ${config.port}`);
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
