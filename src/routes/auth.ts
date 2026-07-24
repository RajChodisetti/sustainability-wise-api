import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { refreshTokens } from '../db/schema/shared.js';
import { eaUsers } from '../db/schema/ecoaudit.js';
import { ssUsers } from '../db/schema/solarsense.js';
import { wwUsers } from '../db/schema/wattwatchers.js';
import { ihUsers } from '../db/schema/installhub.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import type { App, Role } from '../auth/jwt.js';
import { verifyPassword, hashPassword } from '../auth/apiKey.js';
import { planLocalBootstrap } from '../auth/bootstrapPolicy.js';
import {
  cloudEmailForLogin,
  fleetBridgeIdentity,
  selectFleetLoginAuthority,
  sourceIdentitiesForFleetLogin,
  verifyActiveLogin,
  verifyFleetSourceAdmin,
} from '../auth/loginIdentity.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { sha256String, randomToken } from '../utils/crypto.js';
import { unauthorized, badRequest, notFound, conflict, gone, forbidden } from '../utils/errors.js';
import { config } from '../config.js';

type UserTable = typeof eaUsers | typeof ssUsers | typeof ihUsers | typeof wwUsers;
type RegistrationApp = 'ecoaudit' | 'solarsense' | 'installhub';

function tableForApp(app: App): UserTable {
  switch (app) {
    case 'ecoaudit': return eaUsers;
    case 'solarsense': return ssUsers;
    case 'installhub': return ihUsers;
    case 'wattwatchers': return wwUsers;
  }
}

function normalizeRole(app: App, value: unknown): Extract<Role, 'admin' | 'inspector' | 'viewer'> {
  if (value === 'admin') return 'admin';
  return app === 'wattwatchers' ? 'viewer' : 'inspector';
}

