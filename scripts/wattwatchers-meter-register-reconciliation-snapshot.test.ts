import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertWattwatchersMeterRegisterReconciliationSnapshotRows,
  buildWattwatchersMeterRegisterReconciliationSnapshot,
  METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE,
  METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
  METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION,
  serializeWattwatchersMeterRegisterReconciliationSnapshot,
  type WattwatchersMeterRegisterReconciliationSnapshotRow,
  writePrivateSnapshot,
} from './wattwatchers-meter-register-reconciliation-snapshot.js';

test('uses one deterministic read-only query with the minimal reconciliation projection', () => {
  assert.equal(
    METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /^SELECT\n/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /LEFT JOIN ww_meter_register_records/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.revision AS "recordRevision"/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.manually_corrected_at/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /record\.updated_by_user_id/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_database\(\) AS "databaseName"/u);
  assert.match(METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL, /current_database\(\) = \$4/u);
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

test('serializes rows deterministically and writes a private exclusive snapshot', async () => {
  const row: WattwatchersMeterRegisterReconciliationSnapshotRow = {
    databaseName: METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE,
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
  const bytes = serializeWattwatchersMeterRegisterReconciliationSnapshot(
    buildWattwatchersMeterRegisterReconciliationSnapshot([row]),
  );
  const repeated = serializeWattwatchersMeterRegisterReconciliationSnapshot(
    buildWattwatchersMeterRegisterReconciliationSnapshot([row]),
  );
  assert.deepEqual(bytes, repeated);

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

test('fails closed unless the complete pinned QA import is present in deterministic order', () => {
  const base = {
    databaseName: METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE,
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
  assert.doesNotThrow(() => assertWattwatchersMeterRegisterReconciliationSnapshotRows(rows));
  assert.throws(
    () => assertWattwatchersMeterRegisterReconciliationSnapshotRows(rows.slice(1)),
    /row count/u,
  );
  assert.throws(
    () => assertWattwatchersMeterRegisterReconciliationSnapshotRows([
      { ...rows[0]!, databaseName: 'postgres' },
      ...rows.slice(1),
    ]),
    /unapproved database/u,
  );
});
