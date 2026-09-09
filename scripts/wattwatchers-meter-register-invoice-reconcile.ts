import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  generateWattwatchersMeterRegisterInvoiceManifest,
  readPrivateWattwatchersMeterRegisterReconciliationArtifact,
  writePrivateWattwatchersMeterRegisterReconciliationArtifact,
} from '../src/services/wattwatchersMeterRegisterInvoiceManifestGenerator.js';
import {
  assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest,
  assertWattwatchersMeterRegisterInvoiceReconciliationDigests,
  buildWattwatchersMeterRegisterInvoiceReconciliationSql,
  parseWattwatchersMeterRegisterInvoiceReconciliationManifest,
  type WattwatchersMeterRegisterInvoiceReconciliationMode,
} from '../src/services/wattwatchersMeterRegisterInvoiceReconciliation.js';

type Options = {
  manifestPath: string;
  expectedManifestSha256: string;
  sourceAuditPath: string;
  dbSnapshotPath: string;
  expectedDbSnapshotSha256: string;
  masterWorkbookPath: string;
  worksWorkbookPath: string;
  outputPath: string;
  mode: WattwatchersMeterRegisterInvoiceReconciliationMode;
};

function parseMode(
  value: string | undefined,
): WattwatchersMeterRegisterInvoiceReconciliationMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
}

function parseOptions(argv: string[]): Options {
  const allowed = new Set([
    '--manifest',
    '--manifest-sha256',
    '--source-audit',
    '--db-snapshot',
    '--snapshot-sha256',
    '--master-workbook',
    '--works-workbook',
    '--output',
    '--mode',
  ]);
  if (argv.length % 2 !== 0) {
    throw new Error('Invoice reconciliation options must be supplied as name/value pairs');
  }
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !allowed.has(name) || !value || parsed.has(name)) {
      throw new Error('Invoice reconciliation received invalid or duplicate options');
    }
    parsed.set(name, value);
  }

  const manifestPath = parsed.get('--manifest');
  const expectedManifestSha256 = parsed.get('--manifest-sha256');
  const sourceAuditPath = parsed.get('--source-audit');
  const dbSnapshotPath = parsed.get('--db-snapshot');
  const expectedDbSnapshotSha256 = parsed.get('--snapshot-sha256');
  const masterWorkbookPath = parsed.get('--master-workbook');
  const worksWorkbookPath = parsed.get('--works-workbook');
  const outputPath = parsed.get('--output');
  if (!manifestPath || !expectedManifestSha256 || !sourceAuditPath || !dbSnapshotPath
    || !expectedDbSnapshotSha256 || !masterWorkbookPath || !worksWorkbookPath
    || !outputPath) {
    throw new Error(
      'Usage: --manifest <private.json> --manifest-sha256 <digest> '
        + '--source-audit <protected.json> --db-snapshot <protected.json> '
        + '--snapshot-sha256 <digest> --master-workbook <Master Register.xlsx> '
        + '--works-workbook <SW Works Planning.xlsx> --output <private-reconcile.sql> '
        + '[--mode dry-run|apply]',
    );
  }
  return {
    manifestPath,
    expectedManifestSha256,
    sourceAuditPath,
    dbSnapshotPath,
    expectedDbSnapshotSha256,
    masterWorkbookPath,
    worksWorkbookPath,
    outputPath,
    mode: parseMode(parsed.get('--mode')),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const [
    manifestBytes,
    sourceAuditBytes,
    dbSnapshotBytes,
    masterWorkbookBytes,
    worksWorkbookBytes,
  ] = await Promise.all([
    readPrivateWattwatchersMeterRegisterReconciliationArtifact(
      options.manifestPath,
      'Invoice reconciliation manifest',
    ),
    readPrivateWattwatchersMeterRegisterReconciliationArtifact(
      options.sourceAuditPath,
      'Source audit',
    ),
    readPrivateWattwatchersMeterRegisterReconciliationArtifact(
      options.dbSnapshotPath,
      'DB snapshot',
    ),
    readFile(options.masterWorkbookPath),
    readFile(options.worksWorkbookPath),
  ]);

  const generated = generateWattwatchersMeterRegisterInvoiceManifest({
    sourceAuditBytes,
    dbSnapshotBytes,
    expectedDbSnapshotSha256: options.expectedDbSnapshotSha256,
  });
  if (!manifestBytes.equals(generated.manifestBytes)) {
    throw new Error(
      'Invoice reconciliation manifest bytes do not match deterministic regeneration '
        + 'from the protected audit and exact DB snapshot',
    );
  }

  const manifestSha256 = sha256(manifestBytes);
  assertWattwatchersMeterRegisterInvoiceReconciliationDigests({
    masterWorkbookSha256: sha256(masterWorkbookBytes),
    worksWorkbookSha256: sha256(worksWorkbookBytes),
    manifestSha256,
    expectedManifestSha256: options.expectedManifestSha256,
  });
  const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    JSON.parse(manifestBytes.toString('utf8')) as unknown,
  );
  assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest(manifest);
  const built = buildWattwatchersMeterRegisterInvoiceReconciliationSql({
    manifest,
    mode: options.mode,
  });
  const sqlBytes = Buffer.from(built.sql, 'utf8');
  const sqlSha256 = sha256(sqlBytes);

  await writePrivateWattwatchersMeterRegisterReconciliationArtifact(
    options.outputPath,
    sqlBytes,
  );

  console.log(JSON.stringify({
    mode: options.mode,
    sourceAuditSha256: generated.sourceAuditSha256,
    dbSnapshotSha256: generated.dbSnapshotSha256,
    invoiceEvidenceSha256: generated.invoiceEvidenceSha256,
    manifestSha256,
    sqlSha256,
    matchedCount: built.matchedCount,
    invoiceNumberUpdateCount: built.invoiceNumberUpdateCount,
    invoiceDateUpdateCount: built.invoiceDateUpdateCount,
    outputPath: options.outputPath,
  }, null, 2));
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main(process.argv.slice(2));
