import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { solarsenseRoutes } from './routes/solarsense/index.js';
import { ecoauditRoutes } from './routes/ecoaudit/index.js';
import { wattwatchersRoutes } from './routes/wattwatchers/index.js';
import { installhubRoutes } from './routes/installhub/index.js';
import { portalUserRoutes } from './routes/portal/users.js';
import { portalSchedulerRoutes } from './routes/portal/scheduler.js';
import { storageBrowserRoutes } from './routes/storageBrowser.js';
import { pdfJobRoutes } from './routes/pdfJobs.js';
import { thumbnailRoutes } from './routes/thumbnails.js';
import { fileRoutes } from './routes/files.js';
import { notificationRoutes } from './routes/notifications.js';
import { AppError } from './utils/errors.js';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistRoot = join(__dirname, '..', 'web', 'dist');

const EXPO_PUSH_TOKEN_IN_LOG = /(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]/g;

export function redactSensitiveLogText(value: string): string {
  return value.replace(EXPO_PUSH_TOKEN_IN_LOG, '[REDACTED_EXPO_PUSH_TOKEN]');
}

const tagMap: Record<string, string> = {
  'SolarSense Users': 'SolarSense / Users',
  'SolarSense Sites': 'SolarSense / Sites',
  'SolarSense Assessments': 'SolarSense / Assessments',
  'SolarSense Photos': 'SolarSense / Photos',
  'SolarSense Sync': 'SolarSense / Sync',
  'SolarSense PDF': 'SolarSense / PDF',
  'EcoAudit Users': 'EcoAudit / Users',
  'EcoAudit Audits': 'EcoAudit / Audits',
  'EcoAudit Zones': 'EcoAudit / Zones',
  'EcoAudit Equipment': 'EcoAudit / Equipment',
  'EcoAudit Photos': 'EcoAudit / Photos',
  'EcoAudit Sync': 'EcoAudit / Sync',
  'EcoAudit PDF': 'EcoAudit / PDF',
  'Field App Complete Users': 'Field App Complete / Users',
  'Field App Complete Installations': 'Field App Complete / Installations',
  'Field App Complete Sync': 'Field App Complete / Sync',
  'Field App Complete PDF': 'Field App Complete / PDF',
  'Wattwatchers Users': 'Wattwatchers / Users',
  'Wattwatchers Dashboard': 'Wattwatchers / Dashboard',
  'Wattwatchers Devices': 'Wattwatchers / Devices',
  'Wattwatchers Clients': 'Wattwatchers / Clients',
  'Wattwatchers Runs': 'Wattwatchers / Runs',
  'Wattwatchers Reports': 'Wattwatchers / Reports',
  'Wattwatchers Ingest': 'Wattwatchers / Ingest',
  'Portal Users': 'Portal / Users',
  'Portal Scheduler': 'Portal / Scheduler',
  Notifications: 'Notifications',
};

const orderedTags = [
  { name: 'Auth', description: 'JWT login, refresh, self-registration, and current-user endpoints.' },
  { name: 'API Keys', description: 'Admin-managed API keys for service accounts and integrations.' },
  { name: 'SolarSense / Users', description: 'SolarSense user administration.' },
  { name: 'SolarSense / Sites', description: 'SolarSense site records.' },
  { name: 'SolarSense / Assessments', description: 'SolarSense rooftop assessment records.' },
  { name: 'SolarSense / Photos', description: 'SolarSense synced photo listing, export, and deletion.' },
  { name: 'SolarSense / Sync', description: 'SolarSense mobile sync and photo upload endpoints.' },
  { name: 'SolarSense / PDF', description: 'SolarSense server-side site pack generation.' },
  { name: 'EcoAudit / Users', description: 'EcoAudit Pro user administration.' },
  { name: 'EcoAudit / Audits', description: 'EcoAudit Pro audit records.' },
  { name: 'EcoAudit / Zones', description: 'EcoAudit Pro audit zones.' },
  { name: 'EcoAudit / Equipment', description: 'EcoAudit Pro equipment CRUD across all equipment types.' },
  { name: 'EcoAudit / Photos', description: 'EcoAudit Pro synced photo listing, export, and deletion.' },
  { name: 'EcoAudit / Sync', description: 'EcoAudit Pro mobile sync and photo upload endpoints.' },
  { name: 'EcoAudit / PDF', description: 'EcoAudit Pro server-side report generation.' },
  { name: 'Field App Complete / Users', description: 'Field App Complete user administration and password management.' },
  { name: 'Field App Complete / Installations', description: 'Field App Complete installation ownership and shared-access controls.' },
  { name: 'Field App Complete / Sync', description: 'Field App Complete mobile metadata and evidence backup.' },
  { name: 'Field App Complete / PDF', description: 'Field App Complete server-side form and installation-pack generation.' },
  { name: 'Wattwatchers / Users', description: 'Independent Wattwatchers Fleet portal access.' },
  { name: 'Wattwatchers / Dashboard', description: 'Fleet connectivity summaries and trends.' },
  { name: 'Wattwatchers / Devices', description: 'Current device state, history, and outages.' },
  { name: 'Wattwatchers / Clients', description: 'Client and MaaS-scoped fleet health.' },
  { name: 'Wattwatchers / Runs', description: 'Collector run history and diagnostics.' },
  { name: 'Wattwatchers / Reports', description: 'Daily Fleet reports and safe CSV exports.' },
  { name: 'Wattwatchers / Ingest', description: 'Idempotent service-account collector ingestion.' },
  { name: 'Portal / Users', description: 'Unified EcoAudit, SolarSense, and Field App Complete user directory.' },
  { name: 'Portal / Scheduler', description: 'Portal work calendar: assignments, deadlines, and custom jobs.' },
  { name: 'Notifications', description: 'App-scoped mobile push destination registration.' },
  { name: 'PDF Jobs', description: 'Async PDF job status polling and download.' },
  { name: 'Files', description: 'Stored photo and generated PDF downloads.' },
  { name: 'System', description: 'Public operational checks.' },
];

