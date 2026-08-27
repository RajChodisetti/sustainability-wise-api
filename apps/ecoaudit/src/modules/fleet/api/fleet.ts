import { fleetRequest, fleetRequestBlob } from '@/modules/fleet/api/client';
import type {
  ClientsResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  DeviceDetailResponse,
  DevicesResponse,
  FleetQueryFilters,
  PaginatedResponse,
  FleetReport,
  FleetRun,
  ReportDetailResponse,
  RunDetailResponse,
} from '@/modules/fleet/types/domain';

function searchParams(input: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getDashboardSummary(filters: FleetQueryFilters & { runId?: string } = {}) {
  return fleetRequest<DashboardSummaryResponse>(
    'GET',
    `/v1/wattwatchers/dashboard/summary${searchParams(filters)}`,
  );
}

export function getDashboardTrends(
  filters: FleetQueryFilters & { from?: string; to?: string } = {},
) {
  return fleetRequest<DashboardTrendsResponse>(
    'GET',
    `/v1/wattwatchers/dashboard/trends${searchParams(filters)}`,
  );
}

export type DeviceListParams = FleetQueryFilters & {
  status?: string;
  q?: string;
  model?: string;
  reportOffline?: '' | 'true' | 'false';
  limit?: number;
  offset?: number;
  sort?: 'lastHeardAt' | 'communicationAge' | 'label';
  direction?: 'asc' | 'desc';
};

export function listDevices(filters: DeviceListParams = {}) {
  return fleetRequest<DevicesResponse>(
    'GET',
    `/v1/wattwatchers/devices${searchParams(filters)}`,
  );
}

export function getDevice(deviceId: string, historyLimit = 90) {
  return fleetRequest<DeviceDetailResponse>(
    'GET',
    `/v1/wattwatchers/devices/${encodeURIComponent(deviceId)}${searchParams({ historyLimit })}`,
  );
}

export function listClients(runId?: string) {
  return fleetRequest<ClientsResponse>(
    'GET',
    `/v1/wattwatchers/clients${searchParams({ runId })}`,
  );
}

export function saveClientApiKey(clientId: string, apiKey: string) {
  return fleetRequest<{ clientId: string; apiKeyConfigured: true; apiKeyUpdatedAt: string }>(
    'PUT',
    `/v1/wattwatchers/clients/${encodeURIComponent(clientId)}/api-key`,
    { apiKey },
  );
}

export function removeClientApiKey(clientId: string) {
  return fleetRequest<void>(
    'DELETE',
    `/v1/wattwatchers/clients/${encodeURIComponent(clientId)}/api-key`,
  );
}

export function listRuns(filters: { limit?: number; offset?: number; status?: string } = {}) {
  return fleetRequest<PaginatedResponse<FleetRun>>(
    'GET',
    `/v1/wattwatchers/runs${searchParams(filters)}`,
  );
}

export function getRun(runId: string) {
  return fleetRequest<RunDetailResponse>(
    'GET',
    `/v1/wattwatchers/runs/${encodeURIComponent(runId)}`,
  );
}

export function listReports(filters: { limit?: number; offset?: number } = {}) {
  return fleetRequest<PaginatedResponse<FleetReport>>(
    'GET',
    `/v1/wattwatchers/reports${searchParams(filters)}`,
  );
}

export function getReport(reportId: string) {
  return fleetRequest<ReportDetailResponse>(
    'GET',
    `/v1/wattwatchers/reports/${encodeURIComponent(reportId)}`,
  );
}

export function downloadReportCsv(reportId: string, filters: FleetQueryFilters = {}) {
  return fleetRequestBlob(
    `/v1/wattwatchers/reports/${encodeURIComponent(reportId)}.csv${searchParams(filters)}`,
  );
}
