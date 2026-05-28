import type { FastifyRequest, FastifyReply, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema/shared.js';
import { verifyAccessToken, type App, type Role } from './jwt.js';
import { verifyKey } from './apiKey.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export interface AuthUser {
  userId: string;
  app: App;
  role: Role;
  authType: 'jwt' | 'apikey';
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Missing Authorization header');
  }
  const token = header.slice(7);

  // --- Try JWT first ---
  const jwtPayload = verifyAccessToken(token);
  if (jwtPayload) {
    request.user = { ...jwtPayload, authType: 'jwt' };
    return;
  }

  // --- Fall back to API key ---
  // Find all non-revoked keys where the token starts with the stored prefix
  const allKeys = await db
    .select()
    .from(apiKeys)
    .where(and(isNull(apiKeys.revokedAt)));

  for (const key of allKeys) {
    if (token.startsWith(key.prefix)) {
      const valid = await verifyKey(token, key.hashedKey);
      if (valid) {
        // Update last_used_at in background (non-blocking)
        db.update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id))
          .catch(() => {});

        request.user = {
          userId: key.createdByUserId ?? key.id,
          app: key.app as App,
          role: key.role as Role,
          authType: 'apikey',
        };
        return;
      }
    }
  }

  throw unauthorized('Invalid or expired token');
}

export function requireRole(minimum: Role) {
  const hierarchy: Role[] = ['inspector', 'service_account', 'admin'];
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) throw unauthorized();
    const userIdx = hierarchy.indexOf(request.user.role);
    const minIdx = hierarchy.indexOf(minimum);
    if (userIdx < minIdx) throw forbidden(`Requires ${minimum} role`);
  };
}

export function requireApp(app: App) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) throw unauthorized();
    if (request.user.app !== app) throw forbidden('Wrong application namespace');
  };
}

const authPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.decorate('authenticate', authenticate);
  done();
};

export { authenticate };
export default fp(authPlugin, { name: 'auth' });
