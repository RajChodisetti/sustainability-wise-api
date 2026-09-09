import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertWattwatchersMeterRegisterReconciliationSnapshotRows,
  buildWattwatchersMeterRegisterReconciliationSnapshot,
  METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
  METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION,
  parseWattwatchersMeterRegisterSnapshotOptions,
  serializeWattwatchersMeterRegisterReconciliationSnapshot,
  type WattwatchersMeterRegisterReconciliationSnapshotRow,
  writePrivateSnapshot,
} from './wattwatchers-meter-register-reconciliation-snapshot.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser,
  computeWattwatchersMeterRegisterDatabaseUrlIdentity,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS,
} from '../src/services/wattwatchersMeterRegisterReconciliationTarget.js';

const DATABASE_IDENTITY_SHA256 = `sha256:${'9'.repeat(64)}`;
const TABLE_OIDS = { imports: '1001', entries: '1002', records: '1003' };

test('uses one deterministic read-only query with the minimal reconciliation projection', () => {
  assert.equal(
    METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /^SELECT\n/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /LEFT JOIN public\.ww_meter_register_records/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.revision AS "recordRevision"/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.manually_corrected_at/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.updated_by_user_id/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_database\(\) AS "databaseName"/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_database\(\) = \$4/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_user = \$5/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /session_user = \$5/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /to_regclass\('public\.ww_meter_register_imports'\)::oid::text/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_setting\('search_path'\) = 'pg_catalog, pg_temp'/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /AS "immutableValues"/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /AS "liveValues"/u);
  assert.doesNotMatch(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.details AS/u);
  assert.doesNotMatch(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /entry\.source_payload AS/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /entry\.current_device_identifier/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /imported\.workbook_sha256 = \$3/u);
  assert.match(
    METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
    /ORDER BY entry\.source_row ASC, entry\.id ASC$/u,
  );
  assert.doesNotMatch(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /SELECT\s+\*/u);
  assert.doesNotMatch(
    METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL)\b/iu,
  );
  assert.doesNotMatch(
    METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
    /business_clients|business_sites|ww_devices|password|secret|token/iu,
  );
});

