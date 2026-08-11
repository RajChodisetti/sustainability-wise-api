'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchInvoice,
  issueInvoice,
  listInvoices,
  quickCreateInvoice,
  updateDraftInvoice,
  voidInvoice,
} from '@/modules/installhub/invoices/api';
import type { QuickInvoiceInput, UpdateDraftInvoiceInput } from '@/modules/installhub/invoices/types';
import { financeKeys } from '@/modules/installhub/finance/hooks';

export const invoiceKeys = {
  all: ['installhub', 'invoices'] as const,
  list: (installationId: string) => [...invoiceKeys.all, 'list', installationId] as const,
  detail: (installationId: string, invoiceId: string) =>
    [...invoiceKeys.all, 'detail', installationId, invoiceId] as const,
};

export function useInvoices(installationId: string, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.list(installationId),
    queryFn: () => listInvoices(installationId),
    enabled: enabled && Boolean(installationId),
  });
}

export function useInvoice(installationId: string, invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.detail(installationId, invoiceId),
    queryFn: () => fetchInvoice(installationId, invoiceId),
    enabled: enabled && Boolean(installationId) && Boolean(invoiceId),
  });
}

async function invalidateInvoiceQueries(
  qc: ReturnType<typeof useQueryClient>,
  installationId: string,
  invoiceId?: string,
) {
  await qc.invalidateQueries({ queryKey: invoiceKeys.list(installationId) });
  if (invoiceId) {
    await qc.invalidateQueries({ queryKey: invoiceKeys.detail(installationId, invoiceId) });
  }
  await qc.invalidateQueries({ queryKey: financeKeys.summary(installationId) });
}

export function useQuickCreateInvoice(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickInvoiceInput = {}) => quickCreateInvoice(installationId, input),
    onSuccess: async (invoice) => {
      await invalidateInvoiceQueries(qc, installationId, invoice.id);
    },
  });
}

export function useUpdateDraftInvoice(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      input,
    }: {
      invoiceId: string;
      input: UpdateDraftInvoiceInput;
    }) => updateDraftInvoice(installationId, invoiceId, input),
    onSuccess: async (invoice) => {
      await invalidateInvoiceQueries(qc, installationId, invoice.id);
    },
  });
}

export function useIssueInvoice(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => issueInvoice(installationId, invoiceId),
    onSuccess: async (invoice) => {
      await invalidateInvoiceQueries(qc, installationId, invoice.id);
    },
  });
}

export function useVoidInvoice(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => voidInvoice(installationId, invoiceId),
    onSuccess: async (invoice) => {
      await invalidateInvoiceQueries(qc, installationId, invoice.id);
    },
  });
}
