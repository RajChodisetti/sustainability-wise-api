import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import {
  deregisterPushDevice,
  registerPushDevice,
} from '../services/schedulerNotificationService.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { deviceId: string } }>('/notifications/devices/:deviceId', {
    schema: {
      tags: ['Notifications'],
      summary: 'Register this signed-in user’s app-scoped Expo push destination',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['expoPushToken', 'platform', 'projectId', 'registrationGeneration'],
        properties: {
          expoPushToken: { type: 'string', minLength: 1, maxLength: 256 },
          platform: { type: 'string', enum: ['ios', 'android'] },
          projectId: { type: 'string', minLength: 1, maxLength: 200 },
          registrationGeneration: {
            type: 'integer',
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const body = request.body as {
      expoPushToken: string;
      platform: 'ios' | 'android';
      projectId: string;
      registrationGeneration: number;
    };
    const device = await registerPushDevice(request.user, request.params.deviceId, body);
    return reply.send(device);
  });

  app.delete<{
    Params: { deviceId: string };
    Querystring: { registrationGeneration: number };
  }>('/notifications/devices/:deviceId', {
    schema: {
      tags: ['Notifications'],
      summary: 'Disable this signed-in user’s app-scoped push destination on logout',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['registrationGeneration'],
        properties: {
          registrationGeneration: {
            type: 'integer',
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    await deregisterPushDevice(
      request.user,
      request.params.deviceId,
      request.query.registrationGeneration,
    );
    return reply.status(204).send();
  });
}
