import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { refreshTokens } from '../db/schema/shared.js';
import { eaUsers } from '../db/schema/ecoaudit.js';
import { ssUsers } from '../db/schema/solarsense.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import { verifyPassword, hashPassword } from '../auth/apiKey.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { sha256String, randomToken } from '../utils/crypto.js';
import { unauthorized, badRequest, notFound, conflict, gone, forbidden } from '../utils/errors.js';
import { config } from '../config.js';

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
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
          app:      { type: 'string', enum: ['ecoaudit', 'solarsense'] },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, app } = request.body as {
      email: string; password: string; app: 'ecoaudit' | 'solarsense';
    };

    const userTable = app === 'ecoaudit' ? eaUsers : ssUsers;
    const [user] = await db.select().from(userTable).where(eq(userTable.email, email));

    if (!user || !user.isActive) throw unauthorized('Invalid credentials');

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw unauthorized('Invalid credentials');

    const accessToken  = signAccessToken({ userId: user.id, app, role: user.role as any });
    const refreshToken = signRefreshToken({ userId: user.id, app });
    const tokenId      = randomToken(16);
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(refreshTokens).values({
      id: tokenId,
      userId: user.id,
      app,
      tokenHash: sha256String(refreshToken),
      expiresAt,
    });

    return reply.send({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        app,
      },
    });
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
    const userTable = payload.app === 'ecoaudit' ? eaUsers : ssUsers;
    const [user] = await db.select().from(userTable).where(eq(userTable.id, payload.userId));
    if (!user || !user.isActive) throw unauthorized('User not found or inactive');

    const newAccess  = signAccessToken({ userId: user.id, app: payload.app, role: user.role as any });
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
  // Purpose: one-time migration of local device accounts to cloud.
  // Guards:
  //   1. X-Registration-Secret header must match REGISTRATION_SECRET env var.
  //   2. Permanently locked once POST /v1/auth/close-registrations is called.
  app.post('/register', {
    schema: { tags: ['Auth'], summary: 'Migrate local account to cloud (requires app registration secret)' },
  }, async (request, reply) => {
    // Guard 1 — check permanent closed flag
    const rows = await db.execute(sql`SELECT value FROM server_settings WHERE key = 'registrations_closed'`) as unknown as { rows: Array<{ value: string }> };
    const closed = rows.rows[0]?.value === 'true';
    if (closed) throw gone('Self-registration is permanently closed. Contact your administrator.');

    // Guard 2 — check build-time secret header
    const secret = request.headers['x-registration-secret'];
    if (!config.registrationSecret || secret !== config.registrationSecret) {
      throw forbidden('Invalid or missing registration secret');
    }

    const { email, password, fullName, app } = request.body as {
      email: string; password: string; fullName?: string; app: 'ecoaudit' | 'solarsense';
    };
    if (!email || !password || !app) throw badRequest('email, password and app are required');
    if (password.length < 6) throw badRequest('password must be at least 6 characters');
    if (!['ecoaudit', 'solarsense'].includes(app)) throw badRequest('app must be ecoaudit or solarsense');

    const userTable = app === 'ecoaudit' ? eaUsers : ssUsers;
    const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email.toLowerCase().trim()));
    if (existing) throw conflict('An account with this email already exists');

    const { randomUUID } = await import('node:crypto');
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    await db.insert(userTable).values({
      id, email: email.toLowerCase().trim(),
      passwordHash, fullName: fullName?.trim() || null, role: 'inspector',
    });

    const accessToken  = signAccessToken({ userId: id, app: app as any, role: 'inspector' });
    const refreshToken = signRefreshToken({ userId: id, app: app as any });
    const tokenId      = randomToken(16);
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(refreshTokens).values({ id: tokenId, userId: id, app: app as any, tokenHash: sha256String(refreshToken), expiresAt });

    return reply.status(201).send({
      accessToken, refreshToken, expiresIn: 900,
      user: { id, email: email.toLowerCase().trim(), fullName: fullName?.trim() || null, role: 'inspector', app },
    });
  });

  // POST /v1/auth/close-registrations — admin-only, permanently disables /register.
  app.post('/close-registrations', {
    schema: { tags: ['Auth'], summary: 'Permanently close self-registration (admin only, irreversible via API)', security: [{ bearerAuth: [] }] },
    preHandler: [authenticate, requireRole('admin')],
  }, async (_request, reply) => {
    await db.execute(sql`
      INSERT INTO server_settings (key, value, updated_at)
      VALUES ('registrations_closed', 'true', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()
    `);
    return reply.send({ ok: true, message: 'Self-registration is now permanently closed.' });
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
    const userTable = app === 'ecoaudit' ? eaUsers : ssUsers;
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
