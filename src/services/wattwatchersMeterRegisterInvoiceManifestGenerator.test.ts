import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest,
  METER_REGISTER_RECONCILIATION_MASTER_SHEET,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
  parseWattwatchersMeterRegisterInvoiceReconciliationManifest,
} from './wattwatchersMeterRegisterInvoiceReconciliation.js';
import {
  assertWattwatchersMeterRegisterDbSnapshotDigest,
  buildWattwatchersMeterRegisterInvoiceManifest,
  generateWattwatchersMeterRegisterInvoiceManifest,
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_RECONCILIATION_QA_DATABASE,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
  METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
  readPrivateWattwatchersMeterRegisterReconciliationArtifact,
  writePrivateWattwatchersMeterRegisterInvoiceManifest,
} from './wattwatchersMeterRegisterInvoiceManifestGenerator.js';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deviceId(prefix: 'AA' | 'ZZ', index: number): string {
  return `${prefix}${String(index).padStart(11, '0')}`;
}

function rowEvidence(sourceRow: number) {
  return {
    audit_row_sha256: digest(`audit:${sourceRow}`),
    cached_values_sha256: digest(`cached:${sourceRow}`),
    formula_values_sha256: digest(`formula:${sourceRow}`),
    sheet: 'Works Planning',
    source_row: sourceRow,
  };
}

function fixtureSourceAudit() {
  let evidenceOrdinal = 0;
  const safeInvoiceFills = Array.from({ length: 92 }, (_, index) => {
    const evidenceCount = index < 3 ? 2 : 1;
    const invoiceNumber = `INV-SYNTH${String(index).padStart(4, '0')}`;
    const worksEvidence = Array.from({ length: evidenceCount }, (_, localIndex) => {
      const sourceRow = evidenceOrdinal + 2;
      const evidence = {
        ...rowEvidence(sourceRow),
        is_current_for_device: !(localIndex === 1 && index < 2),
        source_column: evidenceOrdinal < 6 ? 'XERO Date' : 'XERO Inv #',
        value: invoiceNumber,
        works_row: sourceRow,
      };
      evidenceOrdinal += 1;
      return evidence;
    });
    const masterSourceRow = index + 4;
    return {
      all_matching_works_rows: worksEvidence.map((evidence) => ({
        audit_row_sha256: evidence.audit_row_sha256,
        cached_values_sha256: evidence.cached_values_sha256,
        formula_values_sha256: evidence.formula_values_sha256,
        sheet: evidence.sheet,
        source_row: evidence.source_row,
      })),
      decision: 'safe_auto_fill',
      decision_rule: 'S1',
      device_id: deviceId('AA', index),
      distinct_invoice_numbers: [invoiceNumber],
      master: {
        audit_row_sha256: digest(`master-audit:${index}`),
        cached_values_sha256: digest(`master-cached:${index}`),
        formula_values_sha256: digest(`master-formula:${index}`),
        sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
        source_row: masterSourceRow,
      },
      target_field: 'xeroInvoiceNumber',
      value: invoiceNumber,
      works_evidence: worksEvidence,
    };
  });
  const dateInvoice = safeInvoiceFills[6]!;
  const dateEvidence = dateInvoice.works_evidence.find(
    (evidence) => evidence.is_current_for_device,
  )!;
  return {
    schema: METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
    repository_commit: METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
    sources: {
      master_register: {
        workbook_sha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
        sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      },
      sw_works_planning: {
        workbook_sha256:
          '900856dfc259c178235b55cd3255773d1037e40562b083dae1095543747cea9b',
        sheets: { 'Works Planning': {} },
      },
    },
    summary: { safe_invoice_fill_count: 92 },
    safe_invoice_fills: safeInvoiceFills,
    safe_other_fills: [{
      decision: 'safe_auto_fill',
      decision_rule: 'S2',
      device_id: dateInvoice.device_id,
      master: dateInvoice.master,
      source_works_header: 'XERO Date',
      target_field: 'invoice_issued_date',
      target_master_header: 'Inv issued date',
      value: '2026-01-02',
      works_evidence: [{
        audit_row_sha256: dateEvidence.audit_row_sha256,
        cached_values_sha256: dateEvidence.cached_values_sha256,
        formula_values_sha256: dateEvidence.formula_values_sha256,
        sheet: dateEvidence.sheet,
        source_row: dateEvidence.source_row,
      }],
    }],
  };
}

