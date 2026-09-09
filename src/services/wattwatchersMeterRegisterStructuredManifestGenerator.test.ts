import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch,
  assertWattwatchersMeterRegisterStructuredGeneratorDigests,
  generateWattwatchersMeterRegisterStructuredArtifacts,
  METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT,
  METER_REGISTER_STRUCTURED_QA_DATABASE,
  METER_REGISTER_STRUCTURED_QA_SNAPSHOT_SCHEMA,
  parseWattwatchersMeterRegisterStructuredOutcomeLedger,
  writePrivateWattwatchersMeterRegisterStructuredArtifact,
  writePrivateWattwatchersMeterRegisterStructuredArtifacts,
} from './wattwatchersMeterRegisterStructuredManifestGenerator.js';
import {
  assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit,
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT,
  METER_REGISTER_STRUCTURED_MASTER_SHEET,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
  METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
  METER_REGISTER_STRUCTURED_WORKS_SHEET,
  METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
  parseWattwatchersMeterRegisterStructuredManifest,
} from './wattwatchersMeterRegisterStructuredReconciliation.js';
import { MASTER_REGISTER_EXPECTED_SUMMARY } from './wattwatchersMeterRegisterImportSql.js';

const SNAPSHOT_SHA = 'e'.repeat(64);
const IMPORT_ID = 'private-import';
const DATABASE_IDENTITY_SHA256 = `sha256:${'9'.repeat(64)}`;
const TABLE_OIDS = { imports: '1001', entries: '1002', records: '1003' };

type JsonRecord = Record<string, unknown>;

function digest(serial: number): string {
  return serial.toString(16).padStart(64, '0').slice(-64);
}

function deviceId(serial: number, prefix = 'A'): string {
  return `${prefix}${String(serial).padStart(12, '0')}`;
}

function sourceAuditFixture(): JsonRecord {
  const candidates: JsonRecord[] = [];
  let serial = 0;
  for (const [key, contract] of Object.entries(METER_REGISTER_STRUCTURED_FIELD_CONTRACT)) {
    for (let index = 0; index < contract.sourceAuditCount; index += 1) {
      serial += 1;
      const rowDigest = digest(serial);
      candidates.push({
        decision: 'safe_auto_fill',
        decision_rule: 'S2',
        device_id: deviceId(serial),
        target_field: contract.auditTargetField,
        target_master_header: contract.masterHeader,
        source_works_header: contract.worksHeader,
        value: contract.valueType === 'boolean'
          ? false
          : contract.valueType === 'date'
            ? '2026-01-02'
            : `Synthetic ${key} ${serial}`,
        master: {
          sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
          source_row: serial + 3,
          audit_row_sha256: rowDigest,
          cached_values_sha256: rowDigest,
          formula_values_sha256: rowDigest,
        },
        works_evidence: [{
          sheet: METER_REGISTER_STRUCTURED_WORKS_SHEET,
          source_row: serial + 1,
          audit_row_sha256: rowDigest,
          cached_values_sha256: rowDigest,
          formula_values_sha256: rowDigest,
        }],
      });
    }
  }

  const firstService = candidates.find((candidate) => candidate.target_field === 'service_type')!;
  const firstMeter = candidates.find((candidate) => candidate.target_field === 'meter_type')!;
  firstMeter.device_id = firstService.device_id;
  firstMeter.master = structuredClone(firstService.master);

  const invoiceDate = candidates.find(
    (candidate) => candidate.target_field === 'invoice_issued_date',
  )!;
  const invoiceCandidates = Array.from({ length: 92 }, (_, index): JsonRecord => {
    const rowDigest = digest(3_000 + index);
    return {
      decision: 'safe_auto_fill',
      decision_rule: 'S1',
      device_id: index === 0 ? invoiceDate.device_id : deviceId(2_000 + index, 'I'),
      target_field: 'xeroInvoiceNumber',
      value: `INV-${1_000 + index}`,
      master: index === 0 ? structuredClone(invoiceDate.master) : {
        sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
        source_row: 5_000 + index,
        audit_row_sha256: rowDigest,
        cached_values_sha256: rowDigest,
        formula_values_sha256: rowDigest,
      },
    };
  });

  return {
    schema: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
    repository_commit: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
    sources: {
      master_register: { workbook_sha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256 },
      sw_works_planning: { workbook_sha256: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256 },
    },
    safe_invoice_fills: invoiceCandidates,
    safe_other_fills: candidates,
  };
}

