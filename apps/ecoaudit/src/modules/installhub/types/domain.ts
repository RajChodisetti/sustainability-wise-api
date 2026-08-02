import type { ExportJobStatus } from '@/types/domain';

export type InstallHubRole = 'admin' | 'inspector';
export type InstallationStatus = 'Draft' | 'Completed';
export type FormStatus = 'Draft' | 'Completed';
export type MeterDeviceType = 'A3RM' | 'A6M' | 'Other';
export type MeterDeviceModel = 'A3RM' | 'A6M' | 'OTHER';
export type ElectricalSourceKind = 'GRID' | 'BOARD' | 'TBC';
export type MeteringStateKind = 'METERED' | 'UNMETERED' | 'TBC';
export type ChannelPurpose = 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE';
export type MeasurementDirection = 'CONSUMPTION' | 'GENERATION' | 'BIDIRECTIONAL';
export type PhaseMode = 'SINGLE_PHASE' | 'THREE_PHASE' | 'OTHER';

export type DisplayCodeMetadata = {
  value: string;
  generatedValue: string;
  isOverridden: boolean;
  ruleVersion: number;
  overrideReason?: string | null;
};

export type ElectricalSource =
  | { kind: 'GRID'; gridSupplyId: string }
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'TBC' };

export type SiteAssetMeteringState =
  | { kind: 'METERED'; measurementAssignmentIds: string[] }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

export type GridSupply = {
  id: string;
  installationId: string;
  name: string;
  isDefault: boolean;
  nmi?: string | null;
  externalKey?: string | null;
};

export type MeasurementTarget =
  | { kind: 'BOARD'; boardId: string }
  | { kind: 'SITE_ASSET'; siteAssetId: string }
  | { kind: 'GRID_BOUNDARY'; gridSupplyId: string }
  | { kind: 'TBC' };

export type MeterDeviceChannel = {
  id: string;
  ordinal: number;
  phaseLabel?: string | null;
  purpose: ChannelPurpose;
  loadTypeCode?: string | null;
  customLoadTypeName?: string | null;
  sensorRating?: string | null;
  description?: string | null;
  capabilities?: Record<string, unknown>;
};

export type MeterDevice = {
  id: string;
  installationId: string;
  installedOnBoardId: string;
  deviceFamily: 'WATTWATCHERS' | 'OTHER';
  deviceModel: MeterDeviceModel;
  customManufacturerName?: string | null;
  customModelName?: string | null;
  displayName: DisplayCodeMetadata;
  serialNumber: string;
  deviceNumber?: string | null;
  lifecycleState?: 'PLANNED' | 'ACTIVE' | 'INACTIVE';
  channels: MeterDeviceChannel[];
  wwPhotos?: Record<string, unknown>;
  notes?: string | null;
};

export type MeasurementAssignment = {
  id: string;
  meterId: string;
  channelIds: string[];
  phaseMode: PhaseMode;
  target: MeasurementTarget;
  direction: MeasurementDirection;
  status: 'CONFIRMED' | 'TBC';
};

export type ReadinessIssue = {
  code: string;
  severity: 'ERROR' | 'WARNING';
  entityType:
    | 'installation'
    | 'grid_supply'
    | 'zone'
    | 'board'
    | 'site_asset'
    | 'meter'
    | 'channel'
    | 'measurement_assignment'
    | 'virtual_meter'
    | 'form';
  entityId: string;
  field?: string;
  message: string;
  candidateIds?: string[];
};

export type InstallationReadiness = {
  installationId: string;
  authority?: 'SERVER' | 'LOCAL_ADVISORY';
  locallyConsistent?: boolean;
  treeRevision: number;
  recordVersionNumber?: number;
  readyToComplete: boolean;
  eligibility: {
    draftDiagnosticReport: boolean;
    authoritativeReport: boolean;
    mappingExport: boolean;
    dataDomeDelivery: boolean;
  };
  issues: ReadinessIssue[];
  issuePage?: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
};

