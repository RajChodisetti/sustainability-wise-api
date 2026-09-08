import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import {
  assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest,
  assertWattwatchersMeterRegisterInvoiceReconciliationDigests,
  buildWattwatchersMeterRegisterInvoiceReconciliationSql,
  parseWattwatchersMeterRegisterInvoiceReconciliationManifest,
  type WattwatchersMeterRegisterInvoiceReconciliationMode,
} from '../src/services/wattwatchersMeterRegisterInvoiceReconciliation.js';

function option(name: string): string | undefined {
  const indexes = process.argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) throw new Error(`${name} may only be supplied once`);
  return indexes.length === 1 ? process.argv[indexes[0]! + 1] : undefined;
}

function parseMode(value: string | undefined): WattwatchersMeterRegisterInvoiceReconciliationMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
}

const manifestPath = option('--manifest');
const expectedManifestSha256 = option('--manifest-sha256');
const masterWorkbookPath = option('--master-workbook');
const worksWorkbookPath = option('--works-workbook');
const outputPath = option('--output');
const mode = parseMode(option('--mode'));

if (!manifestPath || !expectedManifestSha256 || !masterWorkbookPath
  || !worksWorkbookPath || !outputPath) {
  throw new Error(
    'Usage: --manifest <private.json> --manifest-sha256 <digest> '
      + '--master-workbook <Master Register.xlsx> --works-workbook <SW Works Planning.xlsx> '
      + '--output <reconcile.sql> [--mode dry-run|apply]',
  );
}

const manifestStat = await stat(manifestPath);
if (!manifestStat.isFile()) throw new Error('Invoice reconciliation manifest must be a file');
if ((manifestStat.mode & 0o077) !== 0) {
  throw new Error('Invoice reconciliation manifest must not be readable or writable by group/other');
}

const [manifestBytes, masterWorkbookBytes, worksWorkbookBytes] = await Promise.all([
  readFile(manifestPath),
  readFile(masterWorkbookPath),
  readFile(worksWorkbookPath),
]);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const manifestSha256 = sha256(manifestBytes);
assertWattwatchersMeterRegisterInvoiceReconciliationDigests({
  masterWorkbookSha256: sha256(masterWorkbookBytes),
  worksWorkbookSha256: sha256(worksWorkbookBytes),
  manifestSha256,
  expectedManifestSha256,
});

const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
  JSON.parse(manifestBytes.toString('utf8')) as unknown,
);
assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest(manifest);
const built = buildWattwatchersMeterRegisterInvoiceReconciliationSql({ manifest, mode });

const output = await open(outputPath, 'wx', 0o600);
try {
  await output.writeFile(built.sql, { encoding: 'utf8' });
  await output.sync();
} finally {
  await output.close();
}

console.log(JSON.stringify({
  mode,
  manifestSha256,
  matchedCount: built.matchedCount,
  invoiceNumberUpdateCount: built.invoiceNumberUpdateCount,
  invoiceDateUpdateCount: built.invoiceDateUpdateCount,
  outputPath,
}, null, 2));
