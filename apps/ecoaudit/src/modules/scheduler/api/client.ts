import {
  getStoredJwt as getEcoJwt,
  request as ecoRequest,
  requestDownload as ecoRequestDownload,
} from '@/api/client';
import {
  getStoredJwt as getSolarJwt,
  request as solarRequest,
  requestDownload as solarRequestDownload,
} from '@/modules/solar/api/client';
import {
  getStoredJwt as getInstallHubJwt,
  installHubRequest,
  installHubRequestDownload,
} from '@/modules/installhub/api/client';
import { schedulerFinanceOverviewQuery } from '@/modules/scheduler/lib/finance';
import type { ExportJobStatus } from '@/types/domain';
import type {
  CreateScheduleEventInput,
  CreateSchedulerDispatchInput,
  FinanceExpense,
  FinanceExpenseInput,
  FinanceOverviewPage,
  JobOption,
  PortalDirectoryUser,
  QuickSchedulerInvoiceInput,
  ScheduleEvent,
  ScheduleReminderResponse,
  SchedulerFinancialSummary,
  SchedulerInvoice,
  SchedulerInvoiceListItem,
  ScheduleSummary,
  ScheduleSourceApp,
  UpdateSchedulerFinanceInput,
  UpdateSchedulerInvoiceInput,
  UpdateScheduleEventInput,
} from '@/modules/scheduler/types/domain';

type PortalRequest = <T>(method: string, path: string, body?: unknown) => Promise<T>;
type PortalDownload = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ blob: Blob; contentDisposition: string | null }>;

function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

function portalRequest(adminRequired = false): PortalRequest {
  const candidates = [
    { token: getEcoJwt(), request: ecoRequest as PortalRequest },
    { token: getSolarJwt(), request: solarRequest as PortalRequest },
    { token: getInstallHubJwt(), request: installHubRequest as PortalRequest },
  ].filter((candidate): candidate is { token: string; request: PortalRequest } => Boolean(candidate.token));
  const selected = adminRequired
    ? candidates.find((candidate) => jwtRole(candidate.token) === 'admin')
    : candidates[0];
  return selected?.request ?? candidates[0]?.request ?? (ecoRequest as PortalRequest);
}

function portalDownload(): PortalDownload {
  const candidates = [
    { token: getEcoJwt(), request: ecoRequestDownload as PortalDownload },
    { token: getSolarJwt(), request: solarRequestDownload as PortalDownload },
    { token: getInstallHubJwt(), request: installHubRequestDownload as PortalDownload },
  ].filter((candidate): candidate is { token: string; request: PortalDownload } => Boolean(candidate.token));
  const selected = candidates.find((candidate) => jwtRole(candidate.token) === 'admin');
  return selected?.request ?? candidates[0]?.request ?? (ecoRequestDownload as PortalDownload);
}

function financeBase(financeId: string): string {
  return `/v1/portal/scheduler/finance/${encodeURIComponent(financeId)}`;
}

type PortalUsersResponse = {
  data: Array<{
    key: string;
    fullName: string | null;
    displayEmail: string;
    memberships: Array<{
      app: string;
      userId: string;
      fieldUserId: string;
      role: string;
      isActive: boolean;
    }>;
  }>;
};

export async function fetchScheduleSummary(): Promise<ScheduleSummary> {
  return portalRequest()<ScheduleSummary>('GET', '/v1/portal/scheduler/summary');
}

export async function fetchScheduleEvents(params: {
  from?: string;
  to?: string;
  assigneeFieldUserId?: string;
  sourceApp?: ScheduleSourceApp;
  status?: string;
  includeCancelled?: boolean;
}): Promise<ScheduleEvent[]> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.assigneeFieldUserId) qs.set('assigneeFieldUserId', params.assigneeFieldUserId);
  if (params.sourceApp) qs.set('sourceApp', params.sourceApp);
  if (params.status) qs.set('status', params.status);
  if (params.includeCancelled) qs.set('includeCancelled', 'true');
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await portalRequest()<{ events: ScheduleEvent[] }>('GET', `/v1/portal/scheduler/events${suffix}`);
  return res.events ?? [];
}

