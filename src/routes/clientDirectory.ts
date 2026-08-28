import type { FastifyInstance } from 'fastify';
import { authenticate, requireApp, requireRole } from '../auth/middleware.js';
import {
  listClientDirectory,
  suggestClientAndProviderAddresses,
} from '../services/clientSiteMemoryService.js';

type ProductApp = 'ecoaudit' | 'solarsense' | 'installhub';

/** Product-specific registration keeps exact app-token isolation on shared data. */
export function productClientDirectoryRoutes(productApp: ProductApp) {
  return async function registerProductClientDirectory(app: FastifyInstance): Promise<void> {
    const guards = [authenticate, requireApp(productApp), requireRole('inspector')];

    app.get('/client-directory', {
      schema: {
        tags: ['Client and address directory'],
        summary: 'Search company clients and their saved Australian sites',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 300 },
            clientId: { type: 'string', minLength: 1, maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
      preHandler: guards,
    }, async (request, reply) => {
      const query = request.query as { q?: string; clientId?: string; limit?: number };
      return reply.send({
        companyScope: 'current',
        clients: await listClientDirectory({
          query: query.q,
          clientId: query.clientId,
          limit: query.limit,
        }),
      });
    });

    app.post('/client-address-suggestions', {
      schema: {
        tags: ['Client and address directory'],
        summary: 'Return saved client addresses and Australian provider suggestions together',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            clientId: { type: 'string', minLength: 1, maxLength: 200 },
            query: { type: 'string', maxLength: 300 },
            postcode: { type: 'string', pattern: '^[0-9]{4}$' },
            limit: { type: 'integer', minimum: 1, maximum: 10 },
          },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: guards,
    }, async (request, reply) => {
      const body = (request.body ?? {}) as {
        clientId?: string;
        query?: string;
        postcode?: string;
        limit?: number;
      };
      return reply.send(await suggestClientAndProviderAddresses({
        clientId: body.clientId,
        query: body.query ?? '',
        postcode: body.postcode,
        limit: body.limit,
      }));
    });
  };
}
