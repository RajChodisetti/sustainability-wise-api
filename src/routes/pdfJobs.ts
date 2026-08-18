import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pdfJobs } from '../db/schema/shared.js';
import { authenticate } from '../auth/middleware.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import {
  localFileSize,
  localFileStream,
  signedFileUrl,
} from '../storage/localFiles.js';
import { exportJobParams, type ExportArtifactType } from '../services/pdfJobService.js';
import {
  assertGlobalFinanceAdmin,
  assertSchedulerInvoiceVisible,
} from '../services/schedulerFinanceService.js';

type ExportJob = typeof pdfJobs.$inferSelect;
const MAX_EXPORT_FILENAME_BYTES = 180;

export type ExpectedReportProvenance = {
  recordVersionNumber: number;
  recordVersionPayloadHash: string;
  reportSource: 'canonical-version' | 'diagnostic-live';
};

export function exportJobParamsMatchExpectedProvenance(
  value: unknown,
  expected: ExpectedReportProvenance,
): boolean {
  const params = exportJobParams(value);
  return params.recordVersionNumber === expected.recordVersionNumber
    && params.recordVersionPayloadHash === expected.recordVersionPayloadHash
    && params.reportSource === expected.reportSource;
}

export function exportJobParamsMatchReportVariant(
  value: unknown,
  reportVariantKey: string,
): boolean {
  return exportJobParams(value).reportVariantKey === reportVariantKey;
}

function expectedReportProvenance(query: {
  recordVersionNumber?: unknown;
  recordVersionPayloadHash?: unknown;
  reportSource?: unknown;
}): ExpectedReportProvenance | undefined {
  const supplied = [
    query.recordVersionNumber,
    query.recordVersionPayloadHash,
    query.reportSource,
  ].filter((value) => value !== undefined).length;
  if (supplied === 0) return undefined;
  if (supplied !== 3) {
    throw badRequest(
      'recordVersionNumber, recordVersionPayloadHash, and reportSource must be supplied together',
    );
  }
  const recordVersionNumber = Number(query.recordVersionNumber);
  if (!Number.isInteger(recordVersionNumber) || recordVersionNumber < 1) {
    throw badRequest('recordVersionNumber must be a positive integer');
  }
  if (
    typeof query.recordVersionPayloadHash !== 'string'
    || !query.recordVersionPayloadHash.trim()
  ) {
    throw badRequest('recordVersionPayloadHash must be a non-empty string');
  }
  if (
    query.reportSource !== 'canonical-version'
    && query.reportSource !== 'diagnostic-live'
  ) {
    throw badRequest('reportSource is invalid');
  }
  return {
    recordVersionNumber,
    recordVersionPayloadHash: query.recordVersionPayloadHash,
    reportSource: query.reportSource,
  };
}

function truncateUtf8Filename(filename: string, maxBytes: number): string {
  if (Buffer.byteLength(filename, 'utf8') <= maxBytes) return filename;
  const candidateExtension = path.extname(filename);
  const extension = Buffer.byteLength(candidateExtension, 'utf8') <= 12
    ? candidateExtension
    : '';
  const extensionBytes = Buffer.byteLength(extension, 'utf8');
  const stemBudget = Math.max(1, maxBytes - extensionBytes);
  const stemSource = extension ? filename.slice(0, -extension.length) : filename;
  let stem = '';
  for (const character of stemSource) {
    if (Buffer.byteLength(stem + character, 'utf8') > stemBudget) break;
    stem += character;
  }
  return `${stem.replace(/[ ._-]+$/g, '') || 'export'}${extension}`;
}

function safeArtifactFilename(value: string, fallback: string): string {
  const basename = path.basename(value.replaceAll('\\', '/'));
  const sanitized = basename
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[- ._]+|[- ._]+$/g, '');
  return truncateUtf8Filename(sanitized || fallback, MAX_EXPORT_FILENAME_BYTES);
}

