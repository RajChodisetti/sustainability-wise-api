import type { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema/shared.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { generateKey } from '../auth/apiKey.js';
import { notFound, forbidden } from '../utils/errors.js';

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/api-keys — list non-revoked keys for caller's app
  app.get('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'List API keys for your app',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { app: callerApp } = request.user;
    const keys = await db
      .select({
        id:              apiKeys.id,
        name:            apiKeys.name,
        prefix:          apiKeys.prefix,
        role:            apiKeys.role,
        createdByUserId: apiKeys.createdByUserId,
        lastUsedAt:      apiKeys.lastUsedAt,
        expiresAt:       apiKeys.expiresAt,
        createdAt:       apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.app, callerApp), isNull(apiKeys.revokedAt)));

    return reply.send({ data: keys });
  });

  // POST /v1/api-keys — create a new key (raw shown once)
  app.post('/', {
    schema: {
      tags: ['API Keys'],
      summary: 'Create API key — raw value shown once only',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          role: { type: 'string', enum: ['inspector', 'service_account', 'admin'], default: 'service_account' },
        },
      },
    },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { name, role = 'service_account' } = request.body as { name: string; role?: string };
    const { app: callerApp, userId } = request.user;

    const { raw, prefix, hashed } = generateKey(callerApp);
    const hashedKey = await hashed;
    const id = randomUUID();

    await db.insert(apiKeys).values({
      id,
      name,
      hashedKey,
      prefix,
      app: callerApp,
      role,
      createdByUserId: userId,
    });

    // Return raw key — only time it is ever shown
    return reply.status(201).send({ id, name, role, app: callerApp, key: raw });
  });

  // DELETE /v1/api-keys/:id — revoke a key
  app.delete('/:id', {
    schema: {
      tags: ['API Keys'],
      summary: 'Revoke an API key',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { app: callerApp } = request.user;

    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.app, callerApp), isNull(apiKeys.revokedAt)));

    if (!key) throw notFound('API key');

    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));

    return reply.status(200).send({ ok: true });
  });
}