function emptyProjectedValues(): JsonRecord {
  return {
    invoiceNumber: null,
    status: null,
    serviceType: null,
    meteringSolutionType: null,
    meterType: null,
    fergusJobNumber: null,
    quoteNumber: null,
    purchaseOrderNumber: null,
    jobCompletionDate: null,
    jobCompletedBy: null,
    hardwareInstalled: null,
    maas: null,
    invoiceIssuedDate: null,
    comments: null,
  };
}

function emptyImmutableValues(): JsonRecord {
  return Object.fromEntries(Object.keys(emptyProjectedValues()).map((key) => [
    key,
    { snapshot: null, payload: null },
  ]));
}

function snapshotRow(input: {
  serial: number;
  sourceRow: number;
  sourceRowSha256: string;
  currentDeviceIdentifier: string | null;
  recordRevision?: number | null;
  updatedBy?: string | null;
  manuallyCorrectedAt?: string | null;
  immutableValues?: JsonRecord;
  liveValues?: JsonRecord;
}): JsonRecord {
  return {
    databaseName: METER_REGISTER_STRUCTURED_QA_DATABASE,
    databaseUser: 'sw_lane',
    databaseSchemaName: 'public',
    currentSchemaName: 'pg_catalog',
    searchPath: 'pg_catalog, pg_temp',
    tableOids: TABLE_OIDS,
    importId: IMPORT_ID,
    sourceWorkbook: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
    sourceSheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
    workbookSha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
    importSourceRowCount: MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount,
    entryId: `wwmre_${input.serial.toString(16).padStart(32, '0')}`,
    entryImportId: IMPORT_ID,
    sourceKey: `source-${input.serial}`,
    sourceRow: input.sourceRow,
    sourceRowSha256: input.sourceRowSha256,
    currentDeviceIdentifier: input.currentDeviceIdentifier,
    recordRevision: input.recordRevision === undefined ? 4 : input.recordRevision,
    recordManuallyCorrectedAt: input.manuallyCorrectedAt ?? null,
    recordUpdatedByUserId: input.updatedBy ?? null,
    immutableValues: input.immutableValues ?? emptyImmutableValues(),
    liveValues: input.liveValues ?? emptyProjectedValues(),
  };
}

function sourceCandidates(sourceAudit: JsonRecord): JsonRecord[] {
  return sourceAudit.safe_other_fills as JsonRecord[];
}

function invoiceSourceCandidates(sourceAudit: JsonRecord): JsonRecord[] {
  return sourceAudit.safe_invoice_fills as JsonRecord[];
}

