import { ApiError } from '@/api/client';
import type {
  Audit,
  AuditEditLease,
  AuditMutationGuard,
  AuditPhotoMetadataGuard,
  AuditWriteGuard,
} from '@/types/domain';

const CLIENT_INSTANCE_KEY = 'ea_edit_client_instance_v1';
const LEASE_KEY_PREFIX = 'ea_edit_lease_v1:';
const PENDING_COMMAND_KEY_PREFIX = 'ea_pending_audit_command_v1:';
const HIGH_ENTROPY_COMMAND_KEY = /(?:^|[-:])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const ECOAUDIT_PROTOCOL_VERSION = '2';
export const ECOAUDIT_PORTAL_CLIENT_LABEL = 'EcoSense web portal';
export const AUDIT_LEASE_RENEW_FALLBACK_LEAD_MS = 60_000;
export const AUDIT_LEASE_RENEW_MIN_DELAY_MS = 1_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let volatileClientInstanceId: string | null = null;
const volatileAuditLeases = new Map<string, StoredAuditLease>();

export type StoredAuditLease = {
  version: 1;
  auditId: string;
  clientInstanceId: string;
  leaseToken: string;
  editFence: number;
};

export type PendingAuditEditClient = {
  clientInstanceId: string;
  clientKind: 'portal';
  clientLabel: typeof ECOAUDIT_PORTAL_CLIENT_LABEL;
};

export type PendingAuditCreateCommand = {
  version: 1;
  kind: 'create';
  actorUserId: string;
  clientInstanceId: string;
  idempotencyKey: string;
  createdAt: string;
  body: {
    siteName: string;
    siteAddress: string;
    inspectorName: string;
    auditDate: string | null;
    editClient: PendingAuditEditClient;
    idempotencyKey: string;
  };
};

export type PendingAuditCopyCommand = {
  version: 1;
  kind: 'copy';
  sourceAuditId: string;
  actorUserId: string;
  clientInstanceId: string;
  idempotencyKey: string;
  createdAt: string;
  body: {
    purpose: 'amendment';
    includeChildren: true;
    expectedTreeRevision: number;
    editClient: PendingAuditEditClient;
    idempotencyKey: string;
  };
};

export type PendingAuditAcquireCommand = {
  version: 1;
  kind: 'acquire';
  auditId: string;
  actorUserId: string;
  clientInstanceId: string;
  idempotencyKey: string;
  createdAt: string;
  body: {
    clientInstanceId: string;
    clientKind: 'portal';
    clientLabel: typeof ECOAUDIT_PORTAL_CLIENT_LABEL;
    expectedTreeRevision: number;
    idempotencyKey: string;
  };
};

