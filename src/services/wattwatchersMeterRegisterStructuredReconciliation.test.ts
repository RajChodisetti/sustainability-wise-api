import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertWattwatchersMeterRegisterStructuredArtifactDigests,
  assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit,
  buildWattwatchersMeterRegisterStructuredReconciliationSql,
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT,
  METER_REGISTER_STRUCTURED_MASTER_SHEET,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
  METER_REGISTER_STRUCTURED_WORKS_SHEET,
  METER_REGISTER_STRUCTURED_WORKS_WORKBOOK,
  METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
  parseWattwatchersMeterRegisterStructuredManifest,
  wattwatchersMeterRegisterStructuredAuditedFieldCounts,
} from './wattwatchersMeterRegisterStructuredReconciliation.js';

const SYNTHETIC_ENTRY_ID = `wwmre_${'a'.repeat(32)}`;
const SYNTHETIC_DEVICE_ID = 'AB12345678901';

test('pins 1,072 structured detail fields plus 11 audited invoice dates', () => {
  const counts = wattwatchersMeterRegisterStructuredAuditedFieldCounts();
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  assert.equal(total - counts.invoiceIssuedDate, 1_072);
  assert.equal(counts.invoiceIssuedDate, 11);
});

function worksEvidence(sourceRow: number, hashCharacter: string) {
  return {
    sheet: METER_REGISTER_STRUCTURED_WORKS_SHEET,
    sourceRow,
    auditRowSha256: hashCharacter.repeat(64),
    cachedValuesSha256: hashCharacter.repeat(64),
    formulaValuesSha256: hashCharacter.repeat(64),
  };
}

function fixtureFields() {
  return [
    {
      key: 'serviceType',
      auditTargetField: 'service_type',
      value: 'Synthetic service',
      auditDecision: 'safe_auto_fill',
      auditDecisionRule: 'S2',
      worksHeader: 'Service Type',
      masterHeader: 'Service Type',
      worksEvidence: [worksEvidence(2, 'd'), worksEvidence(3, 'e')],
    },
    {
      key: 'jobCompletionDate',
      auditTargetField: 'job_completion_date',
      value: '2026-01-02',
      auditDecision: 'safe_auto_fill',
      auditDecisionRule: 'S2',
      worksHeader: 'Job Completion Date',
      masterHeader: 'Job Completion Date',
      worksEvidence: [worksEvidence(2, 'd')],
    },
    {
      key: 'maas',
      auditTargetField: 'maas',
      value: false,
      auditDecision: 'safe_auto_fill',
      auditDecisionRule: 'S2',
      worksHeader: 'MaaS (Yes/No)',
      masterHeader: 'MaaS (Yes/No)',
      worksEvidence: [worksEvidence(2, 'd')],
    },
  ];
}

function fixtureCandidate(fields: Record<string, unknown>[] = fixtureFields()) {
  return {
    entryId: SYNTHETIC_ENTRY_ID,
    masterSourceRow: 4,
    masterSourceRowSha256: '1'.repeat(64),
    masterAuditRowSha256: '2'.repeat(64),
    masterCachedValuesSha256: '3'.repeat(64),
    masterFormulaValuesSha256: '4'.repeat(64),
    currentDeviceIdentifier: SYNTHETIC_DEVICE_ID,
    expectedRevision: 1,
    expectedUpdatedByUserId: null,
    expectedManuallyCorrectedAt: null,
    fields,
  };
}

function fieldCounts(fields: Record<string, unknown>[]) {
  const counts = Object.fromEntries(
    Object.keys(wattwatchersMeterRegisterStructuredAuditedFieldCounts()).map((key) => [key, 0]),
  ) as Record<string, number>;
  for (const field of fields) counts[String(field.key)]! += 1;
  return counts;
}

function fixtureManifest(candidate: Record<string, unknown> = fixtureCandidate()) {
  const fields = candidate.fields as Record<string, unknown>[];
  return {
    schemaVersion: 1,
    sources: {
      masterRegister: {
        workbook: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
        workbookSha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
        sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
      },
      worksPlanning: {
        workbook: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK,
        workbookSha256: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
        sheet: METER_REGISTER_STRUCTURED_WORKS_SHEET,
      },
      sourceAudit: {
        schema: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
        sha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
        repositoryCommit: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
        auditedFieldCounts: wattwatchersMeterRegisterStructuredAuditedFieldCounts(),
      },
    },
    expected: {
      recordUpdateCount: 1,
      fieldUpdateCounts: fieldCounts(fields),
    },
    candidates: [candidate],
  };
}

