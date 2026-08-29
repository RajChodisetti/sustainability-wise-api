import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { getSchedulerRouteSuggestion } from '../../services/schedulerRouteService.js';
import { badRequest, forbidden } from '../../utils/errors.js';

export async function rejectInstallHubRouteAssignee(request: FastifyRequest): Promise<void> {
  if (
    request.body
    && typeof request.body === 'object'
    && !Array.isArray(request.body)
    && Object.hasOwn(request.body, 'assigneeFieldUserId')
  ) {
    throw badRequest('assigneeFieldUserId is not accepted on the self-only Field route');
  }
}

export async function requireInstallHubRouteJwt(request: FastifyRequest): Promise<void> {
  if (
    request.user.authType !== 'jwt'
    || (request.user.role !== 'inspector' && request.user.role !== 'admin')
  ) {
    throw forbidden('field_route_human_jwt_required');
  }
}

export async function installhubRouteSuggestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/route-suggestions', {
    schema: {
      tags: ['Field App Complete Routing'],
      summary: 'Suggest the shortest route through the signed-in Field user’s scheduled jobs',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['date'],
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          startingAddress: { type: 'string', minLength: 3, maxLength: 300 },
          currentLocation: {
            type: 'object',
            additionalProperties: false,
            required: ['latitude', 'longitude'],
            properties: {
              latitude: { type: 'number', minimum: -44, maximum: -9 },
              longitude: { type: 'number', minimum: 112, maximum: 154 },
              accuracyMeters: { type: 'number', minimum: 0, maximum: 100000 },
              capturedAt: { type: 'string' },
            },
          },
        },
        oneOf: [
          { required: ['currentLocation'], not: { required: ['startingAddress'] } },
          { required: ['startingAddress'], not: { required: ['currentLocation'] } },
        ],
      },
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    // Fastify removes additional JSON properties during schema validation by
    // default. Reject this privilege-bearing field before that normalization so
    // clients cannot mistake a team-route request for a successful self route.
    preValidation: [
      authenticate,
      requireApp('installhub'),
      requireRole('inspector'),
      requireInstallHubRouteJwt,
      rejectInstallHubRouteAssignee,
    ],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    return reply.send(await getSchedulerRouteSuggestion(request.user, {
      date: body.date,
      currentLocation: body.currentLocation,
      startingAddress: body.startingAddress,
    }));
  });
}
