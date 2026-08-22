'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelScheduleEvent,
  cancelSchedulerLeaveRequest,
  checkConsolidatedSchedulerInvoiceEligibility,
  createConsolidatedSchedulerInvoice,
  createQuickSchedulerInvoice,
  createScheduleEvent,
  createSchedulerLeaveRequest,
  createSchedulerDispatch,
  createSchedulerExpense,
  deleteSchedulerExpenseAttachment,
  deleteSchedulerExpense,
  fetchGlobalSchedulerExpenses,
  fetchGlobalSchedulerInvoice,
  fetchGlobalSchedulerInvoices,
  fetchSchedulerAnalytics,
  fetchSchedulerAddressSuggestions,
  fetchSchedulerFinancialSummary,
  fetchSchedulerFinanceOverview,
  fetchSchedulerInvoice,
  fetchSchedulerInvoiceRefunds,
  fetchSchedulerInvoiceEmailDeliveries,
  fetchSchedulerInvoices,
  fetchSchedulerPortfolioSummary,
  fetchSchedulerRouteSuggestion,
  fetchPortalAssignees,
  fetchScheduleEvents,
  fetchSchedulerLeaveRequests,
  fetchScheduleSummary,
  fetchUnscheduledJobs,
  issueGlobalSchedulerInvoice,
  issueSchedulerInvoice,
  markGlobalSchedulerInvoicePaid,
  markSchedulerInvoicePaid,
  postSchedulerInvoiceRefund,
  reviewSchedulerLeaveRequest,
  searchJobOptions,
  sendSchedulerInvoiceEmail,
  sendScheduleEventReminder,
  updateGlobalSchedulerInvoice,
  updatePortalUserBillingRate,
  updatePortalUserWorkforceProfile,
  updateSchedulerExpense,
  updateSchedulerFinance,
  updateSchedulerInvoice,
  updateScheduleEvent,
  uploadSchedulerExpenseAttachment,
  voidGlobalSchedulerInvoice,
  voidSchedulerInvoiceRefund,
  voidSchedulerInvoice,
} from '@/modules/scheduler/api/client';
import type {
  CreateScheduleEventInput,
  CreateSchedulerDispatchInput,
  FinanceExpenseInput,
  FinanceSourceApp,
  QuickSchedulerInvoiceInput,
  ScheduleSourceApp,
  SendSchedulerInvoiceEmailInput,
  UpdateSchedulerFinanceInput,
  UpdateSchedulerInvoiceInput,
  UpdateScheduleEventInput,
} from '@/modules/scheduler/types/domain';
import type {
  CreateSchedulerLeaveInput,
  ReviewSchedulerLeaveInput,
  SchedulerLeaveFilters,
} from '@/modules/scheduler/types/workforce';
import type { PostSchedulerInvoiceRefundInput } from '@/modules/scheduler/types/refunds';
import type { SchedulerAnalyticsFilters } from '@/modules/scheduler/types/analytics';
import type { SchedulerCurrentLocation } from '@/modules/scheduler/types/routing';

