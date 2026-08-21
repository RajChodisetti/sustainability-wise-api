import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../utils/errors.js';
import {
  INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH,
  installHubCompletionNotesFromReplayResult,
  installHubCompletionReplayMatchesCurrentState,
  installHubCompletionNotesSchema,
  normalizeInstallHubCompletionNotes,
} from './completionNotes.js';

test('completion notes request schema accepts an optional nullable camelCase field', () => {
  assert.deepEqual(installHubCompletionNotesSchema, {
    type: ['string', 'null'],
  });
});

test('completion notes are optional, trimmed, and normalize blanks to null', () => {
  assert.equal(normalizeInstallHubCompletionNotes(undefined), null);
  assert.equal(normalizeInstallHubCompletionNotes(null), null);
  assert.equal(normalizeInstallHubCompletionNotes('   \n\t '), null);
  assert.equal(normalizeInstallHubCompletionNotes('  Signed off on site.  '), 'Signed off on site.');
});

test('completion notes enforce the public 2,000-character limit after trimming', () => {
  assert.equal(
    normalizeInstallHubCompletionNotes('x'.repeat(INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH)),
    'x'.repeat(INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH),
  );
  assert.equal(
    normalizeInstallHubCompletionNotes(`  ${'x'.repeat(INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH)}  `),
    'x'.repeat(INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH),
  );
  assert.throws(
    () => normalizeInstallHubCompletionNotes(
      'x'.repeat(INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH + 1),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.match(error.detail ?? '', /at most 2000 characters/);
      return true;
    },
  );
});

test('idempotent completion replay is limited to the same completed generation', () => {
  const prior = { resultingTreeRevision: 8, recordVersionNumber: 3 };
  assert.equal(installHubCompletionReplayMatchesCurrentState({
    status: 'Completed',
    treeRevision: 8,
    recordVersionNumber: 3,
  }, prior), true);
  assert.equal(installHubCompletionReplayMatchesCurrentState({
    status: 'Draft',
    treeRevision: 9,
    recordVersionNumber: 3,
  }, prior), false);
  assert.equal(installHubCompletionReplayMatchesCurrentState({
    status: 'Completed',
    treeRevision: 10,
    recordVersionNumber: 4,
  }, prior), false);
});

test('historical replay notes never fall through to a later live value', () => {
  assert.equal(installHubCompletionNotesFromReplayResult({}), null);
  assert.equal(installHubCompletionNotesFromReplayResult({ completionNotes: null }), null);
  assert.equal(
    installHubCompletionNotesFromReplayResult({ completionNotes: 'Original handover.' }),
    'Original handover.',
  );
});
