import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { asc, isNull, sql } from 'drizzle-orm';
import { authenticate, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { unifiedUsers } from '../../db/schema/shared.js';
import {
  buildUnifiedUserDirectory,
  type UnifiedUserApp,
  type UnifiedUserRole,
} from '../../services/unifiedUserDirectory.js';
import { conflict, forbidden } from '../../utils/errors.js';

const DIRECTORY_LIMIT_PER_APP = 10_000;
const DIRECTORY_LIMIT_TOTAL = DIRECTORY_LIMIT_PER_APP * 3;
const PORTAL_DIRECTORY_APPS = new Set([
  'ecoaudit',
  'solarsense',
  'installhub',
]);

async function requirePortalDirectoryApp(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!PORTAL_DIRECTORY_APPS.has(request.user.app)) {
    throw forbidden('Unified user directory is unavailable for this application');
  }
}

export async function portalUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', {
    schema: {
      tags: ['Portal Users'],
      summary: 'List the unified EcoAudit, SolarSense, and Field App Complete user directory',
      description: 'Returns independent identity records and their app memberships without exposing credentials or merging equal usernames.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [
      authenticate,
      requirePortalDirectoryApp,
      requireRole('admin'),
    ],
  }, async (_request, reply) => {
    // Keep credentials out of this projection. The registry is already the
    // synchronized source for this additive directory, so one query is enough.
    const users = await db
      .select({
        id: unifiedUsers.id,
        originApp: sql<UnifiedUserApp>`${unifiedUsers.originApp}`,
        originUserId: unifiedUsers.originUserId,
        fieldUserId: unifiedUsers.fieldUserId,
        email: unifiedUsers.email,
        fullName: unifiedUsers.fullName,
        role: sql<UnifiedUserRole>`${unifiedUsers.role}`,
        isActive: unifiedUsers.isActive,
        sourceCreatedAt: unifiedUsers.sourceCreatedAt,
        sourceUpdatedAt: unifiedUsers.sourceUpdatedAt,
        deletedAt: unifiedUsers.deletedAt,
      })
      .from(unifiedUsers)
      .where(isNull(unifiedUsers.deletedAt))
      .orderBy(asc(unifiedUsers.sourceCreatedAt), asc(unifiedUsers.id))
      .limit(DIRECTORY_LIMIT_TOTAL + 1);

    const countByOrigin: Record<UnifiedUserApp, number> = {
      ecoaudit: 0,
      solarsense: 0,
      installhub: 0,
    };
    for (const user of users) countByOrigin[user.originApp] += 1;

    if (
      users.length > DIRECTORY_LIMIT_TOTAL
      || Object.values(countByOrigin).some(
        (count) => count > DIRECTORY_LIMIT_PER_APP,
      )
    ) {
      throw conflict(
        `Unified user directory exceeds ${DIRECTORY_LIMIT_PER_APP} users per application`,
      );
    }

    return reply.send(buildUnifiedUserDirectory(users));
  });
}
