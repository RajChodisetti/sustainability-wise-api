import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getDashboardTrends,
  getBusinessClient,
  getBusinessSite,
  getDevice,
  getReport,
  getRun,
  listClients,
  listDevices,
  listReports,
  listRuns,
  removeClientApiKey,
  saveClientApiKey,
  type DeviceListParams,
} from '@/modules/fleet/api/fleet';
import type { FleetQueryFilters } from '@/modules/fleet/types/domain';

export function useFleetSummary(filters: FleetQueryFilters & { runId?: string } = {}) {
  return useQuery({
    queryKey: ['wattwatchers', 'dashboard', 'summary', filters],
    queryFn: () => getDashboardSummary(filters),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useFleetTrends(
  filters: FleetQueryFilters & { from?: string; to?: string } = {},
) {
  return useQuery({
    queryKey: ['wattwatchers', 'dashboard', 'trends', filters],
    queryFn: () => getDashboardTrends(filters),
    staleTime: 5 * 60_000,
  });
}

export function useFleetDevices(filters: DeviceListParams = {}) {
  return useQuery({
    queryKey: ['wattwatchers', 'devices', filters],
    queryFn: () => listDevices(filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useFleetDevice(deviceId: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'devices', deviceId],
    queryFn: () => getDevice(deviceId),
    enabled: Boolean(deviceId),
    staleTime: 60_000,
  });
}

export function useFleetClients(runId?: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'clients', runId ?? 'latest'],
    queryFn: () => listClients(runId),
    staleTime: 2 * 60_000,
  });
}

export function useFleetBusinessClient(clientId: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'business-clients', clientId],
    queryFn: () => getBusinessClient(clientId),
    enabled: Boolean(clientId),
    staleTime: 2 * 60_000,
  });
}

export function useFleetBusinessSite(siteId: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'business-sites', siteId],
    queryFn: () => getBusinessSite(siteId),
    enabled: Boolean(siteId),
    staleTime: 2 * 60_000,
  });
}

export function useSaveFleetClientApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, apiKey }: { clientId: string; apiKey: string }) => (
      saveClientApiKey(clientId, apiKey)
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wattwatchers', 'clients'] }),
  });
}

export function useRemoveFleetClientApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => removeClientApiKey(clientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wattwatchers', 'clients'] }),
  });
}

export function useFleetRuns(filters: { limit?: number; offset?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['wattwatchers', 'runs', filters],
    queryFn: () => listRuns(filters),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useFleetRun(runId: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'runs', runId],
    queryFn: () => getRun(runId),
    enabled: Boolean(runId),
  });
}

export function useFleetReports(filters: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['wattwatchers', 'reports', filters],
    queryFn: () => listReports(filters),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
}

export function useFleetReport(reportId: string) {
  return useQuery({
    queryKey: ['wattwatchers', 'reports', reportId],
    queryFn: () => getReport(reportId),
    enabled: Boolean(reportId),
  });
}
