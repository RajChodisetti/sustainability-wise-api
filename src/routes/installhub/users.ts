import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { eaUsers } from '../../db/schema/ecoaudit.js';
import { ihUsers } from '../../db/schema/installhub.js';
import { globalUsers, refreshTokens, unifiedUsers } from '../../db/schema/shared.js';
import { ssUsers } from '../../db/schema/solarsense.js';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { hashPassword } from '../../auth/apiKey.js';
import { verifyGlobalUserPassword } from '../../auth/globalIdentity.js';
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

type SourceApp = 'ecoaudit' | 'solarsense';
export type UnifiedInstallHubUser = typeof unifiedUsers.$inferSelect;
export type UnifiedInstallHubUserView = Pick<
  UnifiedInstallHubUser,
  | 'id'
  | 'originApp'
  | 'originUserId'
  | 'fieldUserId'
  | 'email'
  | 'fullName'
  | 'role'
  | 'isActive'
  | 'sourceCreatedAt'
  | 'sourceUpdatedAt'
  | 'deletedAt'
> & { isMaintainer?: boolean };

export const unifiedInstallHubUserColumns = {
  id: unifiedUsers.id,
  originApp: unifiedUsers.originApp,
  originUserId: unifiedUsers.originUserId,
  fieldUserId: unifiedUsers.fieldUserId,
  email: unifiedUsers.email,
  fullName: unifiedUsers.fullName,
  role: unifiedUsers.role,
  isActive: unifiedUsers.isActive,
  sourceCreatedAt: unifiedUsers.sourceCreatedAt,
  sourceUpdatedAt: unifiedUsers.sourceUpdatedAt,
  deletedAt: unifiedUsers.deletedAt,
};

const unifiedInstallHubUserWithMaintainerColumns = {
  ...unifiedInstallHubUserColumns,
  isMaintainer: globalUsers.isMaintainer,
};

function sourceApp(value: string): SourceApp | null {
  return value === 'ecoaudit' || value === 'solarsense' ? value : null;
}

export function isSourceManagedInstallHubUser(
  user: Pick<UnifiedInstallHubUser, 'originApp'>,
): boolean {
  return sourceApp(user.originApp) !== null;
}

export function installHubPasswordRevocationTargets(
  user: Pick<
    UnifiedInstallHubUser,
    'originApp' | 'originUserId' | 'fieldUserId'
  >,
): Array<{
  app: 'ecoaudit' | 'solarsense' | 'installhub';
  userId: string;
}> {
  const managedSourceApp = sourceApp(user.originApp);
  return [
    ...(managedSourceApp
      ? [{
          app: managedSourceApp,
          userId: user.originUserId,
        }]
      : []),
    {
      app: 'installhub',
      userId: user.fieldUserId,
    },
  ];
}

/**
 * Preserve the InstallHub mobile user envelope while resolving its public ID
 * and current profile from the additive shared registry.
 */
export function presentUnifiedInstallHubUser(user: UnifiedInstallHubUserView) {
  const managedSourceApp = sourceApp(user.originApp);
  return {
    id: user.fieldUserId,
    email: user.email,
    fullName: user.fullName,
    role: user.role === 'admin' ? 'admin' as const : 'inspector' as const,
    isActive: user.isActive,
    createdAt: user.sourceCreatedAt,
    updatedAt: user.sourceUpdatedAt,
    sourceManaged: managedSourceApp !== null,
    isMaintainer: user.isMaintainer === true,
    sourceApp: managedSourceApp,
    sourceState: managedSourceApp
      ? user.deletedAt
        ? 'orphaned' as const
        : 'linked' as const
      : 'explicit' as const,
  };
}

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
  return candidate.code === '23505'
    || /unique|duplicate|already assigned|collides/i.test(candidate.message ?? '');
}

async function revokeRefreshTokens(
  executor: Pick<typeof db, 'update'>,
  app: 'ecoaudit' | 'solarsense' | 'installhub',
  userId: string,
): Promise<void> {
  await executor
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(refreshTokens.app, app),
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt),
    ));
}

