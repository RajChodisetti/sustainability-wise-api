import { fleetRequest, fleetRequestBlob } from '@/modules/fleet/api/client';
import type {
  ClientsResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  FleetBusinessClientDetailResponse,
  FleetBusinessSiteSearchItem,
  FleetBusinessSiteDetailResponse,
  FleetMeterRegisterRecord,
  FleetMeterRegisterEntriesResponse,
  FleetMeterRegisterUpdateInput,
  DeviceDetailResponse,
  DevicesResponse,
  FleetQueryFilters,
  PaginatedResponse,
  FleetReport,
  FleetRun,
  ReportDetailResponse,
  RunDetailResponse,
  TopologyBetaDocument,
  TopologyBetaSite,
  TopologyReconstructionStatus,
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

export type MeterRegisterListParams = {
  search?: string;
  limit?: number;
  offset?: number;
};

export function listMeterRegisterEntries(filters: MeterRegisterListParams = {}) {
  return fleetRequest<FleetMeterRegisterEntriesResponse>(
    'GET',
    `/v1/wattwatchers/meter-register/entries${searchParams(filters)}`,
  );
}

export function updateMeterRegisterEntry(
  entryId: string,
  input: FleetMeterRegisterUpdateInput,
) {
  return fleetRequest<FleetMeterRegisterRecord>(
    'PATCH',
    `/v1/wattwatchers/meter-register/entries/${encodeURIComponent(entryId)}`,
    input,
  );
}

export function listClients(runId?: string) {
  return fleetRequest<ClientsResponse>(
    'GET',
    `/v1/wattwatchers/clients${searchParams({ runId })}`,
  );
}

export function getBusinessClient(clientId: string) {
  return fleetRequest<FleetBusinessClientDetailResponse>(
    'GET',
    `/v1/wattwatchers/business-clients/${encodeURIComponent(clientId)}`,
  );
}

export function getBusinessSite(siteId: string) {
  return fleetRequest<FleetBusinessSiteDetailResponse>(
    'GET',
    `/v1/wattwatchers/business-sites/${encodeURIComponent(siteId)}`,
  );
}

export function searchBusinessSites(query = '', limit = 25) {
  return fleetRequest<{
    data: FleetBusinessSiteSearchItem[];
    meta: { query: string; limit: number };
  }>(
    'GET',
    `/v1/wattwatchers/business-sites${searchParams({ q: query.trim(), limit })}`,
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

export function listTopologyBetaSites() {
  return fleetRequest<{ sites: TopologyBetaSite[] }>(
    'GET',
    '/v1/wattwatchers/topology-beta/sites',
  );
}

export function getTopologyBetaSite(locationId: string, deviceIds: string[] = []) {
  return fleetRequest<TopologyBetaDocument>(
    'GET',
    `/v1/wattwatchers/topology-beta/sites/${encodeURIComponent(locationId)}/topology${searchParams({
      meters: deviceIds.length ? deviceIds.join('\n') : undefined,
    })}`,
  );
}

export function getTopologyBetaByDevices(deviceIds: string[]) {
  return fleetRequest<TopologyBetaDocument>(
    'GET',
    `/v1/wattwatchers/topology-beta/reconstruct${searchParams({ meters: deviceIds.join('\n') })}`,
  );
}

export function getTopologyReconstruction(locationId: string) {
  return fleetRequest<TopologyBetaDocument>(
    'GET',
    `/v1/wattwatchers/topology-beta/reconstructions/${encodeURIComponent(locationId)}`,
  );
}

export function startTopologyReconstruction(input: {
  locationId: string | null;
  deviceIds: string[];
}) {
  return fleetRequest<TopologyBetaDocument>(
    'POST',
    '/v1/wattwatchers/topology-beta/reconstructions/start',
    input,
  );
}

export function stopTopologyReconstruction(locationId: string) {
  return fleetRequest<{ reconstruction: TopologyReconstructionStatus }>(
    'POST',
    '/v1/wattwatchers/topology-beta/reconstructions/stop',
    { locationId },
  );
}
