import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  persistSchedulerInvoicePdfArtifact,
  schedulerInvoicePdfJobParams,
  schedulerInvoicePdfReportVariantKey,
  startSchedulerInvoicePdfWorker,
  type ClaimedSchedulerInvoicePdfJob,
  type SchedulerInvoicePdfArtifactDependencies,
} from './schedulerInvoicePdfExport.js';
import { conflict } from '../utils/errors.js';

const invoice = {
  id: 'invoice-42',
  financeId: 'finance-9',
  invoiceNumber: 'INV-2026-0042',
  updatedAt: '2026-08-16T18:15:00.000Z',
  issueDate: '2026-08-16T00:00:00.000Z',
  jobCount: 2,
  jobNames: ['Café rooftop upgrade', 'Private second job name'],
  job: {
    jobName: 'Café rooftop upgrade',
    jobDate: '2026-08-15',
    clientName: 'Private Client',
    siteName: 'North Wing',
    siteAddress: 'Not persisted in export params',
    status: 'Scheduled',
    sourceApp: 'solarsense' as const,
    sourceType: 'assessment' as const,
    sourceId: 'assessment-7',
  },
};

const artifactInput = {
  user: {
    userId: 'invoice-admin-eco',
    app: 'ecoaudit' as const,
    role: 'admin' as const,
    authType: 'jwt' as const,
  },
  financeId: 'finance-9',
  invoiceId: 'invoice-42',
  sourceUpdatedAt: invoice.updatedAt,
  jobId: 'pdf-job-42',
  storageKey: 'ecoaudit/scheduler-invoice/pdf-job-42/invoice.pdf',
  pdfUrl: '/v1/files/ecoaudit/scheduler-invoice/pdf-job-42/invoice.pdf',
  buffer: Buffer.from('%PDF-test'),
};