function buildSnapshot(sourceAudit: JsonRecord): JsonRecord {
  const candidates = sourceCandidates(sourceAudit);
  const services = candidates.filter((candidate) => candidate.target_field === 'service_type');
  const firstMeter = candidates.find((candidate) => candidate.target_field === 'meter_type')!;
  const group = services[0]!;
  const manual = services[1]!;
  const immutable = services[2]!;
  const already = services[3]!;
  const conflict = services[4]!;
  const missingRecord = services[5]!;
  const duplicate = services[6]!;
  const relevant = [group, manual, immutable, already, conflict, missingRecord, duplicate];
  assert.equal(firstMeter.device_id, group.device_id);

  const rows: JsonRecord[] = relevant.map((candidate, index) => {
    const master = candidate.master as JsonRecord;
    const immutableValues = emptyImmutableValues();
    const liveValues = emptyProjectedValues();
    if (candidate === immutable) {
      (immutableValues.serviceType as JsonRecord).payload = 'present';
    }
    if (candidate === already) liveValues.serviceType = candidate.value;
    if (candidate === conflict) liveValues.serviceType = 'different';
    return snapshotRow({
      serial: index + 1,
      sourceRow: master.source_row as number,
      sourceRowSha256: master.cached_values_sha256 as string,
      currentDeviceIdentifier: candidate.device_id as string,
      recordRevision: candidate === missingRecord ? null : 4,
      updatedBy: candidate === manual ? 'operator' : null,
      immutableValues,
      liveValues,
    });
  });
  rows.push(snapshotRow({
    serial: 8,
    sourceRow: 9_999,
    sourceRowSha256: digest(9_999),
    currentDeviceIdentifier: duplicate.device_id as string,
  }));

  let serial = 9;
  const invoiceDate = candidates.find(
    (candidate) => candidate.target_field === 'invoice_issued_date',
  )!;
  for (const invoice of invoiceSourceCandidates(sourceAudit)) {
    const master = invoice.master as JsonRecord;
    const liveValues = emptyProjectedValues();
    liveValues.invoiceNumber = invoice.value;
    if (invoice.device_id === invoiceDate.device_id) {
      liveValues.invoiceIssuedDate = invoiceDate.value;
    }
    rows.push(snapshotRow({
      serial,
      sourceRow: master.source_row as number,
      sourceRowSha256: master.cached_values_sha256 as string,
      currentDeviceIdentifier: invoice.device_id as string,
      liveValues,
    }));
    serial += 1;
  }

  const expectedCurrentCount = MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount
    - MASTER_REGISTER_EXPECTED_SUMMARY.rowsWithoutCurrentIdentifier;
  while (rows.filter((row) => row.currentDeviceIdentifier !== null).length < expectedCurrentCount) {
    rows.push(snapshotRow({
      serial,
      sourceRow: 10_000 + serial,
      sourceRowSha256: digest(10_000 + serial),
      currentDeviceIdentifier: deviceId(serial, 'Z'),
    }));
    serial += 1;
  }
  while (rows.length < MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount) {
    rows.push(snapshotRow({
      serial,
      sourceRow: 10_000 + serial,
      sourceRowSha256: digest(10_000 + serial),
      currentDeviceIdentifier: null,
    }));
    serial += 1;
  }
  rows.sort((left, right) => Number(left.sourceRow) - Number(right.sourceRow)
    || String(left.entryId).localeCompare(String(right.entryId)));
  return {
    schema: METER_REGISTER_STRUCTURED_QA_SNAPSHOT_SCHEMA,
    target: 'qa',
    database: METER_REGISTER_STRUCTURED_QA_DATABASE,
    databaseSchema: 'public',
    searchPath: 'pg_catalog, pg_temp',
    databaseUser: 'sw_lane',
    databaseIdentitySha256: DATABASE_IDENTITY_SHA256,
    tableOids: TABLE_OIDS,
    source: {
      workbook: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
      sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
      workbookSha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
    },
    rowCount: rows.length,
    rows,
  };
}

function generateArtifacts(sourceAudit: JsonRecord, dbSnapshot: JsonRecord) {
  return generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit,
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshot,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedTarget: 'qa',
    expectedDatabaseIdentitySha256: DATABASE_IDENTITY_SHA256,
  });
}

test('maps all 1,440 source candidates into a complete selected/excluded ledger', () => {
  const sourceAudit = sourceAuditFixture();
  const snapshot = buildSnapshot(sourceAudit);
  const generated = generateArtifacts(sourceAudit, snapshot);
  const repeated = generateArtifacts(sourceAudit, snapshot);

  assert.equal(generated.ledger.candidates.length, METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT);
  assert.equal(generated.ledger.outcome.selectedRecordCount, 1);
  assert.equal(generated.ledger.outcome.selectedFieldCount, 2);
  assert.equal(generated.ledger.outcome.excludedFieldCount, 1_438);
  assert.equal(generated.ledger.outcome.exclusionCounts.manual_or_actor, 1);
  assert.equal(generated.ledger.outcome.exclusionCounts.immutable_source_nonblank, 1);
  assert.equal(generated.ledger.outcome.exclusionCounts.live_nonblank, 3);
  assert.equal(generated.ledger.outcome.exclusionCounts.duplicate_join, 1);
  assert.equal(generated.ledger.outcome.exclusionCounts.missing_join, 1_432);
  assert.equal(generated.ledger.outcome.alreadyMatchesCount, 2);
  assert.equal(generated.ledger.outcome.conflictingNonblankCount, 1);
  assert.equal(new Set(generated.ledger.candidates.map(
    (candidate) => candidate.sourceCandidateSha256,
  )).size, METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT);
  assert.equal(generated.manifest.candidates[0]!.fields.length, 2);
  assert.equal(generated.manifest.candidates[0]!.expectedRevision, 4);
  assert.deepEqual(generated.manifestBytes, repeated.manifestBytes);
  assert.deepEqual(generated.ledgerBytes, repeated.ledgerBytes);
  assert.equal(generated.ledger.sources.manifestSha256, generated.manifestSha256);
  assert.equal(generated.manifest.schemaVersion, 3);
  assert.equal(generated.manifest.sources.dbSnapshot.sha256, SNAPSHOT_SHA);
  assert.equal(generated.manifest.sources.dbSnapshot.target, 'qa');
  assert.equal(generated.ledger.sources.dbSnapshot.databaseIdentitySha256,
    DATABASE_IDENTITY_SHA256);
  assert.equal(parseWattwatchersMeterRegisterStructuredManifest(
    JSON.parse(generated.manifestBytes.toString('utf8')) as unknown,
  ).expected.recordUpdateCount, 1);
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
    generated.manifest,
    sourceAudit,
  ));
});

