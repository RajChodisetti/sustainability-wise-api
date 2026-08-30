import { randomInt, randomUUID } from 'node:crypto';
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
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihGridSupplies, ihInstallations } from '../db/schema/installhub.js';
import {
  businessClients,
  businessJobs,
  businessSites,
  ecoauditJobDetails,
  fieldAppJobDetails,
  globalUsers,
  portalScheduleEvents,
  solarsenseJobDetails,
  unifiedUsers,
} from '../db/schema/shared.js';
import { ssRooftopAssessments, ssSites } from '../db/schema/solarsense.js';
import type { AuthUser } from '../auth/middleware.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import {
  GRID_SUPPLY_NMI_MAX_LENGTH,
  INSTALLATION_METADATA_TEXT_LIMITS,
  deriveSiteCode,
} from '../routes/installhub/canonical.js';
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
import {
  instantDateInTimeZone,
  isValidIanaTimeZone,
  lockAndAssertAssigneeAvailable,
} from './schedulerLeaveService.js';
import { parseSchedulerDispatchAddress } from './schedulerAddressService.js';
import { resolveCompletionTiming } from '../routes/ecoaudit/auditTiming.js';
import { completeLinkedSchedulerEvents } from './schedulerCompletionService.js';
import { completeInstallHubInstallation } from './installHubCompletionService.js';
import type { SchedulerFinanceExecutor } from './schedulerFinanceService.js';
import {
  BUSINESS_COMPANY_KEY,
  upsertClientSiteFromProductRecord,
} from './clientSiteMemoryService.js';
import { copyFieldInstallationForJob } from './productJobCopyService.js';

export type ScheduleSourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type ScheduleSourceType = 'audit' | 'site' | 'assessment' | 'installation' | 'custom';
export type ScheduleStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export type ScheduleEventDto = {
  id: string;
  jobId: string | null;
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
  assigneeFieldUserId?: string | null;
  assigneeDisplayName?: string | null;
  scheduledEventId?: string | null;
  scheduledStartAt?: string | null;
};

export type SchedulerSiteOption = {
  id: string;
  clientId: string;
  clientName: string;
  clientContactName: string | null;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  siteName: string;
  address: string;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string;
  geocodeProvider: string | null;
  geocodePlaceId: string | null;
  addressSource: string;
  addressFingerprint: string;
  geocodedAt: Date | null;
  timezone: string;
  siteContactName: string | null;
  siteContactPhone: string | null;
  siteContactEmail: string | null;
  accessInformation: string | null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestWorkType: null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestMeteringSolutionType: null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestCustomJobNumber: null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestJobComments: null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestMaas: null;
  /** @deprecated Existing-site selection no longer exposes or copies prior job data. */
  latestElectricityNmi: null;
  /** @deprecated Retained as null for rolling portal compatibility. */
  latestJobId: null;
  /** @deprecated Retained as null for rolling portal compatibility. */
  latestSourceId: null;
  /** @deprecated Retained as null so older portals do not render v1/v2. */
  latestRevisionNumber: null;
};

type SchedulerSiteLegacyJobFields = Pick<
  SchedulerSiteOption,
  | 'latestWorkType'
  | 'latestMeteringSolutionType'
  | 'latestCustomJobNumber'
  | 'latestJobComments'
  | 'latestMaas'
  | 'latestElectricityNmi'
  | 'latestJobId'
  | 'latestSourceId'
  | 'latestRevisionNumber'
>;

export function schedulerSitePrefillOption<T extends object>(
  site: T,
): T & SchedulerSiteLegacyJobFields {
  return {
    ...site,
    latestWorkType: null,
    latestMeteringSolutionType: null,
    latestCustomJobNumber: null,
    latestJobComments: null,
    latestMaas: null,
    latestElectricityNmi: null,
    latestJobId: null,
    latestSourceId: null,
    latestRevisionNumber: null,
  };
}

type ScheduleExecutor = Pick<typeof db, 'execute' | 'select' | 'insert' | 'update'>;

type UnifiedSchedulerSubject = {
  globalUserId: string;
  fieldUserId: string;
  displayName: string | null;
  email: string | null;
  appUserIds: Partial<Record<Exclude<ScheduleSourceApp, 'custom'>, string>>;
};

const PORTAL_APPS = new Set(['ecoaudit', 'solarsense', 'installhub']);
const DEFAULT_INSTALLHUB_TIMEZONE = 'Australia/Sydney';

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

export function assertScheduleInterval(start: Date, end: Date | null): void {
  if (end && end.getTime() <= start.getTime()) {
    throw badRequest('scheduledEndAt must be after scheduledStartAt');
  }
}

/**
 * Legacy Field App clients display a date-only installation field. Scheduler
 * stores an absolute instant, so project that instant through the installation's
 * Australian IANA timezone instead of slicing its UTC representation.
 */
export function installHubSchedulerAuditDate(
  scheduledStartAt: Date,
  installationTimezone: string,
): string {
  const timezone = installationTimezone.trim();
  return instantDateInTimeZone(
    scheduledStartAt,
    isValidIanaTimeZone(timezone) ? timezone : DEFAULT_INSTALLHUB_TIMEZONE,
  );
}

function installHubSchedulerInspectorName(subject: UnifiedSchedulerSubject): string {
  return subject.displayName?.trim() || subject.email || 'Assigned inspector';
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
    jobId: row.jobId,
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
  scheduledStartAt?: Date,
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
      .select({
        assignedInspectorUserId: ihInstallations.assignedInspectorUserId,
        inspectorName: ihInstallations.inspectorName,
        auditDate: ihInstallations.auditDate,
        timezone: ihInstallations.timezone,
      })
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
    const inspectorName = installHubSchedulerInspectorName(subject);
    const auditDate = scheduledStartAt
      ? installHubSchedulerAuditDate(scheduledStartAt, current.timezone)
      : current.auditDate;
    const assignmentChanged = current.assignedInspectorUserId !== subject.fieldUserId;
    if (
      !assignmentChanged
      && current.inspectorName === inspectorName
      && current.auditDate === auditDate
    ) return false;
    const [updated] = await executor
      .update(ihInstallations)
      .set({
        assignedInspectorUserId: subject.fieldUserId,
        inspectorName,
        auditDate,
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
    // Notification repair is concerned only with assignment drift. A legacy
    // date/name projection repair must not turn a normal event edit into a new
    // assignment notification.
    return assignmentChanged;
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

/**
 * Scheduler/product transactions use product -> event as their row-lock order.
 * This lifecycle-neutral lock also covers completed/deleted source rows so an
 * event update cannot invert that order against a concurrent completion.
 */
async function lockLinkedSourceRow(
  executor: ScheduleExecutor,
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId || sourceApp === 'custom' || sourceType === 'custom') return;
  if (sourceApp === 'ecoaudit' && sourceType === 'audit') {
    await executor.select({ id: eaAudits.id }).from(eaAudits)
      .where(eq(eaAudits.id, sourceId)).for('update').limit(1);
    return;
  }
  if (sourceApp === 'solarsense' && sourceType === 'site') {
    await executor.select({ id: ssSites.id }).from(ssSites)
      .where(eq(ssSites.id, sourceId)).for('update').limit(1);
    return;
  }
  if (sourceApp === 'solarsense' && sourceType === 'assessment') {
    const [assessmentHint] = await executor
      .select({ siteId: ssRooftopAssessments.siteId })
      .from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, sourceId))
      .limit(1);
    if (!assessmentHint) return;
    if (!assessmentHint.siteId) {
      await executor.select({ id: ssRooftopAssessments.id }).from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, sourceId)).for('update').limit(1);
      return;
    }
    await executor.select({ id: ssSites.id }).from(ssSites)
      .where(eq(ssSites.id, assessmentHint.siteId)).for('update').limit(1);
    const [lockedAssessment] = await executor
      .select({ siteId: ssRooftopAssessments.siteId })
      .from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, sourceId))
      .for('update')
      .limit(1);
    if (lockedAssessment && lockedAssessment.siteId !== assessmentHint.siteId) {
      throw conflict('linked_assessment_site_changed');
    }
    return;
  }
  if (sourceApp === 'installhub' && sourceType === 'installation') {
    await executor.select({ id: ihInstallations.id }).from(ihInstallations)
      .where(eq(ihInstallations.id, sourceId)).for('update').limit(1);
  }
}

