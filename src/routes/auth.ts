import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { refreshTokens } from '../db/schema/shared.js';
import { eaUsers } from '../db/schema/ecoaudit.js';
import { ssUsers } from '../db/schema/solarsense.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt.js';
import { verifyPassword } from '../auth/apiKey.js';
import { authenticate } from '../auth/middleware.js';
import { sha256String, randomToken } from '../utils/crypto.js';
import { unauthorized, badRequest, notFound } from '../utils/errors.js';

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

    return reply.send({ accessToken, refreshToken, expiresIn: 900 });
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
    return reply.status(204).send();
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
    const { userId, app, role } = request.user;
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
