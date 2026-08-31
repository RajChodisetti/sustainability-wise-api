import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
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
} from '../src/services/wattwatchersMeterRegisterImportSql.js';

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

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseMode(value: string | undefined): WattwatchersMeterRegisterImportMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
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

const inputPath = option('--input');
const workbookPath = option('--workbook');
const outputPath = option('--output');
const mode = parseMode(option('--mode'));
if (!inputPath || !workbookPath || !outputPath) {
  throw new Error(
    'Usage: --workbook <source.xlsx> --input <extracted.json> '
      + '--output <import.sql> [--mode dry-run|apply]',
  );
}

const [workbookBytes, extractBytes] = await Promise.all([
  readFile(workbookPath),
  readFile(inputPath),
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
  mode,
  expected: MASTER_REGISTER_EXPECTED_SUMMARY,
});
const output = await open(outputPath, 'wx', 0o600);
try {
  await output.writeFile(built.sql, { encoding: 'utf8' });
  await output.sync();
} finally {
  await output.close();
}

console.log(JSON.stringify({
  mode,
  importId: built.importId,
  workbookSha256: parsed.sourceWorkbookSha256,
  extractSha256: MASTER_REGISTER_EXTRACT_SHA256,
  sourceSheet: parsed.sourceSheet,
  ...built.summary,
  outputPath,
}, null, 2));
