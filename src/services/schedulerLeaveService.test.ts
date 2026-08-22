import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import {
  LEAVE_APPROVAL_BLOCKING_SCHEDULE_STATUSES,
  assertLeaveReviewerIsIndependent,
  canCancelLeave,
  canReviewLeave,
  eventOverlapsLeaveDateRange,
  instantDateInTimeZone,
  isValidCalendarDate,
  isValidIanaTimeZone,
  type SchedulerLeaveStatus,
} from './schedulerLeaveService.js';

test('calendar dates are strict, leap-year aware YYYY-MM-DD values', () => {
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2026-08-21'), true);
  assert.equal(isValidCalendarDate('2025-02-29'), false);
  assert.equal(isValidCalendarDate('2026-04-31'), false);
  assert.equal(isValidCalendarDate('2026-8-21'), false);
  assert.equal(isValidCalendarDate('21/08/2026'), false);
  assert.equal(isValidCalendarDate(null), false);
});

test('timezones must be recognized IANA identifiers', () => {
  assert.equal(isValidIanaTimeZone('Australia/Sydney'), true);
  assert.equal(isValidIanaTimeZone('America/New_York'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('Australia/Not-A-Place'), false);
  assert.equal(isValidIanaTimeZone(''), false);
  assert.equal(isValidIanaTimeZone(null), false);
});

test('absolute instants are converted to the assignee local calendar date', () => {
  const instant = new Date('2026-08-20T14:00:00.000Z');
  assert.equal(instantDateInTimeZone(instant, 'Australia/Sydney'), '2026-08-21');
  assert.equal(instantDateInTimeZone(instant, 'America/New_York'), '2026-08-20');
});

test('invalid stored timezones fail closed with a stable conflict code', () => {
  assert.throws(
    () => instantDateInTimeZone(new Date('2026-08-20T14:00:00.000Z'), 'Mars/Olympus'),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 409
      && error.detail === 'leave_timezone_invalid',
  );
});

test('event end is exclusive at a local midnight leave boundary', () => {
  const common = {
    eventStart: new Date('2026-08-20T13:00:00.000Z'), // 23:00 Sydney
    leaveStartDate: '2026-08-21',
    leaveEndDate: '2026-08-21',
    timezone: 'Australia/Sydney',
  };
  assert.equal(eventOverlapsLeaveDateRange({
    ...common,
    eventEnd: new Date('2026-08-20T14:00:00.000Z'), // exactly local midnight
  }), false);
  assert.equal(eventOverlapsLeaveDateRange({
    ...common,
    eventEnd: new Date('2026-08-20T14:00:00.001Z'),
  }), true);
  assert.equal(eventOverlapsLeaveDateRange({
    ...common,
    eventStart: new Date('2026-08-20T14:00:00.000Z'),
    eventEnd: new Date('2026-08-20T15:00:00.000Z'),
  }), true);
});

test('a missing event end consumes one absolute hour across local dates', () => {
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-08-20T13:30:00.000Z'), // 23:30 Sydney
    eventEnd: null,
    leaveStartDate: '2026-08-21',
    leaveEndDate: '2026-08-21',
    timezone: 'Australia/Sydney',
  }), true);
});

test('event overlap remains calendar-correct across daylight-saving changes', () => {
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-10-03T15:30:00.000Z'),
    eventEnd: null,
    leaveStartDate: '2026-10-04',
    leaveEndDate: '2026-10-04',
    timezone: 'Australia/Sydney',
  }), true);
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-10-04T13:00:00.000Z'),
    eventEnd: new Date('2026-10-04T13:30:00.000Z'),
    leaveStartDate: '2026-10-04',
    leaveEndDate: '2026-10-04',
    timezone: 'Australia/Sydney',
  }), false);
});

test('multi-day leave overlaps any local date touched by the half-open event', () => {
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-08-20T22:00:00.000Z'),
    eventEnd: new Date('2026-08-22T02:00:00.000Z'),
    leaveStartDate: '2026-08-22',
    leaveEndDate: '2026-08-24',
    timezone: 'UTC',
  }), true);
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-08-20T22:00:00.000Z'),
    eventEnd: new Date('2026-08-22T00:00:00.000Z'),
    leaveStartDate: '2026-08-22',
    leaveEndDate: '2026-08-24',
    timezone: 'UTC',
  }), false);
});

test('zero or negative event intervals do not occupy a leave date', () => {
  const start = new Date('2026-08-21T09:00:00.000Z');
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: start,
    eventEnd: start,
    leaveStartDate: '2026-08-21',
    leaveEndDate: '2026-08-21',
    timezone: 'UTC',
  }), false);
  assert.equal(eventOverlapsLeaveDateRange({
    eventStart: start,
    eventEnd: new Date('2026-08-21T08:59:59.999Z'),
    leaveStartDate: '2026-08-21',
    leaveEndDate: '2026-08-21',
    timezone: 'UTC',
  }), false);
});

test('later leave approval ignores done history but still checks active schedule work', () => {
  const overlappingHistoricalWork = eventOverlapsLeaveDateRange({
    eventStart: new Date('2026-08-21T09:00:00.000Z'),
    eventEnd: new Date('2026-08-21T10:00:00.000Z'),
    leaveStartDate: '2026-08-21',
    leaveEndDate: '2026-08-21',
    timezone: 'UTC',
  });
  assert.equal(overlappingHistoricalWork, true);

  const approvalBlockingStatuses = new Set<string>(
    LEAVE_APPROVAL_BLOCKING_SCHEDULE_STATUSES,
  );
  assert.equal(approvalBlockingStatuses.has('planned'), true);
  assert.equal(approvalBlockingStatuses.has('in_progress'), true);
  assert.equal(approvalBlockingStatuses.has('done'), false);
  assert.equal(approvalBlockingStatuses.has('cancelled'), false);
});

test('leave lifecycle permits only pending review and pending or approved cancellation', () => {
  const expected: Record<SchedulerLeaveStatus, { review: boolean; cancel: boolean }> = {
    pending: { review: true, cancel: true },
    approved: { review: false, cancel: true },
    rejected: { review: false, cancel: false },
    cancelled: { review: false, cancel: false },
  };
  for (const [status, permissions] of Object.entries(expected)) {
    assert.equal(canReviewLeave(status as SchedulerLeaveStatus), permissions.review, status);
    assert.equal(canCancelLeave(status as SchedulerLeaveStatus), permissions.cancel, status);
  }
});

test('leave review requires a different canonical administrator', () => {
  assert.doesNotThrow(() => assertLeaveReviewerIsIndependent('admin-2', 'admin-1'));
  assert.throws(
    () => assertLeaveReviewerIsIndependent('admin-1', 'admin-1'),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 403
      && error.detail === 'leave_self_review_forbidden',
  );
});
