export type AppId = 'solarsense' | 'ecoaudit';

export type Role = 'admin' | 'inspector' | 'service_account';

export interface AuthUser {
  id: string | null;
  email: string | null;
  fullName: string | null;
  role: Role;
  app: AppId;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Session extends TokenSet {
  user: AuthUser;
  issuedAt: number;
}

export interface LoginResponse extends TokenSet {
  user: AuthUser;
}

export interface ApiErrorBody {
  error?: string;
  statusCode?: number;
  detail?: unknown;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta?: PaginationMeta;
}

export interface StoredFile {
  storageKey: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number | null;
  lastModified: string | null;
  source: 'photo_registry' | 'report_pdf' | 'storage' | string;
  photoId: string | null;
  parentId: string | null;
  entityType: string | null;
  entityId: string | null;
  fieldName: string | null;
  originalFilename: string | null;
  status: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
}

export interface StoredFileListingResponse {
  app: AppId;
  entityType: string;
  prefix?: string;
  siteRef?: string;
  siteId?: string;
  siteName?: string;
  assessmentRef?: string;
  assessmentId?: string;
  assessmentName?: string | null;
  auditRef?: string;
  auditId?: string;
  auditName?: string;
  files: StoredFile[];
}

export interface PhotoRecord {
  id: string;
  checksum: string | null;
  remoteUrl: string | null;
  contentType: string | null;
  originalFilename: string | null;
  app: AppId;
  parentId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  fileSizeBytes: number | null;
  status: string;
  uploadedAt: string | null;
  createdAt: string | null;
}

export interface PhotoListResponse {
  siteRef?: string;
  siteId?: string;
  siteName?: string;
  auditRef?: string;
  auditId?: string;
  auditName?: string;
  data: PhotoRecord[];
}

export interface PdfJob {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | string;
  phase: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  pdfUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadSessionResponse {
  sessionId: string;
  uploadUrl: string;
  alreadyExists?: boolean;
  remoteUrl?: string;
}

export type FileTarget =
  | { app: 'solarsense'; type: 'site'; ref: string }
  | { app: 'solarsense'; type: 'assessment'; ref: string }
  | { app: 'ecoaudit'; type: 'audit'; ref: string };

export type ZipTarget =
  | { app: 'solarsense'; siteRef: string }
  | { app: 'ecoaudit'; auditRef: string };

export type PdfTarget =
  | { app: 'solarsense'; siteId: string; assessmentIds?: string[]; options?: Record<string, unknown> }
  | { app: 'ecoaudit'; auditId: string; zoneIds?: string[]; mode?: 'by-equipment' | 'by-zone' };
