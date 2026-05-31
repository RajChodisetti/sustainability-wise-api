import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { ssUsers } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { hashPassword } from '../../auth/apiKey.js';
import { assertFound, assertSelfOrAdmin } from './helpers.js';
import { badRequest, conflict } from '../../utils/errors.js';

export async function solarsenseUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    schema: {
      tags: ['SolarSense Users'],
      summary: 'List SolarSense users',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (_request, reply) => {
    const users = await db
      .select({
        id: ssUsers.id,
        email: ssUsers.email,
        fullName: ssUsers.fullName,
        role: ssUsers.role,
        isActive: ssUsers.isActive,
        createdAt: ssUsers.createdAt,
        updatedAt: ssUsers.updatedAt,
      })
      .from(ssUsers)
      .orderBy(asc(ssUsers.createdAt));

    return reply.send({ data: users });
  });

  app.post('/', {
    schema: {
      tags: ['SolarSense Users'],
      summary: 'Create SolarSense user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as {
      email?: string;
      password?: string;
      fullName?: string | null;
      role?: 'admin' | 'inspector';
    };
    if (!body.email || !body.password) throw badRequest('email and password are required');
    const role = body.role ?? 'inspector';
    if (!['admin', 'inspector'].includes(role)) throw badRequest('role must be admin or inspector');

    const id = randomUUID();
    const passwordHash = await hashPassword(body.password);

    try {
      await db.insert(ssUsers).values({
        id,
        email: body.email.toLowerCase().trim(),
        passwordHash,
        fullName: body.fullName?.trim() || null,
        role,
      });
    } catch {
      throw conflict('Email already exists');
    }

    return reply.status(201).send({
      id,
      email: body.email.toLowerCase().trim(),
      fullName: body.fullName?.trim() || null,
      role,
      isActive: true,
    });
  });

  app.get('/:id', {
    schema: {
      tags: ['SolarSense Users'],
      summary: 'Get SolarSense user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    assertSelfOrAdmin(id, request.user);

    const [user] = await db
      .select({
        id: ssUsers.id,
        email: ssUsers.email,
        fullName: ssUsers.fullName,
        role: ssUsers.role,
        isActive: ssUsers.isActive,
        createdAt: ssUsers.createdAt,
        updatedAt: ssUsers.updatedAt,
      })
      .from(ssUsers)
      .where(eq(ssUsers.id, id));

    return reply.send(assertFound(user, 'User'));
  });

  app.patch('/:id', {
    schema: {
      tags: ['SolarSense Users'],
      summary: 'Update SolarSense user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      email?: string;
      fullName?: string | null;
      role?: 'admin' | 'inspector';
      isActive?: boolean;
    };

    const changes: Partial<typeof ssUsers.$inferInsert> = { updatedAt: new Date() };
    if (body.email !== undefined) changes.email = body.email.toLowerCase().trim();
    if (body.fullName !== undefined) changes.fullName = body.fullName?.trim() || null;
    if (body.role !== undefined) {
      if (!['admin', 'inspector'].includes(body.role)) throw badRequest('role must be admin or inspector');
      changes.role = body.role;
    }
    if (body.isActive !== undefined) changes.isActive = Boolean(body.isActive);

    const [updated] = await db
      .update(ssUsers)
      .set(changes)
      .where(eq(ssUsers.id, id))
      .returning({
        id: ssUsers.id,
        email: ssUsers.email,
        fullName: ssUsers.fullName,
        role: ssUsers.role,
        isActive: ssUsers.isActive,
        createdAt: ssUsers.createdAt,
        updatedAt: ssUsers.updatedAt,
      });

    return reply.send(assertFound(updated, 'User'));
  });

  app.delete('/:id', {
    schema: {
      tags: ['SolarSense Users'],
      summary: 'Deactivate SolarSense user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate, requireApp('solarsense'), requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await db
      .update(ssUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(ssUsers.id, id))
      .returning({ id: ssUsers.id });

    assertFound(updated, 'User');
    return reply.status(204).send();
  });
}
