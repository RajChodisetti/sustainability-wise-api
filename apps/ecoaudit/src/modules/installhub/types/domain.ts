import type { ExportJobStatus } from '@/types/domain';

export type InstallHubRole = 'admin' | 'inspector';
export type InstallationStatus = 'Draft' | 'Completed';
export type FormStatus = 'Draft' | 'Completed';
export type MeterDeviceType = 'A3RM' | 'A6M' | 'Other';
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
};

export type ManagedInstallHubUser = InstallHubUser & {
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Installation = {
  id: string;
  serverId?: string | null;
  clientName: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate: string;
  status: InstallationStatus;
  createdByUserId?: string | null;
  assignedInspectorUserId?: string | null;
  syncStatus?: string;
  createdAt: string;
  updatedAt: string;
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
  'Exhaust / Fan System',
  'Power Outlet',
  'Hot Water',
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
  purpose?: string;
  loadType?: string;
  rogowskiSize?: string;
  description?: string;
  ctRatio?: string;
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
  deviceName: string;
  deviceType: MeterDeviceType;
  deviceId: string;
  deviceNumber?: string | null;
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
  assetType: BoardType;
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
  electricalBoardId?: string | null;
  electricalBoardTbc: boolean;
  locationDescription?: string | null;
  locationPhoto?: string | null;
  displayCode?: string | null;
  meterPresent: boolean;
  meterSwitchboardId?: string | null;
  meterSwitchboardTbc: boolean;
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
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type InstallationTree = {
  installation: Installation;
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  formSubmissions: FormSubmission[];
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
  snapshot: InstallationTree & { syncStage?: 'metadata' | 'complete' };
};

export type InstallHubExportJob = ExportJobStatus;
