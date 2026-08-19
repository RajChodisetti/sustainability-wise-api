import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihGridSupplies, ihInstallations } from '../db/schema/installhub.js';
import { globalUsers, portalScheduleEvents, unifiedUsers } from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import type { AuthUser } from '../auth/middleware.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { deriveSiteCode } from '../routes/installhub/canonical.js';
import {
  cancelPendingSchedulerNotifications,
  enqueueAutomatedSchedulerNotifications,
  enqueueImmediateSchedulerNotification,
  isMobileScheduleNotificationTarget,
  isMobileScheduleSourceApp,
  isSchedulerNotificationEligible,
} from './schedulerNotificationService.js';
import {
  assertSchedulerSourceAppVisible,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from './schedulerVisibility.js';

export type ScheduleSourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type ScheduleSourceType = 'audit' | 'site' | 'assessment' | 'installation' | 'custom';
export type ScheduleStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export type ScheduleEventDto = {
  id: string;
  title: string;
  description: string | null;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId: string | null;
  assigneeFieldUserId: string;
  assigneeDisplayName: string | null;
  assigneeEmail: string | null;
  scheduledStartAt: string;
  estimatedDurationMinutes: number | null;
  scheduledEndAt: string | null;
  deadlineAt: string;
  status: ScheduleStatus;
  createdByUserId: string;
  createdByApp: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type ScheduleSummary = {
  today: number;
  thisWeek: number;
  overdue: number;
  planned: number;
  inProgress: number;
  byApp: Partial<Record<ScheduleSourceApp, number>>;
};

export type JobOption = {
  id: string;
  label: string;
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  sourceType: Exclude<ScheduleSourceType, 'custom'>;
  subtitle?: string | null;
};

type ScheduleExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

type UnifiedSchedulerSubject = {
  globalUserId: string;
  fieldUserId: string;
  displayName: string | null;
  email: string | null;
  appUserIds: Partial<Record<Exclude<ScheduleSourceApp, 'custom'>, string>>;
};

const PORTAL_APPS = new Set(['ecoaudit', 'solarsense', 'installhub']);

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${field} must be a valid ISO datetime`);
  }
  return date;
}

export const MAX_ESTIMATED_DURATION_MINUTES = 7 * 24 * 60;

/**
 * Estimates are optional, but an estimate that is supplied must be a whole,
 * positive number of minutes. Null and an empty string explicitly clear an
 * existing estimate; undefined means the caller did not send the field.
 */
export function parseEstimatedDurationMinutes(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > MAX_ESTIMATED_DURATION_MINUTES
  ) {
    throw badRequest(
      `estimatedDurationMinutes must be a whole number between 1 and ${MAX_ESTIMATED_DURATION_MINUTES}`,
    );
  }
  return value;
}

export function deriveScheduledEndAt(
  scheduledStartAt: Date,
  estimatedDurationMinutes: number | null,
): Date | null {
  if (estimatedDurationMinutes === null) return null;
  return new Date(scheduledStartAt.getTime() + estimatedDurationMinutes * 60_000);
}

function rejectClientScheduledEndAt(value: unknown): void {
  // Null is tolerated temporarily so an API-first rolling deploy remains
  // compatible with the previous portal, which sent null for an empty field.
  if (value !== undefined && value !== null) {
    throw badRequest(
      'scheduledEndAt is derived; refresh and provide estimatedDurationMinutes instead',
    );
  }
}

function parseSourceApp(value: unknown): ScheduleSourceApp {
  if (
    value === 'ecoaudit'
    || value === 'solarsense'
    || value === 'installhub'
    || value === 'custom'
  ) {
    return value;
  }
  throw badRequest('sourceApp must be ecoaudit, solarsense, installhub, or custom');
}

function parseSourceType(value: unknown): ScheduleSourceType {
  if (
    value === 'audit'
    || value === 'site'
    || value === 'assessment'
    || value === 'installation'
    || value === 'custom'
  ) {
    return value;
  }
  throw badRequest('sourceType must be audit, site, assessment, installation, or custom');
}

function parseStatus(value: unknown): ScheduleStatus {
  if (
    value === 'planned'
    || value === 'in_progress'
    || value === 'done'
    || value === 'cancelled'
  ) {
    return value;
  }
  throw badRequest('status must be planned, in_progress, done, or cancelled');
}

function rowToDto(row: typeof portalScheduleEvents.$inferSelect): ScheduleEventDto {
  const scheduledEndAt = row.estimatedDurationMinutes === null
    ? row.scheduledEndAt
    : deriveScheduledEndAt(row.scheduledStartAt, row.estimatedDurationMinutes);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sourceApp: row.sourceApp as ScheduleSourceApp,
    sourceType: row.sourceType as ScheduleSourceType,
    sourceId: row.sourceId,
    assigneeFieldUserId: row.assigneeFieldUserId,
    assigneeDisplayName: row.assigneeDisplayName,
    assigneeEmail: row.assigneeEmail,
    scheduledStartAt: row.scheduledStartAt.toISOString(),
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    scheduledEndAt: toIso(scheduledEndAt),
    deadlineAt: row.deadlineAt.toISOString(),
    status: row.status as ScheduleStatus,
    createdByUserId: row.createdByUserId,
    createdByApp: row.createdByApp,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: toIso(row.cancelledAt),
  };
}

export function assertPortalSchedulerApp(user: AuthUser): void {
  if (!PORTAL_APPS.has(user.app)) {
    throw forbidden('Scheduler is unavailable for this application');
  }
}

export function isSchedulerAdmin(user: AuthUser): boolean {
  return user.role === 'admin';
}

/** Resolve field_user_id for the signed-in portal user (origin app + origin user id). */
export async function resolveCallerFieldUserId(user: AuthUser): Promise<string | null> {
  const [row] = await db
    .select({ fieldUserId: unifiedUsers.fieldUserId })
    .from(unifiedUsers)
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
      isNull(unifiedUsers.deletedAt),
    ))
    .limit(1);
  return row?.fieldUserId ?? null;
}

async function loadSchedulerSubject(
  executor: ScheduleExecutor,
  fieldUserId: string,
): Promise<UnifiedSchedulerSubject> {
  const rows = await executor
    .select({
      globalUserId: unifiedUsers.globalUserId,
      fieldUserId: unifiedUsers.fieldUserId,
      originApp: unifiedUsers.originApp,
      originUserId: unifiedUsers.originUserId,
      fullName: unifiedUsers.fullName,
      email: unifiedUsers.email,
      isActive: unifiedUsers.isActive,
      deletedAt: unifiedUsers.deletedAt,
    })
    .from(unifiedUsers)
    .where(eq(unifiedUsers.fieldUserId, fieldUserId));

  const active = rows.filter((row) => !row.deletedAt && row.isActive);
  if (active.length === 0) {
    throw badRequest('Assignee must be an active unified portal user');
  }

  const representative = active.find((row) => row.fullName?.trim()) ?? active[0];
  const appUserIds: UnifiedSchedulerSubject['appUserIds'] = {};
  for (const row of active) {
    if (
      row.originApp === 'ecoaudit'
      || row.originApp === 'solarsense'
      || row.originApp === 'installhub'
    ) {
      appUserIds[row.originApp] = row.originUserId;
    }
  }

  return {
    globalUserId: representative.globalUserId,
    fieldUserId: representative.fieldUserId,
    displayName: representative.fullName,
    email: representative.email,
    appUserIds,
  };
}

async function resolveSchedulerGlobalUserId(
  executor: ScheduleExecutor,
  fieldUserId: string,
): Promise<string | null> {
  const [identity] = await executor
    .select({ globalUserId: globalUsers.id })
    .from(globalUsers)
    .where(eq(globalUsers.fieldUserId, fieldUserId))
    .limit(1);
  return identity?.globalUserId ?? null;
}

function requireProductUserId(
  subject: UnifiedSchedulerSubject,
  sourceApp: 'ecoaudit' | 'solarsense',
): string {
  const userId = subject.appUserIds[sourceApp];
  if (!userId) {
    throw badRequest(
      sourceApp === 'ecoaudit'
        ? 'Assignee must have an active Eco Audit account'
        : 'Assignee must have an active Solar Sense account',
    );
  }
  return userId;
}

async function loadActorSubject(
  executor: ScheduleExecutor,
  user: AuthUser,
): Promise<UnifiedSchedulerSubject> {
  const [origin] = await executor
    .select({ fieldUserId: unifiedUsers.fieldUserId })
    .from(unifiedUsers)
    .where(and(
      eq(unifiedUsers.originApp, user.app),
      eq(unifiedUsers.originUserId, user.userId),
      isNull(unifiedUsers.deletedAt),
    ))
    .limit(1);
  if (!origin) throw badRequest('Scheduler user is missing from the unified directory');
  return loadSchedulerSubject(executor, origin.fieldUserId);
}

async function assertSourceExists(
  executor: ScheduleExecutor,
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
): Promise<string> {
  if (sourceApp === 'custom' || sourceType === 'custom') {
    if (sourceId) throw badRequest('custom events must not set sourceId');
    return '';
  }
  if (!sourceId?.trim()) {
    throw badRequest('sourceId is required for linked jobs');
  }
  const id = sourceId.trim();

  if (sourceApp === 'ecoaudit' && sourceType === 'audit') {
    const [row] = await executor
      .select({ id: eaAudits.id, siteName: eaAudits.siteName })
      .from(eaAudits)
      .where(and(
        eq(eaAudits.id, id),
        eq(eaAudits.status, 'Draft'),
        isNull(eaAudits.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Active Draft audit');
    return row.siteName;
  }

  if (sourceApp === 'solarsense' && sourceType === 'site') {
    throw badRequest('New Solar scheduler links must target a rooftop assessment, not a site');
  }

  if (sourceApp === 'solarsense' && sourceType === 'assessment') {
    const [row] = await executor
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .innerJoin(ssSites, and(
        eq(ssSites.id, ssRooftopAssessments.siteId),
        eq(ssSites.status, 'Draft'),
        isNull(ssSites.deletedAt),
      ))
      .where(and(
        eq(ssRooftopAssessments.id, id),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Active Draft assessment');
    return `${row.siteName} · ${row.building}`;
  }

  if (sourceApp === 'installhub' && sourceType === 'installation') {
    const [row] = await executor
      .select({
        id: ihInstallations.id,
        siteName: ihInstallations.siteName,
        clientName: ihInstallations.clientName,
      })
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.id, id),
        eq(ihInstallations.status, 'Draft'),
        isNull(ihInstallations.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Active Draft installation');
    return `${row.clientName} · ${row.siteName}`;
  }

  throw badRequest('Invalid sourceApp / sourceType combination');
}

function validateAppTypePair(sourceApp: ScheduleSourceApp, sourceType: ScheduleSourceType): void {
  if (sourceApp === 'custom' && sourceType !== 'custom') {
    throw badRequest('custom sourceApp requires sourceType custom');
  }
  if (sourceApp === 'ecoaudit' && sourceType !== 'audit') {
    throw badRequest('ecoaudit events must use sourceType audit');
  }
  if (sourceApp === 'installhub' && sourceType !== 'installation') {
    throw badRequest('installhub events must use sourceType installation');
  }
  if (sourceApp === 'solarsense' && sourceType !== 'assessment') {
    throw badRequest('New Solar scheduler links must use sourceType assessment');
  }
}

async function alignLinkedSourceAssignment(
  executor: ScheduleExecutor,
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
  subject: UnifiedSchedulerSubject,
  strict = true,
): Promise<boolean> {
  if (!sourceId || sourceApp === 'custom' || sourceType === 'custom') return false;
  if (sourceApp === 'ecoaudit' && sourceType === 'audit') {
    const desiredAssignee = requireProductUserId(subject, 'ecoaudit');
    const [current] = await executor
      .select({ assignedInspectorUserId: eaAudits.assignedInspectorUserId })
      .from(eaAudits)
      .where(and(
        eq(eaAudits.id, sourceId),
        eq(eaAudits.status, 'Draft'),
        isNull(eaAudits.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!current) {
      if (!strict) return false;
      throw conflict('Linked audit is no longer an active Draft');
    }
    if (current.assignedInspectorUserId === desiredAssignee) return false;
    const [updated] = await executor
      .update(eaAudits)
      .set({
        assignedInspectorUserId: desiredAssignee,
        updatedAt: new Date(),
        syncStatus: 'local',
      })
      .where(and(
        eq(eaAudits.id, sourceId),
        eq(eaAudits.status, 'Draft'),
        isNull(eaAudits.deletedAt),
      ))
      .returning({ id: eaAudits.id });
    if (!updated) throw conflict('Linked audit is no longer an active Draft');
    return true;
  }
  if (sourceApp === 'solarsense' && sourceType === 'assessment') {
    const desiredAssignee = requireProductUserId(subject, 'solarsense');
    const [current] = await executor
      .select({ assignedInspectorUserId: ssRooftopAssessments.assignedInspectorUserId })
      .from(ssRooftopAssessments)
      .where(and(
        eq(ssRooftopAssessments.id, sourceId),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!current) {
      if (!strict) return false;
      throw conflict('Linked assessment is no longer an active Draft');
    }
    if (current.assignedInspectorUserId === desiredAssignee) return false;
    const [updated] = await executor
      .update(ssRooftopAssessments)
      .set({
        assignedInspectorUserId: desiredAssignee,
        updatedAt: new Date(),
        syncStatus: 'local',
      })
      .where(and(
        eq(ssRooftopAssessments.id, sourceId),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
      ))
      .returning({ id: ssRooftopAssessments.id });
    if (!updated) throw conflict('Linked assessment is no longer an active Draft');
    return true;
  }
  if (sourceApp === 'installhub' && sourceType === 'installation') {
    const [current] = await executor
      .select({ assignedInspectorUserId: ihInstallations.assignedInspectorUserId })
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.id, sourceId),
        eq(ihInstallations.status, 'Draft'),
        isNull(ihInstallations.deletedAt),
      ))
      .for('update')
      .limit(1);
    if (!current) {
      if (!strict) return false;
      throw conflict('Linked installation is no longer an active Draft');
    }
    if (current.assignedInspectorUserId === subject.fieldUserId) return false;
    const [updated] = await executor
      .update(ihInstallations)
      .set({
        assignedInspectorUserId: subject.fieldUserId,
        updatedAt: new Date(),
        syncStatus: 'local',
      })
      .where(and(
        eq(ihInstallations.id, sourceId),
        eq(ihInstallations.status, 'Draft'),
        isNull(ihInstallations.deletedAt),
      ))
      .returning({ id: ihInstallations.id });
    if (!updated) throw conflict('Linked installation is no longer an active Draft');
    return true;
  }
  if (sourceApp === 'solarsense' && sourceType === 'site') {
    throw badRequest('Legacy Solar site events cannot change product assignment');
  }
  throw badRequest('Invalid linked scheduler source');
}

async function clearLinkedSourceAssignment(
  executor: ScheduleExecutor,
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId || sourceApp === 'custom' || sourceType === 'custom') return;
  if (sourceApp === 'ecoaudit' && sourceType === 'audit') {
    await executor.update(eaAudits).set({
      assignedInspectorUserId: null,
      updatedAt: new Date(),
      syncStatus: 'local',
    }).where(and(
      eq(eaAudits.id, sourceId),
      eq(eaAudits.status, 'Draft'),
      isNull(eaAudits.deletedAt),
    ));
    return;
  }
  if (sourceApp === 'solarsense' && sourceType === 'assessment') {
    await executor.update(ssRooftopAssessments).set({
      assignedInspectorUserId: null,
      updatedAt: new Date(),
      syncStatus: 'local',
    }).where(and(
      eq(ssRooftopAssessments.id, sourceId),
      eq(ssRooftopAssessments.status, 'Draft'),
      isNull(ssRooftopAssessments.deletedAt),
    ));
    return;
  }
  if (sourceApp === 'installhub' && sourceType === 'installation') {
    await executor.update(ihInstallations).set({
      assignedInspectorUserId: null,
      updatedAt: new Date(),
      syncStatus: 'local',
    }).where(and(
      eq(ihInstallations.id, sourceId),
      eq(ihInstallations.status, 'Draft'),
      isNull(ihInstallations.deletedAt),
    ));
  }
}

async function assertNoActiveLinkedEvent(
  executor: ScheduleExecutor,
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId || sourceApp === 'custom') return;
  const [existing] = await executor
    .select({ id: portalScheduleEvents.id })
    .from(portalScheduleEvents)
    .where(and(
      eq(portalScheduleEvents.sourceApp, sourceApp),
      eq(portalScheduleEvents.sourceType, sourceType),
      eq(portalScheduleEvents.sourceId, sourceId),
      ne(portalScheduleEvents.status, 'cancelled'),
    ))
    .limit(1);
  if (existing) throw conflict('Job already has an active scheduler event');
}

async function reconcileAssignmentAfterCancellation(
  executor: ScheduleExecutor,
  cancelled: typeof portalScheduleEvents.$inferSelect,
): Promise<void> {
  if (!cancelled.sourceId || cancelled.sourceApp === 'custom') return;
  if (!isMobileScheduleNotificationTarget(cancelled)) return;
  const [remaining] = await executor
    .select()
    .from(portalScheduleEvents)
    .where(and(
      ne(portalScheduleEvents.id, cancelled.id),
      eq(portalScheduleEvents.sourceApp, cancelled.sourceApp),
      eq(portalScheduleEvents.sourceType, cancelled.sourceType),
      eq(portalScheduleEvents.sourceId, cancelled.sourceId),
      ne(portalScheduleEvents.status, 'cancelled'),
    ))
    .orderBy(desc(portalScheduleEvents.updatedAt), desc(portalScheduleEvents.createdAt))
    .limit(1);
  if (!remaining) {
    await clearLinkedSourceAssignment(
      executor,
      cancelled.sourceApp as ScheduleSourceApp,
      cancelled.sourceType as ScheduleSourceType,
      cancelled.sourceId,
    );
    return;
  }
  const subject = await loadSchedulerSubject(executor, remaining.assigneeFieldUserId);
  await alignLinkedSourceAssignment(
    executor,
    remaining.sourceApp as ScheduleSourceApp,
    remaining.sourceType as ScheduleSourceType,
    remaining.sourceId,
    subject,
    false,
  );
}

export type ListEventsFilters = {
  from?: Date;
  to?: Date;
  assigneeFieldUserId?: string;
  sourceApp?: ScheduleSourceApp;
  status?: ScheduleStatus;
  includeCancelled?: boolean;
};

export async function listScheduleEvents(
  user: AuthUser,
  filters: ListEventsFilters,
): Promise<ScheduleEventDto[]> {
  assertPortalSchedulerApp(user);
  const conditions: SQL[] = [];

  conditions.push(inArray(portalScheduleEvents.sourceApp, schedulerVisibleSourceApps()));

  if (!filters.includeCancelled) {
    conditions.push(ne(portalScheduleEvents.status, 'cancelled'));
  }
  if (filters.from) {
    conditions.push(gte(portalScheduleEvents.scheduledStartAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(portalScheduleEvents.scheduledStartAt, filters.to));
  }
  if (filters.sourceApp) {
    conditions.push(eq(portalScheduleEvents.sourceApp, filters.sourceApp));
  }
  if (filters.status) {
    conditions.push(eq(portalScheduleEvents.status, filters.status));
  }

  if (!isSchedulerAdmin(user)) {
    const fieldUserId = await resolveCallerFieldUserId(user);
    if (!fieldUserId) {
      return [];
    }
    conditions.push(eq(portalScheduleEvents.assigneeFieldUserId, fieldUserId));
  } else if (filters.assigneeFieldUserId) {
    conditions.push(eq(portalScheduleEvents.assigneeFieldUserId, filters.assigneeFieldUserId));
  }

  const rows = await db
    .select()
    .from(portalScheduleEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(portalScheduleEvents.scheduledStartAt), asc(portalScheduleEvents.id))
    .limit(2000);

  return rows.map(rowToDto);
}

export async function getScheduleEvent(user: AuthUser, id: string): Promise<ScheduleEventDto> {
  assertPortalSchedulerApp(user);
  const [row] = await db
    .select()
    .from(portalScheduleEvents)
    .where(eq(portalScheduleEvents.id, id))
    .limit(1);
  if (!row) throw notFound('Schedule event');
  assertSchedulerSourceAppVisible(row.sourceApp);

  if (!isSchedulerAdmin(user)) {
    const fieldUserId = await resolveCallerFieldUserId(user);
    if (!fieldUserId || row.assigneeFieldUserId !== fieldUserId) {
      throw forbidden('You can only view your own schedule events');
    }
  }

  return rowToDto(row);
}

export type CreateScheduleEventInput = {
  title?: string;
  description?: string | null;
  sourceApp: unknown;
  sourceType: unknown;
  sourceId?: string | null;
  assigneeFieldUserId: string;
  scheduledStartAt: unknown;
  estimatedDurationMinutes?: unknown;
  /** @deprecated Client-provided end times are rejected. */
  scheduledEndAt?: unknown;
  deadlineAt: unknown;
  status?: unknown;
};

export async function createScheduleEvent(
  user: AuthUser,
  input: CreateScheduleEventInput,
): Promise<ScheduleEventDto> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can create schedule events');
  }

  const sourceApp = parseSourceApp(input.sourceApp);
  assertSchedulerSourceAppVisible(sourceApp);
  const sourceType = parseSourceType(input.sourceType);
  validateAppTypePair(sourceApp, sourceType);

  const sourceId = input.sourceId?.trim() || null;
  const start = requireIsoDate(input.scheduledStartAt, 'scheduledStartAt');
  const deadline = requireIsoDate(input.deadlineAt, 'deadlineAt');
  rejectClientScheduledEndAt(input.scheduledEndAt);
  const estimatedDurationMinutes = parseEstimatedDurationMinutes(
    input.estimatedDurationMinutes,
  );
  const end = deriveScheduledEndAt(start, estimatedDurationMinutes);

  if (typeof input.assigneeFieldUserId !== 'string' || !input.assigneeFieldUserId.trim()) {
    throw badRequest('assigneeFieldUserId is required');
  }
  const status = input.status !== undefined ? parseStatus(input.status) : 'planned';
  if (status === 'cancelled') throw badRequest('Create with planned status; cancel via PATCH/DELETE');

  const created = await db.transaction(async (tx) => {
    const labelFromSource = await assertSourceExists(tx, sourceApp, sourceType, sourceId);
    const title = (input.title?.trim() || labelFromSource || 'Scheduled work').slice(0, 300);
    if (!title) throw badRequest('title is required');
    const assignee = await loadSchedulerSubject(tx, input.assigneeFieldUserId.trim());
    // Updating the product assignment takes its row lock. Do this before the
    // duplicate check so concurrent creates for the same source serialize;
    // the losing transaction then observes the winner's committed event and
    // rolls its assignment update back with the conflict.
    await alignLinkedSourceAssignment(tx, sourceApp, sourceType, sourceId, assignee);
    await assertNoActiveLinkedEvent(tx, sourceApp, sourceType, sourceId);

    const now = new Date();
    const [event] = await tx.insert(portalScheduleEvents).values({
      id: randomUUID(),
      title,
      description: input.description?.trim() || null,
      sourceApp,
      sourceType,
      sourceId: sourceApp === 'custom' ? null : sourceId,
      assigneeFieldUserId: assignee.fieldUserId,
      assigneeDisplayName: assignee.displayName,
      assigneeEmail: assignee.email,
      scheduledStartAt: start,
      estimatedDurationMinutes,
      scheduledEndAt: end,
      deadlineAt: deadline,
      status,
      createdByUserId: user.userId,
      createdByApp: user.app,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (isMobileScheduleNotificationTarget(event) && event.status !== 'done') {
      await enqueueImmediateSchedulerNotification(
        tx,
        event,
        assignee.globalUserId,
        'assigned',
        now,
      );
      await enqueueAutomatedSchedulerNotifications(
        tx,
        event,
        assignee.globalUserId,
        now,
      );
    }
    return event;
  });

  return rowToDto(created);
}

export type CreateSchedulerDispatchInput = {
  sourceApp: unknown;
  title?: string;
  description?: string | null;
  assigneeFieldUserId: string;
  scheduledStartAt: unknown;
  estimatedDurationMinutes?: unknown;
  /** @deprecated Client-provided end times are rejected. */
  scheduledEndAt?: unknown;
  deadlineAt: unknown;
  job: unknown;
  status?: unknown;
};

type DispatchJobInput = Record<string, unknown>;

const DISPATCH_JOB_FIELDS: Record<Exclude<ScheduleSourceApp, 'custom'>, ReadonlySet<string>> = {
  ecoaudit: new Set(['siteName', 'siteAddress', 'auditDate']),
  solarsense: new Set(['siteName', 'location', 'buildingIdName', 'auditDate']),
  installhub: new Set(['clientName', 'siteName', 'siteAddress', 'auditDate', 'timezone']),
};

function parseDispatchJob(
  value: unknown,
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
): DispatchJobInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('job is required');
  }
  const job = value as DispatchJobInput;
  const serverOwnedFields = [
    'id',
    'serverId',
    'status',
    'syncStatus',
    'createdByUserId',
    'assignedInspectorUserId',
    'completedAt',
    'deletedAt',
  ];
  const supplied = serverOwnedFields.find((field) => field in job);
  if (supplied) throw badRequest(`job.${supplied} is server-owned`);
  const unsupported = Object.keys(job).find((field) => !DISPATCH_JOB_FIELDS[sourceApp].has(field));
  if (unsupported) throw badRequest(`job.${unsupported} is not accepted for ${sourceApp}`);
  return job;
}

function dispatchString(job: DispatchJobInput, field: string): string {
  const value = job[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`job.${field} is required`);
  }
  return value.trim();
}

function optionalDispatchString(job: DispatchJobInput, field: string): string | null {
  const value = job[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`job.${field} must be a string`);
  return value.trim() || null;
}

function optionalDispatchDate(job: DispatchJobInput, field: string): string | null {
  const value = optionalDispatchString(job, field);
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`job.${field} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`job.${field} must be a valid calendar date`);
  }
  return value;
}

