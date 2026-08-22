import { badRequest, conflict } from '../../utils/errors.js';

export type SolarLifecycleStatus = 'Draft' | 'Completed';

type SolarCompletionRecord = {
  status: string;
  completedAt: Date | null;
};

export type SolarCompletionFence = {
  completed: boolean;
  completionBoundary: Date | null;
};

export function parseSolarLifecycleStatus(
  value: unknown,
  fallback: SolarLifecycleStatus = 'Draft',
): SolarLifecycleStatus {
  if (value === undefined || value === null) return fallback;
  if (value === 'Draft' || value === 'Completed') return value;
  throw badRequest('status must be Draft or Completed');
}

export function completionAtFirstObservation(
  status: SolarLifecycleStatus,
  receivedAt: Date,
): Date | null {
  return status === 'Completed' ? receivedAt : null;
}

export function resolveSyncedCompletion(input: {
  existing?: SolarCompletionRecord;
  incomingStatus: unknown;
  receivedAt: Date;
  entity: 'site' | 'assessment';
}): { status: SolarLifecycleStatus; completedAt: Date | null } {
  const existingStatus = parseSolarLifecycleStatus(input.existing?.status);
  const status = parseSolarLifecycleStatus(input.incomingStatus, existingStatus);

  if (input.existing?.status === 'Completed' && status !== 'Completed') {
    throw conflict(`${input.entity}_completed_reopen_requires_explicit_transition`);
  }

  return {
    status,
    completedAt: status === 'Completed'
      // Preserve an explicit lack of historical provenance. An idempotent
      // sync of an already-Completed legacy row must not invent "now".
      ? (input.existing?.status === 'Completed'
          ? (input.existing.completedAt ?? null)
          : input.receivedAt)
      : null,
  };
}

export function resolveSolarCompletionFence(
  site: SolarCompletionRecord,
  assessment: SolarCompletionRecord,
): SolarCompletionFence {
  const completedRecords = [site, assessment]
    .filter((record) => record.status === 'Completed');
  if (completedRecords.length === 0) {
    return { completed: false, completionBoundary: null };
  }
  if (completedRecords.some((record) => !record.completedAt)) {
    return { completed: true, completionBoundary: null };
  }

  return {
    completed: true,
    completionBoundary: new Date(Math.min(
      ...completedRecords.map((record) => record.completedAt!.getTime()),
    )),
  };
}
