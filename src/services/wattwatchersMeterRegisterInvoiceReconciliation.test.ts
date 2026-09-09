import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest,
  assertWattwatchersMeterRegisterInvoiceReconciliationDigests,
  buildWattwatchersMeterRegisterInvoiceReconciliationSql,
  computeWattwatchersMeterRegisterInvoiceEvidenceSha256,
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_RECONCILIATION_QA_DATABASE,
  METER_REGISTER_RECONCILIATION_MASTER_SHEET,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
  METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
  METER_REGISTER_RECONCILIATION_WORKS_SHEET,
  METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK,
  METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
  type WattwatchersMeterRegisterInvoiceReconciliationCandidate,
  parseWattwatchersMeterRegisterInvoiceReconciliationManifest,
} from './wattwatchersMeterRegisterInvoiceReconciliation.js';

const SYNTHETIC_INVOICE = ['INV', 'SYNTHETIC001'].join('-');
const SYNTHETIC_ENTRY_ID = `wwmre_${'a'.repeat(32)}`;
const SYNTHETIC_DEVICE_ID = 'AB12345678901';

function fixtureCandidate(): WattwatchersMeterRegisterInvoiceReconciliationCandidate {
  const worksPlanningEvidence: WattwatchersMeterRegisterInvoiceReconciliationCandidate[
    'worksPlanningEvidence'
  ] = [{
    sourceRow: 2,
    worksRow: 2,
    auditRowSha256: 'c'.repeat(64),
    cachedValuesSha256: 'd'.repeat(64),
    formulaValuesSha256: 'e'.repeat(64),
    sheet: METER_REGISTER_RECONCILIATION_WORKS_SHEET,
    isCurrentForDevice: true,
    sourceColumn: 'XERO Inv #' as const,
    value: SYNTHETIC_INVOICE,
  }];
  return {
    entryId: SYNTHETIC_ENTRY_ID,
    masterSourceRow: 4,
    masterSourceRowSha256: 'b'.repeat(64),
    currentDeviceIdentifier: SYNTHETIC_DEVICE_ID,
    expectedRevision: 1,
    worksPlanningEvidence,
    matchKind: 'current_device',
    worksPlanningInvoiceEventCount: 1,
    reviewDecision: 'safe',
    masterInvoiceNumber: null,
    masterInvoiceIssuedDateBlank: true,
    hasInvoiceConflict: false,
    invoiceNumber: SYNTHETIC_INVOICE,
    invoiceIssuedDate: '2026-01-02',
    invoiceDateSourceColumn: 'XERO Date',
    invoiceDateEvidence: {
      sourceRow: 2,
      auditRowSha256: 'c'.repeat(64),
      cachedValuesSha256: 'd'.repeat(64),
      formulaValuesSha256: 'e'.repeat(64),
      sheet: METER_REGISTER_RECONCILIATION_WORKS_SHEET,
      sourceColumn: 'XERO Date',
    },
  };
}

function fixtureManifest(candidate: Record<string, unknown> = fixtureCandidate()) {
  const candidates = [candidate] as unknown as WattwatchersMeterRegisterInvoiceReconciliationCandidate[];
  const worksPlanningEvidence = candidate.worksPlanningEvidence as Array<{
    isCurrentForDevice: boolean;
    sourceColumn: string;
  }>;
  return {
    schemaVersion: 2,
    provenance: {
      sourceAudit: {
        schema: METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
        sha256: METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
        repositoryCommit: METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
      },
      dbSnapshot: {
        schema: METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
        sha256: 'f'.repeat(64),
        database: METER_REGISTER_RECONCILIATION_QA_DATABASE,
      },
      invoiceEvidence: {
        rowCount: worksPlanningEvidence.length,
        currentRowCount: worksPlanningEvidence.filter(
          (evidence) => evidence.isCurrentForDevice,
        ).length,
        xeroDateValueRowCount: worksPlanningEvidence.filter(
          (evidence) => evidence.sourceColumn === 'XERO Date',
        ).length,
        sha256: computeWattwatchersMeterRegisterInvoiceEvidenceSha256(candidates),
      },
    },
    sources: {
      masterRegister: {
        workbook: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
        workbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
        sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      },
      worksPlanning: {
        workbook: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK,
        workbookSha256: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
        sheet: METER_REGISTER_RECONCILIATION_WORKS_SHEET,
      },
    },
    expected: {
      matchedCount: 1,
      invoiceNumberUpdateCount: 1,
      invoiceDateUpdateCount: candidate.invoiceIssuedDate === null ? 0 : 1,
    },
    candidates,
  };
}