export const schedulerKeys = {
  all: ['portal', 'scheduler'] as const,
  summary: () => [...schedulerKeys.all, 'summary'] as const,
  events: (filters: Record<string, string | undefined>) =>
    [...schedulerKeys.all, 'events', filters] as const,
  assignees: () => [...schedulerKeys.all, 'assignees'] as const,
  jobOptions: (q: string, app?: string) =>
    [...schedulerKeys.all, 'job-options', q, app ?? ''] as const,
  unscheduled: (q: string, app?: string) =>
    [...schedulerKeys.all, 'unscheduled', q, app ?? ''] as const,
  finance: () => [...schedulerKeys.all, 'finance'] as const,
  financeOverview: () => [...schedulerKeys.finance(), 'overview'] as const,
  financeOverviewTarget: (sourceApp: string, sourceId: string) =>
    [...schedulerKeys.financeOverview(), 'target', sourceApp, sourceId] as const,
  financialSummary: (financeId: string) => [...schedulerKeys.finance(), 'summary', financeId] as const,
  portfolioSummary: () => [...schedulerKeys.finance(), 'portfolio-summary'] as const,
  globalExpenses: (filters?: Record<string, string | undefined>) => (
    filters
      ? [...schedulerKeys.finance(), 'expenses', filters] as const
      : [...schedulerKeys.finance(), 'expenses'] as const
  ),
  globalInvoices: (filters?: Record<string, string | undefined>) => (
    filters
      ? [...schedulerKeys.finance(), 'invoices', 'global', filters] as const
      : [...schedulerKeys.finance(), 'invoices', 'global'] as const
  ),
  globalInvoice: (invoiceId: string) => [...schedulerKeys.finance(), 'invoice', 'global', invoiceId] as const,
  invoices: (financeId: string) => [...schedulerKeys.finance(), 'invoices', financeId] as const,
  invoice: (financeId: string, invoiceId: string) =>
    [...schedulerKeys.invoices(financeId), invoiceId] as const,
  invoiceEmailDeliveries: (invoiceId: string) =>
    [...schedulerKeys.finance(), 'invoice-email-deliveries', invoiceId] as const,
  invoiceRefunds: (invoiceId: string) =>
    [...schedulerKeys.finance(), 'invoice-refunds', invoiceId] as const,
  analytics: (filters: SchedulerAnalyticsFilters) =>
    [...schedulerKeys.all, 'analytics', filters] as const,
  addressSuggestions: (query: string, postcode: string) =>
    [...schedulerKeys.all, 'address-suggestions', query, postcode] as const,
  route: () => [...schedulerKeys.all, 'route'] as const,
  leave: (filters: SchedulerLeaveFilters, adminView: boolean) =>
    [...schedulerKeys.all, 'leave', adminView ? 'team' : 'mine', filters] as const,
};

export function useScheduleSummary() {
  return useQuery({
    queryKey: schedulerKeys.summary(),
    queryFn: fetchScheduleSummary,
  });
}

export function useScheduleEvents(filters: {
  from?: string;
  to?: string;
  assigneeFieldUserId?: string;
  sourceApp?: ScheduleSourceApp;
}) {
  return useQuery({
    queryKey: schedulerKeys.events({
      from: filters.from,
      to: filters.to,
      assignee: filters.assigneeFieldUserId,
      app: filters.sourceApp,
    }),
    queryFn: () => fetchScheduleEvents(filters),
  });
}

export function usePortalAssignees(enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.assignees(),
    queryFn: fetchPortalAssignees,
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdatePortalUserBillingRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ globalUserId, billingRate }: {
      globalUserId: string;
      billingRate: number | null;
    }) => updatePortalUserBillingRate(globalUserId, billingRate),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: schedulerKeys.assignees() }),
        qc.invalidateQueries({ queryKey: schedulerKeys.finance() }),
      ]);
    },
  });
}

export function useUpdatePortalUserWorkforceProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ globalUserId, timezone, workingDaysMask, expectedUpdatedAt }: {
      globalUserId: string;
      timezone: string;
      workingDaysMask: number;
      expectedUpdatedAt: string;
    }) => updatePortalUserWorkforceProfile(globalUserId, {
      timezone,
      workingDaysMask,
      expectedUpdatedAt,
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: schedulerKeys.assignees() }),
        qc.invalidateQueries({ queryKey: [...schedulerKeys.all, 'analytics'] }),
      ]);
    },
  });
}

export function useJobOptions(q: string, sourceApp?: ScheduleSourceApp, enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.jobOptions(q, sourceApp),
    queryFn: () => searchJobOptions(q, sourceApp),
    enabled: enabled && q.trim().length >= 0,
    staleTime: 15_000,
  });
}

export function useSchedulerAddressSuggestions(
  input: { query?: string; postcode?: string },
  enabled = true,
) {
  const query = input.query?.trim() ?? '';
  const postcode = input.postcode?.trim() ?? '';
  return useQuery({
    queryKey: schedulerKeys.addressSuggestions(query, postcode),
    queryFn: () => fetchSchedulerAddressSuggestions({
      query: query || undefined,
      postcode: postcode || undefined,
      limit: 8,
    }),
    enabled: enabled && (query.length >= 3 || /^\d{4}$/.test(postcode)),
    staleTime: 5 * 60_000,
  });
}

