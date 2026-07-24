import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { ihUsers } from '../../db/schema/installhub.js';
import { refreshTokens } from '../../db/schema/shared.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/apiKey.js';
import { cloudEmailForLogin } from '../../auth/loginIdentity.js';
import {
  assertFound,
  installHubAdminRemovalGuard,
  installHubPasswordChangeMode,
} from './helpers.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from '../../utils/errors.js';

const publicColumns = {
  id: ihUsers.id,
  email: ihUsers.email,
  fullName: ihUsers.fullName,
  role: ihUsers.role,
  isActive: ihUsers.isActive,
  createdAt: ihUsers.createdAt,
  updatedAt: ihUsers.updatedAt,
};

function normalizeEmail(value: string): string {
  if (!value.trim()) throw badRequest('email is required');
  return cloudEmailForLogin('installhub', value);
}

function installHubRole(value: unknown): 'admin' | 'inspector' {
  if (value === 'admin' || value === 'inspector') return value;
  throw badRequest('role must be admin or inspector');
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return candidate.code === '23505' || /unique|duplicate/i.test(candidate.message ?? '');
}

async function revokeInstallHubRefreshTokens(
  executor: Pick<typeof db, 'update'>,
  userId: string,
): Promise<void> {
  await executor
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(refreshTokens.app, 'installhub'),
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt),
    ));
}

