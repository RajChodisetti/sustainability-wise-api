import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { wwClientCredentials, wwClients } from '../../db/schema/wattwatchers.js';
import {
  decryptWattwatchersClientKey,
  encryptWattwatchersClientKey,
} from '../../services/wattwatchersClientCredentialService.js';
import { forbidden, notFound } from '../../utils/errors.js';

export async function wattwatchersClientAdminRoutes(app: FastifyInstance): Promise<void> {
  const fleetAdmin = [authenticate, requireApp('wattwatchers'), requireRole('admin')];

  app.put('/:clientId/api-key', {
    schema: {
      tags: ['Wattwatchers Clients'],
      summary: 'Create or replace a client Wattwatchers API key',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['apiKey'],
        additionalProperties: false,
        properties: { apiKey: { type: 'string', minLength: 8, maxLength: 4096 } },
      },
    },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const { apiKey } = request.body as { apiKey: string };
    const [client] = await db.select({ id: wwClients.id }).from(wwClients)
      .where(eq(wwClients.id, clientId)).limit(1);
    if (!client) throw notFound('Fleet client');
    const encrypted = encryptWattwatchersClientKey(clientId, apiKey);
    const now = new Date();
    await db.insert(wwClientCredentials).values({
      clientId,
      ...encrypted,
      updatedByUserId: request.user.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: wwClientCredentials.clientId,
      set: {
        ...encrypted,
        updatedByUserId: request.user.userId,
        updatedAt: now,
      },
    });
    return reply.send({ clientId, apiKeyConfigured: true, apiKeyUpdatedAt: now });
  });

  app.delete('/:clientId/api-key', {
    schema: {
      tags: ['Wattwatchers Clients'],
      summary: 'Remove a client Wattwatchers API key',
      security: [{ bearerAuth: [] }],
    },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const [client] = await db.select({ id: wwClients.id }).from(wwClients)
      .where(eq(wwClients.id, clientId)).limit(1);
    if (!client) throw notFound('Fleet client');
    await db.delete(wwClientCredentials).where(eq(wwClientCredentials.clientId, clientId));
    return reply.status(204).send();
  });

  app.get('/collector/configured', {
    schema: {
      tags: ['Wattwatchers Clients'],
      summary: 'List configured client credentials for the Fleet collector',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('wattwatchers'), requireRole('service_account')],
  }, async (request, reply) => {
    // Human admins may manage key presence but can never retrieve a stored key.
    if (request.user.role !== 'service_account') {
      throw forbidden('Only the Fleet collector can retrieve client credentials');
    }
    const rows = await db.select({
      id: wwClients.id,
      code: wwClients.code,
      name: wwClients.name,
      isMaas: wwClients.isMaas,
      ciphertext: wwClientCredentials.ciphertext,
      iv: wwClientCredentials.iv,
      authTag: wwClientCredentials.authTag,
      keyVersion: wwClientCredentials.keyVersion,
    }).from(wwClientCredentials).innerJoin(
      wwClients,
      eq(wwClients.id, wwClientCredentials.clientId),
    ).where(eq(wwClients.isActive, true));
    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        isMaas: row.isMaas,
        apiKey: decryptWattwatchersClientKey(row.id, row),
      })),
    });
  });
}
