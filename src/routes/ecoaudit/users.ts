import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eaUsers } from '../../db/schema/ecoaudit.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/apiKey.js';
import { assertFound, assertSelfOrAdmin } from './helpers.js';
import { badRequest, conflict, unauthorized } from '../../utils/errors.js';

export async function eaUserRoutes(app: FastifyInstance): Promise<void> {
  const cols = {
    id: eaUsers.id, email: eaUsers.email, fullName: eaUsers.fullName,
    role: eaUsers.role, isActive: eaUsers.isActive,
    createdAt: eaUsers.createdAt, updatedAt: eaUsers.updatedAt,
  };

  app.get('/', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (_request, reply) => {
    const users = await db.select(cols).from(eaUsers).orderBy(asc(eaUsers.createdAt));
    return reply.send({ data: users });
  });

  app.post('/', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as { id?: string; email?: string; password?: string; fullName?: string | null; role?: string };
    if (!body.email || !body.password) throw badRequest('email and password are required');
    const role = body.role ?? 'inspector';
    if (!['admin', 'inspector'].includes(role)) throw badRequest('role must be admin or inspector');
    const id = body.id?.trim() || randomUUID();
    const passwordHash = await hashPassword(body.password);
    try {
      await db.insert(eaUsers).values({ id, email: body.email.toLowerCase().trim(), passwordHash, fullName: body.fullName?.trim() || null, role });
    } catch { throw conflict('Email already exists'); }
    return reply.status(201).send({ id, email: body.email.toLowerCase().trim(), fullName: body.fullName?.trim() || null, role, isActive: true });
  });

  app.get('/:id', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    assertSelfOrAdmin(id, request.user);
    const [user] = await db.select(cols).from(eaUsers).where(eq(eaUsers.id, id));
    return reply.send(assertFound(user, 'User'));
  });

  app.patch('/:id', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { email?: string; fullName?: string | null; role?: string; isActive?: boolean };
    const changes: Partial<typeof eaUsers.$inferInsert> = { updatedAt: new Date() };
    if (body.email !== undefined) changes.email = body.email.toLowerCase().trim();
    if (body.fullName !== undefined) changes.fullName = body.fullName?.trim() || null;
    if (body.role !== undefined) {
      if (!['admin', 'inspector'].includes(body.role)) throw badRequest('role must be admin or inspector');
      changes.role = body.role;
    }
    if (body.isActive !== undefined) changes.isActive = Boolean(body.isActive);
    const [updated] = await db.update(eaUsers).set(changes).where(eq(eaUsers.id, id)).returning(cols);
    return reply.send(assertFound(updated, 'User'));
  });

  app.patch('/:id/password', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    assertSelfOrAdmin(id, request.user);
    const body = request.body as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) {
      throw badRequest('currentPassword and newPassword are required');
    }
    if (body.newPassword.length < 6) throw badRequest('newPassword must be at least 6 characters');

    const [user] = await db.select().from(eaUsers).where(eq(eaUsers.id, id));
    const found = assertFound(user, 'User');
    const currentValid = await verifyPassword(body.currentPassword, found.passwordHash);
    if (!currentValid) throw unauthorized('Current password is incorrect');

    const [updated] = await db.update(eaUsers)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
      .where(eq(eaUsers.id, id))
      .returning(cols);

    return reply.send(assertFound(updated, 'User'));
  });

  app.delete('/:id', {
    schema: { tags: ['EcoAudit Users'], security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireApp('ecoaudit'), requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await db.update(eaUsers).set({ isActive: false, updatedAt: new Date() })
      .where(eq(eaUsers.id, id)).returning({ id: eaUsers.id });
    assertFound(updated, 'User');
    return reply.status(204).send();
  });
}