export async function createScheduleEvent(input: CreateScheduleEventInput): Promise<ScheduleEvent> {
  return portalRequest(true)<ScheduleEvent>('POST', '/v1/portal/scheduler/events', input);
}

export async function createSchedulerDispatch(
  input: CreateSchedulerDispatchInput,
): Promise<ScheduleEvent> {
  return portalRequest(true)<ScheduleEvent>('POST', '/v1/portal/scheduler/dispatches', input);
}

export async function updateScheduleEvent(
  id: string,
  input: UpdateScheduleEventInput,
): Promise<ScheduleEvent> {
  return portalRequest(true)<ScheduleEvent>('PATCH', `/v1/portal/scheduler/events/${id}`, input);
}

export async function cancelScheduleEvent(id: string): Promise<ScheduleEvent> {
  return portalRequest(true)<ScheduleEvent>('DELETE', `/v1/portal/scheduler/events/${id}`);
}

export async function sendScheduleEventReminder(
  id: string,
  idempotencyKey: string,
): Promise<ScheduleReminderResponse> {
  return portalRequest(true)<ScheduleReminderResponse>(
    'POST',
    `/v1/portal/scheduler/events/${id}/remind`,
    { idempotencyKey },
  );
}

export async function searchJobOptions(q: string, sourceApp?: ScheduleSourceApp): Promise<JobOption[]> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (sourceApp && sourceApp !== 'custom') qs.set('sourceApp', sourceApp);
  const res = await portalRequest(true)<{ options: JobOption[] }>(
    'GET',
    `/v1/portal/scheduler/job-options?${qs}`,
  );
  return res.options ?? [];
}

export async function fetchUnscheduledJobs(params: {
  q?: string;
  sourceApp?: ScheduleSourceApp;
  limit?: number;
} = {}): Promise<JobOption[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.sourceApp && params.sourceApp !== 'custom') qs.set('sourceApp', params.sourceApp);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await portalRequest(true)<{ jobs: JobOption[] }>(
    'GET',
    `/v1/portal/scheduler/unscheduled-jobs${suffix}`,
  );
  return res.jobs ?? [];
}

export async function fetchPortalAssignees(): Promise<PortalDirectoryUser[]> {
  const res = await portalRequest(true)<PortalUsersResponse>('GET', '/v1/portal/users');
  const out: PortalDirectoryUser[] = [];
  for (const entry of res.data ?? []) {
    const fieldMembership = entry.memberships.find((m) => m.app === 'installhub' && m.isActive)
      ?? entry.memberships.find((m) => m.isActive);
    if (!fieldMembership) continue;
    out.push({
      key: entry.key,
      fieldUserId: fieldMembership.fieldUserId,
      label: entry.fullName?.trim() || entry.displayEmail,
      email: entry.displayEmail,
      role: fieldMembership.role,
      appMemberships: entry.memberships
        .filter((membership) => membership.isActive)
        .map((membership) => membership.app)
        .filter((app): app is 'ecoaudit' | 'solarsense' | 'installhub' => (
          app === 'ecoaudit' || app === 'solarsense' || app === 'installhub'
        )),
    });
  }
  // Dedupe by field user id
  const seen = new Set<string>();
  return out.filter((u) => {
    if (seen.has(u.fieldUserId)) return false;
    seen.add(u.fieldUserId);
    return true;
  });
}

export async function fetchSchedulerFinanceOverview(
  options: {
    cursor?: string | null;
    limit?: number;
    sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
    sourceId?: string;
  } = {},
): Promise<FinanceOverviewPage> {
  const query = schedulerFinanceOverviewQuery(options);
  const response = await portalRequest(true)<FinanceOverviewPage>(
    'GET',
    `/v1/portal/scheduler/finance?${query}`,
  );
  return {
    items: response.items ?? [],
    nextCursor: response.nextCursor ?? null,
  };
}

