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

/**
 * A Wattwatchers API account / collection owner. This is deliberately
 * distinct from the end-customer business client shown in placement views.
 */
export type FleetAccountReference = FleetClientReference & {
  apiKeyConfigured: boolean;
  apiKeyUpdatedAt: string | null;
};

export type FleetBusinessClientReference = {
  id: string;
  name: string;
};

export type FleetBusinessSiteReference = {
  id: string;
  name: string;
  address: string;
};

export type FleetDevicePlacement = {
  source: 'field_installation' | 'maas_assignment';
  effectiveDate: string | null;
  businessClient: FleetBusinessClientReference;
  site: FleetBusinessSiteReference | null;
};

export type FleetPlacementProvenance = {
  assignmentId: string;
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRow: number;
};

export type FleetDevicePlacementRecord = FleetDevicePlacement & {
  deviceRole: 'current' | 'existing' | 'new';
  provenance?: FleetPlacementProvenance | null;
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
  /** Retained compatibility alias for the primary Fleet account. */
  fleetAccounts?: FleetAccountReference[];
  /** Actual customer/site placement, when an exact relationship is known. */
  currentPlacement?: FleetDevicePlacement | null;
  placementConflict?: boolean;
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

export type FleetInstallationPaths = {
  overview: string;
  electricalMap: string;
  report: string;
  clientReport: string;
  cloud?: string;
  meter?: string | null;
};

export type FleetRelatedInstallation = {
  id: string;
  jobId?: string | null;
  siteId?: string | null;
  siteCode?: string | null;
  siteName: string;
  status: string;
  completedAt?: string | null;
  electricalMapLayoutConfigured?: boolean;
  paths: FleetInstallationPaths;
};

export type FleetRelatedJob = {
  id: string;
  siteId: string;
  jobType: string;
  title: string;
  status: string;
  sourceApp: string;
  sourceType: string;
  sourceId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FleetFieldMeter = {
  id: string;
  installationId: string;
  installedOnBoardId: string;
  zoneId?: string | null;
  zoneName?: string | null;
  boardName?: string | null;
  customName: string;
  deviceFamily: string;
  deviceModel: string;
  deviceNumber?: string | null;
  serialNumber: string;
  displayCode?: string | null;
};

export type FleetFieldFormReference = {
  id: string;
  formType: string;
  status: string;
  completedAt?: string | null;
  path: string;
};

export type FleetMeterHistoryEvent = {
  id: string;
  operation: string;
  fromRecordVersionNumber?: number | null;
  toRecordVersionNumber?: number | null;
  restoredFromRecordVersionNumber?: number | null;
  createdAt: string;
};

export type FleetInventoryMovement = {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus: string;
  installationId?: string | null;
  meterId?: string | null;
  occurredAt: string;
};

export type FleetInventoryRecord = {
  id: string;
  deviceId: string;
  deviceModel: string;
  customManufacturerName?: string | null;
  customModelName?: string | null;
  status: string;
  installedInstallationId?: string | null;
  installedMeterId?: string | null;
  businessClientId?: string | null;
  businessSiteId?: string | null;
  businessJobId?: string | null;
  revision?: number;
  movements?: FleetInventoryMovement[];
};

export type FleetRegisterEvidence = {
  id: string;
  sourceKey?: string | null;
  sourceWorkbook?: string | null;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  status?: string | null;
  customerName?: string | null;
  fleetAccountName?: string | null;
  siteAddress?: string | null;
  jobNumber?: string | null;
  jobCompletionDate?: string | null;
  jobCompletedBy?: string | null;
  matchedRoles?: Array<'current' | 'existing' | 'new'>;
  existingDeviceIdentifier?: string | null;
  newDeviceIdentifier?: string | null;
  currentDeviceIdentifier?: string | null;
  maas?: boolean | null;
  dataEnabled?: boolean | null;
  productName?: string | null;
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
  fleetAccounts?: FleetAccountReference[];
  currentPlacement?: FleetDevicePlacement | null;
  placementConflict?: boolean;
  placements?: FleetDevicePlacementRecord[];
  inventory?: FleetInventoryRecord | null;
  fieldMeter?: FleetFieldMeter | null;
  fieldInstallation?: FleetRelatedInstallation | null;
  registerEvidence?: FleetRegisterEvidence[];
  fieldForms?: FleetFieldFormReference[];
  meterHistory?: FleetMeterHistoryEvent[];
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
  apiKeyConfigured: boolean;
  apiKeyUpdatedAt?: string | null;
};

export type ClientsResponse = { run: FleetRunReference | null; data: FleetClient[] };

export type FleetDeviceStatusSummary = {
  totalDevices: number;
  communicating: number;
  delayed: number;
  offline: number;
  inactive: number;
  unknown: number;
  notCollected: number;
  reportOffline: number;
};

export type FleetBusinessClient = FleetBusinessClientReference & {
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  updatedAt?: string | null;
};

export type FleetBusinessSite = FleetBusinessSiteReference & {
  clientId: string;
  locality?: string | null;
  state?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  accessInformation?: string | null;
  updatedAt?: string | null;
};

export type FleetBusinessSiteSummary = FleetBusinessSite & {
  jobCount: number;
  installationCount: number;
  status: FleetDeviceStatusSummary;
};

export type FleetRelatedDevice = Pick<
  DeviceObservation,
  | 'deviceId'
  | 'label'
  | 'model'
  | 'status'
  | 'fetchStatus'
  | 'reportOffline'
  | 'lastHeardAt'
  | 'currentPlacement'
  | 'placementConflict'
>;

export type FleetBusinessClientDetailResponse = {
  client: FleetBusinessClient;
  summary: FleetDeviceStatusSummary & {
    siteCount: number;
    jobCount: number;
    installationCount: number;
  };
  sites: FleetBusinessSiteSummary[];
  jobs: FleetRelatedJob[];
  installations: FleetRelatedInstallation[];
  devices: FleetRelatedDevice[];
};

export type FleetBusinessSiteDetailResponse = {
  site: FleetBusinessSite;
  client: FleetBusinessClientReference;
  summary: FleetDeviceStatusSummary & {
    jobCount: number;
    installationCount: number;
  };
  jobs: FleetRelatedJob[];
  installations: FleetRelatedInstallation[];
  devices: FleetRelatedDevice[];
};

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

export type TopologyBetaSite = {
  locationId: string;
  name: string;
  clientCode: string;
  mappingRevision: number;
  meterCount: number;
  latestDecision: string;
  latestRunId?: string | null;
};

export type TopologyBetaNodeState = 'CONFIDENT' | 'REVIEW' | 'WAITING';

export type TopologyBetaNode = {
  meterId: string;
  deviceId: string;
  label: string;
  deviceLabel?: string | null;
  role?: string | null;
  phase?: string | null;
  telemetryStatus?: string | null;
  validSampleCount?: number | null;
  validFraction?: number | null;
  state: TopologyBetaNodeState;
};

export type TopologyBetaEdge = {
  parent: string;
  child: string;
  state: 'CONFIDENT' | 'REVIEW';
  confidenceLabel: string;
  confidenceValue?: number | null;
  topKInclusionWeight?: number | null;
  bootstrapStability?: number | null;
  overlapSampleCount?: number | null;
  provenance?: string | null;
};

export type TopologyReconstructionStatus = {
  locationId: string;
  state: 'RUNNING' | 'STOPPING' | 'PAUSED' | 'IDLE' | string;
  startedAt?: number | null;
  stoppedAt?: number | null;
  completedCycleCount?: number;
  lastRunId?: string | null;
  lastDecision?: string | null;
  lastErrorCode?: string | null;
  cadenceSeconds?: number;
  job?: {
    desiredState?: string;
    phase?: string;
    activeRunId?: string | null;
    nextRunAt?: number | null;
    lastErrorCode?: string | null;
    consecutiveFailures?: number;
  };
};

export type TopologyBetaDocument = {
  schemaVersion: number;
  surface: 'BETA_REVIEW_ONLY';
  location: {
    locationId: string;
    name?: string;
    clientCode: string;
    rootMeterId?: string | null;
    mappingRevision?: number;
  };
  runId?: string | null;
  generatedAt?: string | null;
  decision: string;
  continueCollecting?: boolean | null;
  publicationStatus: string;
  publicHierarchyAvailable: boolean;
  nodes: TopologyBetaNode[];
  edges: TopologyBetaEdge[];
  unresolvedMeterIds: string[];
  unknownRequestedMeters: string[];
  summary: {
    selectedMeterCount: number;
    confidentRelationCount: number;
    reviewRelationCount: number;
    unresolvedMeterCount: number;
    withheldCandidateCount: number;
  };
  thresholds: {
    minimumTopKInclusion: number;
    minimumBootstrapStability: number;
    minimumLowTopKInclusion: number;
    minimumLowBootstrapStability: number;
    minimumLowOverlapSamples: number;
  };
  disclaimer: string;
  reconstruction?: TopologyReconstructionStatus;
};
