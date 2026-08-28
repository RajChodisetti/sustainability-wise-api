import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  ihCompletionIdempotency,
  ihInstallations,
} from '../db/schema/installhub.js';
import {
  canonicalPayloadHash,
} from '../routes/installhub/canonical.js';
import {
  paginateReadiness,
} from '../routes/installhub/canonicalPagination.js';
import {
  installHubCompletionNotesFromReplayResult,
  installHubCompletionReplayMatchesCurrentState,
  normalizeInstallHubCompletionNotes,
} from '../routes/installhub/completionNotes.js';
import {
  canonicalCompletionReadiness,
  insertCanonicalRecordVersion,
  loadCanonicalInstallationTree,
} from '../routes/installhub/treeService.js';
import { conflict, notFound } from '../utils/errors.js';
import { projectCompletedFieldInstallation } from './fieldCompletionProjectionService.js';
import {
  completeLinkedSchedulerEvents,
} from './schedulerCompletionService.js';
import type { SchedulerFinanceExecutor } from './schedulerFinanceService.js';

export type InstallHubCompletionOutcome =
  | {
      kind: 'success';
      result: Record<string, unknown>;
    }
  | {
      kind: 'already_completed';
    }
  | {
      kind: 'not_ready';
      readiness: Awaited<ReturnType<typeof canonicalCompletionReadiness>>;
    };

export async function completeInstallHubInstallation(
  executor: SchedulerFinanceExecutor,
  input: {
    installationId: string;
    actorUserId: string;
    idempotencyKey: string;
    baseTreeRevision?: number;
    completionNotes?: unknown;
    allowAlreadyCompleted?: boolean;
  },
): Promise<InstallHubCompletionOutcome> {
  const [installation] = await executor.select().from(ihInstallations).where(and(
    eq(ihInstallations.id, input.installationId),
    isNull(ihInstallations.deletedAt),
  )).for('update');
  if (!installation) throw notFound('Installation');

  const baseTreeRevision = input.baseTreeRevision ?? installation.treeRevision;
  const completionNotes = normalizeInstallHubCompletionNotes(input.completionNotes);
  const legacyFingerprint = canonicalPayloadHash({ baseTreeRevision, operation: 'complete' });
  const fingerprint = canonicalPayloadHash({
    baseTreeRevision,
    completionNotes,
    operation: 'complete',
  });

  const [prior] = await executor.select().from(ihCompletionIdempotency).where(and(
    eq(ihCompletionIdempotency.installationId, input.installationId),
    eq(ihCompletionIdempotency.operation, 'complete'),
    eq(ihCompletionIdempotency.actorUserId, input.actorUserId),
    eq(ihCompletionIdempotency.idempotencyKey, input.idempotencyKey),
  ));
  if (prior) {
    const matchesPreNotesClient = completionNotes === null
      && prior.requestFingerprint === legacyFingerprint;
    if (prior.requestFingerprint !== fingerprint && !matchesPreNotesClient) {
      throw conflict('idempotency_key_reused');
    }
    if (!installHubCompletionReplayMatchesCurrentState(installation, prior)) {
      throw conflict('completion_state_changed');
    }
    await completeLinkedSchedulerEvents(executor, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: input.installationId,
    }, { completionProvenance: 'historical_replay' });
    await projectCompletedFieldInstallation(executor, {
      installationId: input.installationId,
      actorUserId: input.actorUserId,
      observedAt: installation.completedAt ?? new Date(),
    });
    return {
      kind: 'success',
      result: {
        ...prior.result,
        completionNotes: installHubCompletionNotesFromReplayResult(prior.result),
      },
    };
  }

  if (installation.status === 'Completed') {
    if (!input.allowAlreadyCompleted) throw conflict('installation_already_completed');
    const observedAt = installation.completedAt ?? new Date();
    await completeLinkedSchedulerEvents(executor, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: input.installationId,
    }, {
      observedAt,
      completionProvenance: 'historical_replay',
    });
    await projectCompletedFieldInstallation(executor, {
      installationId: input.installationId,
      actorUserId: input.actorUserId,
      observedAt,
    });
    return { kind: 'already_completed' };
  }

  if (installation.treeSchemaVersion < 2) throw conflict('upgrade_required');
  if (installation.treeRevision !== baseTreeRevision) throw conflict('snapshot_conflict');

  const tree = await loadCanonicalInstallationTree(input.installationId, executor);
  if (!tree) throw notFound('Installation');
  const readiness = await canonicalCompletionReadiness({ tree, executor });
  if (!readiness.readyToComplete) return { kind: 'not_ready', readiness };

  const completedAt = new Date();
  const nextRevision = installation.treeRevision + 1;
  const nextVersion = installation.recordVersionNumber + 1;
  const [updated] = await executor.update(ihInstallations).set({
    status: 'Completed',
    treeRevision: nextRevision,
    recordVersionNumber: nextVersion,
    completedAt,
    completedByUserId: input.actorUserId,
    completedFromRevision: baseTreeRevision,
    completionNotes,
    updatedAt: completedAt,
    syncStatus: 'synced',
  }).where(and(
    eq(ihInstallations.id, input.installationId),
    eq(ihInstallations.status, 'Draft'),
    eq(ihInstallations.treeRevision, baseTreeRevision),
  )).returning();
  if (!updated) throw conflict('snapshot_conflict');

  tree.installation.status = 'Completed';
  tree.installation.treeRevision = nextRevision;
  tree.installation.recordVersionNumber = nextVersion;
  tree.installation.completedAt = completedAt.toISOString();
  tree.installation.completedByUserId = input.actorUserId;
  tree.installation.completedFromRevision = baseTreeRevision;
  tree.installation.completionNotes = completionNotes;
  tree.installation.updatedAt = completedAt.toISOString();
  const snapshot = await insertCanonicalRecordVersion({
    executor,
    tree,
    versionNumber: nextVersion,
    userId: input.actorUserId,
  });
  const result = {
    installationId: input.installationId,
    status: 'Completed',
    completedAt: completedAt.toISOString(),
    completedByUserId: input.actorUserId,
    completedFromRevision: baseTreeRevision,
    completionNotes,
    treeRevision: nextRevision,
    recordVersionNumber: nextVersion,
    payloadHash: snapshot.payloadHash,
    readiness: paginateReadiness(snapshot.readiness),
  };
  await executor.insert(ihCompletionIdempotency).values({
    id: randomUUID(),
    installationId: input.installationId,
    operation: 'complete',
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: fingerprint,
    completedFromRevision: baseTreeRevision,
    resultingTreeRevision: nextRevision,
    recordVersionNumber: nextVersion,
    result,
  });
  await completeLinkedSchedulerEvents(executor, {
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: input.installationId,
  }, {
    observedAt: completedAt,
    completionProvenance: 'direct_transition',
  });
  await projectCompletedFieldInstallation(executor, {
    installationId: input.installationId,
    actorUserId: input.actorUserId,
    observedAt: completedAt,
  });
  return { kind: 'success', result };
}
