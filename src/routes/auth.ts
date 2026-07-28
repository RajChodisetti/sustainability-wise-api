import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { refreshTokens, unifiedUsers } from '../db/schema/shared.js';
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
  explicitFieldEmailForLogin,
  fieldBridgeIdentity,
  fleetBridgeIdentity,
  selectFieldLoginAuthority,
  selectFleetLoginAuthority,
  sourceIdentitiesForFieldLogin,
  sourceIdentitiesForFleetLogin,
  verifyActiveLogin,
  verifyFieldSourceUser,
  verifyFleetSourceAdmin,
} from '../auth/loginIdentity.js';
import { collectPortalLoginSessions } from '../auth/portalLoginSessions.js';
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

function prepareTokens(user: {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  sourceManaged?: boolean;
  fieldSourceApp?: 'ecoaudit' | 'solarsense' | null;
}, app: App) {
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
        ...(app === 'installhub' && user.sourceManaged !== undefined
          ? {
              sourceManaged: user.sourceManaged,
              sourceApp: user.fieldSourceApp ?? null,
            }
          : {}),
      },
    },
  };
}

async function issueTokens(
  user: Parameters<typeof prepareTokens>[0],
  app: App,
) {
  const issued = prepareTokens(user, app);
  await db.insert(refreshTokens).values(issued.refreshTokenRecord);
  return issued.response;
}

type AuthResponse = Awaited<ReturnType<typeof issueTokens>>;

async function issueSourceTokensAfterVerifiedPassword(
  sourceApp: 'ecoaudit' | 'solarsense',
  sourceUserId: string,
  verified: {
    email: string;
    passwordHash: string;
  },
): Promise<AuthResponse> {
  return db.transaction(async (tx) => {
    const [sourceUser] = sourceApp === 'ecoaudit'
      ? await tx
          .select()
          .from(eaUsers)
          .where(eq(eaUsers.id, sourceUserId))
          .for('update')
      : await tx
          .select()
          .from(ssUsers)
          .where(eq(ssUsers.id, sourceUserId))
          .for('update');
    if (
      !sourceUser?.isActive
      || sourceUser.email !== verified.email
      || sourceUser.passwordHash !== verified.passwordHash
    ) {
      throw unauthorized('Invalid credentials');
    }

    const issued = prepareTokens(sourceUser, sourceApp);
    await tx.insert(refreshTokens).values(issued.refreshTokenRecord);
    return issued.response;
  });
}

async function issueFieldTokensForSource(
  sourceApp: 'ecoaudit' | 'solarsense',
  sourceUserId: string,
  expected?: {
    passwordHash?: string;
    fieldUserId?: string;
    sourceRefreshTokenHash?: string;
  },
): Promise<AuthResponse> {
  return db.transaction(async (tx) => {
    const [sourceUser] = sourceApp === 'ecoaudit'
      ? await tx
          .select()
          .from(eaUsers)
          .where(eq(eaUsers.id, sourceUserId))
          .for('update')
      : await tx
          .select()
          .from(ssUsers)
          .where(eq(ssUsers.id, sourceUserId))
          .for('update');
    const expectedFieldUserId = fieldBridgeIdentity({
      app: sourceApp,
      id: sourceUserId,
    }).id;
    const [registryUser] = await tx
      .select()
      .from(unifiedUsers)
      .where(and(
        eq(unifiedUsers.originApp, sourceApp),
        eq(unifiedUsers.originUserId, sourceUserId),
        eq(unifiedUsers.fieldUserId, expectedFieldUserId),
        isNull(unifiedUsers.deletedAt),
      ))
      .for('update');
    if (
      !sourceUser?.isActive
      || !registryUser?.isActive
      || registryUser.passwordHash !== sourceUser.passwordHash
      || registryUser.role !== sourceUser.role
      || registryUser.email !== sourceUser.email
      || registryUser.fullName !== sourceUser.fullName
      || (
        expected !== undefined
        && (
          (
            expected.passwordHash !== undefined
            && sourceUser.passwordHash !== expected.passwordHash
          )
          || (
            expected.fieldUserId !== undefined
            && registryUser.fieldUserId !== expected.fieldUserId
          )
        )
      )
    ) {
      throw unauthorized('Invalid credentials');
    }

    if (expected?.sourceRefreshTokenHash) {
      const [sourceSession] = await tx
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(and(
          eq(refreshTokens.tokenHash, expected.sourceRefreshTokenHash),
          eq(refreshTokens.userId, sourceUserId),
          eq(refreshTokens.app, sourceApp),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ))
        .for('update');
      if (!sourceSession) {
        throw unauthorized('Source session expired or revoked');
      }
    }

    const issued = prepareTokens({
      id: registryUser.fieldUserId,
      email: sourceUser.email,
      fullName: sourceUser.fullName?.trim() || null,
      role: sourceUser.role === 'admin' ? 'admin' : 'inspector',
      sourceManaged: true,
      fieldSourceApp: sourceApp,
    }, 'installhub');
    await tx.insert(refreshTokens).values(issued.refreshTokenRecord);
    return issued.response;
  });
}

