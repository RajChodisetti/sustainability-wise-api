import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authenticate } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { solarsenseRoutes } from './routes/solarsense/index.js';
import { AppError } from './utils/errors.js';
import { contentTypeForStorageKey, localFileSize, localFileStream } from './storage/localFiles.js';
import { config } from './config.js';

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: config.storage.maxUploadBytes });

  const bufferParser = (_request: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
    done(null, body);
  };
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, bufferParser);
  app.addContentTypeParser(/^image\/[\w.+-]+$/, { parseAs: 'buffer' }, bufferParser);

  // CORS — allow mobile apps from any origin
  await app.register(cors, { origin: true });

  // OpenAPI spec
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Sustainability Wise API',
        description: 'Unified API for EcoAudit Pro and SolarSense mobile applications',
        version: '1.0.0',
      },
      servers: [{ url: 'http://170.64.154.143', description: 'Production (Sydney)' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT or API Key',
          },
        },
      },
    },
  });

  // Swagger UI — served at /v1/docs (endpoints themselves are auth-protected)
  await app.register(swaggerUi, {
    routePrefix: '/v1/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // Global error handler
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: err.message,
        statusCode: err.statusCode,
        detail: err.detail,
      });
    }
    const fastifyErr = err as { statusCode?: number; message?: string };
    if (fastifyErr.statusCode === 400) {
      return reply.status(400).send({
        error: 'Bad request',
        statusCode: 400,
        detail: fastifyErr.message,
      });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
  });

  // Health check — public, no auth
  app.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check',
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'number' } } } },
    },
  }, async (_request, reply) => {
    return reply.send({ status: 'ok', uptime: Math.floor(process.uptime()) });
  });

  // Public-by-URL local file serving for VM-backed Phase 2 storage.
  app.get('/v1/files/*', {
    schema: {
      tags: ['Files'],
      summary: 'Download a locally stored file by storage key',
    },
  }, async (request, reply) => {
    const storageKey = (request.params as { '*': string })['*'];
    const size = await localFileSize(storageKey);
    return reply
      .header('Content-Length', String(size))
      .header('Cache-Control', 'private, max-age=86400')
      .type(contentTypeForStorageKey(storageKey))
      .send(localFileStream(storageKey));
  });

  // Route groups
  await app.register(authRoutes,   { prefix: '/v1/auth' });
  await app.register(apiKeyRoutes, { prefix: '/v1/api-keys' });

  // EcoAudit remains a placeholder until its server API phase is implemented.
  app.register(async () => {}, { prefix: '/v1/ecoaudit' });
  await app.register(solarsenseRoutes, { prefix: '/v1/solarsense' });

  return app;
}