export type PendingAuditCommand =
  | PendingAuditCreateCommand
  | PendingAuditCopyCommand
  | PendingAuditAcquireCommand;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `portal-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export function getAuditClientInstanceId(
  storage: StorageLike | null = browserStorage(),
  createId: () => string = randomClientId,
): string {
  if (!storage) {
    volatileClientInstanceId ??= createId();
    return volatileClientInstanceId;
  }
  try {
    const current = storage.getItem(CLIENT_INSTANCE_KEY)?.trim();
    if (current) return current;
  } catch {
    volatileClientInstanceId ??= createId();
    return volatileClientInstanceId;
  }
  const created = createId();
  try {
    storage.setItem(CLIENT_INSTANCE_KEY, created);
    return created;
  } catch {
    volatileClientInstanceId ??= created;
    return volatileClientInstanceId;
  }
}

function leaseStorageKey(auditId: string): string {
  return `${LEASE_KEY_PREFIX}${encodeURIComponent(auditId)}`;
}

function pendingCommandStorageKey(
  kind: PendingAuditCommand['kind'],
  actorUserId: string,
  auditId?: string,
): string {
  const actor = encodeURIComponent(actorUserId);
  return kind === 'create'
    ? `${PENDING_COMMAND_KEY_PREFIX}create:${actor}`
    : `${PENDING_COMMAND_KEY_PREFIX}${kind}:${actor}:${encodeURIComponent(auditId ?? '')}`;
}

function validFence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseStoredLease(value: unknown): StoredAuditLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<StoredAuditLease>;
  if (
    record.version !== 1
    || typeof record.auditId !== 'string'
    || !record.auditId
    || typeof record.clientInstanceId !== 'string'
    || !record.clientInstanceId
    || typeof record.leaseToken !== 'string'
    || !record.leaseToken
    || !validFence(record.editFence)
  ) return null;
  return record as StoredAuditLease;
}

export function storeAuditLease(
  input: Omit<StoredAuditLease, 'version'>,
  storage: StorageLike | null = browserStorage(),
): boolean {
  const lease = parseStoredLease({ version: 1, ...input });
  if (!lease) return false;
  if (!storage) {
    volatileAuditLeases.set(input.auditId, lease);
    return true;
  }
  try {
    storage.setItem(leaseStorageKey(input.auditId), JSON.stringify(lease));
    return true;
  } catch {
    volatileAuditLeases.set(input.auditId, lease);
    return true;
  }
}

/** Command recovery is safe to retire only after the returned lease proof can
 * survive a reload. Volatile fallback is deliberately not accepted here. */
export function storeAuditLeaseDurably(
  input: Omit<StoredAuditLease, 'version'>,
  storage: StorageLike | null = browserStorage(),
): boolean {
  const lease = parseStoredLease({ version: 1, ...input });
  if (!lease || !storage) return false;
  const serialized = JSON.stringify(lease);
  try {
    storage.setItem(leaseStorageKey(input.auditId), serialized);
    return storage.getItem(leaseStorageKey(input.auditId)) === serialized;
  } catch {
    return false;
  }
}

export function getStoredAuditLease(
  auditId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): StoredAuditLease | null {
  const volatile = volatileAuditLeases.get(auditId);
  if (!storage) return volatile?.clientInstanceId === clientInstanceId ? volatile : null;
  try {
    const raw = storage.getItem(leaseStorageKey(auditId));
    if (!raw) return volatile?.clientInstanceId === clientInstanceId ? volatile : null;
    const parsed = parseStoredLease(JSON.parse(raw) as unknown);
    if (!parsed || parsed.auditId !== auditId || parsed.clientInstanceId !== clientInstanceId) {
      storage.removeItem(leaseStorageKey(auditId));
      volatileAuditLeases.delete(auditId);
      return null;
    }
    return parsed;
  } catch {
    return volatile?.clientInstanceId === clientInstanceId ? volatile : null;
  }
}

export function clearStoredAuditLease(
  auditId: string,
  storage: StorageLike | null = browserStorage(),
): void {
  volatileAuditLeases.delete(auditId);
  try { storage?.removeItem(leaseStorageKey(auditId)); } catch { /* ignored */ }
}

function parsePendingAuditEditClient(value: unknown): PendingAuditEditClient | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PendingAuditEditClient>;
  if (
    typeof record.clientInstanceId !== 'string'
    || !record.clientInstanceId.trim()
    || record.clientKind !== 'portal'
    || record.clientLabel !== ECOAUDIT_PORTAL_CLIENT_LABEL
  ) return null;
  return {
    clientInstanceId: record.clientInstanceId,
    clientKind: 'portal',
    clientLabel: ECOAUDIT_PORTAL_CLIENT_LABEL,
  };
}

function validCommandIdentity(record: {
  version?: unknown;
  actorUserId?: unknown;
  clientInstanceId?: unknown;
  idempotencyKey?: unknown;
  createdAt?: unknown;
}): record is Record<string, unknown> & {
  version: 1;
  actorUserId: string;
  clientInstanceId: string;
  idempotencyKey: string;
  createdAt: string;
} {
  return record.version === 1
    && typeof record.actorUserId === 'string'
    && Boolean(record.actorUserId.trim())
    && typeof record.clientInstanceId === 'string'
    && Boolean(record.clientInstanceId.trim())
    && typeof record.idempotencyKey === 'string'
    && record.idempotencyKey.length <= 200
    && HIGH_ENTROPY_COMMAND_KEY.test(record.idempotencyKey)
    && typeof record.createdAt === 'string'
    && Number.isFinite(Date.parse(record.createdAt));
}

function parsePendingAuditCommand(value: unknown): PendingAuditCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!validCommandIdentity(record)) return null;
  if (!record.body || typeof record.body !== 'object' || Array.isArray(record.body)) return null;
  const body = record.body as Record<string, unknown>;

  if (record.kind === 'create') {
    const editClient = parsePendingAuditEditClient(body.editClient);
    if (
      !editClient
      || editClient.clientInstanceId !== record.clientInstanceId
      || body.idempotencyKey !== record.idempotencyKey
      || typeof body.siteName !== 'string'
      || typeof body.siteAddress !== 'string'
      || typeof body.inspectorName !== 'string'
      || (body.auditDate !== null && typeof body.auditDate !== 'string')
    ) return null;
    return {
      version: 1,
      kind: 'create',
      actorUserId: record.actorUserId,
      clientInstanceId: record.clientInstanceId,
      idempotencyKey: record.idempotencyKey,
      createdAt: record.createdAt,
      body: {
        siteName: body.siteName,
        siteAddress: body.siteAddress,
        inspectorName: body.inspectorName,
        auditDate: body.auditDate,
        editClient,
        idempotencyKey: record.idempotencyKey,
      },
    };
  }

  if (record.kind === 'copy') {
    const editClient = parsePendingAuditEditClient(body.editClient);
    if (
      !editClient
      || editClient.clientInstanceId !== record.clientInstanceId
      || body.idempotencyKey !== record.idempotencyKey
      || typeof record.sourceAuditId !== 'string'
      || !record.sourceAuditId.trim()
      || body.purpose !== 'amendment'
      || body.includeChildren !== true
      || !Number.isSafeInteger(body.expectedTreeRevision)
      || Number(body.expectedTreeRevision) < 0
    ) return null;
    return {
      version: 1,
      kind: 'copy',
      sourceAuditId: record.sourceAuditId,
      actorUserId: record.actorUserId,
      clientInstanceId: record.clientInstanceId,
      idempotencyKey: record.idempotencyKey,
      createdAt: record.createdAt,
      body: {
        purpose: 'amendment',
        includeChildren: true,
        expectedTreeRevision: Number(body.expectedTreeRevision),
        editClient,
        idempotencyKey: record.idempotencyKey,
      },
    };
  }

  const editClient = parsePendingAuditEditClient(body);
  if (
    record.kind !== 'acquire'
    || typeof record.auditId !== 'string'
    || !record.auditId.trim()
    || !editClient
    || editClient.clientInstanceId !== record.clientInstanceId
    || body.idempotencyKey !== record.idempotencyKey
    || !Number.isSafeInteger(body.expectedTreeRevision)
    || Number(body.expectedTreeRevision) < 0
  ) return null;
  return {
    version: 1,
    kind: 'acquire',
    auditId: record.auditId,
    actorUserId: record.actorUserId,
    clientInstanceId: record.clientInstanceId,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt,
    body: {
      ...editClient,
      expectedTreeRevision: Number(body.expectedTreeRevision),
      idempotencyKey: record.idempotencyKey,
    },
  };
}

function readPendingAuditCommand(
  key: string,
  expectedKind: PendingAuditCommand['kind'],
  actorUserId: string,
  clientInstanceId: string,
  storage: StorageLike | null,
): PendingAuditCommand | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const command = parsePendingAuditCommand(JSON.parse(raw) as unknown);
    if (
      !command
      || command.kind !== expectedKind
      || command.actorUserId !== actorUserId
      || command.clientInstanceId !== clientInstanceId
    ) {
      storage.removeItem(key);
      return null;
    }
    return command;
  } catch {
    return null;
  }
}

export function getPendingAuditCreateCommand(
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): PendingAuditCreateCommand | null {
  const command = readPendingAuditCommand(
    pendingCommandStorageKey('create', actorUserId),
    'create',
    actorUserId,
    clientInstanceId,
    storage,
  );
  return command?.kind === 'create' ? command : null;
}

export function getPendingAuditCopyCommand(
  sourceAuditId: string,
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): PendingAuditCopyCommand | null {
  const command = readPendingAuditCommand(
    pendingCommandStorageKey('copy', actorUserId, sourceAuditId),
    'copy',
    actorUserId,
    clientInstanceId,
    storage,
  );
  return command?.kind === 'copy' && command.sourceAuditId === sourceAuditId ? command : null;
}

export function getPendingAuditAcquireCommand(
  auditId: string,
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): PendingAuditAcquireCommand | null {
  const command = readPendingAuditCommand(
    pendingCommandStorageKey('acquire', actorUserId, auditId),
    'acquire',
    actorUserId,
    clientInstanceId,
    storage,
  );
  return command?.kind === 'acquire' && command.auditId === auditId ? command : null;
}

export function persistPendingAuditCommand(
  input: PendingAuditCommand,
  storage: StorageLike | null = browserStorage(),
): boolean {
  const command = parsePendingAuditCommand(input);
  if (!command || !storage) return false;
  const key = pendingCommandStorageKey(
    command.kind,
    command.actorUserId,
    command.kind === 'copy' ? command.sourceAuditId : command.kind === 'acquire' ? command.auditId : undefined,
  );
  const serialized = JSON.stringify(command);
  try {
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

export function beginPendingAuditCreateCommand(
  input: {
    siteName: string;
    siteAddress: string;
    inspectorName: string;
    auditDate: string | null;
  },
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
  createId: () => string = () => newAuditCommandId('create-audit'),
  now: () => string = () => new Date().toISOString(),
): PendingAuditCreateCommand {
  const existing = getPendingAuditCreateCommand(actorUserId, clientInstanceId, storage);
  if (existing) return existing;
  const idempotencyKey = createId();
  const editClient: PendingAuditEditClient = {
    clientInstanceId,
    clientKind: 'portal',
    clientLabel: ECOAUDIT_PORTAL_CLIENT_LABEL,
  };
  const command: PendingAuditCreateCommand = {
    version: 1,
    kind: 'create',
    actorUserId,
    clientInstanceId,
    idempotencyKey,
    createdAt: now(),
    body: { ...input, editClient, idempotencyKey },
  };
  if (!persistPendingAuditCommand(command, storage)) {
    throw new Error('This browser could not safely save the pending audit command, so nothing was sent. Check browser storage and try again.');
  }
  return command;
}

export function beginPendingAuditCopyCommand(
  input: { sourceAuditId: string; expectedTreeRevision: number },
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
  createId: () => string = () => newAuditCommandId('amend-audit', input.sourceAuditId),
  now: () => string = () => new Date().toISOString(),
): PendingAuditCopyCommand {
  const existing = getPendingAuditCopyCommand(input.sourceAuditId, actorUserId, clientInstanceId, storage);
  if (existing) return existing;
  const idempotencyKey = createId();
  const editClient: PendingAuditEditClient = {
    clientInstanceId,
    clientKind: 'portal',
    clientLabel: ECOAUDIT_PORTAL_CLIENT_LABEL,
  };
  const command: PendingAuditCopyCommand = {
    version: 1,
    kind: 'copy',
    sourceAuditId: input.sourceAuditId,
    actorUserId,
    clientInstanceId,
    idempotencyKey,
    createdAt: now(),
    body: {
      purpose: 'amendment',
      includeChildren: true,
      expectedTreeRevision: input.expectedTreeRevision,
      editClient,
      idempotencyKey,
    },
  };
  if (!persistPendingAuditCommand(command, storage)) {
    throw new Error('This browser could not safely save the pending copy command, so nothing was sent. Check browser storage and try again.');
  }
  return command;
}

export function beginPendingAuditAcquireCommand(
  input: { auditId: string; expectedTreeRevision: number },
  actorUserId: string,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
  createId: () => string = () => newAuditCommandId('acquire-audit', input.auditId),
  now: () => string = () => new Date().toISOString(),
): PendingAuditAcquireCommand {
  const existing = getPendingAuditAcquireCommand(input.auditId, actorUserId, clientInstanceId, storage);
  if (existing) return existing;
  const idempotencyKey = createId();
  const command: PendingAuditAcquireCommand = {
    version: 1,
    kind: 'acquire',
    auditId: input.auditId,
    actorUserId,
    clientInstanceId,
    idempotencyKey,
    createdAt: now(),
    body: {
      clientInstanceId,
      clientKind: 'portal',
      clientLabel: ECOAUDIT_PORTAL_CLIENT_LABEL,
      expectedTreeRevision: input.expectedTreeRevision,
      idempotencyKey,
    },
  };
  if (!persistPendingAuditCommand(command, storage)) {
    throw new Error('This browser could not safely save the pending editing-access command, so nothing was sent. Check browser storage and try again.');
  }
  return command;
}

export function clearPendingAuditCommand(
  command: PendingAuditCommand,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const key = pendingCommandStorageKey(
    command.kind,
    command.actorUserId,
    command.kind === 'copy' ? command.sourceAuditId : command.kind === 'acquire' ? command.auditId : undefined,
  );
  try {
    const raw = storage.getItem(key);
    if (!raw) return true;
    const current = parsePendingAuditCommand(JSON.parse(raw) as unknown);
    if (!current || current.idempotencyKey !== command.idempotencyKey) return true;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

export function auditClientHeaders(clientInstanceId = getAuditClientInstanceId()): Record<string, string> {
  return {
    'X-EcoAudit-Protocol-Version': ECOAUDIT_PROTOCOL_VERSION,
    'X-EcoAudit-Client-Instance-Id': clientInstanceId,
    'X-EcoAudit-Client-Kind': 'portal',
  };
}

export function auditPhotoMetadataHeaders(
  guard: AuditPhotoMetadataGuard,
): Record<string, string> {
  return {
    ...auditClientHeaders(guard.clientInstanceId),
    'X-EcoAudit-Base-Tree-Revision': String(guard.baseTreeRevision),
  };
}

export function auditMutationHeaders(guard: AuditMutationGuard): Record<string, string> {
  return 'leaseToken' in guard ? auditWriteHeaders(guard) : auditPhotoMetadataHeaders(guard);
}

export function auditWriteHeaders(
  guard: AuditWriteGuard,
  idempotencyKey?: string,
): Record<string, string> {
  return {
    ...auditClientHeaders(guard.clientInstanceId),
    'X-EcoAudit-Lease-Token': guard.leaseToken,
    'X-EcoAudit-Lease-Fence': String(guard.editFence),
    'X-EcoAudit-Base-Tree-Revision': String(guard.baseTreeRevision),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

export function auditWriteGuard(
  audit: Audit,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): AuditWriteGuard | null {
  const lease = audit.editLease;
  const stored = getStoredAuditLease(audit.id, clientInstanceId, storage);
  const editFence = audit.editFence ?? lease?.fence;
  const expiresAt = lease?.expiresAt ? Date.parse(lease.expiresAt) : null;
  if (
    audit.status === 'Completed'
    || !lease?.ownedByCaller
    || lease.clientInstanceId !== clientInstanceId
    || lease.stale
    || (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))
    || !stored
    || !validFence(editFence)
    || stored.editFence !== editFence
    || !Number.isSafeInteger(audit.treeRevision)
  ) return null;
  return {
    auditId: audit.id,
    baseTreeRevision: audit.treeRevision,
    editFence,
    leaseToken: stored.leaseToken,
    clientInstanceId,
  };
}

export function auditPhotoMetadataGuard(
  audit: Audit,
  actorRole: 'admin' | 'inspector' | 'service_account' | undefined,
  clientInstanceId = getAuditClientInstanceId(),
): AuditPhotoMetadataGuard | null {
  if (
    audit.status !== 'Completed'
    || (actorRole !== 'admin' && actorRole !== 'service_account')
    || !Number.isSafeInteger(audit.treeRevision)
  ) return null;
  return {
    auditId: audit.id,
    baseTreeRevision: audit.treeRevision,
    clientInstanceId,
  };
}

export type AuditAuthorityState =
  | 'completed'
  | 'owned'
  | 'owned-expired'
  | 'owned-token-missing'
  | 'other-owner'
  | 'unclaimed';

export function auditAuthorityState(
  audit: Audit,
  clientInstanceId = getAuditClientInstanceId(),
  storage: StorageLike | null = browserStorage(),
): AuditAuthorityState {
  if (audit.status === 'Completed') return 'completed';
  if (!audit.editLease) return 'unclaimed';
  if (!audit.editLease.ownedByCaller || audit.editLease.clientInstanceId !== clientInstanceId) return 'other-owner';
  const stored = getStoredAuditLease(audit.id, clientInstanceId, storage);
  const editFence = audit.editFence ?? audit.editLease.fence;
  if (!stored || !validFence(editFence) || stored.editFence !== editFence) {
    return 'owned-token-missing';
  }
  const expiresAt = audit.editLease.expiresAt ? Date.parse(audit.editLease.expiresAt) : null;
  if (
    audit.editLease.stale
    || (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))
  ) {
    return 'owned-expired';
  }
  return 'owned';
}

const PROTOCOL_MESSAGES: Record<string, string> = {
  audit_edit_lease_held: 'This audit is being edited on another device. You can review it here, but only that device can save or complete it.',
  audit_edit_lease_required: 'Editing access is required before this audit can be changed. Refresh the audit and start editing here.',
  audit_edit_lease_expired: 'Editing access has expired. Refresh the audit to renew access safely.',
  audit_edit_lease_invalid: 'Editing access is no longer valid. Refresh the audit before making further changes.',
  audit_edit_release_requires_completion: 'Editing ownership remains with this client until completion or an audited administrator takeover.',
  audit_edit_takeover_requires_admin: 'Only an administrator can take over editing from another device.',
  audit_tree_revision_changed: 'The cloud audit changed after this page opened. Your changes were not applied. Reload the latest cloud version.',
  audit_child_scope_conflict: 'This record no longer belongs to the opened audit. Refresh before making further changes.',
  audit_completed_copy_required: 'This completed audit is read-only. Create an editable copy to make changes.',
  audit_completed_reopen_requires_explicit_transition: 'This completed audit is read-only. Create an editable copy to make changes.',
  audit_completed_photo_metadata_portal_only: 'Completed photo captions and PDF layout can only be corrected in the web portal.',
  audit_completed_photo_metadata_admin_required: 'Only an administrator can correct photo captions or PDF layout on a completed audit.',
  audit_already_completed: 'This audit is already completed. Refresh to view the latest cloud state.',
  audit_copy_requires_completed_source: 'The source audit is no longer completed. Refresh before creating an editable copy.',
  audit_source_revision_changed: 'A newer completed version is available. Refresh before creating an editable copy.',
  completion_timestamp_missing: 'The cloud could not verify the completion time. Refresh the audit before trying again.',
  work_session_concurrent_update: 'Audit timing changed on another device. Refresh before trying again.',
  idempotency_key_reused: 'This action could not be safely retried. Refresh the audit before trying again.',
  ecoaudit_client_upgrade_required: 'This audit uses protected editing and requires the latest version of the app.',
};

export function auditProtocolErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.code ?? (error.detail && PROTOCOL_MESSAGES[error.detail] ? error.detail : null);
}

export function auditProtocolErrorMessage(error: unknown): string | null {
  const code = auditProtocolErrorCode(error);
  return code ? PROTOCOL_MESSAGES[code] ?? null : null;
}

/** Keep an idempotency key only when the server may have committed but the
 * client cannot know the outcome (network/timeout/server failure). */
export function isDefinitiveAuditCommandRejection(error: unknown): boolean {
  return error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && ![401, 403, 408, 425, 429].includes(error.status);
}

export function auditLeaseLabel(lease: AuditEditLease | null | undefined): string {
  return lease?.clientLabel?.trim() || (lease?.clientKind === 'mobile' ? 'another mobile device' : 'another browser');
}

/**
 * Renew after roughly two thirds of the server-issued lease lifetime. When the
 * server omits lastSeenAt, renew one minute before expiry instead. Invalid or
 * already stale leases are never heartbeated.
 */
export function auditLeaseRenewalDelay(
  lease: AuditEditLease | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!lease?.ownedByCaller || lease.stale || !lease.expiresAt) return null;
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
  const lastSeenAt = lease.lastSeenAt ? Date.parse(lease.lastSeenAt) : Number.NaN;
  const lifetime = expiresAt - lastSeenAt;
  const renewAt = Number.isFinite(lastSeenAt) && lifetime > 0
    ? lastSeenAt + (lifetime * 2) / 3
    : expiresAt - AUDIT_LEASE_RENEW_FALLBACK_LEAD_MS;
  return Math.max(AUDIT_LEASE_RENEW_MIN_DELAY_MS, renewAt - nowMs);
}

export function newAuditCommandId(prefix: string, auditId?: string): string {
  let suffix: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    suffix = crypto.randomUUID();
  } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    suffix = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } else {
    throw new Error('Secure command identifiers are not available in this browser.');
  }
  return `${prefix}-${auditId ? `${auditId}-` : ''}${suffix}`;
}
