import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihInstallations } from '../db/schema/installhub.js';
import { portalScheduleEvents, unifiedUsers } from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import type { AuthUser } from '../auth/middleware.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';

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
  byApp: Record<ScheduleSourceApp, number>;
};

export type JobOption = {
  id: string;
  label: string;
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  sourceType: Exclude<ScheduleSourceType, 'custom'>;
  subtitle?: string | null;
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
    scheduledEndAt: toIso(row.scheduledEndAt),
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

async function loadAssigneeSnapshot(fieldUserId: string): Promise<{
  fieldUserId: string;
  displayName: string | null;
  email: string | null;
}> {
  const [row] = await db
    .select({
      fieldUserId: unifiedUsers.fieldUserId,
      fullName: unifiedUsers.fullName,
      email: unifiedUsers.email,
      isActive: unifiedUsers.isActive,
      deletedAt: unifiedUsers.deletedAt,
    })
    .from(unifiedUsers)
    .where(eq(unifiedUsers.fieldUserId, fieldUserId))
    .limit(1);

  if (!row || row.deletedAt || !row.isActive) {
    throw badRequest('Assignee must be an active unified portal user');
  }

  return {
    fieldUserId: row.fieldUserId,
    displayName: row.fullName,
    email: row.email,
  };
}

async function assertSourceExists(
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
    const [row] = await db
      .select({ id: eaAudits.id, siteName: eaAudits.siteName })
      .from(eaAudits)
      .where(eq(eaAudits.id, id))
      .limit(1);
    if (!row) throw notFound('Audit');
    return row.siteName;
  }

  if (sourceApp === 'solarsense' && sourceType === 'site') {
    const [row] = await db
      .select({ id: ssSites.id, siteName: ssSites.siteName })
      .from(ssSites)
      .where(eq(ssSites.id, id))
      .limit(1);
    if (!row) throw notFound('Site');
    return row.siteName;
  }

  if (sourceApp === 'solarsense' && sourceType === 'assessment') {
    const [row] = await db
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, id))
      .limit(1);
    if (!row) throw notFound('Assessment');
    return `${row.siteName} · ${row.building}`;
  }

  if (sourceApp === 'installhub' && sourceType === 'installation') {
    const [row] = await db
      .select({
        id: ihInstallations.id,
        siteName: ihInstallations.siteName,
        clientName: ihInstallations.clientName,
      })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, id))
      .limit(1);
    if (!row) throw notFound('Installation');
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
  if (sourceApp === 'solarsense' && sourceType !== 'site' && sourceType !== 'assessment') {
    throw badRequest('solarsense events must use sourceType site or assessment');
  }
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
  const sourceType = parseSourceType(input.sourceType);
  validateAppTypePair(sourceApp, sourceType);

  const sourceId = input.sourceId?.trim() || null;
  const labelFromSource = await assertSourceExists(sourceApp, sourceType, sourceId);

  const title = (input.title?.trim() || labelFromSource || 'Scheduled work').slice(0, 300);
  if (!title) throw badRequest('title is required');

  const start = requireIsoDate(input.scheduledStartAt, 'scheduledStartAt');
  const deadline = requireIsoDate(input.deadlineAt, 'deadlineAt');
  let end: Date | null = null;
  if (input.scheduledEndAt !== undefined && input.scheduledEndAt !== null && input.scheduledEndAt !== '') {
    end = requireIsoDate(input.scheduledEndAt, 'scheduledEndAt');
    if (end < start) throw badRequest('scheduledEndAt must be on or after scheduledStartAt');
  }

  if (typeof input.assigneeFieldUserId !== 'string' || !input.assigneeFieldUserId.trim()) {
    throw badRequest('assigneeFieldUserId is required');
  }
  const assignee = await loadAssigneeSnapshot(input.assigneeFieldUserId.trim());
  const status = input.status !== undefined ? parseStatus(input.status) : 'planned';
  if (status === 'cancelled') throw badRequest('Create with planned status; cancel via PATCH/DELETE');

  const now = new Date();
  const id = randomUUID();
  await db.insert(portalScheduleEvents).values({
    id,
    title,
    description: input.description?.trim() || null,
    sourceApp,
    sourceType,
    sourceId: sourceApp === 'custom' ? null : sourceId,
    assigneeFieldUserId: assignee.fieldUserId,
    assigneeDisplayName: assignee.displayName,
    assigneeEmail: assignee.email,
    scheduledStartAt: start,
    scheduledEndAt: end,
    deadlineAt: deadline,
    status,
    createdByUserId: user.userId,
    createdByApp: user.app,
    createdAt: now,
    updatedAt: now,
  });

  return getScheduleEvent(user, id);
}

export type UpdateScheduleEventInput = {
  title?: string;
  description?: string | null;
  assigneeFieldUserId?: string;
  scheduledStartAt?: unknown;
  scheduledEndAt?: unknown | null;
  deadlineAt?: unknown;
  status?: unknown;
};

