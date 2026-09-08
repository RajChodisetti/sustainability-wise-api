import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import {
  assertWattwatchersMeterRegisterStructuredArtifactDigests,
  assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit,
  buildWattwatchersMeterRegisterStructuredReconciliationSql,
  parseWattwatchersMeterRegisterStructuredManifest,
  type WattwatchersMeterRegisterStructuredReconciliationMode,
} from '../src/services/wattwatchersMeterRegisterStructuredReconciliation.js';

function option(name: string): string | undefined {
  const indexes = process.argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) throw new Error(`${name} may only be supplied once`);
  return indexes.length === 1 ? process.argv[indexes[0]! + 1] : undefined;
}

function parseMode(value: string | undefined): WattwatchersMeterRegisterStructuredReconciliationMode {
  const mode = value ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('--mode must be dry-run or apply');
  }
  return mode;
}

async function assertPrivateFile(path: string, description: string): Promise<void> {
  const details = await stat(path);
  if (!details.isFile()) throw new Error(`${description} must be a file`);
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`${description} must not be readable or writable by group/other`);
  }
}

const manifestPath = option('--manifest');
const expectedManifestSha256 = option('--manifest-sha256');
const sourceAuditPath = option('--source-audit');
const masterWorkbookPath = option('--master-workbook');
const worksWorkbookPath = option('--works-workbook');
const outputPath = option('--output');
const mode = parseMode(option('--mode'));

if (!manifestPath || !expectedManifestSha256 || !sourceAuditPath || !masterWorkbookPath
  || !worksWorkbookPath || !outputPath) {
  throw new Error(
    'Usage: --manifest <private-db-manifest.json> --manifest-sha256 <digest> '
      + '--source-audit <private-source-audit.json> '
      + '--master-workbook <Master Register.xlsx> --works-workbook <SW Works Planning.xlsx> '
      + '--output <reconcile.sql> [--mode dry-run|apply]',
  );
}

await Promise.all([
  assertPrivateFile(manifestPath, 'Structured reconciliation manifest'),
  assertPrivateFile(sourceAuditPath, 'Structured reconciliation source audit'),
]);

const [manifestBytes, sourceAuditBytes, masterWorkbookBytes, worksWorkbookBytes] =
  await Promise.all([
    readFile(manifestPath),
    readFile(sourceAuditPath),
    readFile(masterWorkbookPath),
    readFile(worksWorkbookPath),
  ]);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const manifestSha256 = sha256(manifestBytes);
const sourceAuditSha256 = sha256(sourceAuditBytes);
assertWattwatchersMeterRegisterStructuredArtifactDigests({
  masterWorkbookSha256: sha256(masterWorkbookBytes),
  worksWorkbookSha256: sha256(worksWorkbookBytes),
  sourceAuditSha256,
  manifestSha256,
  expectedManifestSha256,
});

const manifest = parseWattwatchersMeterRegisterStructuredManifest(
  JSON.parse(manifestBytes.toString('utf8')) as unknown,
);
assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
  manifest,
  JSON.parse(sourceAuditBytes.toString('utf8')) as unknown,
);
const built = buildWattwatchersMeterRegisterStructuredReconciliationSql({ manifest, mode });

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
  sourceAuditSha256,
  recordUpdateCount: built.recordUpdateCount,
  fieldUpdateCounts: built.fieldUpdateCounts,
  outputPath,
}, null, 2));
