import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { AuthUser } from '../../auth/middleware.js';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import {
  eaAuditEditLeaseEvents,
  eaAuditEditLeases,
  eaAuditIdempotency,
  eaAudits,
} from '../../db/schema/ecoaudit.js';
import { badRequest, conflict, forbidden } from '../../utils/errors.js';
import { assertAuditAccess, assertFound, isElevated } from './helpers.js';
import { nextAuditUpdatedAt } from './auditVersion.js';

export const ECOAUDIT_PROTOCOL_VERSION = '2';

export type EcoAuditClientKind = 'mobile' | 'portal';

export type EcoAuditWriteContext = {
  clientInstanceId: string;
  leaseFence: number;
  leaseToken: string;
  baseTreeRevision: number;
  idempotencyKey?: string;
};

export type EcoAuditBaseRevisionContext = {
  clientInstanceId: string;
  clientKind: EcoAuditClientKind;
  baseTreeRevision: number;
};

export type EcoAuditLeaseRequest = {
  clientInstanceId: string;
  clientKind: EcoAuditClientKind;
  clientLabel: string | null;
  expectedTreeRevision: number;
};

export type EcoAuditEditClient = Omit<EcoAuditLeaseRequest, 'expectedTreeRevision'>;

export type LockedAuditMutation = {
  audit: typeof eaAudits.$inferSelect;
  lease: typeof eaAuditEditLeases.$inferSelect | undefined;
  writeContext: EcoAuditWriteContext | null;
};

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw badRequest(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = nonNegativeInteger(value, field);
  if (parsed < 1) throw badRequest(`${field} must be a positive integer`);
  return parsed;
}

const HIGH_ENTROPY_COMMAND_KEY = /(?:^|[-:])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Create/copy/acquire recovery keys are bearer-grade recovery credentials. */
export function parseEcoAuditRecoveryKey(value: unknown, field = 'idempotencyKey'): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 200 || !HIGH_ENTROPY_COMMAND_KEY.test(key)) {
    throw badRequest(`${field} must contain a high-entropy UUID command key`);
  }
  return key;
}

export function ecoAuditIdempotencyStorageKey(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
}

/**
 * Initial lease tokens are deterministic only to the server and the holder of
 * the high-entropy command key. This makes an exact response-loss retry
 * idempotent without storing either credential in plaintext.
 */
export function ecoAuditCommandLeaseToken(input: {
  auditId: string;
  operation: 'create' | 'copy' | 'acquire';
  actorUserId: string;
  clientInstanceId: string;
  idempotencyKey: string;
}): string {
  return deriveEcoAuditCommandLeaseToken(config.ecoauditCommandHmacSecret, input);
}

export function deriveEcoAuditCommandLeaseToken(
  commandHmacSecret: string,
  input: {
    auditId: string;
    operation: 'create' | 'copy' | 'acquire';
    actorUserId: string;
    clientInstanceId: string;
    idempotencyKey: string;
  },
): string {
  return createHmac('sha256', commandHmacSecret)
    .update(JSON.stringify([
      'ecoaudit-edit-lease-v2',
      input.auditId,
      input.operation,
      input.actorUserId,
      input.clientInstanceId,
      input.idempotencyKey,
    ]), 'utf8')
    .digest('base64url');
}

export function parseEcoAuditEditClient(body: unknown): EcoAuditEditClient {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('request body must be an object');
  }
  const record = body as Record<string, unknown>;
  const clientInstanceId = typeof record.clientInstanceId === 'string'
    ? record.clientInstanceId.trim()
    : '';
  if (!clientInstanceId || clientInstanceId.length > 200) {
    throw badRequest('clientInstanceId must contain 1 to 200 characters');
  }
  if (record.clientKind !== 'mobile' && record.clientKind !== 'portal') {
    throw badRequest('clientKind must be mobile or portal');
  }
  const rawLabel = typeof record.clientLabel === 'string' ? record.clientLabel.trim() : '';
  if (rawLabel.length > 200) throw badRequest('clientLabel must be at most 200 characters');
  return {
    clientInstanceId,
    clientKind: record.clientKind,
    clientLabel: rawLabel || null,
  };
}

