import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeWattwatchersMeterRegister } from './wattwatchersMeterRegisterImport.js';
import {
  assertMasterRegisterArtifactDigests,
  buildWattwatchersMeterRegisterImportSql,
  MASTER_REGISTER_EXTRACT_SHA256,
  MASTER_REGISTER_WORKBOOK_SHA256,
  type WattwatchersMeterRegisterExpectedSummary,
} from './wattwatchersMeterRegisterImportSql.js';
import {
  computeWattwatchersMeterRegisterDatabaseUrlIdentity,
} from './wattwatchersMeterRegisterReconciliationTarget.js';

const CONFIRMED_ID = 'DD65335309637';
const CANDIDATE_ID = 'AB12345678901';
const SOURCE_SHA = 'a'.repeat(64);
const QA_TARGET = {
  target: 'qa',
  database: 'sw_ecoaudit_fixes',
  databaseUser: 'sw_lane',
  databaseIdentitySha256: `sha256:${'b'.repeat(64)}`,
  phase: 'operational',
} as const;

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
    ...QA_TARGET,
    expected: EXPECTED,
  });

  assert.match(built.importId, /^wwmri_[a-f0-9]{32}$/u);
  assert.match(built.sql, /^\\set ON_ERROR_STOP on\nBEGIN;/u);
  assert.match(built.sql, /current_database\(\) IS DISTINCT FROM 'sw_ecoaudit_fixes'/u);
  assert.match(built.sql, /current_user IS DISTINCT FROM 'sw_lane'/u);
  assert.match(built.sql, /session_user IS DISTINCT FROM 'sw_lane'/u);
  assert.match(built.sql, /sha256:b{64}/u);
  assert.match(built.sql, /SET LOCAL search_path = pg_catalog, public, pg_temp/u);
  assert.match(built.sql, /to_regclass\('public\.ww_meter_register_records'\)/u);
  assert.match(built.sql, /to_regprocedure\([\s\S]*sw_business_site_address_fingerprint/u);
  assert.match(built.sql, /pg_advisory_xact_lock/u);
  assert.match(built.sql, /INSERT INTO public\.ww_meter_register_imports/u);
  assert.match(built.sql, /INSERT INTO public\.ww_meter_register_entries/u);
  assert.match(built.sql, /CREATE TEMP TABLE pg_temp\.ww_meter_register_operational_stage/u);
  assert.match(built.sql, /INSERT INTO public\.business_clients/u);
  assert.match(built.sql, /INSERT INTO public\.business_sites/u);
  assert.match(built.sql, /INSERT INTO public\.ww_meter_register_records/u);
  assert.match(built.sql, /mixed or partial preexisting state/u);
  assert.match(built.sql, /operational_record_count = 2/u);
  assert.match(built.sql, /AS operational_record_count/u);
  assert.match(built.sql, /'dry-run' AS apply_mode/u);
  assert.match(built.sql, /'rollback' AS transaction_action/u);
  assert.match(built.sql, /AS table_oids/u);
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

  assert.doesNotMatch(built.sql, /INSERT INTO (?:public\.)?(?:ww_devices|ww_device_clients|ih_inventory_meters|business_jobs)/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+(?:public\.)?(?:ww_devices|ww_device_clients|ih_inventory_meters|business_jobs)/u);
  assert.doesNotMatch(built.sql, /UPDATE\s+(?:public\.)?ww_meter_register_entries/u);
  assert.doesNotMatch(built.sql, /DELETE FROM|TRUNCATE|DROP TABLE/u);
});

test('builds a source-only bootstrap that runs after migrations without requiring operational rows', () => {
  const built = buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'apply',
    ...QA_TARGET,
    phase: 'source',
    expected: EXPECTED,
  });

  assert.match(built.sql, /INSERT INTO public\.ww_meter_register_imports/u);
  assert.match(built.sql, /INSERT INTO public\.ww_meter_register_entries/u);
  assert.match(built.sql, /NULL::integer AS operational_record_count/u);
  assert.match(built.sql, /SET LOCAL search_path = pg_catalog, pg_temp/u);
  assert.match(built.sql, /'apply' AS apply_mode/u);
  assert.match(built.sql, /'commit' AS transaction_action/u);
  assert.match(built.sql, /metadata_count = 0[\s\S]*source_entry_count = 0/u);
  assert.match(built.sql, /metadata_count = 1[\s\S]*source_entry_count = 2/u);
  assert.doesNotMatch(built.sql, /INSERT INTO public\.ww_meter_register_records/u);
  assert.doesNotMatch(built.sql, /CREATE TEMP TABLE pg_temp\.ww_meter_register_operational_stage/u);
  assert.doesNotMatch(built.sql, /to_regprocedure/u);
  assert.match(built.sql, /COMMIT;\n$/u);
});

