import { sha256 } from 'js-sha256';

export const INSTALLATION_COMPLETION_NOTES_MAX_LENGTH = 2_000;

const INSTALLATION_COMPLETION_ATTEMPT_STORAGE_VERSION = 1;
const INSTALLATION_COMPLETION_ATTEMPT_STORAGE_PREFIX =
  'ih_completion_attempt_v1';

export type InstallationCompletionAttempt = {
  baseTreeRevision: number;
  idempotencyKey: string;
  completionNotes?: string | null;
};

export type InstallationCompletionAttemptStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

type StoredInstallationCompletionAttempt = {
  version: typeof INSTALLATION_COMPLETION_ATTEMPT_STORAGE_VERSION;
  scopeHash: string;
  baseTreeRevision: number;
  idempotencyKey: string;
  completionNotes: string | null;
};

export function normalizeInstallationCompletionNotes(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

export function installationCompletionNotesIssue(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeInstallationCompletionNotes(value);
  if ((normalized?.length ?? 0) <= INSTALLATION_COMPLETION_NOTES_MAX_LENGTH) {
    return null;
  }
  return `Technician completion notes must be ${INSTALLATION_COMPLETION_NOTES_MAX_LENGTH.toLocaleString('en-AU')} characters or fewer.`;
}

export function installationCompletionIdempotencyKey(
  installationId: string,
  treeRevision: number,
  completionNotes: string | null,
): string {
  const noteFingerprint = sha256(completionNotes ?? '').slice(0, 20);
  return `complete-${installationId}-${treeRevision}-${noteFingerprint}`;
}

function validCompletionAttemptScopePart(value: string): boolean {
  return value.length > 0 && value.length <= 300 && value.trim() === value;
}

function installationCompletionAttemptScopeHash(
  actorUserId: string,
  installationId: string,
): string | null {
  if (
    !validCompletionAttemptScopePart(actorUserId)
    || !validCompletionAttemptScopePart(installationId)
  ) return null;
  return sha256(`${actorUserId}\0${installationId}`);
}

function installationCompletionAttemptStorageKey(
  actorUserId: string,
  installationId: string,
): string | null {
  const scopeHash = installationCompletionAttemptScopeHash(actorUserId, installationId);
  return scopeHash
    ? `${INSTALLATION_COMPLETION_ATTEMPT_STORAGE_PREFIX}:${scopeHash}`
    : null;
}

function browserCompletionAttemptStorage(): InstallationCompletionAttemptStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function validatedStoredCompletionAttempt(
  value: unknown,
  actorUserId: string,
  installationId: string,
): InstallationCompletionAttempt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<StoredInstallationCompletionAttempt>;
  const expectedKeys = [
    'baseTreeRevision',
    'completionNotes',
    'idempotencyKey',
    'scopeHash',
    'version',
  ];
  if (
    Object.keys(record).sort().join('\0') !== expectedKeys.join('\0')
    || record.version !== INSTALLATION_COMPLETION_ATTEMPT_STORAGE_VERSION
  ) return null;
  const scopeHash = installationCompletionAttemptScopeHash(actorUserId, installationId);
  if (!scopeHash || record.scopeHash !== scopeHash) return null;
  const baseTreeRevision = record.baseTreeRevision;
  if (
    typeof baseTreeRevision !== 'number'
    || !Number.isSafeInteger(baseTreeRevision)
    || baseTreeRevision < 0
    || typeof record.idempotencyKey !== 'string'
    || record.idempotencyKey.length < 1
    || record.idempotencyKey.length > 200
    || (record.completionNotes !== null && typeof record.completionNotes !== 'string')
  ) return null;
  const completionNotes = normalizeInstallationCompletionNotes(record.completionNotes);
  if (
    completionNotes !== record.completionNotes
    || installationCompletionNotesIssue(completionNotes)
    || record.idempotencyKey !== installationCompletionIdempotencyKey(
      installationId,
      baseTreeRevision,
      completionNotes,
    )
  ) return null;
  return {
    baseTreeRevision,
    idempotencyKey: record.idempotencyKey,
    completionNotes,
  };
}

/**
 * Retain only the exact lifecycle request in tab-scoped storage. Authentication
 * credentials are deliberately excluded; its actor/installation binding uses
 * a one-way scope hash and every request field is revalidated on restore.
 */