export type VirtualMeterDefinition = {
  id: string;
  parentNodeId: string;
  totalMeasurementAssignmentId: string;
  subtractAssignmentIds: string[];
  formulaVersion: number;
  allocation: 'UNALLOCATED_RESIDUAL';
};
export type FormType =
  | 'ww-installation'
  | 'a3rm-installation'
  | 'a6m-installation'
  | 'comms-fault'
  | 'ace-switchboard'
  | 'honeywell-q400'
  | 'captis-logger'
  | 'sums-logger';

export type InstallHubUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: InstallHubRole;
  app?: 'installhub';
  isActive?: boolean;
  sourceManaged?: boolean;
  sourceApp?: 'ecoaudit' | 'solarsense' | null;
};

export type ManagedInstallHubUser = InstallHubUser & {
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  sourceState?: 'linked' | 'orphaned' | 'explicit';
};

export type UnifiedPortalApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type UnifiedPortalSourceApp = Exclude<UnifiedPortalApp, 'installhub'>;
export type UnifiedPortalSyncStatus =
  | 'synced'
  | 'drifted'
  | 'missing_projection'
  | 'orphaned_projection'
  | 'field_only'
  | 'unlinked';

export type UnifiedPortalMembership = {
  app: UnifiedPortalApp;
  userId: string;
  identityId: string | null;
  email: string;
  fullName: string | null;
  role: InstallHubRole;
  isActive: boolean;
  isSourceProjection: boolean;
  sourceApp: UnifiedPortalSourceApp | null;
  sourceUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UnifiedPortalUser = {
  key: string;
  identityIds: string[];
  displayEmail: string;
  fullName: string | null;
  candidateKey: string | null;
  possibleDuplicateCount: number;
  memberships: UnifiedPortalMembership[];
  syncStatus: UnifiedPortalSyncStatus;
};

export type UnifiedPortalUsersResponse = {
  data: UnifiedPortalUser[];
  summary: {
    total: number;
    active: number;
    admins: number;
    needsAttention: number;
    byApp: Record<
      UnifiedPortalApp,
      {
        total: number;
        active: number;
        admins: number;
      }
    >;
    bySyncStatus: Record<UnifiedPortalSyncStatus, number>;
  };
};

export type Installation = {
  id: string;
  treeSchemaVersion?: 2;
  treeRevision?: number;
  recordVersionNumber?: number;
  serverId?: string | null;
  clientName: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate: string;
  siteCode?: string | null;
  timezone?: string | null;
  externalKey?: string | null;
  status: InstallationStatus;
  createdByUserId?: string | null;
  assignedInspectorUserId?: string | null;
  syncStatus?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  completedByUserId?: string | null;
  reopenedAt?: string | null;
  reopenedByUserId?: string | null;
  reopenReason?: string | null;
  deletedAt?: string | null;
};

export type Zone = {
  id: string;
  serverId?: string | null;
  installationId: string;
  zoneName: string;
  zoneDescription: string;
  photos: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export const BOARD_TYPES = [
  'MSB',
  'MSSB',
  'DB',
  'HVAC-DB',
  'LX-DB',
  'PV-DB',
  'MCC',
  'Other',
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const SITE_ASSET_TYPES = [
  'HVAC',
  'Lighting',
  'Solar / PV',
  'EV Charger',
  'Vehicle Hoist',
  'Forklift',
  'Exhaust / Fan System',
  'Power Outlet',
  'Heater / Geyser',
  'Refrigeration',
  'Compressed Air',
  'Other',
] as const;
export type SiteAssetType = (typeof SITE_ASSET_TYPES)[number];

export type WattwatcherPrestart = {
  siteInduction?: boolean;
  safeAccess?: boolean;
  correctPpe?: boolean;
  livePointsAware?: boolean;
  canIsolate?: boolean;
  additionalHazards?: boolean;
  safeToProceed?: boolean;
};

export type WattwatcherSwitchboard = {
  name?: string;
  location?: string;
  deviceSerial?: string;
  firmware?: string;
  antennaType?: string;
  signalStrength?: string;
  notes?: string;
};

export type WattwatcherChannel = {
  id?: string;
  ordinal?: number;
  phaseLabel?: string | null;
  purpose?: string;
  loadType?: string;
  customLoadTypeName?: string;
  rogowskiSize?: string;
  description?: string;
  ctRatio?: string;
  capabilities?: Record<string, unknown>;
};

export type WattwatcherVerification = {
  voltageChecked?: boolean;
  polarityChecked?: boolean;
  communicationsOk?: boolean;
  notes?: string;
};

export type WattwatcherCommissioning = {
  deviceOnline?: boolean;
  channelsReporting?: boolean;
  labeled?: boolean;
  photosTaken?: boolean;
  notes?: string;
};

export type WattwatcherPhotos = {
  deviceInstalled?: string | null;
  switchboardOverview?: string | null;
  labeling?: string | null;
  extra?: string[];
};

export type Meter = {
  id: string;
  deviceFamily?: 'WATTWATCHERS' | 'OTHER';
  deviceName: string;
  deviceType: MeterDeviceType;
  deviceId: string;
  deviceNumber?: string | null;
  customManufacturerName?: string | null;
  customModelName?: string | null;
  deviceNameOverridden?: boolean;
  lifecycleState?: 'PLANNED' | 'ACTIVE' | 'INACTIVE';
  notes?: string | null;
  classification?: string | null;
  coverage?: string | null;
  wwPrestart?: WattwatcherPrestart;
  wwSwitchboard?: WattwatcherSwitchboard;
  wwChannels?: WattwatcherChannel[];
  wwVerification?: WattwatcherVerification;
  wwCommissioning?: WattwatcherCommissioning;
  wwPhotos?: WattwatcherPhotos;
};

export type ElectricalAsset = {
  id: string;
  serverId?: string | null;
  installationId: string;
  zoneId: string;
  assetName: string;
  displayCode: string;
  displayCodeMeta?: DisplayCodeMetadata;
  assetType: BoardType;
  typeCode?: string;
  customTypeName?: string | null;
  electricalSource?: ElectricalSource;
  electricalParentId?: string | null;
  electricalParentTbc: boolean;
  locationDescription?: string | null;
  phase?: string | null;
  amperageRating?: string | null;
  siteNmi?: string | null;
  photo?: string | null;
  extraPhotos: string[];
  meterPresent: boolean;
  meters: Meter[];
  subCircuitsDescription?: string | null;
  comments?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type MeterChannelRef = {
  channel: string;
  description: string;
};

export type SiteAsset = {
  id: string;
  serverId?: string | null;
  installationId: string;
  zoneId: string;
  assetName: string;
  assetType: SiteAssetType;
  typeCode?: string;
  customTypeName?: string | null;
  electricalSource?: ElectricalSource;
  electricalBoardId?: string | null;
  electricalBoardTbc: boolean;
  locationDescription?: string | null;
  locationPhoto?: string | null;
  displayCode?: string | null;
  displayCodeMeta?: DisplayCodeMetadata;
  meterPresent: boolean;
  meteringState?: SiteAssetMeteringState;
  meterSwitchboardId?: string | null;
  meterSwitchboardTbc: boolean;
  meterId?: string | null;
  meterChannelIds?: string[];
  phaseMode?: PhaseMode | null;
  measurementDirection?: MeasurementDirection | null;
  meterChannels: MeterChannelRef[];
  comments?: string | null;
  extraPhotos: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type FormValue = string;

export type FormAttachment = {
  id: string;
  slot: string;
  uri: string;
  mimeType: string;
  caption?: string | null;
  capturedAt: string;
};

export type FormSubmission = {
  id: string;
  serverId?: string | null;
  installationId: string;
  formType: FormType;
  schemaVersion: number;
  status: FormStatus;
  zoneId?: string | null;
  boardId?: string | null;
  meterId?: string | null;
  siteAssetId?: string | null;
  answers: Record<string, FormValue>;
  attachments: FormAttachment[];
  completedAt?: string | null;
  supersedesId?: string | null;
  historicalMeterRemoved?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type InstallationTree = {
  treeSchemaVersion?: 2;
  baseTreeRevision?: number;
  treeRevision?: number;
  recordVersionNumber?: number;
  installation: Installation;
  gridSupplies?: GridSupply[];
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  meterDevices?: MeterDevice[];
  measurementAssignments?: MeasurementAssignment[];
  formSubmissions: FormSubmission[];
  serverDerived?: {
    virtualMeterDefinitions: VirtualMeterDefinition[];
  };
};

export type InstallationMappingExport = {
  schema: 'installation-mapping/v1';
  authority?: 'SERVER_PINNED' | 'LOCAL_ADVISORY';
  installation: {
    id: string;
    externalKey: string;
    recordVersionNumber: number;
    canonicalizerVersion: number;
    validatorVersion: number;
    taxonomyCatalogVersion: number;
    siteName: string;
    timezone: string;
    completedAt?: string;
  };
  physicalLocations: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  electricalNodes: Array<Record<string, unknown> & { id: string; kind: string }>;
  supplyEdges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
  unresolvedRelationships: Array<{
    id: string;
    subjectType: 'BOARD' | 'SITE_ASSET' | 'MEASUREMENT_ASSIGNMENT';
    subjectId: string;
    relation: 'SUPPLY' | 'MEASUREMENT';
    missingEnd: 'SOURCE' | 'TARGET';
    knownNodeId?: string;
    reason: 'TBC' | 'ORPHAN' | 'INVALID';
  }>;
  meters: Array<Record<string, unknown> & { id: string }>;
  channels: Array<Record<string, unknown> & { id: string }>;
  measurementAssignments: MeasurementAssignment[];
  assetCoverage: Array<Record<string, unknown> & { assetId: string; state: string }>;
  virtualMeters: VirtualMeterDefinition[];
  readiness: InstallationReadiness;
};

export type ElectricalTreeReadModel = {
  installationId: string;
  treeRevision: number;
  recordVersionNumber?: number;
  payloadHash?: string;
  nodes: Array<{
    id: string;
    kind: 'GRID' | 'BOARD' | 'SITE_ASSET' | 'VIRTUAL_RESIDUAL';
    name: string;
    displayCode?: string;
    typeLabel?: string;
    physicalLocationId?: string;
    coverageState?: string;
    parentNodeId?: string;
    formulaVersion?: number;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationship: 'FED_FROM' | 'MEASURES';
  }>;
  unresolved: InstallationMappingExport['unresolvedRelationships'];
};

export type InstallHubPullResponse = {
  installations: InstallationTree[];
  pulledAt: string;
};

export type InstallationAccess = {
  installationId: string;
  assignedInspectorUserId: string | null;
  assignedInspector: Pick<
    ManagedInstallHubUser,
    'id' | 'email' | 'fullName' | 'role' | 'isActive'
  > | null;
};

export type CloudStoredFile = {
  storageKey: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  lastModified: string | null;
  source: 'photo_registry' | 'report_pdf' | 'storage';
  photoId: string | null;
  parentId: string | null;
  entityType: string | null;
  entityId: string | null;
  fieldName: string | null;
  originalFilename: string | null;
  status: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
};

export type InstallationFilesResponse = {
  app: 'installhub';
  entityType: 'installation';
  installationId: string;
  installationName: string;
  prefix: string;
  files: CloudStoredFile[];
};

export type InstallationVersionSummary = {
  id: string;
  versionNumber: number;
  createdByUserId: string | null;
  createdAt: string;
};

export type InstallationVersionRecord = InstallationVersionSummary & {
  app: 'installhub';
  entityType: 'installation';
  entityId: string;
  payloadHash: string | null;
  snapshot: {
    snapshotSchema: 'InstallationCanonicalSnapshotV2';
    installationTree: InstallationTree & {
      installation: Installation & { recordVersionNumber: number };
    };
    readiness: InstallationReadiness;
    payloadHash: string;
  };
};

export type InstallHubExportJob = ExportJobStatus;

export type InstallHubReportProvenance = {
  recordVersionNumber: number;
  recordVersionPayloadHash: string;
  reportSource: 'canonical-version';
};