test('generates fresh production artifacts and rejects QA/production reuse', () => {
  const sourceAudit = sourceAuditFixture();
  const snapshot = buildSnapshot(sourceAudit);
  snapshot.target = 'production';
  snapshot.database = METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE;
  snapshot.databaseUser = 'sw_api';
  snapshot.databaseIdentitySha256 = `sha256:${'8'.repeat(64)}`;
  snapshot.tableOids = { imports: '2001', entries: '2002', records: '2003' };
  for (const row of snapshot.rows as JsonRecord[]) {
    row.databaseName = METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE;
    row.databaseUser = 'sw_api';
    row.tableOids = snapshot.tableOids;
  }
  const generated = generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit,
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshot: snapshot,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedTarget: 'production',
    expectedDatabaseIdentitySha256: snapshot.databaseIdentitySha256 as string,
  });
  assert.equal(generated.manifest.sources.dbSnapshot.target, 'production');
  assert.equal(generated.ledger.sources.dbSnapshot.target, 'production');
  assert.throws(() => generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit,
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshot: snapshot,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedTarget: 'qa',
    expectedDatabaseIdentitySha256: snapshot.databaseIdentitySha256 as string,
  }), /target does not match/u);
  assert.throws(() => generateWattwatchersMeterRegisterStructuredArtifacts({
    sourceAudit,
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshot: snapshot,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedTarget: 'production',
    expectedDatabaseIdentitySha256: DATABASE_IDENTITY_SHA256,
  }), /identity does not match/u);
});

test('fails closed on artifact tampering and source-row provenance mismatch', () => {
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterStructuredGeneratorDigests({
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedDbSnapshotSha256: SNAPSHOT_SHA,
  }));
  assert.throws(() => assertWattwatchersMeterRegisterStructuredGeneratorDigests({
    sourceAuditSha256: '0'.repeat(64),
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedDbSnapshotSha256: SNAPSHOT_SHA,
  }), /source audit bytes/u);
  assert.throws(() => assertWattwatchersMeterRegisterStructuredGeneratorDigests({
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    dbSnapshotSha256: SNAPSHOT_SHA,
    expectedDbSnapshotSha256: '0'.repeat(64),
  }), /snapshot bytes/u);

  const sourceAudit = sourceAuditFixture();
  const snapshot = buildSnapshot(sourceAudit);
  const firstCandidate = sourceCandidates(sourceAudit).find(
    (candidate) => candidate.target_field === 'service_type',
  )!;
  const row = (snapshot.rows as JsonRecord[]).find(
    (candidateRow) => candidateRow.currentDeviceIdentifier === firstCandidate.device_id,
  )!;
  row.sourceRowSha256 = 'f'.repeat(64);
  assert.throws(() => generateArtifacts(sourceAudit, snapshot), /provenance contradicts/u);
});

