import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { authenticate, requireApp, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  ihCompletionIdempotency,
  ihInstallations,
} from '../../db/schema/installhub.js';
import { recordVersions } from '../../db/schema/shared.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { config } from '../../config.js';
import {
  canonicalPayloadHash,
  installationReadiness,
  type CanonicalInstallationTree,
} from './canonical.js';
import {
  buildAllAssetsView,
  buildElectricalTreeView,
  buildInstallationMappingExport,
  buildMeteringView,
} from './canonicalViews.js';
import {
  paginateReadiness,
  searchCanonicalCandidates,
  type CanonicalCandidateKind,
} from './canonicalPagination.js';
import { assertInstallationAccess } from './helpers.js';
import {
  type CanonicalRecordVersionSnapshot,
  canonicalCompletionReadiness,
  insertCanonicalRecordVersion,
  loadCanonicalInstallationTree,
  loadCanonicalRecordVersion,
  projectLegacyInstallationTree,
  replaceCanonicalInstallationChildren,
} from './treeService.js';

function positiveVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw badRequest('recordVersionNumber must be a positive integer');
  }
  return parsed;
}

function nonNegativeRevision(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest('baseTreeRevision must be a non-negative integer');
  }
  return parsed;
}

async function accessibleInstallation(
  installationId: string,
  user: Parameters<typeof assertInstallationAccess>[1],
) {
  const [installation] = await db.select().from(ihInstallations).where(and(
    eq(ihInstallations.id, installationId),
    isNull(ihInstallations.deletedAt),
  ));
  if (!installation) throw notFound('Installation');
  assertInstallationAccess(installation, user);
  return installation;
}

async function selectedTree(input: {
  installationId: string;
  recordVersionNumber?: number;
  preferVersion?: boolean;
}): Promise<{
  tree: CanonicalInstallationTree;
  recordVersionNumber: number;
  pinned: boolean;
  snapshot?: CanonicalRecordVersionSnapshot;
}> {
  if (input.recordVersionNumber !== undefined || input.preferVersion) {
    const version = await loadCanonicalRecordVersion({
      installationId: input.installationId,
      versionNumber: input.recordVersionNumber,
    });
    if (!version) {
      if (input.recordVersionNumber !== undefined) throw notFound('Installation record version');
      throw conflict('record_version_required');
    }
    return {
      tree: version.snapshot.installationTree,
      recordVersionNumber: version.versionNumber,
      pinned: true,
      snapshot: version.snapshot,
    };
  }
  const tree = await loadCanonicalInstallationTree(input.installationId);
  if (!tree) throw notFound('Installation');
  return {
    tree,
    recordVersionNumber: tree.installation.recordVersionNumber,
    pinned: false,
  };
}

const protectedRoute = {
  schema: {
    tags: ['Field App Complete Installations'],
    security: [{ bearerAuth: [] }],
  },
  preHandler: [
    authenticate,
    requireApp('installhub'),
    requireRole('inspector'),
    async () => {
      if (!config.installhubCanonicalV2Enabled) {
        throw conflict('canonical_v2_feature_disabled');
      }
    },
  ],
};