export function parseEcoAuditLeaseRequest(body: unknown): EcoAuditLeaseRequest {
  const client = parseEcoAuditEditClient(body);
  const record = body as Record<string, unknown>;
  return {
    ...client,
    expectedTreeRevision: nonNegativeInteger(
      record.expectedTreeRevision,
      'expectedTreeRevision',
    ),
  };
}

export function isEcoAuditProtocolV2(request: FastifyRequest): boolean {
  return headerValue(request, 'x-ecoaudit-protocol-version') === ECOAUDIT_PROTOCOL_VERSION;
}

/**
 * Transitional gate for endpoints (such as create and acquire) that do not
 * carry a lease token yet. Once the rollout flag is enabled, every caller must
 * identify itself as a v2 client before it can create or mutate an audit.
 */
export function assertEcoAuditProtocolCompatibility(request: FastifyRequest): void {
  if (!isEcoAuditProtocolV2(request) && config.ecoauditEditProtocolRequired) {
    throw conflict('ecoaudit_client_upgrade_required');
  }
}

export function parseEcoAuditWriteContext(
  request: FastifyRequest,
  options: { requireIdempotencyKey?: boolean } = {},
): EcoAuditWriteContext | null {
  if (!isEcoAuditProtocolV2(request)) {
    if (config.ecoauditEditProtocolRequired) {
      throw conflict('ecoaudit_client_upgrade_required');
    }
    return null;
  }
  const clientInstanceId = headerValue(request, 'x-ecoaudit-client-instance-id');
  const leaseToken = headerValue(request, 'x-ecoaudit-lease-token');
  if (!clientInstanceId || clientInstanceId.length > 200) {
    throw badRequest('X-EcoAudit-Client-Instance-Id is required');
  }
  if (!leaseToken || leaseToken.length > 512) {
    throw badRequest('X-EcoAudit-Lease-Token is required');
  }
  const idempotencyKey = headerValue(request, 'idempotency-key');
  if (options.requireIdempotencyKey && !idempotencyKey) {
    throw badRequest('Idempotency-Key is required');
  }
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw badRequest('Idempotency-Key must be at most 200 characters');
  }
  return {
    clientInstanceId,
    leaseFence: positiveInteger(
      headerValue(request, 'x-ecoaudit-lease-fence'),
      'X-EcoAudit-Lease-Fence',
    ),
    leaseToken,
    baseTreeRevision: nonNegativeInteger(
      headerValue(request, 'x-ecoaudit-base-tree-revision'),
      'X-EcoAudit-Base-Tree-Revision',
    ),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export function ecoAuditClientInstanceId(request: FastifyRequest): string | undefined {
  return headerValue(request, 'x-ecoaudit-client-instance-id');
}

export function parseEcoAuditBaseRevisionContext(
  request: FastifyRequest,
): EcoAuditBaseRevisionContext {
  if (!isEcoAuditProtocolV2(request)) {
    throw conflict('ecoaudit_client_upgrade_required');
  }
  const clientInstanceId = headerValue(request, 'x-ecoaudit-client-instance-id');
  if (!clientInstanceId || clientInstanceId.length > 200) {
    throw badRequest('X-EcoAudit-Client-Instance-Id is required');
  }
  const clientKind = headerValue(request, 'x-ecoaudit-client-kind');
  if (clientKind !== 'mobile' && clientKind !== 'portal') {
    throw badRequest('X-EcoAudit-Client-Kind must be mobile or portal');
  }
  return {
    clientInstanceId,
    clientKind,
    baseTreeRevision: nonNegativeInteger(
      headerValue(request, 'x-ecoaudit-base-tree-revision'),
      'X-EcoAudit-Base-Tree-Revision',
    ),
  };
}

export function assertEcoAuditCompletedPhotoMetadataClient(
  user: AuthUser,
  context: EcoAuditBaseRevisionContext,
  currentTreeRevision: number,
): void {
  // Client kind is caller-declared routing intent, not authorization. The
  // elevated JWT role is the trusted boundary for post-completion corrections.
  if (context.clientKind !== 'portal') {
    throw conflict('audit_completed_photo_metadata_portal_only');
  }
  if (!isElevated(user)) {
    throw forbidden('audit_completed_photo_metadata_admin_required');
  }
  if (context.baseTreeRevision !== currentTreeRevision) {
    throw conflict('audit_tree_revision_changed');
  }
}

export function assertEcoAuditCompletedPhotoMetadataRequest(
  user: AuthUser,
  request: FastifyRequest,
  currentTreeRevision: number,
): void {
  const context = parseEcoAuditBaseRevisionContext(request);
  assertEcoAuditCompletedPhotoMetadataClient(user, context, currentTreeRevision);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function newLeaseToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + config.ecoauditEditLeaseTtlSeconds * 1000);
}

