import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeWattwatchersMeterRegister } from './wattwatchersMeterRegisterImport.js';
import {
  assertMasterRegisterArtifactDigests,
  buildWattwatchersMeterRegisterImportSql,
  MASTER_REGISTER_EXTRACT_SHA256,
  MASTER_REGISTER_WORKBOOK_SHA256,
  type WattwatchersMeterRegisterExpectedSummary,
} from './wattwatchersMeterRegisterImportSql.js';

const CONFIRMED_ID = 'DD65335309637';
const CANDIDATE_ID = 'AB12345678901';
const SOURCE_SHA = 'a'.repeat(64);

function fixtureRows() {
  return normalizeWattwatchersMeterRegister([
    {
      sourceRow: 2,
      values: {
        'Customer Name': "O'Brien Energy",
        'Existing Device ID': CONFIRMED_ID,
        'Job Completion Date': '2026-08-01',
      },
    },
    {
      sourceRow: 3,
      values: {
        'Existing Device ID': CONFIRMED_ID,
        'New Device ID': CANDIDATE_ID,
        'Meter Cost (EXC.GST)': 125.5,
      },
    },
  ], {
    sourceWorkbook: 'Register.xlsx',
    sourceWorkbookSha256: SOURCE_SHA,
    sourceSheet: 'Meters',
    authoritativeWattwatchersIds: [CONFIRMED_ID],
  });
}

const EXPECTED: WattwatchersMeterRegisterExpectedSummary = {
  sourceRowCount: 2,
  rowsWithoutCurrentIdentifier: 0,
  deviceValueCount: 3,
  uniqueIdentifierCount: 2,
  duplicateDeviceValueCount: 1,
  confirmedWattwatchersIdentifierCount: 1,
  candidateWattwatchersIdentifierCount: 1,
  otherHardwareIdentifierCount: 0,
};

test('builds an append-only dry-run that materializes editable Meter Register records transactionally', () => {
  const built = buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    expected: EXPECTED,
  });

  assert.match(built.importId, /^wwmri_[a-f0-9]{32}$/u);
  assert.match(built.sql, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.match(built.sql, /pg_advisory_xact_lock/u);
  assert.match(built.sql, /INSERT INTO ww_meter_register_imports/u);
  assert.match(built.sql, /INSERT INTO ww_meter_register_entries/u);
  assert.match(built.sql, /CREATE TEMP TABLE ww_meter_register_operational_stage/u);
  assert.match(built.sql, /INSERT INTO business_clients/u);
  assert.match(built.sql, /INSERT INTO business_sites/u);
  assert.match(built.sql, /INSERT INTO ww_meter_register_records/u);
  assert.match(built.sql, /ON CONFLICT \(entry_id\) DO NOTHING/u);
  assert.match(built.sql, /Every imported Meter Register current identifier must have an operational record/u);
  assert.match(built.sql, /sustainability-wise:meter-register-entry:/u);
  assert.match(built.sql, /sustainability-wise:client:/u);
  assert.match(built.sql, /sustainability-wise:site:/u);
  assert.match(built.sql, /\(client\.merged_into_client_id IS NULL\) DESC/u);
  assert.match(built.sql, /site_name_normalized_key/u);
  assert.match(built.sql, /operational_details jsonb NOT NULL/u);
  assert.match(built.sql, /ON CONFLICT \(source_key\) DO NOTHING/u);
  assert.match(built.sql, /existing_device_classification = 'confirmed_wattwatchers'/u);
  assert.match(built.sql, /IS DISTINCT FROM ROW\(/u);
  assert.match(built.sql, /existing_device\.id,[\s\S]*new_device\.id,[\s\S]*current_device\.id/u);
  assert.match(built.sql, /O''Brien Energy/u);
  assert.match(built.sql, /12550/u);
  assert.match(built.sql, /ROLLBACK;\n$/u);

  assert.doesNotMatch(built.sql, /INSERT INTO (?:ww_devices|ww_device_clients|ih_inventory_meters|business_jobs)/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+(?:ww_devices|ww_device_clients|ih_inventory_meters|business_jobs)/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+ww_meter_register_entries/u);
  assert.doesNotMatch(built.sql, /DELETE FROM|TRUNCATE|DROP TABLE/u);
});

