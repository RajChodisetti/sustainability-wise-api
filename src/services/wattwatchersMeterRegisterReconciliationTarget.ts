import { createHash } from 'node:crypto';

export const WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS = {
  qa: {
    database: 'sw_ecoaudit_fixes',
    databaseUser: 'sw_lane',
  },
  production: {
    database: 'sustainability_wise',
    databaseUser: 'sw_api',
  },
} as const;

export type WattwatchersMeterRegisterReconciliationTarget =
  keyof typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS;

export type WattwatchersMeterRegisterReconciliationDatabase =
  (typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS)[
    WattwatchersMeterRegisterReconciliationTarget
  ]['database'];

export type WattwatchersMeterRegisterReconciliationDatabaseUser =
  (typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS)[
    WattwatchersMeterRegisterReconciliationTarget
  ]['databaseUser'];

export const WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA = 'public';
export const WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH = 'pg_catalog, pg_temp';

export const WATTWATCHERS_METER_REGISTER_RECONCILIATION_TABLE_NAMES = {
  imports: 'ww_meter_register_imports',
  entries: 'ww_meter_register_entries',
  records: 'ww_meter_register_records',
} as const;

export type WattwatchersMeterRegisterReconciliationTableOids = {
  imports: string;
  entries: string;
  records: string;
};

export type WattwatchersMeterRegisterReconciliationTargetBinding = {
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: WattwatchersMeterRegisterReconciliationDatabase;
  databaseSchema: typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA;
  searchPath: typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH;
  databaseUser: string;
  databaseIdentitySha256: string;
  tableOids: WattwatchersMeterRegisterReconciliationTableOids;
};

export type WattwatchersMeterRegisterDatabaseUrlIdentity = {
  sha256: string;
  database: string;
  databaseUser: string;
};

export function parseWattwatchersMeterRegisterReconciliationTarget(
  value: string | undefined,
): WattwatchersMeterRegisterReconciliationTarget {
  if (value !== 'qa' && value !== 'production') {
    throw new Error('--target must be explicitly supplied as qa or production');
  }
  return value;
}

export function wattwatchersMeterRegisterReconciliationDatabaseForTarget(
  target: WattwatchersMeterRegisterReconciliationTarget,
): WattwatchersMeterRegisterReconciliationDatabase {
  return WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS[target].database;
}

export function wattwatchersMeterRegisterReconciliationDatabaseUserForTarget(
  target: WattwatchersMeterRegisterReconciliationTarget,
): WattwatchersMeterRegisterReconciliationDatabaseUser {
  return WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS[target].databaseUser;
}

function decodeUrlComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`DATABASE_URL ${label} is not valid percent-encoded text`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeWattwatchersMeterRegisterDatabaseUrlIdentity(
  databaseUrl: string,
): WattwatchersMeterRegisterDatabaseUrlIdentity {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }
  const databaseUser = decodeUrlComponent(parsed.username, 'user');
  const database = decodeUrlComponent(parsed.pathname.replace(/^\//u, ''), 'database');
  const hostname = parsed.hostname.toLowerCase();
  if (!databaseUser || !database || !hostname || parsed.hash) {
    throw new Error('DATABASE_URL must include user, host, and database and must not use a fragment');
  }
  const portText = parsed.port;
  if (!/^[0-9]+$/u.test(portText)) {
    throw new Error('DATABASE_URL must include an explicit numeric port');
  }
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DATABASE_URL port must be between 1 and 65535');
  }

  const parameterNames = new Set<string>();
  const parameterEntries = [...parsed.searchParams.entries()].map(([name, value]) => {
    if (!name || parameterNames.has(name)) {
      throw new Error('DATABASE_URL query parameters must be named and unique');
    }
    parameterNames.add(name);
    return [name, value] as const;
  }).sort(([leftName, leftValue], [rightName, rightValue]) => (
    leftName.localeCompare(rightName, 'en') || leftValue.localeCompare(rightValue, 'en')
  ));

  const parameters = Object.fromEntries(parameterEntries);
  const canonical = {
    protocol: parsed.protocol,
    hostname,
    port,
    database,
    username: databaseUser,
    parameters,
  };
  return {
    sha256: `sha256:${createHash('sha256').update(stableJson(canonical), 'utf8').digest('hex')}`,
    database,
    databaseUser,
  };
}

export function assertWattwatchersMeterRegisterReconciliationTargetDatabase(input: {
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: string;
}): asserts input is {
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: WattwatchersMeterRegisterReconciliationDatabase;
} {
  const expected = wattwatchersMeterRegisterReconciliationDatabaseForTarget(input.target);
  if (input.database !== expected) {
    throw new Error(
      `Meter Register target ${input.target} must bind database ${expected}`,
    );
  }
}

export function assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser(input: {
  target: WattwatchersMeterRegisterReconciliationTarget;
  databaseUser: string;
}): asserts input is {
  target: WattwatchersMeterRegisterReconciliationTarget;
  databaseUser: WattwatchersMeterRegisterReconciliationDatabaseUser;
} {
  const expected = wattwatchersMeterRegisterReconciliationDatabaseUserForTarget(input.target);
  if (input.databaseUser !== expected) {
    throw new Error(
      `Meter Register target ${input.target} must bind database user ${expected}`,
    );
  }
}

export function assertWattwatchersMeterRegisterReconciliationTableOids(
  tableOids: WattwatchersMeterRegisterReconciliationTableOids,
): void {
  for (const [name, oid] of Object.entries(tableOids)) {
    if (!/^[1-9][0-9]*$/u.test(oid)) {
      throw new Error(`Meter Register ${name} table OID must be a positive decimal OID`);
    }
  }
  if (new Set(Object.values(tableOids)).size !== 3) {
    throw new Error('Meter Register reconciliation tables must have distinct OIDs');
  }
}

export function assertWattwatchersMeterRegisterReconciliationTargetBinding(
  binding: WattwatchersMeterRegisterReconciliationTargetBinding,
): void {
  assertWattwatchersMeterRegisterReconciliationTargetDatabase(binding);
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser(binding);
  if (binding.databaseSchema !== WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA
    || binding.searchPath !== WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH) {
    throw new Error('Meter Register reconciliation must bind the public schema and search path');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(binding.databaseIdentitySha256)) {
    throw new Error('Meter Register database identity must be a prefixed lowercase SHA-256 digest');
  }
  assertWattwatchersMeterRegisterReconciliationTableOids(binding.tableOids);
}
