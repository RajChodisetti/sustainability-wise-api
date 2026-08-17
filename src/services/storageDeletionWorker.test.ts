import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entrypointSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const schedulerInvoicePdfExportSource = readFileSync(
  new URL('./schedulerInvoicePdfExport.ts', import.meta.url),
  'utf8',
);
const schedulerInvoicePdfFailureFenceMigration = readFileSync(
  new URL('../db/migrations/0037_cultured_vulcan.sql', import.meta.url),
  'utf8',
);

test('periodic recovery reaps only lease-expired exports before bounded artifact cleanup', () => {
  const startupEnd = entrypointSource.indexOf('const app = await buildApp()');
  const periodicStart = entrypointSource.indexOf('const storageCleanupTimer = setInterval');
  const periodicEnd = entrypointSource.indexOf('storageCleanupTimer.unref()', periodicStart);

  assert.notEqual(startupEnd, -1);
  assert.notEqual(periodicStart, -1);
  assert.notEqual(periodicEnd, -1);
  assert.match(entrypointSource.slice(0, startupEnd), /await failInterruptedExportJobs\(\)/);

  const periodicSweep = entrypointSource.slice(periodicStart, periodicEnd);
  assert.match(periodicSweep, /if \(storageCleanupRunning\) return/);
  assert.match(periodicSweep, /storageCleanupRunning = true/);
  assert.match(
    periodicSweep,
    /failInterruptedExportJobs\(\)[\s\S]*\.then\(\(\) => drainStorageDeletionTasks\(\{ limit: 100, maxTasks: 500 \}\)\)/,
  );
  assert.match(periodicSweep, /\.finally\(\(\) => \{ storageCleanupRunning = false; \}\)/);
});

test('durable invoice PDF recovery starts before email and drains on shutdown', () => {
  const pdfStart = entrypointSource.indexOf('startSchedulerInvoicePdfWorker()');
  const emailStart = entrypointSource.indexOf('startSchedulerInvoiceEmailWorker()');
  const emailStop = entrypointSource.indexOf('await invoiceEmailWorker.stop()');
  const pdfStop = entrypointSource.indexOf('await invoicePdfWorker.stop()');
  const dbStop = entrypointSource.indexOf('await closeDb()');

  assert.ok(pdfStart > 0 && pdfStart < emailStart);
  assert.ok(emailStop > emailStart && emailStop < pdfStop);
  assert.ok(pdfStop < dbStop);
});

test('database fence blocks rolling-old Scheduler PDF failure writes and admits claimed-worker failure', () => {
  assert.match(
    schedulerInvoicePdfFailureFenceMigration,
    /CREATE TRIGGER "scheduler_invoice_pdf_failed_write_fence_trigger"\s+BEFORE UPDATE OF "status" ON "pdf_jobs"/,
  );
  assert.match(
    schedulerInvoicePdfFailureFenceMigration,
    /OLD\."entity_type" = 'scheduler_invoice'[\s\S]*OLD\."status" IN \('queued', 'running'\)[\s\S]*NEW\."status" = 'failed'/,
  );
  assert.match(
    schedulerInvoicePdfFailureFenceMigration,
    /current_setting\('app\.scheduler_invoice_pdf_worker_write', true\) IS DISTINCT FROM '1'[\s\S]*RETURN OLD/,
  );

  const failClaimedStart = schedulerInvoicePdfExportSource.indexOf(
    'async function failClaimedSchedulerInvoicePdfJob',
  );
  const nextFunction = schedulerInvoicePdfExportSource.indexOf(
    'function requiredClaimParam',
    failClaimedStart,
  );
  assert.notEqual(failClaimedStart, -1);
  assert.notEqual(nextFunction, -1);
  const claimedFailure = schedulerInvoicePdfExportSource.slice(failClaimedStart, nextFunction);
  assert.match(claimedFailure, /db\.transaction/);
  assert.match(
    claimedFailure,
    /set_config\('app\.scheduler_invoice_pdf_worker_write', '1', true\)[\s\S]*status: 'failed'/,
  );
  assert.match(claimedFailure, /eq\(pdfJobs\.claimToken, job\.claimToken\)/);
});