function sourceAuditFixture(
  manifest = parseWattwatchersMeterRegisterStructuredManifest(fixtureManifest()),
) {
  const safeOtherFills: Record<string, unknown>[] = [];
  const includedCounts = fieldCounts([]);
  for (const candidate of manifest.candidates) {
    for (const field of candidate.fields) {
      const contract = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[field.key];
      safeOtherFills.push({
        decision: field.auditDecision,
        decision_rule: field.auditDecisionRule,
        device_id: candidate.currentDeviceIdentifier,
        target_field: field.auditTargetField,
        target_master_header: field.masterHeader,
        source_works_header: field.worksHeader,
        value: field.value,
        master: {
          sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
          source_row: candidate.masterSourceRow,
          audit_row_sha256: candidate.masterAuditRowSha256,
          cached_values_sha256: candidate.masterCachedValuesSha256,
          formula_values_sha256: candidate.masterFormulaValuesSha256,
        },
        works_evidence: field.worksEvidence.map((evidence) => ({
          sheet: evidence.sheet,
          source_row: evidence.sourceRow,
          audit_row_sha256: evidence.auditRowSha256,
          cached_values_sha256: evidence.cachedValuesSha256,
          formula_values_sha256: evidence.formulaValuesSha256,
        })),
      });
      includedCounts[field.key] += 1;
    }
  }

  let serial = 1;
  for (const key of Object.keys(METER_REGISTER_STRUCTURED_FIELD_CONTRACT) as Array<
    keyof typeof METER_REGISTER_STRUCTURED_FIELD_CONTRACT
  >) {
    const contract = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key];
    while (includedCounts[key] < contract.sourceAuditCount) {
      serial += 1;
      const digest = serial.toString(16).padStart(64, '0');
      const value = contract.valueType === 'boolean'
        ? false
        : contract.valueType === 'date'
          ? '2026-01-02'
          : `Synthetic ${key} ${serial}`;
      safeOtherFills.push({
        decision: 'safe_auto_fill',
        decision_rule: 'S2',
        device_id: `A${String(serial).padStart(12, '0')}`,
        target_field: contract.auditTargetField,
        target_master_header: contract.masterHeader,
        source_works_header: contract.worksHeader,
        value,
        master: {
          sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
          source_row: serial + 4,
          audit_row_sha256: digest,
          cached_values_sha256: digest,
          formula_values_sha256: digest,
        },
        works_evidence: [{
          sheet: METER_REGISTER_STRUCTURED_WORKS_SHEET,
          source_row: serial + 2,
          audit_row_sha256: digest,
          cached_values_sha256: digest,
          formula_values_sha256: digest,
        }],
      });
      includedCounts[key] += 1;
    }
  }

  return {
    schema: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
    repository_commit: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
    sources: {
      master_register: {
        workbook_sha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
      },
      sw_works_planning: {
        workbook_sha256: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
      },
    },
    safe_other_fills: safeOtherFills,
  };
}

test('builds an all-or-none dry-run for multiple blank structured fields on one record', () => {
  const manifest = parseWattwatchersMeterRegisterStructuredManifest(fixtureManifest());
  const built = buildWattwatchersMeterRegisterStructuredReconciliationSql({
    manifest,
    mode: 'dry-run',
  });

  assert.equal(built.recordUpdateCount, 1);
  assert.equal(built.fieldUpdateCounts.serviceType, 1);
  assert.equal(built.fieldUpdateCounts.jobCompletionDate, 1);
  assert.equal(built.fieldUpdateCounts.maas, 1);
  assert.match(built.sql, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.match(built.sql, /pg_advisory_xact_lock/u);
  assert.match(built.sql, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(built.sql, /SET LOCAL statement_timeout = '5min'/u);
  assert.match(built.sql, /entry\.source_row_sha256 = stage\.master_source_row_sha256/u);
  assert.match(built.sql, /entry\.current_device_identifier = stage\.current_device_identifier/u);
  assert.match(built.sql, /entry\.source_payload ->> field\.master_header/u);
  assert.match(built.sql, /record\.manually_corrected_at IS NULL/u);
  assert.match(built.sql, /record\.updated_by_user_id IS NULL/u);
  assert.match(built.sql, /record\.details \|\| state\.patch/u);
  assert.match(built.sql, /revision = record\.revision \+ 1/u);
  assert.match(built.sql, /updated_at = clock_timestamp\(\)/u);
  assert.match(built.sql, /updated_field_counts/u);
  assert.match(built.sql, /expected_field_counts/u);
  assert.match(built.sql, /initially_pending_record_count/u);
  assert.match(built.sql, /initially_applied_record_count/u);
  assert.match(built.sql, /verified_record_count/u);
  assert.match(built.sql, /ROLLBACK;\n$/u);

  assert.doesNotMatch(built.sql, /UPDATE\s+ww_meter_register_entries/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+(?:business_clients|business_sites|ww_devices)/u);
  assert.doesNotMatch(built.sql, /SET[\s\S]*updated_by_user_id\s*=/u);
  assert.doesNotMatch(built.sql, /SET[\s\S]*manually_corrected_at\s*=/u);
  assert.doesNotMatch(built.sql, /DELETE FROM|TRUNCATE|DROP TABLE/u);
});

test('allows and individually binds multiple identical-value Works evidence rows', () => {
  const manifest = parseWattwatchersMeterRegisterStructuredManifest(fixtureManifest());
  const evidence = manifest.candidates[0]!.fields[0]!.worksEvidence;
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0]!.cachedValuesSha256, 'd'.repeat(64));
  assert.equal(evidence[1]!.cachedValuesSha256, 'e'.repeat(64));
});

