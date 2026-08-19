import { AppError, badRequest, conflict } from '../utils/errors.js';

export const workSessionBodySchema = {
  type: 'object',
  required: [
    'revision',
    'activeMilliseconds',
    'startedAt',
    'lastActiveAt',
    'endedAt',
  ],
  additionalProperties: false,
  properties: {
    revision: {
      type: 'integer',
      minimum: 0,
      maximum: 2_147_483_647,
    },
    activeMilliseconds: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    startedAt: { type: 'string', format: 'date-time' },
    lastActiveAt: { type: 'string', format: 'date-time' },
    endedAt: {
      anyOf: [
        { type: 'string', format: 'date-time' },
        { type: 'null' },
      ],
    },
  },
} as const;

export const workSessionResponseSchema = {
  type: 'object',
  required: [
    'sessionId',
    'revision',
    'activeMilliseconds',
    'startedAt',
    'lastActiveAt',
    'endedAt',
    'applied',
  ],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string' },
    revision: { type: 'integer' },
    activeMilliseconds: { type: 'integer' },
    startedAt: { type: 'string', format: 'date-time' },
    lastActiveAt: { type: 'string', format: 'date-time' },
    endedAt: {
      anyOf: [
        { type: 'string', format: 'date-time' },
        { type: 'null' },
      ],
    },
    applied: { type: 'boolean' },
  },
} as const;

export interface WorkSessionInput {
  revision: number;
  activeMilliseconds: number;
  startedAt: Date;
  lastActiveAt: Date;
  endedAt: Date | null;
}

export interface StoredWorkSession extends WorkSessionInput {
  id: string;
  actorUserId: string;
}

/**
 * Preserve a former assignee's ability to flush the one session they already
 * own after a scheduler transfer, without restoring access to the parent job.
 * A newer checkpoint is accepted only when it closes an open session. Older
 * or equal revisions are harmless retries and are returned as current by
 * decideWorkSessionUpdate.
 */
export function assertWorkSessionCheckpointAccess(input: {
  incoming: WorkSessionInput;
  existing?: StoredWorkSession;
  actorUserId: string;
  assertParentAccess: () => void;
}): void {
  try {
    input.assertParentAccess();
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
    const ownedSession = input.existing?.actorUserId === input.actorUserId;
    const currentRetry = Boolean(
      input.existing && input.incoming.revision <= input.existing.revision,
    );
    const finalizesOpenSession = Boolean(
      input.existing
      && input.existing.endedAt === null
      && input.incoming.endedAt !== null,
    );
    if (!ownedSession || (!currentRetry && !finalizesOpenSession)) throw error;
  }
}

export type WorkSessionDecision =
  | { action: 'insert' }
  | { action: 'update' }
  | { action: 'current' };

/**
 * Monotonic client clocks and wall clocks can differ slightly at a checkpoint,
 * but cumulative foreground time must remain plausible within its wall span.
 */
export const WORK_SESSION_WALL_CLOCK_TOLERANCE_MS = 5_000;

function assertPlausibleActiveTime(input: WorkSessionInput): void {
  const wallSpan = input.lastActiveAt.getTime() - input.startedAt.getTime();
  if (input.activeMilliseconds > wallSpan + WORK_SESSION_WALL_CLOCK_TOLERANCE_MS) {
    throw badRequest('work_session_active_time_exceeds_wall_span');
  }
}

function requiredDate(body: Record<string, unknown>, field: string): Date {
  const raw = body[field];
  if (typeof raw !== 'string') {
    throw badRequest(`work_session_${field}_invalid`);
  }
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw badRequest(`work_session_${field}_invalid`);
  }
  return value;
}

export function parseWorkSessionBody(body: unknown): WorkSessionInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('work_session_body_invalid');
  }
  const record = body as Record<string, unknown>;
  const revision = record.revision;
  const activeMilliseconds = record.activeMilliseconds;
  if (
    !Number.isSafeInteger(revision)
    || (revision as number) < 0
    || (revision as number) > 2_147_483_647
  ) {
    throw badRequest('work_session_revision_invalid');
  }
  if (!Number.isSafeInteger(activeMilliseconds) || (activeMilliseconds as number) < 0) {
    throw badRequest('work_session_active_milliseconds_invalid');
  }

  const startedAt = requiredDate(record, 'startedAt');
  const lastActiveAt = requiredDate(record, 'lastActiveAt');
  const rawEndedAt = record.endedAt;
  if (rawEndedAt !== null && typeof rawEndedAt !== 'string') {
    throw badRequest('work_session_endedAt_invalid');
  }
  const endedAt = rawEndedAt === null ? null : requiredDate(record, 'endedAt');

  if (startedAt.getTime() > lastActiveAt.getTime()) {
    throw badRequest('work_session_started_after_last_active');
  }
  if (endedAt && lastActiveAt.getTime() > endedAt.getTime()) {
    throw badRequest('work_session_last_active_after_end');
  }

  const parsed = {
    revision: revision as number,
    activeMilliseconds: activeMilliseconds as number,
    startedAt,
    lastActiveAt,
    endedAt,
  };
  assertPlausibleActiveTime(parsed);
  return parsed;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (!left || !right) return left === right;
  return left.getTime() === right.getTime();
}

function assertWithinCompletionBoundary(
  input: WorkSessionInput,
  completionBoundary: Date | null,
  completedDetail: string,
): void {
  if (!completionBoundary || !input.endedAt) throw conflict(completedDetail);
  const boundary = completionBoundary.getTime();
  if (
    input.startedAt.getTime() > boundary
    || input.lastActiveAt.getTime() > boundary
    || input.endedAt.getTime() > boundary
  ) {
    throw conflict(completedDetail);
  }
}

export function decideWorkSessionUpdate(input: {
  incoming: WorkSessionInput;
  existing?: StoredWorkSession;
  actorUserId: string;
  completed: boolean;
  completionBoundary: Date | null;
  completedDetail: string;
}): WorkSessionDecision {
  const {
    incoming,
    existing,
    actorUserId,
    completed,
    completionBoundary,
    completedDetail,
  } = input;

  assertPlausibleActiveTime(incoming);

  if (existing?.actorUserId !== undefined && existing.actorUserId !== actorUserId) {
    throw conflict('work_session_actor_changed');
  }
  if (existing && incoming.revision <= existing.revision) {
    return { action: 'current' };
  }

  if (existing) {
    if (!sameInstant(incoming.startedAt, existing.startedAt)) {
      throw conflict('work_session_started_at_changed');
    }
    if (incoming.activeMilliseconds < existing.activeMilliseconds) {
      throw conflict('work_session_active_time_regressed');
    }
    if (incoming.lastActiveAt.getTime() < existing.lastActiveAt.getTime()) {
      throw conflict('work_session_last_active_at_regressed');
    }
    if (existing.endedAt) {
      if (!incoming.endedAt) throw conflict('work_session_reopened');
      if (!sameInstant(incoming.endedAt, existing.endedAt)) {
        throw conflict('work_session_end_changed');
      }
    }
  }

  if (completed) {
    assertWithinCompletionBoundary(incoming, completionBoundary, completedDetail);
  }

  return { action: existing ? 'update' : 'insert' };
}

export function presentWorkSession(
  session: StoredWorkSession,
  applied: boolean,
) {
  return {
    sessionId: session.id,
    revision: session.revision,
    activeMilliseconds: session.activeMilliseconds,
    startedAt: session.startedAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    applied,
  };
}