export type SchedulerJobCompletionInput = {
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  sourceType: Exclude<ScheduleSourceType, 'custom'>;
  sourceId: string;
  idempotencyKey: string;
};

function assertSchedulerCompletionSource(
  sourceApp: ScheduleSourceApp,
  sourceType: ScheduleSourceType,
  sourceId: string | null,
): asserts sourceApp is Exclude<ScheduleSourceApp, 'custom'> {
  if (!sourceId || sourceApp === 'custom' || sourceType === 'custom') {
    throw badRequest('Only linked product jobs can be marked complete');
  }
  const valid = (
    (sourceApp === 'ecoaudit' && sourceType === 'audit')
    || (sourceApp === 'solarsense' && (sourceType === 'assessment' || sourceType === 'site'))
    || (sourceApp === 'installhub' && sourceType === 'installation')
  );
  if (!valid) throw badRequest('Invalid linked scheduler source');
}

async function completeSchedulerLinkedSource(
  executor: SchedulerFinanceExecutor,
  input: SchedulerJobCompletionInput,
  actor: UnifiedSchedulerSubject,
): Promise<void> {
  const observedAt = new Date();
  if (input.sourceApp === 'ecoaudit' && input.sourceType === 'audit') {
    const [audit] = await executor.select().from(eaAudits).where(and(
      eq(eaAudits.id, input.sourceId),
      isNull(eaAudits.deletedAt),
    )).limit(1);
    if (!audit) throw notFound('Audit');
    if (audit.status !== 'Completed') {
      const timing = resolveCompletionTiming(audit, observedAt);
      await executor.update(eaAudits).set({
        status: 'Completed',
        startedAt: sql<Date>`coalesce(${eaAudits.startedAt}, ${sql.param(timing.startedAt, eaAudits.startedAt)})`,
        completedAt: sql<Date>`coalesce(${eaAudits.completedAt}, ${sql.param(timing.completedAt, eaAudits.completedAt)})`,
        updatedAt: observedAt,
        syncStatus: 'local',
      }).where(and(
        eq(eaAudits.id, input.sourceId),
        isNull(eaAudits.deletedAt),
      ));
    }
    await completeLinkedSchedulerEvents(executor, {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: input.sourceId,
    }, {
      observedAt,
      completionProvenance: audit.status === 'Completed'
        ? 'historical_replay'
        : 'direct_transition',
    });
    return;
  }

  if (input.sourceApp === 'solarsense' && input.sourceType === 'site') {
    const [site] = await executor.select().from(ssSites).where(and(
      eq(ssSites.id, input.sourceId),
      isNull(ssSites.deletedAt),
    )).limit(1);
    if (!site) throw notFound('Site');
    if (site.status !== 'Completed') {
      await executor.update(ssSites).set({
        status: 'Completed',
        completedAt: sql<Date>`coalesce(
          ${ssSites.completedAt},
          ${sql.param(observedAt, ssSites.completedAt)}
        )`,
        updatedAt: observedAt,
        syncStatus: 'local',
      }).where(and(eq(ssSites.id, input.sourceId), isNull(ssSites.deletedAt)));
    }
    await completeLinkedSchedulerEvents(executor, {
      sourceApp: 'solarsense',
      sourceType: 'site',
      sourceId: input.sourceId,
    }, { observedAt });
    return;
  }

  if (input.sourceApp === 'solarsense' && input.sourceType === 'assessment') {
    const [assessment] = await executor.select().from(ssRooftopAssessments).where(and(
      eq(ssRooftopAssessments.id, input.sourceId),
      isNull(ssRooftopAssessments.deletedAt),
    )).limit(1);
    if (!assessment) throw notFound('Assessment');
    if (!assessment.siteId) throw conflict('Assessment has no parent site');
    const [site] = await executor.select().from(ssSites).where(and(
      eq(ssSites.id, assessment.siteId),
      isNull(ssSites.deletedAt),
    )).limit(1);
    if (!site) throw notFound('Site');
    if (assessment.status !== 'Completed') {
      if (site.status !== 'Draft') throw conflict('Site is not Draft');
      const [completed] = await executor.update(ssRooftopAssessments).set({
        status: 'Completed',
        completedAt: sql<Date>`coalesce(
          ${ssRooftopAssessments.completedAt},
          ${sql.param(observedAt, ssRooftopAssessments.completedAt)}
        )`,
        updatedAt: observedAt,
        syncStatus: 'local',
      }).where(and(
        eq(ssRooftopAssessments.id, input.sourceId),
        eq(ssRooftopAssessments.status, 'Draft'),
        isNull(ssRooftopAssessments.deletedAt),
      )).returning({ id: ssRooftopAssessments.id });
      if (!completed) throw conflict('Assessment is not Draft');
    }
    await completeLinkedSchedulerEvents(executor, {
      sourceApp: 'solarsense',
      sourceType: 'assessment',
      sourceId: input.sourceId,
    }, {
      observedAt,
      completionProvenance: assessment.status === 'Completed'
        ? 'historical_replay'
        : 'direct_transition',
    });
    return;
  }

  if (input.sourceApp === 'installhub' && input.sourceType === 'installation') {
    const outcome = await completeInstallHubInstallation(executor, {
      installationId: input.sourceId,
      actorUserId: actor.appUserIds.installhub ?? actor.fieldUserId,
      idempotencyKey: input.idempotencyKey,
      completionNotes: null,
      allowAlreadyCompleted: true,
    });
    if (outcome.kind === 'not_ready') {
      throw new AppError(
        422,
        'Installation is not ready to complete',
        'Resolve the remaining TBC items in Field App Complete, then retry.',
      );
    }
    return;
  }

  throw badRequest('Invalid linked scheduler source');
}