function validateDispatchJob(
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
): void {
  optionalDispatchDate(job, 'auditDate');
  dispatchString(job, 'siteName');
  if (sourceApp === 'ecoaudit') {
    dispatchString(job, 'siteAddress');
    return;
  }
  if (sourceApp === 'solarsense') {
    dispatchString(job, 'location');
    dispatchString(job, 'buildingIdName');
    return;
  }
  dispatchString(job, 'clientName');
  dispatchString(job, 'siteAddress');
  optionalDispatchString(job, 'timezone');
}

async function createDispatchedProductJob(
  executor: ScheduleExecutor,
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
  actor: UnifiedSchedulerSubject,
  assignee: UnifiedSchedulerSubject,
  scheduledStartAt: Date,
): Promise<{ sourceId: string; sourceType: ScheduleSourceType; label: string }> {
  const now = new Date();
  const auditDate = optionalDispatchDate(job, 'auditDate')
    ?? scheduledStartAt.toISOString().slice(0, 10);
  const inspectorName = assignee.displayName?.trim() || assignee.email || 'Assigned inspector';

  if (sourceApp === 'ecoaudit') {
    const sourceId = randomUUID();
    const siteName = dispatchString(job, 'siteName');
    const siteAddress = dispatchString(job, 'siteAddress');
    await executor.insert(eaAudits).values({
      id: sourceId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      siteName,
      siteAddress,
      inspectorName,
      auditDate,
      status: 'Draft',
      createdByUserId: requireProductUserId(actor, 'ecoaudit'),
      assignedInspectorUserId: requireProductUserId(assignee, 'ecoaudit'),
      startedAt: null,
      completedAt: null,
      createdAt: now,
    });
    return { sourceId, sourceType: 'audit', label: siteName };
  }

  if (sourceApp === 'solarsense') {
    const siteId = randomUUID();
    const sourceId = randomUUID();
    const siteName = dispatchString(job, 'siteName');
    const location = dispatchString(job, 'location');
    const buildingIdName = dispatchString(job, 'buildingIdName');
    const ownerUserId = requireProductUserId(actor, 'solarsense');
    await executor.insert(ssSites).values({
      id: siteId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      siteName,
      location,
      dateOfAssessment: auditDate,
      createdByUserId: ownerUserId,
      createdAt: now,
      status: 'Draft',
      completedAt: null,
    });
    await executor.insert(ssRooftopAssessments).values({
      id: sourceId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      siteId,
      siteName,
      buildingIdName,
      createdByUserId: ownerUserId,
      assignedInspectorUserId: requireProductUserId(assignee, 'solarsense'),
      createdAt: now,
      status: 'Draft',
      completedAt: null,
    });
    return {
      sourceId,
      sourceType: 'assessment',
      label: `${siteName} · ${buildingIdName}`,
    };
  }

  const sourceId = randomUUID();
  const gridSupplyId = randomUUID();
  const clientName = dispatchString(job, 'clientName');
  const siteName = dispatchString(job, 'siteName');
  const siteAddress = dispatchString(job, 'siteAddress');
  await executor.insert(ihInstallations).values({
    id: sourceId,
    serverId: randomUUID(),
    syncStatus: 'synced',
    updatedAt: now,
    deletedAt: null,
    siteCode: deriveSiteCode(siteName),
    timezone: optionalDispatchString(job, 'timezone') ?? 'Australia/Sydney',
    treeSchemaVersion: 2,
    treeRevision: 1,
    recordVersionNumber: 0,
    clientName,
    siteName,
    siteAddress,
    inspectorName,
    auditDate,
    status: 'Draft',
    createdByUserId: actor.fieldUserId,
    assignedInspectorUserId: assignee.fieldUserId,
    completedAt: null,
    createdAt: now,
  });
  await executor.insert(ihGridSupplies).values({
    id: gridSupplyId,
    serverId: randomUUID(),
    syncStatus: 'synced',
    updatedAt: now,
    deletedAt: null,
    installationId: sourceId,
    name: 'Incoming grid connection',
    isDefault: true,
    createdAt: now,
  });
  return {
    sourceId,
    sourceType: 'installation',
    label: `${clientName} · ${siteName}`,
  };
}