test('writes private snapshot bytes atomically and exclusively', async () => {
  const row: WattwatchersMeterRegisterReconciliationSnapshotRow = {
    databaseName: WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS.qa.database,
    databaseUser: WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS.qa.databaseUser,
    databaseSchemaName: 'public',
    currentSchemaName: 'pg_catalog',
    searchPath: 'pg_catalog, pg_temp',
    tableOids: TABLE_OIDS,
    importId: 'import-id',
    sourceWorkbook: 'Master Register (1).xlsx',
    sourceSheet: 'Master Project Register',
    workbookSha256: 'a'.repeat(64),
    importSourceRowCount: 1_917,
    entryId: `wwmre_${'b'.repeat(32)}`,
    entryImportId: 'import-id',
    sourceKey: 'source-key',
    sourceRow: 4,
    sourceRowSha256: 'c'.repeat(64),
    currentDeviceIdentifier: 'AB12345678901',
    recordRevision: 1,
    recordManuallyCorrectedAt: null,
    recordUpdatedByUserId: null,
    immutableValues: Object.fromEntries([
      'invoiceNumber',
      'status',
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
      'comments',
    ].map((key) => [key, { snapshot: null, payload: null }])) as WattwatchersMeterRegisterReconciliationSnapshotRow['immutableValues'],
    liveValues: Object.fromEntries([
      'invoiceNumber',
      'status',
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
      'comments',
    ].map((key) => [key, null])) as WattwatchersMeterRegisterReconciliationSnapshotRow['liveValues'],
  };
  const bytes = Buffer.from(`${JSON.stringify(row)}\n`, 'utf8');

  const directory = await mkdtemp(join(tmpdir(), 'ww-meter-register-snapshot-'));
  const outputPath = join(directory, 'snapshot.json');
  try {
    await writePrivateSnapshot(outputPath, bytes);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(outputPath), bytes);
    await assert.rejects(writePrivateSnapshot(outputPath, bytes), { code: 'EEXIST' });
    assert.deepEqual(await readdir(directory), ['snapshot.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed unless the complete pinned target import is present in deterministic order', () => {
  const base = {
    databaseName: WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS.qa.database,
    databaseUser: WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS.qa.databaseUser,
    databaseSchemaName: 'public',
    currentSchemaName: 'pg_catalog',
    searchPath: 'pg_catalog, pg_temp',
    tableOids: TABLE_OIDS,
    importId: 'import-id',
    sourceWorkbook: 'Master Register (1).xlsx',
    sourceSheet: 'Master Project Register',
    workbookSha256: '4bb6e835928eb34bdee30d9e71f94c38d641b078a75c52a58c8450a60acd6c34',
    importSourceRowCount: 1_917,
    entryImportId: 'import-id',
    sourceKey: 'source-key',
    sourceRowSha256: 'c'.repeat(64),
    recordRevision: 1,
    recordManuallyCorrectedAt: null,
    recordUpdatedByUserId: null,
    immutableValues: {} as WattwatchersMeterRegisterReconciliationSnapshotRow['immutableValues'],
    liveValues: {} as WattwatchersMeterRegisterReconciliationSnapshotRow['liveValues'],
  };
  const rows = Array.from({ length: 1_917 }, (_, index) => ({
    ...base,
    entryId: `wwmre_${index.toString(16).padStart(32, '0')}`,
    sourceKey: `source-key-${index}`,
    sourceRow: index + 4,
    currentDeviceIdentifier: index < 1_857
      ? `A${String(index).padStart(12, '0')}`
      : null,
  }));
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterReconciliationSnapshotRows(rows, 'qa'));
  const snapshot = buildWattwatchersMeterRegisterReconciliationSnapshot(
    rows,
    'qa',
    DATABASE_IDENTITY_SHA256,
  );
  assert.equal(snapshot.target, 'qa');
  assert.equal(snapshot.databaseIdentitySha256, DATABASE_IDENTITY_SHA256);
  assert.deepEqual(
    serializeWattwatchersMeterRegisterReconciliationSnapshot(snapshot),
    serializeWattwatchersMeterRegisterReconciliationSnapshot(snapshot),
  );
  assert.throws(
    () => assertWattwatchersMeterRegisterReconciliationSnapshotRows(rows.slice(1), 'qa'),
    /row count/u,
  );
  assert.throws(
    () => assertWattwatchersMeterRegisterReconciliationSnapshotRows([
      { ...rows[0]!, databaseName: 'postgres' },
      ...rows.slice(1),
    ], 'qa'),
    /must bind database|unapproved database/u,
  );
  assert.throws(
    () => assertWattwatchersMeterRegisterReconciliationSnapshotRows([
      {
        ...rows[0]!,
        databaseUser:
          WATTWATCHERS_METER_REGISTER_RECONCILIATION_TARGETS.production.databaseUser,
      },
      ...rows.slice(1),
    ], 'qa'),
    /database user/u,
  );
});

test('requires an explicit target and binds a stable non-secret DATABASE_URL identity', () => {
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser({
    target: 'qa',
    databaseUser: 'sw_lane',
  }));
  assert.throws(() => assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser({
    target: 'qa',
    databaseUser: 'sw_api',
  }), /database user sw_lane/u);
  assert.throws(() => assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser({
    target: 'production',
    databaseUser: 'sw_lane',
  }), /database user sw_api/u);
  assert.throws(
    () => parseWattwatchersMeterRegisterSnapshotOptions([
      '--database-identity-sha256', DATABASE_IDENTITY_SHA256,
      '--output', '/private/tmp/snapshot.json',
    ]),
    /Usage|target/u,
  );
  assert.deepEqual(parseWattwatchersMeterRegisterSnapshotOptions([
    '--target', 'production',
    '--database-identity-sha256', DATABASE_IDENTITY_SHA256,
    '--output', '/private/tmp/snapshot.json',
  ]), {
    target: 'production',
    databaseIdentitySha256: DATABASE_IDENTITY_SHA256,
    outputPath: '/private/tmp/snapshot.json',
  });

  const first = computeWattwatchersMeterRegisterDatabaseUrlIdentity(
    'postgresql://meter_user:hidden@DB.EXAMPLE:5432/sustainability_wise?sslmode=require&application_name=reconcile',
  );
  const reordered = computeWattwatchersMeterRegisterDatabaseUrlIdentity(
    'postgresql://meter_user:different@db.example:5432/sustainability_wise?application_name=reconcile&sslmode=require',
  );
  assert.equal(first.sha256, reordered.sha256);
  assert.equal(first.database, 'sustainability_wise');
  assert.equal(first.databaseUser, 'meter_user');
  assert.throws(
    () => computeWattwatchersMeterRegisterDatabaseUrlIdentity(
      'postgresql://meter_user:hidden@db.example/sustainability_wise',
    ),
    /explicit numeric port/u,
  );
  assert.throws(
    () => computeWattwatchersMeterRegisterDatabaseUrlIdentity(
      'postgresql://meter_user:hidden@db.example:5432/sustainability_wise?sslmode=require&sslmode=verify-full',
    ),
    /unique/u,
  );
});

test('DATABASE_URL identity exactly matches the release-preflight fingerprint contract', async () => {
  const { canonicalDatabaseIdentity, identityFingerprint } = await import(
    './release-preflight.mjs'
  ) as {
    canonicalDatabaseIdentity: (url: URL, parameters: Record<string, string>) => unknown;
    identityFingerprint: (value: unknown) => string;
  };
  const url = new URL(
    'postgresql://sw_api:hidden@db.example:5432/sustainability_wise?sslmode=verify-full&application_name=reconcile',
  );
  const parameters = Object.fromEntries(url.searchParams.entries());
  const expected = identityFingerprint(canonicalDatabaseIdentity(url, parameters));
  assert.equal(computeWattwatchersMeterRegisterDatabaseUrlIdentity(url.href).sha256, expected);
});