export function presentEcoAuditLease(
  lease: typeof eaAuditEditLeases.$inferSelect | undefined,
  caller?: { userId: string; clientInstanceId?: string },
) {
  if (!lease) return null;
  return {
    fence: lease.fence,
    ownerUserId: lease.ownerUserId,
    clientInstanceId: lease.clientInstanceId,
    clientKind: lease.clientKind as EcoAuditClientKind,
    clientLabel: lease.clientLabel,
    acquiredAt: lease.acquiredAt,
    lastSeenAt: lease.lastSeenAt,
    expiresAt: lease.expiresAt,
    stale: lease.expiresAt.getTime() <= Date.now(),
    ownedByCaller: Boolean(
      caller
      && caller.userId === lease.ownerUserId
      && caller.clientInstanceId === lease.clientInstanceId
    ),
  };
}

export async function loadEcoAuditLease(
  executor: any,
  auditId: string,
): Promise<typeof eaAuditEditLeases.$inferSelect | undefined> {
  const [lease] = await executor.select().from(eaAuditEditLeases)
    .where(eq(eaAuditEditLeases.auditId, auditId));
  return lease;
}

/**
 * Legacy mutations are limited to aggregates that have never entered the v2
 * ownership protocol. editFence is durable after release/completion, so a
 * missing lease row can never silently downgrade a previously fenced audit.
 */
export function assertEcoAuditLegacyMutationAllowed(
  audit: Pick<typeof eaAudits.$inferSelect, 'editFence'>,
  lease: typeof eaAuditEditLeases.$inferSelect | undefined,
): void {
  if (lease) throw conflict('audit_edit_lease_held');
  if (audit.editFence > 0) throw conflict('ecoaudit_client_upgrade_required');
}

/**
 * A protected client must never revive an audit which has been deliberately
 * soft-deleted.  Use an existing protocol error so deployed v2 clients fail
 * closed instead of treating this as a retryable, unknown conflict.
 */
export function assertEcoAuditSyncTargetActive(
  audit: Pick<typeof eaAudits.$inferSelect, 'deletedAt' | 'status'>,
  protocolV2: boolean,
): void {
  if (protocolV2 && audit.deletedAt) throw conflict('audit_edit_lease_invalid');
  if (!protocolV2 && audit.status === 'Completed') {
    throw conflict('audit_completed_reopen_requires_explicit_transition');
  }
}

export function assertEcoAuditCreateIdNotPurged(
  tombstone: { auditId: string } | undefined,
): void {
  if (tombstone) throw conflict('audit_id_permanently_purged');
}

export function ecoAuditCompletionFence(
  editFence: number,
  protectedTransition: boolean,
): number {
  return protectedTransition ? editFence + 1 : editFence;
}

/**
 * POST acquire is only for an unclaimed audit. Even an expired lease remains
 * an ownership claim: its holder must prove the existing token and fence via
 * PUT renewal, or an administrator must use the audited takeover endpoint.
 */
export function assertEcoAuditLeaseAvailableForAcquire(
  audit: Pick<typeof eaAudits.$inferSelect, 'editFence'>,
  lease: typeof eaAuditEditLeases.$inferSelect | undefined,
): void {
  if (lease) throw conflict('audit_edit_lease_held');
  if (audit.editFence > 0) throw conflict('audit_edit_lease_invalid');
}