export async function completeSchedulerJob(
  user: AuthUser,
  input: SchedulerJobCompletionInput,
): Promise<{ completed: true }> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) throw forbidden('Only admins can complete Scheduler jobs');
  assertSchedulerSourceAppVisible(input.sourceApp);
  assertSchedulerCompletionSource(input.sourceApp, input.sourceType, input.sourceId);
  if (!input.idempotencyKey.trim()) throw badRequest('idempotencyKey is required');
  await db.transaction(async (tx) => {
    await lockLinkedSourceRow(tx, input.sourceApp, input.sourceType, input.sourceId);
    const actor = await loadActorSubject(tx, user);
    await completeSchedulerLinkedSource(tx, input, actor);
  });
  return { completed: true };
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
    remaining.scheduledStartAt,
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
    await lockLinkedSourceRow(tx, sourceApp, sourceType, sourceId);
    const labelFromSource = await assertSourceExists(tx, sourceApp, sourceType, sourceId);
    const title = (input.title?.trim() || labelFromSource || 'Scheduled work').slice(0, 300);
    if (!title) throw badRequest('title is required');
    const assignee = await loadSchedulerSubject(tx, input.assigneeFieldUserId.trim());
    await lockAndAssertAssigneeAvailable(tx, assignee.fieldUserId, start, end);
    // Updating the product assignment takes its row lock. Do this before the
    // duplicate check so concurrent creates for the same source serialize;
    // the losing transaction then observes the winner's committed event and
    // rolls its assignment update back with the conflict.
    await alignLinkedSourceAssignment(tx, sourceApp, sourceType, sourceId, assignee, start);
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
  assigneeFieldUserId?: string;
  scheduledStartAt: unknown;
  estimatedDurationMinutes?: unknown;
  /** @deprecated Client-provided end times are rejected. */
  scheduledEndAt?: unknown;
  deadlineAt: unknown;
  job: unknown;
  status?: unknown;
};

type DispatchJobInput = Record<string, unknown>;

const FIELD_SCOPE_CODE_PATTERN = /^\s*(M[1-5])\b/i;
const FIELD_JOB_TITLE_SUFFIX_PATTERN = /^[A-Z0-9]{3}$/;
const FIELD_JOB_TITLE_SUFFIX_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FIELD_JOB_TITLE_MAX_LENGTH = 300;

export function fieldScopeNumber(workType: string | null | undefined): string {
  return workType?.match(FIELD_SCOPE_CODE_PATTERN)?.[1]?.toUpperCase() ?? 'M5';
}

export function randomFieldJobTitleSuffix(
  randomIndex: (maximum: number) => number = (maximum) => randomInt(maximum),
): string {
  return Array.from(
    { length: 3 },
    () => FIELD_JOB_TITLE_SUFFIX_CHARACTERS[randomIndex(FIELD_JOB_TITLE_SUFFIX_CHARACTERS.length)],
  ).join('');
}

function normalizeFieldJobTitleSuffix(suffix: string): string {
  const normalized = suffix.trim().toUpperCase();
  if (!FIELD_JOB_TITLE_SUFFIX_PATTERN.test(normalized)) {
    throw badRequest('job.titleSuffix must contain exactly 3 alphanumeric characters');
  }
  return normalized;
}

export function generatedFieldJobTitle(
  workType: string | null | undefined,
  clientName: string,
  siteName: string,
  suffix = randomFieldJobTitleSuffix(),
): string {
  const normalizedSuffix = normalizeFieldJobTitleSuffix(suffix);
  const suffixSegment = ` - ${normalizedSuffix}`;
  const prefix = `${fieldScopeNumber(workType)} - ${clientName.trim()} - ${siteName.trim()}`;
  return `${prefix.slice(0, FIELD_JOB_TITLE_MAX_LENGTH - suffixSegment.length)}${suffixSegment}`;
}

const DISPATCH_JOB_FIELDS: Record<Exclude<ScheduleSourceApp, 'custom'>, ReadonlySet<string>> = {
  ecoaudit: new Set([
    'siteMode',
    'existingSiteId',
    'clientId',
    'clientName',
    'clientContactName',
    'clientContactPhone',
    'clientContactEmail',
    'siteName',
    'siteAddress',
    'siteContactName',
    'siteContactPhone',
    'siteContactEmail',
    'accessInformation',
    'auditDate',
    'address',
  ]),
  solarsense: new Set([
    'siteMode',
    'existingSiteId',
    'clientId',
    'clientName',
    'clientContactName',
    'clientContactPhone',
    'clientContactEmail',
    'siteName',
    'location',
    'siteContactName',
    'siteContactPhone',
    'siteContactEmail',
    'accessInformation',
    'buildingIdName',
    'auditDate',
    'address',
  ]),
  installhub: new Set([
    'siteMode',
    'existingSiteId',
    'clientId',
    'customerName',
    'clientName',
    'clientContactName',
    'clientContactPhone',
    'clientContactEmail',
    'maas',
    'workType',
    'serviceType',
    'meteringSolutionType',
    'plannedMeterType',
    'titleSuffix',
    'customJobNumber',
    'siteName',
    'siteAddress',
    'siteContactName',
    'siteContactPhone',
    'siteContactEmail',
    'fergusJobNumber',
    'quoteNumber',
    'jobComments',
    'accessInformation',
    'warrantyDevice',
    'monitoringInstalled',
    'hardwareInstalled',
    'solarCapacityKw',
    'additionalMonitoringRequired',
    'additionalMonitoringHardware',
    'electricityNmi',
    'auditDate',
    'timezone',
    'address',
  ]),
};