export async function createSchedulerDispatch(
  user: AuthUser,
  input: CreateSchedulerDispatchInput,
): Promise<ScheduleEventDto> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) throw forbidden('Only admins can create scheduler dispatches');
  if (input.status !== undefined) throw badRequest('New scheduler dispatches are always planned');
  const sourceApp = parseSourceApp(input.sourceApp);
  assertSchedulerSourceAppVisible(sourceApp);
  if (sourceApp === 'custom') throw badRequest('Create custom work with the standard scheduler event endpoint');
  if (typeof input.assigneeFieldUserId !== 'string' || !input.assigneeFieldUserId.trim()) {
    throw badRequest('assigneeFieldUserId is required');
  }
  const start = requireIsoDate(input.scheduledStartAt, 'scheduledStartAt');
  const deadline = requireIsoDate(input.deadlineAt, 'deadlineAt');
  rejectClientScheduledEndAt(input.scheduledEndAt);
  const estimatedDurationMinutes = parseEstimatedDurationMinutes(
    input.estimatedDurationMinutes,
  );
  const end = deriveScheduledEndAt(start, estimatedDurationMinutes);
  const job = parseDispatchJob(input.job, sourceApp);
  validateDispatchJob(sourceApp, job);

  const created = await db.transaction(async (tx) => {
    const [actor, assignee] = await Promise.all([
      loadActorSubject(tx, user),
      loadSchedulerSubject(tx, input.assigneeFieldUserId.trim()),
    ]);
    const product = await createDispatchedProductJob(
      tx,
      sourceApp,
      job,
      actor,
      assignee,
      start,
    );
    const now = new Date();
    const title = (input.title?.trim() || product.label).slice(0, 300);
    const [event] = await tx.insert(portalScheduleEvents).values({
      id: randomUUID(),
      title,
      description: input.description?.trim() || null,
      sourceApp,
      sourceType: product.sourceType,
      sourceId: product.sourceId,
      assigneeFieldUserId: assignee.fieldUserId,
      assigneeDisplayName: assignee.displayName,
      assigneeEmail: assignee.email,
      scheduledStartAt: start,
      estimatedDurationMinutes,
      scheduledEndAt: end,
      deadlineAt: deadline,
      status: 'planned',
      createdByUserId: user.userId,
      createdByApp: user.app,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await enqueueImmediateSchedulerNotification(
      tx,
      event,
      assignee.globalUserId,
      'assigned',
      now,
    );
    await enqueueAutomatedSchedulerNotifications(
      tx,
      event,
      assignee.globalUserId,
      now,
    );
    return event;
  });
  return rowToDto(created);
}

export type UpdateScheduleEventInput = {
  title?: string;
  description?: string | null;
  assigneeFieldUserId?: string;
  scheduledStartAt?: unknown;
  estimatedDurationMinutes?: unknown;
  /** @deprecated Client-provided end times are rejected. */
  scheduledEndAt?: unknown | null;
  deadlineAt?: unknown;
  status?: unknown;
};

type ScheduleBusinessFields = Pick<ScheduleEventDto,
  | 'title'
  | 'description'
  | 'assigneeFieldUserId'
  | 'scheduledStartAt'
  | 'estimatedDurationMinutes'
  | 'scheduledEndAt'
  | 'deadlineAt'
  | 'status'
>;

/** updatedAt-only/no-op PATCHes must never produce a push notification. */
export function scheduleBusinessFieldsChanged(
  before: ScheduleBusinessFields,
  after: ScheduleBusinessFields,
): boolean {
  return before.title !== after.title
    || before.description !== after.description
    || before.assigneeFieldUserId !== after.assigneeFieldUserId
    || before.scheduledStartAt !== after.scheduledStartAt
    || before.estimatedDurationMinutes !== after.estimatedDurationMinutes
    || before.scheduledEndAt !== after.scheduledEndAt
    || before.deadlineAt !== after.deadlineAt
    || before.status !== after.status;
}

export async function updateScheduleEvent(
  user: AuthUser,
  id: string,
  input: UpdateScheduleEventInput,
): Promise<ScheduleEventDto> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can update schedule events');
  }
  rejectClientScheduledEndAt(input.scheduledEndAt);
  const estimatedDurationWasProvided = input.estimatedDurationMinutes !== undefined;
  const requestedEstimatedDurationMinutes = estimatedDurationWasProvided
    ? parseEstimatedDurationMinutes(input.estimatedDurationMinutes)
    : undefined;

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, id))
      .for('update')
      .limit(1);
    if (!existing) throw notFound('Schedule event');
    assertSchedulerSourceAppVisible(existing.sourceApp);

    const existingGlobalUserId = isMobileScheduleNotificationTarget(existing)
      ? await resolveSchedulerGlobalUserId(tx, existing.assigneeFieldUserId)
      : null;
    const previousTargetWasAligned = existingGlobalUserId
      ? await isSchedulerNotificationEligible(
          tx,
          existing,
          existingGlobalUserId,
          'changed',
        )
      : false;

    const patch: Partial<typeof portalScheduleEvents.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw badRequest('title cannot be empty');
      patch.title = title.slice(0, 300);
    }
    if (input.description !== undefined) {
      patch.description = input.description?.trim() || null;
    }

    const assigneeChanged = input.assigneeFieldUserId !== undefined
      && input.assigneeFieldUserId.trim() !== existing.assigneeFieldUserId;
    let assignee: UnifiedSchedulerSubject | null = null;
    if (assigneeChanged) {
      assignee = await loadSchedulerSubject(tx, input.assigneeFieldUserId!.trim());
      patch.assigneeFieldUserId = assignee.fieldUserId;
      patch.assigneeDisplayName = assignee.displayName;
      patch.assigneeEmail = assignee.email;
    }
    let scheduledStartChanged = false;
    if (input.scheduledStartAt !== undefined) {
      const requestedStart = requireIsoDate(input.scheduledStartAt, 'scheduledStartAt');
      scheduledStartChanged = requestedStart.getTime() !== existing.scheduledStartAt.getTime();
      if (scheduledStartChanged) patch.scheduledStartAt = requestedStart;
    }
    if (input.deadlineAt !== undefined) {
      patch.deadlineAt = requireIsoDate(input.deadlineAt, 'deadlineAt');
    }
    const nextStatus = input.status !== undefined ? parseStatus(input.status) : existing.status as ScheduleStatus;
    if (
      existing.status !== 'cancelled'
      && nextStatus === 'cancelled'
      && assigneeChanged
    ) {
      throw badRequest('Reassign and cancel must be separate scheduler updates');
    }
    if (nextStatus === 'done' && assigneeChanged) {
      throw badRequest('Reassign and mark done must be separate scheduler updates');
    }
    if (input.status !== undefined) {
      patch.status = nextStatus;
      patch.cancelledAt = nextStatus === 'cancelled' ? new Date() : null;
    }

    if (estimatedDurationWasProvided || scheduledStartChanged) {
      const start = (patch.scheduledStartAt as Date | undefined) ?? existing.scheduledStartAt;
      const estimatedDurationMinutes = estimatedDurationWasProvided
        ? requestedEstimatedDurationMinutes!
        : existing.estimatedDurationMinutes;
      patch.estimatedDurationMinutes = estimatedDurationMinutes;
      patch.scheduledEndAt = deriveScheduledEndAt(start, estimatedDurationMinutes);
    }

    const nextStatusIsActive = nextStatus === 'planned' || nextStatus === 'in_progress';
    const explicitAssignee = input.assigneeFieldUserId !== undefined;
    let productAssignmentRepaired = false;
    if (
      nextStatusIsActive
      && isMobileScheduleNotificationTarget(existing)
      && (explicitAssignee || existing.status === 'cancelled')
    ) {
      await assertSourceExists(
        tx,
        existing.sourceApp as ScheduleSourceApp,
        existing.sourceType as ScheduleSourceType,
        existing.sourceId,
      );
      const subject = assignee
        ?? await loadSchedulerSubject(tx, existing.assigneeFieldUserId);
      // Lock the linked product before checking for another active event. This
      // serializes two cancelled events being reopened at the same time.
      productAssignmentRepaired = await alignLinkedSourceAssignment(
        tx,
        existing.sourceApp as ScheduleSourceApp,
        existing.sourceType as ScheduleSourceType,
        existing.sourceId,
        subject,
      );
      assignee = subject;
    }
    if (nextStatusIsActive && existing.status === 'cancelled') {
      await assertNoActiveLinkedEvent(
        tx,
        existing.sourceApp as ScheduleSourceApp,
        existing.sourceType as ScheduleSourceType,
        existing.sourceId,
      );
    }

    const [row] = await tx
      .update(portalScheduleEvents)
      .set(patch)
      .where(eq(portalScheduleEvents.id, id))
      .returning();
    if (!row) throw notFound('Schedule event');
    if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
      await reconcileAssignmentAfterCancellation(tx, row);
    }

    if (isMobileScheduleNotificationTarget(row)) {
      const beforeDto = rowToDto(existing);
      const afterDto = rowToDto(row);
      const meaningfulChange = scheduleBusinessFieldsChanged(beforeDto, afterDto);
      const currentGlobalUserId = assignee?.globalUserId ?? existingGlobalUserId;

      if (row.status === 'cancelled') {
        if (existing.status !== 'cancelled') {
          await cancelPendingSchedulerNotifications(tx, row.id, {}, new Date());
        }
        if (
          existing.status !== 'cancelled'
          && existingGlobalUserId
          && previousTargetWasAligned
        ) {
          await enqueueImmediateSchedulerNotification(
            tx,
            row,
            existingGlobalUserId,
            'cancelled',
          );
        }
      } else if (row.status === 'done') {
        if (existing.status !== 'done') {
          await cancelPendingSchedulerNotifications(tx, row.id, {}, new Date());
        }
      } else if (assigneeChanged && assignee) {
        if (existingGlobalUserId) {
          await cancelPendingSchedulerNotifications(
            tx,
            row.id,
            { globalUserId: existingGlobalUserId },
          );
          if (previousTargetWasAligned) {
            await enqueueImmediateSchedulerNotification(
              tx,
              row,
              existingGlobalUserId,
              'assignment_removed',
            );
          }
        }
        await enqueueImmediateSchedulerNotification(
          tx,
          row,
          assignee.globalUserId,
          'assigned',
        );
        await enqueueAutomatedSchedulerNotifications(
          tx,
          row,
          assignee.globalUserId,
        );
      } else if (existing.status === 'cancelled' && currentGlobalUserId) {
        await cancelPendingSchedulerNotifications(tx, row.id, {}, new Date());
        await enqueueImmediateSchedulerNotification(
          tx,
          row,
          currentGlobalUserId,
          'assigned',
        );
        await enqueueAutomatedSchedulerNotifications(
          tx,
          row,
          currentGlobalUserId,
        );
      } else if (productAssignmentRepaired && currentGlobalUserId) {
        // An explicit same-assignee save can repair a pre-notification legacy
        // row. Replace any stale jobs with the same assignment + future
        // reminder set the event would receive if it were created today.
        await cancelPendingSchedulerNotifications(tx, row.id, {}, new Date());
        await enqueueImmediateSchedulerNotification(
          tx,
          row,
          currentGlobalUserId,
          'assigned',
        );
        await enqueueAutomatedSchedulerNotifications(
          tx,
          row,
          currentGlobalUserId,
        );
      } else if (meaningfulChange && currentGlobalUserId) {
        await cancelPendingSchedulerNotifications(
          tx,
          row.id,
          { automatedOnly: true },
        );
        await enqueueImmediateSchedulerNotification(
          tx,
          row,
          currentGlobalUserId,
          'changed',
        );
        await enqueueAutomatedSchedulerNotifications(
          tx,
          row,
          currentGlobalUserId,
        );
      }
    }
    return row;
  });

  return rowToDto(updated);
}