export function assertEcoAuditCopySourceEligible(
  audit: Pick<typeof eaAudits.$inferSelect, 'status' | 'treeRevision' | 'editFence'>,
  lease: typeof eaAuditEditLeases.$inferSelect | undefined,
  input: { protocolV2: boolean; expectedTreeRevision?: number },
): void {
  if (!input.protocolV2) assertEcoAuditLegacyMutationAllowed(audit, lease);
  if (audit.status !== 'Completed') throw conflict('audit_copy_requires_completed_source');
  if (input.protocolV2 && audit.treeRevision !== input.expectedTreeRevision) {
    throw conflict('audit_source_revision_changed');
  }
  if (lease) throw conflict('audit_edit_lease_held');
}

export async function lockEcoAuditForMutation(
  executor: any,
  input: {
    auditId: string;
    user: AuthUser;
    request: FastifyRequest;
    allowCompletedWithoutLease?: boolean;
    requireIdempotencyKey?: boolean;
  },
): Promise<LockedAuditMutation> {
  const [audit] = await executor.select().from(eaAudits).where(and(
    eq(eaAudits.id, input.auditId),
    isNull(eaAudits.deletedAt),
  )).for('update');
  const found = assertFound(audit, 'Audit');
  assertAuditAccess(found, input.user);
  const lease = await loadEcoAuditLease(executor, found.id);
  if (input.allowCompletedWithoutLease && found.status === 'Completed') {
    // This helper is intentionally unconditional: the completed-record
    // exception is never part of the legacy-write rollout window.
    assertEcoAuditCompletedPhotoMetadataRequest(input.user, input.request, found.treeRevision);
    if (lease) throw conflict('audit_edit_lease_held');
    return { audit: found, lease, writeContext: null };
  }

  const writeContext = parseEcoAuditWriteContext(input.request, {
    requireIdempotencyKey: input.requireIdempotencyKey,
  });
  if (found.status === 'Completed') throw conflict('audit_completed_copy_required');
  if (!writeContext) {
    assertEcoAuditLegacyMutationAllowed(found, lease);
    return { audit: found, lease, writeContext };
  }
  if (!lease) throw conflict('audit_edit_lease_required');
  if (
    lease.ownerUserId !== input.user.userId
    || lease.clientInstanceId !== writeContext.clientInstanceId
  ) {
    throw conflict('audit_edit_lease_held');
  }
  if (
    lease.fence !== writeContext.leaseFence
    || found.editFence !== writeContext.leaseFence
    || !tokenMatches(writeContext.leaseToken, lease.tokenHash)
  ) {
    throw conflict('audit_edit_lease_invalid');
  }
  if (lease.expiresAt.getTime() <= Date.now()) {
    throw conflict('audit_edit_lease_expired');
  }
  if (found.treeRevision !== writeContext.baseTreeRevision) {
    throw conflict('audit_tree_revision_changed');
  }
  return { audit: found, lease, writeContext };
}

/** Validate a parsed v2 write context against an already locked audit row. */
export function assertEcoAuditLeaseAuthority(input: {
  audit: typeof eaAudits.$inferSelect;
  lease: typeof eaAuditEditLeases.$inferSelect | undefined;
  user: AuthUser;
  context: EcoAuditWriteContext;
}): void {
  if (!input.lease) throw conflict('audit_edit_lease_required');
  if (
    input.lease.ownerUserId !== input.user.userId
    || input.lease.clientInstanceId !== input.context.clientInstanceId
  ) {
    throw conflict('audit_edit_lease_held');
  }
  if (
    input.lease.fence !== input.context.leaseFence
    || input.audit.editFence !== input.context.leaseFence
    || !tokenMatches(input.context.leaseToken, input.lease.tokenHash)
  ) {
    throw conflict('audit_edit_lease_invalid');
  }
  if (input.lease.expiresAt.getTime() <= Date.now()) {
    throw conflict('audit_edit_lease_expired');
  }
  if (input.audit.treeRevision !== input.context.baseTreeRevision) {
    throw conflict('audit_tree_revision_changed');
  }
}

