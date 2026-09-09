import { pathToFileURL } from 'node:url';
import {
  generateWattwatchersMeterRegisterInvoiceManifest,
  readPrivateWattwatchersMeterRegisterReconciliationArtifact,
  writePrivateWattwatchersMeterRegisterInvoiceManifest,
} from '../src/services/wattwatchersMeterRegisterInvoiceManifestGenerator.js';

type Options = {
  sourceAuditPath: string;
  dbSnapshotPath: string;
  expectedDbSnapshotSha256: string;
  outputPath: string;
};

function parseOptions(argv: string[]): Options {
  const allowed = new Set([
    '--source-audit',
    '--db-snapshot',
    '--snapshot-sha256',
    '--output',
  ]);
  const parsed = new Map<string, string>();
  if (argv.length !== 8) {
    throw new Error(
      'Usage: --source-audit <protected.json> --db-snapshot <protected.json> '
        + '--snapshot-sha256 <digest> --output <private-invoice-manifest.json>',
    );
  }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !allowed.has(name) || !value || parsed.has(name)) {
      throw new Error('Invoice manifest generator received invalid or duplicate options');
    }
    parsed.set(name, value);
  }
  const sourceAuditPath = parsed.get('--source-audit');
  const dbSnapshotPath = parsed.get('--db-snapshot');
  const expectedDbSnapshotSha256 = parsed.get('--snapshot-sha256');
  const outputPath = parsed.get('--output');
  if (!sourceAuditPath || !dbSnapshotPath || !expectedDbSnapshotSha256 || !outputPath) {
    throw new Error(
      'Invoice manifest generator requires source audit, DB snapshot digest, and output',
    );
  }
  return { sourceAuditPath, dbSnapshotPath, expectedDbSnapshotSha256, outputPath };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [sourceAuditBytes, dbSnapshotBytes] = await Promise.all([
    readPrivateWattwatchersMeterRegisterReconciliationArtifact(
      options.sourceAuditPath,
      'Source audit',
    ),
    readPrivateWattwatchersMeterRegisterReconciliationArtifact(
      options.dbSnapshotPath,
      'DB snapshot',
    ),
  ]);
  const generated = generateWattwatchersMeterRegisterInvoiceManifest({
    sourceAuditBytes,
    dbSnapshotBytes,
    expectedDbSnapshotSha256: options.expectedDbSnapshotSha256,
  });
  await writePrivateWattwatchersMeterRegisterInvoiceManifest(
    options.outputPath,
    generated.manifestBytes,
  );
  console.log(JSON.stringify({
    candidateCount: generated.manifest.expected.matchedCount,
    invoiceDateCount: generated.manifest.expected.invoiceDateUpdateCount,
    invoiceEvidenceCount: 95,
    sourceAuditSha256: generated.sourceAuditSha256,
    dbSnapshotSha256: generated.dbSnapshotSha256,
    invoiceEvidenceSha256: generated.invoiceEvidenceSha256,
    manifestSha256: generated.manifestSha256,
    outputPath: options.outputPath,
  }, null, 2));
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
