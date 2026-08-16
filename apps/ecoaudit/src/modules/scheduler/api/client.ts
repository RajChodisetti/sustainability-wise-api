import {
  ApiError,
  AuthError,
  NetworkError,
  getStoredJwt as getEcoJwt,
  request as ecoRequest,
  requestDownload as ecoRequestDownload,
  tryRefreshToken as tryRefreshEcoToken,
} from '@/api/client';
import {
  getStoredJwt as getSolarJwt,
  request as solarRequest,
  requestDownload as solarRequestDownload,
  tryRefreshToken as tryRefreshSolarToken,
} from '@/modules/solar/api/client';
import {
  getStoredJwt as getInstallHubJwt,
  installHubRequest,
  installHubRequestDownload,
  tryRefreshToken as tryRefreshInstallHubToken,
} from '@/modules/installhub/api/client';
import { API_URL } from '@/lib/config';
import { schedulerFinanceOverviewQuery } from '@/modules/scheduler/lib/finance';
import type { ExportJobStatus } from '@/types/domain';
import type {
  ConsolidatedSchedulerInvoiceInput,
  CreateScheduleEventInput,
  CreateSchedulerDispatchInput,
  FinanceExpense,
  FinanceExpenseAttachment,
  FinanceExpenseInput,
  FinanceOverviewPage,
  JobOption,
  PortalDirectoryUser,
  QuickSchedulerInvoiceInput,
  ScheduleEvent,
  ScheduleReminderResponse,
  SchedulerFinancialSummary,
  SchedulerExpensePage,
  SchedulerInvoiceEligibility,
  SchedulerInvoice,
  SchedulerInvoicePage,
  SchedulerInvoiceListItem,
  SchedulerPortfolioSummary,
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

type AdminCredential = {
  token: string;
  refresh: () => Promise<string | null>;
};

function portalAdminCredential(): AdminCredential | null {
  const candidates = [
    { token: getEcoJwt(), refresh: tryRefreshEcoToken },
    { token: getSolarJwt(), refresh: tryRefreshSolarToken },
    { token: getInstallHubJwt(), refresh: tryRefreshInstallHubToken },
  ].filter((candidate): candidate is AdminCredential => Boolean(candidate.token));
  return candidates.find((candidate) => jwtRole(candidate.token) === 'admin') ?? null;
}

async function portalRawUpload<T>(
  path: string,
  file: File,
  retried = false,
): Promise<T> {
  const credential = portalAdminCredential();
  if (!credential) throw new AuthError('An administrator session is required.');
  const safeFilename = file.name
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/[\r\n]/g, '_')
    .slice(0, 180) || 'bill-attachment';
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/octet-stream',
        'x-file-content-type': file.type,
        'x-file-name': safeFilename,
      },
      body: file,
    });
  } catch (cause) {
    throw new NetworkError(cause instanceof Error ? cause.message : String(cause));
  }
  if (response.status === 401 && !retried) {
    const fresh = await credential.refresh();
    if (fresh) return portalRawUpload<T>(path, file, true);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    let detail = text;
    try {
      const body = JSON.parse(text) as { detail?: string; message?: string; error?: string };
      detail = body.detail ?? body.message ?? body.error ?? text;
    } catch {
      // Retain the server text.
    }
    throw new ApiError(detail || response.statusText, response.status, detail || undefined);
  }
  return response.json() as Promise<T>;
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

export async function fetchSchedulerPortfolioSummary(): Promise<SchedulerPortfolioSummary> {
  return portalRequest(true)<SchedulerPortfolioSummary>(
    'GET',
    '/v1/portal/scheduler/finance/portfolio-summary',
  );
}

export async function fetchGlobalSchedulerExpenses(options: {
  cursor?: string | null;
  limit?: number;
  kind?: 'expense' | 'supplier_bill';
  financeId?: string;
  sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
  search?: string;
} = {}): Promise<SchedulerExpensePage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.kind) query.set('kind', options.kind);
  if (options.financeId) query.set('financeId', options.financeId);
  if (options.sourceApp) query.set('sourceApp', options.sourceApp);
  if (options.search?.trim()) query.set('search', options.search.trim());
  const response = await portalRequest(true)<SchedulerExpensePage>(
    'GET',
    `/v1/portal/scheduler/expenses?${query}`,
  );
  return { items: response.items ?? [], nextCursor: response.nextCursor ?? null };
}

