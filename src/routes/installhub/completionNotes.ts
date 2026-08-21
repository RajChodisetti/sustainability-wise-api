import { badRequest } from '../../utils/errors.js';

export const INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH = 2_000;
export const installHubCompletionNotesSchema = {
  type: ['string', 'null'],
} as const;

export function normalizeInstallHubCompletionNotes(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw badRequest('completionNotes must be a string');
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH) {
    throw badRequest(
      `completionNotes must contain at most ${INSTALLHUB_COMPLETION_NOTES_MAX_LENGTH} characters`,
    );
  }
  return normalized;
}

export function installHubCompletionReplayMatchesCurrentState(
  installation: {
    status: string;
    treeRevision: number;
    recordVersionNumber: number;
  },
  prior: {
    resultingTreeRevision: number;
    recordVersionNumber: number;
  },
): boolean {
  return installation.status === 'Completed'
    && installation.treeRevision === prior.resultingTreeRevision
    && installation.recordVersionNumber === prior.recordVersionNumber;
}

/**
 * Older idempotency rows predate completionNotes. Their historical response is
 * therefore null; it must never borrow a later value from the mutable live row.
 */
export function installHubCompletionNotesFromReplayResult(
  result: Record<string, unknown>,
): string | null {
  return typeof result.completionNotes === 'string'
    ? result.completionNotes
    : null;
}