export async function cancelScheduleEvent(user: AuthUser, id: string): Promise<ScheduleEventDto> {
  return updateScheduleEvent(user, id, { status: 'cancelled' });
}

export async function getScheduleSummary(user: AuthUser): Promise<ScheduleSummary> {
  assertPortalSchedulerApp(user);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + 7);

  const events = await listScheduleEvents(user, { includeCancelled: false });

  const byApp: Partial<Record<ScheduleSourceApp, number>> = Object.fromEntries(
    schedulerVisibleSourceApps().map((sourceApp) => [sourceApp, 0]),
  );

  let today = 0;
  let thisWeek = 0;
  let overdue = 0;
  let planned = 0;
  let inProgress = 0;

  for (const event of events) {
    byApp[event.sourceApp] = (byApp[event.sourceApp] ?? 0) + 1;
    const start = new Date(event.scheduledStartAt).getTime();
    if (start >= startOfToday.getTime() && start < endOfToday.getTime()) today += 1;
    if (start >= startOfToday.getTime() && start < endOfWeek.getTime()) thisWeek += 1;
    if (
      event.status !== 'done'
      && new Date(event.deadlineAt).getTime() < now.getTime()
    ) {
      overdue += 1;
    }
    if (event.status === 'planned') planned += 1;
    if (event.status === 'in_progress') inProgress += 1;
  }

  return { today, thisWeek, overdue, planned, inProgress, byApp };
}