const claimedJob: ClaimedSchedulerInvoicePdfJob = {
  id: artifactInput.jobId,
  claimToken: 'claim-token-42',
  app: artifactInput.user.app,
  entityId: artifactInput.invoiceId,
  userId: artifactInput.user.userId,
  params: schedulerInvoicePdfJobParams(invoice),
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function artifactTestDependencies(input: {
  events: string[];
  writeError?: Error;
  publishError?: Error;
  inspection?: { jobComplete: boolean; artifactAttached: boolean };
  inspectionError?: Error;
}): SchedulerInvoicePdfArtifactDependencies {
  return {
    async queueCleanupTask() {
      input.events.push('queue-cleanup');
      return 'cleanup-task-42';
    },
    async writeFile() {
      input.events.push('write-file');
      if (input.writeError) throw input.writeError;
      return { size: artifactInput.buffer.length, checksum: 'checksum' };
    },
    async publishWithRevisionLock() {
      input.events.push('publish-locked');
      if (input.publishError) throw input.publishError;
    },
    async inspectPublication() {
      input.events.push('inspect-publication');
      if (input.inspectionError) throw input.inspectionError;
      return input.inspection ?? { jobComplete: false, artifactAttached: false };
    },
    async drainCleanupTask() {
      input.events.push('drain-cleanup');
    },
  };
}

test('scheduler invoice PDF params pin identity, revision, variant, and branded filename', () => {
  const params = schedulerInvoicePdfJobParams(invoice);
  assert.deepEqual(params, {
    artifactType: 'pdf',
    filename: 'invoice-Café-rooftop-upgrade-and-1-more-2026-08-16-INV-2026-0042.pdf',
    contentType: 'application/pdf',
    invoiceId: 'invoice-42',
    financeId: 'finance-9',
    sourceUpdatedAt: '2026-08-16T18:15:00.000Z',
    reportVariantKey: 'scheduler-invoice-pdf:v2:invoice-42:2026-08-16T18:15:00.000Z',
    rendererVersion: SCHEDULER_INVOICE_PDF_RENDERER_VERSION,
  });
  assert.equal('clientName' in params, false);
  assert.equal('siteAddress' in params, false);
  assert.equal('jobNames' in params, false);
});

test('one-job durable params retain the legacy job-name and job-date filename', () => {
  const params = schedulerInvoicePdfJobParams({ ...invoice, jobCount: 1 });
  assert.equal(
    params.filename,
    'invoice-Café-rooftop-upgrade-2026-08-15-INV-2026-0042.pdf',
  );
});

test('invoice lifecycle mutations produce a new latest/dedupe variant', () => {
  const original = schedulerInvoicePdfReportVariantKey(invoice);
  const changed = schedulerInvoicePdfReportVariantKey({
    ...invoice,
    updatedAt: '2026-08-16T18:16:00.000Z',
  });
  assert.notEqual(changed, original);
  assert.equal(
    schedulerInvoicePdfReportVariantKey({ ...invoice }),
    original,
    'event and finance aliases derive the same version identity',
  );
});

test('invoice PDF provenance rejects blank identities', () => {
  assert.throws(
    () => schedulerInvoicePdfReportVariantKey({ id: ' ', updatedAt: invoice.updatedAt }),
    /invoice id and updatedAt are required/,
  );
});

test('invoice PDF params reject an impossible empty job snapshot', () => {
  assert.throws(
    () => schedulerInvoicePdfJobParams({ ...invoice, jobCount: 0 }),
    /jobCount must be a positive safe integer/,
  );
});

test('artifact publication durably records cleanup before writing and releases it atomically', async () => {
  const events: string[] = [];
  await persistSchedulerInvoicePdfArtifact(
    artifactInput,
    artifactTestDependencies({ events }),
  );
  assert.deepEqual(events, [
    'queue-cleanup',
    'write-file',
    'queue-cleanup',
    'publish-locked',
  ]);
});

test('a partial storage write is queued and best-effort drained without publication', async () => {
  const events: string[] = [];
  const writeError = new Error('simulated partial write');
  await assert.rejects(
    persistSchedulerInvoicePdfArtifact(
      artifactInput,
      artifactTestDependencies({ events, writeError }),
    ),
    writeError,
  );
  assert.deepEqual(events, [
    'queue-cleanup',
    'write-file',
    'queue-cleanup',
    'drain-cleanup',
  ]);
});

test('a stale final revision drains unattached bytes after confirming the job is incomplete', async () => {
  const events: string[] = [];
  const publishError = conflict('Invoice changed; refresh before continuing');
  await assert.rejects(
    persistSchedulerInvoicePdfArtifact(
      artifactInput,
      artifactTestDependencies({ events, publishError }),
    ),
    publishError,
  );
  assert.deepEqual(events, [
    'queue-cleanup',
    'write-file',
    'queue-cleanup',
    'publish-locked',
    'inspect-publication',
    'drain-cleanup',
  ]);
});

test('a completion write failure retains cleanup until the incomplete job is confirmed', async () => {
  const events: string[] = [];
  const publishError = new Error('simulated completeJob failure');
  await assert.rejects(
    persistSchedulerInvoicePdfArtifact(
      artifactInput,
      artifactTestDependencies({ events, publishError }),
    ),
    publishError,
  );
  assert.deepEqual(events.slice(-2), ['inspect-publication', 'drain-cleanup']);
});

test('a lost completion acknowledgement preserves a confirmed attached artifact', async () => {
  const events: string[] = [];
  await persistSchedulerInvoicePdfArtifact(
    artifactInput,
    artifactTestDependencies({
      events,
      publishError: new Error('connection ended after commit'),
      inspection: { jobComplete: true, artifactAttached: true },
    }),
  );
  assert.equal(events.includes('drain-cleanup'), false);
});

test('an uninspectable completion outcome never drains potentially attached bytes', async () => {
  const events: string[] = [];
  await assert.rejects(
    persistSchedulerInvoicePdfArtifact(
      artifactInput,
      artifactTestDependencies({
        events,
        publishError: new Error('ambiguous commit acknowledgement'),
        inspectionError: new Error('database unavailable'),
      }),
    ),
    { name: 'AmbiguousSchedulerInvoicePdfPublicationError' },
  );
  assert.equal(events.includes('drain-cleanup'), false);
});

test('durable worker claims on startup, prevents duplicate local execution, and stops gracefully', async () => {
  const executionStarted = deferred();
  const releaseExecution = deferred();
  let offered = false;
  let executions = 0;
  let activeExecutions = 0;
  let maximumActive = 0;
  const worker = startSchedulerInvoicePdfWorker({
    pollIntervalMs: 2,
    dependencies: {
      async claimNext() {
        if (offered) return null;
        offered = true;
        return claimedJob;
      },
      async execute() {
        executions += 1;
        activeExecutions += 1;
        maximumActive = Math.max(maximumActive, activeExecutions);
        executionStarted.resolve();
        await releaseExecution.promise;
        activeExecutions -= 1;
      },
      logCycleError(error) {
        assert.fail(error instanceof Error ? error : String(error));
      },
    },
  });

  await executionStarted.promise;
  worker.wake();
  worker.wake();
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false, 'stop waits for the already-claimed execution');
  releaseExecution.resolve();
  await stopping;

  assert.equal(executions, 1);
  assert.equal(maximumActive, 1);
});

test('durable worker wake discovers a job persisted after an empty startup probe', async () => {
  const startupProbeFinished = deferred();
  const executionFinished = deferred();
  let available = false;
  let claimed = false;
  let executions = 0;
  const worker = startSchedulerInvoicePdfWorker({
    pollIntervalMs: 60_000,
    dependencies: {
      async claimNext() {
        startupProbeFinished.resolve();
        if (!available || claimed) return null;
        claimed = true;
        return claimedJob;
      },
      async execute() {
        executions += 1;
        executionFinished.resolve();
      },
      logCycleError(error) {
        assert.fail(error instanceof Error ? error : String(error));
      },
    },
  });

  await startupProbeFinished.promise;
  available = true;
  worker.wake();
  await executionFinished.promise;
  await worker.stop();
  assert.equal(executions, 1);
});