const TARGET_KEYS = [
  'invoiceNumber',
  'serviceType',
  'meteringSolutionType',
  'meterType',
  'fergusJobNumber',
  'quoteNumber',
  'purchaseOrderNumber',
  'jobCompletionDate',
  'jobCompletedBy',
  'hardwareInstalled',
  'maas',
  'invoiceIssuedDate',
  'status',
  'comments',
] as const;

function immutableValues(): Record<string, { snapshot: unknown; payload: unknown }> {
  return Object.fromEntries(TARGET_KEYS.map((key) => [key, { snapshot: null, payload: null }]));
}

function liveValues(): Record<string, unknown> {
  return Object.fromEntries(TARGET_KEYS.map((key) => [key, null]));
}

function fixtureDbSnapshot(sourceAudit: ReturnType<typeof fixtureSourceAudit>) {
  const byMasterRow = new Map(sourceAudit.safe_invoice_fills.map((candidate) => [
    candidate.master.source_row,
    candidate,
  ]));
  const rows = Array.from({ length: 1_917 }, (_, index) => {
    const sourceRow = index + 4;
    const candidate = byMasterRow.get(sourceRow);
    const hasCurrentIdentifier = index < 1_857;
    return {
      databaseName: METER_REGISTER_RECONCILIATION_QA_DATABASE,
      importId: 'wwmri_synthetic',
      sourceWorkbook: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
      sourceSheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      workbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
      importSourceRowCount: 1_917,
      entryId: `wwmre_${index.toString(16).padStart(32, '0')}`,
      entryImportId: 'wwmri_synthetic',
      sourceKey: `synthetic:${sourceRow}`,
      sourceRow,
      sourceRowSha256: candidate?.master.cached_values_sha256 ?? digest(`db-row:${sourceRow}`),
      currentDeviceIdentifier: candidate?.device_id
        ?? (hasCurrentIdentifier ? deviceId('ZZ', index) : null),
      recordRevision: hasCurrentIdentifier ? 1 : null,
      recordManuallyCorrectedAt: null as string | null,
      recordUpdatedByUserId: null as string | null,
      immutableValues: immutableValues(),
      liveValues: liveValues(),
    };
  });
  return {
    schema: METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
    database: METER_REGISTER_RECONCILIATION_QA_DATABASE,
    source: {
      workbook: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
      sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      workbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
    },
    rowCount: rows.length,
    rows,
  };
}

function fixtures() {
  const sourceAudit = fixtureSourceAudit();
  return { sourceAudit, dbSnapshot: fixtureDbSnapshot(sourceAudit) };
}

function buildFixtureManifest(input = fixtures()) {
  const dbSnapshotBytes = Buffer.from(JSON.stringify(input.dbSnapshot), 'utf8');
  return buildWattwatchersMeterRegisterInvoiceManifest({
    ...input,
    sourceAuditSha256: METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
    dbSnapshotSha256: digest(dbSnapshotBytes.toString('utf8')),
  });
}