export async function searchJobOptions(
  user: AuthUser,
  query: string,
  appFilter?: ScheduleSourceApp,
): Promise<JobOption[]> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can search linkable jobs');
  }

  const q = query.trim();
  const pattern = q ? `%${q.replace(/%/g, '')}%` : '%';
  const results: JobOption[] = [];
  const visibleApps = schedulerVisibleFinanceSourceApps();
  const apps = appFilter && appFilter !== 'custom'
    ? visibleApps.includes(appFilter)
      ? [appFilter]
      : []
    : visibleApps;

  if (apps.includes('ecoaudit')) {
    const rows = await db
      .select({
        id: eaAudits.id,
        siteName: eaAudits.siteName,
        siteAddress: eaAudits.siteAddress,
        status: eaAudits.status,
      })
      .from(eaAudits)
      .where(and(
        isNull(eaAudits.deletedAt),
        eq(eaAudits.status, 'Draft'),
        or(
          ilike(eaAudits.siteName, pattern),
          ilike(eaAudits.siteAddress, pattern),
          ilike(eaAudits.id, pattern),
        ),
      ))
      .orderBy(desc(eaAudits.createdAt))
      .limit(25);
    for (const row of rows) {
      results.push({
        id: row.id,
        label: row.siteName,
        subtitle: `${row.status} · ${row.siteAddress}`,
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
      });
    }
  }

  if (apps.includes('solarsense')) {
    const assessments = await db
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .innerJoin(ssSites, and(
        eq(ssSites.id, ssRooftopAssessments.siteId),
        eq(ssSites.status, 'Draft'),
        isNull(ssSites.deletedAt),
      ))
      .where(and(
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
        or(
          ilike(ssRooftopAssessments.siteName, pattern),
          ilike(ssRooftopAssessments.buildingIdName, pattern),
          ilike(ssRooftopAssessments.id, pattern),
        ),
      ))
      .orderBy(desc(ssRooftopAssessments.createdAt))
      .limit(15);
    for (const row of assessments) {
      results.push({
        id: row.id,
        label: `${row.siteName} · ${row.building}`,
        subtitle: 'Assessment',
        sourceApp: 'solarsense',
        sourceType: 'assessment',
      });
    }
  }

  if (apps.includes('installhub')) {
    const rows = await db
      .select({
        id: ihInstallations.id,
        siteName: ihInstallations.siteName,
        clientName: ihInstallations.clientName,
        status: ihInstallations.status,
      })
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.status, 'Draft'),
        isNull(ihInstallations.deletedAt),
        or(
          ilike(ihInstallations.siteName, pattern),
          ilike(ihInstallations.clientName, pattern),
          ilike(ihInstallations.id, pattern),
        ),
      ))
      .orderBy(desc(ihInstallations.createdAt))
      .limit(25);
    for (const row of rows) {
      results.push({
        id: row.id,
        label: `${row.clientName} · ${row.siteName}`,
        subtitle: `Installation · ${row.status}`,
        sourceApp: 'installhub',
        sourceType: 'installation',
      });
    }
  }

  return results.slice(0, 40);
}

