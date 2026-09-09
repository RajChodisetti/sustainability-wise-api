import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  assertWattwatchersMeterRegisterStructuredGeneratorDigests,
  generateWattwatchersMeterRegisterStructuredArtifacts,
  writePrivateWattwatchersMeterRegisterStructuredArtifacts,
} from '../src/services/wattwatchersMeterRegisterStructuredManifestGenerator.js';
import {
  parseWattwatchersMeterRegisterReconciliationTarget,
  type WattwatchersMeterRegisterReconciliationTarget,
} from '../src/services/wattwatchersMeterRegisterReconciliationTarget.js';

type Options = {
  sourceAuditPath: string;
  snapshotPath: string;
  expectedSnapshotSha256: string;
  target: WattwatchersMeterRegisterReconciliationTarget;
  expectedDatabaseIdentitySha256: string;
  manifestOutputPath: string;
  ledgerOutputPath: string;
};

function parseOptions(argv: string[]): Options {
  const allowed = new Set([
    '--source-audit',
    '--snapshot',
    '--snapshot-sha256',
    '--target',
    '--database-identity-sha256',
    '--manifest-output',
    '--ledger-output',
  ]);
  if (argv.length !== 14) {
    throw new Error(
      'Usage: --source-audit <private-source-audit.json> '
        + '--snapshot <private-db-snapshot.json> --snapshot-sha256 <digest> '
        + '--target <qa|production> --database-identity-sha256 <digest> '
        + '--manifest-output <private-manifest.json> --ledger-output <private-ledger.json>',
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !allowed.has(name) || !value || values.has(name)) {
      throw new Error('Structured manifest generator received invalid or duplicate options');
    }
    values.set(name, value);
  }
  const parsed = {
    sourceAuditPath: values.get('--source-audit'),
    snapshotPath: values.get('--snapshot'),
    expectedSnapshotSha256: values.get('--snapshot-sha256'),
    target: values.get('--target'),
    expectedDatabaseIdentitySha256: values.get('--database-identity-sha256'),
    manifestOutputPath: values.get('--manifest-output'),
    ledgerOutputPath: values.get('--ledger-output'),
  };
  if (!parsed.sourceAuditPath || !parsed.snapshotPath || !parsed.expectedSnapshotSha256
    || !parsed.manifestOutputPath || !parsed.ledgerOutputPath) {
    throw new Error('Structured manifest generator requires every documented option');
  }
  if (!parsed.expectedDatabaseIdentitySha256
    || !/^sha256:[a-f0-9]{64}$/u.test(parsed.expectedDatabaseIdentitySha256)) {
    throw new Error('Structured manifest generator requires a database identity digest');
  }
  if (new Set([
    parsed.sourceAuditPath,
    parsed.snapshotPath,
    parsed.manifestOutputPath,
    parsed.ledgerOutputPath,
  ]).size !== 4) {
    throw new Error('Input and output artifact paths must be distinct');
  }
  return {
    ...parsed,
    target: parseWattwatchersMeterRegisterReconciliationTarget(parsed.target),
    expectedDatabaseIdentitySha256: parsed.expectedDatabaseIdentitySha256,
  };
}

async function readPrivateInput(path: string, description: string): Promise<Buffer> {
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [sourceAuditBytes, snapshotBytes] = await Promise.all([
    readPrivateInput(options.sourceAuditPath, 'Structured source audit'),
    readPrivateInput(options.snapshotPath, 'Database snapshot'),
  ]);
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const sourceAuditSha256 = digest(sourceAuditBytes);
  const dbSnapshotSha256 = digest(snapshotBytes);
  assertWattwatchersMeterRegisterStructuredGeneratorDigests({
    sourceAuditSha256,
    dbSnapshotSha256,
    expectedDbSnapshotSha256: options.expectedSnapshotSha256,
  });
  const artifacts = generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit: JSON.parse(sourceAuditBytes.toString('utf8')) as unknown,
    sourceAuditSha256,
    dbSnapshot: JSON.parse(snapshotBytes.toString('utf8')) as unknown,
    dbSnapshotSha256,
    expectedTarget: options.target,
    expectedDatabaseIdentitySha256: options.expectedDatabaseIdentitySha256,
  });
  await writePrivateWattwatchersMeterRegisterStructuredArtifacts({
    manifestPath: options.manifestOutputPath,
    manifestBytes: artifacts.manifestBytes,
    ledgerPath: options.ledgerOutputPath,
    ledgerBytes: artifacts.ledgerBytes,
  });

  console.log(JSON.stringify({
    sourceAuditSha256,
    dbSnapshotSha256,
    target: artifacts.manifest.sources.dbSnapshot.target,
    database: artifacts.manifest.sources.dbSnapshot.database,
    databaseIdentitySha256: artifacts.manifest.sources.dbSnapshot.databaseIdentitySha256,
    manifestSha256: artifacts.manifestSha256,
    ledgerSha256: artifacts.ledgerSha256,
    selectedRecordCount: artifacts.ledger.outcome.selectedRecordCount,
    selectedFieldCount: artifacts.ledger.outcome.selectedFieldCount,
    excludedFieldCount: artifacts.ledger.outcome.excludedFieldCount,
    exclusionCounts: artifacts.ledger.outcome.exclusionCounts,
    alreadyMatchesCount: artifacts.ledger.outcome.alreadyMatchesCount,
    conflictingNonblankCount: artifacts.ledger.outcome.conflictingNonblankCount,
    manifestOutputPath: options.manifestOutputPath,
    ledgerOutputPath: options.ledgerOutputPath,
  }, null, 2));
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