export async function updateScheduleEvent(
  user: AuthUser,
  id: string,
  input: UpdateScheduleEventInput,
): Promise<ScheduleEventDto> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can update schedule events');
  }

  const [existing] = await db
    .select()
    .from(portalScheduleEvents)
    .where(eq(portalScheduleEvents.id, id))
    .limit(1);
  if (!existing) throw notFound('Schedule event');

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
  if (input.assigneeFieldUserId !== undefined) {
    const assignee = await loadAssigneeSnapshot(input.assigneeFieldUserId.trim());
    patch.assigneeFieldUserId = assignee.fieldUserId;
    patch.assigneeDisplayName = assignee.displayName;
    patch.assigneeEmail = assignee.email;
  }
  if (input.scheduledStartAt !== undefined) {
    patch.scheduledStartAt = requireIsoDate(input.scheduledStartAt, 'scheduledStartAt');
  }
  if (input.scheduledEndAt !== undefined) {
    if (input.scheduledEndAt === null || input.scheduledEndAt === '') {
      patch.scheduledEndAt = null;
    } else {
      patch.scheduledEndAt = requireIsoDate(input.scheduledEndAt, 'scheduledEndAt');
    }
  }
  if (input.deadlineAt !== undefined) {
    patch.deadlineAt = requireIsoDate(input.deadlineAt, 'deadlineAt');
  }
  if (input.status !== undefined) {
    const status = parseStatus(input.status);
    patch.status = status;
    patch.cancelledAt = status === 'cancelled' ? new Date() : null;
  }

  const start = (patch.scheduledStartAt as Date | undefined) ?? existing.scheduledStartAt;
  const end = patch.scheduledEndAt !== undefined
    ? (patch.scheduledEndAt as Date | null)
    : existing.scheduledEndAt;
  if (end && end < start) {
    throw badRequest('scheduledEndAt must be on or after scheduledStartAt');
  }

  await db
    .update(portalScheduleEvents)
    .set(patch)
    .where(eq(portalScheduleEvents.id, id));

  return getScheduleEvent(user, id);
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

  const byApp: Record<ScheduleSourceApp, number> = {
    ecoaudit: 0,
    solarsense: 0,
    installhub: 0,
    custom: 0,
  };

  let today = 0;
  let thisWeek = 0;
  let overdue = 0;
  let planned = 0;
  let inProgress = 0;

  for (const event of events) {
    byApp[event.sourceApp] += 1;
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
  const apps = appFilter && appFilter !== 'custom'
    ? [appFilter]
    : (['ecoaudit', 'solarsense', 'installhub'] as const);

  if (apps.includes('ecoaudit')) {
    const rows = await db
      .select({
        id: eaAudits.id,
        siteName: eaAudits.siteName,
        siteAddress: eaAudits.siteAddress,
        status: eaAudits.status,
      })
      .from(eaAudits)
      .where(or(
        ilike(eaAudits.siteName, pattern),
        ilike(eaAudits.siteAddress, pattern),
        ilike(eaAudits.id, pattern),
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
    const sites = await db
      .select({
        id: ssSites.id,
        siteName: ssSites.siteName,
        location: ssSites.location,
        status: ssSites.status,
      })
      .from(ssSites)
      .where(or(
        ilike(ssSites.siteName, pattern),
        ilike(ssSites.location, pattern),
        ilike(ssSites.id, pattern),
      ))
      .orderBy(desc(ssSites.createdAt))
      .limit(15);
    for (const row of sites) {
      results.push({
        id: row.id,
        label: row.siteName,
        subtitle: `Site · ${row.status}${row.location ? ` · ${row.location}` : ''}`,
        sourceApp: 'solarsense',
        sourceType: 'site',
      });
    }

    const assessments = await db
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .where(or(
        ilike(ssRooftopAssessments.siteName, pattern),
        ilike(ssRooftopAssessments.buildingIdName, pattern),
        ilike(ssRooftopAssessments.id, pattern),
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
      .where(or(
        ilike(ihInstallations.siteName, pattern),
        ilike(ihInstallations.clientName, pattern),
        ilike(ihInstallations.id, pattern),
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
  const apps = opts.sourceApp && opts.sourceApp !== 'custom'
    ? [opts.sourceApp as Exclude<ScheduleSourceApp, 'custom'>]
    : (['ecoaudit', 'solarsense', 'installhub'] as const);

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
    const sites = await db
      .select({
        id: ssSites.id,
        siteName: ssSites.siteName,
        location: ssSites.location,
        status: ssSites.status,
      })
      .from(ssSites)
      .where(or(
        ilike(ssSites.siteName, pattern),
        ilike(ssSites.location, pattern),
        ilike(ssSites.id, pattern),
      ))
      .orderBy(desc(ssSites.createdAt))
      .limit(40);
    for (const row of sites) {
      if (scheduled.has(scheduleKey('solarsense', 'site', row.id))) continue;
      results.push({
        id: row.id,
        label: row.siteName,
        subtitle: `Site · ${row.status}${row.location ? ` · ${row.location}` : ''}`,
        sourceApp: 'solarsense',
        sourceType: 'site',
      });
    }

    const assessments = await db
      .select({
        id: ssRooftopAssessments.id,
        siteName: ssRooftopAssessments.siteName,
        building: ssRooftopAssessments.buildingIdName,
      })
      .from(ssRooftopAssessments)
      .where(or(
        ilike(ssRooftopAssessments.siteName, pattern),
        ilike(ssRooftopAssessments.buildingIdName, pattern),
        ilike(ssRooftopAssessments.id, pattern),
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