export async function bumpEcoAuditTreeRevision(
  executor: any,
  locked: LockedAuditMutation,
  changes: Partial<typeof eaAudits.$inferInsert> = {},
): Promise<typeof eaAudits.$inferSelect> {
  const now = nextAuditUpdatedAt(locked.audit.updatedAt);
  const treeRevision = locked.audit.treeRevision + 1;
  const [updated] = await executor.update(eaAudits).set({
    ...changes,
    treeRevision,
    updatedAt: now,
    syncStatus: 'synced',
  }).where(and(
    eq(eaAudits.id, locked.audit.id),
    eq(eaAudits.treeRevision, locked.audit.treeRevision),
  )).returning();
  if (!updated) throw conflict('audit_tree_revision_changed');
  if (locked.lease && locked.writeContext) {
    await executor.update(eaAuditEditLeases).set({
      lastSeenAt: now,
      expiresAt: leaseExpiry(now),
    }).where(and(
      eq(eaAuditEditLeases.auditId, locked.audit.id),
      eq(eaAuditEditLeases.fence, locked.lease.fence),
    ));
  }
  return updated;
}

async function appendLeaseEvent(
  executor: any,
  input: {
    auditId: string;
    fence: number;
    eventType: 'acquired' | 'reissued' | 'released' | 'taken_over' | 'completed';
    actorUserId: string;
    clientInstanceId: string;
    clientKind: EcoAuditClientKind;
    previousOwnerUserId?: string | null;
    previousClientInstanceId?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  await executor.insert(eaAuditEditLeaseEvents).values({
    id: randomUUID(),
    auditId: input.auditId,
    fence: input.fence,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    clientInstanceId: input.clientInstanceId,
    clientKind: input.clientKind,
    previousOwnerUserId: input.previousOwnerUserId ?? null,
    previousClientInstanceId: input.previousClientInstanceId ?? null,
    reason: input.reason ?? null,
  });
}

export async function createEcoAuditLeaseForNewAudit(
  executor: any,
  input: {
    auditId: string;
    actorUserId: string;
    client: EcoAuditEditClient;
    fence?: number;
    leaseToken?: string;
  },
) {
  const now = new Date();
  const fence = input.fence ?? 1;
  const generated = input.leaseToken
    ? { token: input.leaseToken, hash: tokenHash(input.leaseToken) }
    : newLeaseToken();
  const [lease] = await executor.insert(eaAuditEditLeases).values({
    auditId: input.auditId,
    fence,
    ownerUserId: input.actorUserId,
    clientInstanceId: input.client.clientInstanceId,
    clientKind: input.client.clientKind,
    clientLabel: input.client.clientLabel,
    tokenHash: generated.hash,
    acquiredAt: now,
    lastSeenAt: now,
    expiresAt: leaseExpiry(now),
  }).returning();
  const saved = assertFound(lease, 'Audit edit lease');
  await appendLeaseEvent(executor, {
    auditId: input.auditId,
    fence,
    eventType: 'acquired',
    actorUserId: input.actorUserId,
    clientInstanceId: input.client.clientInstanceId,
    clientKind: input.client.clientKind,
  });
  return { lease: saved, leaseToken: generated.token };
}

function recoverCommandLease(input: {
  audit: typeof eaAudits.$inferSelect;
  lease: typeof eaAuditEditLeases.$inferSelect | undefined;
  user: AuthUser;
  client: EcoAuditEditClient;
  operation: 'create' | 'copy' | 'acquire';
  idempotencyKey: string;
  expectedTreeRevision: number;
  expectedFence: number;
}) {
  if (input.audit.status === 'Completed') throw conflict('audit_completed_copy_required');
  if (!input.lease) throw conflict('audit_edit_lease_required');
  if (
    input.audit.treeRevision !== input.expectedTreeRevision
    || input.audit.editFence !== input.expectedFence
    || input.lease.fence !== input.expectedFence
  ) {
    throw conflict('audit_edit_lease_invalid');
  }
  if (
    input.lease.ownerUserId !== input.user.userId
    || input.lease.clientInstanceId !== input.client.clientInstanceId
  ) {
    throw conflict('audit_edit_lease_held');
  }
  const leaseToken = ecoAuditCommandLeaseToken({
    auditId: input.audit.id,
    operation: input.operation,
    actorUserId: input.user.userId,
    clientInstanceId: input.client.clientInstanceId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!tokenMatches(leaseToken, input.lease.tokenHash)) {
    throw conflict('audit_edit_lease_invalid');
  }
  return {
    audit: input.audit,
    lease: input.lease,
    treeRevision: input.audit.treeRevision,
    editFence: input.audit.editFence,
    leaseToken,
    editLease: presentEcoAuditLease(input.lease, {
      userId: input.user.userId,
      clientInstanceId: input.client.clientInstanceId,
    }),
  };
}

export async function acquireEcoAuditEditLease(
  input: {
    auditId: string;
    user: AuthUser;
    lease: EcoAuditLeaseRequest;
    idempotencyKey: string;
  },
) {
  return db.transaction(async (tx) => {
    const [audit] = await tx.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.auditId),
      isNull(eaAudits.deletedAt),
    )).for('update');
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, input.user);
    if (found.status === 'Completed') throw conflict('audit_completed_copy_required');
    const requestFingerprint = canonicalCommandFingerprint({
      operation: 'acquire',
      auditId: found.id,
      lease: input.lease,
    });
    const replay = await replayEcoAuditCommand(tx, {
      auditId: found.id,
      operation: 'acquire',
      actorUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
    });
    if (replay) {
      const current = await loadEcoAuditLease(tx, found.id);
      return recoverCommandLease({
        audit: found,
        lease: current,
        user: input.user,
        client: input.lease,
        operation: 'acquire',
        idempotencyKey: input.idempotencyKey,
        expectedTreeRevision: Number(replay.treeRevision),
        expectedFence: Number(replay.editFence),
      });
    }
    if (found.treeRevision !== input.lease.expectedTreeRevision) {
      throw conflict('audit_tree_revision_changed');
    }
    const current = await loadEcoAuditLease(tx, found.id);
    assertEcoAuditLeaseAvailableForAcquire(found, current);

    const now = new Date();
    const leaseToken = ecoAuditCommandLeaseToken({
      auditId: found.id,
      operation: 'acquire',
      actorUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      idempotencyKey: input.idempotencyKey,
    });
    const nextFence = found.editFence + 1;
    const nextTreeRevision = found.treeRevision + 1;
    const [updatedAudit] = await tx.update(eaAudits).set({
      editFence: nextFence,
      treeRevision: nextTreeRevision,
      updatedAt: nextAuditUpdatedAt(found.updatedAt, now),
    }).where(and(
      eq(eaAudits.id, found.id),
      eq(eaAudits.editFence, found.editFence),
      eq(eaAudits.treeRevision, found.treeRevision),
    )).returning();
    if (!updatedAudit) throw conflict('audit_tree_revision_changed');

    const values = {
      auditId: found.id,
      fence: nextFence,
      ownerUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      clientKind: input.lease.clientKind,
      clientLabel: input.lease.clientLabel,
      tokenHash: tokenHash(leaseToken),
      acquiredAt: now,
      lastSeenAt: now,
      expiresAt: leaseExpiry(now),
    };
    const [savedLease] = await tx.insert(eaAuditEditLeases).values(values).returning();
    const lockedLease = assertFound(savedLease, 'Audit edit lease');
    await appendLeaseEvent(tx, {
      auditId: found.id,
      fence: nextFence,
      eventType: 'acquired',
      actorUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      clientKind: input.lease.clientKind,
    });
    await saveEcoAuditCommand(tx, {
      auditId: found.id,
      operation: 'acquire',
      actorUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      baseTreeRevision: input.lease.expectedTreeRevision,
      resultingTreeRevision: nextTreeRevision,
      recordVersionNumber: found.recordVersionNumber,
      result: {
        auditId: found.id,
        treeRevision: nextTreeRevision,
        editFence: nextFence,
      },
    });
    return {
      auditId: found.id,
      treeRevision: nextTreeRevision,
      editFence: nextFence,
      leaseToken,
      editLease: presentEcoAuditLease(lockedLease, {
        userId: input.user.userId,
        clientInstanceId: input.lease.clientInstanceId,
      }),
    };
  });
}

