import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  normalizeWattwatchersMeterRegister,
  WATTWATCHERS_METER_REGISTER_SHEET,
  WATTWATCHERS_METER_REGISTER_WORKBOOK,
  type ExtractedMeterRegisterRow,
} from '../src/services/wattwatchersMeterRegisterImport.js';
import {
  buildWattwatchersMeterRegisterImportSql,
  assertMasterRegisterArtifactDigests,
  MASTER_REGISTER_EXPECTED_SUMMARY,
  MASTER_REGISTER_EXTRACT_SHA256,
  MASTER_REGISTER_WORKBOOK_SHA256,
  type WattwatchersMeterRegisterImportMode,
  type WattwatchersMeterRegisterImportPhase,
} from '../src/services/wattwatchersMeterRegisterImportSql.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetDatabase,
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser,
  computeWattwatchersMeterRegisterDatabaseUrlIdentity,
  parseWattwatchersMeterRegisterReconciliationTarget,
  wattwatchersMeterRegisterReconciliationDatabaseForTarget,
  wattwatchersMeterRegisterReconciliationDatabaseUserForTarget,
  type WattwatchersMeterRegisterReconciliationDatabase,
  type WattwatchersMeterRegisterReconciliationDatabaseUser,
  type WattwatchersMeterRegisterReconciliationTarget,
} from '../src/services/wattwatchersMeterRegisterReconciliationTarget.js';

const EXPECTED_HEADERS = [
  'Status',
  'Customer Name',
  'Client Name',
  'Site Address',
  'State',
  'Service Type',
  'Metering Solution Type',
  'Meter Type',
  'Fergus Job #',
  'Quote #',
  'PO Number',
  'Job Completion Date',
  'Job Completed By',
  'Existing Device ID',
  'New Device ID',
  'Hardware Installed',
  'MaaS (Yes/No)',
  'MaaS Start Date',
  'MaaS Term',
  'MaaS reporting required (Y/N)',
  'Data (Yes/No)',
  'Product name (WW)',
  'Xero Invoice #',
  'Meter Cost (EXC.GST)',
  'Metering Recurring Fee (EXC. GST)',
  'Other costs in invoice (if any)',
  'Invoice Amount (EXC.GST)',
  'Recurring fee PO (if any)',
  'Invoicing Client Contact',
  'Comments',
  'Recurring Start Date',
  'Recurring Frequency',
  'Next Invoice Issue Date',
  'Inv issued date',
  'Period',
  'Next Invoice Issue Date__2',
] as const;

const EXPECTED_AUTHORITATIVE_ID_COUNT = 2_743;

type MeterRegisterExtract = {
  sourceWorkbook: string;
  sourceWorkbookSha256: string;
  sourceSheet: string;
  headers: string[];
  authoritativeWattwatchersIds: string[];
  rows: ExtractedMeterRegisterRow[];
};

type Options = {
  inputPath: string;
  workbookPath: string;
  outputPath: string;
  mode: WattwatchersMeterRegisterImportMode;
  phase: WattwatchersMeterRegisterImportPhase;
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: WattwatchersMeterRegisterReconciliationDatabase;
  databaseUser: WattwatchersMeterRegisterReconciliationDatabaseUser;
  databaseIdentitySha256: string;
};

const VALUE_OPTIONS = new Set([
  '--input',
  '--workbook',
  '--output',
  '--mode',
  '--phase',
  '--target',
  '--database-identity-sha256',
]);

function parseMode(value: string | undefined): WattwatchersMeterRegisterImportMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
}

function parsePhase(value: string | undefined): WattwatchersMeterRegisterImportPhase {
  if (value !== 'source' && value !== 'operational') {
    throw new Error('--phase must be explicitly supplied as source or operational');
  }
  return value;
}

function parseOptions(argv: string[]): Options {
  if (argv.length % 2 !== 0) {
    throw new Error('Meter Register import options must be supplied as name/value pairs');
  }
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !VALUE_OPTIONS.has(name) || !value || value.startsWith('--')
      || parsed.has(name)) {
      throw new Error('Meter Register import received invalid or duplicate options');
    }
    parsed.set(name, value);
  }

  const inputPath = parsed.get('--input');
  const workbookPath = parsed.get('--workbook');
  const outputPath = parsed.get('--output');
  const expectedDatabaseIdentitySha256 = parsed.get('--database-identity-sha256');
  if (!inputPath || !workbookPath || !outputPath || !expectedDatabaseIdentitySha256) {
    throw new Error(
      'Usage: --target <qa|production> --database-identity-sha256 <sha256:digest> '
        + '--phase <source|operational> '
        + '--workbook <source.xlsx> --input <private-extracted.json> '
        + '--output <private-import.sql> [--mode dry-run|apply]',
    );
  }
  if (new Set([inputPath, workbookPath, outputPath]).size !== 3) {
    throw new Error('Meter Register import input, workbook, and output paths must be distinct');
  }

  const mode = parseMode(parsed.get('--mode'));
  const phase = parsePhase(parsed.get('--phase'));
  const target = parseWattwatchersMeterRegisterReconciliationTarget(parsed.get('--target'));
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDatabaseIdentitySha256)) {
    throw new Error('--database-identity-sha256 must be sha256 followed by 64 lowercase hex digits');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to bind the import target');
  const databaseIdentity = computeWattwatchersMeterRegisterDatabaseUrlIdentity(databaseUrl);
  if (databaseIdentity.sha256 !== expectedDatabaseIdentitySha256) {
    throw new Error('DATABASE_URL identity does not match --database-identity-sha256');
  }
  const database = wattwatchersMeterRegisterReconciliationDatabaseForTarget(target);
  const databaseUser = wattwatchersMeterRegisterReconciliationDatabaseUserForTarget(target);
  const targetBinding = { target, database: databaseIdentity.database };
  assertWattwatchersMeterRegisterReconciliationTargetDatabase(targetBinding);
  if (targetBinding.database !== database) {
    throw new Error('Meter Register target database registry mismatch');
  }
  const targetUserBinding = { target, databaseUser: databaseIdentity.databaseUser };
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser(targetUserBinding);
  if (targetUserBinding.databaseUser !== databaseUser) {
    throw new Error('Meter Register target database-user registry mismatch');
  }
  return {
    inputPath,
    workbookPath,
    outputPath,
    mode,
    phase,
    target,
    database,
    databaseUser,
    databaseIdentitySha256: databaseIdentity.sha256,
  };
}

