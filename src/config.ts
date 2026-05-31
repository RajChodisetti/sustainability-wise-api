import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const port = parseInt(optional('PORT', '3000'), 10);
const defaultPublicBaseUrl =
  nodeEnv === 'production' ? 'http://170.64.154.143' : `http://localhost:${port}`;

export const config = {
  nodeEnv,
  port,
  publicBaseUrl: optional('PUBLIC_BASE_URL', defaultPublicBaseUrl).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  storage: {
    localRoot: optional(
      'LOCAL_FILE_STORAGE_ROOT',
      nodeEnv === 'production'
        ? '/var/lib/sustainability-wise-api/uploads'
        : './uploads',
    ),
    maxUploadBytes: parseInt(optional('MAX_UPLOAD_BYTES', String(50 * 1024 * 1024)), 10),
  },
  azure: {
    clientId: optional('AZURE_CLIENT_ID'),
    clientSecret: optional('AZURE_CLIENT_SECRET'),
    tenantId: optional('AZURE_TENANT_ID'),
    userEmail: optional('ONEDRIVE_USER_EMAIL'),
  },
  puppeteerExecutablePath: optional(
    'PUPPETEER_EXECUTABLE_PATH',
    '/usr/bin/google-chrome-stable',
  ),
} as const;