/**
 * Recover the exact initial lease response after a create/copy command replay.
 * The original command and every exact retry derive the same token, fence and
 * revision, so retries cannot rotate ownership or return fences out of order.
 */
export async function recoverEcoAuditEditLeaseAfterCommandReplay(input: {
  auditId: string;
  user: AuthUser;
  client: EcoAuditEditClient;
  operation: 'create' | 'copy';
  idempotencyKey: string;
  expectedTreeRevision: number;
  expectedFence: number;
}) {
  return db.transaction(async (tx) => {
    const [audit] = await tx.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.auditId),
      isNull(eaAudits.deletedAt),
    )).for('update');
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, input.user);
    const current = await loadEcoAuditLease(tx, found.id);
    return recoverCommandLease({
      audit: found,
      lease: current,
      user: input.user,
      client: input.client,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      expectedTreeRevision: input.expectedTreeRevision,
      expectedFence: input.expectedFence,
    });
  });
}

export async function renewEcoAuditEditLease(input: {
  auditId: string;
  user: AuthUser;
  request: FastifyRequest;
}) {
  const context = parseEcoAuditWriteContext(input.request);
  if (!context) throw conflict('ecoaudit_client_upgrade_required');
  return db.transaction(async (tx) => {
    const [audit] = await tx.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.auditId),
      isNull(eaAudits.deletedAt),
    )).for('update');
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, input.user);
    const lease = await loadEcoAuditLease(tx, found.id);
    if (!lease) throw conflict('audit_edit_lease_required');
    if (
      lease.ownerUserId !== input.user.userId
      || lease.clientInstanceId !== context.clientInstanceId
    ) throw conflict('audit_edit_lease_held');
    if (
      lease.fence !== context.leaseFence
      || found.editFence !== context.leaseFence
      || !tokenMatches(context.leaseToken, lease.tokenHash)
    ) throw conflict('audit_edit_lease_invalid');
    const now = new Date();
    const [renewed] = await tx.update(eaAuditEditLeases).set({
      lastSeenAt: now,
      expiresAt: leaseExpiry(now),
    }).where(and(
      eq(eaAuditEditLeases.auditId, found.id),
      eq(eaAuditEditLeases.fence, lease.fence),
    )).returning();
    const saved = assertFound(renewed, 'Audit edit lease');
    return {
      auditId: found.id,
      treeRevision: found.treeRevision,
      editFence: found.editFence,
      editLease: presentEcoAuditLease(saved, {
        userId: input.user.userId,
        clientInstanceId: context.clientInstanceId,
      }),
    };
  });
}