test('deterministically generates the exact CLI-compatible 92-invoice and one-date manifest', () => {
  const input = fixtures();
  const first = buildFixtureManifest(input);
  const second = buildFixtureManifest(input);
  assert.deepEqual(first.manifestBytes, second.manifestBytes);
  assert.equal(first.manifest.candidates.length, 92);
  assert.equal(first.manifest.expected.invoiceNumberUpdateCount, 92);
  assert.equal(first.manifest.expected.invoiceDateUpdateCount, 1);
  assert.match(first.invoiceEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(first.manifest.schemaVersion, 2);
  assert.equal(first.manifest.provenance.sourceAudit.sha256,
    METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256);
  assert.equal(first.manifest.provenance.invoiceEvidence.rowCount, 95);
  assert.equal(
    first.manifest.candidates.flatMap((candidate) => candidate.worksPlanningEvidence).length,
    95,
  );
  assert.equal(
    first.manifest.candidates.filter((candidate) => candidate.invoiceIssuedDate !== null).length,
    1,
  );
  const parsed = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    JSON.parse(first.manifestBytes.toString('utf8')) as unknown,
  );
  assert.doesNotThrow(
    () => assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest(parsed),
  );
});

test('fails closed when a source candidate is missing or duplicated in the DB snapshot', () => {
  const missing = fixtures();
  missing.dbSnapshot.rows[0]!.currentDeviceIdentifier = deviceId('ZZ', 1_900);
  assert.throws(
    () => buildFixtureManifest(missing),
    /does not resolve uniquely/u,
  );

  const duplicate = fixtures();
  duplicate.dbSnapshot.rows[100]!.currentDeviceIdentifier =
    duplicate.sourceAudit.safe_invoice_fills[0]!.device_id;
  assert.throws(
    () => buildFixtureManifest(duplicate),
    /does not resolve uniquely/u,
  );
});

test('allows unrelated malformed and alternate-hardware identifiers in the complete snapshot', () => {
  const input = fixtures();
  input.dbSnapshot.rows[500]!.currentDeviceIdentifier = 'MALFORMED-ID';
  input.dbSnapshot.rows[501]!.currentDeviceIdentifier = 'OTHER/HARDWARE-7';
  input.dbSnapshot.rows[502]!.currentDeviceIdentifier = '';
  assert.doesNotThrow(() => buildFixtureManifest(input));
});

test('rejects manual/actor changes and any populated immutable or live invoice value', () => {
  const manual = fixtures();
  manual.dbSnapshot.rows[0]!.recordManuallyCorrectedAt = '2026-09-08T00:00:00.000Z';
  assert.throws(
    () => buildFixtureManifest(manual),
    /no longer invoice-eligible/u,
  );

  const actor = fixtures();
  actor.dbSnapshot.rows[0]!.recordUpdatedByUserId = 'synthetic-actor';
  assert.throws(
    () => buildFixtureManifest(actor),
    /no longer invoice-eligible/u,
  );

  for (const mutate of [
    (snapshot: ReturnType<typeof fixtureDbSnapshot>) => {
      snapshot.rows[0]!.immutableValues.invoiceNumber.snapshot = 'already-populated';
    },
    (snapshot: ReturnType<typeof fixtureDbSnapshot>) => {
      snapshot.rows[0]!.immutableValues.invoiceNumber.payload = 'already-populated';
    },
    (snapshot: ReturnType<typeof fixtureDbSnapshot>) => {
      snapshot.rows[0]!.liveValues.invoiceNumber = 'already-populated';
    },
  ]) {
    const input = fixtures();
    mutate(input.dbSnapshot);
    assert.throws(
      () => buildFixtureManifest(input),
      /no longer invoice-eligible/u,
    );
  }
});

test('rejects a populated invoice date on the sole approved date candidate', () => {
  const input = fixtures();
  input.dbSnapshot.rows[6]!.liveValues.invoiceIssuedDate = '2026-09-08';
  assert.throws(
    () => buildFixtureManifest(input),
    /no longer date-eligible/u,
  );
});

test('rejects changed Master provenance and an incomplete 95-row Works evidence set', () => {
  const changedMaster = fixtures();
  changedMaster.sourceAudit.safe_invoice_fills[0]!.master.cached_values_sha256 = digest('changed');
  assert.throws(
    () => buildFixtureManifest(changedMaster),
    /changed source provenance/u,
  );

  const changedEvidence = fixtures();
  changedEvidence.sourceAudit.safe_invoice_fills[0]!.works_evidence.pop();
  assert.throws(
    () => buildFixtureManifest(changedEvidence),
    /approved 95-row set/u,
  );
});