function isPublicDocsAsset(path: string): boolean {
  return path.includes('/static/');
}

async function docsAuthPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawUrl = request.raw.url ?? '';
  if (isPublicDocsAsset(rawUrl)) return;

  await authenticate(request, reply);
}

export function operationSummary(method: string, path: string): string {
  const normalized = path
    .replace(/^\/v1\//, '')
    .replace(/[{}]/g, '')
    .replace(/[/-]+/g, ' ')
    .trim();
  const displayName = normalized.replace(
    /^installhub(?=\s|$)/,
    'Field App Complete',
  );
  return `${method.toUpperCase()} ${displayName || path}`;
}

function isPublicOperation(path: string): boolean {
  return path === '/health'
    || path.startsWith('/v1/files/')
    || path.includes('/sync/upload/')
    || path === '/v1/auth/login'
    || path === '/v1/auth/portal-login'
    || path === '/v1/auth/refresh'
    || path === '/v1/auth/logout'
    || path === '/v1/auth/register'
    || path === '/v1/auth/bootstrap-local';
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
      },
    },
  };
}

function apiNotFoundResponse(path: string) {
  return {
    error: `Route ${path} not found`,
    statusCode: 404,
  };
}

function binaryRequestBody(contentTypes: string[]) {
  return {
    required: true,
    content: Object.fromEntries(contentTypes.map((contentType) => [contentType, {
      schema: { type: 'string', format: 'binary' },
    }])),
  };
}