async function loginForApp(
  email: string,
  password: string,
  requestedApp: App,
  fieldSourceHint: 'ecoaudit' | 'solarsense' | null = null,
): Promise<AuthResponse> {
  if (requestedApp === 'ecoaudit' || requestedApp === 'solarsense') {
    const userTable = tableForApp(requestedApp);
    const loginEmail = cloudEmailForLogin(requestedApp, email);
    const [user] = await db.select().from(userTable).where(eq(userTable.email, loginEmail));
    if (!user || !user.isActive) throw unauthorized('Invalid credentials');
    if (!await verifyPassword(password, user.passwordHash)) {
      throw unauthorized('Invalid credentials');
    }
    return issueSourceTokensAfterVerifiedPassword(
      requestedApp,
      user.id,
      {
        email: user.email,
        passwordHash: user.passwordHash,
      },
    );
  }

  if (requestedApp === 'installhub') {
    const resolved = sourceIdentitiesForFieldLogin(email);
    const { sources } = resolved;
    const sourceHint = fieldSourceHint ?? resolved.sourceHint;
    const explicitFieldEmail = explicitFieldEmailForLogin(email, fieldSourceHint);
    const [fieldUser] = explicitFieldEmail
      ? await db.select().from(ihUsers).where(eq(ihUsers.email, explicitFieldEmail))
      : [];
    const explicitLoginValid = await verifyActiveLogin(
      fieldUser,
      password,
      verifyPassword,
    );
    if (selectFieldLoginAuthority(explicitLoginValid, null) === 'explicit_field' && fieldUser) {
      return issueTokens({
        ...fieldUser,
        sourceManaged: false,
        fieldSourceApp: null,
      }, 'installhub');
    }

    const sourceRegistryRows = await db
      .select()
      .from(unifiedUsers)
      .where(and(
        inArray(unifiedUsers.originApp, ['ecoaudit', 'solarsense']),
        inArray(unifiedUsers.email, sources.map((candidate) => candidate.email)),
        isNull(unifiedUsers.deletedAt),
      ));
    const sourceUser = await verifyFieldSourceUser(
      sourceRegistryRows.map((candidate) => ({
        app: candidate.originApp as 'ecoaudit' | 'solarsense',
        id: candidate.originUserId,
        fieldUserId: candidate.fieldUserId,
        email: candidate.email,
        passwordHash: candidate.passwordHash,
        fullName: candidate.fullName,
        role: candidate.role,
        isActive: candidate.isActive,
      })),
      password,
      verifyPassword,
      sourceHint,
    );
    if (selectFieldLoginAuthority(false, sourceUser) !== 'source_user' || !sourceUser) {
      throw unauthorized('Invalid credentials');
    }

    return issueFieldTokensForSource(sourceUser.app, sourceUser.id, {
      passwordHash: sourceUser.passwordHash,
      fieldUserId: sourceUser.fieldUserId,
    });
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
    return issueTokens(fleetUser, 'wattwatchers');
  }
  if (authority !== 'source_admin' || !sourceAdmin) {
    throw unauthorized('Invalid credentials');
  }

  const unusablePasswordHash = await hashPassword(randomToken(32));
  const now = new Date();
  return db.transaction(async (tx) => {
    const [lockedSourceAdmin] = sourceAdmin.app === 'ecoaudit'
      ? await tx
          .select()
          .from(eaUsers)
          .where(eq(eaUsers.id, sourceAdmin.id))
          .for('update')
      : await tx
          .select()
          .from(ssUsers)
          .where(eq(ssUsers.id, sourceAdmin.id))
          .for('update');
    if (
      !lockedSourceAdmin?.isActive
      || lockedSourceAdmin.role !== 'admin'
      || lockedSourceAdmin.passwordHash !== sourceAdmin.passwordHash
    ) {
      throw unauthorized('Invalid credentials');
    }

    const bridge = fleetBridgeIdentity(sourceAdmin);
    await tx.insert(wwUsers).values({
      ...bridge,
      passwordHash: unusablePasswordHash,
      fullName: lockedSourceAdmin.fullName?.trim() || null,
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
        fullName: lockedSourceAdmin.fullName?.trim() || null,
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

    const issued = prepareTokens({
      id: bridgedUser.id,
      email: bridgedUser.email,
      fullName: bridgedUser.fullName,
      role: bridgedUser.role,
    }, 'wattwatchers');
    await tx.insert(refreshTokens).values(issued.refreshTokenRecord);
    return issued.response;
  });
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
    return reply.send(await loginForApp(email, password, app));
  });

  // POST /v1/auth/portal-login
  // Additive portal facade: it returns independent legacy auth envelopes and
  // never introduces a cross-app token. Older clients continue using /login.
  app.post('/portal-login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login to all authorised portal applications',
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 1 },
          target: {
            type: 'string',
            enum: ['ecoaudit', 'solarsense', 'installhub', 'wattwatchers'],
          },
          skipApps: {
            type: 'array',
            maxItems: 4,
            uniqueItems: true,
            items: {
              type: 'string',
              enum: ['ecoaudit', 'solarsense', 'installhub', 'wattwatchers'],
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, target, skipApps = [] } = request.body as {
      email: string;
      password: string;
      target?: App;
      skipApps?: App[];
    };
    if (!target && skipApps.length > 0) {
      throw badRequest('skipApps requires target');
    }
    const sessions = await collectPortalLoginSessions<AuthResponse>(
      (candidate, fieldSourceHint) => loginForApp(
        email,
        password,
        candidate,
        fieldSourceHint ?? null,
      ),
      target,
      skipApps,
    );
    if (Object.keys(sessions).length === 0) {
      throw unauthorized('Invalid credentials');
    }

    return reply.send({ sessions });
  });

  // POST /v1/auth/field-session
  // Additive token exchange for an already-authenticated Eco Audit or Solar
  // Sense portal session. This prevents a second credential prompt when a
  // signed-in user opens Field while preserving app-scoped JWTs.
  app.post('/field-session', {
    schema: {
      tags: ['Auth'],
      summary: 'Create a Field session from the current source-app session',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['refreshToken'],
        additionalProperties: false,
        properties: {
          refreshToken: { type: 'string', minLength: 1 },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    if (
      request.user.authType !== 'jwt'
      || (
        request.user.app !== 'ecoaudit'
        && request.user.app !== 'solarsense'
      )
    ) {
      throw forbidden(
        'A signed-in Eco Audit or Solar Sense user is required',
      );
    }
    const { refreshToken } = request.body as { refreshToken: string };
    return reply.send(await issueFieldTokensForSource(
      request.user.app,
      request.user.userId,
      { sourceRefreshTokenHash: sha256String(refreshToken) },
    ));
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
    const rotated = await db.transaction(async (tx) => {
      const now = new Date();
      let tokenUser: { id: string; role: string };

      /*
       * Lock the authoritative user before claiming the refresh token. Source
       * account writes use source -> unified registry -> refresh-token order,
       * so matching that order avoids deadlocks and prevents a source change
       * racing a newly issued Field token back into validity.
       */
      if (payload.app === 'ecoaudit') {
        const [user] = await tx
          .select()
          .from(eaUsers)
          .where(eq(eaUsers.id, payload.userId))
          .for('update');
        if (!user?.isActive) throw unauthorized('User not found or inactive');
        tokenUser = user;
      } else if (payload.app === 'solarsense') {
        const [user] = await tx
          .select()
          .from(ssUsers)
          .where(eq(ssUsers.id, payload.userId))
          .for('update');
        if (!user?.isActive) throw unauthorized('User not found or inactive');
        tokenUser = user;
      } else if (payload.app === 'installhub') {
        const [snapshot] = await tx
          .select({
            id: unifiedUsers.id,
            originApp: unifiedUsers.originApp,
            originUserId: unifiedUsers.originUserId,
            fieldUserId: unifiedUsers.fieldUserId,
          })
          .from(unifiedUsers)
          .where(and(
            eq(unifiedUsers.fieldUserId, payload.userId),
            isNull(unifiedUsers.deletedAt),
          ));
        if (!snapshot || (
          snapshot.originApp !== 'ecoaudit'
          && snapshot.originApp !== 'solarsense'
          && snapshot.originApp !== 'installhub'
        )) {
          throw unauthorized('User not found or inactive');
        }

        if (
          snapshot.originApp === 'ecoaudit'
          || snapshot.originApp === 'solarsense'
        ) {
          const [sourceUser] = snapshot.originApp === 'ecoaudit'
            ? await tx
                .select()
                .from(eaUsers)
                .where(eq(eaUsers.id, snapshot.originUserId))
                .for('update')
            : await tx
                .select()
                .from(ssUsers)
                .where(eq(ssUsers.id, snapshot.originUserId))
                .for('update');
          if (!sourceUser?.isActive) throw unauthorized('User not found or inactive');

          const [registryUser] = await tx
            .select()
            .from(unifiedUsers)
            .where(eq(unifiedUsers.id, snapshot.id))
            .for('update');
          if (
            !registryUser?.isActive
            || registryUser.deletedAt !== null
            || registryUser.originApp !== snapshot.originApp
            || registryUser.originUserId !== sourceUser.id
            || registryUser.fieldUserId !== payload.userId
            || registryUser.passwordHash !== sourceUser.passwordHash
            || registryUser.role !== sourceUser.role
          ) {
            throw unauthorized('User not found or inactive');
          }

          const sourceRole = sourceUser.role === 'admin' ? 'admin' : 'inspector';
          tokenUser = { id: registryUser.fieldUserId, role: sourceRole };
        } else {
          const [fieldUser] = await tx
            .select()
            .from(ihUsers)
            .where(eq(ihUsers.id, snapshot.originUserId))
            .for('update');
          if (!fieldUser?.isActive || fieldUser.id !== payload.userId) {
            throw unauthorized('User not found or inactive');
          }
          const [registryUser] = await tx
            .select()
            .from(unifiedUsers)
            .where(eq(unifiedUsers.id, snapshot.id))
            .for('update');
          if (
            !registryUser?.isActive
            || registryUser.deletedAt !== null
            || registryUser.originApp !== 'installhub'
            || registryUser.originUserId !== fieldUser.id
            || registryUser.fieldUserId !== fieldUser.id
            || registryUser.passwordHash !== fieldUser.passwordHash
            || registryUser.role !== fieldUser.role
          ) {
            throw unauthorized('User not found or inactive');
          }
          tokenUser = fieldUser;
        }
      } else {
        const [snapshot] = await tx
          .select({
            sourceApp: wwUsers.sourceApp,
            sourceUserId: wwUsers.sourceUserId,
          })
          .from(wwUsers)
          .where(eq(wwUsers.id, payload.userId));
        if (!snapshot) throw unauthorized('User not found or inactive');

        const hasSourceLink = (
          snapshot.sourceApp !== null
          || snapshot.sourceUserId !== null
        );
        if (hasSourceLink) {
          if (
            !snapshot.sourceUserId
            || (
              snapshot.sourceApp !== 'ecoaudit'
              && snapshot.sourceApp !== 'solarsense'
            )
          ) {
            throw unauthorized('User not found or inactive');
          }

          const [sourceUser] = snapshot.sourceApp === 'ecoaudit'
            ? await tx
                .select({ role: eaUsers.role, isActive: eaUsers.isActive })
                .from(eaUsers)
                .where(eq(eaUsers.id, snapshot.sourceUserId))
                .for('update')
            : await tx
                .select({ role: ssUsers.role, isActive: ssUsers.isActive })
                .from(ssUsers)
                .where(eq(ssUsers.id, snapshot.sourceUserId))
                .for('update');
          if (!sourceUser?.isActive || sourceUser.role !== 'admin') {
            throw unauthorized('User not found or inactive');
          }

          const [fleetUser] = await tx
            .select()
            .from(wwUsers)
            .where(eq(wwUsers.id, payload.userId))
            .for('update');
          if (
            !fleetUser?.isActive
            || fleetUser.sourceApp !== snapshot.sourceApp
            || fleetUser.sourceUserId !== snapshot.sourceUserId
          ) {
            throw unauthorized('User not found or inactive');
          }
          tokenUser = fleetUser;
        } else {
          const [fleetUser] = await tx
            .select()
            .from(wwUsers)
            .where(eq(wwUsers.id, payload.userId))
            .for('update');
          if (
            !fleetUser?.isActive
            || fleetUser.sourceApp !== null
            || fleetUser.sourceUserId !== null
          ) {
            throw unauthorized('User not found or inactive');
          }
          tokenUser = fleetUser;
        }
      }

      // This conditional update is the single-use token claim. With the user
      // row lock above, concurrent refreshes serialize and only one can win.
      const [claimed] = await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.userId, payload.userId),
          eq(refreshTokens.app, payload.app),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ))
        .returning({ id: refreshTokens.id });
      if (!claimed) throw unauthorized('Refresh token revoked or not found');

      const newAccess = signAccessToken({
        userId: tokenUser.id,
        app: payload.app,
        role: normalizeRole(payload.app, tokenUser.role),
      });
      const newRefresh = signRefreshToken({
        userId: tokenUser.id,
        app: payload.app,
      });
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await tx.insert(refreshTokens).values({
        id: randomToken(16),
        userId: tokenUser.id,
        app: payload.app,
        tokenHash: sha256String(newRefresh),
        expiresAt,
      });

      return {
        accessToken: newAccess,
        refreshToken: newRefresh,
        expiresIn: 900,
      };
    });

    return reply.send(rotated);
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
    if (app === 'installhub') {
      const [registryUser] = await db
        .select()
        .from(unifiedUsers)
        .where(and(
          eq(unifiedUsers.fieldUserId, userId),
          isNull(unifiedUsers.deletedAt),
        ));
      if (!registryUser?.isActive) throw notFound('User');
      if (
        registryUser.originApp === 'ecoaudit'
        || registryUser.originApp === 'solarsense'
      ) {
        const [sourceUser] = registryUser.originApp === 'ecoaudit'
          ? await db
              .select()
              .from(eaUsers)
              .where(eq(eaUsers.id, registryUser.originUserId))
          : await db
              .select()
              .from(ssUsers)
              .where(eq(ssUsers.id, registryUser.originUserId));
        if (!sourceUser?.isActive) throw notFound('User');
        return reply.send({
          id: registryUser.fieldUserId,
          email: sourceUser.email,
          fullName: sourceUser.fullName,
          role,
          app,
          sourceManaged: true,
          sourceApp: registryUser.originApp,
        });
      }
      if (registryUser.originApp !== 'installhub') throw notFound('User');
      const [fieldUser] = await db
        .select()
        .from(ihUsers)
        .where(eq(ihUsers.id, registryUser.originUserId));
      if (!fieldUser?.isActive) throw notFound('User');
      return reply.send({
        id: fieldUser.id,
        email: fieldUser.email,
        fullName: fieldUser.fullName,
        role,
        app,
        sourceManaged: false,
        sourceApp: null,
      });
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