async function activeScheduledSourceKeys(
  sourceApps: ReadonlyArray<Exclude<ScheduleSourceApp, 'custom'>>,
): Promise<Set<string>> {
  const rows = await db
    .select({
      sourceApp: portalScheduleEvents.sourceApp,
      sourceType: portalScheduleEvents.sourceType,
      sourceId: portalScheduleEvents.sourceId,
    })
    .from(portalScheduleEvents)
    .where(and(
      ne(portalScheduleEvents.status, 'cancelled'),
    ));
  const out = new Set<string>();
  for (const row of rows) {
    if (!row.sourceId) continue;
    if (!sourceApps.includes(row.sourceApp as Exclude<ScheduleSourceApp, 'custom'>)) continue;
    out.add(`${row.sourceApp}:${row.sourceType}:${row.sourceId}`);
  }
  return out;
}

function scheduleKey(
  sourceApp: string,
  sourceType: string,
  sourceId: string,
): string {
  return `${sourceApp}:${sourceType}:${sourceId}`;
}

/**
 * Product jobs (audits / sites / assessments / installations) that are not
 * already linked to an active schedule event.
 */
export async function listUnscheduledJobs(
  user: AuthUser,
  opts: {
    q?: string;
    sourceApp?: ScheduleSourceApp;
    limit?: number;
  } = {},
): Promise<JobOption[]> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can list unscheduled jobs');
  }

  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100);
  const q = (opts.q ?? '').trim();
  const pattern = q ? `%${q.replace(/%/g, '')}%` : '%';
  const visibleApps = schedulerVisibleFinanceSourceApps();
  const apps = opts.sourceApp && opts.sourceApp !== 'custom'
    ? visibleApps.includes(opts.sourceApp as Exclude<ScheduleSourceApp, 'custom'>)
      ? [opts.sourceApp as Exclude<ScheduleSourceApp, 'custom'>]
      : []
    : visibleApps;

  const scheduled = await activeScheduledSourceKeys(apps);
  const results: JobOption[] = [];

  if (apps.includes('ecoaudit')) {
    const scheduledIds = [...scheduled]
      .filter((k) => k.startsWith('ecoaudit:audit:'))
      .map((k) => k.slice('ecoaudit:audit:'.length));
    const rows = await db
      .select({
        id: eaAudits.id,
        siteName: eaAudits.siteName,
        siteAddress: eaAudits.siteAddress,
        status: eaAudits.status,
      })
      .from(eaAudits)
      .where(and(
        isNull(eaAudits.deletedAt),
        eq(eaAudits.status, 'Draft'),
        or(
          ilike(eaAudits.siteName, pattern),
          ilike(eaAudits.siteAddress, pattern),
          ilike(eaAudits.id, pattern),
        ),
        scheduledIds.length > 0 ? notInArray(eaAudits.id, scheduledIds) : undefined,
      ))
      .orderBy(desc(eaAudits.createdAt))
      .limit(40);
    for (const row of rows) {
      if (scheduled.has(scheduleKey('ecoaudit', 'audit', row.id))) continue;
      results.push({
        id: row.id,
        label: row.siteName,
        subtitle: `${row.status} · ${row.siteAddress}`,
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
      });
    }
  }

  if (apps.includes('solarsense')) {
    const assessments = await db
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .innerJoin(ssSites, and(
        eq(ssSites.id, ssRooftopAssessments.siteId),
        eq(ssSites.status, 'Draft'),
        isNull(ssSites.deletedAt),
      ))
      .where(and(
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
        or(
          ilike(ssRooftopAssessments.siteName, pattern),
          ilike(ssRooftopAssessments.buildingIdName, pattern),
          ilike(ssRooftopAssessments.id, pattern),
        ),
      ))
      .orderBy(desc(ssRooftopAssessments.createdAt))
      .limit(40);
    for (const row of assessments) {
      if (scheduled.has(scheduleKey('solarsense', 'assessment', row.id))) continue;
      results.push({
        id: row.id,
        label: `${row.siteName} · ${row.building}`,
        subtitle: 'Assessment',
        sourceApp: 'solarsense',
        sourceType: 'assessment',
      });
    }
  }

  if (apps.includes('installhub')) {
    const scheduledIds = [...scheduled]
      .filter((k) => k.startsWith('installhub:installation:'))
      .map((k) => k.slice('installhub:installation:'.length));
    const rows = await db
      .select({
        id: ihInstallations.id,
        siteName: ihInstallations.siteName,
        clientName: ihInstallations.clientName,
        status: ihInstallations.status,
      })
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.status, 'Draft'),
        isNull(ihInstallations.deletedAt),
        or(
          ilike(ihInstallations.siteName, pattern),
          ilike(ihInstallations.clientName, pattern),
          ilike(ihInstallations.id, pattern),
        ),
        scheduledIds.length > 0 ? notInArray(ihInstallations.id, scheduledIds) : undefined,
      ))
      .orderBy(desc(ihInstallations.createdAt))
      .limit(40);
    for (const row of rows) {
      if (scheduled.has(scheduleKey('installhub', 'installation', row.id))) continue;
      results.push({
        id: row.id,
        label: `${row.clientName} · ${row.siteName}`,
        subtitle: `Installation · ${row.status}`,
        sourceApp: 'installhub',
        sourceType: 'installation',
      });
    }
  }

  return results.slice(0, limit);
}

/** Pure helper for unit tests: sort deadlines urgent-first (overdue before future). */
export function sortByDeadlineUrgency<T extends { deadlineAt: string; status: string }>(
  items: T[],
  now = new Date(),
): T[] {
  const nowMs = now.getTime();
  return [...items].sort((a, b) => {
    const aDone = a.status === 'done' || a.status === 'cancelled' ? 1 : 0;
    const bDone = b.status === 'done' || b.status === 'cancelled' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aRemaining = new Date(a.deadlineAt).getTime() - nowMs;
    const bRemaining = new Date(b.deadlineAt).getTime() - nowMs;
    return aRemaining - bRemaining;
  });
}
