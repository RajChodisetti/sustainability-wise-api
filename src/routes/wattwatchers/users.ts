import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { wwUsers } from '../../db/schema/wattwatchers.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/apiKey.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../utils/errors.js';
import { adminRemovalGuard } from './userLogic.js';

const publicColumns = {
  id: wwUsers.id,
  email: wwUsers.email,
  fullName: wwUsers.fullName,
  role: wwUsers.role,
  isActive: wwUsers.isActive,
  createdAt: wwUsers.createdAt,
  updatedAt: wwUsers.updatedAt,
};

function normalizeEmail(value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safeUsername}@wattwatchers.users.local`;
}

function assertHumanRole(value: unknown): 'viewer' | 'admin' {
  if (value === 'viewer' || value === 'admin') return value;
  throw badRequest('role must be viewer or admin');
}

export async function wattwatchersUserRoutes(app: FastifyInstance): Promise<void> {
  const fleetUser = [authenticate, requireApp('wattwatchers'), requireRole('viewer')];
  const fleetAdmin = [authenticate, requireApp('wattwatchers'), requireRole('admin')];

  app.get('/', {
    schema: { tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }] },
    preHandler: fleetAdmin,
  }, async (_request, reply) => {
    const users = await db.select(publicColumns).from(wwUsers).orderBy(asc(wwUsers.createdAt));
    return reply.send({ data: users });
  });

  app.post('/', {
    schema: {
      tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['email', 'password'], additionalProperties: false,
        properties: {
          id: { type: 'string' }, email: { type: 'string', minLength: 1, maxLength: 320 },
          password: { type: 'string', minLength: 8, maxLength: 1024 },
          fullName: { type: ['string', 'null'], maxLength: 200 },
          role: { type: 'string', enum: ['viewer', 'admin'] },
        },
      },
    },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const body = request.body as { id?: string; email: string; password: string; fullName?: string | null; role?: string };
    if (body.password.length < 8) throw badRequest('password must be at least 8 characters');
    const email = normalizeEmail(body.email);
    try {
      const [created] = await db.insert(wwUsers).values({
        id: body.id?.trim() || randomUUID(),
        email,
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName?.trim() || null,
        role: body.role === undefined ? 'viewer' : assertHumanRole(body.role),
      }).returning(publicColumns);
      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.get('/:id', {
    schema: { tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }] },
    preHandler: fleetUser,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.user.role !== 'admin' && request.user.userId !== id) throw forbidden('Cannot access another user');
    const [user] = await db.select(publicColumns).from(wwUsers).where(eq(wwUsers.id, id));
    if (!user) throw notFound('User');
    return reply.send(user);
  });

  app.patch('/:id', {
    schema: { tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }] },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { email?: string; fullName?: string | null; role?: string; isActive?: boolean };
    try {
      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wattwatchers-user-admins'))`);
        const [current] = await tx.select().from(wwUsers).where(eq(wwUsers.id, id));
        if (!current) throw notFound('User');
        const nextRole = body.role === undefined ? current.role : assertHumanRole(body.role);
        const nextIsActive = body.isActive === undefined ? current.isActive : Boolean(body.isActive);
        const [adminCount] = await tx.select({
          count: sql<number>`count(*)::int`,
        }).from(wwUsers).where(sql`${wwUsers.role} = 'admin' and ${wwUsers.isActive} = true`);
        const guard = adminRemovalGuard({
          actorId: request.user.userId,
          targetId: id,
          currentRole: current.role,
          currentIsActive: current.isActive,
          nextRole,
          nextIsActive,
          activeAdminCount: adminCount?.count ?? 0,
        });
        if (guard === 'self') throw badRequest('Cannot demote or deactivate your own account');
        if (guard === 'last_admin') throw conflict('Cannot remove the last active Wattwatchers administrator');

        const changes: Partial<typeof wwUsers.$inferInsert> = { updatedAt: new Date() };
        if (body.email !== undefined) changes.email = normalizeEmail(body.email);
        if (body.fullName !== undefined) changes.fullName = body.fullName?.trim() || null;
        if (body.role !== undefined) changes.role = nextRole;
        if (body.isActive !== undefined) changes.isActive = nextIsActive;
        const [result] = await tx.update(wwUsers).set(changes)
          .where(eq(wwUsers.id, id)).returning(publicColumns);
        return result;
      });
      return reply.send(updated);
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.patch('/:id/password', {
    schema: {
      tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['currentPassword', 'newPassword'], additionalProperties: false,
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
          newPassword: { type: 'string', minLength: 8, maxLength: 1024 },
        },
      },
    },
    preHandler: fleetUser,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.user.role !== 'admin' && request.user.userId !== id) throw forbidden('Cannot access another user');
    const body = request.body as { currentPassword: string; newPassword: string };
    if (body.newPassword.length < 8) throw badRequest('newPassword must be at least 8 characters');
    const [user] = await db.select().from(wwUsers).where(eq(wwUsers.id, id));
    if (!user) throw notFound('User');
    if (!await verifyPassword(body.currentPassword, user.passwordHash)) {
      throw unauthorized('Current password is incorrect');
    }
    await db.update(wwUsers).set({
      passwordHash: await hashPassword(body.newPassword), updatedAt: new Date(),
    }).where(eq(wwUsers.id, id));
    return reply.send({ ok: true });
  });

  app.delete('/:id', {
    schema: { tags: ['Wattwatchers Users'], security: [{ bearerAuth: [] }] },
    preHandler: fleetAdmin,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.userId) throw badRequest('Cannot deactivate your own account');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wattwatchers-user-admins'))`);
      const [current] = await tx.select().from(wwUsers).where(eq(wwUsers.id, id));
      if (!current) throw notFound('User');
      const [adminCount] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(wwUsers).where(sql`${wwUsers.role} = 'admin' and ${wwUsers.isActive} = true`);
      const guard = adminRemovalGuard({
        actorId: request.user.userId,
        targetId: id,
        currentRole: current.role,
        currentIsActive: current.isActive,
        nextRole: current.role,
        nextIsActive: false,
        activeAdminCount: adminCount?.count ?? 0,
      });
      if (guard === 'last_admin') throw conflict('Cannot remove the last active Wattwatchers administrator');
      await tx.update(wwUsers).set({ isActive: false, updatedAt: new Date() })
        .where(eq(wwUsers.id, id));
    });
    return reply.status(204).send();
  });
}
