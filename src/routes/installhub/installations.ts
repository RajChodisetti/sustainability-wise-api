import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { ihInstallations, ihUsers } from '../../db/schema/installhub.js';
import { badRequest, notFound } from '../../utils/errors.js';
import {
  assertInstallationAccess,
  assertInstallationDeletionAccess,
  shouldPurgeQuery,
} from './helpers.js';
import { purgeInstallHubInstallationTree } from './purge.js';

async function loadInstallation(
  installationId: string,
  includeDeleted = false,
) {
  const [installation] = await db
    .select()
    .from(ihInstallations)
    .where(
      includeDeleted
        ? eq(ihInstallations.id, installationId)
        : and(
            eq(ihInstallations.id, installationId),
            isNull(ihInstallations.deletedAt),
          ),
    );
  if (!installation) throw notFound('Installation');
  return installation;
}

async function assignmentResponse(
  installation: typeof ihInstallations.$inferSelect,
) {
  const [assignedInspector] = installation.assignedInspectorUserId
    ? await db
        .select({
          id: ihUsers.id,
          email: ihUsers.email,
          fullName: ihUsers.fullName,
          role: ihUsers.role,
          isActive: ihUsers.isActive,
        })
        .from(ihUsers)
        .where(eq(ihUsers.id, installation.assignedInspectorUserId))
    : [];
  return {
    installationId: installation.id,
    assignedInspectorUserId: installation.assignedInspectorUserId,
    assignedInspector: assignedInspector ?? null,
  };
}

export async function installhubInstallationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.delete('/:installationId', {
    schema: {
      tags: ['InstallHub Installations'],
      summary: 'Delete an InstallHub Cloud Backup',
      description:
        'Soft-deletes by default. purge=true permanently removes the server tree, unreferenced originals, generated reports, and versions.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          purge: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
        },
      },
    },
    preHandler: [
      authenticate,
      requireApp('installhub'),
      requireRole('inspector'),
    ],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const purge = shouldPurgeQuery(
      request.query as Record<string, unknown> | undefined,
    );
    const installation = await loadInstallation(installationId, purge);
    assertInstallationDeletionAccess(installation, request.user);
    if (purge) {
      await purgeInstallHubInstallationTree(installation.id);
      return reply.status(204).send();
    }
    await db
      .update(ihInstallations)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
        syncStatus: 'local',
      })
      .where(eq(ihInstallations.id, installation.id));
    return reply.status(204).send();
  });

  app.get('/:installationId/access', {
    schema: {
      tags: ['InstallHub Installations'],
      summary: 'Get InstallHub installation access assignment',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [
      authenticate,
      requireApp('installhub'),
      requireRole('inspector'),
    ],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const installation = await loadInstallation(installationId);
    assertInstallationAccess(installation, request.user);
    return reply.send(await assignmentResponse(installation));
  });

  app.patch('/:installationId/access', {
    schema: {
      tags: ['InstallHub Installations'],
      summary: 'Assign or clear access for another InstallHub user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['assignedInspectorUserId'],
        additionalProperties: false,
        properties: {
          assignedInspectorUserId: { type: ['string', 'null'] },
        },
      },
    },
    preHandler: [
      authenticate,
      requireApp('installhub'),
      requireRole('admin'),
    ],
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = request.body as { assignedInspectorUserId: string | null };
    const installation = await loadInstallation(installationId);
    const assignedInspectorUserId =
      typeof body.assignedInspectorUserId === 'string'
        ? body.assignedInspectorUserId.trim()
        : null;
    if (assignedInspectorUserId) {
      const [user] = await db
        .select({ id: ihUsers.id, isActive: ihUsers.isActive })
        .from(ihUsers)
        .where(eq(ihUsers.id, assignedInspectorUserId));
      if (!user) throw notFound('Assigned user');
      if (!user.isActive) throw badRequest('Assigned user must be active');
    }
    const [updated] = await db
      .update(ihInstallations)
      .set({
        assignedInspectorUserId: assignedInspectorUserId || null,
        updatedAt: new Date(),
      })
      .where(eq(ihInstallations.id, installation.id))
      .returning();
    if (!updated) throw notFound('Installation');
    return reply.send(await assignmentResponse(updated));
  });
}