export function useSchedulerRouteSuggestion() {
  return useMutation({
    mutationFn: (input: {
      date: string;
      currentLocation: SchedulerCurrentLocation;
      assigneeFieldUserId?: string;
    }) => fetchSchedulerRouteSuggestion(input),
  });
}

export function useUnscheduledJobs(
  filters: { q?: string; sourceApp?: ScheduleSourceApp } = {},
  enabled = true,
) {
  const q = filters.q ?? '';
  const app = filters.sourceApp;
  return useQuery({
    queryKey: schedulerKeys.unscheduled(q, app),
    queryFn: () => fetchUnscheduledJobs({ q, sourceApp: app, limit: 80 }),
    enabled,
    staleTime: 15_000,
  });
}

export function useCreateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleEventInput) => createScheduleEvent(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useCreateSchedulerDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSchedulerDispatchInput) => createSchedulerDispatch(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useUpdateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduleEventInput }) =>
      updateScheduleEvent(id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useCancelScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelScheduleEvent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useSendScheduleEventReminder() {
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey: string }) =>
      sendScheduleEventReminder(id, idempotencyKey),
  });
}

export function useSchedulerLeaveRequests(
  filters: SchedulerLeaveFilters = {},
  adminView = false,
) {
  return useQuery({
    queryKey: schedulerKeys.leave(filters, adminView),
    queryFn: () => fetchSchedulerLeaveRequests(filters, adminView),
  });
}

export function useCreateSchedulerLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSchedulerLeaveInput) => createSchedulerLeaveRequest(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [...schedulerKeys.all, 'leave'] });
    },
  });
}

export function useReviewSchedulerLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReviewSchedulerLeaveInput }) => (
      reviewSchedulerLeaveRequest(id, input)
    ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [...schedulerKeys.all, 'leave'] });
    },
  });
}

export function useCancelSchedulerLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedUpdatedAt, adminAction }: {
      id: string;
      expectedUpdatedAt: string;
      adminAction?: boolean;
    }) => cancelSchedulerLeaveRequest(id, expectedUpdatedAt, adminAction),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [...schedulerKeys.all, 'leave'] });
    },
  });
}

export function useSchedulerFinanceOverview(enabled = true) {
  return useInfiniteQuery({
    queryKey: schedulerKeys.financeOverview(),
    queryFn: ({ pageParam }) => fetchSchedulerFinanceOverview({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export function useSchedulerFinanceSourceTarget(
  sourceApp?: FinanceSourceApp,
  sourceId?: string,
) {
  return useQuery({
    queryKey: schedulerKeys.financeOverviewTarget(sourceApp ?? '', sourceId ?? ''),
    queryFn: () => fetchSchedulerFinanceOverview({
      limit: 1,
      sourceApp,
      sourceId,
    }),
    enabled: Boolean(sourceApp && sourceId),
  });
}

export function useSchedulerFinancialSummary(financeId: string | null) {
  return useQuery({
    queryKey: schedulerKeys.financialSummary(financeId ?? ''),
    queryFn: () => fetchSchedulerFinancialSummary(financeId ?? ''),
    enabled: Boolean(financeId),
  });
}

export function useSchedulerPortfolioSummary(enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.portfolioSummary(),
    queryFn: fetchSchedulerPortfolioSummary,
    enabled,
  });
}

export function useSchedulerAnalytics(
  filters: SchedulerAnalyticsFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: schedulerKeys.analytics(filters),
    queryFn: () => fetchSchedulerAnalytics(filters),
    enabled,
    staleTime: 60_000,
  });
}

export function useGlobalSchedulerExpenses(filters: {
  kind?: 'expense' | 'supplier_bill';
  sourceApp?: FinanceSourceApp;
  search?: string;
} = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: schedulerKeys.globalExpenses(filters),
    queryFn: ({ pageParam }) => fetchGlobalSchedulerExpenses({
      cursor: pageParam,
      limit: 100,
      ...filters,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export function useGlobalSchedulerInvoices(filters: {
  status?: 'draft' | 'issued' | 'paid' | 'void';
  sourceApp?: FinanceSourceApp;
  search?: string;
} = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: schedulerKeys.globalInvoices(filters),
    queryFn: ({ pageParam }) => fetchGlobalSchedulerInvoices({
      cursor: pageParam,
      limit: 100,
      ...filters,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}

export function useGlobalSchedulerInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: schedulerKeys.globalInvoice(invoiceId ?? ''),
    queryFn: () => fetchGlobalSchedulerInvoice(invoiceId ?? ''),
    enabled: Boolean(invoiceId),
  });
}

export function useSchedulerInvoiceEmailDeliveries(
  invoiceId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: schedulerKeys.invoiceEmailDeliveries(invoiceId),
    queryFn: async () => (await fetchSchedulerInvoiceEmailDeliveries(invoiceId)).items ?? [],
    enabled,
    refetchInterval: (query) => {
      const deliveries = query.state.data;
      return Array.isArray(deliveries)
        && deliveries.some((delivery) => (
          delivery.status === 'queued' || delivery.status === 'processing'
        ))
        ? 5_000
        : false;
    },
  });
}

export function useSchedulerInvoiceRefunds(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.invoiceRefunds(invoiceId),
    queryFn: () => fetchSchedulerInvoiceRefunds(invoiceId),
    enabled: enabled && Boolean(invoiceId),
  });
}