async function registrationsAreClosed(app: RegistrationApp): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT key, value
    FROM server_settings
    WHERE key IN ('registrations_closed', ${`registrations_closed:${app}`})
  `);
  return (result as unknown as Array<{ key: string; value: string }>)
    .some((row) => row.value === 'true');
}

function assertRegistrationSecret(
  app: RegistrationApp,
  secret: string | string[] | undefined,
): void {
  const expected = config.registrationSecrets[app]
    || (
      config.allowLegacySharedRegistrationSecret
        ? config.registrationSecret
        : ''
    );
  if (!expected) throw forbidden('Invalid or missing registration secret');
  const key = randomBytes(32);
  const a = createHmac('sha256', key).update(expected).digest();
  const b = createHmac('sha256', key).update(typeof secret === 'string' ? secret : '').digest();
  if (!timingSafeEqual(a, b)) throw forbidden('Invalid or missing registration secret');
}

function prepareTokens(user: { id: string; email: string; fullName: string | null; role: string }, app: App) {
  const role = normalizeRole(app, user.role);
  const accessToken = signAccessToken({ userId: user.id, app, role });
  const refreshToken = signRefreshToken({ userId: user.id, app });
  const tokenId = randomToken(16);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    refreshTokenRecord: {
      id: tokenId,
      userId: user.id,
      app,
      tokenHash: sha256String(refreshToken),
      expiresAt,
    },
    response: {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role,
        app,
      },
    },
  };
}

async function issueTokens(user: { id: string; email: string; fullName: string | null; role: string }, app: App) {
  const issued = prepareTokens(user, app);
  await db.insert(refreshTokens).values(issued.refreshTokenRecord);
  return issued.response;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/auth/login
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      body: {
        type: 'object',
        required: ['email', 'password', 'app'],
        properties: {
          email:    { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 1 },
          app:      { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub', 'wattwatchers'] },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, app } = request.body as {
      email: string; password: string; app: App;
    };

    if (app !== 'wattwatchers') {
      const userTable = tableForApp(app);
      const loginEmail = cloudEmailForLogin(app, email);
      const [user] = await db.select().from(userTable).where(eq(userTable.email, loginEmail));

      if (!user || !user.isActive) throw unauthorized('Invalid credentials');

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) throw unauthorized('Invalid credentials');

      return reply.send(await issueTokens(user, app));
    }

    const { fleetEmail, sources } = sourceIdentitiesForFleetLogin(email);
    const [fleetUser] = await db.select().from(wwUsers).where(and(
      eq(wwUsers.email, fleetEmail),
      isNull(wwUsers.sourceApp),
      isNull(wwUsers.sourceUserId),
    ));
    const fleetLoginValid = await verifyActiveLogin(fleetUser, password, verifyPassword);

    const [[ecoUser], [solarUser]] = await Promise.all([
      db.select().from(eaUsers).where(eq(eaUsers.email, sources[0].email)),
      db.select().from(ssUsers).where(eq(ssUsers.email, sources[1].email)),
    ]);
    const sourceAdmin = await verifyFleetSourceAdmin([
      ecoUser ? { ...ecoUser, app: 'ecoaudit' as const } : null,
      solarUser ? { ...solarUser, app: 'solarsense' as const } : null,
    ], password, verifyPassword);
    const authority = selectFleetLoginAuthority(fleetLoginValid, sourceAdmin);
    if (authority === 'explicit_fleet' && fleetUser) {
      return reply.send(await issueTokens(fleetUser, 'wattwatchers'));
    }
    if (authority !== 'source_admin' || !sourceAdmin) throw unauthorized('Invalid credentials');

    const bridge = fleetBridgeIdentity(sourceAdmin);
    const unusablePasswordHash = await hashPassword(randomToken(32));
    const now = new Date();
    const response = await db.transaction(async (tx) => {
      await tx.insert(wwUsers).values({
        ...bridge,
        passwordHash: unusablePasswordHash,
        fullName: sourceAdmin.fullName?.trim() || null,
        role: 'admin',
        isActive: true,
        sourceApp: sourceAdmin.app,
        sourceUserId: sourceAdmin.id,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [wwUsers.sourceApp, wwUsers.sourceUserId],
        set: {
          email: bridge.email,
          fullName: sourceAdmin.fullName?.trim() || null,
          role: 'admin',
          isActive: true,
          updatedAt: now,
        },
      });

      const [bridgedUser] = await tx.select().from(wwUsers).where(and(
        eq(wwUsers.sourceApp, sourceAdmin.app),
        eq(wwUsers.sourceUserId, sourceAdmin.id),
      ));
      if (!bridgedUser) throw unauthorized('Invalid credentials');

      const issued = prepareTokens(bridgedUser, 'wattwatchers');
      await tx.insert(refreshTokens).values(issued.refreshTokenRecord);
      return issued.response;
    });

    return reply.send(response);
  });

  // POST /v1/auth/refresh
  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Rotate refresh token and issue new JWT pair',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) throw unauthorized('Invalid or expired refresh token');

    const tokenHash = sha256String(refreshToken);
    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.userId, payload.userId),
          eq(refreshTokens.app, payload.app),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );

    if (!stored) throw unauthorized('Refresh token revoked or not found');

    // Revoke old token
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    // Lookup user for role
    const userTable = tableForApp(payload.app);
    const [user] = await db.select().from(userTable).where(eq(userTable.id, payload.userId));
    if (!user || !user.isActive) throw unauthorized('User not found or inactive');

    if (payload.app === 'wattwatchers') {
      const fleetUser = user as typeof wwUsers.$inferSelect;
      const hasSourceLink = fleetUser.sourceApp !== null || fleetUser.sourceUserId !== null;
      if (hasSourceLink) {
        if (!fleetUser.sourceApp || !fleetUser.sourceUserId) {
          throw unauthorized('User not found or inactive');
        }
        const [sourceUser] = fleetUser.sourceApp === 'ecoaudit'
          ? await db.select({ role: eaUsers.role, isActive: eaUsers.isActive })
              .from(eaUsers).where(eq(eaUsers.id, fleetUser.sourceUserId))
          : fleetUser.sourceApp === 'solarsense'
            ? await db.select({ role: ssUsers.role, isActive: ssUsers.isActive })
                .from(ssUsers).where(eq(ssUsers.id, fleetUser.sourceUserId))
            : [];
        if (!sourceUser?.isActive || sourceUser.role !== 'admin') {
          throw unauthorized('User not found or inactive');
        }
      }
    }

    const newAccess  = signAccessToken({
      userId: user.id,
      app: payload.app,
      role: normalizeRole(payload.app, user.role),
    });
    const newRefresh = signRefreshToken({ userId: user.id, app: payload.app });
    const newId      = randomToken(16);
    const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(refreshTokens).values({
      id: newId,
      userId: user.id,
      app: payload.app,
      tokenHash: sha256String(newRefresh),
      expiresAt,
    });

    return reply.send({ accessToken: newAccess, refreshToken: newRefresh, expiresIn: 900 });
  });

  // POST /v1/auth/logout
  app.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke refresh token',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    const tokenHash = sha256String(refreshToken);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return reply.status(200).send({ ok: true });
  });

  // Ensure server_settings table exists (lazy, idempotent)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // POST /v1/auth/register
  // Purpose: controlled, app-scoped migration of local device accounts to cloud.
  // Guards:
  //   1. X-Registration-Secret must match the caller application's secret.
  //   2. Permanently locked for that app once close-registrations is called.
  app.post('/register', {
    schema: { tags: ['Auth'], summary: 'Migrate local account to cloud (requires app registration secret)' },
  }, async (request, reply) => {
    const { email, password, fullName, app } = request.body as {
      email: string; password: string; fullName?: string; app: 'ecoaudit' | 'solarsense' | 'installhub';
    };
    if (!email || !password || !app) throw badRequest('email, password and app are required');
    if (password.length < 6) throw badRequest('password must be at least 6 characters');
    if (!['ecoaudit', 'solarsense', 'installhub'].includes(app)) {
      throw badRequest('app must be ecoaudit, solarsense, or installhub');
    }
    if (await registrationsAreClosed(app)) {
      throw gone('Self-registration is permanently closed. Contact your administrator.');
    }
    assertRegistrationSecret(app, request.headers['x-registration-secret']);

    const userTable = tableForApp(app);
    const normalizedEmail = cloudEmailForLogin(app, email);
    const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, normalizedEmail));
    if (existing) throw conflict('An account with this email already exists');

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    await db.insert(userTable).values({
      id, email: normalizedEmail,
      passwordHash, fullName: fullName?.trim() || null, role: 'inspector',
    });

    const accessToken  = signAccessToken({ userId: id, app: app as any, role: 'inspector' });
    const refreshToken = signRefreshToken({ userId: id, app: app as any });
    const tokenId      = randomToken(16);
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(refreshTokens).values({ id: tokenId, userId: id, app: app as any, tokenHash: sha256String(refreshToken), expiresAt });

    return reply.status(201).send({
      accessToken, refreshToken, expiresIn: 900,
      user: { id, email: normalizedEmail, fullName: fullName?.trim() || null, role: 'inspector', app },
    });
  });

  // POST /v1/auth/bootstrap-local
  // Creates a cloud identity that uses the same local mobile user ID. This is an
  // explicitly enabled migration bridge, not a normal release authentication
  // path. It always requires the user's password and can never create an admin.
  // Existing identities are immutable unless the temporary legacy-upsert rollback
  // flag is enabled; even then role, active state, and email binding are preserved.
  app.post('/bootstrap-local', {
    schema: {
      tags: ['Auth'],
      summary: 'Bootstrap cloud tokens for the current local mobile account',
      body: {
        type: 'object',
        required: ['app', 'localUserId', 'username', 'password'],
        properties: {
          app: { type: 'string', enum: ['ecoaudit', 'solarsense', 'installhub'] },
          localUserId: { type: 'string', minLength: 1 },
          username: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 6 },
          fullName: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'inspector'] },
        },
      },
    },
  }, async (request, reply) => {
    if (!config.allowLocalBootstrap) {
      throw gone('Local account bootstrap is disabled. Sign in with an API server account or ask an administrator to create one.');
    }

    const { app, localUserId, username, password, fullName } = request.body as {
      app: App;
      localUserId: string;
      username: string;
      password?: string;
      fullName?: string | null;
    };
    if (!['ecoaudit', 'solarsense', 'installhub'].includes(app)) {
      throw badRequest('app must be ecoaudit, solarsense, or installhub');
    }
    assertRegistrationSecret(
      app as RegistrationApp,
      request.headers['x-registration-secret'],
    );
    if (!password || password.length < 6) {
      throw badRequest('password must be at least 6 characters');
    }
    const id = localUserId.trim();
    if (!id) throw badRequest('localUserId is required');

    const userTable = tableForApp(app);
    const now = new Date();
    const email = cloudEmailForLogin(app, username);
    const normalizedName = fullName?.trim() || username.trim();

    const [existing] = await db.select().from(userTable).where(eq(userTable.id, id));
    const [emailOwner] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
    if (emailOwner && emailOwner.id !== id) throw conflict('Email already exists');
    const passwordHash = await hashPassword(password);
    const bootstrapPlan = planLocalBootstrap({
      existing,
      requestedEmail: email,
      allowLegacyUpsert: config.allowLegacyBootstrapUpsert,
    });
    if (bootstrapPlan.mode === 'legacy-update') {
      const changes: Record<string, unknown> = {
        fullName: normalizedName,
        updatedAt: now,
        passwordHash,
      };
      await db.update(userTable).set(changes).where(eq(userTable.id, id));
    } else {
      await db.insert(userTable).values({
        id,
        email,
        passwordHash,
        fullName: normalizedName,
        role: bootstrapPlan.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [user] = await db.select().from(userTable).where(eq(userTable.id, id));
    return reply.status(existing ? 200 : 201).send(await issueTokens(user, app));
  });

  // POST /v1/auth/close-registrations — admin-only, closes the caller's app.
  app.post('/close-registrations', {
    schema: { tags: ['Auth'], summary: 'Close self-registration for the caller application (admin only)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    // Fleet administration is isolated from mobile-app registration policy.
    if (request.user.app === 'wattwatchers') {
      throw forbidden('Wattwatchers administrators cannot change mobile registration policy');
    }
    const settingKey = `registrations_closed:${request.user.app}`;
    await db.execute(sql`
      INSERT INTO server_settings (key, value, updated_at)
      VALUES (${settingKey}, 'true', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
    `);
    return reply.send({
      ok: true,
      app: request.user.app,
      message: `Self-registration for ${request.user.app} is now closed.`,
    });
  });

  // GET /v1/auth/me
  app.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current authenticated user',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { userId, app, role, authType, keyName } = request.user;
    if (authType === 'apikey') {
      return reply.send({ id: null, email: null, fullName: keyName ?? null, role, app });
    }
    const userTable = tableForApp(app);
    const [user] = await db.select().from(userTable).where(eq(userTable.id, userId));
    if (!user) throw notFound('User');
    return reply.send({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role,
      app,
    });
  });
}