test('requires every live field to be an exact subset of the pinned S2 source audit', () => {
  const manifest = parseWattwatchersMeterRegisterStructuredManifest(fixtureManifest());
  const sourceAudit = sourceAuditFixture(manifest);
  assert.doesNotThrow(() => (
    assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(manifest, sourceAudit)
  ));

  const changedValue = structuredClone(manifest);
  changedValue.candidates[0]!.fields[0]!.value = 'Altered service';
  assert.throws(
    () => assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
      changedValue,
      sourceAudit,
    ),
    /no unique source audit match/u,
  );

  const changedEvidence = structuredClone(manifest);
  changedEvidence.candidates[0]!.fields[0]!.worksEvidence[1]!.cachedValuesSha256 = 'f'.repeat(64);
  assert.throws(
    () => assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
      changedEvidence,
      sourceAudit,
    ),
    /no unique source audit match/u,
  );
});

test('apply SQL supports only the complete pending set or a zero-update applied rerun', () => {
  const manifest = parseWattwatchersMeterRegisterStructuredManifest(fixtureManifest());
  const built = buildWattwatchersMeterRegisterStructuredReconciliationSql({
    manifest,
    mode: 'apply',
  });
  assert.match(built.sql, /pending_count = 1 AND applied_count = 0/u);
  assert.match(built.sql, /pending_count = 0 AND applied_count = 1/u);
  assert.match(built.sql, /record\.revision = stage\.expected_revision \+ 1/u);
  assert.match(built.sql, /updated_count <> pending_count/u);
  assert.match(built.sql, /COMMIT;\n$/u);
});

test('rejects unapproved mappings, decisions, value types, and invalid dates', () => {
  const base = fixtureFields()[0]!;
  for (const changed of [
    { ...base, auditTargetField: 'status' },
    { ...base, worksHeader: 'Status' },
    { ...base, masterHeader: 'Status' },
    { ...base, auditDecision: 'manual_review' },
    { ...base, auditDecisionRule: 'S1' },
    { ...base, value: false },
  ]) {
    assert.throws(() => parseWattwatchersMeterRegisterStructuredManifest(
      fixtureManifest(fixtureCandidate([changed])),
    ));
  }
  const dateField = fixtureFields()[1]!;
  assert.throws(() => parseWattwatchersMeterRegisterStructuredManifest(
    fixtureManifest(fixtureCandidate([{ ...dateField, value: '2026-02-30' }])),
  ));
});

test('requires DB-enriched null actor/manual expectations and exact current IDs', () => {
  for (const changed of [
    { ...fixtureCandidate(), expectedUpdatedByUserId: 'user' },
    { ...fixtureCandidate(), expectedManuallyCorrectedAt: '2026-01-01T00:00:00Z' },
    { ...fixtureCandidate(), currentDeviceIdentifier: 'AB1234567890' },
  ]) {
    assert.throws(() => parseWattwatchersMeterRegisterStructuredManifest(
      fixtureManifest(changed),
    ));
  }
});

test('rejects duplicate candidate fields and inaccurate expected field counts', () => {
  const fields = fixtureFields();
  assert.throws(() => parseWattwatchersMeterRegisterStructuredManifest(
    fixtureManifest(fixtureCandidate([...fields, { ...fields[0]! }])),
  ));

  const manifest = fixtureManifest();
  manifest.expected.fieldUpdateCounts.serviceType = 0;
  assert.throws(
    () => parseWattwatchersMeterRegisterStructuredManifest(manifest),
    /serviceType count/u,
  );
});

test('binds both workbooks, the source audit, and independently approved live manifest', () => {
  const valid = {
    masterWorkbookSha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
    worksWorkbookSha256: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
    sourceAuditSha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
    manifestSha256: 'f'.repeat(64),
    expectedManifestSha256: 'f'.repeat(64),
  };
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterStructuredArtifactDigests(valid));
  assert.throws(() => assertWattwatchersMeterRegisterStructuredArtifactDigests({
    ...valid,
    sourceAuditSha256: '0'.repeat(64),
  }), /source audit bytes/u);
  assert.throws(() => assertWattwatchersMeterRegisterStructuredArtifactDigests({
    ...valid,
    expectedManifestSha256: '0'.repeat(64),
  }), /manifest bytes/u);
});

test('structured CLI defaults dry-run and protects both input manifests and output SQL', async () => {
  const script = await readFile(
    new URL('../../scripts/wattwatchers-meter-register-structured-reconcile.ts', import.meta.url),
    'utf8',
  );
  assert.match(script, /const mode = value \?\? 'dry-run'/u);
  assert.match(script, /assertPrivateFile\(manifestPath/u);
  assert.match(script, /assertPrivateFile\(sourceAuditPath/u);
  assert.match(script, /open\(outputPath, 'wx', 0o600\)/u);
  assert.match(script, /await output\.sync\(\)/u);
  assert.doesNotMatch(script, /console\.log\([^)]*(?:candidate|field\.value)/u);
});