export async function fetchSchedulerFinancialSummary(
  financeId: string,
): Promise<SchedulerFinancialSummary> {
  return portalRequest(true)<SchedulerFinancialSummary>(
    'GET',
    financeBase(financeId),
  );
}

export async function updateSchedulerFinance(
  financeId: string,
  input: UpdateSchedulerFinanceInput,
): Promise<SchedulerFinancialSummary> {
  return portalRequest(true)<SchedulerFinancialSummary>(
    'PUT',
    financeBase(financeId),
    input,
  );
}

export async function createSchedulerExpense(
  financeId: string,
  input: FinanceExpenseInput,
): Promise<FinanceExpense> {
  return portalRequest(true)<FinanceExpense>('POST', `${financeBase(financeId)}/expenses`, input);
}

export async function updateSchedulerExpense(
  financeId: string,
  expenseId: string,
  input: FinanceExpenseInput,
): Promise<FinanceExpense> {
  return portalRequest(true)<FinanceExpense>(
    'PATCH',
    `${financeBase(financeId)}/expenses/${encodeURIComponent(expenseId)}`,
    input,
  );
}

export async function deleteSchedulerExpense(financeId: string, expenseId: string): Promise<void> {
  return portalRequest(true)<void>(
    'DELETE',
    `${financeBase(financeId)}/expenses/${encodeURIComponent(expenseId)}`,
  );
}

export async function fetchSchedulerInvoices(financeId: string): Promise<SchedulerInvoiceListItem[]> {
  const response = await portalRequest(true)<{ items: SchedulerInvoiceListItem[] }>(
    'GET',
    `${financeBase(financeId)}/invoices`,
  );
  return response.items ?? [];
}

export async function createQuickSchedulerInvoice(
  financeId: string,
  input: QuickSchedulerInvoiceInput,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/quick`,
    input,
  );
}

export async function fetchSchedulerInvoice(
  financeId: string,
  invoiceId: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'GET',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}`,
  );
}

export async function updateSchedulerInvoice(
  financeId: string,
  invoiceId: string,
  input: UpdateSchedulerInvoiceInput,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'PATCH',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}`,
    input,
  );
}

export async function issueSchedulerInvoice(
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
    { expectedUpdatedAt },
  );
}

export async function voidSchedulerInvoice(
  financeId: string,
  invoiceId: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
  );
}

export async function markSchedulerInvoicePaid(
  financeId: string,
  invoiceId: string,
  paidAt?: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
    paidAt ? { paidAt } : {},
  );
}

export type QueuedSchedulerInvoicePdfExport = {
  jobId: string;
  reused: boolean;
  sourceUpdatedAt: string;
  reportVariantKey: string;
};

export function startSchedulerInvoicePdfExport(
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  return portalRequest(true)<QueuedSchedulerInvoicePdfExport>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/pdf/jobs`,
    { expectedUpdatedAt },
  );
}

export function getSchedulerInvoicePdfExportStatus(jobId: string): Promise<ExportJobStatus> {
  return portalRequest(true)<ExportJobStatus>(
    'GET',
    `/v1/export/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function getLatestSchedulerInvoicePdfExport(
  invoiceId: string,
  reportVariantKey: string,
): Promise<ExportJobStatus | null> {
  const query = new URLSearchParams({
    entityId: invoiceId,
    artifactType: 'pdf',
    reportVariantKey,
  });
  const response = await portalRequest(true)<{ job: ExportJobStatus | null }>(
    'GET',
    `/v1/export/jobs/latest?${query}`,
  );
  return response.job;
}

export async function downloadSchedulerInvoicePdfExport(
  job: Pick<ExportJobStatus, 'id' | 'contentType'>,
): Promise<Blob> {
  const response = await portalDownload()(
    'GET',
    `/v1/export/jobs/${encodeURIComponent(job.id)}/download`,
  );
  return response.blob.type
    ? response.blob
    : new Blob([response.blob], { type: job.contentType });
}