async function readRegularFileNoFollow(input: {
  path: string;
  description: string;
  requirePrivate: boolean;
}): Promise<Buffer> {
  const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile()) {
      throw new Error(`${input.description} must be a regular file`);
    }
    if (input.requirePrivate && (details.mode & 0o077) !== 0) {
      throw new Error(`${input.description} must be inaccessible to group and other users`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function writePrivateSqlArtifact(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const output = await open(temporaryPath, 'wx', 0o600);
  try {
    await output.writeFile(bytes);
    await output.sync();
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    await output.close();
  }

  try {
    await link(temporaryPath, path);
    await syncDirectory(path);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function assertExtract(input: MeterRegisterExtract): void {
  if (input.sourceWorkbook !== WATTWATCHERS_METER_REGISTER_WORKBOOK) {
    throw new Error(`Expected source workbook ${WATTWATCHERS_METER_REGISTER_WORKBOOK}`);
  }
  if (input.sourceWorkbookSha256.toLowerCase() !== MASTER_REGISTER_WORKBOOK_SHA256) {
    throw new Error('Master Register workbook checksum changed');
  }
  if (input.sourceSheet !== WATTWATCHERS_METER_REGISTER_SHEET) {
    throw new Error(`Expected source sheet ${WATTWATCHERS_METER_REGISTER_SHEET}`);
  }
  if (JSON.stringify(input.headers) !== JSON.stringify(EXPECTED_HEADERS)) {
    throw new Error('Master Register positional headers changed');
  }
  const authoritativeIds = new Set(
    input.authoritativeWattwatchersIds.map((identifier) => identifier.trim().toUpperCase()),
  );
  if (authoritativeIds.size !== EXPECTED_AUTHORITATIVE_ID_COUNT
    || [...authoritativeIds].some((identifier) => !/^[A-Z0-9]{13}$/u.test(identifier))) {
    throw new Error('Master Register authoritative Wattwatchers inventory changed');
  }
  if (!Array.isArray(input.rows)) throw new Error('Master Register rows must be an array');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [workbookBytes, extractBytes] = await Promise.all([
    readRegularFileNoFollow({
      path: options.workbookPath,
      description: 'Master Register workbook',
      requirePrivate: true,
    }),
    readRegularFileNoFollow({
      path: options.inputPath,
      description: 'Master Register extract',
      requirePrivate: true,
    }),
  ]);
  const workbookSha256 = createHash('sha256').update(workbookBytes).digest('hex');
  const extractSha256 = createHash('sha256').update(extractBytes).digest('hex');
  assertMasterRegisterArtifactDigests({ workbookSha256, extractSha256 });

  const parsed = JSON.parse(extractBytes.toString('utf8')) as MeterRegisterExtract;
  assertExtract(parsed);
  const rows = normalizeWattwatchersMeterRegister(parsed.rows, {
    sourceWorkbook: parsed.sourceWorkbook,
    sourceWorkbookSha256: parsed.sourceWorkbookSha256,
    sourceSheet: parsed.sourceSheet,
    authoritativeWattwatchersIds: parsed.authoritativeWattwatchersIds,
  });
  const built = buildWattwatchersMeterRegisterImportSql({
    rows,
    mode: options.mode,
    phase: options.phase,
    target: options.target,
    database: options.database,
    databaseUser: options.databaseUser,
    databaseIdentitySha256: options.databaseIdentitySha256,
    expected: MASTER_REGISTER_EXPECTED_SUMMARY,
  });
  const sqlBytes = Buffer.from(built.sql, 'utf8');
  const sqlSha256 = createHash('sha256').update(sqlBytes).digest('hex');
  await writePrivateSqlArtifact(options.outputPath, sqlBytes);

  console.log(JSON.stringify({
    mode: options.mode,
    phase: options.phase,
    target: options.target,
    database: options.database,
    databaseUser: options.databaseUser,
    databaseIdentitySha256: options.databaseIdentitySha256,
    importId: built.importId,
    workbookSha256: parsed.sourceWorkbookSha256,
    extractSha256: MASTER_REGISTER_EXTRACT_SHA256,
    sqlSha256,
    sourceSheet: parsed.sourceSheet,
    ...built.summary,
    outputPath: options.outputPath,
  }, null, 2));
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