export function uploadSchedulerExpenseAttachment(
  expenseId: string,
  file: File,
): Promise<FinanceExpenseAttachment> {
  return portalRawUpload<FinanceExpenseAttachment>(
    `/v1/portal/scheduler/expenses/${encodeURIComponent(expenseId)}/attachments`,
    file,
  );
}

export async function deleteSchedulerExpenseAttachment(
  expenseId: string,
  attachmentId: string,
): Promise<void> {
  return portalRequest(true)<void>(
    'DELETE',
    `/v1/portal/scheduler/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
}

export async function downloadSchedulerExpenseAttachment(
  expenseId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await portalDownload()(
    'GET',
    `/v1/portal/scheduler/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  );
  return response.blob;
}

export async function fetchGlobalSchedulerInvoices(options: {
  cursor?: string | null;
  limit?: number;
  status?: 'draft' | 'issued' | 'paid' | 'void';
  sourceApp?: 'ecoaudit' | 'solarsense' | 'installhub';
  financeId?: string;
  search?: string;
} = {}): Promise<SchedulerInvoicePage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.status) query.set('status', options.status);
  if (options.sourceApp) query.set('sourceApp', options.sourceApp);
  if (options.financeId) query.set('financeId', options.financeId);
  if (options.search?.trim()) query.set('search', options.search.trim());
  const response = await portalRequest(true)<SchedulerInvoicePage>(
    'GET',
    `/v1/portal/scheduler/invoices?${query}`,
  );
  return { items: response.items ?? [], nextCursor: response.nextCursor ?? null };
}

export function checkConsolidatedSchedulerInvoiceEligibility(
  financeIds: string[],
): Promise<SchedulerInvoiceEligibility> {
  return portalRequest(true)<SchedulerInvoiceEligibility>(
    'POST',
    '/v1/portal/scheduler/invoices/eligibility',
    { financeIds },
  );
}

export function createConsolidatedSchedulerInvoice(
  input: ConsolidatedSchedulerInvoiceInput,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    '/v1/portal/scheduler/invoices/quick',
    input,
  );
}

export function fetchGlobalSchedulerInvoice(invoiceId: string): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'GET',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}`,
  );
}

export function updateGlobalSchedulerInvoice(
  invoiceId: string,
  input: UpdateSchedulerInvoiceInput,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'PATCH',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}`,
    input,
  );
}

export function issueGlobalSchedulerInvoice(
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}/issue`,
    { expectedUpdatedAt },
  );
}

export function voidGlobalSchedulerInvoice(
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}/void`,
    { expectedUpdatedAt },
  );
}

export function markGlobalSchedulerInvoicePaid(
  invoiceId: string,
  expectedUpdatedAt: string,
  paidAt?: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
    { expectedUpdatedAt, ...(paidAt ? { paidAt } : {}) },
  );
}

export function startGlobalSchedulerInvoicePdfExport(
  invoiceId: string,
  expectedUpdatedAt: string,
): Promise<QueuedSchedulerInvoicePdfExport> {
  return portalRequest(true)<QueuedSchedulerInvoicePdfExport>(
    'POST',
    `/v1/portal/scheduler/invoices/${encodeURIComponent(invoiceId)}/pdf/jobs`,
    { expectedUpdatedAt },
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
  expectedUpdatedAt: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
    { expectedUpdatedAt },
  );
}

export async function markSchedulerInvoicePaid(
  financeId: string,
  invoiceId: string,
  expectedUpdatedAt: string,
  paidAt?: string,
): Promise<SchedulerInvoice> {
  return portalRequest(true)<SchedulerInvoice>(
    'POST',
    `${financeBase(financeId)}/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
    { expectedUpdatedAt, ...(paidAt ? { paidAt } : {}) },
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