function asciiArtifactFilename(filename: string): string {
  const fallback = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/["\\/;]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[- ._]+|[- ._]+$/g, '');
  return truncateUtf8Filename(fallback || 'export', MAX_EXPORT_FILENAME_BYTES);
}

export function exportArtifactContentDisposition(filename: string): string {
  const canonical = safeArtifactFilename(filename, 'export');
  const ascii = asciiArtifactFilename(canonical);
  const encoded = encodeURIComponent(canonical)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function artifactMetadata(job: ExportJob): {
  artifactType: ExportArtifactType;
  filename: string;
  contentType: 'application/pdf' | 'application/zip';
} {
  const params = exportJobParams(job.params);
  const artifactType = params.artifactType === 'photos-zip' ? 'photos-zip' : 'pdf';
  const fallbackFilename = artifactType === 'photos-zip'
    ? `photos-${job.id}.zip`
    : `report-${job.id}.pdf`;
  const requestedFilename = typeof params.filename === 'string' ? params.filename : fallbackFilename;
  const filename = safeArtifactFilename(requestedFilename, fallbackFilename);
  return {
    artifactType,
    filename,
    contentType: artifactType === 'photos-zip' ? 'application/zip' : 'application/pdf',
  };
}

function serializeJob(job: ExportJob) {
  const metadata = artifactMetadata(job);
  const params = exportJobParams(job.params);
  const recordVersionNumber = typeof params.recordVersionNumber === 'number'
    && Number.isInteger(params.recordVersionNumber)
    && params.recordVersionNumber > 0
    ? params.recordVersionNumber
    : null;
  const recordVersionPayloadHash = typeof params.recordVersionPayloadHash === 'string'
    ? params.recordVersionPayloadHash
    : null;
  const reportSource = params.reportSource === 'canonical-version'
    || params.reportSource === 'diagnostic-live'
    ? params.reportSource
    : null;
  const detailMode = params.detailMode === 'by-zone'
    || params.detailMode === 'by-electrical-hierarchy'
    ? params.detailMode
    : null;
  const reportVariantKey = typeof params.reportVariantKey === 'string'
    ? params.reportVariantKey
    : null;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    // Scheduler invoice artifacts stay behind the current-global-admin download
    // route; do not mint a capability URL that could outlive a later demotion.
    pdfUrl: job.entityType === 'scheduler_invoice'
      ? null
      : job.status === 'complete' && job.storageKey
        ? signedFileUrl(job.storageKey)
        : job.pdfUrl,
    error: job.error,
    artifactType: metadata.artifactType,
    filename: metadata.filename,
    contentType: metadata.contentType,
    recordVersionNumber,
    recordVersionPayloadHash,
    reportSource,
    detailMode,
    reportVariantKey,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

async function assertJobAccess(job: ExportJob, request: FastifyRequest): Promise<void> {
  if (job.app !== request.user.app) throw forbidden('Export job belongs to another application');
  if (job.entityType === 'scheduler_invoice') {
    if (job.userId !== request.user.userId) {
      throw forbidden('Scheduler invoice export belongs to another administrator');
    }
    await assertGlobalFinanceAdmin(request.user);
    await assertSchedulerInvoiceVisible(job.entityId);
    return;
  }
  if (job.userId !== request.user.userId && request.user.role !== 'admin') {
    throw forbidden('Export job belongs to another user');
  }
}

async function loadAccessibleJob(request: FastifyRequest): Promise<ExportJob> {
  const { jobId } = request.params as { jobId: string };
  const [job] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, jobId));
  if (!job) throw notFound('Export job');
  await assertJobAccess(job, request);
  return job;
}

const statusRoute: RouteShorthandOptions = {
  schema: {
    tags: ['Export Jobs', 'EcoAudit PDF', 'SolarSense PDF', 'Field App Complete PDF'],
    summary: 'Get export job status',
    description: 'Returns progress and download metadata for a PDF or ZIP export job.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          phase: { type: ['string', 'null'] },
          progressCurrent: { type: ['integer', 'null'] },
          progressTotal: { type: ['integer', 'null'] },
          pdfUrl: { type: ['string', 'null'] },
          error: { type: ['string', 'null'] },
          artifactType: { type: 'string' },
          filename: { type: 'string' },
          contentType: { type: 'string' },
          recordVersionNumber: { type: ['integer', 'null'] },
          recordVersionPayloadHash: { type: ['string', 'null'] },
          reportSource: {
            anyOf: [
              { type: 'string', enum: ['canonical-version', 'diagnostic-live'] },
              { type: 'null' },
            ],
          },
          detailMode: {
            anyOf: [
              { type: 'string', enum: ['by-zone', 'by-electrical-hierarchy'] },
              { type: 'null' },
            ],
          },
          reportVariantKey: { type: ['string', 'null'] },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
  },
  preHandler: [authenticate],
};

async function statusHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(serializeJob(await loadAccessibleJob(request)));
}

