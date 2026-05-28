import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
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
