import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';
import { closeBrowser } from './pdf/renderer.js';
import { closeDb } from './db/client.js';

async function main() {
  await runMigrations();

  const app = await buildApp();

  await app.listen({ port: config.port, host: config.host });
  console.log(`[server] Listening on ${config.host}:${config.port}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[server] ${signal} received; shutting down`);
    await app.close();
    await closeBrowser();
    await closeDb();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