test('builds a guarded, transaction-scoped dry-run that only fills blank operational invoice fields', () => {
  const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(fixtureManifest());
  const built = buildWattwatchersMeterRegisterInvoiceReconciliationSql({
    manifest,
    mode: 'dry-run',
  });

  assert.equal(built.matchedCount, 1);
  assert.equal(built.invoiceNumberUpdateCount, 1);
  assert.equal(built.invoiceDateUpdateCount, 1);
  assert.match(built.sql, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.match(built.sql, /pg_advisory_xact_lock/u);
  assert.match(built.sql, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(built.sql, /SET LOCAL statement_timeout = '5min'/u);
  assert.match(
    built.sql,
    /IF current_database\(\) <> 'sw_ecoaudit_fixes' THEN/u,
  );
  assert.match(built.sql, /invoice_reconcile_provenance/u);
  assert.match(built.sql, /source_audit_sha256/u);
  assert.match(built.sql, /db_snapshot_sha256/u);
  assert.match(built.sql, /invoice_evidence_sha256/u);
  assert.match(built.sql, /invoice_reconcile_works_evidence_stage/u);
  assert.match(built.sql, /works_cached_values_sha256/u);
  assert.match(built.sql, /works_formula_values_sha256/u);
  assert.match(built.sql, /staged Works evidence count changed/u);
  assert.match(built.sql, /entry\.source_row_sha256 = stage\.master_source_row_sha256/u);
  assert.match(built.sql, /entry\.current_device_identifier = stage\.current_device_identifier/u);
  assert.match(built.sql, /record\.revision = stage\.expected_revision/u);
  assert.match(built.sql, /record\.manually_corrected_at IS NULL/u);
  assert.match(built.sql, /record\.updated_by_user_id IS NULL/u);
  assert.match(built.sql, /NULLIF\(btrim\(record\.details ->> 'xeroInvoiceNumber'\), ''\) IS NULL/u);
  assert.match(built.sql, /NULLIF\(btrim\(record\.details ->> 'invoiceIssuedDate'\), ''\) IS NULL/u);
  assert.match(built.sql, /revision = record\.revision \+ 1/u);
  assert.match(built.sql, /updated_at = clock_timestamp\(\)/u);
  assert.match(built.sql, /partially applied/u);
  assert.match(built.sql, /AS invoice_date_updated_count/u);
  assert.match(built.sql, /AS expected_invoice_date_count/u);
  assert.match(built.sql, /AS initially_pending_count/u);
  assert.match(built.sql, /AS initially_applied_count/u);
  assert.match(built.sql, /AS verified_count/u);
  assert.match(built.sql, /ROLLBACK;\n$/u);

  assert.doesNotMatch(built.sql, /UPDATE\s+ww_meter_register_entries/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+(?:business_clients|business_sites|ww_devices)/u);
  assert.doesNotMatch(built.sql, /SET[\s\S]*updated_by_user_id\s*=/u);
  assert.doesNotMatch(built.sql, /SET[\s\S]*manually_corrected_at\s*=/u);
  assert.doesNotMatch(built.sql, /DELETE FROM|TRUNCATE|DROP TABLE/u);
});

test('apply SQL accepts only all-pending or all-applied state and therefore has a zero-update rerun', () => {
  const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(fixtureManifest());
  const built = buildWattwatchersMeterRegisterInvoiceReconciliationSql({
    manifest,
    mode: 'apply',
  });

  assert.match(built.sql, /pending_count = 1 AND applied_count = 0/u);
  assert.match(built.sql, /pending_count = 0 AND applied_count = 1/u);
  assert.match(built.sql, /record\.revision = stage\.expected_revision \+ 1/u);
  assert.match(built.sql, /updated_count <> pending_count/u);
  assert.match(built.sql, /COMMIT;\n$/u);
});

test('old or superseded identifier matches cannot enter the reconciliation manifest', () => {
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), matchKind: 'old_or_superseded' }),
  ));
});

test('ambiguous multi-event matches cannot enter the reconciliation manifest', () => {
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), worksPlanningInvoiceEventCount: 2 }),
  ));
});

test('NA markers cannot enter as invoice numbers', () => {
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), invoiceNumber: 'NA MaaS' }),
  ));
});

test('current device identifiers must be exactly 13 uppercase ASCII letters or digits', () => {
  for (const currentDeviceIdentifier of [
    'AB1234567890',
    'AB123456789012',
    'ÅB12345678901',
    'ab12345678901',
  ]) {
    assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
      fixtureManifest({ ...fixtureCandidate(), currentDeviceIdentifier }),
    ));
  }
});

test('populated Master values or explicit conflicts cannot enter the reconciliation manifest', () => {
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), masterInvoiceNumber: SYNTHETIC_INVOICE }),
  ));
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), hasInvoiceConflict: true }),
  ));
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({ ...fixtureCandidate(), masterInvoiceIssuedDateBlank: false }),
  ));
});

test('a misplaced invoice number cannot also be interpreted as a date', () => {
  const candidate = fixtureCandidate();
  assert.throws(() => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
    fixtureManifest({
      ...candidate,
      worksPlanningEvidence: candidate.worksPlanningEvidence.map((evidence) => ({
        ...evidence,
        sourceColumn: 'XERO Date',
      })),
    }),
  ));
});