export function parseDispatchJob(
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

function optionalDispatchString(
  job: DispatchJobInput,
  field: string,
  maxLength?: number,
): string | null {
  const value = job[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`job.${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw badRequest(`job.${field} must contain at most ${maxLength} characters`);
  }
  return normalized;
}

function optionalDispatchFieldJobTitleSuffix(job: DispatchJobInput): string | undefined {
  const suffix = optionalDispatchString(job, 'titleSuffix', 3);
  return suffix === null ? undefined : normalizeFieldJobTitleSuffix(suffix);
}

function optionalDispatchBoolean(job: DispatchJobInput, field: string): boolean | null {
  const value = job[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw badRequest(`job.${field} must be a boolean`);
  return value;
}

function optionalDispatchSolarCapacity(job: DispatchJobInput): number | null {
  const value = job.solarCapacityKw;
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > 1_000_000
  ) {
    throw badRequest('job.solarCapacityKw must be a finite number between 0 and 1000000');
  }
  return value;
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

export function dispatchSiteSelection(job: DispatchJobInput): {
  mode: 'new' | 'existing';
  existingSiteId: string | null;
} {
  const rawMode = job.siteMode ?? 'new';
  if (rawMode !== 'new' && rawMode !== 'existing') {
    throw badRequest('job.siteMode must be new or existing');
  }
  const existingSiteId = optionalDispatchString(job, 'existingSiteId', 200);
  if (rawMode === 'existing' && !existingSiteId) {
    throw badRequest('job.existingSiteId is required for an existing site');
  }
  if (rawMode === 'new' && existingSiteId) {
    throw badRequest('job.existingSiteId is allowed only for an existing site');
  }
  return { mode: rawMode, existingSiteId };
}

export function validateDispatchJob(
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
): void {
  dispatchSiteSelection(job);
  optionalDispatchDate(job, 'auditDate');
  dispatchString(job, 'siteName');
  optionalDispatchString(job, 'clientName', 300);
  optionalDispatchString(job, 'clientId', 200);
  optionalDispatchString(job, 'clientContactName', 300);
  optionalDispatchString(job, 'clientContactPhone', 50);
  optionalDispatchString(job, 'clientContactEmail', 320);
  optionalDispatchString(job, 'siteContactName', 300);
  optionalDispatchString(job, 'siteContactPhone', 50);
  optionalDispatchString(job, 'siteContactEmail', 320);
  optionalDispatchString(job, 'accessInformation', 5_000);
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
  optionalDispatchString(job, 'workType', 120);
  optionalDispatchString(job, 'timezone');
  for (const [field, maxLength] of Object.entries(INSTALLATION_METADATA_TEXT_LIMITS)) {
    optionalDispatchString(job, field, maxLength);
  }
  optionalDispatchBoolean(job, 'maas');
  optionalDispatchBoolean(job, 'warrantyDevice');
  optionalDispatchBoolean(job, 'monitoringInstalled');
  optionalDispatchBoolean(job, 'hardwareInstalled');
  optionalDispatchBoolean(job, 'additionalMonitoringRequired');
  optionalDispatchSolarCapacity(job);
  optionalDispatchString(job, 'electricityNmi', GRID_SUPPLY_NMI_MAX_LENGTH);
  optionalDispatchFieldJobTitleSuffix(job);
}

type ResolvedDispatchSite = {
  id: string;
  clientId: string;
  clientName: string;
  clientContactName: string | null;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  siteName: string;
  address: string;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string;
  geocodeProvider: string | null;
  geocodePlaceId: string | null;
  addressSource: string;
  addressFingerprint: string;
  geocodedAt: Date | null;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accessInformation: string | null;
  previousJobId: string | null;
  revisionNumber: number;
};

function dispatchAddressForApp(
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
): string {
  return sourceApp === 'solarsense'
    ? dispatchString(job, 'location')
    : dispatchString(job, 'siteAddress');
}

async function resolveDispatchBusinessSite(
  executor: ScheduleExecutor,
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
): Promise<ResolvedDispatchSite> {
  const selection = dispatchSiteSelection(job);
  const now = new Date();
  const siteName = dispatchString(job, 'siteName');
  const address = dispatchAddressForApp(sourceApp, job);
  const structuredAddress = parseSchedulerDispatchAddress(job.address, address, now);
  const clientName = optionalDispatchString(job, 'clientName', 300) ?? siteName;
  const clientContactName = optionalDispatchString(job, 'clientContactName', 300);
  const clientContactPhone = optionalDispatchString(job, 'clientContactPhone', 50);
  const clientContactEmail = optionalDispatchString(job, 'clientContactEmail', 320);
  const contactName = optionalDispatchString(job, 'siteContactName', 300);
  const contactPhone = optionalDispatchString(job, 'siteContactPhone', 50);
  const contactEmail = optionalDispatchString(job, 'siteContactEmail', 320);
  const accessInformation = optionalDispatchString(job, 'accessInformation', 5_000);
  const timezone = optionalDispatchString(job, 'timezone', 100) ?? DEFAULT_INSTALLHUB_TIMEZONE;

  if (selection.mode === 'existing') {
    const [existing] = await executor.select({
      id: businessSites.id,
      clientId: businessSites.clientId,
      siteName: businessSites.name,
      address: businessSites.address,
      locality: businessSites.locality,
      state: businessSites.state,
      postcode: businessSites.postcode,
      countryCode: businessSites.countryCode,
      latitude: businessSites.latitude,
      longitude: businessSites.longitude,
      geocodeStatus: businessSites.geocodeStatus,
      geocodeProvider: businessSites.geocodeProvider,
      geocodePlaceId: businessSites.geocodePlaceId,
      addressSource: businessSites.addressSource,
      geocodedAt: businessSites.geocodedAt,
      timezone: businessSites.timezone,
      contactName: businessSites.contactName,
      contactPhone: businessSites.contactPhone,
      contactEmail: businessSites.contactEmail,
      addressFingerprint: businessSites.addressFingerprint,
      accessInformation: businessSites.accessInformation,
      clientName: businessClients.name,
      clientContactName: businessClients.contactName,
      clientContactPhone: businessClients.contactPhone,
      clientContactEmail: businessClients.contactEmail,
    }).from(businessSites)
      .innerJoin(businessClients, and(
        eq(businessClients.id, businessSites.clientId),
        eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
        isNull(businessClients.mergedIntoClientId),
      ))
      .where(eq(businessSites.id, selection.existingSiteId!))
      .for('update')
      .limit(1);
    if (!existing) throw notFound('Business site');
    if (structuredAddress.siteAddressFingerprint !== existing.addressFingerprint) {
      throw badRequest(
        'A saved site address cannot be replaced; choose Add a new address instead',
      );
    }
    await executor.update(businessClients).set({
      contactName: clientContactName ?? existing.clientContactName,
      contactPhone: clientContactPhone ?? existing.clientContactPhone,
      contactEmail: clientContactEmail ?? existing.clientContactEmail,
      updatedAt: now,
    }).where(eq(businessClients.id, existing.clientId));
    await executor.update(businessSites).set({
      name: siteName || existing.siteName,
      timezone: timezone || existing.timezone,
      contactName: contactName ?? existing.contactName,
      contactPhone: contactPhone ?? existing.contactPhone,
      contactEmail: contactEmail ?? existing.contactEmail,
      accessInformation: job.accessInformation === undefined
        ? existing.accessInformation
        : accessInformation,
      updatedAt: now,
    }).where(eq(businessSites.id, existing.id));
    const [previous] = await executor.select({
      id: businessJobs.id,
      revisionNumber: businessJobs.revisionNumber,
    }).from(businessJobs).where(and(
      eq(businessJobs.siteId, existing.id),
      eq(businessJobs.sourceApp, sourceApp),
    )).orderBy(desc(businessJobs.revisionNumber), desc(businessJobs.createdAt)).limit(1);
    return {
      id: existing.id,
      clientId: existing.clientId,
      clientName: existing.clientName,
      clientContactName: clientContactName ?? existing.clientContactName,
      clientContactPhone: clientContactPhone ?? existing.clientContactPhone,
      clientContactEmail: clientContactEmail ?? existing.clientContactEmail,
      siteName: siteName || existing.siteName,
      address: existing.address,
      locality: existing.locality,
      state: existing.state,
      postcode: existing.postcode,
      countryCode: existing.countryCode,
      latitude: existing.latitude,
      longitude: existing.longitude,
      geocodeStatus: existing.geocodeStatus,
      geocodeProvider: existing.geocodeProvider,
      geocodePlaceId: existing.geocodePlaceId,
      // The business site retains how its address was originally captured;
      // this new product record records that the user chose saved client data.
      addressSource: 'client_saved',
      addressFingerprint: existing.addressFingerprint,
      geocodedAt: existing.geocodedAt,
      timezone: timezone || existing.timezone,
      contactName: contactName ?? existing.contactName,
      contactPhone: contactPhone ?? existing.contactPhone,
      contactEmail: contactEmail ?? existing.contactEmail,
      accessInformation: job.accessInformation === undefined
        ? existing.accessInformation
        : accessInformation,
      previousJobId: previous?.id ?? null,
      revisionNumber: (previous?.revisionNumber ?? 0) + 1,
    };
  }

  const memory = await upsertClientSiteFromProductRecord(executor, {
    clientName,
    selectedClientId: optionalDispatchString(job, 'clientId', 200),
    siteName,
    address: {
      displayAddress: address,
      locality: structuredAddress.siteLocality,
      state: structuredAddress.siteState,
      postcode: structuredAddress.sitePostcode,
      countryCode: 'AU',
      latitude: structuredAddress.siteLatitude,
      longitude: structuredAddress.siteLongitude,
      provider: structuredAddress.siteGeocodeProvider,
      placeId: structuredAddress.siteGeocodePlaceId,
      source: structuredAddress.siteAddressSource,
      geocodingStatus: structuredAddress.siteGeocodeStatus,
    },
    timezone,
    clientContactName,
    clientContactPhone,
    clientContactEmail,
    siteContactName: contactName,
    siteContactPhone: contactPhone,
    siteContactEmail: contactEmail,
    accessInformation,
  });
  const [previous] = await executor.select({
    id: businessJobs.id,
    revisionNumber: businessJobs.revisionNumber,
  }).from(businessJobs).where(and(
    eq(businessJobs.siteId, memory.site.id),
    eq(businessJobs.sourceApp, sourceApp),
  )).orderBy(desc(businessJobs.revisionNumber), desc(businessJobs.createdAt)).limit(1);
  return {
    id: memory.site.id,
    clientId: memory.client.id,
    clientName: memory.client.name,
    clientContactName: memory.client.contactName,
    clientContactPhone: memory.client.contactPhone,
    clientContactEmail: memory.client.contactEmail,
    siteName: memory.site.siteName,
    address: memory.site.displayAddress,
    locality: memory.site.locality,
    state: memory.site.state,
    postcode: memory.site.postcode,
    countryCode: memory.site.countryCode,
    latitude: memory.site.latitude,
    longitude: memory.site.longitude,
    geocodeStatus: memory.site.geocodingStatus,
    geocodeProvider: memory.site.provider,
    geocodePlaceId: memory.site.placeId,
    addressSource: memory.site.source,
    addressFingerprint: memory.site.fingerprint,
    geocodedAt: memory.site.geocodingStatus === 'resolved' || memory.site.geocodingStatus === 'manual'
      ? new Date(memory.site.updatedAt)
      : null,
    timezone: memory.site.timezone,
    contactName: memory.site.contactName,
    contactPhone: memory.site.contactPhone,
    contactEmail: memory.site.contactEmail,
    accessInformation: memory.site.accessInformation,
    previousJobId: previous?.id ?? null,
    revisionNumber: (previous?.revisionNumber ?? 0) + 1,
  };
}

export async function listSchedulerSites(
  user: AuthUser,
  opts: { q?: string; sourceApp?: Exclude<ScheduleSourceApp, 'custom'>; limit?: number } = {},
): Promise<SchedulerSiteOption[]> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) throw forbidden('Only admins can list business sites');
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const q = (opts.q ?? '').trim();
  const pattern = q ? `%${q.replace(/%/g, '')}%` : '%';
  const sites = await db.select({
    id: businessSites.id,
    clientId: businessSites.clientId,
    clientName: businessClients.name,
    clientContactName: businessClients.contactName,
    clientContactPhone: businessClients.contactPhone,
    clientContactEmail: businessClients.contactEmail,
    siteName: businessSites.name,
    address: businessSites.address,
    locality: businessSites.locality,
    state: businessSites.state,
    postcode: businessSites.postcode,
    countryCode: businessSites.countryCode,
    latitude: businessSites.latitude,
    longitude: businessSites.longitude,
    geocodeStatus: businessSites.geocodeStatus,
    geocodeProvider: businessSites.geocodeProvider,
    geocodePlaceId: businessSites.geocodePlaceId,
    addressSource: businessSites.addressSource,
    addressFingerprint: businessSites.addressFingerprint,
    geocodedAt: businessSites.geocodedAt,
    timezone: businessSites.timezone,
    siteContactName: businessSites.contactName,
    siteContactPhone: businessSites.contactPhone,
    siteContactEmail: businessSites.contactEmail,
    accessInformation: businessSites.accessInformation,
  }).from(businessSites).innerJoin(
    businessClients,
    eq(businessClients.id, businessSites.clientId),
  ).where(and(
    eq(businessClients.companyKey, BUSINESS_COMPANY_KEY),
    isNull(businessClients.mergedIntoClientId),
    or(
      ilike(businessSites.name, pattern),
      ilike(businessSites.address, pattern),
      ilike(businessClients.name, pattern),
    ),
  )).orderBy(asc(businessClients.name), asc(businessSites.name)).limit(limit);
  return sites.map(schedulerSitePrefillOption);
}

async function createDispatchedProductJob(
  executor: ScheduleExecutor,
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  job: DispatchJobInput,
  site: ResolvedDispatchSite,
  actor: UnifiedSchedulerSubject,
  assignee: UnifiedSchedulerSubject | null,
  scheduledStartAt: Date,
): Promise<{ sourceId: string; sourceType: ScheduleSourceType; label: string }> {
  const now = new Date();
  const auditDate = optionalDispatchDate(job, 'auditDate')
    ?? scheduledStartAt.toISOString().slice(0, 10);
  const inspectorName = assignee ? installHubSchedulerInspectorName(assignee) : '';

  if (sourceApp === 'ecoaudit') {
    if (!assignee) throw badRequest('EcoAudit work must be assigned when it is created');
    const sourceId = randomUUID();
    const siteName = dispatchString(job, 'siteName');
    const siteAddress = dispatchString(job, 'siteAddress');
    const structuredAddress = parseSchedulerDispatchAddress(job.address, siteAddress, now);
    await executor.insert(eaAudits).values({
      id: sourceId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      clientName: site.clientName,
      businessSiteId: site.id,
      siteName,
      siteAddress,
      ...structuredAddress,
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
    if (!assignee) throw badRequest('SolarSense work must be assigned when it is created');
    const siteId = randomUUID();
    const sourceId = randomUUID();
    const siteName = dispatchString(job, 'siteName');
    const location = dispatchString(job, 'location');
    const buildingIdName = dispatchString(job, 'buildingIdName');
    const structuredAddress = parseSchedulerDispatchAddress(job.address, location, now);
    const ownerUserId = requireProductUserId(actor, 'solarsense');
    await executor.insert(ssSites).values({
      id: siteId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      updatedAt: now,
      deletedAt: null,
      clientName: site.clientName,
      businessSiteId: site.id,
      siteName,
      location,
      ...structuredAddress,
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
  const structuredAddress = parseSchedulerDispatchAddress(job.address, siteAddress, now);
  const fieldPlanning = {
    customerName: optionalDispatchString(
      job,
      'customerName',
      INSTALLATION_METADATA_TEXT_LIMITS.customerName,
    ),
    maas: optionalDispatchBoolean(job, 'maas'),
    workType: optionalDispatchString(
      job,
      job.workType ? 'workType' : 'serviceType',
      INSTALLATION_METADATA_TEXT_LIMITS.serviceType,
    ),
    meteringSolutionType: optionalDispatchString(
      job,
      'meteringSolutionType',
      INSTALLATION_METADATA_TEXT_LIMITS.meteringSolutionType,
    ),
    plannedMeterType: optionalDispatchString(
      job,
      'plannedMeterType',
      INSTALLATION_METADATA_TEXT_LIMITS.plannedMeterType,
    ),
    customJobNumber: optionalDispatchString(
      job,
      'customJobNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.customJobNumber,
    ),
    jobComments: optionalDispatchString(
      job,
      'jobComments',
      INSTALLATION_METADATA_TEXT_LIMITS.jobComments,
    ),
    nmi: optionalDispatchString(job, 'electricityNmi', GRID_SUPPLY_NMI_MAX_LENGTH),
  };

  if (site.previousJobId) {
    const [previousJob] = await executor.select({
      sourceId: businessJobs.sourceId,
    }).from(businessJobs).where(and(
      eq(businessJobs.id, site.previousJobId),
      eq(businessJobs.siteId, site.id),
      eq(businessJobs.sourceApp, 'installhub'),
      eq(businessJobs.sourceType, 'installation'),
    )).limit(1);
    if (previousJob?.sourceId) {
      const copiedSourceId = await copyFieldInstallationForJob(
        executor,
        previousJob.sourceId,
        {
          businessSiteId: site.id,
          clientName: site.clientName,
          siteName,
          address: siteAddress,
          siteLocality: site.locality,
          siteState: site.state,
          sitePostcode: site.postcode,
          siteCountryCode: site.countryCode,
          siteLatitude: site.latitude,
          siteLongitude: site.longitude,
          siteGeocodeStatus: site.geocodeStatus,
          siteGeocodeProvider: site.geocodeProvider,
          siteGeocodePlaceId: site.geocodePlaceId,
          siteAddressSource: site.addressSource,
          siteAddressFingerprint: site.addressFingerprint,
          siteGeocodedAt: site.geocodedAt,
          contactName: site.contactName,
          contactPhone: site.contactPhone,
          contactEmail: site.contactEmail,
          accessInformation: site.accessInformation,
          timezone: site.timezone,
        },
        {
          createdByUserId: actor.fieldUserId,
          assignedInspectorUserId: assignee?.fieldUserId ?? null,
          inspectorName,
          auditDate,
        },
        fieldPlanning,
      );
      return {
        sourceId: copiedSourceId,
        sourceType: 'installation',
        label: `${clientName} · ${siteName}`,
      };
    }
  }

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
    customerName: fieldPlanning.customerName,
    clientName,
    businessSiteId: site.id,
    maas: fieldPlanning.maas,
    serviceType: fieldPlanning.workType,
    meteringSolutionType: fieldPlanning.meteringSolutionType,
    plannedMeterType: fieldPlanning.plannedMeterType,
    customJobNumber: fieldPlanning.customJobNumber,
    siteName,
    siteAddress,
    ...structuredAddress,
    siteContactName: optionalDispatchString(
      job,
      'siteContactName',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactName,
    ),
    siteContactPhone: optionalDispatchString(
      job,
      'siteContactPhone',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactPhone,
    ),
    siteContactEmail: optionalDispatchString(
      job,
      'siteContactEmail',
      INSTALLATION_METADATA_TEXT_LIMITS.siteContactEmail,
    ),
    fergusJobNumber: optionalDispatchString(
      job,
      'fergusJobNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.fergusJobNumber,
    ),
    quoteNumber: optionalDispatchString(
      job,
      'quoteNumber',
      INSTALLATION_METADATA_TEXT_LIMITS.quoteNumber,
    ),
    jobComments: fieldPlanning.jobComments,
    accessInformation: optionalDispatchString(
      job,
      'accessInformation',
      INSTALLATION_METADATA_TEXT_LIMITS.accessInformation,
    ),
    warrantyDevice: optionalDispatchBoolean(job, 'warrantyDevice'),
    monitoringInstalled: optionalDispatchBoolean(job, 'monitoringInstalled'),
    hardwareInstalled: optionalDispatchBoolean(job, 'hardwareInstalled'),
    solarCapacityKw: optionalDispatchSolarCapacity(job),
    additionalMonitoringRequired: optionalDispatchBoolean(
      job,
      'additionalMonitoringRequired',
    ),
    additionalMonitoringHardware: optionalDispatchString(
      job,
      'additionalMonitoringHardware',
      INSTALLATION_METADATA_TEXT_LIMITS.additionalMonitoringHardware,
    ),
    inspectorName,
    auditDate,
    status: 'Draft',
    createdByUserId: actor.fieldUserId,
    assignedInspectorUserId: assignee?.fieldUserId ?? null,
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
    nmi: fieldPlanning.nmi,
    createdAt: now,
  });
  return {
    sourceId,
    sourceType: 'installation',
    label: `${clientName} · ${siteName}`,
  };
}

async function createCanonicalJobHierarchy(
  executor: ScheduleExecutor,
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>,
  sourceType: Exclude<ScheduleSourceType, 'custom'>,
  sourceId: string,
  job: DispatchJobInput,
  site: ResolvedDispatchSite,
  title: string,
  description: string | null,
  createdByUserId: string,
): Promise<string> {
  const now = new Date();
  const jobId = randomUUID();
  await executor.insert(businessJobs).values({
    id: jobId,
    siteId: site.id,
    jobType: sourceApp === 'installhub' ? 'field' : sourceApp,
    title,
    description,
    status: 'planned',
    sourceApp,
    sourceType,
    sourceId,
    revisionNumber: site.revisionNumber,
    previousJobId: site.previousJobId,
    createdByUserId,
    createdAt: now,
    updatedAt: now,
  });

  if (sourceApp === 'installhub') {
    await executor.insert(fieldAppJobDetails).values({
      jobId,
      workType: optionalDispatchString(job, 'workType', 120)
        ?? optionalDispatchString(job, 'serviceType', 120)
        ?? 'legacy_unclassified',
      maas: optionalDispatchBoolean(job, 'maas'),
      meteringSolutionType: optionalDispatchString(job, 'meteringSolutionType', 120),
      plannedMeterType: optionalDispatchString(job, 'plannedMeterType', 120),
      customJobNumber: optionalDispatchString(job, 'customJobNumber', 100),
      jobComments: optionalDispatchString(job, 'jobComments', 5_000),
      createdAt: now,
      updatedAt: now,
    });
  } else if (sourceApp === 'ecoaudit') {
    await executor.insert(ecoauditJobDetails).values({ jobId, auditId: sourceId, createdAt: now });
  } else {
    await executor.insert(solarsenseJobDetails).values({
      jobId,
      assessmentId: sourceId,
      buildingName: optionalDispatchString(job, 'buildingIdName', 300),
      createdAt: now,
    });
  }
  return jobId;
}

export function createSchedulerDispatch(
  user: AuthUser,
  input: CreateSchedulerDispatchInput & { assigneeFieldUserId: string },
): Promise<ScheduleEventDto>;
export function createSchedulerDispatch(
  user: AuthUser,
  input: CreateSchedulerDispatchInput,
): Promise<ScheduleEventDto | JobOption>;
export async function createSchedulerDispatch(
  user: AuthUser,
  input: CreateSchedulerDispatchInput,
): Promise<ScheduleEventDto | JobOption> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) throw forbidden('Only admins can create scheduler dispatches');
  if (input.status !== undefined) throw badRequest('New scheduler dispatches are always planned');
  const sourceApp = parseSourceApp(input.sourceApp);
  assertSchedulerSourceAppVisible(sourceApp);
  if (sourceApp === 'custom') throw badRequest('Create custom work with the standard scheduler event endpoint');
  const assigneeId = input.assigneeFieldUserId?.trim() || null;
  if (!assigneeId && sourceApp !== 'installhub') {
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
    const actor = await loadActorSubject(tx, user);
    const assignee = assigneeId ? await loadSchedulerSubject(tx, assigneeId) : null;
    if (assignee) await lockAndAssertAssigneeAvailable(tx, assignee.fieldUserId, start, end);
    const site = await resolveDispatchBusinessSite(tx, sourceApp, job);
    const product = await createDispatchedProductJob(
      tx,
      sourceApp,
      job,
      site,
      actor,
      assignee,
      start,
    );
    const now = new Date();
    const title = sourceApp === 'installhub'
      ? generatedFieldJobTitle(
          optionalDispatchString(job, job.workType ? 'workType' : 'serviceType', 120),
          site.clientName,
          site.siteName,
          optionalDispatchFieldJobTitleSuffix(job),
        )
      : (input.title?.trim() || product.label).slice(0, 300);
    const description = sourceApp === 'installhub'
      ? optionalDispatchString(job, 'jobComments', 5_000)
      : input.description?.trim() || null;
    const jobId = await createCanonicalJobHierarchy(
      tx,
      sourceApp,
      product.sourceType as Exclude<ScheduleSourceType, 'custom'>,
      product.sourceId,
      job,
      site,
      title,
      description,
      user.userId,
    );
    if (!assignee) {
      return {
        kind: 'job' as const,
        value: {
          id: product.sourceId,
          label: `${site.clientName} · ${site.siteName}`,
          subtitle: 'Installation · Draft',
          sourceApp: 'installhub' as const,
          sourceType: 'installation' as const,
          assigneeFieldUserId: null,
          assigneeDisplayName: null,
          scheduledEventId: null,
          scheduledStartAt: null,
        },
      };
    }
    const [event] = await tx.insert(portalScheduleEvents).values({
      id: randomUUID(),
      jobId,
      title,
      description,
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
    return { kind: 'event' as const, value: event };
  });
  return created.kind === 'event' ? rowToDto(created.value) : created.value;
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

export function scheduleUpdateRequiresActiveProduct(input: {
  existingStatus: ScheduleStatus;
  nextStatus: ScheduleStatus;
  explicitAssignee: boolean;
}): boolean {
  const nextStatusIsActive = input.nextStatus === 'planned'
    || input.nextStatus === 'in_progress';
  return nextStatusIsActive && (
    input.explicitAssignee
    || input.existingStatus === 'cancelled'
    || input.existingStatus === 'done'
  );
}

export function scheduleUpdateRequiresAvailabilityCheck(input: {
  existingStatus: ScheduleStatus;
  nextStatus: ScheduleStatus;
  assigneeChanged: boolean;
  scheduleChanged: boolean;
}): boolean {
  if (input.nextStatus === 'cancelled') return false;
  return input.assigneeChanged
    || input.scheduleChanged
    || input.nextStatus !== input.existingStatus;
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
    // Source identity is immutable through this API. Read it without an event
    // row lock, acquire the linked product lock, then lock/re-read the event.
    // Completion paths use the same product -> event order.
    const [sourceHint] = await tx
      .select({
        sourceApp: portalScheduleEvents.sourceApp,
        sourceType: portalScheduleEvents.sourceType,
        sourceId: portalScheduleEvents.sourceId,
      })
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, id))
      .limit(1);
    if (!sourceHint) throw notFound('Schedule event');
    assertSchedulerSourceAppVisible(sourceHint.sourceApp);
    await lockLinkedSourceRow(
      tx,
      sourceHint.sourceApp as ScheduleSourceApp,
      sourceHint.sourceType as ScheduleSourceType,
      sourceHint.sourceId,
    );
    const [existing] = await tx
      .select()
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, id))
      .for('update')
      .limit(1);
    if (!existing) throw notFound('Schedule event');
    if (
      existing.sourceApp !== sourceHint.sourceApp
      || existing.sourceType !== sourceHint.sourceType
      || existing.sourceId !== sourceHint.sourceId
    ) {
      throw conflict('schedule_event_source_changed');
    }
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
      if (existing.sourceApp === 'installhub' && existing.sourceId) {
        const jobComments = input.description?.trim() || null;
        await tx.update(ihInstallations).set({
          jobComments,
          updatedAt: new Date(),
          syncStatus: 'local',
        }).where(eq(ihInstallations.id, existing.sourceId));
        if (existing.jobId) {
          await tx.update(fieldAppJobDetails).set({
            jobComments,
            updatedAt: new Date(),
          }).where(eq(fieldAppJobDetails.jobId, existing.jobId));
        }
      }
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
    const nextStatusIsActive = nextStatus === 'planned' || nextStatus === 'in_progress';
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
    if (
      nextStatus === 'done'
      && existing.status !== 'done'
      && existing.sourceApp !== 'custom'
      && existing.sourceType !== 'custom'
      && existing.sourceId
    ) {
      assertSchedulerCompletionSource(
        existing.sourceApp as ScheduleSourceApp,
        existing.sourceType as ScheduleSourceType,
        existing.sourceId,
      );
      await completeSchedulerLinkedSource(tx, {
        sourceApp: existing.sourceApp as Exclude<ScheduleSourceApp, 'custom'>,
        sourceType: existing.sourceType as Exclude<ScheduleSourceType, 'custom'>,
        sourceId: existing.sourceId,
        idempotencyKey: `scheduler-event:${existing.id}:complete`,
      }, await loadActorSubject(tx, user));
    }

    if (estimatedDurationWasProvided || scheduledStartChanged) {
      const start = (patch.scheduledStartAt as Date | undefined) ?? existing.scheduledStartAt;
      const estimatedDurationMinutes = estimatedDurationWasProvided
        ? requestedEstimatedDurationMinutes!
        : existing.estimatedDurationMinutes;
      patch.estimatedDurationMinutes = estimatedDurationMinutes;
      patch.scheduledEndAt = deriveScheduledEndAt(start, estimatedDurationMinutes);
    }

    const start = (patch.scheduledStartAt as Date | undefined) ?? existing.scheduledStartAt;
    const end = patch.scheduledEndAt !== undefined
      ? (patch.scheduledEndAt as Date | null)
      : existing.scheduledEndAt;

    const explicitAssignee = input.assigneeFieldUserId !== undefined;
    const availabilityChanged = scheduleUpdateRequiresAvailabilityCheck({
      existingStatus: existing.status as ScheduleStatus,
      nextStatus,
      assigneeChanged,
      scheduleChanged: input.scheduledStartAt !== undefined
        || estimatedDurationWasProvided,
    });
    if (availabilityChanged) {
      await lockAndAssertAssigneeAvailable(
        tx,
        assignee?.fieldUserId ?? existing.assigneeFieldUserId,
        start,
        end,
      );
    }
    let productAssignmentRepaired = false;
    const installHubScheduleProjectionRequired = existing.sourceApp === 'installhub'
      && existing.sourceType === 'installation'
      && nextStatusIsActive
      && input.scheduledStartAt !== undefined;
    if (
      isMobileScheduleNotificationTarget(existing)
      && (
        scheduleUpdateRequiresActiveProduct({
          existingStatus: existing.status as ScheduleStatus,
          nextStatus,
          explicitAssignee,
        })
        || installHubScheduleProjectionRequired
      )
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
      // serializes concurrent inactive-event reactivation attempts.
      productAssignmentRepaired = await alignLinkedSourceAssignment(
        tx,
        existing.sourceApp as ScheduleSourceApp,
        existing.sourceType as ScheduleSourceType,
        existing.sourceId,
        subject,
        start,
      );
      assignee = subject;
    }
    if (
      nextStatusIsActive
      && (existing.status === 'cancelled' || existing.status === 'done')
    ) {
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
    if (row.jobId && row.status !== existing.status) {
      await tx.update(businessJobs)
        .set({ status: row.status, updatedAt: row.updatedAt })
        .where(eq(businessJobs.id, row.jobId));
    }
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
      } else if (
        (existing.status === 'cancelled' || existing.status === 'done')
        && currentGlobalUserId
      ) {
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

/** Product jobs, optionally restricted to work without an active schedule event. */
export async function listUnscheduledJobs(
  user: AuthUser,
  opts: {
    q?: string;
    sourceApp?: ScheduleSourceApp;
    limit?: number;
    unscheduledOnly?: boolean;
  } = {},
): Promise<JobOption[]> {
  assertPortalSchedulerApp(user);
  if (!isSchedulerAdmin(user)) {
    throw forbidden('Only admins can list unscheduled jobs');
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const q = (opts.q ?? '').trim();
  const pattern = q ? `%${q.replace(/%/g, '')}%` : '%';
  const visibleApps = schedulerVisibleFinanceSourceApps();
  const apps = opts.sourceApp && opts.sourceApp !== 'custom'
    ? visibleApps.includes(opts.sourceApp)
      ? [opts.sourceApp]
      : []
    : visibleApps;
  const unscheduledOnly = opts.unscheduledOnly ?? true;

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
        assignedInspectorUserId: ihInstallations.assignedInspectorUserId,
        inspectorName: ihInstallations.inspectorName,
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
        unscheduledOnly && scheduledIds.length > 0
          ? notInArray(ihInstallations.id, scheduledIds)
          : undefined,
      ))
      .orderBy(desc(ihInstallations.createdAt))
      .limit(limit);
    const scheduledRows = await db
      .select({
        id: portalScheduleEvents.id,
        sourceId: portalScheduleEvents.sourceId,
        scheduledStartAt: portalScheduleEvents.scheduledStartAt,
        assigneeFieldUserId: portalScheduleEvents.assigneeFieldUserId,
        assigneeDisplayName: portalScheduleEvents.assigneeDisplayName,
      })
      .from(portalScheduleEvents)
      .where(and(
        eq(portalScheduleEvents.sourceApp, 'installhub'),
        eq(portalScheduleEvents.sourceType, 'installation'),
        notInArray(portalScheduleEvents.status, ['cancelled', 'done']),
      ))
      .orderBy(desc(portalScheduleEvents.updatedAt));
    const scheduledBySourceId = new Map(
      scheduledRows.flatMap((event) => event.sourceId ? [[event.sourceId, event] as const] : []),
    );
    for (const row of rows) {
      const scheduledEvent = scheduledBySourceId.get(row.id);
      if (unscheduledOnly && scheduledEvent) continue;
      results.push({
        id: row.id,
        label: `${row.clientName} · ${row.siteName}`,
        subtitle: `Installation · ${row.status}`,
        sourceApp: 'installhub',
        sourceType: 'installation',
        assigneeFieldUserId: scheduledEvent?.assigneeFieldUserId
          ?? row.assignedInspectorUserId,
        assigneeDisplayName: scheduledEvent?.assigneeDisplayName
          ?? row.inspectorName,
        scheduledEventId: scheduledEvent?.id ?? null,
        scheduledStartAt: scheduledEvent?.scheduledStartAt.toISOString() ?? null,
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