test('byte-level generation rejects any source audit other than the pinned protected audit', () => {
  const input = fixtures();
  assert.throws(() => generateWattwatchersMeterRegisterInvoiceManifest({
    sourceAuditBytes: Buffer.from(JSON.stringify(input.sourceAudit), 'utf8'),
    dbSnapshotBytes: Buffer.from(JSON.stringify(input.dbSnapshot), 'utf8'),
    expectedDbSnapshotSha256: digest(JSON.stringify(input.dbSnapshot)),
  }), /approved SHA-256 digest/u);
});

test('byte-level generation rejects a snapshot that differs from its reviewed digest', () => {
  const input = fixtures();
  const dbSnapshotBytes = Buffer.from(JSON.stringify(input.dbSnapshot), 'utf8');
  assert.equal(
    assertWattwatchersMeterRegisterDbSnapshotDigest(dbSnapshotBytes, digest(dbSnapshotBytes.toString('utf8'))),
    digest(dbSnapshotBytes.toString('utf8')),
  );
  assert.throws(
    () => assertWattwatchersMeterRegisterDbSnapshotDigest(
      dbSnapshotBytes,
      digest('different snapshot'),
    ),
    /independently captured SHA-256 digest/u,
  );
});

test('writes the generated manifest atomically and exclusively with mode 0600', async () => {
  const built = buildFixtureManifest();
  const directory = await mkdtemp(join(tmpdir(), 'ww-invoice-manifest-'));
  const outputPath = join(directory, 'manifest.json');
  try {
    await writePrivateWattwatchersMeterRegisterInvoiceManifest(outputPath, built.manifestBytes);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(outputPath), built.manifestBytes);
    await assert.rejects(
      writePrivateWattwatchersMeterRegisterInvoiceManifest(outputPath, built.manifestBytes),
      { code: 'EEXIST' },
    );
    assert.deepEqual(await readdir(directory), ['manifest.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reads only regular reconciliation artifacts protected from group and other users', async () => {
  const built = buildFixtureManifest();
  const directory = await mkdtemp(join(tmpdir(), 'ww-invoice-private-read-'));
  const inputPath = join(directory, 'manifest.json');
  const symlinkPath = join(directory, 'manifest-link.json');
  try {
    await writePrivateWattwatchersMeterRegisterInvoiceManifest(inputPath, built.manifestBytes);
    assert.deepEqual(
      await readPrivateWattwatchersMeterRegisterReconciliationArtifact(
        inputPath,
        'Invoice manifest',
      ),
      built.manifestBytes,
    );
    await symlink(inputPath, symlinkPath);
    await assert.rejects(
      readPrivateWattwatchersMeterRegisterReconciliationArtifact(
        symlinkPath,
        'Invoice manifest',
      ),
      { code: 'ELOOP' },
    );
    await chmod(inputPath, 0o640);
    await assert.rejects(
      readPrivateWattwatchersMeterRegisterReconciliationArtifact(
        inputPath,
        'Invoice manifest',
      ),
      /inaccessible to group and other users/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI checks both private inputs and reports only counts and digests', async () => {
  const script = await readFile(
    new URL('../../scripts/wattwatchers-meter-register-invoice-manifest.ts', import.meta.url),
    'utf8',
  );
  assert.match(script, /readPrivateWattwatchersMeterRegisterReconciliationArtifact/u);
  assert.match(script, /--snapshot-sha256/u);
  assert.match(script, /sourceAuditSha256/u);
  assert.match(script, /dbSnapshotSha256/u);
  assert.match(script, /invoiceEvidenceSha256/u);
  assert.match(script, /manifestSha256/u);
  assert.doesNotMatch(script, /console\.log\([^)]*(?:entryId|deviceIdentifier|invoiceNumber)/u);
});
