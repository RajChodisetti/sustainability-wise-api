import { randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  type SQL,
} from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  globalUsers,
  portalScheduleEvents,
  schedulerLeaveRequests,
  unifiedUsers,
} from '../db/schema/shared.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

export type SchedulerLeaveType = 'annual' | 'personal' | 'unpaid' | 'other';
export type SchedulerLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type SchedulerLeaveReviewDecision = 'approve' | 'reject';

export type SchedulerLeaveRequestDto = {
  id: string;
  globalUserId: string;
  fieldUserId: string;
  userDisplayName: string;
  userEmail: string;
  userTimezone: string;
  workingDaysMask: number;
  leaveType: SchedulerLeaveType;
  startDate: string;
  endDate: string;
  timezone: string;
  employeeNote: string | null;
  status: SchedulerLeaveStatus;
  reviewedByGlobalUserId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  cancelledByGlobalUserId: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSchedulerLeaveRequestInput = {
  leaveType: unknown;
  startDate: unknown;
  endDate: unknown;
  employeeNote?: unknown;
};

export type ListSchedulerLeaveRequestsInput = {
  globalUserId?: unknown;
  status?: unknown;
  from?: unknown;
  to?: unknown;
};

export type ReviewSchedulerLeaveRequestInput = {
  decision: unknown;
  reviewerNote?: unknown;
  expectedUpdatedAt: unknown;
};

export type CancelSchedulerLeaveRequestInput = {
  expectedUpdatedAt: unknown;
};

export type SchedulerLeaveExecutor = Pick<typeof db, 'insert' | 'select' | 'update'>;

type GlobalUserSnapshot = {
  id: string;
  fieldUserId: string;
  displayEmail: string;
  fullName: string | null;
  timezone: string;
  workingDaysMask: number;
  role: string;
  isActive: boolean;
};

type HrActor = GlobalUserSnapshot & { isAdmin: boolean };
type LeaveRow = typeof schedulerLeaveRequests.$inferSelect;

const PORTAL_APPS = new Set(['ecoaudit', 'solarsense', 'installhub']);
const LEAVE_TYPES = new Set<SchedulerLeaveType>(['annual', 'personal', 'unpaid', 'other']);
const LEAVE_STATUSES = new Set<SchedulerLeaveStatus>([
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);
const HR_NOTE_MAX_LENGTH = 2_000;
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1_000;
export const LEAVE_APPROVAL_BLOCKING_SCHEDULE_STATUSES = [
  'planned',
  'in_progress',
] as const;

function globalUserSelection() {
  return {
    id: globalUsers.id,
    fieldUserId: globalUsers.fieldUserId,
    displayEmail: globalUsers.displayEmail,
    fullName: globalUsers.fullName,
    timezone: globalUsers.timezone,
    workingDaysMask: globalUsers.workingDaysMask,
    role: globalUsers.role,
    isActive: globalUsers.isActive,
  };
}

function displayName(user: Pick<GlobalUserSnapshot, 'displayEmail' | 'fullName'>): string {
  return user.fullName?.trim() || user.displayEmail;
}

function optionalNote(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`);
  const note = value.trim();
  if (!note) return null;
  if (note.length > HR_NOTE_MAX_LENGTH) {
    throw badRequest(`${field} must be at most ${HR_NOTE_MAX_LENGTH} characters`);
  }
  return note;
}

function parseLeaveType(value: unknown): SchedulerLeaveType {
  if (typeof value === 'string' && LEAVE_TYPES.has(value as SchedulerLeaveType)) {
    return value as SchedulerLeaveType;
  }
  throw badRequest('leaveType must be annual, personal, unpaid, or other');
}

function parseLeaveStatus(value: unknown): SchedulerLeaveStatus {
  if (typeof value === 'string' && LEAVE_STATUSES.has(value as SchedulerLeaveStatus)) {
    return value as SchedulerLeaveStatus;
  }
  throw badRequest('status must be pending, approved, rejected, or cancelled');
}

function parseReviewDecision(value: unknown): SchedulerLeaveReviewDecision {
  if (value === 'approve' || value === 'reject') return value;
  throw badRequest('decision must be approve or reject');
}

function requireExpectedUpdatedAt(value: unknown): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('expectedUpdatedAt is required');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest('expectedUpdatedAt must be a valid ISO datetime');
  }
  return parsed;
}

function nextUpdatedAt(previous: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1));
}

function assertVersion(row: LeaveRow, expectedUpdatedAt: Date): void {
  if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw conflict('leave_request_version_conflict');
  }
}

/** Strict YYYY-MM-DD validation without allowing JavaScript date rollover. */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

function requireCalendarDate(value: unknown, field: string): string {
  if (!isValidCalendarDate(value)) {
    throw badRequest(`${field} must be a valid YYYY-MM-DD calendar date`);
  }
  return value;
}

function parseDateRange(startValue: unknown, endValue: unknown): {
  startDate: string;
  endDate: string;
} {
  const startDate = requireCalendarDate(startValue, 'startDate');
  const endDate = requireCalendarDate(endValue, 'endDate');
  if (startDate > endDate) throw badRequest('startDate must be on or before endDate');
  return { startDate, endDate };
}

/** True only for timezones accepted by the platform's IANA-backed Intl implementation. */
export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Convert an absolute instant to its local calendar date without parsing a localized string. */
export function instantDateInTimeZone(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw badRequest('Event time must be a valid datetime');
  }
  if (!isValidIanaTimeZone(timezone)) throw conflict('leave_timezone_invalid');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

/**
 * Compare a half-open event interval with an inclusive leave calendar range.
 * A missing event end is treated as one hour. The final instant itself never
 * consumes a leave day, so an event ending exactly at local midnight remains
 * on the preceding calendar date.
 */
export function eventOverlapsLeaveDateRange(input: {
  eventStart: Date;
  eventEnd: Date | null;
  leaveStartDate: string;
  leaveEndDate: string;
  timezone: string;
}): boolean {
  if (!isValidCalendarDate(input.leaveStartDate) || !isValidCalendarDate(input.leaveEndDate)) {
    throw conflict('leave_calendar_date_invalid');
  }
  if (input.leaveStartDate > input.leaveEndDate) throw conflict('leave_calendar_range_invalid');
  if (!(input.eventStart instanceof Date) || Number.isNaN(input.eventStart.getTime())) {
    throw badRequest('Event start must be a valid datetime');
  }
  const effectiveEnd = input.eventEnd
    ?? new Date(input.eventStart.getTime() + DEFAULT_EVENT_DURATION_MS);
  if (!(effectiveEnd instanceof Date) || Number.isNaN(effectiveEnd.getTime())) {
    throw badRequest('Event end must be a valid datetime');
  }
  if (effectiveEnd.getTime() <= input.eventStart.getTime()) return false;

  const firstDate = instantDateInTimeZone(input.eventStart, input.timezone);
  const lastDate = instantDateInTimeZone(
    new Date(effectiveEnd.getTime() - 1),
    input.timezone,
  );
  return firstDate <= input.leaveEndDate && lastDate >= input.leaveStartDate;
}

export function canReviewLeave(status: SchedulerLeaveStatus): boolean {
  return status === 'pending';
}

export function assertLeaveReviewerIsIndependent(
  reviewerGlobalUserId: string,
  employeeGlobalUserId: string,
): void {
  if (reviewerGlobalUserId === employeeGlobalUserId) {
    throw forbidden('leave_self_review_forbidden');
  }
}

export function canCancelLeave(status: SchedulerLeaveStatus): boolean {
  return status === 'pending' || status === 'approved';
}

function rowToDto(row: LeaveRow, user: GlobalUserSnapshot): SchedulerLeaveRequestDto {
  return {
    id: row.id,
    globalUserId: row.globalUserId,
    fieldUserId: user.fieldUserId,
    userDisplayName: displayName(user),
    userEmail: user.displayEmail,
    userTimezone: user.timezone,
    workingDaysMask: user.workingDaysMask,
    leaveType: row.leaveType as SchedulerLeaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    timezone: row.timezone,
    employeeNote: row.employeeNote,
    status: row.status as SchedulerLeaveStatus,
    reviewedByGlobalUserId: row.reviewedByGlobalUserId,
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    cancelledByGlobalUserId: row.cancelledByGlobalUserId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertHrAuthentication(user: AuthUser): void {
  if (user.authType !== 'jwt') throw forbidden('hr_jwt_required');
  if (!PORTAL_APPS.has(user.app)) throw forbidden('hr_portal_app_required');
}

async function resolveHrActor(
  executor: SchedulerLeaveExecutor,
  user: AuthUser,
): Promise<HrActor> {
  assertHrAuthentication(user);
  const [actor] = await executor.select(globalUserSelection())
    .from(unifiedUsers)
    .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
      eq(unifiedUsers.isActive, true),
      eq(globalUsers.isActive, true),
      // Keep old JWTs from accessing HR after a canonical membership is removed.
      isNull(unifiedUsers.deletedAt),
    ))
    .limit(1);
  if (!actor) throw forbidden('active_global_user_required');
  return { ...actor, isAdmin: actor.role === 'admin' };
}

async function lockGlobalUserById(
  executor: SchedulerLeaveExecutor,
  globalUserId: string,
  requireActive: boolean,
): Promise<GlobalUserSnapshot> {
  const conditions = [eq(globalUsers.id, globalUserId)];
  if (requireActive) conditions.push(eq(globalUsers.isActive, true));
  const [user] = await executor.select(globalUserSelection())
    .from(globalUsers)
    .where(and(...conditions))
    .for('update')
    .limit(1);
  if (!user) throw notFound('Global user');
  return user;
}

async function findOverlappingLeave(
  executor: SchedulerLeaveExecutor,
  globalUserId: string,
  startDate: string,
  endDate: string,
  excludingId?: string,
): Promise<{ id: string } | null> {
  const conditions: SQL[] = [
    eq(schedulerLeaveRequests.globalUserId, globalUserId),
    inArray(schedulerLeaveRequests.status, ['pending', 'approved']),
    lte(schedulerLeaveRequests.startDate, endDate),
    gte(schedulerLeaveRequests.endDate, startDate),
  ];
  if (excludingId) conditions.push(ne(schedulerLeaveRequests.id, excludingId));
  const [overlap] = await executor.select({ id: schedulerLeaveRequests.id })
    .from(schedulerLeaveRequests)
    .where(and(...conditions))
    .limit(1);
  return overlap ?? null;
}

export async function assertSchedulerLeaveAdmin(user: AuthUser): Promise<void> {
  const actor = await resolveHrActor(db, user);
  if (!actor.isAdmin) throw forbidden('global_hr_admin_required');
}

export async function listSchedulerLeaveRequests(
  user: AuthUser,
  input: ListSchedulerLeaveRequestsInput = {},
): Promise<SchedulerLeaveRequestDto[]> {
  const actor = await resolveHrActor(db, user);
  const conditions: SQL[] = [];

  if (actor.isAdmin) {
    if (input.globalUserId !== undefined) {
      if (typeof input.globalUserId !== 'string' || !input.globalUserId.trim()) {
        throw badRequest('globalUserId must be a non-empty string');
      }
      conditions.push(eq(schedulerLeaveRequests.globalUserId, input.globalUserId.trim()));
    }
  } else {
    conditions.push(eq(schedulerLeaveRequests.globalUserId, actor.id));
  }

  if (input.status !== undefined) {
    conditions.push(eq(schedulerLeaveRequests.status, parseLeaveStatus(input.status)));
  }
  let from: string | null = null;
  let to: string | null = null;
  if (input.from !== undefined) from = requireCalendarDate(input.from, 'from');
  if (input.to !== undefined) to = requireCalendarDate(input.to, 'to');
  if (from !== null && to !== null && from > to) {
    throw badRequest('from must be on or before to');
  }
  if (from !== null) conditions.push(gte(schedulerLeaveRequests.endDate, from));
  if (to !== null) conditions.push(lte(schedulerLeaveRequests.startDate, to));

  const rows = await db.select({
    leave: schedulerLeaveRequests,
    user: globalUserSelection(),
  }).from(schedulerLeaveRequests)
    .innerJoin(globalUsers, eq(globalUsers.id, schedulerLeaveRequests.globalUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schedulerLeaveRequests.createdAt), desc(schedulerLeaveRequests.id));
  return rows.map(({ leave, user: leaveUser }) => rowToDto(leave, leaveUser));
}

export async function createSchedulerLeaveRequest(
  user: AuthUser,
  input: CreateSchedulerLeaveRequestInput,
): Promise<SchedulerLeaveRequestDto> {
  const leaveType = parseLeaveType(input.leaveType);
  const { startDate, endDate } = parseDateRange(input.startDate, input.endDate);
  const employeeNote = optionalNote(input.employeeNote, 'employeeNote');

  return db.transaction(async (tx) => {
    const actor = await resolveHrActor(tx, user);
    const lockedUser = await lockGlobalUserById(tx, actor.id, true);
    if (!isValidIanaTimeZone(lockedUser.timezone)) throw conflict('user_timezone_invalid');
    if (await findOverlappingLeave(tx, lockedUser.id, startDate, endDate)) {
      throw conflict('leave_request_overlap');
    }

    const now = new Date();
    const [created] = await tx.insert(schedulerLeaveRequests).values({
      id: randomUUID(),
      globalUserId: lockedUser.id,
      leaveType,
      startDate,
      endDate,
      timezone: lockedUser.timezone,
      employeeNote,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw conflict('leave_request_create_failed');
    return rowToDto(created, lockedUser);
  });
}

export async function reviewSchedulerLeaveRequest(
  user: AuthUser,
  id: string,
  input: ReviewSchedulerLeaveRequestInput,
): Promise<SchedulerLeaveRequestDto> {
  if (!id.trim()) throw badRequest('Leave request id is required');
  const decision = parseReviewDecision(input.decision);
  const reviewerNote = optionalNote(input.reviewerNote, 'reviewerNote');
  const expectedUpdatedAt = requireExpectedUpdatedAt(input.expectedUpdatedAt);

  return db.transaction(async (tx) => {
    const actor = await resolveHrActor(tx, user);
    if (!actor.isAdmin) throw forbidden('global_hr_admin_required');

    const [hint] = await tx.select({ globalUserId: schedulerLeaveRequests.globalUserId })
      .from(schedulerLeaveRequests)
      .where(eq(schedulerLeaveRequests.id, id))
      .limit(1);
    if (!hint) throw notFound('Leave request');
    const targetUser = await lockGlobalUserById(tx, hint.globalUserId, false);
    const [leave] = await tx.select().from(schedulerLeaveRequests)
      .where(eq(schedulerLeaveRequests.id, id))
      .for('update')
      .limit(1);
    if (!leave || leave.globalUserId !== targetUser.id) throw notFound('Leave request');
    assertLeaveReviewerIsIndependent(actor.id, leave.globalUserId);
    assertVersion(leave, expectedUpdatedAt);
    if (!canReviewLeave(leave.status as SchedulerLeaveStatus)) {
      throw conflict('leave_request_not_pending');
    }

    if (decision === 'approve') {
      if (await findOverlappingLeave(
        tx,
        leave.globalUserId,
        leave.startDate,
        leave.endDate,
        leave.id,
      )) {
        throw conflict('leave_request_overlap');
      }
      if (!isValidIanaTimeZone(leave.timezone)) throw conflict('leave_timezone_invalid');
      const events = await tx.select({
        id: portalScheduleEvents.id,
        scheduledStartAt: portalScheduleEvents.scheduledStartAt,
        scheduledEndAt: portalScheduleEvents.scheduledEndAt,
      }).from(portalScheduleEvents).where(and(
        eq(portalScheduleEvents.assigneeFieldUserId, targetUser.fieldUserId),
        inArray(portalScheduleEvents.status, [...LEAVE_APPROVAL_BLOCKING_SCHEDULE_STATUSES]),
      ));
      if (events.some((event) => eventOverlapsLeaveDateRange({
        eventStart: event.scheduledStartAt,
        eventEnd: event.scheduledEndAt,
        leaveStartDate: leave.startDate,
        leaveEndDate: leave.endDate,
        timezone: leave.timezone,
      }))) {
        throw conflict('leave_approval_schedule_conflict');
      }
    }

    const now = new Date();
    const [updated] = await tx.update(schedulerLeaveRequests).set({
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewedByGlobalUserId: actor.id,
      reviewerNote,
      reviewedAt: now,
      updatedAt: nextUpdatedAt(leave.updatedAt, now),
    }).where(eq(schedulerLeaveRequests.id, leave.id)).returning();
    if (!updated) throw conflict('leave_request_update_failed');
    return rowToDto(updated, targetUser);
  });
}

export async function cancelSchedulerLeaveRequest(
  user: AuthUser,
  id: string,
  input: CancelSchedulerLeaveRequestInput,
): Promise<SchedulerLeaveRequestDto> {
  if (!id.trim()) throw badRequest('Leave request id is required');
  const expectedUpdatedAt = requireExpectedUpdatedAt(input.expectedUpdatedAt);

  return db.transaction(async (tx) => {
    const actor = await resolveHrActor(tx, user);
    const [hint] = await tx.select({ globalUserId: schedulerLeaveRequests.globalUserId })
      .from(schedulerLeaveRequests)
      .where(eq(schedulerLeaveRequests.id, id))
      .limit(1);
    if (!hint || (!actor.isAdmin && hint.globalUserId !== actor.id)) {
      // Hide other employees' HR records from non-admin callers.
      throw notFound('Leave request');
    }
    const targetUser = await lockGlobalUserById(tx, hint.globalUserId, false);
    const [leave] = await tx.select().from(schedulerLeaveRequests)
      .where(eq(schedulerLeaveRequests.id, id))
      .for('update')
      .limit(1);
    if (!leave || leave.globalUserId !== targetUser.id) throw notFound('Leave request');
    assertVersion(leave, expectedUpdatedAt);
    if (!canCancelLeave(leave.status as SchedulerLeaveStatus)) {
      throw conflict('leave_request_not_cancellable');
    }

    const now = new Date();
    const [updated] = await tx.update(schedulerLeaveRequests).set({
      status: 'cancelled',
      cancelledByGlobalUserId: actor.id,
      cancelledAt: now,
      updatedAt: nextUpdatedAt(leave.updatedAt, now),
    }).where(eq(schedulerLeaveRequests.id, leave.id)).returning();
    if (!updated) throw conflict('leave_request_update_failed');
    return rowToDto(updated, targetUser);
  });
}

/**
 * Scheduler transaction fence: lock the canonical assignee row, then reject
 * any active event interval touching an approved local leave calendar date.
 */
export async function lockAndAssertAssigneeAvailable(
  executor: SchedulerLeaveExecutor,
  fieldUserId: string,
  eventStart: Date,
  eventEnd: Date | null,
): Promise<void> {
  if (typeof fieldUserId !== 'string' || !fieldUserId.trim()) {
    throw badRequest('assigneeFieldUserId is required');
  }
  if (!(eventStart instanceof Date) || Number.isNaN(eventStart.getTime())) {
    throw badRequest('scheduledStartAt must be a valid datetime');
  }
  if (eventEnd !== null && (!(eventEnd instanceof Date) || Number.isNaN(eventEnd.getTime()))) {
    throw badRequest('scheduledEndAt must be a valid datetime or null');
  }

  const [assignee] = await executor.select(globalUserSelection())
    .from(globalUsers)
    .where(and(
      eq(globalUsers.fieldUserId, fieldUserId.trim()),
      eq(globalUsers.isActive, true),
    ))
    .for('update')
    .limit(1);
  if (!assignee) throw notFound('Assignee');
  if (!isValidIanaTimeZone(assignee.timezone)) throw conflict('assignee_timezone_invalid');

  const leaveRows = await executor.select({
    startDate: schedulerLeaveRequests.startDate,
    endDate: schedulerLeaveRequests.endDate,
    timezone: schedulerLeaveRequests.timezone,
  }).from(schedulerLeaveRequests).where(and(
    eq(schedulerLeaveRequests.globalUserId, assignee.id),
    eq(schedulerLeaveRequests.status, 'approved'),
  ));
  if (leaveRows.some((leave) => eventOverlapsLeaveDateRange({
    eventStart,
    eventEnd,
    leaveStartDate: leave.startDate,
    leaveEndDate: leave.endDate,
    timezone: leave.timezone,
  }))) {
    throw conflict('assignee_on_approved_leave');
  }
}