function defaultRequestBody(path: string) {
  if (path.endsWith('/portal/scheduler/expenses/{expenseId}/attachments')) {
    return binaryRequestBody([
      'application/octet-stream',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  }
  if (path.includes('/sync/upload/')) {
    return binaryRequestBody(['application/octet-stream']);
  }

  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  };
}

export function completeOpenApiDocument(
  swaggerObject: Readonly<Record<string, any>>,
): Record<string, any> {
  const doc = swaggerObject as Record<string, any>;
  doc.tags = orderedTags;
  doc.components ??= {};
  doc.components.schemas ??= {};
  doc.components.schemas.Error = {
    type: 'object',
    required: ['error', 'statusCode'],
    properties: {
      error: { type: 'string' },
      statusCode: { type: 'integer' },
      detail: {},
    },
  };
  doc.components.schemas.Ok = {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  };

  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  for (const [path, pathItem] of Object.entries((doc.paths ?? {}) as Record<string, any>)) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!methods.has(method) || !operation || typeof operation !== 'object') continue;

      operation.tags = (operation.tags?.length ? operation.tags : ['System'])
        .map((tag: string) => tagMap[tag] ?? tag);
      operation.summary ||= operationSummary(method, path);
      operation.description ||= operation.summary;

      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const existingPathParams = new Set(
        parameters.filter((parameter: any) => parameter?.in === 'path').map((parameter: any) => parameter.name),
      );
      for (const match of path.matchAll(/{([^}]+)}/g)) {
        const name = match[1];
        if (!existingPathParams.has(name)) {
          parameters.push({
            name,
            in: 'path',
            required: true,
            schema: { type: 'string' },
          });
        }
      }
      if (parameters.length > 0) operation.parameters = parameters;

      if (['post', 'put', 'patch'].includes(method) && !operation.requestBody) {
        operation.requestBody = defaultRequestBody(path);
      }

      const publicOperation = isPublicOperation(path);
      if (!publicOperation && !operation.security) {
        operation.security = [{ bearerAuth: [] }];
      }

      operation.responses ??= {};
      if (Object.keys(operation.responses).length === 0) {
        operation.responses[method === 'delete' ? '204' : '200'] = {
          description: method === 'delete' ? 'Deleted' : 'Successful response',
        };
      }
      operation.responses['400'] ??= errorResponse('Bad request');
      operation.responses['404'] ??= errorResponse('Not found');
      operation.responses['500'] ??= errorResponse('Internal server error');
      if (!publicOperation) {
        operation.responses['401'] ??= errorResponse('Unauthorized');
        operation.responses['403'] ??= errorResponse('Forbidden');
      }
    }
  }

  return doc;
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      // Capability signatures are bearer credentials. Strip every query string
      // from request logs so signed upload/download URLs cannot leak to log
      // aggregation, support exports, or crash reports.
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url?.split('?', 1)[0],
            host: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
    bodyLimit: config.storage.maxUploadBytes,
  });

  const bufferParser = (_request: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
    done(null, body);
  };
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, bufferParser);
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, bufferParser);
  app.addContentTypeParser(/^image\/[\w.+-]+$/, { parseAs: 'buffer' }, bufferParser);

  await app.register(helmet, {
    contentSecurityPolicy: config.enableApiDocs ? false : undefined,
  });
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  });
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
  });

  // OpenAPI spec
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Sustainability Wise API',
        description: 'Unified API for EcoAudit Pro, SolarSense, Field App Complete, and Wattwatchers Fleet operations',
        version: '1.0.0',
      },
      servers: [{ url: config.publicBaseUrl, description: 'Configured API base URL' }],
      tags: orderedTags,
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

  if (config.enableApiDocs) {
    // Swagger UI is disabled by default in production. Do not pass tokens in URLs.
    await app.register(swaggerUi, {
      routePrefix: '/v1/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      transformSpecification: completeOpenApiDocument,
      uiHooks: config.protectApiDocs
        ? {
            preHandler: docsAuthPreHandler,
          }
        : undefined,
    });
  }

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
    if (
      typeof fastifyErr.statusCode === 'number'
      && fastifyErr.statusCode >= 400
      && fastifyErr.statusCode < 500
    ) {
      return reply.status(fastifyErr.statusCode).send({
        error: fastifyErr.statusCode === 400 ? 'Bad request' : fastifyErr.message,
        statusCode: fastifyErr.statusCode,
        detail: fastifyErr.message,
      });
    }
    // Drizzle query errors include bound parameters in their message. Push
    // registration parameters contain the Expo token, so never hand an
    // unhandled Error (including its cause/query params) directly to Pino.
    const unknownError = err as { name?: unknown; message?: unknown };
    app.log.error({
      errorName: typeof unknownError.name === 'string' ? unknownError.name : 'Error',
      errorMessage: redactSensitiveLogText(
        typeof unknownError.message === 'string' ? unknownError.message : 'Unhandled error',
      ),
    }, 'Unhandled request error');
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

  // Route groups
  await app.register(authRoutes,   { prefix: '/v1/auth' });
  await app.register(apiKeyRoutes, { prefix: '/v1/api-keys' });
  await app.register(fileRoutes);
  await app.register(notificationRoutes, { prefix: '/v1' });
  await app.register(storageBrowserRoutes);
  await app.register(thumbnailRoutes);

  await app.register(ecoauditRoutes, { prefix: '/v1/ecoaudit' });
  await app.register(solarsenseRoutes, { prefix: '/v1/solarsense' });
  await app.register(wattwatchersRoutes, { prefix: '/v1/wattwatchers' });
  await app.register(installhubRoutes, { prefix: '/v1/installhub' });
  await app.register(portalUserRoutes, { prefix: '/v1/portal' });
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.register(pdfJobRoutes, { prefix: '/v1' });

  if (existsSync(webDistRoot)) {
    await app.register(staticPlugin, {
      root: webDistRoot,
      prefix: '/',
      wildcard: false,
      maxAge: '30d',
      immutable: true,
    });

    app.setNotFoundHandler((request, reply) => {
      const requestPath = new URL(request.url, 'http://localhost').pathname;
      if (requestPath === '/health' || requestPath.startsWith('/v1/')) {
        return reply.status(404).send(apiNotFoundResponse(requestPath));
      }

      return reply
        .type('text/html; charset=utf-8')
        .sendFile('index.html', { maxAge: 0, immutable: false });
    });
  }

  return app;
}
