import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertStorageIsolationPolicy } from './storage/storageIsolationPolicy.js';

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

function resolvePuppeteerExecutablePath(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return '/usr/bin/chromium-browser';
}


export function parseUploadCapabilityTtlSeconds(value: string | undefined): number {
  if (value === undefined) return 15 * 60;
  if (!/^\d+$/.test(value)) {
    throw new Error('UPLOAD_CAPABILITY_TTL_SECONDS must be an integer between 1 and 3600');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 60 * 60) {
    throw new Error('UPLOAD_CAPABILITY_TTL_SECONDS must be an integer between 1 and 3600');
  }
  return parsed;
}

export function parseFileCapabilityTtlSeconds(value: string | undefined): number {
  if (value === undefined) return 5 * 60;
  if (!/^\d+$/.test(value)) {
    throw new Error('FILE_CAPABILITY_TTL_SECONDS must be an integer between 1 and 3600');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 60 * 60) {
    throw new Error('FILE_CAPABILITY_TTL_SECONDS must be an integer between 1 and 3600');
  }
  return parsed;
}

export function parseSchedulerInvoiceGstRate(value: string | undefined): number {
  const parsed = Number(value ?? '0.10');
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('SCHEDULER_INVOICE_GST_RATE must be a number between 0 and 1');
  }
  return parsed;
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
const storageWriteMode = optional('STORAGE_WRITE_MODE', 'legacy').toLowerCase();
const defaultPublicBaseUrl =
  isProduction ? '' : `http://localhost:${port}`;
const publicBaseUrl = optional('PUBLIC_BASE_URL', defaultPublicBaseUrl).replace(/\/$/, '');
const allowInsecurePublicBaseUrl = optionalBool('ALLOW_INSECURE_PUBLIC_BASE_URL', false);
const jwtSecret = required('JWT_SECRET');
// JWT_SECRET fallback keeps mixed-version rollbacks bootable. Production should
// configure a distinct UPLOAD_CAPABILITY_SECRET.
const uploadCapabilitySecret = optional('UPLOAD_CAPABILITY_SECRET', jwtSecret);
const uploadCapabilityTtlSeconds = parseUploadCapabilityTtlSeconds(
  process.env.UPLOAD_CAPABILITY_TTL_SECONDS,
);
const fileCapabilitySecret = optional(
  'FILE_CAPABILITY_SECRET',
  uploadCapabilitySecret,
);
const fileCapabilityTtlSeconds = parseFileCapabilityTtlSeconds(
  process.env.FILE_CAPABILITY_TTL_SECONDS,
);

if (isProduction && !publicBaseUrl) {
  throw new Error('PUBLIC_BASE_URL is required in production');
}

if (isProduction && !allowInsecurePublicBaseUrl && !publicBaseUrl.startsWith('https://')) {
  throw new Error('PUBLIC_BASE_URL must use https:// in production');
}

if (!['local', 'spaces'].includes(storageProvider)) {
  throw new Error('STORAGE_PROVIDER must be either local or spaces');
}

if (!['legacy', 'dual', 'isolated'].includes(storageWriteMode)) {
  throw new Error('STORAGE_WRITE_MODE must be legacy, dual, or isolated');
}

if (!uploadCapabilitySecret) {
  throw new Error('UPLOAD_CAPABILITY_SECRET must not be empty');
}

if (!fileCapabilitySecret) {
  throw new Error('FILE_CAPABILITY_SECRET must not be empty');
}

const azure = {
  clientId: optional('AZURE_CLIENT_ID'),
  clientSecret: optional('AZURE_CLIENT_SECRET'),
  tenantId: optional('AZURE_TENANT_ID'),
  userEmail: optional('ONEDRIVE_USER_EMAIL'),
} as const;

type StorageProvider = 'local' | 'spaces';
type StorageApp = 'ecoaudit' | 'solarsense' | 'installhub';

type LocalStorageDestination = {
  provider: 'local';
  localRoot: string;
  spaces: null;
};