export async function installhubUserRoutes(app: FastifyInstance): Promise<void> {
  const installHubUser = [
    authenticate,
    requireApp('installhub'),
    requireRole('inspector'),
  ];
  const installHubAdmin = [
    authenticate,
    requireApp('installhub'),
    requireRole('admin'),
  ];

  app.get('/', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'List InstallHub users',
      security: [{ bearerAuth: [] }],
    },
    preHandler: installHubAdmin,
  }, async (_request, reply) => {
    const users = await db
      .select(publicColumns)
      .from(ihUsers)
      .orderBy(asc(ihUsers.createdAt));
    return reply.send({ data: users });
  });

  app.post('/', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'Create an InstallHub user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          email: { type: 'string', minLength: 1, maxLength: 320 },
          password: { type: 'string', minLength: 6, maxLength: 1024 },
          fullName: { type: ['string', 'null'], maxLength: 200 },
          role: { type: 'string', enum: ['admin', 'inspector'] },
        },
      },
    },
    preHandler: installHubAdmin,
  }, async (request, reply) => {
    const body = request.body as {
      id?: string;
      email: string;
      password: string;
      fullName?: string | null;
      role?: string;
    };
    if (body.password.length < 6) {
      throw badRequest('password must be at least 6 characters');
    }

    try {
      const [created] = await db
        .insert(ihUsers)
        .values({
          id: body.id?.trim() || randomUUID(),
          email: normalizeEmail(body.email),
          passwordHash: await hashPassword(body.password),
          fullName: body.fullName?.trim() || null,
          role: body.role === undefined ? 'inspector' : installHubRole(body.role),
        })
        .returning(publicColumns);
      return reply.status(201).send(created);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.get('/:id', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'Get an InstallHub user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: installHubUser,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.user.role !== 'admin' && request.user.userId !== id) {
      throw forbidden('Cannot access another user');
    }
    const [user] = await db
      .select(publicColumns)
      .from(ihUsers)
      .where(eq(ihUsers.id, id));
    return reply.send(assertFound(user, 'User'));
  });

  app.patch('/:id', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'Update an InstallHub user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          email: { type: 'string', minLength: 1, maxLength: 320 },
          fullName: { type: ['string', 'null'], maxLength: 200 },
          role: { type: 'string', enum: ['admin', 'inspector'] },
          isActive: { type: 'boolean' },
        },
      },
    },
    preHandler: installHubAdmin,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      email?: string;
      fullName?: string | null;
      role?: string;
      isActive?: boolean;
    };

    try {
      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('installhub-user-admins'))`);
        const [current] = await tx
          .select()
          .from(ihUsers)
          .where(eq(ihUsers.id, id));
        if (!current) throw notFound('User');

        const nextRole = body.role === undefined
          ? current.role
          : installHubRole(body.role);
        const nextIsActive = body.isActive === undefined
          ? current.isActive
          : body.isActive;
        const [adminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(ihUsers)
          .where(and(
            eq(ihUsers.role, 'admin'),
            eq(ihUsers.isActive, true),
          ));
        const guard = installHubAdminRemovalGuard({
          actorId: request.user.userId,
          targetId: id,
          currentRole: current.role,
          currentIsActive: current.isActive,
          nextRole,
          nextIsActive,
          activeAdminCount: adminCount?.count ?? 0,
        });
        if (guard === 'self') {
          throw badRequest('Cannot demote or deactivate your own account');
        }
        if (guard === 'last_admin') {
          throw conflict('Cannot remove the last active InstallHub administrator');
        }

        const changes: Partial<typeof ihUsers.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (body.email !== undefined) changes.email = normalizeEmail(body.email);
        if (body.fullName !== undefined) changes.fullName = body.fullName?.trim() || null;
        if (body.role !== undefined) changes.role = nextRole;
        if (body.isActive !== undefined) changes.isActive = nextIsActive;

        const [result] = await tx
          .update(ihUsers)
          .set(changes)
          .where(eq(ihUsers.id, id))
          .returning(publicColumns);
        if (current.role !== nextRole || current.isActive !== nextIsActive) {
          await revokeInstallHubRefreshTokens(tx, id);
        }
        return assertFound(result, 'User');
      });
      return reply.send(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.patch('/:id/password', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'Change or administratively reset an InstallHub user password',
      description: 'Self-service changes require currentPassword. An administrator may reset another user without knowing that user password.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['newPassword'],
        additionalProperties: false,
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
          newPassword: { type: 'string', minLength: 6, maxLength: 1024 },
        },
      },
    },
    preHandler: installHubUser,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      currentPassword?: string;
      newPassword: string;
    };
    const mode = installHubPasswordChangeMode(id, request.user);
    if (body.newPassword.length < 6) {
      throw badRequest('newPassword must be at least 6 characters');
    }

    const [user] = await db.select().from(ihUsers).where(eq(ihUsers.id, id));
    const found = assertFound(user, 'User');
    if (mode === 'self') {
      if (!body.currentPassword) {
        throw badRequest('currentPassword is required when changing your own password');
      }
      if (!await verifyPassword(body.currentPassword, found.passwordHash)) {
        throw unauthorized('Current password is incorrect');
      }
    }

    const passwordHash = await hashPassword(body.newPassword);
    const updated = await db.transaction(async (tx) => {
      const [result] = await tx
        .update(ihUsers)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(ihUsers.id, id))
        .returning(publicColumns);
      await revokeInstallHubRefreshTokens(tx, id);
      return assertFound(result, 'User');
    });
    return reply.send(updated);
  });

  app.delete('/:id', {
    schema: {
      tags: ['InstallHub Users'],
      summary: 'Deactivate an InstallHub user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: installHubAdmin,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.userId) {
      throw badRequest('Cannot deactivate your own account');
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('installhub-user-admins'))`);
      const [current] = await tx
        .select()
        .from(ihUsers)
        .where(eq(ihUsers.id, id));
      if (!current) throw notFound('User');

      const [adminCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ihUsers)
        .where(and(
          eq(ihUsers.role, 'admin'),
          eq(ihUsers.isActive, true),
        ));
      const guard = installHubAdminRemovalGuard({
        actorId: request.user.userId,
        targetId: id,
        currentRole: current.role,
        currentIsActive: current.isActive,
        nextRole: current.role,
        nextIsActive: false,
        activeAdminCount: adminCount?.count ?? 0,
      });
      if (guard === 'last_admin') {
        throw conflict('Cannot remove the last active InstallHub administrator');
      }

      await tx
        .update(ihUsers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(ihUsers.id, id));
      await revokeInstallHubRefreshTokens(tx, id);
    });
    return reply.status(204).send();
  });
}
