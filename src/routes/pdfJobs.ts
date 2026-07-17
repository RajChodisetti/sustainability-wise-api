import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pdfJobs } from '../db/schema/shared.js';
import { authenticate } from '../auth/middleware.js';
import { forbidden, notFound } from '../utils/errors.js';
import { localFileSize, localFileStream } from '../storage/localFiles.js';

export async function pdfJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pdf/jobs/:jobId', {
    schema: {
      tags: ['EcoAudit PDF', 'SolarSense PDF'],
      summary: 'Get PDF job status',
      description: 'Poll this endpoint after starting an async PDF job to check progress and retrieve the PDF URL when complete.',
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
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };
    const [job] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, jobId));
    if (!job) throw notFound('PDF job');
    if (job.app !== request.user.app) throw forbidden('PDF job belongs to another application');
    if (job.userId !== request.user.userId && request.user.role !== 'admin') {
      throw forbidden('PDF job belongs to another user');
    }
    return reply.send({
      id: job.id,
      status: job.status,
      phase: job.phase,
      progressCurrent: job.progressCurrent,
      progressTotal: job.progressTotal,
      pdfUrl: job.pdfUrl,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  });

  app.get('/pdf/jobs/:jobId/download', {
    schema: {
      tags: ['EcoAudit PDF', 'SolarSense PDF'],
      summary: 'Download PDF from a completed job',
      description: 'Streams the generated PDF for a completed job. Returns 409 if the job is not yet complete.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['jobId'],
        properties: { jobId: { type: 'string' } },
      },
    },
    preHandler: [authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };
    const [job] = await db.select().from(pdfJobs).where(eq(pdfJobs.id, jobId));
    if (!job) throw notFound('PDF job');
    if (job.app !== request.user.app) throw forbidden('PDF job belongs to another application');
    if (job.userId !== request.user.userId && request.user.role !== 'admin') {
      throw forbidden('PDF job belongs to another user');
    }
    if (job.status !== 'complete' || !job.storageKey) {
      return reply.status(409).send({ error: 'PDF not ready', status: job.status });
    }
    const size = await localFileSize(job.storageKey);
    const stream = await localFileStream(job.storageKey);
    return reply
      .header('Content-Disposition', `attachment; filename="report-${jobId}.pdf"`)
      .header('Content-Length', String(size))
      .header('Cache-Control', 'private, max-age=86400')
      .type('application/pdf')
      .send(stream);
  });
}