export function usePostSchedulerInvoiceRefund(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PostSchedulerInvoiceRefundInput) => (
      postSchedulerInvoiceRefund(invoiceId, input)
    ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: schedulerKeys.invoiceRefunds(invoiceId) }),
        qc.invalidateQueries({ queryKey: schedulerKeys.globalInvoice(invoiceId) }),
        qc.invalidateQueries({ queryKey: schedulerKeys.globalInvoices() }),
        qc.invalidateQueries({ queryKey: schedulerKeys.finance() }),
      ]);
    },
  });
}

export function useVoidSchedulerInvoiceRefund(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ refundId, expectedUpdatedAt, reason }: {
      refundId: string;
      expectedUpdatedAt: string;
      reason: string;
    }) => voidSchedulerInvoiceRefund(invoiceId, refundId, expectedUpdatedAt, reason),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: schedulerKeys.invoiceRefunds(invoiceId) }),
        qc.invalidateQueries({ queryKey: schedulerKeys.finance() }),
      ]);
    },
  });
}

export function useSendSchedulerInvoiceEmail(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendSchedulerInvoiceEmailInput) => (
      sendSchedulerInvoiceEmail(invoiceId, input)
    ),
    onSuccess: async ({ delivery }) => {
      qc.setQueryData(
        schedulerKeys.invoiceEmailDeliveries(invoiceId),
        (current: typeof delivery[] | undefined) => {
          const withoutCurrent = (current ?? []).filter((item) => item.id !== delivery.id);
          return [delivery, ...withoutCurrent];
        },
      );
      await qc.invalidateQueries({
        queryKey: schedulerKeys.invoiceEmailDeliveries(invoiceId),
      });
    },
  });
}

export function useUpdateSchedulerFinance(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSchedulerFinanceInput) => updateSchedulerFinance(financeId, input),
    onSuccess: async (summary) => {
      qc.setQueryData(schedulerKeys.financialSummary(financeId), summary);
      await qc.invalidateQueries({ queryKey: schedulerKeys.finance() });
    },
  });
}

async function invalidateSchedulerCommercialData(qc: ReturnType<typeof useQueryClient>, financeId: string) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: schedulerKeys.financeOverview() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.portfolioSummary() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.globalExpenses() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.globalInvoices() }),
    qc.invalidateQueries({ queryKey: [...schedulerKeys.finance(), 'invoice', 'global'] }),
    qc.invalidateQueries({ queryKey: schedulerKeys.financialSummary(financeId) }),
    qc.invalidateQueries({ queryKey: schedulerKeys.invoices(financeId) }),
  ]);
}

export function useCreateSchedulerExpense(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FinanceExpenseInput) => createSchedulerExpense(financeId, input),
    onSuccess: async () => invalidateSchedulerCommercialData(qc, financeId),
  });
}