type SpacesStorageDestination = {
  provider: 'spaces';
  localRoot: null;
  spaces: {
    region: string;
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
};

type StorageDestination = LocalStorageDestination | SpacesStorageDestination;

function appStorageDestination(
  envPrefix: 'ECOAUDIT' | 'SOLARSENSE' | 'INSTALLHUB',
): StorageDestination | null {
  const rawProvider = process.env[`${envPrefix}_STORAGE_PROVIDER`]?.trim().toLowerCase();
  if (!rawProvider) return null;
  if (rawProvider !== 'local' && rawProvider !== 'spaces') {
    throw new Error(`${envPrefix}_STORAGE_PROVIDER must be local or spaces`);
  }
  if (rawProvider === 'local') {
    return {
      provider: 'local',
      localRoot: required(`${envPrefix}_LOCAL_FILE_STORAGE_ROOT`),
      spaces: null,
    };
  }
  return {
    provider: 'spaces',
    localRoot: null,
    spaces: {
      region: required(`${envPrefix}_SPACES_REGION`),
      endpoint: required(`${envPrefix}_SPACES_ENDPOINT`).replace(/\/$/, ''),
      bucket: required(`${envPrefix}_SPACES_BUCKET`),
      accessKeyId: required(`${envPrefix}_SPACES_ACCESS_KEY_ID`),
      secretAccessKey: required(`${envPrefix}_SPACES_SECRET_ACCESS_KEY`),
    },
  };
}

const appStorageDestinations = {
  ecoaudit: appStorageDestination('ECOAUDIT'),
  solarsense: appStorageDestination('SOLARSENSE'),
  installhub: appStorageDestination('INSTALLHUB'),
} satisfies Record<StorageApp, StorageDestination | null>;

assertStorageIsolationPolicy({
  writeMode: storageWriteMode as 'legacy' | 'dual' | 'isolated',
  isProduction,
  legacy: storageProvider === 'spaces'
    ? {
        provider: 'spaces',
        identity: `spaces:${required('SPACES_ENDPOINT').replace(/\/$/, '')}:${required('SPACES_BUCKET')}`,
        accessKeyId: required('SPACES_ACCESS_KEY_ID'),
      }
    : {
        provider: 'local',
        identity: `local:${resolve(optional(
          'LOCAL_FILE_STORAGE_ROOT',
          nodeEnv === 'production'
            ? '/var/lib/sustainability-wise-api/uploads'
            : './uploads',
        ))}`,
      },
  apps: Object.fromEntries(
    Object.entries(appStorageDestinations).map(([app, destination]) => [
      app,
      destination
        ? destination.provider === 'spaces'
          ? {
              provider: 'spaces',
              identity: `spaces:${destination.spaces.endpoint}:${destination.spaces.bucket}`,
              accessKeyId: destination.spaces.accessKeyId,
            }
          : {
              provider: 'local',
              identity: `local:${resolve(destination.localRoot)}`,
            }
        : null,
    ]),
  ) as Record<StorageApp, {
    provider: 'local' | 'spaces';
    identity: string;
    accessKeyId?: string;
  } | null>,
});

export const config = {
  nodeEnv,
  isProduction,
  port,
  host: optional('HOST', isProduction ? '127.0.0.1' : '0.0.0.0'),
  publicBaseUrl,
  protectApiDocs: optionalBool('PROTECT_API_DOCS', isProduction),
  corsOrigins: optionalList('CORS_ORIGINS'),
  enableApiDocs: optionalBool('ENABLE_API_DOCS', !isProduction),
  allowLocalBootstrap: optionalBool('ALLOW_LOCAL_BOOTSTRAP', false),
  allowLegacyBootstrapUpsert: optionalBool('ALLOW_LEGACY_BOOTSTRAP_UPSERT', false),
  allowLegacySharedRegistrationSecret: optionalBool(
    'ALLOW_LEGACY_SHARED_REGISTRATION_SECRET',
    false,
  ),
  installhubCanonicalV2Enabled: optionalBool(
    'INSTALLHUB_CANONICAL_V2_ENABLED',
    !isProduction,
  ),
  // Production starts in the additive compatibility window so the API can be
  // deployed before the minimum iOS version is enforced. QA/test are strict.
  installhubUploadRevisionCasRequired: optionalBool(
    'INSTALLHUB_UPLOAD_REVISION_CAS_REQUIRED',
    !isProduction,
  ),
  /** Seller branding + GST for InstallHub tax invoices. */
  installhubInvoice: {
    sellerName: optional('IH_INVOICE_SELLER_NAME', 'Sustainability Wise'),
    sellerAbn: optional('IH_INVOICE_SELLER_ABN', ''),
    sellerAddress: optional('IH_INVOICE_SELLER_ADDRESS', ''),
    sellerEmail: optional('IH_INVOICE_SELLER_EMAIL', ''),
    dueDays: Math.max(0, optionalInt('IH_INVOICE_DUE_DAYS', 14)),
    gstRate: (() => {
      const raw = optional('IH_INVOICE_GST_RATE', '0.10');
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 0.1;
    })(),
  },
  /** Cross-app Scheduler commercial defaults; all wire amounts are ex-GST. */
  schedulerFinance: {
    defaultCostRate: (() => {
      const raw = optional('SCHEDULER_LABOUR_COST_RATE', '75');
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 75;
    })(),
    defaultBillableRate: (() => {
      const raw = optional('SCHEDULER_LABOUR_BILLABLE_RATE', '150');
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 150;
    })(),
    billAttachmentMaxBytes: Math.max(1, Math.min(
      25 * 1024 * 1024,
      optionalInt('SCHEDULER_BILL_ATTACHMENT_MAX_BYTES', 10 * 1024 * 1024),
    )),
  },
  schedulerInvoice: {
    sellerName: optional(
      'SCHEDULER_INVOICE_SELLER_NAME',
      optional('IH_INVOICE_SELLER_NAME', 'Sustainability Wise'),
    ),
    sellerAbn: optional('SCHEDULER_INVOICE_SELLER_ABN', optional('IH_INVOICE_SELLER_ABN', '')),
    sellerAddress: optional(
      'SCHEDULER_INVOICE_SELLER_ADDRESS',
      optional('IH_INVOICE_SELLER_ADDRESS', ''),
    ),
    sellerEmail: optional(
      'SCHEDULER_INVOICE_SELLER_EMAIL',
      optional('IH_INVOICE_SELLER_EMAIL', ''),
    ),
    dueDays: Math.max(0, optionalInt(
      'SCHEDULER_INVOICE_DUE_DAYS',
      optionalInt('IH_INVOICE_DUE_DAYS', 14),
    )),
    gstRate: parseSchedulerInvoiceGstRate(optional(
        'SCHEDULER_INVOICE_GST_RATE',
        optional('IH_INVOICE_GST_RATE', '0.10'),
      )),
  },
  rateLimit: {
    max: optionalInt('RATE_LIMIT_MAX', 300),
    timeWindowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 60_000),
  },
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  uploadCapability: {
    secret: uploadCapabilitySecret,
    ttlSeconds: uploadCapabilityTtlSeconds,
    allowLegacyUnsigned: optionalBool('ALLOW_LEGACY_UNSIGNED_UPLOADS', false),
  },
  fileCapability: {
    secret: fileCapabilitySecret,
    ttlSeconds: fileCapabilityTtlSeconds,
    allowLegacyPublic: optionalBool('ALLOW_LEGACY_PUBLIC_FILES', false),
  },
  storage: {
    provider: storageProvider as 'local' | 'spaces',
    writeMode: storageWriteMode as 'legacy' | 'dual' | 'isolated',
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
    appDestinations: appStorageDestinations,
  },
  registrationSecret: optional('REGISTRATION_SECRET'),
  registrationSecrets: {
    ecoaudit: optional('ECOAUDIT_REGISTRATION_SECRET'),
    solarsense: optional('SOLARSENSE_REGISTRATION_SECRET'),
    installhub: optional('INSTALLHUB_REGISTRATION_SECRET'),
  },
  azure,
  oneDrive: {
    ...azure,
    enabled: optionalBool('ONEDRIVE_PHOTO_BACKUP_ENABLED', false),
    photosFolder: normalizeOneDriveFolder(
      optional('ONEDRIVE_PHOTOS_FOLDER', 'SustainabilityWise/photos'),
    ),
    backupRequired: optionalBool('ONEDRIVE_BACKUP_REQUIRED', false),
  },
  expoPush: {
    // Test processes opt in explicitly so buildApp/route suites never start a
    // real database/Expo poller. Production and development default on.
    enabled: optionalBool('EXPO_PUSH_ENABLED', nodeEnv !== 'test'),
    accessToken: optional('EXPO_ACCESS_TOKEN'),
    pollIntervalMs: Math.max(1_000, optionalInt('EXPO_PUSH_POLL_INTERVAL_MS', 5_000)),
    claimBatchSize: Math.min(
      100,
      Math.max(1, optionalInt('EXPO_PUSH_CLAIM_BATCH_SIZE', 25)),
    ),
    staleClaimMs: Math.max(
      30_000,
      optionalInt('EXPO_PUSH_STALE_CLAIM_MS', 120_000),
      2 * Math.max(1_000, optionalInt('EXPO_PUSH_REQUEST_TIMEOUT_MS', 15_000)),
    ),
    receiptDelayMs: Math.max(
      60_000,
      optionalInt('EXPO_PUSH_RECEIPT_DELAY_MS', 15 * 60_000),
    ),
    receiptRetryMs: Math.max(
      30_000,
      optionalInt('EXPO_PUSH_RECEIPT_RETRY_MS', 5 * 60_000),
    ),
    requestTimeoutMs: Math.max(
      1_000,
      optionalInt('EXPO_PUSH_REQUEST_TIMEOUT_MS', 15_000),
    ),
  },
  puppeteerExecutablePath: resolvePuppeteerExecutablePath(),
} as const;