test('binds production to the canonical database and rejects crossed or malformed identities', () => {
  const production = buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    phase: 'source',
    target: 'production',
    database: 'sustainability_wise',
    databaseUser: 'sw_api',
    databaseIdentitySha256: `sha256:${'c'.repeat(64)}`,
    expected: EXPECTED,
  });
  assert.match(
    production.sql,
    /current_database\(\) IS DISTINCT FROM 'sustainability_wise'/u,
  );
  assert.match(production.sql, /current_user IS DISTINCT FROM 'sw_api'/u);
  assert.match(production.sql, /session_user IS DISTINCT FROM 'sw_api'/u);
  assert.doesNotMatch(production.sql, /sw_ecoaudit_fixes/u);

  assert.throws(() => buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    phase: 'source',
    target: 'qa',
    database: 'sustainability_wise',
    databaseUser: 'sw_lane',
    databaseIdentitySha256: `sha256:${'b'.repeat(64)}`,
    expected: EXPECTED,
  }), /target qa must bind database sw_ecoaudit_fixes/u);
  assert.throws(() => buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    ...QA_TARGET,
    databaseIdentitySha256: 'b'.repeat(64),
    expected: EXPECTED,
  }), /prefixed SHA-256 digest/u);
  assert.throws(() => buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    ...QA_TARGET,
    databaseUser: 'sw_api',
    expected: EXPECTED,
  }), /target qa must bind database user sw_lane/u);
  assert.throws(() => buildWattwatchersMeterRegisterImportSql({
    rows: fixtureRows(),
    mode: 'dry-run',
    phase: 'source',
    target: 'production',
    database: 'sustainability_wise',
    databaseUser: 'sw_lane',
    databaseIdentitySha256: `sha256:${'c'.repeat(64)}`,
    expected: EXPECTED,
  }), /target production must bind database user sw_api/u);
});

test('regenerates byte-identical SQL for the same source, target, phase, and mode', () => {
  const input = {
    rows: fixtureRows(),
    mode: 'dry-run' as const,
    ...QA_TARGET,
    expected: EXPECTED,
  };
  const first = buildWattwatchersMeterRegisterImportSql(input);
  const second = buildWattwatchersMeterRegisterImportSql(input);
  assert.equal(second.sql, first.sql);
  assert.equal(second.importId, first.importId);
  assert.deepEqual(second.summary, first.summary);
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
    ...QA_TARGET,
    expected: EXPECTED,
  });
  const right = buildWattwatchersMeterRegisterImportSql({
    rows: renamed,
    mode: 'apply',
    ...QA_TARGET,
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
    ...QA_TARGET,
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
    ...QA_TARGET,
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

test('writes PII-bearing SQL atomically and reads protected inputs without following symlinks', async () => {
  const scriptUrl = new URL(
    '../../scripts/wattwatchers-meter-register-import.ts',
    import.meta.url,
  );
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /constants\.O_NOFOLLOW/u);
  assert.match(script, /open\(temporaryPath, 'wx', 0o600\)/u);
  assert.match(script, /await output\.sync\(\)/u);
  assert.match(script, /await link\(temporaryPath, path\)/u);
  assert.match(script, /await syncDirectory\(path\)/u);
  assert.match(script, /sqlSha256/u);
  assert.match(script, /databaseIdentitySha256/u);
  assert.doesNotMatch(script, /readFile\(options\.(?:input|workbook)Path/u);

  const databaseUrl =
    'postgresql://sw_lane:not-logged@127.0.0.1:5432/sw_ecoaudit_fixes?sslmode=disable';
  const databaseIdentity = computeWattwatchersMeterRegisterDatabaseUrlIdentity(databaseUrl);
  const common = [
    '--target', 'qa',
    '--database-identity-sha256', databaseIdentity.sha256,
    '--phase', 'source',
    '--workbook', '/private/tmp/workbook.xlsx',
    '--input', '/private/tmp/extract.json',
    '--output', '/private/tmp/import.sql',
  ];
  const run = (args: string[], url = databaseUrl) => spawnSync(process.execPath, [
    '--import',
    'tsx',
    fileURLToPath(scriptUrl),
    ...args,
  ], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });

  for (const [args, expectedError] of [
    [[...common, '--unknown', 'value'], /invalid or duplicate options/u],
    [[...common, '--target', 'qa'], /invalid or duplicate options/u],
    [[...common, '--database', 'sw_ecoaudit_fixes'], /invalid or duplicate options/u],
    [common.filter((value, index) => index < 4 || index > 5), /phase must be explicitly/u],
    [[...common.slice(0, 1), 'production', ...common.slice(2)], /target production must bind database sustainability_wise/u],
    [[...common.slice(0, 3), `sha256:${'0'.repeat(64)}`, ...common.slice(4)], /identity does not match/u],
  ] as const) {
    const result = run([...args]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(result.stderr, /not-logged/u);
  }

  const crossedUserUrl =
    'postgresql://sw_api:not-logged@127.0.0.1:5432/sw_ecoaudit_fixes?sslmode=disable';
  const crossedUserIdentity =
    computeWattwatchersMeterRegisterDatabaseUrlIdentity(crossedUserUrl);
  const crossedUserArgs = [
    ...common.slice(0, 3),
    crossedUserIdentity.sha256,
    ...common.slice(4),
  ];
  const crossedUserResult = run(crossedUserArgs, crossedUserUrl);
  assert.notEqual(crossedUserResult.status, 0);
  assert.match(crossedUserResult.stderr, /target qa must bind database user sw_lane/u);
  assert.doesNotMatch(crossedUserResult.stderr, /not-logged/u);
});
