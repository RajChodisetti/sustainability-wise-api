import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';
import { closeBrowser } from './pdf/renderer.js';
import { closeDb } from './db/client.js';
import { failInterruptedExportJobs } from './services/pdfJobService.js';
import { drainStorageDeletionTasks } from './services/storageDeletionService.js';
import { startSchedulerNotificationWorker } from './services/schedulerNotificationWorker.js';
import { reconcilePendingSchedulerExpenseAttachments } from './services/schedulerFinanceService.js';

async function main() {
  await runMigrations();
  await reconcilePendingSchedulerExpenseAttachments();
  await failInterruptedExportJobs();
  await drainStorageDeletionTasks();

  const app = await buildApp();

  await app.listen({ port: config.port, host: config.host });
  const notificationWorker = startSchedulerNotificationWorker();
  let storageCleanupRunning = false;
  const storageCleanupTimer = setInterval(() => {
    if (storageCleanupRunning) return;
    storageCleanupRunning = true;
    void failInterruptedExportJobs()
      .then(() => drainStorageDeletionTasks({ limit: 100, maxTasks: 500 }))
      .catch((error) => console.error('[storage-cleanup] Periodic sweep failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }))
      .finally(() => { storageCleanupRunning = false; });
  }, 15 * 60 * 1_000);
  storageCleanupTimer.unref();
  let attachmentReconcileRunning = false;
  const attachmentReconcileTimer = setInterval(() => {
    if (attachmentReconcileRunning) return;
    attachmentReconcileRunning = true;
    void reconcilePendingSchedulerExpenseAttachments()
      .catch((error) => console.error('[scheduler-finance] Attachment reconciliation failed', {
        error: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => { attachmentReconcileRunning = false; });
  }, 60 * 60 * 1_000);
  attachmentReconcileTimer.unref();
  console.log(`[server] Listening on ${config.host}:${config.port}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[server] ${signal} received; shutting down`);
    clearInterval(storageCleanupTimer);
    clearInterval(attachmentReconcileTimer);
    await notificationWorker.stop();
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
