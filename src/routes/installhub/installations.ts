import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  ihInstallationWorkSessions,
  ihInstallations,
} from '../../db/schema/installhub.js';
import { portalScheduleEvents, unifiedUsers } from '../../db/schema/shared.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import {
  assertInstallationAccess,
  assertInstallationDeletionAccess,
  shouldPurgeQuery,
} from './helpers.js';
import { purgeInstallHubInstallationTree } from './purge.js';
import {
  presentUnifiedInstallHubUser,
  unifiedInstallHubUserColumns,
  type UnifiedInstallHubUserView,
} from './users.js';
import {
  assertWorkSessionCheckpointAccess,
  decideWorkSessionUpdate,
  parseWorkSessionBody,
  presentWorkSession,
  workSessionBodySchema,
  workSessionResponseSchema,
} from '../workSessions.js';

type InstallationAssignment = Pick<
  typeof ihInstallations.$inferSelect,
  'id' | 'assignedInspectorUserId'
>;
export function buildInstallHubAssignmentResponse(
  installation: InstallationAssignment,
  assignedInspector?: UnifiedInstallHubUserView,
) {
  return {
    installationId: installation.id,
    assignedInspectorUserId: installation.assignedInspectorUserId,
    assignedInspector: assignedInspector
      ? presentUnifiedInstallHubUser(assignedInspector)
      : null,
  };
}

export function isAssignableInstallHubUser(
  user: Pick<UnifiedInstallHubUserView, 'isActive' | 'deletedAt'>,
): boolean {
  return user.isActive && user.deletedAt === null;
}

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
        .select(unifiedInstallHubUserColumns)
        .from(unifiedUsers)
        .where(and(
          eq(unifiedUsers.fieldUserId, installation.assignedInspectorUserId),
          eq(unifiedUsers.originApp, 'installhub'),
        ))
        .limit(1)
    : [];
  return buildInstallHubAssignmentResponse(installation, assignedInspector);
}

export async function installhubInstallationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.put('/:installationId/active-time/sessions/:sessionId', {
    schema: {
      tags: ['Field App Complete Installations'],
      summary: 'Checkpoint active foreground time for an installation audit',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['installationId', 'sessionId'],
        additionalProperties: false,
        properties: {
          installationId: { type: 'string', minLength: 1 },
          sessionId: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
      body: workSessionBodySchema,
      response: { 200: workSessionResponseSchema },
    },
    preHandler: [
      authenticate,
      requireApp('installhub'),
      requireRole('inspector'),
    ],
  }, async (request, reply) => {
    const { installationId, sessionId } = request.params as {
      installationId: string;
      sessionId: string;
    };
    const incoming = parseWorkSessionBody(request.body);
    const response = await db.transaction(async (tx) => {
      const [installation] = await tx
        .select()
        .from(ihInstallations)
        .where(and(
          eq(ihInstallations.id, installationId),
          isNull(ihInstallations.deletedAt),
        ))
        .for('update');
      if (!installation) throw notFound('Installation');

      const [existing] = await tx
        .select()
        .from(ihInstallationWorkSessions)
        .where(and(
          eq(ihInstallationWorkSessions.installationId, installationId),
          eq(ihInstallationWorkSessions.id, sessionId),
        ));
      assertWorkSessionCheckpointAccess({
        incoming,
        existing,
        actorUserId: request.user.userId,
        assertParentAccess: () => assertInstallationAccess(
          installation,
          request.user,
        ),
      });
      const decision = decideWorkSessionUpdate({
        incoming,
        existing,
        actorUserId: request.user.userId,
        completed: installation.status === 'Completed',
        completionBoundary: installation.status === 'Completed'
          ? installation.completedAt
          : null,
        completedDetail: 'installation_completed_time_tracking_disabled',
      });

      if (decision.action === 'current') {
        return presentWorkSession(existing!, false);
      }
      if (decision.action === 'insert') {
        const [inserted] = await tx
          .insert(ihInstallationWorkSessions)
          .values({
            id: sessionId,
            installationId,
            actorUserId: request.user.userId,
            ...incoming,
          })
          .returning();
        return presentWorkSession(inserted, true);
      }

      const [updated] = await tx
        .update(ihInstallationWorkSessions)
        .set({ ...incoming, updatedAt: new Date() })
        .where(and(
          eq(ihInstallationWorkSessions.installationId, installationId),
          eq(ihInstallationWorkSessions.id, sessionId),
          eq(ihInstallationWorkSessions.revision, existing!.revision),
        ))
        .returning();
      if (!updated) throw conflict('work_session_concurrent_update');
      return presentWorkSession(updated, true);
    });
    return reply.send(response);
  });

  app.delete('/:installationId', {
    schema: {
      tags: ['Field App Complete Installations'],
      summary: 'Delete a Field App Complete Cloud Backup',
      description:
        'Soft-deletes by default. purge=true permanently removes an installation only when it has no work-session or commercial accounting history.',
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
    if (installation.status === 'Completed') {
      throw conflict('installation_completed_reopen_required');
    }
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
      tags: ['Field App Complete Installations'],
      summary: 'Get Field App Complete installation access assignment',
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
      tags: ['Field App Complete Installations'],
      summary: 'Assign or clear access for another Field App Complete user',
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
    const assignedInspectorUserId =
      typeof body.assignedInspectorUserId === 'string'
        ? body.assignedInspectorUserId.trim()
        : null;
    const updated = await db.transaction(async (tx) => {
      // Scheduler assignment takes the product row lock first. Sharing that
      // lock prevents this product-only endpoint from racing and silently
      // desynchronising an actively scheduled installation.
      const [installation] = await tx
        .select()
        .from(ihInstallations)
        .where(and(
          eq(ihInstallations.id, installationId),
          isNull(ihInstallations.deletedAt),
        ))
        .for('update')
        .limit(1);
      if (!installation) throw notFound('Installation');
      const [scheduled] = await tx.select({ id: portalScheduleEvents.id })
        .from(portalScheduleEvents)
        .where(and(
          eq(portalScheduleEvents.sourceApp, 'installhub'),
          eq(portalScheduleEvents.sourceType, 'installation'),
          eq(portalScheduleEvents.sourceId, installation.id),
          inArray(portalScheduleEvents.status, ['planned', 'in_progress']),
        ))
        .limit(1);
      if (scheduled) {
        throw conflict('scheduled_assignment_managed_by_scheduler');
      }
      if (assignedInspectorUserId) {
        const [user] = await tx
          .select(unifiedInstallHubUserColumns)
          .from(unifiedUsers)
          .where(and(
            eq(unifiedUsers.fieldUserId, assignedInspectorUserId),
            eq(unifiedUsers.originApp, 'installhub'),
          ))
          .limit(1);
        if (!user) throw notFound('Assigned user');
        if (!isAssignableInstallHubUser(user)) {
          throw badRequest('Assigned user must be active');
        }
      }
      const [row] = await tx
        .update(ihInstallations)
        .set({
          assignedInspectorUserId: assignedInspectorUserId || null,
          treeRevision: installation.treeRevision + 1,
          updatedAt: new Date(),
        })
        .where(and(
          eq(ihInstallations.id, installation.id),
          eq(ihInstallations.treeRevision, installation.treeRevision),
        ))
        .returning();
      return row;
    });
    if (!updated) throw notFound('Installation');
    return reply.send(await assignmentResponse(updated));
  });
}