export function persistInstallationCompletionAttempt(
  actorUserId: string,
  installationId: string,
  attempt: InstallationCompletionAttempt,
  storage: InstallationCompletionAttemptStorage | null = browserCompletionAttemptStorage(),
): boolean {
  if (!storage) return false;
  const storageKey = installationCompletionAttemptStorageKey(actorUserId, installationId);
  const scopeHash = installationCompletionAttemptScopeHash(actorUserId, installationId);
  if (!storageKey || !scopeHash) return false;
  const completionNotes = normalizeInstallationCompletionNotes(attempt.completionNotes);
  const stored = validatedStoredCompletionAttempt({
    version: INSTALLATION_COMPLETION_ATTEMPT_STORAGE_VERSION,
    scopeHash,
    baseTreeRevision: attempt.baseTreeRevision,
    idempotencyKey: attempt.idempotencyKey,
    completionNotes,
  }, actorUserId, installationId);
  if (!stored) return false;
  try {
    storage.setItem(storageKey, JSON.stringify({
      version: INSTALLATION_COMPLETION_ATTEMPT_STORAGE_VERSION,
      scopeHash,
      ...stored,
      completionNotes: stored.completionNotes ?? null,
    } satisfies StoredInstallationCompletionAttempt));
    return true;
  } catch {
    return false;
  }
}

export function restoreInstallationCompletionAttempt(
  actorUserId: string,
  installationId: string,
  storage: InstallationCompletionAttemptStorage | null = browserCompletionAttemptStorage(),
): InstallationCompletionAttempt | null {
  if (!storage) return null;
  const storageKey = installationCompletionAttemptStorageKey(actorUserId, installationId);
  if (!storageKey) return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const restored = validatedStoredCompletionAttempt(
      JSON.parse(raw) as unknown,
      actorUserId,
      installationId,
    );
    if (restored) return restored;
    storage.removeItem(storageKey);
    return null;
  } catch {
    try {
      storage.removeItem(storageKey);
    } catch {
      // A disabled storage implementation is equivalent to no retained attempt.
    }
    return null;
  }
}

export function clearPersistedInstallationCompletionAttempt(
  actorUserId: string,
  installationId: string,
  storage: InstallationCompletionAttemptStorage | null = browserCompletionAttemptStorage(),
): void {
  if (!storage) return;
  const storageKey = installationCompletionAttemptStorageKey(actorUserId, installationId);
  if (!storageKey) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // Storage availability must not block an authoritative lifecycle result.
  }
}

export function installationCompletionNotesForDialog(input: {
  previousAttempt: InstallationCompletionAttempt | null;
  treeRevision: number;
  retainedNotes: string;
  serverNotes: string | null | undefined;
}): string {
  if (input.previousAttempt?.baseTreeRevision === input.treeRevision) {
    return input.previousAttempt.completionNotes ?? '';
  }
  return input.retainedNotes || input.serverNotes || '';
}

export function reuseInstallationCompletionAttempt<
  TAttempt extends { baseTreeRevision: number; completionNotes?: string | null },
>(previous: TAttempt | null, proposed: TAttempt): TAttempt {
  return previous
    && previous.baseTreeRevision === proposed.baseTreeRevision
    && previous.completionNotes === proposed.completionNotes
    ? previous
    : proposed;
}

export function installationCompletionAttemptMayHaveSucceeded(
  error: unknown,
): boolean {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  return !(Number.isInteger(status) && status >= 400 && status < 500);
}

export function installationCompletionRefreshError(
  result: PromiseSettledResult<unknown>,
): unknown | null {
  if (result.status === 'rejected') return result.reason;
  const value = result.value;
  if (!value || typeof value !== 'object') return null;
  const queryResult = value as { isError?: unknown; error?: unknown };
  if (queryResult.isError === true || queryResult.error != null) {
    return queryResult.error ?? new Error('The latest completion state could not be loaded.');
  }
  return null;
}

export type InstallationCompletionRefreshState = 'COMPLETED' | 'DRAFT' | 'FAILED';

export function installationCompletionRefreshState(
  result: PromiseSettledResult<unknown>,
): InstallationCompletionRefreshState {
  if (installationCompletionRefreshError(result) || result.status !== 'fulfilled') {
    return 'FAILED';
  }
  const value = result.value;
  if (!value || typeof value !== 'object') return 'FAILED';
  const installation = (value as { installation?: unknown }).installation;
  if (!installation || typeof installation !== 'object') return 'FAILED';
  const status = (installation as { status?: unknown }).status;
  if (status === 'Completed') return 'COMPLETED';
  if (status === 'Draft') return 'DRAFT';
  return 'FAILED';
}

/**
 * An exact retry must reach a lifecycle decision before it can settle a prior
 * ambiguous request. Authentication, throttling, network, and server failures
 * do not prove that the original request will not still commit.
 */
export function installationCompletionExactRetryIsDefinitive(
  error: unknown,
): boolean {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  return status === 400 || status === 404 || status === 409 || status === 422;
}