test('requires the complete invoice and date predecessor in the fresh DB snapshot', () => {
  const sourceAudit = sourceAuditFixture();
  const invoice = invoiceSourceCandidates(sourceAudit)[0]!;

  const missingInvoiceSnapshot = buildSnapshot(sourceAudit);
  const missingInvoiceRow = (missingInvoiceSnapshot.rows as JsonRecord[]).find(
    (row) => row.currentDeviceIdentifier === invoice.device_id,
  )!;
  (missingInvoiceRow.liveValues as JsonRecord).invoiceNumber = null;
  assert.throws(
    () => generateArtifacts(sourceAudit, missingInvoiceSnapshot),
    /all approved invoices in the fresh DB snapshot/u,
  );

  const missingDateSnapshot = buildSnapshot(sourceAudit);
  const missingDateRow = (missingDateSnapshot.rows as JsonRecord[]).find(
    (row) => row.currentDeviceIdentifier === invoice.device_id,
  )!;
  (missingDateRow.liveValues as JsonRecord).invoiceIssuedDate = null;
  assert.throws(
    () => generateArtifacts(sourceAudit, missingDateSnapshot),
    /approved invoice date in the fresh DB snapshot/u,
  );
});

test('allows unrelated invalid identifiers globally but requires exact candidate IDs', () => {
  const sourceAudit = sourceAuditFixture();
  const snapshot = buildSnapshot(sourceAudit);
  const unrelatedRows = (snapshot.rows as JsonRecord[]).filter(
    (row) => String(row.currentDeviceIdentifier).startsWith('Z'),
  );
  unrelatedRows[0]!.currentDeviceIdentifier = 'MALFORMED-ID';
  unrelatedRows[1]!.currentDeviceIdentifier = 'OTHER/HARDWARE-7';
  assert.doesNotThrow(() => generateArtifacts(sourceAudit, snapshot));

  const invalidCandidateAudit = sourceAuditFixture();
  sourceCandidates(invalidCandidateAudit)[0]!.device_id = 'MALFORMED-ID';
  assert.throws(() => generateArtifacts(
    invalidCandidateAudit,
    buildSnapshot(invalidCandidateAudit),
  ));
});

test('emits a safe empty manifest while retaining a complete outcome ledger', () => {
  const sourceAudit = sourceAuditFixture();
  const snapshot = buildSnapshot(sourceAudit);
  const service = sourceCandidates(sourceAudit).find(
    (candidate) => candidate.target_field === 'service_type',
  )!;
  const meter = sourceCandidates(sourceAudit).find(
    (candidate) => candidate.target_field === 'meter_type'
      && candidate.device_id === service.device_id,
  )!;
  const selectedRow = (snapshot.rows as JsonRecord[]).find(
    (row) => row.currentDeviceIdentifier === service.device_id,
  )!;
  const liveValues = selectedRow.liveValues as JsonRecord;
  liveValues.serviceType = service.value;
  liveValues.meterType = meter.value;

  const generated = generateArtifacts(sourceAudit, snapshot);
  assert.equal(generated.manifest.candidates.length, 0);
  assert.equal(generated.manifest.expected.recordUpdateCount, 0);
  assert.equal(generated.ledger.outcome.selectedFieldCount, 0);
  assert.equal(generated.ledger.outcome.excludedFieldCount, 1_440);
  assert.equal(generated.ledger.candidates.length, 1_440);
});

test('validates the complete ledger and byte-compares both regenerated artifacts', () => {
  const sourceAudit = sourceAuditFixture();
  const generated = generateArtifacts(sourceAudit, buildSnapshot(sourceAudit));
  assert.doesNotThrow(() => parseWattwatchersMeterRegisterStructuredOutcomeLedger(
    JSON.parse(generated.ledgerBytes.toString('utf8')) as unknown,
  ));
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch({
    generated,
    suppliedManifestBytes: generated.manifestBytes,
    suppliedLedgerBytes: generated.ledgerBytes,
  }));
  assert.throws(() => assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch({
    generated,
    suppliedManifestBytes: Buffer.concat([generated.manifestBytes, Buffer.from(' ')]),
    suppliedLedgerBytes: generated.ledgerBytes,
  }), /manifest is not the regenerated/u);
  assert.throws(() => assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch({
    generated,
    suppliedManifestBytes: generated.manifestBytes,
    suppliedLedgerBytes: Buffer.concat([generated.ledgerBytes, Buffer.from(' ')]),
  }), /ledger is not the regenerated/u);
});