const downloadRoute: RouteShorthandOptions = {
  schema: {
    tags: ['Export Jobs', 'EcoAudit PDF', 'SolarSense PDF', 'Field App Complete PDF'],
    summary: 'Download a completed export job',
    description: 'Streams a completed PDF or ZIP. Returns 409 while the export is still running.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string' } },
    },
  },
  preHandler: [authenticate],
};

async function downloadHandler(request: FastifyRequest, reply: FastifyReply) {
  const job = await loadAccessibleJob(request);
  if (job.status !== 'complete' || !job.storageKey) {
    return reply.status(409).send({ error: 'Export not ready', status: job.status });
  }
  const metadata = artifactMetadata(job);
  const size = await localFileSize(job.storageKey);
  const stream = await localFileStream(job.storageKey);
  return reply
    .header('Content-Disposition', exportArtifactContentDisposition(metadata.filename))
    .header('Content-Length', String(size))
    .header('Cache-Control', 'private, max-age=86400')
    .type(metadata.contentType)
    .send(stream);
}

export async function pdfJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/export/jobs/latest', {
    schema: {
      tags: ['Export Jobs'],
      summary: 'Get the latest export for an entity',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['entityId', 'artifactType'],
        properties: {
          entityId: { type: 'string' },
          artifactType: { type: 'string', enum: ['pdf', 'photos-zip'] },
          recordVersionNumber: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
          recordVersionPayloadHash: { type: 'string' },
          reportSource: { type: 'string', enum: ['canonical-version', 'diagnostic-live'] },
          reportSourceFilter: { type: 'string', enum: ['canonical-version', 'diagnostic-live'] },
          reportVariantKey: { type: 'string' },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const query = request.query as {
      entityId: string;
      artifactType: ExportArtifactType;
      recordVersionNumber?: unknown;
      recordVersionPayloadHash?: unknown;
      reportSource?: unknown;
      reportSourceFilter?: unknown;
      reportVariantKey?: unknown;
    };
    const { entityId, artifactType } = query;
    const expected = expectedReportProvenance(query);
    const conditions: SQL[] = [
      eq(pdfJobs.app, request.user.app),
      eq(pdfJobs.entityId, entityId),
      eq(pdfJobs.userId, request.user.userId),
    ];
    if (expected) {
      conditions.push(
        sql`${pdfJobs.params} ->> 'artifactType' = ${artifactType}`,
        sql`${pdfJobs.params} ->> 'recordVersionNumber' = ${String(expected.recordVersionNumber)}`,
        sql`${pdfJobs.params} ->> 'recordVersionPayloadHash' = ${expected.recordVersionPayloadHash}`,
        sql`${pdfJobs.params} ->> 'reportSource' = ${expected.reportSource}`,
      );
    }
    if (query.reportSourceFilter !== undefined) {
      if (
        query.reportSourceFilter !== 'canonical-version'
        && query.reportSourceFilter !== 'diagnostic-live'
      ) {
        throw badRequest('reportSourceFilter is invalid');
      }
      conditions.push(sql`${pdfJobs.params} ->> 'reportSource' = ${query.reportSourceFilter}`);
    }
    if (query.reportVariantKey !== undefined) {
      if (typeof query.reportVariantKey !== 'string' || !query.reportVariantKey.trim()) {
        throw badRequest('reportVariantKey must be a non-empty string');
      }
      conditions.push(sql`${pdfJobs.params} ->> 'reportVariantKey' = ${query.reportVariantKey}`);
    }
    const jobs = await db
      .select()
      .from(pdfJobs)
      .where(and(...conditions))
      .orderBy(desc(pdfJobs.createdAt))
      .limit(50);
    const job = jobs.find((candidate) => (
      artifactMetadata(candidate).artifactType === artifactType
      && (!expected || exportJobParamsMatchExpectedProvenance(candidate.params, expected))
      && (query.reportSourceFilter === undefined
        || exportJobParams(candidate.params).reportSource === query.reportSourceFilter)
      && (query.reportVariantKey === undefined
        || exportJobParamsMatchReportVariant(candidate.params, query.reportVariantKey as string))
    ));
    if (job) await assertJobAccess(job, request);
    return reply.send({ job: job ? serializeJob(job) : null });
  });

  app.get('/export/jobs/:jobId', statusRoute, statusHandler);
  app.get('/export/jobs/:jobId/download', downloadRoute, downloadHandler);

  // Backward compatibility for existing portal and mobile PDF clients.
  app.get('/pdf/jobs/:jobId', statusRoute, statusHandler);
  app.get('/pdf/jobs/:jobId/download', downloadRoute, downloadHandler);
}