export async function releaseEcoAuditEditLease(input: {
  auditId: string;
  user: AuthUser;
  request: FastifyRequest;
}) {
  // Draft ownership cannot be voluntarily dropped and claimed by another
  // device. Completion, protected deletion, or audited admin takeover are the
  // only ownership-ending transitions.
  void input;
  throw conflict('audit_edit_release_requires_completion');
}

export async function takeOverEcoAuditEditLease(input: {
  auditId: string;
  user: AuthUser;
  lease: EcoAuditLeaseRequest;
  reason: string;
}) {
  if (input.user.role !== 'admin' && input.user.role !== 'service_account') {
    throw conflict('audit_edit_takeover_requires_admin');
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw badRequest('reason must contain 3 to 1000 characters');
  }
  return db.transaction(async (tx) => {
    const [audit] = await tx.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.auditId),
      isNull(eaAudits.deletedAt),
    )).for('update');
    const found = assertFound(audit, 'Audit');
    assertAuditAccess(found, input.user);
    if (found.status === 'Completed') throw conflict('audit_completed_copy_required');
    if (found.treeRevision !== input.lease.expectedTreeRevision) {
      throw conflict('audit_tree_revision_changed');
    }
    const current = await loadEcoAuditLease(tx, found.id);
    const now = new Date();
    const nextToken = newLeaseToken();
    const nextFence = found.editFence + 1;
    const nextTreeRevision = found.treeRevision + 1;
    const [updated] = await tx.update(eaAudits).set({
      editFence: nextFence,
      treeRevision: nextTreeRevision,
      updatedAt: nextAuditUpdatedAt(found.updatedAt, now),
    }).where(and(
      eq(eaAudits.id, found.id),
      eq(eaAudits.treeRevision, found.treeRevision),
      eq(eaAudits.editFence, found.editFence),
    )).returning();
    if (!updated) throw conflict('audit_tree_revision_changed');
    const values = {
      auditId: found.id,
      fence: nextFence,
      ownerUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      clientKind: input.lease.clientKind,
      clientLabel: input.lease.clientLabel,
      tokenHash: nextToken.hash,
      acquiredAt: now,
      lastSeenAt: now,
      expiresAt: leaseExpiry(now),
    };
    const [saved] = current
      ? await tx.update(eaAuditEditLeases).set(values).where(
          eq(eaAuditEditLeases.auditId, found.id),
        ).returning()
      : await tx.insert(eaAuditEditLeases).values(values).returning();
    const lease = assertFound(saved, 'Audit edit lease');
    await appendLeaseEvent(tx, {
      auditId: found.id,
      fence: nextFence,
      eventType: 'taken_over',
      actorUserId: input.user.userId,
      clientInstanceId: input.lease.clientInstanceId,
      clientKind: input.lease.clientKind,
      previousOwnerUserId: current?.ownerUserId,
      previousClientInstanceId: current?.clientInstanceId,
      reason,
    });
    return {
      auditId: found.id,
      treeRevision: nextTreeRevision,
      editFence: nextFence,
      leaseToken: nextToken.token,
      editLease: presentEcoAuditLease(lease, {
        userId: input.user.userId,
        clientInstanceId: input.lease.clientInstanceId,
      }),
    };
  });
}

