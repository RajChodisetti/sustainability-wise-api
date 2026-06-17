import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalList(name: string): string[] {
  return optional(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOneDriveFolder(value: string): string {
  return value
    .trim()
    .replace(/^[a-zA-Z0-9_-]+:/, '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

const nodeEnv = optional('NODE_ENV', 'development');
const port = parseInt(optional('PORT', '3000'), 10);
const isProduction = nodeEnv === 'production';
const storageProvider = optional('STORAGE_PROVIDER', 'local').toLowerCase();
const defaultPublicBaseUrl =
  isProduction ? '' : `http://localhost:${port}`;
const publicBaseUrl = optional('PUBLIC_BASE_URL', defaultPublicBaseUrl).replace(/\/$/, '');
const allowInsecurePublicBaseUrl = optionalBool('ALLOW_INSECURE_PUBLIC_BASE_URL', false);

if (isProduction && !publicBaseUrl) {
  throw new Error('PUBLIC_BASE_URL is required in production');
}

if (isProduction && !allowInsecurePublicBaseUrl && !publicBaseUrl.startsWith('https://')) {
  throw new Error('PUBLIC_BASE_URL must use https:// in production');
}

if (!['local', 'spaces'].includes(storageProvider)) {
  throw new Error('STORAGE_PROVIDER must be either local or spaces');
}

const azure = {
  clientId: optional('AZURE_CLIENT_ID'),
  clientSecret: optional('AZURE_CLIENT_SECRET'),
  tenantId: optional('AZURE_TENANT_ID'),
  userEmail: optional('ONEDRIVE_USER_EMAIL'),
} as const;

export const config = {
  nodeEnv,
  isProduction,
  port,
  host: optional('HOST', isProduction ? '127.0.0.1' : '0.0.0.0'),
  publicBaseUrl,
  protectApiDocs: optionalBool('PROTECT_API_DOCS', isProduction),
  corsOrigins: optionalList('CORS_ORIGINS'),
  enableApiDocs: optionalBool('ENABLE_API_DOCS', !isProduction),
  allowLocalBootstrap: optionalBool('ALLOW_LOCAL_BOOTSTRAP', true),
  allowBootstrapAdminRole: optionalBool('ALLOW_LOCAL_BOOTSTRAP_ADMIN_ROLE', true),
  rateLimit: {
    max: optionalInt('RATE_LIMIT_MAX', 300),
    timeWindowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 60_000),
  },
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  storage: {
    provider: storageProvider as 'local' | 'spaces',
    localRoot: optional(
      'LOCAL_FILE_STORAGE_ROOT',
      nodeEnv === 'production'
        ? '/var/lib/sustainability-wise-api/uploads'
        : './uploads',
    ),
    maxUploadBytes: parseInt(optional('MAX_UPLOAD_BYTES', String(50 * 1024 * 1024)), 10),
    spaces: storageProvider === 'spaces'
      ? {
          region: required('SPACES_REGION'),
          endpoint: required('SPACES_ENDPOINT').replace(/\/$/, ''),
          bucket: required('SPACES_BUCKET'),
          accessKeyId: required('SPACES_ACCESS_KEY_ID'),
          secretAccessKey: required('SPACES_SECRET_ACCESS_KEY'),
        }
      : null,
  },
  registrationSecret: optional('REGISTRATION_SECRET'),
  azure,
  oneDrive: {
    ...azure,
    enabled: optionalBool('ONEDRIVE_PHOTO_BACKUP_ENABLED', false),
    photosFolder: normalizeOneDriveFolder(
      optional('ONEDRIVE_PHOTOS_FOLDER', 'SustainabilityWise/photos'),
    ),
    backupRequired: optionalBool('ONEDRIVE_BACKUP_REQUIRED', false),
  },
  puppeteerExecutablePath: optional(
    'PUPPETEER_EXECUTABLE_PATH',
    '/usr/bin/chromium-browser',
  ),
} as const;
