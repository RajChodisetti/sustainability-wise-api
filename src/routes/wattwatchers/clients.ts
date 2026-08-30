import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
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
  const fleetCollector = [authenticate, requireApp('wattwatchers'), requireRole('service_account')];

  function requireCollector(request: { user: { role: string } }): void {
    // Admin outranks service_account in the generic role hierarchy, so this
    // explicit check keeps plaintext credentials collector-only.
    if (request.user.role !== 'service_account') {
      throw forbidden('Only the Fleet collector can manage collector credentials');
    }
  }

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

  app.post('/collector/bootstrap', {
    schema: {
      tags: ['Wattwatchers Clients'],
      summary: 'Store legacy collector credentials that are missing from the database',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['clients'],
        additionalProperties: false,
        properties: {
          clients: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: {
              type: 'object',
              required: ['code', 'name', 'isMaas', 'apiKey'],
              additionalProperties: false,
              properties: {
                code: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z0-9._-]+$' },
                name: { type: 'string', minLength: 1, maxLength: 200 },
                isMaas: { type: 'boolean' },
                apiKey: { type: 'string', minLength: 8, maxLength: 4096 },
              },
            },
          },
        },
      },
    },
    preHandler: fleetCollector,
  }, async (request, reply) => {
    requireCollector(request);
    const { clients } = request.body as {
      clients: Array<{ code: string; name: string; isMaas: boolean; apiKey: string }>;
    };
    const result = await db.transaction(async (tx) => {
      let inserted = 0;
      let alreadyConfigured = 0;
      for (const input of clients) {
        const code = input.code.trim().toLowerCase();
        const name = input.name.trim();
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'wattwatchers-client:' + code}))`);
        let [client] = await tx.select({ id: wwClients.id }).from(wwClients)
          .where(eq(wwClients.code, code)).limit(1);
        if (!client) {
          [client] = await tx.insert(wwClients).values({
            id: randomUUID(),
            code,
            name,
            normalizedName: name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
            isMaas: input.isMaas,
          }).returning({ id: wwClients.id });
        }
        const [existing] = await tx.select({ clientId: wwClientCredentials.clientId })
          .from(wwClientCredentials)
          .where(eq(wwClientCredentials.clientId, client.id)).limit(1);
        if (existing) {
          alreadyConfigured += 1;
          continue;
        }
        const now = new Date();
        const encrypted = encryptWattwatchersClientKey(client.id, input.apiKey);
        const created = await tx.insert(wwClientCredentials).values({
          clientId: client.id,
          ...encrypted,
          updatedByUserId: request.user.userId,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing({ target: wwClientCredentials.clientId })
          .returning({ clientId: wwClientCredentials.clientId });
        if (created.length > 0) inserted += 1;
        else alreadyConfigured += 1;
      }
      return { inserted, alreadyConfigured };
    });
    return reply.send(result);
  });

  app.get('/collector/configured', {
    schema: {
      tags: ['Wattwatchers Clients'],
      summary: 'List configured client credentials for the Fleet collector',
      security: [{ bearerAuth: [] }],
    },
    preHandler: fleetCollector,
  }, async (request, reply) => {
    requireCollector(request);
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
