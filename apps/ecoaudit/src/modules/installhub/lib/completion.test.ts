import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clearPersistedInstallationCompletionAttempt,
  INSTALLATION_COMPLETION_NOTES_MAX_LENGTH,
  installationCompletionAttemptMayHaveSucceeded,
  installationCompletionExactRetryIsDefinitive,
  installationCompletionRefreshError,
  installationCompletionRefreshState,
  installationCompletionIdempotencyKey,
  installationCompletionNotesForDialog,
  installationCompletionNotesIssue,
  normalizeInstallationCompletionNotes,
  persistInstallationCompletionAttempt,
  restoreInstallationCompletionAttempt,
  reuseInstallationCompletionAttempt,
} from './completion';

function memoryCompletionAttemptStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
}

test('installation completion notes trim meaningful text and normalize blanks to null', () => {
  assert.equal(normalizeInstallationCompletionNotes('  Isolator labelled and client briefed.  '), 'Isolator labelled and client briefed.');
  assert.equal(normalizeInstallationCompletionNotes('   \n\t  '), null);
  assert.equal(normalizeInstallationCompletionNotes(undefined), null);
});

test('installation completion notes enforce the 2,000-character public contract', () => {
  assert.equal(
    installationCompletionNotesIssue('x'.repeat(INSTALLATION_COMPLETION_NOTES_MAX_LENGTH)),
    null,
  );
  assert.match(
    installationCompletionNotesIssue('x'.repeat(INSTALLATION_COMPLETION_NOTES_MAX_LENGTH + 1)) ?? '',
    /2,000 characters or fewer/,
  );
});

test('installation completion idempotency changes with normalized note content', () => {
  const first = installationCompletionIdempotencyKey(
    'installation-1',
    42,
    normalizeInstallationCompletionNotes('  Board labels checked.  '),
  );
  assert.equal(
    first,
    installationCompletionIdempotencyKey(
      'installation-1',
      42,
      normalizeInstallationCompletionNotes('Board labels checked.'),
    ),
  );
  assert.notEqual(
    first,
    installationCompletionIdempotencyKey(
      'installation-1',
      42,
      normalizeInstallationCompletionNotes('Client handover completed.'),
    ),
  );
});

test('an unresolved completion retry reuses the exact request object', () => {
  const previous = {
    baseTreeRevision: 42,
    completionNotes: 'Board labels checked.',
    idempotencyKey: 'complete-installation-1-42-original',
  };
  assert.equal(
    reuseInstallationCompletionAttempt(previous, {
      ...previous,
      idempotencyKey: 'complete-installation-1-42-recalculated',
    }),
    previous,
  );
  assert.notEqual(
    reuseInstallationCompletionAttempt(previous, {
      ...previous,
      completionNotes: 'Client handover completed.',
    }),
    previous,
  );
});

test('an ambiguous completion request survives reload only for its exact actor and installation', () => {
  const { storage, values } = memoryCompletionAttemptStorage();
  const actorUserId = 'actor-1';
  const installationId = 'installation-1';
  const attempt = {
    baseTreeRevision: 42,
    completionNotes: 'Board labels checked.',
    idempotencyKey: installationCompletionIdempotencyKey(
      installationId,
      42,
      'Board labels checked.',
    ),
  };
  assert.equal(
    persistInstallationCompletionAttempt(actorUserId, installationId, attempt, storage),
    true,
  );
  assert.equal(values.size, 1);
  assert.deepEqual(
    restoreInstallationCompletionAttempt(actorUserId, installationId, storage),
    attempt,
  );
  assert.equal(
    restoreInstallationCompletionAttempt('actor-2', installationId, storage),
    null,
  );
  assert.equal(
    restoreInstallationCompletionAttempt(actorUserId, 'installation-2', storage),
    null,
  );

  clearPersistedInstallationCompletionAttempt(actorUserId, installationId, storage);
  assert.equal(
    restoreInstallationCompletionAttempt(actorUserId, installationId, storage),
    null,
  );
  assert.equal(values.size, 0);
});

test('invalid or altered completion retry storage is rejected and removed', () => {
  const { storage, values } = memoryCompletionAttemptStorage();
  const installationId = 'installation-1';
  const attempt = {
    baseTreeRevision: 42,
    completionNotes: 'Board labels checked.',
    idempotencyKey: installationCompletionIdempotencyKey(
      installationId,
      42,
      'Board labels checked.',
    ),
  };
  assert.equal(
    persistInstallationCompletionAttempt('actor-1', installationId, attempt, storage),
    true,
  );
  const [[storageKey, raw]] = [...values.entries()];
  const altered = JSON.parse(raw) as Record<string, unknown>;
  altered.completionNotes = 'Different notes';
  values.set(storageKey, JSON.stringify(altered));
  assert.equal(
    restoreInstallationCompletionAttempt('actor-1', installationId, storage),
    null,
  );
  assert.equal(values.size, 0);
});

test('completion submission can fail closed when tab storage is unavailable', () => {
  const unavailableStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('storage disabled'); },
    removeItem: () => {},
  };
  assert.equal(persistInstallationCompletionAttempt(
    'actor-1',
    'installation-1',
    {
      baseTreeRevision: 42,
      completionNotes: null,
      idempotencyKey: installationCompletionIdempotencyKey('installation-1', 42, null),
    },
    unavailableStorage,
  ), false);
});

