import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  allocateCentsDeterministically,
  allocateMoneyMetricDeterministically,
  calculateWorkingDays,
  localDateRangeForAnalyticsWindow,
  parseSchedulerAnalyticsWindow,
  rankLeaderboardRows,
  SCHEDULER_ANALYTICS_TRANSACTION_CONFIG,
  schedulerAnalyticsSourceKey,
  schedulerCommercialSourceTypeForApp,
  schedulerProductAssignmentIdentity,
  sessionIsIncludedInWindow,
  startOfCalendarDateInTimeZone,
} from './schedulerAnalyticsService.js';

test('the complete analytics report uses one read-only repeatable-read snapshot', () => {
  assert.deepEqual(SCHEDULER_ANALYTICS_TRANSACTION_CONFIG, {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
});

test('InstallHub product assignments resolve canonical field IDs, not origin IDs', () => {
  const fieldUserId = 'field-user-distinct-from-origin';
  assert.deepEqual(schedulerProductAssignmentIdentity('installhub', fieldUserId), {
    kind: 'field_user_id',
    lookupKey: fieldUserId,
  });
  assert.deepEqual(schedulerProductAssignmentIdentity('ecoaudit', 'origin-user'), {
    kind: 'origin_user_id',
    lookupKey: 'ecoaudit:origin-user',
  });
  assert.deepEqual(schedulerProductAssignmentIdentity('solarsense', 'solar-origin-user'), {
    kind: 'origin_user_id',
    lookupKey: 'solarsense:solar-origin-user',
  });
});

test('commercial attribution isolates Solar assessment rows from same-ID site rows', () => {
  assert.equal(schedulerCommercialSourceTypeForApp('ecoaudit'), 'audit');
  assert.equal(schedulerCommercialSourceTypeForApp('solarsense'), 'assessment');
  assert.equal(schedulerCommercialSourceTypeForApp('installhub'), 'installation');
  assert.notEqual(
    schedulerAnalyticsSourceKey({
      sourceApp: 'solarsense',
      sourceType: 'assessment',
      sourceId: 'shared-id',
    }),
    schedulerAnalyticsSourceKey({
      sourceApp: 'solarsense',
      sourceType: 'site',
      sourceId: 'shared-id',
    }),
  );
});

test('date-only analytics windows use inclusive IANA calendar days across DST', () => {
  const window = parseSchedulerAnalyticsWindow({
    from: '2026-10-04',
    to: '2026-10-04',
    timezone: 'Australia/Sydney',
  });
  assert.equal(window.startAt.toISOString(), '2026-10-03T14:00:00.000Z');
  assert.equal(window.endAt.toISOString(), '2026-10-04T13:00:00.000Z');
  assert.equal(window.endAt.getTime() - window.startAt.getTime(), 23 * 60 * 60 * 1_000);
  assert.deepEqual(window.dateKeys, ['2026-10-04']);

  const fallback = parseSchedulerAnalyticsWindow({
    from: '2026-04-05',
    to: '2026-04-05',
    timezone: 'Australia/Sydney',
  });
  assert.equal(fallback.endAt.getTime() - fallback.startAt.getTime(), 25 * 60 * 60 * 1_000);
});

test('window parsing defaults timezone and enforces exact dates and 366-day maximum', () => {
  assert.equal(
    parseSchedulerAnalyticsWindow({ from: '2026-08-17', to: '2026-08-21' }).timezone,
    'Australia/Sydney',
  );
  assert.equal(
    parseSchedulerAnalyticsWindow({
      from: '2024-01-01',
      to: '2024-12-31',
      timezone: 'UTC',
    }).dateKeys.length,
    366,
  );
  for (const input of [
    { from: '2026-02-30', to: '2026-03-01', timezone: 'UTC' },
    { from: '2026-03-02', to: '2026-03-01', timezone: 'UTC' },
    { from: '2024-01-01', to: '2025-01-01', timezone: 'UTC' },
    { from: '2026-03-01', to: '2026-03-02', timezone: 'Mars/Olympus_Mons' },
    // Both endpoints are individually valid; the rejection must happen from
    // the day-number delta before any multi-million-element date array exists.
    { from: '0100-01-01', to: '9999-12-31', timezone: 'UTC' },
  ]) {
    assert.throws(
      () => parseSchedulerAnalyticsWindow(input),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }
});

test('timezone day start resolves midnight offsets without locale string parsing', () => {
  assert.equal(
    startOfCalendarDateInTimeZone('2026-08-21', 'Asia/Kathmandu').toISOString(),
    '2026-08-20T18:15:00.000Z',
  );
  assert.equal(
    startOfCalendarDateInTimeZone('2026-08-21', 'America/Phoenix').toISOString(),
    '2026-08-21T07:00:00.000Z',
  );
});

test('working days use the weekly mask and subtract distinct approved leave days', () => {
  assert.deepEqual(calculateWorkingDays({
    from: '2026-08-17',
    to: '2026-08-23',
    workingDaysMask: 62,
    approvedLeave: [
      { startDate: '2026-08-18', endDate: '2026-08-19' },
      { startDate: '2026-08-19', endDate: '2026-08-22' },
    ],
  }), {
    scheduledWorkingDays: 5,
    approvedLeaveWorkingDays: 4,
    workingDays: 1,
  });

  assert.deepEqual(calculateWorkingDays({
    from: '2026-08-17',
    to: '2026-08-23',
    workingDaysMask: 65,
    approvedLeave: [{ startDate: '2026-08-18', endDate: '2026-08-21' }],
  }), {
    scheduledWorkingDays: 2,
    approvedLeaveWorkingDays: 0,
    workingDays: 2,
  });
});

test('working-day date ranges use each user timezone for the same report interval', () => {
  const window = parseSchedulerAnalyticsWindow({
    from: '2026-08-21',
    to: '2026-08-21',
    timezone: 'Australia/Sydney',
  });
  assert.deepEqual(localDateRangeForAnalyticsWindow({
    startAt: window.startAt,
    endAt: window.endAt,
    timezone: 'Australia/Sydney',
  }), { from: '2026-08-21', to: '2026-08-21' });
  assert.deepEqual(localDateRangeForAnalyticsWindow({
    startAt: window.startAt,
    endAt: window.endAt,
    timezone: 'America/Phoenix',
  }), { from: '2026-08-20', to: '2026-08-21' });
});

test('cent allocation is exact, deterministic, and aggregates duplicate targets', () => {
  assert.deepEqual(allocateCentsDeterministically(10, [
    { key: 'charlie', weight: 1 },
    { key: 'bravo', weight: 1 },
    { key: 'alpha', weight: 1 },
  ]), [
    { key: 'alpha', cents: 4 },
    { key: 'bravo', cents: 3 },
    { key: 'charlie', cents: 3 },
  ]);
  assert.deepEqual(allocateCentsDeterministically(101, [
    { key: 'job-b', weight: 25 },
    { key: 'job-a', weight: 50 },
    { key: 'job-b', weight: 25 },
  ]), [
    { key: 'job-a', cents: 51 },
    { key: 'job-b', cents: 50 },
  ]);
  assert.deepEqual(allocateCentsDeterministically(5, [
    { key: 'job-b', weight: 0 },
    { key: 'job-a', weight: 0 },
  ]), [
    { key: 'job-a', cents: 3 },
    { key: 'job-b', cents: 2 },
  ]);
});

test('money allocation derives inclusive cents from each allocated component', () => {
  const allocated = allocateMoneyMetricDeterministically({
    amountExGstCents: 1,
    gstAmountCents: 1,
    totalIncGstCents: 2,
    count: 1,
  }, [
    { key: 'alpha', weight: 1 },
    { key: 'bravo', weight: 1 },
  ]);

  assert.deepEqual([...allocated.entries()], [
    ['alpha', {
      amountExGstCents: 1,
      gstAmountCents: 1,
      totalIncGstCents: 2,
      count: 1,
    }],
    ['bravo', {
      amountExGstCents: 0,
      gstAmountCents: 0,
      totalIncGstCents: 0,
      count: 0,
    }],
  ]);
  for (const value of allocated.values()) {
    assert.equal(
      value.totalIncGstCents,
      value.amountExGstCents + value.gstAmountCents!,
    );
  }
});

test('session window uses endedAt or lastActiveAt with inclusive/exclusive boundaries', () => {
  const startAt = new Date('2026-08-17T00:00:00.000Z');
  const endAt = new Date('2026-08-24T00:00:00.000Z');
  assert.equal(sessionIsIncludedInWindow({
    endedAt: new Date('2026-08-17T00:00:00.000Z'),
    lastActiveAt: new Date('2026-08-16T23:59:00.000Z'),
  }, startAt, endAt), true);
  assert.equal(sessionIsIncludedInWindow({
    endedAt: null,
    lastActiveAt: new Date('2026-08-23T23:59:59.999Z'),
  }, startAt, endAt), true);
  assert.equal(sessionIsIncludedInWindow({
    endedAt: new Date('2026-08-24T00:00:00.000Z'),
    lastActiveAt: new Date('2026-08-23T23:00:00.000Z'),
  }, startAt, endAt), false);
  assert.equal(sessionIsIncludedInWindow({
    endedAt: null,
    lastActiveAt: new Date('2026-08-16T23:59:59.999Z'),
  }, startAt, endAt), false);
});

test('leaderboard ranking is stable and never compares currencies', () => {
  const ranked = rankLeaderboardRows([
    {
      userId: 'user-c',
      displayName: 'Charlie',
      completedJobs: 3,
      workingHoursOnSiteMilliseconds: 100,
    },
    {
      userId: 'user-b',
      displayName: 'Bravo',
      completedJobs: 4,
      workingHoursOnSiteMilliseconds: 50,
    },
    {
      userId: 'user-a',
      displayName: 'Alpha',
      completedJobs: 4,
      workingHoursOnSiteMilliseconds: 75,
    },
  ]);
  assert.deepEqual(ranked.map(({ userId, rank }) => ({ userId, rank })), [
    { userId: 'user-a', rank: 1 },
    { userId: 'user-b', rank: 2 },
    { userId: 'user-c', rank: 3 },
  ]);
});