export async function completeEcoAuditLease(
  executor: any,
  input: {
    audit: typeof eaAudits.$inferSelect;
    lease: typeof eaAuditEditLeases.$inferSelect | undefined;
    actorUserId: string;
    resultingFence: number;
  },
): Promise<void> {
  if (!input.lease) return;
  await executor.delete(eaAuditEditLeases).where(and(
    eq(eaAuditEditLeases.auditId, input.audit.id),
    eq(eaAuditEditLeases.fence, input.lease.fence),
  ));
  await appendLeaseEvent(executor, {
    auditId: input.audit.id,
    fence: input.resultingFence,
    eventType: 'completed',
    actorUserId: input.actorUserId,
    clientInstanceId: input.lease.clientInstanceId,
    clientKind: input.lease.clientKind as EcoAuditClientKind,
  });
}

export function setEcoAuditRevisionHeader(reply: FastifyReply, revision: number): void {
  reply.header('X-EcoAudit-Tree-Revision', String(revision));
}

export function canonicalCommandFingerprint(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${stable(record[key])}`
      )).join(',')}}`;
    }
    return JSON.stringify(item) ?? 'null';
  };
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

export async function replayEcoAuditCommand(
  executor: any,
  input: {
    auditId: string;
    operation: string;
    actorUserId: string;
    clientInstanceId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<Record<string, unknown> | null> {
  const storedKey = ecoAuditIdempotencyStorageKey(input.idempotencyKey);
  const [prior] = await executor.select().from(eaAuditIdempotency).where(and(
    eq(eaAuditIdempotency.auditId, input.auditId),
    eq(eaAuditIdempotency.operation, input.operation),
    eq(eaAuditIdempotency.actorUserId, input.actorUserId),
    eq(eaAuditIdempotency.clientInstanceId, input.clientInstanceId),
    or(
      eq(eaAuditIdempotency.idempotencyKey, storedKey),
      // Temporary read compatibility for any pre-hardening command rows.
      eq(eaAuditIdempotency.idempotencyKey, input.idempotencyKey),
    ),
  ));
  if (!prior) return null;
  if (prior.requestFingerprint !== input.requestFingerprint) {
    throw conflict('idempotency_key_reused');
  }
  return prior.result;
}

export async function saveEcoAuditCommand(
  executor: any,
  input: {
    auditId: string;
    operation: string;
    actorUserId: string;
    clientInstanceId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    baseTreeRevision: number;
    resultingTreeRevision: number;
    recordVersionNumber: number;
    result: Record<string, unknown>;
  },
): Promise<void> {
  await executor.insert(eaAuditIdempotency).values({
    id: randomUUID(),
    ...input,
    idempotencyKey: ecoAuditIdempotencyStorageKey(input.idempotencyKey),
  });
}