test('invoice-date provenance must share a current invoice-evidence row', () => {
  const candidate = fixtureCandidate();
  const nonCurrentEvidence = {
    ...candidate.worksPlanningEvidence[0]!,
    sourceRow: 3,
    worksRow: 3,
    auditRowSha256: '1'.repeat(64),
    cachedValuesSha256: '2'.repeat(64),
    formulaValuesSha256: '3'.repeat(64),
    isCurrentForDevice: false,
  };
  candidate.worksPlanningEvidence.push(nonCurrentEvidence);
  candidate.invoiceDateEvidence = {
    sourceRow: nonCurrentEvidence.sourceRow,
    auditRowSha256: nonCurrentEvidence.auditRowSha256,
    cachedValuesSha256: nonCurrentEvidence.cachedValuesSha256,
    formulaValuesSha256: nonCurrentEvidence.formulaValuesSha256,
    sheet: METER_REGISTER_RECONCILIATION_WORKS_SHEET,
    sourceColumn: 'XERO Date',
  };
  assert.throws(
    () => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
      fixtureManifest(candidate),
    ),
    /current invoice-evidence Works row/u,
  );
});

test('duplicate entry, source-row, or current-device identity is rejected', () => {
  const candidate = fixtureCandidate();
  const duplicate = {
    ...candidate,
    invoiceIssuedDate: null,
    invoiceDateSourceColumn: null,
    invoiceDateEvidence: null,
    worksPlanningEvidence: candidate.worksPlanningEvidence.map((evidence) => ({
      ...evidence,
      sourceRow: 3,
      worksRow: 3,
    })),
  };
  const manifest = fixtureManifest(candidate);
  manifest.expected.matchedCount = 2;
  manifest.expected.invoiceNumberUpdateCount = 2;
  manifest.expected.invoiceDateUpdateCount = 1;
  manifest.candidates.push(duplicate);
  assert.throws(
    () => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(manifest),
    /Duplicate reconciliation entryId/u,
  );
});

test('manifest provenance and the complete Works evidence digest are fail-closed', () => {
  const wrongSnapshot = fixtureManifest();
  wrongSnapshot.provenance.dbSnapshot.database = 'postgres';
  assert.throws(
    () => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(wrongSnapshot),
  );

  const changedEvidence = fixtureManifest();
  changedEvidence.candidates[0]!.worksPlanningEvidence[0]!.cachedValuesSha256 = '0'.repeat(64);
  changedEvidence.candidates[0]!.invoiceDateEvidence!.cachedValuesSha256 = '0'.repeat(64);
  assert.throws(
    () => parseWattwatchersMeterRegisterInvoiceReconciliationManifest(changedEvidence),
    /evidence digest/u,
  );
});

test('artifact digests bind both workbooks and the private manifest bytes', () => {
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterInvoiceReconciliationDigests({
    masterWorkbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
    worksWorkbookSha256: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
    manifestSha256: 'd'.repeat(64),
    expectedManifestSha256: 'd'.repeat(64),
  }));
  assert.throws(() => assertWattwatchersMeterRegisterInvoiceReconciliationDigests({
    masterWorkbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
    worksWorkbookSha256: '0'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    expectedManifestSha256: 'd'.repeat(64),
  }), /Works Planning workbook bytes/u);
  assert.throws(() => assertWattwatchersMeterRegisterInvoiceReconciliationDigests({
    masterWorkbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
    worksWorkbookSha256: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
    manifestSha256: 'd'.repeat(64),
    expectedManifestSha256: 'e'.repeat(64),
  }), /manifest bytes/u);
});

test('the executable CLI enforces approved 92/1 counts and private exclusive output', async () => {
  const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest(fixtureManifest());
  assert.throws(
    () => assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest(manifest),
    /exactly 92 invoice numbers, one date/u,
  );

  const script = await readFile(
    new URL('../../scripts/wattwatchers-meter-register-invoice-reconcile.ts', import.meta.url),
    'utf8',
  );
  assert.match(script, /const mode = value \?\? 'dry-run'/u);
  assert.match(script, /readPrivateWattwatchersMeterRegisterReconciliationArtifact/u);
  assert.match(script, /--source-audit/u);
  assert.match(script, /--db-snapshot/u);
  assert.match(script, /--snapshot-sha256/u);
  assert.match(script, /generateWattwatchersMeterRegisterInvoiceManifest/u);
  assert.match(script, /manifestBytes\.equals\(generated\.manifestBytes\)/u);
  assert.match(script, /writePrivateWattwatchersMeterRegisterReconciliationArtifact/u);
  assert.match(script, /sqlSha256/u);
  assert.doesNotMatch(script, /console\.log\([^)]*(?:manifest\.candidates|candidate\.invoiceNumber)/u);
});
