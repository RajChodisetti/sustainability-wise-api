import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { config } from '../../config.js';
import { AppError, badRequest } from '../../utils/errors.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type TopologyBetaRouteOptions = {
  baseUrl?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ProxyResult = {
  status: number;
  payload: unknown;
};

function safeLocationId(value: string): string {
  const locationId = value.trim();
  if (!locationId || locationId.length > 200) {
    throw badRequest('A valid topology location ID is required.');
  }
  return locationId;
}

function safeDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function wattwatchersTopologyBetaRoutes(
  app: FastifyInstance,
  options: TopologyBetaRouteOptions,
): Promise<void> {
  const baseUrl = options.baseUrl ?? config.wattwatchersTopologyBeta.baseUrl;
  const requestTimeoutMs = options.requestTimeoutMs
    ?? config.wattwatchersTopologyBeta.requestTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const viewerGuards = [authenticate, requireApp('wattwatchers'), requireRole('viewer')];
  const adminGuards = [authenticate, requireApp('wattwatchers'), requireRole('admin')];

  async function proxyJson(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<ProxyResult> {
    if (!baseUrl) {
      throw new AppError(
        503,
        'Topology beta unavailable',
        'The topology reconstruction service is not configured for this environment.',
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new AppError(
        503,
        'Topology beta unavailable',
        'The topology reconstruction service could not be reached.',
      );
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new AppError(502, 'Invalid topology response', 'The topology response was too large.');
    }
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new AppError(
          502,
          'Invalid topology response',
          'The topology service returned invalid JSON.',
        );
      }
    }
    const status = response.status >= 500 ? 502 : response.status;
    return { status, payload };
  }

  function send(reply: FastifyReply, result: ProxyResult) {
    return reply.status(result.status).send(result.payload);
  }

  app.get('/sites', {
    schema: {
      tags: ['Wattwatchers Topology Beta'],
      security: [{ bearerAuth: [] }],
    },
    preHandler: viewerGuards,
  }, async (_request, reply) => send(reply, await proxyJson('GET', '/api/sites')));

  app.get('/sites/:locationId/topology', {
    schema: {
      tags: ['Wattwatchers Topology Beta'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { meters: { type: 'string', maxLength: 20_000 } },
      },
    },
    preHandler: viewerGuards,
  }, async (request, reply) => {
    const { locationId: rawLocationId } = request.params as { locationId: string };
    const { meters } = request.query as { meters?: string };
    const locationId = safeLocationId(rawLocationId);
    const query = meters ? `?${new URLSearchParams({ meters }).toString()}` : '';
    return send(
      reply,
      await proxyJson('GET', `/api/sites/${encodeURIComponent(locationId)}/topology${query}`),
    );
  });

  app.get('/reconstructions/:locationId', {
    schema: {
      tags: ['Wattwatchers Topology Beta'],
      security: [{ bearerAuth: [] }],
    },
    preHandler: viewerGuards,
  }, async (request, reply) => {
    const { locationId: rawLocationId } = request.params as { locationId: string };
    const locationId = safeLocationId(rawLocationId);
    return send(
      reply,
      await proxyJson('GET', `/api/reconstructions/${encodeURIComponent(locationId)}`),
    );
  });

  app.post('/reconstructions/start', {
    schema: {
      tags: ['Wattwatchers Topology Beta'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          locationId: { type: ['string', 'null'], maxLength: 200 },
          deviceIds: {
            type: 'array',
            maxItems: 200,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    preHandler: adminGuards,
  }, async (request, reply) => {
    const body = request.body as { locationId?: string | null; deviceIds?: unknown };
    const locationId = body.locationId?.trim() || null;
    const deviceIds = safeDeviceIds(body.deviceIds);
    if (!locationId && deviceIds.length === 0) {
      throw badRequest('Select a registered topology site or provide device IDs.');
    }
    return send(
      reply,
      await proxyJson('POST', '/api/reconstructions/start', { locationId, deviceIds }),
    );
  });

  app.post('/reconstructions/stop', {
    schema: {
      tags: ['Wattwatchers Topology Beta'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['locationId'],
        additionalProperties: false,
        properties: { locationId: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
    preHandler: adminGuards,
  }, async (request, reply) => {
    const { locationId: rawLocationId } = request.body as { locationId: string };
    const locationId = safeLocationId(rawLocationId);
    return send(
      reply,
      await proxyJson('POST', '/api/reconstructions/stop', { locationId }),
    );
  });
}
