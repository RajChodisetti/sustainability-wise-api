export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict';

export type Switchboard = {
  panelNameId?: string;
  locationInBuilding?: string;
  incomingSupplyVoltage?: string;
  mainBreakerRating?: string;
  spareBreakers?: string;
  photoUri?: string;
};

export type OtherConsideration = {
  issue?: string;
  details?: string;
  photoUris?: string[];
};

export type AppendixItem = {
  type: 'image' | 'document';
  uri: string;
  name: string;
};

export type Site = {
  id: string;
  serverId?: string | null;
  syncStatus?: SyncStatus;
  status: 'Draft' | 'Completed';
  syncEnabled?: boolean;
  updatedAt: string;
  deletedAt?: string | null;
  siteName: string;
  location?: string | null;
  dateOfAssessment?: string | null;
  documentClassification?: string | null;
  electricalInfrastructureSummary?: string | null;
  knownConstraints?: string | null;
  loadProfileMeteringSummary?: string | null;
  ppaAssetDemarcation?: string | null;
  appendixNotes?: string | null;
  appendixItems?: AppendixItem[];
  reportPdfLocalPath?: string | null;
  reportPdfRemoteUrl?: string | null;
  reportPdfDownloadedAt?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  isImportedCopy?: boolean;
  importSourceServerId?: string | null;
  copyIndex?: number | null;
};

export type RooftopAssessment = {
  id: string;
  serverId?: string | null;
  syncStatus?: SyncStatus;
  status: 'Draft' | 'Completed';
  updatedAt: string;
  deletedAt?: string | null;
  siteId?: string | null;
  siteName: string;
  buildingIdName: string;
  heritageStatus?: string | null;
  heritageDealBreaker: boolean;
  aerialPhotoUri?: string | null;
  roofAreaTotalM2?: number | null;
  roofMaterial?: string | null;
  roofFramingType?: string | null;
  roofPitchAngle?: string | null;
  roofConstructionMaterial?: string | null;
  asbestosFlag: boolean;
  roofCondition?: 'Good' | 'Fair' | 'Poor' | string | null;
  roofEstimatedAge?: string | null;
  roofOrientationPrimary?: string | null;
  roofShadingSources?: string | null;
  roofShadingUsablePct?: string | null;
  roofOrientationShading?: string | null;
  structuralFeasibility?: string | null;
  structuralRiskFlag: boolean;
  roofAreaUsableM2?: number | null;
  pvSizeKwDc?: number | null;
  acExportKw?: number | null;
  accessSafetyConstraints?: string | null;
  switchboards: Switchboard[];
  msbDetails?: string | null;
  msbPhotoUri?: string | null;
  existingGeneration?: string | null;
  distanceToConnectionM?: number | null;
  electricalPitsEntry?: string | null;
  inverterSiting?: string | null;
  transformerSupplyCapacity?: string | null;
  dnspConstraints?: string | null;
  loadProfileMetering?: string | null;
  otherConsiderations: OtherConsideration[];
  siteRepFeedback?: string | null;
  viabilityStatus?: 'Yes' | 'No' | 'TBD' | string | null;
  dealBreakerReason?: string | null;
  ragPriority?: 'Green' | 'Amber' | 'Red' | string | null;
  keyAssumptionsGaps?: string | null;
  additionalPhotos: string[];
  photoMetadata: Record<string, unknown>;
  createdByUserId?: string | null;
  createdAt: string;
};

export type DashboardMetrics = {
  siteCount: number;
  assessmentCount: number;
  viableCount: number;
  tbdCount: number;
  excludedCount: number;
  totalAcKw: number;
  totalPotentialAcKw: number;
  ragGreen: number;
  ragAmber: number;
  ragRed: number;
  siteCapacity: { siteId?: string | null; siteName: string; viableKw: number; buildingCount: number }[];
};

export type CloudUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive?: boolean;
  createdAt?: string;
};

export type SiteInput = Partial<Omit<Site, 'id' | 'createdAt' | 'updatedAt'>> & {
  siteName: string;
};

export type AssessmentInput = Partial<Omit<RooftopAssessment, 'id' | 'createdAt' | 'updatedAt'>> & {
  siteName: string;
  buildingIdName: string;
};
