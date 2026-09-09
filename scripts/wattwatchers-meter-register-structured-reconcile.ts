import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch,
  generateWattwatchersMeterRegisterStructuredArtifacts,
  writePrivateWattwatchersMeterRegisterStructuredArtifact,
} from '../src/services/wattwatchersMeterRegisterStructuredManifestGenerator.js';
import {
  assertWattwatchersMeterRegisterStructuredArtifactDigests,
  buildWattwatchersMeterRegisterStructuredReconciliationSql,
  type WattwatchersMeterRegisterStructuredReconciliationMode,
} from '../src/services/wattwatchersMeterRegisterStructuredReconciliation.js';

type Options = {
  manifestPath: string;
  expectedManifestSha256: string;
  ledgerPath: string;
  expectedLedgerSha256: string;
  sourceAuditPath: string;
  expectedSourceAuditSha256: string;
  snapshotPath: string;
  expectedSnapshotSha256: string;
  masterWorkbookPath: string;
  worksWorkbookPath: string;
  outputPath: string;
  mode: WattwatchersMeterRegisterStructuredReconciliationMode;
};

const VALUE_OPTIONS = new Set([
  '--manifest',
  '--manifest-sha256',
  '--ledger',
  '--ledger-sha256',
  '--source-audit',
  '--source-audit-sha256',
  '--snapshot',
  '--snapshot-sha256',
  '--master-workbook',
  '--works-workbook',
  '--output',
  '--mode',
]);

function parseMode(value: string | undefined): WattwatchersMeterRegisterStructuredReconciliationMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
}

function parseOptions(argv: string[]): Options {
  if (argv.length % 2 !== 0) {
    throw new Error('Structured reconciliation options must be supplied as name/value pairs');
  }
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !VALUE_OPTIONS.has(name) || !value || parsed.has(name)) {
      throw new Error('Structured reconciliation received invalid or duplicate options');
    }
    parsed.set(name, value);
  }

  const manifestPath = parsed.get('--manifest');
  const expectedManifestSha256 = parsed.get('--manifest-sha256');
  const ledgerPath = parsed.get('--ledger');
  const expectedLedgerSha256 = parsed.get('--ledger-sha256');
  const sourceAuditPath = parsed.get('--source-audit');
  const expectedSourceAuditSha256 = parsed.get('--source-audit-sha256');
  const snapshotPath = parsed.get('--snapshot');
  const expectedSnapshotSha256 = parsed.get('--snapshot-sha256');
  const masterWorkbookPath = parsed.get('--master-workbook');
  const worksWorkbookPath = parsed.get('--works-workbook');
  const outputPath = parsed.get('--output');
  if (!manifestPath || !expectedManifestSha256 || !ledgerPath || !expectedLedgerSha256
    || !sourceAuditPath || !expectedSourceAuditSha256 || !snapshotPath
    || !expectedSnapshotSha256 || !masterWorkbookPath || !worksWorkbookPath || !outputPath) {
    throw new Error(
      'Usage: --manifest <private-manifest.json> --manifest-sha256 <digest> '
        + '--ledger <private-ledger.json> --ledger-sha256 <digest> '
        + '--source-audit <private-source-audit.json> --source-audit-sha256 <digest> '
        + '--snapshot <private-qa-db-snapshot.json> --snapshot-sha256 <digest> '
        + '--master-workbook <Master Register.xlsx> --works-workbook <SW Works Planning.xlsx> '
        + '--output <private-reconcile.sql> [--mode dry-run|apply]',
    );
  }

  if (new Set([
    manifestPath,
    ledgerPath,
    sourceAuditPath,
    snapshotPath,
    masterWorkbookPath,
    worksWorkbookPath,
    outputPath,
  ]).size !== 7) {
    throw new Error('Structured reconciliation input and output paths must be distinct');
  }

  return {
    manifestPath,
    expectedManifestSha256,
    ledgerPath,
    expectedLedgerSha256,
    sourceAuditPath,
    expectedSourceAuditSha256,
    snapshotPath,
    expectedSnapshotSha256,
    masterWorkbookPath,
    worksWorkbookPath,
    outputPath,
    mode: parseMode(parsed.get('--mode')),
  };
}

async function readPrivateFile(path: string, description: string): Promise<Buffer> {
  const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await input.stat();
    if (!details.isFile() || (details.mode & 0o077) !== 0) {
      throw new Error(
        `${description} must be a regular file inaccessible to group and other users`,
      );
    }
    return await input.readFile();
  } finally {
    await input.close();
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [
    manifestBytes,
    ledgerBytes,
    sourceAuditBytes,
    snapshotBytes,
    masterWorkbookBytes,
    worksWorkbookBytes,
  ] = await Promise.all([
    readPrivateFile(options.manifestPath, 'Structured reconciliation manifest'),
    readPrivateFile(options.ledgerPath, 'Structured outcome ledger'),
    readPrivateFile(options.sourceAuditPath, 'Structured source audit'),
    readPrivateFile(options.snapshotPath, 'QA database snapshot'),
    readFile(options.masterWorkbookPath),
    readFile(options.worksWorkbookPath),
  ]);

  const manifestSha256 = sha256(manifestBytes);
  const ledgerSha256 = sha256(ledgerBytes);
  const sourceAuditSha256 = sha256(sourceAuditBytes);
  const qaSnapshotSha256 = sha256(snapshotBytes);
  assertWattwatchersMeterRegisterStructuredArtifactDigests({
    masterWorkbookSha256: sha256(masterWorkbookBytes),
    worksWorkbookSha256: sha256(worksWorkbookBytes),
    sourceAuditSha256,
    expectedSourceAuditSha256: options.expectedSourceAuditSha256,
    qaSnapshotSha256,
    expectedQaSnapshotSha256: options.expectedSnapshotSha256,
    manifestSha256,
    expectedManifestSha256: options.expectedManifestSha256,
    ledgerSha256,
    expectedLedgerSha256: options.expectedLedgerSha256,
  });

  const generated = generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit: JSON.parse(sourceAuditBytes.toString('utf8')) as unknown,
    sourceAuditSha256,
    qaSnapshot: JSON.parse(snapshotBytes.toString('utf8')) as unknown,
    qaSnapshotSha256,
  });
  assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch({
    generated,
    suppliedManifestBytes: manifestBytes,
    suppliedLedgerBytes: ledgerBytes,
  });

  const built = buildWattwatchersMeterRegisterStructuredReconciliationSql({
    manifest: generated.manifest,
    mode: options.mode,
  });
  const sqlBytes = Buffer.from(built.sql, 'utf8');
  const sqlSha256 = sha256(sqlBytes);
  await writePrivateWattwatchersMeterRegisterStructuredArtifact(
    options.outputPath,
    sqlBytes,
  );

  console.log(JSON.stringify({
    mode: options.mode,
    sourceAuditSha256,
    qaSnapshotSha256,
    manifestSha256,
    ledgerSha256,
    sqlSha256,
    recordUpdateCount: built.recordUpdateCount,
    fieldUpdateCounts: built.fieldUpdateCounts,
    outputPath: options.outputPath,
  }, null, 2));
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