async function revokeInstallHubRefreshTokens(
  executor: Pick<typeof db, 'update'>,
  fieldUserId: string,
): Promise<void> {
  await revokeRefreshTokens(executor, 'installhub', fieldUserId);
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
      tags: ['Field App Complete Users'],
      summary: 'List Field App Complete users',
      security: [{ bearerAuth: [] }],
    },
    preHandler: installHubAdmin,
  }, async (_request, reply) => {
    const users = await db
      .select(unifiedInstallHubUserWithMaintainerColumns)
      .from(unifiedUsers)
      .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
      .where(eq(unifiedUsers.originApp, 'installhub'))
      .orderBy(asc(unifiedUsers.sourceCreatedAt));
    return reply.send({
      data: users.map(presentUnifiedInstallHubUser),
    });
  });

  app.post('/', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Create a Field App Complete user',
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
      return reply.status(201).send({
        ...created,
        isMaintainer: false,
        sourceManaged: false,
        sourceApp: null,
        sourceState: 'explicit',
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.get('/:id', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Get a Field App Complete user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: installHubUser,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.user.role !== 'admin' && request.user.userId !== id) {
      throw forbidden('Cannot access another user');
    }
    const [user] = await db
      .select(unifiedInstallHubUserWithMaintainerColumns)
      .from(unifiedUsers)
      .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
      .where(and(
        eq(unifiedUsers.fieldUserId, id),
        eq(unifiedUsers.originApp, 'installhub'),
      ));
    return reply.send(
      presentUnifiedInstallHubUser(assertFound(user, 'User')),
    );
  });

  app.patch('/:id', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Update a Field App Complete user',
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
        const [registryUser] = await tx
          .select(unifiedInstallHubUserColumns)
          .from(unifiedUsers)
          .where(and(
            eq(unifiedUsers.fieldUserId, id),
            eq(unifiedUsers.originApp, 'installhub'),
          ));
        if (!registryUser) throw notFound('User');
        if (isSourceManagedInstallHubUser(registryUser)) {
          throw conflict(
            'This Field App Complete account is managed by its source application. Update it in Eco Audit or Solar Sense.',
          );
        }

        const [current] = await tx
          .select()
          .from(ihUsers)
          .where(eq(ihUsers.id, registryUser.originUserId));
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
          throw conflict('Cannot remove the last active Field App Complete administrator');
        }

        const changes: Partial<typeof ihUsers.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (body.email !== undefined) changes.email = normalizeEmail(body.email);
        if (body.fullName !== undefined) {
          changes.fullName = body.fullName?.trim() || null;
        }
        if (body.role !== undefined) changes.role = nextRole;
        if (body.isActive !== undefined) changes.isActive = nextIsActive;

        const [result] = await tx
          .update(ihUsers)
          .set(changes)
          .where(eq(ihUsers.id, registryUser.originUserId))
          .returning({ id: ihUsers.id });
        assertFound(result, 'User');
        if (current.role !== nextRole || current.isActive !== nextIsActive) {
          await revokeInstallHubRefreshTokens(tx, id);
        }

        const [updatedRegistryUser] = await tx
          .select(unifiedInstallHubUserWithMaintainerColumns)
          .from(unifiedUsers)
          .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
          .where(and(
            eq(unifiedUsers.fieldUserId, id),
            eq(unifiedUsers.originApp, 'installhub'),
          ));
        return assertFound(updatedRegistryUser, 'User');
      });
      return reply.send(presentUnifiedInstallHubUser(updated));
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Email already exists');
      throw error;
    }
  });

  app.patch('/:id/maintainer', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Grant or revoke company inventory maintainer access',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['isMaintainer'],
        additionalProperties: false,
        properties: { isMaintainer: { type: 'boolean' } },
      },
    },
    preHandler: installHubAdmin,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { isMaintainer } = request.body as { isMaintainer: boolean };
    const [updated] = await db.update(globalUsers).set({
      isMaintainer,
      updatedAt: new Date(),
    }).where(eq(globalUsers.fieldUserId, id)).returning({ id: globalUsers.id });
    if (!updated) throw notFound('User');
    const [user] = await db.select(unifiedInstallHubUserWithMaintainerColumns)
      .from(unifiedUsers)
      .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
      .where(and(
        eq(unifiedUsers.fieldUserId, id),
        eq(unifiedUsers.originApp, 'installhub'),
      ));
    return reply.send(presentUnifiedInstallHubUser(assertFound(user, 'User')));
  });

  app.patch('/:id/password', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Change or administratively reset a Field App Complete user password',
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

    const [registryUser] = await db
      .select()
      .from(unifiedUsers)
      .where(and(
        eq(unifiedUsers.fieldUserId, id),
        eq(unifiedUsers.originApp, 'installhub'),
      ));
    const found = assertFound(registryUser, 'User');
    const managedSourceApp = sourceApp(found.originApp);
    if (managedSourceApp && (!found.isActive || found.deletedAt)) {
      throw conflict('The source account is missing or inactive.');
    }
    if (mode === 'self') {
      if (!body.currentPassword) {
        throw badRequest('currentPassword is required when changing your own password');
      }
      if (!await verifyGlobalUserPassword(
        'installhub',
        found.originUserId,
        body.currentPassword,
      )) {
        throw unauthorized('Current password is incorrect');
      }
    }
    if (managedSourceApp && mode === 'admin_reset') {
      throw conflict(
        'Source-managed passwords must be reset in Eco Audit or Solar Sense.',
      );
    }

    const passwordHash = await hashPassword(body.newPassword);
    const updated = await db.transaction(async (tx) => {
      if (managedSourceApp) {
        let sourceUpdated: { id: string } | undefined;
        if (managedSourceApp === 'ecoaudit') {
          [sourceUpdated] = await tx
            .update(eaUsers)
            .set({ passwordHash, updatedAt: new Date() })
            .where(and(
              eq(eaUsers.id, found.originUserId),
              eq(eaUsers.isActive, true),
              eq(eaUsers.passwordHash, found.passwordHash),
            ))
            .returning({ id: eaUsers.id });
        } else {
          [sourceUpdated] = await tx
            .update(ssUsers)
            .set({ passwordHash, updatedAt: new Date() })
            .where(and(
              eq(ssUsers.id, found.originUserId),
              eq(ssUsers.isActive, true),
              eq(ssUsers.passwordHash, found.passwordHash),
            ))
            .returning({ id: ssUsers.id });
        }
        if (!sourceUpdated) {
          throw conflict('The source account changed. Reload and try again.');
        }
      } else {
        const [nativeUpdated] = await tx
          .update(ihUsers)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(ihUsers.id, found.originUserId))
          .returning({ id: ihUsers.id });
        assertFound(nativeUpdated, 'User');
      }

      for (const target of installHubPasswordRevocationTargets(found)) {
        await revokeRefreshTokens(tx, target.app, target.userId);
      }
      const [updatedRegistryUser] = await tx
        .select(unifiedInstallHubUserWithMaintainerColumns)
        .from(unifiedUsers)
        .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
        .where(and(
          eq(unifiedUsers.fieldUserId, found.fieldUserId),
          eq(unifiedUsers.originApp, 'installhub'),
        ));
      return assertFound(updatedRegistryUser, 'User');
    });
    return reply.send(presentUnifiedInstallHubUser(updated));
  });

  app.delete('/:id', {
    schema: {
      tags: ['Field App Complete Users'],
      summary: 'Deactivate a Field App Complete user',
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
      const [registryUser] = await tx
        .select(unifiedInstallHubUserColumns)
        .from(unifiedUsers)
        .where(and(
          eq(unifiedUsers.fieldUserId, id),
          eq(unifiedUsers.originApp, 'installhub'),
        ));
      if (!registryUser) throw notFound('User');
      if (isSourceManagedInstallHubUser(registryUser)) {
        throw conflict(
          'This Field App Complete account is managed by its source application. Deactivate it in Eco Audit or Solar Sense.',
        );
      }

      const [current] = await tx
        .select()
        .from(ihUsers)
        .where(eq(ihUsers.id, registryUser.originUserId));
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
        throw conflict('Cannot remove the last active Field App Complete administrator');
      }

      await tx
        .update(ihUsers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(ihUsers.id, registryUser.originUserId));
      await revokeInstallHubRefreshTokens(tx, id);
    });
    return reply.status(204).send();
  });
}
