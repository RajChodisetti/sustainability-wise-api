export type CloudUser = {
  id: string;
  email: string;
  fullName?: string | null;
  role: 'admin' | 'inspector' | 'service_account';
  isActive?: boolean;
};

export type Audit = {
  id: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate?: string | null;
  status: string;
  reportPdfLocalPath?: string | null;
  reportPdfRemoteUrl?: string | null;
  createdByUserId?: string | null;
  assignedInspectorUserId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  syncStatus?: string;
};

export type Zone = {
  id: string;
  auditId: string;
  zoneName: string;
  zoneDescription?: string | null;
  photos: string[];
  photoDescs?: Record<string, unknown>;
  createdAt?: string;
};

export type EquipmentBase = {
  id: string;
  zoneId: string;
  auditId: string;
  extraNotes?: string | null;
  extraPhotos?: string[];
  photoDescs?: Record<string, unknown>;
  createdAt?: string;
  [key: string]: unknown;
};

export type PhotoRecord = {
  id: string;
  checksum?: string;
  remoteUrl?: string | null;
  fieldName?: string;
  entityId?: string;
  entityType?: string;
  originalFilename?: string;
};

export type PdfJobStatus = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  phase: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  pdfUrl: string | null;
  error: string | null;
};