test('uses a stable import identity for the same workbook bytes and sheet across filename changes', () => {
  const original = fixtureRows();
  const renamed = normalizeWattwatchersMeterRegister([
    { sourceRow: 2, values: original[0]!.rawValues },
    { sourceRow: 3, values: original[1]!.rawValues },
  ], {
    sourceWorkbook: 'Renamed Register.xlsx',
    sourceWorkbookSha256: SOURCE_SHA,
    sourceSheet: 'Meters',
    authoritativeWattwatchersIds: [CONFIRMED_ID],
  });

  const left = buildWattwatchersMeterRegisterImportSql({
    rows: original,
    mode: 'apply',
    expected: EXPECTED,
  });
  const right = buildWattwatchersMeterRegisterImportSql({
    rows: renamed,
    mode: 'apply',
    expected: EXPECTED,
  });

  assert.equal(left.importId, right.importId);
  assert.deepEqual(
    original.map((row) => row.sourceKey),
    renamed.map((row) => row.sourceKey),
  );
  assert.match(left.sql, /COMMIT;\n$/u);
});

test('emits split installation labels while retaining their exact source evidence', () => {
  const rows = normalizeWattwatchersMeterRegister([
    {
      sourceRow: 2,
      values: {
        'Customer Name': 'Subaru - Essendon Fields (DB Showroom & DB Workshop)',
        'Client Name': 'InchCape',
        'Existing Device ID': CONFIRMED_ID,
      },
    },
    {
      sourceRow: 3,
      values: {
        'Client Name': 'SUMS Fleet | Sustainability Wise',
        'Site Address': 'Subaru - Narellan (EV Charging)',
        'Existing Device ID': CANDIDATE_ID,
      },
    },
  ], {
    sourceWorkbook: 'Register.xlsx',
    sourceWorkbookSha256: SOURCE_SHA,
    sourceSheet: 'Meters',
    authoritativeWattwatchersIds: [CONFIRMED_ID],
  });
  const built = buildWattwatchersMeterRegisterImportSql({
    rows,
    mode: 'dry-run',
    expected: {
      sourceRowCount: 2,
      rowsWithoutCurrentIdentifier: 0,
      deviceValueCount: 2,
      uniqueIdentifierCount: 2,
      duplicateDeviceValueCount: 0,
      confirmedWattwatchersIdentifierCount: 1,
      candidateWattwatchersIdentifierCount: 1,
      otherHardwareIdentifierCount: 0,
    },
  });

  assert.match(built.sql, /Subaru - Essendon Fields \(DB Showroom & DB Workshop\)/u);
  assert.match(built.sql, /Subaru Essendon/u);
  assert.match(built.sql, /344 Wirraway Road, Essendon Fields VIC 3041/u);
  assert.match(built.sql, /"installationDetail":"DB Showroom & DB Workshop"/u);
  assert.match(built.sql, /Subaru - Narellan \(EV Charging\)/u);
  assert.match(built.sql, /"installationDetail":"EV Charging"/u);
});

test('fails before SQL generation when a checksum-bound source invariant changes', () => {
  assert.throws(() => buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    expected: { ...EXPECTED, sourceRowCount: 3 },
  }), /sourceRowCount changed/u);
});

test('requires the exact approved workbook and deterministic extract bytes', () => {
  assert.doesNotThrow(() => assertMasterRegisterArtifactDigests({
    workbookSha256: MASTER_REGISTER_WORKBOOK_SHA256,
    extractSha256: MASTER_REGISTER_EXTRACT_SHA256,
  }));
  assert.throws(() => assertMasterRegisterArtifactDigests({
    workbookSha256: '0'.repeat(64),
    extractSha256: MASTER_REGISTER_EXTRACT_SHA256,
  }), /workbook bytes do not match/u);
  assert.throws(() => assertMasterRegisterArtifactDigests({
    workbookSha256: MASTER_REGISTER_WORKBOOK_SHA256,
    extractSha256: '0'.repeat(64),
  }), /extract bytes do not match/u);
});

test('writes PII-bearing SQL only to a newly created private output file', async () => {
  const script = await readFile(
    new URL('../../scripts/wattwatchers-meter-register-import.ts', import.meta.url),
    'utf8',
  );
  assert.match(script, /open\(outputPath, 'wx', 0o600\)/u);
  assert.match(script, /await output\.sync\(\)/u);
  assert.doesNotMatch(script, /writeFile\(outputPath/u);
});
