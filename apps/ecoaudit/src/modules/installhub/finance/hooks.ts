'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCostLine,
  deleteCostLine,
  fetchFinancialSummary,
  updateCostLine,
  upsertFinanceHeader,
} from '@/modules/installhub/finance/api';
import type { CostLineInput, UpsertFinanceHeaderInput } from '@/modules/installhub/finance/types';

export const financeKeys = {
  all: ['installhub', 'finance'] as const,
  summary: (installationId: string) =>
    [...financeKeys.all, 'summary', installationId] as const,
};

export function useFinancialSummary(installationId: string, enabled = true) {
  return useQuery({
    queryKey: financeKeys.summary(installationId),
    queryFn: () => fetchFinancialSummary(installationId),
    enabled: enabled && Boolean(installationId),
  });
}

export function useUpsertFinanceHeader(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertFinanceHeaderInput) => upsertFinanceHeader(installationId, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: financeKeys.summary(installationId) });
    },
  });
}

export function useCreateCostLine(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CostLineInput) => createCostLine(installationId, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: financeKeys.summary(installationId) });
    },
  });
}

export function useUpdateCostLine(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, input }: { lineId: string; input: Partial<CostLineInput> }) =>
      updateCostLine(installationId, lineId, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: financeKeys.summary(installationId) });
    },
  });
}

export function useDeleteCostLine(installationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteCostLine(installationId, lineId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: financeKeys.summary(installationId) });
    },
  });
}