export function useUpdateSchedulerExpense(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, input }: { expenseId: string; input: FinanceExpenseInput }) =>
      updateSchedulerExpense(financeId, expenseId, input),
    onSuccess: async () => invalidateSchedulerCommercialData(qc, financeId),
  });
}

export function useDeleteSchedulerExpense(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => deleteSchedulerExpense(financeId, expenseId),
    onSuccess: async () => invalidateSchedulerCommercialData(qc, financeId),
  });
}

async function invalidateGlobalSchedulerCommercialData(
  qc: ReturnType<typeof useQueryClient>,
  financeIds: string[] = [],
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: schedulerKeys.financeOverview() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.portfolioSummary() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.globalExpenses() }),
    qc.invalidateQueries({ queryKey: schedulerKeys.globalInvoices() }),
    qc.invalidateQueries({ queryKey: [...schedulerKeys.finance(), 'invoice', 'global'] }),
    ...financeIds.map((financeId) => qc.invalidateQueries({
      queryKey: schedulerKeys.financialSummary(financeId),
    })),
    ...financeIds.map((financeId) => qc.invalidateQueries({
      queryKey: schedulerKeys.invoices(financeId),
    })),
  ]);
}

export function useCreateGlobalSchedulerExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ financeId, input }: { financeId: string; input: FinanceExpenseInput }) => (
      createSchedulerExpense(financeId, input)
    ),
    onSuccess: async (expense) => invalidateGlobalSchedulerCommercialData(qc, [expense.financeId]),
  });
}

export function useUpdateGlobalSchedulerExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      financeId,
      expenseId,
      input,
    }: {
      financeId: string;
      expenseId: string;
      input: FinanceExpenseInput;
    }) => updateSchedulerExpense(financeId, expenseId, input),
    onSuccess: async (expense) => invalidateGlobalSchedulerCommercialData(qc, [expense.financeId]),
  });
}

export function useDeleteGlobalSchedulerExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ financeId, expenseId }: { financeId: string; expenseId: string }) => (
      deleteSchedulerExpense(financeId, expenseId)
    ),
    onSuccess: async (_, variables) => (
      invalidateGlobalSchedulerCommercialData(qc, [variables.financeId])
    ),
  });
}

export function useUploadSchedulerExpenseAttachment(financeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, file }: { expenseId: string; file: File }) => (
      uploadSchedulerExpenseAttachment(expenseId, file)
    ),
    onSuccess: async () => invalidateGlobalSchedulerCommercialData(
      qc,
      financeId ? [financeId] : [],
    ),
  });
}

export function useDeleteSchedulerExpenseAttachment(financeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expenseId, attachmentId }: { expenseId: string; attachmentId: string }) => (
      deleteSchedulerExpenseAttachment(expenseId, attachmentId)
    ),
    onSuccess: async () => invalidateGlobalSchedulerCommercialData(
      qc,
      financeId ? [financeId] : [],
    ),
  });
}

export function useSchedulerInvoices(financeId: string | null) {
  return useQuery({
    queryKey: schedulerKeys.invoices(financeId ?? ''),
    queryFn: () => fetchSchedulerInvoices(financeId ?? ''),
    enabled: Boolean(financeId),
  });
}

export function useSchedulerInvoice(financeId: string | null, invoiceId: string | null) {
  return useQuery({
    queryKey: schedulerKeys.invoice(financeId ?? '', invoiceId ?? ''),
    queryFn: () => fetchSchedulerInvoice(financeId ?? '', invoiceId ?? ''),
    enabled: Boolean(financeId && invoiceId),
  });
}

export function useCreateQuickSchedulerInvoice(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickSchedulerInvoiceInput) => createQuickSchedulerInvoice(financeId, input),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.invoice(financeId, invoice.id), invoice);
      await invalidateSchedulerCommercialData(qc, financeId);
    },
  });
}

export function useCheckConsolidatedSchedulerInvoiceEligibility() {
  return useMutation({
    mutationFn: (financeIds: string[]) => checkConsolidatedSchedulerInvoiceEligibility(financeIds),
  });
}

export function useCreateConsolidatedSchedulerInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConsolidatedSchedulerInvoice,
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.globalInvoice(invoice.id), invoice);
      await invalidateGlobalSchedulerCommercialData(
        qc,
        invoice.financeIds ?? [invoice.financeId],
      );
    },
  });
}

export function useUpdateGlobalSchedulerInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, input }: {
      invoiceId: string;
      input: Parameters<typeof updateGlobalSchedulerInvoice>[1];
    }) => updateGlobalSchedulerInvoice(invoiceId, input),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.globalInvoice(invoice.id), invoice);
      await invalidateGlobalSchedulerCommercialData(qc, invoice.financeIds ?? [invoice.financeId]);
    },
    onError: async () => invalidateGlobalSchedulerCommercialData(qc),
  });
}

function useGlobalInvoiceLifecycleMutation<TVariables>(
  mutationFn: (variables: TVariables) => ReturnType<typeof issueGlobalSchedulerInvoice>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.globalInvoice(invoice.id), invoice);
      await invalidateGlobalSchedulerCommercialData(qc, invoice.financeIds ?? [invoice.financeId]);
    },
    onError: async () => invalidateGlobalSchedulerCommercialData(qc),
  });
}

export function useIssueGlobalSchedulerInvoice() {
  return useGlobalInvoiceLifecycleMutation(
    ({ invoiceId, expectedUpdatedAt }: { invoiceId: string; expectedUpdatedAt: string }) => (
      issueGlobalSchedulerInvoice(invoiceId, expectedUpdatedAt)
    ),
  );
}

export function useVoidGlobalSchedulerInvoice() {
  return useGlobalInvoiceLifecycleMutation(({
    invoiceId,
    expectedUpdatedAt,
  }: {
    invoiceId: string;
    expectedUpdatedAt: string;
  }) => (
    voidGlobalSchedulerInvoice(invoiceId, expectedUpdatedAt)
  ));
}

export function useMarkGlobalSchedulerInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, expectedUpdatedAt, paidAt }: {
      invoiceId: string;
      expectedUpdatedAt: string;
      paidAt?: string;
    }) => (
      markGlobalSchedulerInvoicePaid(invoiceId, expectedUpdatedAt, paidAt)
    ),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.globalInvoice(invoice.id), invoice);
      await invalidateGlobalSchedulerCommercialData(qc, invoice.financeIds ?? [invoice.financeId]);
    },
  });
}

export function useUpdateSchedulerInvoice(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, input }: { invoiceId: string; input: UpdateSchedulerInvoiceInput }) =>
      updateSchedulerInvoice(financeId, invoiceId, input),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.invoice(financeId, invoice.id), invoice);
      await invalidateSchedulerCommercialData(qc, financeId);
    },
    onError: async () => invalidateSchedulerCommercialData(qc, financeId),
  });
}

function useInvoiceLifecycleMutation<TVariables>(
  financeId: string,
  mutationFn: (variables: TVariables) => ReturnType<typeof issueSchedulerInvoice>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.invoice(financeId, invoice.id), invoice);
      await invalidateSchedulerCommercialData(qc, financeId);
    },
    onError: async () => invalidateSchedulerCommercialData(qc, financeId),
  });
}

export function useIssueSchedulerInvoice(financeId: string) {
  return useInvoiceLifecycleMutation(
    financeId,
    ({ invoiceId, expectedUpdatedAt }: { invoiceId: string; expectedUpdatedAt: string }) => (
      issueSchedulerInvoice(financeId, invoiceId, expectedUpdatedAt)
    ),
  );
}

export function useVoidSchedulerInvoice(financeId: string) {
  return useInvoiceLifecycleMutation(financeId, ({
    invoiceId,
    expectedUpdatedAt,
  }: {
    invoiceId: string;
    expectedUpdatedAt: string;
  }) => (
    voidSchedulerInvoice(financeId, invoiceId, expectedUpdatedAt)
  ));
}

export function useMarkSchedulerInvoicePaid(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, expectedUpdatedAt, paidAt }: {
      invoiceId: string;
      expectedUpdatedAt: string;
      paidAt?: string;
    }) => markSchedulerInvoicePaid(financeId, invoiceId, expectedUpdatedAt, paidAt),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.invoice(financeId, invoice.id), invoice);
      await invalidateSchedulerCommercialData(qc, financeId);
    },
  });
}