test('completion dialog keeps technician notes after a definitive Draft rejection', () => {
  assert.equal(installationCompletionNotesForDialog({
    previousAttempt: null,
    treeRevision: 43,
    retainedNotes: 'Retain this technician note.',
    serverNotes: null,
  }), 'Retain this technician note.');
  assert.equal(installationCompletionNotesForDialog({
    previousAttempt: {
      baseTreeRevision: 42,
      completionNotes: 'Exact ambiguous note.',
      idempotencyKey: 'retained-key',
    },
    treeRevision: 42,
    retainedNotes: 'Later local edit.',
    serverNotes: 'Server fallback.',
  }), 'Exact ambiguous note.');
});

test('only definitive client rejection rules out an ambiguous completion result', () => {
  assert.equal(installationCompletionAttemptMayHaveSucceeded({ status: 400 }), false);
  assert.equal(installationCompletionAttemptMayHaveSucceeded({ status: 409 }), false);
  assert.equal(installationCompletionAttemptMayHaveSucceeded({ status: 503 }), true);
  assert.equal(installationCompletionAttemptMayHaveSucceeded(new Error('network unavailable')), true);
});

test('completion reconciliation treats fulfilled React Query errors as failed refreshes', () => {
  const refreshError = new Error('refresh unavailable');
  assert.equal(installationCompletionRefreshError({
    status: 'fulfilled',
    value: { isError: false, error: null },
  }), null);
  assert.equal(installationCompletionRefreshError({
    status: 'fulfilled',
    value: { isError: true, error: refreshError },
  }), refreshError);
  assert.equal(installationCompletionRefreshError({
    status: 'fulfilled',
    value: { isError: false, error: refreshError },
  }), refreshError);
  assert.equal(installationCompletionRefreshError({
    status: 'rejected',
    reason: refreshError,
  }), refreshError);
});

test('a successful Draft read does not settle an in-flight completion race', () => {
  assert.equal(installationCompletionRefreshState({
    status: 'fulfilled',
    value: { installation: { status: 'Draft' } },
  }), 'DRAFT');
  assert.equal(installationCompletionRefreshState({
    status: 'fulfilled',
    value: { installation: { status: 'Completed' } },
  }), 'COMPLETED');
  assert.equal(installationCompletionRefreshState({
    status: 'fulfilled',
    value: { installation: { status: 'Unexpected' } },
  }), 'FAILED');
  assert.equal(installationCompletionRefreshState({
    status: 'rejected',
    reason: new Error('refresh unavailable'),
  }), 'FAILED');
});

test('only a lifecycle-level exact retry response settles an ambiguous completion', () => {
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 400 }), true);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 404 }), true);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 409 }), true);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 422 }), true);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 401 }), false);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 403 }), false);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 429 }), false);
  assert.equal(installationCompletionExactRetryIsDefinitive({ status: 503 }), false);
  assert.equal(installationCompletionExactRetryIsDefinitive(new Error('network unavailable')), false);
});

test('completion reconciliation uses an authoritative throwing tree refresh', () => {
  const hook = readFileSync(new URL('../hooks/useInstallationTree.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../pages/InstallationDetailPage.tsx', import.meta.url), 'utf8');
  const refreshStart = hook.indexOf('const refresh = useCallback');
  const replaceStart = hook.indexOf('const replace = useCallback', refreshStart);
  assert.ok(refreshStart >= 0 && replaceStart > refreshStart);
  const refresh = hook.slice(refreshStart, replaceStart);
  const cancelIndex = refresh.indexOf('await queryClient.cancelQueries');
  const fetchIndex = refresh.indexOf('const latest = await getInstallationTree');
  assert.ok(cancelIndex >= 0 && fetchIndex > cancelIndex);
  assert.match(
    refresh,
    /cancelQueries\(\{[\s\S]*queryKey: installationTreeKey\(installationId\),[\s\S]*exact: true/,
  );
  assert.match(
    refresh,
    /const latest = await getInstallationTree\(installationId\);[\s\S]*queryClient\.setQueryData\(installationTreeKey\(installationId\), latest\)/,
  );
  assert.doesNotMatch(
    refresh,
    /invalidateQueries\(\{ queryKey: installationTreeKey\(installationId\) \}\)/,
  );
  assert.match(page, /readinessQuery\.refetch\(\{ throwOnError: true \}\)/);
  assert.match(page, /installationCompletionRefreshError\(treeRefresh\)/);
  assert.match(page, /if \(treeState === 'COMPLETED'\) \{[\s\S]*clearCompletionAttempt\(true\)/);
  assert.match(
    page,
    /const completionInput = completionAttemptRef\.current;[\s\S]*completeInstallation\(installationId, completionInput\)/,
  );
  assert.match(
    page,
    /restoreInstallationCompletionAttempt\([\s\S]*setCompletionRefreshRequired\(true\)/,
  );
  assert.match(page, /persistInstallationCompletionAttempt\(user\.id, installationId, completionInput\)/);
  assert.match(page, /clearPersistedInstallationCompletionAttempt\(user\.id, installationId\)/);
  assert.match(page, /Retry exact completion/);
});