test('rejects duplicate source candidates without losing one from the ledger', () => {
  const sourceAudit = sourceAuditFixture();
  const candidates = sourceCandidates(sourceAudit);
  candidates[1] = structuredClone(candidates[0]!);
  assert.throws(
    () => generateArtifacts(sourceAudit, buildSnapshot(sourceAudit)),
    /duplicate device field/u,
  );
});

test('writes both generated artifacts exclusively with mode 0600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'structured-manifest-'));
  const manifestPath = join(directory, 'manifest.json');
  const ledgerPath = join(directory, 'ledger.json');
  try {
    await writePrivateWattwatchersMeterRegisterStructuredArtifacts({
      manifestPath,
      manifestBytes: Buffer.from('{"manifest":true}\n'),
      ledgerPath,
      ledgerBytes: Buffer.from('{"ledger":true}\n'),
    });
    assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
    assert.equal((await stat(ledgerPath)).mode & 0o777, 0o600);
    assert.equal((await readFile(manifestPath, 'utf8')).trim(), '{"manifest":true}');
    assert.deepEqual((await readdir(directory)).sort(), ['ledger.json', 'manifest.json']);
    await assert.rejects(writePrivateWattwatchersMeterRegisterStructuredArtifacts({
      manifestPath,
      manifestBytes: Buffer.from('{}'),
      ledgerPath: join(directory, 'second-ledger.json'),
      ledgerBytes: Buffer.from('{}'),
    }), { code: 'EEXIST' });
    assert.deepEqual((await readdir(directory)).sort(), ['ledger.json', 'manifest.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes one generated SQL artifact atomically and exclusively with mode 0600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'structured-sql-'));
  const outputPath = join(directory, 'reconcile.sql');
  try {
    await writePrivateWattwatchersMeterRegisterStructuredArtifact(
      outputPath,
      Buffer.from('BEGIN;\nROLLBACK;\n'),
    );
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(await readFile(outputPath, 'utf8'), 'BEGIN;\nROLLBACK;\n');
    assert.deepEqual(await readdir(directory), ['reconcile.sql']);
    await assert.rejects(writePrivateWattwatchersMeterRegisterStructuredArtifact(
      outputPath,
      Buffer.from('COMMIT;\n'),
    ), { code: 'EEXIST' });
    assert.equal(await readFile(outputPath, 'utf8'), 'BEGIN;\nROLLBACK;\n');
    assert.deepEqual(await readdir(directory), ['reconcile.sql']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI requires private inputs and prints only aggregate evidence', async () => {
  const scriptUrl = new URL(
    '../../scripts/wattwatchers-meter-register-structured-manifest.ts',
    import.meta.url,
  );
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /readPrivateInput\(options\.sourceAuditPath/u);
  assert.match(script, /readPrivateInput\(options\.snapshotPath/u);
  assert.match(script, /constants\.O_NOFOLLOW/u);
  assert.match(script, /--snapshot-sha256/u);
  assert.match(script, /writePrivateWattwatchersMeterRegisterStructuredArtifacts/u);
  assert.match(script, /dbSnapshotSha256/u);
  assert.match(script, /--target/u);
  assert.match(script, /--database-identity-sha256/u);
  const consoleBlock = script.slice(script.indexOf('console.log(JSON.stringify({'));
  assert.doesNotMatch(consoleBlock, /currentDeviceIdentifier|entryId|\bvalue\b/u);

  const common = [
    '--source-audit', '/private/tmp/audit.json',
    '--snapshot', '/private/tmp/snapshot.json',
    '--snapshot-sha256', '0'.repeat(64),
    '--target', 'qa',
    '--database-identity-sha256', DATABASE_IDENTITY_SHA256,
    '--manifest-output', '/private/tmp/manifest.json',
  ];
  for (const tail of [
    ['--unknown', '/private/tmp/ledger.json'],
    ['--source-audit', '/private/tmp/duplicate.json'],
  ]) {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      fileURLToPath(scriptUrl),
      ...common,
      ...tail,
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid or duplicate options/u);
  }
});
