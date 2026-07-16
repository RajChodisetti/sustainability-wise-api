export type FleetRole = 'viewer' | 'admin';

export type FleetUser = {
  id: string;
  email: string;
  fullName?: string | null;
  role: FleetRole;
  app?: 'wattwatchers';
  isActive?: boolean;
};

export const FLEET_STATUSES = [
  'communicating',
  'delayed',
  'offline',
  'inactive',
  'unknown',
] as const;

export type FleetStatus = (typeof FLEET_STATUSES)[number];

export type FleetRunReference = {
  id: string;
  reportingDate: string;
  status?: string | null;
  publishedAt?: string | null;
  finishedAt?: string | null;
  delayedThresholdMinutes?: number | null;
  offlineThresholdMinutes?: number | null;
  reportOfflineThresholdHours?: number | null;
};

export type FleetSummary = {
  totalDevices: number;
  communicating: number;
  delayed: number;
  offline: number;
  inactive: number;
  unknown: number;
  reportOffline: number;
  availabilityPercent: number | null;
  reportNewlyOffline: number;
  reportRecovered: number;
  reportStillOffline: number;
  maasTotal: number;
  maasReportOffline: number;
  clientCount: number;
};

export type DashboardSummaryResponse = {
  run: FleetRunReference | null;
  summary: FleetSummary | null;
  filters?: { clientId: string | null; maas: boolean | null };
};

export type FleetTrendPoint = Pick<
  FleetSummary,
  | 'totalDevices'
  | 'communicating'
  | 'delayed'
  | 'offline'
  | 'inactive'
  | 'unknown'
  | 'reportOffline'
  | 'availabilityPercent'
  | 'reportNewlyOffline'
  | 'reportRecovered'
> & {
  runId: string;
  reportingDate: string;
  publishedAt?: string | null;
};

export type DashboardTrendsResponse = { data: FleetTrendPoint[] };

export type FleetClientReference = {
  id: string;
  code: string;
  name: string;
  isMaas: boolean;
};

export type DeviceObservation = {
  deviceId: string;
  label?: string | null;
  model?: string | null;
  installDate?: string | null;
  firmwareVersion?: string | null;
  deviceTimezone?: string | null;
  client?: FleetClientReference | null;
  status: FleetStatus;
  reportOffline?: boolean;
  reportTransition?: string | null;
  lastHeardAt?: string | null;
  latestStatusAt?: string | null;
  observedAt?: string | null;
  communicationAgeSeconds?: number | null;
  fetchStatus?: string | null;
  uninitialised?: boolean;
  commsType?: string | null;
  commsMode?: string | null;
  lastHeardVia?: string | null;
  signalQualityDbm?: number | null;
  cellQuality?: number | string | null;
  metrics?: Record<string, unknown> | null;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: { total: number; limit: number; offset: number };
};

export type DevicesResponse = PaginatedResponse<DeviceObservation> & {
  run: FleetRunReference | null;
};

export type DeviceHistoryPoint = {
  runId: string;
  reportingDate: string;
  status: FleetStatus;
  reportOffline?: boolean;
  reportTransition?: string | null;
  lastHeardAt?: string | null;
  latestStatusAt?: string | null;
  observedAt?: string | null;
  communicationAgeSeconds?: number | null;
};

export type FleetOutage = {
  id: string;
  openedAt: string;
  lastConfirmedAt?: string | null;
  recoveredAt?: string | null;
  durationSeconds?: number | null;
  open: boolean;
};

export type DeviceDetailResponse = {
  device: {
    deviceId: string;
    label?: string | null;
    model?: string | null;
    installDate?: string | null;
    firmwareVersion?: string | null;
    deviceTimezone?: string | null;
    firstSeenAt?: string | null;
    lastDiscoveredAt?: string | null;
    memberships: FleetClientReference[];
  };
  current: DeviceObservation | null;
  history: DeviceHistoryPoint[];
  outages: FleetOutage[];
};

export type FleetClient = FleetClientReference & {
  isActive?: boolean;
  totalDevices: number;
  communicating: number;
  delayed: number;
  offline: number;
  inactive: number;
  unknown: number;
  reportOffline: number;
  availabilityPercent: number | null;
  collectionStatus?: string | null;
  collectionError?: string | null;
};

export type ClientsResponse = { run: FleetRunReference | null; data: FleetClient[] };

export type FleetRun = {
  id: string;
  sourceRunKey?: string | null;
  reportingDate: string;
  status: string;
  trigger?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  publishedAt?: string | null;
  configuredClientCount: number;
  successfulClientCount: number;
  failedClientCount: number;
  totalDevices: number;
  communicating: number;
  delayed: number;
  offline: number;
  inactive: number;
  unknown: number;
  reportOffline: number;
  reportNewlyOffline: number;
  reportRecovered: number;
  requestCount: number;
  retryCount: number;
  rateLimitCount: number;
  errorCount: number;
  errorSummary?: string | null;
};

export type FleetRunClientResult = {
  id?: string;
  clientId?: string | null;
  clientCode?: string | null;
  clientName?: string | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  deviceCount?: number | null;
  requestCount?: number | null;
  retryCount?: number | null;
  rateLimitCount?: number | null;
  errorCount?: number | null;
  error?: string | null;
  [key: string]: unknown;
};

export type RunDetailResponse = { run: FleetRun; clients: FleetRunClientResult[] };

export type FleetReportSummary = Partial<
  Pick<
    FleetSummary,
    | 'totalDevices'
    | 'communicating'
    | 'delayed'
    | 'offline'
    | 'inactive'
    | 'unknown'
    | 'reportOffline'
    | 'reportNewlyOffline'
    | 'reportRecovered'
    | 'reportStillOffline'
  >
>;

export type FleetEmailDelta = {
  offlineDeviceIds?: string[];
  newlyOfflineDeviceIds?: string[];
  recoveredDeviceIds?: string[];
  previousOfflineDeviceIds?: string[];
  stateOfflineDeviceIds?: string[];
  offlineCount?: number;
  newlyOfflineCount?: number;
  recoveredCount?: number;
  previousOfflineCount?: number;
  stateOfflineCount?: number;
  collectionComplete?: boolean | null;
};

export type FleetDatabaseTransitions = {
  reportOffline?: number;
  newlyOffline?: number;
  recovered?: number;
  stillOffline?: number;
};

export type FleetReportDelivery = {
  channel?: string | null;
  status?: string | null;
  attemptedAt?: string | null;
  sentAt?: string | null;
  error?: string | null;
  emailDelta?: FleetEmailDelta | null;
};

export type FleetReport = {
  id: string;
  runId: string;
  reportingDate: string;
  status: string;
  subject?: string | null;
  generatedAt?: string | null;
  latestDelivery?: FleetReportDelivery | null;
  databaseTransitions?: FleetDatabaseTransitions | null;
  summary?: FleetReportSummary | null;
};

export type ReportDetailResponse = {
  report: FleetReport & {
    renderedHtml?: string | null;
    csvFilename?: string | null;
  };
  deliveries: FleetReportDelivery[];
};

export type FleetQueryFilters = {
  clientId?: string;
  maas?: '' | 'true' | 'false';
};