export async function installhubCanonicalRoutes(app: FastifyInstance): Promise<void> {
  app.delete('/:installationId/meters/:meterId', {
    ...protectedRoute,
    schema: {
      ...protectedRoute.schema,
      summary: 'Remove an active meter while retaining commissioned version history',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['baseTreeRevision'],
        properties: {
          baseTreeRevision: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { installationId, meterId } = request.params as {
      installationId: string;
      meterId: string;
    };
    const baseTreeRevision = nonNegativeRevision(
      (request.body as { baseTreeRevision: unknown }).baseTreeRevision,
    );
    const result = await db.transaction(async (tx) => {
      const [installation] = await tx.select().from(ihInstallations).where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      )).for('update');
      if (!installation) throw notFound('Installation');
      assertInstallationAccess(installation, request.user);
      if (installation.treeSchemaVersion < 2) throw conflict('upgrade_required');
      if (installation.status === 'Completed') {
        throw conflict('installation_completed_reopen_required');
      }
      if (installation.treeRevision !== baseTreeRevision) throw conflict('snapshot_conflict');
      const tree = await loadCanonicalInstallationTree(installationId, tx);
      if (!tree) throw notFound('Installation');
      const meter = tree.meterDevices.find((item) => item.id === meterId);
      if (!meter) throw notFound('Meter');

      const removedAssignments = tree.measurementAssignments
        .filter((assignment) => assignment.meterId === meterId);
      const removedAssignmentIds = removedAssignments.map((assignment) => assignment.id).sort();
      const removedAssignmentIdSet = new Set(removedAssignmentIds);
      const directlyTargetedAssetIds = new Set(removedAssignments.flatMap((assignment) => (
        assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []
      )));
      const affectedSiteAssetIds = tree.siteAssets.filter((asset) => (
        directlyTargetedAssetIds.has(asset.id)
        || (asset.meteringState.kind === 'METERED'
          && asset.meteringState.measurementAssignmentIds.some((id) => removedAssignmentIdSet.has(id)))
      )).map((asset) => asset.id).sort();
      const affectedSet = new Set(affectedSiteAssetIds);
      for (const asset of tree.siteAssets) {
        if (!affectedSet.has(asset.id)) continue;
        asset.meteringState = { kind: 'TBC' };
        asset.meterPresent = false;
      }
      tree.measurementAssignments = tree.measurementAssignments
        .filter((assignment) => assignment.meterId !== meterId);
      tree.meterDevices = tree.meterDevices.filter((item) => item.id !== meterId);
      tree.electricalAssets.find((board) => board.id === meter.installedOnBoardId)!.meterPresent =
        tree.meterDevices.some((item) => item.installedOnBoardId === meter.installedOnBoardId);

      const retainedFormIds = tree.formSubmissions.filter((form) => (
        form.formType === 'ww-installation'
        && form.status === 'Completed'
        && form.meterId === meterId
      )).map((form) => form.id).sort();
      const versionRows = await tx.select({
        id: recordVersions.id,
        versionNumber: recordVersions.versionNumber,
        snapshot: recordVersions.snapshot,
      }).from(recordVersions).where(and(
        eq(recordVersions.app, 'installhub'),
        eq(recordVersions.entityType, 'installation'),
        eq(recordVersions.entityId, installationId),
      ));
      const retainedRecordVersions = versionRows.filter(({ snapshot }) => {
        if (!snapshot || typeof snapshot !== 'object') return false;
        const pinned = (snapshot as { installationTree?: CanonicalInstallationTree }).installationTree;
        return Boolean(
          pinned?.meterDevices?.some((item) => item.id === meterId)
          && retainedFormIds.every((formId) => pinned.formSubmissions?.some((form) => form.id === formId)),
        );
      }).map(({ id, versionNumber }) => ({ id, recordVersionNumber: versionNumber }))
        .sort((left, right) => left.recordVersionNumber - right.recordVersionNumber);

      const changedAt = new Date();
      await replaceCanonicalInstallationChildren({
        executor: tx,
        tree,
        now: changedAt,
        commissionedMeterRemovalIds: new Set([meterId]),
      });
      const nextRevision = installation.treeRevision + 1;
      const [updated] = await tx.update(ihInstallations).set({
        treeRevision: nextRevision,
        updatedAt: changedAt,
        syncStatus: 'synced',
      }).where(and(
        eq(ihInstallations.id, installationId),
        eq(ihInstallations.treeRevision, baseTreeRevision),
        eq(ihInstallations.status, 'Draft'),
      )).returning();
      if (!updated) throw conflict('snapshot_conflict');
      const persisted = await loadCanonicalInstallationTree(installationId, tx);
      if (!persisted) throw notFound('Installation');
      return {
        ...projectLegacyInstallationTree(persisted),
        readiness: paginateReadiness(installationReadiness(persisted)),
        meterRemoval: {
          meterId,
          removedAssignmentIds,
          affectedSiteAssetIds,
          retainedFormIds,
          retainedRecordVersions,
        },
      };
    });
    return reply.send(result);
  });

  app.get('/:installationId/readiness', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const recordVersionNumber = positiveVersion(
      (request.query as { recordVersionNumber?: unknown }).recordVersionNumber,
    );
    if (recordVersionNumber !== undefined) {
      const version = await loadCanonicalRecordVersion({ installationId, versionNumber: recordVersionNumber });
      if (!version) throw notFound('Installation record version');
      return reply.send(paginateReadiness(
        version.snapshot.readiness,
        request.query as { offset?: unknown; limit?: unknown; q?: unknown },
      ));
    }
    const selected = await selectedTree({ installationId });
    return reply.send(paginateReadiness(
      installationReadiness(selected.tree),
      request.query as { offset?: unknown; limit?: unknown; q?: unknown },
    ));
  });

  app.get('/:installationId/candidates', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const query = request.query as {
      kind?: unknown;
      q?: unknown;
      cursor?: unknown;
      limit?: unknown;
    };
    const kind = typeof query.kind === 'string' ? query.kind : 'board';
    if (!['board', 'site_asset', 'meter', 'channel'].includes(kind)) {
      throw badRequest('kind must be board, site_asset, meter, or channel');
    }
    const tree = await loadCanonicalInstallationTree(installationId);
    if (!tree) throw notFound('Installation');
    return reply.send(searchCanonicalCandidates({
      tree,
      kind: kind as CanonicalCandidateKind,
      query: typeof query.q === 'string' ? query.q : undefined,
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      limit: typeof query.limit === 'string' || typeof query.limit === 'number'
        ? Number(query.limit)
        : undefined,
    }));
  });

  app.post('/:installationId/complete', {
    ...protectedRoute,
    schema: {
      ...protectedRoute.schema,
      summary: 'Complete a ready installation and pin an immutable canonical version',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['baseTreeRevision', 'idempotencyKey'],
        properties: {
          baseTreeRevision: { type: 'integer', minimum: 0 },
          idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = request.body as { baseTreeRevision: unknown; idempotencyKey: unknown };
    const baseTreeRevision = nonNegativeRevision(body.baseTreeRevision);
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) {
      throw badRequest('idempotencyKey is required');
    }
    const idempotencyKey = body.idempotencyKey.trim();
    const fingerprint = canonicalPayloadHash({ baseTreeRevision, operation: 'complete' });

    const outcome = await db.transaction(async (tx) => {
      const [installation] = await tx.select().from(ihInstallations).where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      )).for('update');
      if (!installation) throw notFound('Installation');
      assertInstallationAccess(installation, request.user);

      const [prior] = await tx.select().from(ihCompletionIdempotency).where(and(
        eq(ihCompletionIdempotency.installationId, installationId),
        eq(ihCompletionIdempotency.operation, 'complete'),
        eq(ihCompletionIdempotency.actorUserId, request.user.userId),
        eq(ihCompletionIdempotency.idempotencyKey, idempotencyKey),
      ));
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) {
          throw conflict('idempotency_key_reused');
        }
        return { kind: 'success' as const, result: prior.result };
      }
      if (installation.treeSchemaVersion < 2) throw conflict('upgrade_required');
      if (installation.status === 'Completed') throw conflict('installation_already_completed');
      if (installation.treeRevision !== baseTreeRevision) throw conflict('snapshot_conflict');

      const tree = await loadCanonicalInstallationTree(installationId, tx);
      if (!tree) throw notFound('Installation');
      const readiness = await canonicalCompletionReadiness({ tree, executor: tx });
      if (!readiness.readyToComplete) {
        return { kind: 'not_ready' as const, readiness };
      }

      const completedAt = new Date();
      const nextRevision = installation.treeRevision + 1;
      const nextVersion = installation.recordVersionNumber + 1;
      const [updated] = await tx.update(ihInstallations).set({
        status: 'Completed',
        treeRevision: nextRevision,
        recordVersionNumber: nextVersion,
        completedAt,
        completedByUserId: request.user.userId,
        completedFromRevision: baseTreeRevision,
        updatedAt: completedAt,
        syncStatus: 'synced',
      }).where(and(
        eq(ihInstallations.id, installationId),
        eq(ihInstallations.status, 'Draft'),
        eq(ihInstallations.treeRevision, baseTreeRevision),
      )).returning();
      if (!updated) throw conflict('snapshot_conflict');

      tree.installation.status = 'Completed';
      tree.installation.treeRevision = nextRevision;
      tree.installation.recordVersionNumber = nextVersion;
      tree.installation.completedAt = completedAt.toISOString();
      tree.installation.completedByUserId = request.user.userId;
      tree.installation.completedFromRevision = baseTreeRevision;
      tree.installation.updatedAt = completedAt.toISOString();
      const snapshot = await insertCanonicalRecordVersion({
        executor: tx,
        tree,
        versionNumber: nextVersion,
        userId: request.user.userId,
      });
      const result = {
        installationId,
        status: 'Completed',
        completedAt: completedAt.toISOString(),
        completedByUserId: request.user.userId,
        completedFromRevision: baseTreeRevision,
        treeRevision: nextRevision,
        recordVersionNumber: nextVersion,
        payloadHash: snapshot.payloadHash,
        readiness: paginateReadiness(snapshot.readiness),
      };
      await tx.insert(ihCompletionIdempotency).values({
        id: randomUUID(),
        installationId,
        operation: 'complete',
        actorUserId: request.user.userId,
        idempotencyKey,
        requestFingerprint: fingerprint,
        completedFromRevision: baseTreeRevision,
        resultingTreeRevision: nextRevision,
        recordVersionNumber: nextVersion,
        result,
      });
      return { kind: 'success' as const, result };
    });
    if (outcome.kind === 'not_ready') {
      return reply.status(422).send({
        error: 'Installation is not ready to complete',
        statusCode: 422,
        code: 'installation_not_ready',
        readiness: paginateReadiness(outcome.readiness),
      });
    }
    return reply.send(outcome.result);
  });

  app.post('/:installationId/reopen', {
    ...protectedRoute,
    schema: {
      ...protectedRoute.schema,
      summary: 'Reopen a completed installation while retaining its immutable version',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['baseTreeRevision', 'reason'],
        properties: {
          baseTreeRevision: { type: 'integer', minimum: 0 },
          reason: { type: 'string', minLength: 3, maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    const body = request.body as { baseTreeRevision: unknown; reason: unknown };
    const baseTreeRevision = nonNegativeRevision(body.baseTreeRevision);
    if (typeof body.reason !== 'string' || body.reason.trim().length < 3) {
      throw badRequest('reason must contain at least 3 characters');
    }
    const reason = body.reason.trim();
    const result = await db.transaction(async (tx) => {
      const [installation] = await tx.select().from(ihInstallations).where(and(
        eq(ihInstallations.id, installationId),
        isNull(ihInstallations.deletedAt),
      )).for('update');
      if (!installation) throw notFound('Installation');
      assertInstallationAccess(installation, request.user);
      if (installation.treeSchemaVersion < 2) throw conflict('upgrade_required');
      if (installation.status !== 'Completed') throw conflict('installation_not_completed');
      if (installation.treeRevision !== baseTreeRevision) throw conflict('snapshot_conflict');
      const reopenedAt = new Date();
      const nextRevision = installation.treeRevision + 1;
      const [updated] = await tx.update(ihInstallations).set({
        status: 'Draft',
        treeRevision: nextRevision,
        reopenedAt,
        reopenedByUserId: request.user.userId,
        reopenedFromVersionNumber: installation.recordVersionNumber,
        reopenReason: reason,
        updatedAt: reopenedAt,
        syncStatus: 'synced',
      }).where(and(
        eq(ihInstallations.id, installationId),
        eq(ihInstallations.status, 'Completed'),
        eq(ihInstallations.treeRevision, baseTreeRevision),
      )).returning();
      if (!updated) throw conflict('snapshot_conflict');
      const tree = await loadCanonicalInstallationTree(installationId, tx);
      if (!tree) throw notFound('Installation');
      return {
        installationId,
        status: 'Draft',
        treeRevision: nextRevision,
        recordVersionNumber: installation.recordVersionNumber,
        reopenedFromVersionNumber: installation.recordVersionNumber,
        reopenedAt: reopenedAt.toISOString(),
        reopenedByUserId: request.user.userId,
        reason,
        readiness: paginateReadiness(installationReadiness(tree)),
      };
    });
    return reply.send(result);
  });

  app.get('/:installationId/electrical-tree', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const requested = positiveVersion((request.query as { recordVersionNumber?: unknown }).recordVersionNumber);
    const selected = await selectedTree({ installationId, recordVersionNumber: requested });
    return reply.send(
      selected.snapshot?.viewArtifacts.electricalTree
      ?? buildElectricalTreeView(selected.tree, selected.recordVersionNumber),
    );
  });

  app.get('/:installationId/all-assets', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const requested = positiveVersion((request.query as { recordVersionNumber?: unknown }).recordVersionNumber);
    const selected = await selectedTree({ installationId, recordVersionNumber: requested });
    return reply.send(
      selected.snapshot?.viewArtifacts.allAssets
      ?? buildAllAssetsView(selected.tree, selected.recordVersionNumber),
    );
  });

  app.get('/:installationId/metering', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const requested = positiveVersion((request.query as { recordVersionNumber?: unknown }).recordVersionNumber);
    const selected = await selectedTree({ installationId, recordVersionNumber: requested });
    return reply.send(
      selected.snapshot?.viewArtifacts.metering
      ?? buildMeteringView(selected.tree, selected.recordVersionNumber),
    );
  });

  app.get('/:installationId/mapping', protectedRoute, async (request, reply) => {
    const { installationId } = request.params as { installationId: string };
    await accessibleInstallation(installationId, request.user);
    const requested = positiveVersion((request.query as { recordVersionNumber?: unknown }).recordVersionNumber);
    const selected = await selectedTree({
      installationId,
      recordVersionNumber: requested,
      preferVersion: true,
    });
    const readiness = selected.snapshot?.readiness ?? installationReadiness(selected.tree);
    if (!readiness.eligibility.mappingExport) throw conflict('mapping_export_not_eligible');
    return reply.send(
      selected.snapshot?.viewArtifacts.mapping
      ?? buildInstallationMappingExport(selected.tree, selected.recordVersionNumber),
    );
  });
}
