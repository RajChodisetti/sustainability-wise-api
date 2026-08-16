import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  decideWorkSessionUpdate,
  parseWorkSessionBody,
  presentWorkSession,
  WORK_SESSION_WALL_CLOCK_TOLERANCE_MS,
  type StoredWorkSession,
  type WorkSessionInput,
} from './workSessions.js';

const startedAt = new Date('2026-08-15T10:00:00.000Z');
const lastActiveAt = new Date('2026-08-15T10:01:00.000Z');

function incoming(overrides: Partial<WorkSessionInput> = {}): WorkSessionInput {
  return {
    revision: 1,
    activeMilliseconds: 45_000,
    startedAt,
    lastActiveAt,
    endedAt: null,
    ...overrides,
  };
}

function stored(overrides: Partial<StoredWorkSession> = {}): StoredWorkSession {
  return {
    id: 'session-1',
    actorUserId: 'inspector-1',
    ...incoming(),
    ...overrides,
  };
}

function decision(overrides: Partial<Parameters<typeof decideWorkSessionUpdate>[0]> = {}) {
  return decideWorkSessionUpdate({
    incoming: incoming(),
    actorUserId: 'inspector-1',
    completed: false,
    completionBoundary: null,
    completedDetail: 'audit_completed_time_tracking_disabled',
    ...overrides,
  });
}

function assertConflict(detail: string, callback: () => unknown): void {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.detail, detail);
    return true;
  });
}

test('parses a valid open foreground session and presents ISO timestamps', () => {
  const parsed = parseWorkSessionBody({
    revision: 1,
    activeMilliseconds: 45_000,
    startedAt: startedAt.toISOString(),
    lastActiveAt: lastActiveAt.toISOString(),
    endedAt: null,
  });

  assert.deepEqual(parsed, incoming());
  assert.deepEqual(presentWorkSession(stored(), true), {
    sessionId: 'session-1',
    revision: 1,
    activeMilliseconds: 45_000,
    startedAt: startedAt.toISOString(),
    lastActiveAt: lastActiveAt.toISOString(),
    endedAt: null,
    applied: true,
  });
});

test('rejects invalid session timestamp ordering', () => {
  assert.throws(() => parseWorkSessionBody({
    revision: 1,
    activeMilliseconds: 1,
    startedAt: lastActiveAt.toISOString(),
    lastActiveAt: startedAt.toISOString(),
    endedAt: null,
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.detail, 'work_session_started_after_last_active');
    return true;
  });
});

test('bounds billed active time to its wall span with narrow clock tolerance', () => {
  const exactBound = 60_000 + WORK_SESSION_WALL_CLOCK_TOLERANCE_MS;
  assert.equal(parseWorkSessionBody({
    revision: 1,
    activeMilliseconds: exactBound,
    startedAt: startedAt.toISOString(),
    lastActiveAt: lastActiveAt.toISOString(),
    endedAt: null,
  }).activeMilliseconds, exactBound);

  assert.throws(() => parseWorkSessionBody({
    revision: 1,
    activeMilliseconds: 10 * 60 * 60 * 1_000,
    startedAt: startedAt.toISOString(),
    lastActiveAt: lastActiveAt.toISOString(),
    endedAt: null,
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.detail, 'work_session_active_time_exceeds_wall_span');
    return true;
  });

  assert.throws(() => decision({
    incoming: incoming({ activeMilliseconds: exactBound + 1 }),
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.detail, 'work_session_active_time_exceeds_wall_span');
    return true;
  });
});

test('inserts a new draft session and advances a higher revision', () => {
  assert.deepEqual(decision(), { action: 'insert' });
  assert.deepEqual(decision({
    existing: stored(),
    incoming: incoming({
      revision: 2,
      activeMilliseconds: 50_000,
      lastActiveAt: new Date('2026-08-15T10:01:05.000Z'),
    }),
  }), { action: 'update' });
});

test('returns current state for stale and equal revisions', () => {
  assert.deepEqual(decision({
    existing: stored({ revision: 3 }),
    incoming: incoming({ revision: 2 }),
  }), { action: 'current' });
  assert.deepEqual(decision({
    existing: stored({ revision: 3 }),
    incoming: incoming({ revision: 3, activeMilliseconds: 60_000 }),
  }), { action: 'current' });
});

test('rejects identity changes and higher-revision regressions', () => {
  assertConflict('work_session_actor_changed', () => decision({
    existing: stored({ actorUserId: 'other-user' }),
  }));
  assertConflict('work_session_started_at_changed', () => decision({
    existing: stored(),
    incoming: incoming({
      revision: 2,
      startedAt: new Date('2026-08-15T10:00:01.000Z'),
    }),
  }));
  assertConflict('work_session_active_time_regressed', () => decision({
    existing: stored(),
    incoming: incoming({ revision: 2, activeMilliseconds: 44_999 }),
  }));
  assertConflict('work_session_last_active_at_regressed', () => decision({
    existing: stored(),
    incoming: incoming({
      revision: 2,
      lastActiveAt: new Date('2026-08-15T10:00:59.000Z'),
    }),
  }));
});

test('allows monotonic closed-session revisions but never reopens or changes the end', () => {
  const endedAt = new Date('2026-08-15T10:01:01.000Z');
  assert.deepEqual(decision({
    existing: stored(),
    incoming: incoming({ revision: 2, endedAt }),
  }), { action: 'update' });

  assert.deepEqual(decision({
    existing: stored({ endedAt }),
    incoming: incoming({
      revision: 2,
      activeMilliseconds: 46_000,
      lastActiveAt: endedAt,
      endedAt,
    }),
  }), { action: 'update' });

  assertConflict('work_session_reopened', () => decision({
    existing: stored({ endedAt }),
    incoming: incoming({ revision: 2, endedAt: null }),
  }));
  assertConflict('work_session_end_changed', () => decision({
    existing: stored({ endedAt }),
    incoming: incoming({
      revision: 2,
      endedAt: new Date('2026-08-15T10:01:02.000Z'),
    }),
  }));
});

test('completed parents reject open or post-completion activity', () => {
  const boundary = new Date('2026-08-15T10:02:00.000Z');
  assertConflict('audit_completed_time_tracking_disabled', () => decision({
    completed: true,
    completionBoundary: boundary,
  }));
  assertConflict('audit_completed_time_tracking_disabled', () => decision({
    incoming: incoming({
      endedAt: new Date('2026-08-15T10:02:01.000Z'),
    }),
    completed: true,
    completionBoundary: boundary,
  }));
});

test('completed parents accept delayed closed work wholly before the boundary', () => {
  const completionBoundary = new Date('2026-08-15T10:02:00.000Z');
  assert.deepEqual(decision({
    incoming: incoming({
      endedAt: new Date('2026-08-15T10:01:01.000Z'),
    }),
    completed: true,
    completionBoundary,
  }), { action: 'insert' });

  assert.deepEqual(decision({
    existing: stored(),
    incoming: incoming({
      revision: 2,
      endedAt: new Date('2026-08-15T10:01:01.000Z'),
    }),
    completed: true,
    completionBoundary,
  }), { action: 'update' });
});

test('an equal-revision retry returns current state after completion', () => {
  assert.deepEqual(decision({
    existing: stored({ revision: 2 }),
    incoming: incoming({ revision: 2 }),
    completed: true,
    completionBoundary: new Date('2026-08-15T10:00:30.000Z'),
  }), { action: 'current' });
});
