'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelScheduleEvent,
  createQuickSchedulerInvoice,
  createScheduleEvent,
  createSchedulerDispatch,
  createSchedulerExpense,
  deleteSchedulerExpense,
  fetchSchedulerFinancialSummary,
  fetchSchedulerFinanceOverview,
  fetchSchedulerInvoice,
  fetchSchedulerInvoices,
  fetchPortalAssignees,
  fetchScheduleEvents,
  fetchScheduleSummary,
  fetchUnscheduledJobs,
  issueSchedulerInvoice,
  markSchedulerInvoicePaid,
  searchJobOptions,
  sendScheduleEventReminder,
  updateSchedulerExpense,
  updateSchedulerFinance,
  updateSchedulerInvoice,
  updateScheduleEvent,
  voidSchedulerInvoice,
} from '@/modules/scheduler/api/client';
import type {
  CreateScheduleEventInput,
  CreateSchedulerDispatchInput,
  FinanceExpenseInput,
  FinanceSourceApp,
  QuickSchedulerInvoiceInput,
  ScheduleSourceApp,
  UpdateSchedulerFinanceInput,
  UpdateSchedulerInvoiceInput,
  UpdateScheduleEventInput,
} from '@/modules/scheduler/types/domain';

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
  invoices: (financeId: string) => [...schedulerKeys.finance(), 'invoices', financeId] as const,
  invoice: (financeId: string, invoiceId: string) =>
    [...schedulerKeys.invoices(financeId), invoiceId] as const,
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

export function useJobOptions(q: string, sourceApp?: ScheduleSourceApp, enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.jobOptions(q, sourceApp),
    queryFn: () => searchJobOptions(q, sourceApp),
    enabled: enabled && q.trim().length >= 0,
    staleTime: 15_000,
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
  return useInvoiceLifecycleMutation(financeId, (invoiceId: string) => (
    voidSchedulerInvoice(financeId, invoiceId)
  ));
}

export function useMarkSchedulerInvoicePaid(financeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, paidAt }: { invoiceId: string; paidAt?: string }) =>
      markSchedulerInvoicePaid(financeId, invoiceId, paidAt),
    onSuccess: async (invoice) => {
      qc.setQueryData(schedulerKeys.invoice(financeId, invoice.id), invoice);
      await invalidateSchedulerCommercialData(qc, financeId);
    },
  });
}
