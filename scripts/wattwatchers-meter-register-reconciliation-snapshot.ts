import { createHash, randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  METER_REGISTER_RECONCILIATION_MASTER_SHEET,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
} from '../src/services/wattwatchersMeterRegisterInvoiceReconciliation.js';
import { MASTER_REGISTER_EXPECTED_SUMMARY } from '../src/services/wattwatchersMeterRegisterImportSql.js';

export const METER_REGISTER_RECONCILIATION_SNAPSHOT_SCHEMA =
  'wattwatchers-meter-register-reconciliation-db-snapshot/v1';
export const METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION =
  'ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE = 'sw_ecoaudit_fixes';

export const METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL = `
SELECT
  current_database() AS "databaseName",
  imported.id AS "importId",
  imported.source_workbook AS "sourceWorkbook",
  imported.source_sheet AS "sourceSheet",
  imported.workbook_sha256 AS "workbookSha256",
  imported.source_row_count AS "importSourceRowCount",
  entry.id AS "entryId",
  entry.import_id AS "entryImportId",
  entry.source_key AS "sourceKey",
  entry.source_row AS "sourceRow",
  entry.source_row_sha256 AS "sourceRowSha256",
  entry.current_device_identifier AS "currentDeviceIdentifier",
  record.revision AS "recordRevision",
  record.manually_corrected_at AS "recordManuallyCorrectedAt",
  record.updated_by_user_id AS "recordUpdatedByUserId",
  jsonb_build_object(
    'invoiceNumber', jsonb_build_object(
      'snapshot', entry.xero_invoice_number_snapshot,
      'payload', entry.source_payload -> 'Xero Invoice #'
    ),
    'status', jsonb_build_object(
      'snapshot', entry.status_snapshot,
      'payload', entry.source_payload -> 'Status'
    ),
    'serviceType', jsonb_build_object(
      'snapshot', entry.service_type_snapshot,
      'payload', entry.source_payload -> 'Service Type'
    ),
    'meteringSolutionType', jsonb_build_object(
      'snapshot', entry.metering_solution_type_snapshot,
      'payload', entry.source_payload -> 'Metering Solution Type'
    ),
    'meterType', jsonb_build_object(
      'snapshot', entry.meter_type_snapshot,
      'payload', entry.source_payload -> 'Meter Type'
    ),
    'fergusJobNumber', jsonb_build_object(
      'snapshot', entry.fergus_job_number_snapshot,
      'payload', entry.source_payload -> 'Fergus Job #'
    ),
    'quoteNumber', jsonb_build_object(
      'snapshot', entry.quote_number_snapshot,
      'payload', entry.source_payload -> 'Quote #'
    ),
    'purchaseOrderNumber', jsonb_build_object(
      'snapshot', entry.purchase_order_number_snapshot,
      'payload', entry.source_payload -> 'PO Number'
    ),
    'jobCompletionDate', jsonb_build_object(
      'snapshot', entry.job_completion_date,
      'payload', entry.source_payload -> 'Job Completion Date'
    ),
    'jobCompletedBy', jsonb_build_object(
      'snapshot', entry.job_completed_by_snapshot,
      'payload', entry.source_payload -> 'Job Completed By'
    ),
    'hardwareInstalled', jsonb_build_object(
      'snapshot', entry.hardware_installed_snapshot,
      'payload', entry.source_payload -> 'Hardware Installed'
    ),
    'maas', jsonb_build_object(
      'snapshot', entry.maas,
      'payload', entry.source_payload -> 'MaaS (Yes/No)'
    ),
    'invoiceIssuedDate', jsonb_build_object(
      'snapshot', entry.invoice_issued_date,
      'payload', entry.source_payload -> 'Inv issued date'
    ),
    'comments', jsonb_build_object(
      'snapshot', entry.comments_snapshot,
      'payload', entry.source_payload -> 'Comments'
    )
  ) AS "immutableValues",
  jsonb_build_object(
    'invoiceNumber', record.details -> 'xeroInvoiceNumber',
    'status', record.details -> 'status',
    'serviceType', record.details -> 'serviceType',
    'meteringSolutionType', record.details -> 'meteringSolutionType',
    'meterType', record.details -> 'meterType',
    'fergusJobNumber', record.details -> 'fergusJobNumber',
    'quoteNumber', record.details -> 'quoteNumber',
    'purchaseOrderNumber', record.details -> 'purchaseOrderNumber',
    'jobCompletionDate', record.details -> 'jobCompletionDate',
    'jobCompletedBy', record.details -> 'jobCompletedBy',
    'hardwareInstalled', record.details -> 'hardwareInstalled',
    'maas', record.details -> 'maas',
    'invoiceIssuedDate', record.details -> 'invoiceIssuedDate',
    'comments', record.details -> 'comments'
  ) AS "liveValues"
FROM ww_meter_register_imports imported
JOIN ww_meter_register_entries entry ON entry.import_id = imported.id
LEFT JOIN ww_meter_register_records record ON record.entry_id = entry.id
WHERE imported.source_workbook = $1
  AND imported.source_sheet = $2
  AND imported.workbook_sha256 = $3
  AND current_database() = $4
ORDER BY entry.source_row ASC, entry.id ASC
`.trim();

type ImmutableTargetValue = { snapshot: unknown; payload: unknown };
type SnapshotTargetKey =
  | 'invoiceNumber'
  | 'status'
  | 'serviceType'
  | 'meteringSolutionType'
  | 'meterType'
  | 'fergusJobNumber'
  | 'quoteNumber'
  | 'purchaseOrderNumber'
  | 'jobCompletionDate'
  | 'jobCompletedBy'
  | 'hardwareInstalled'
  | 'maas'
  | 'invoiceIssuedDate'
  | 'comments';

export type WattwatchersMeterRegisterReconciliationSnapshotRow = {
  databaseName: string;
  importId: string;
  sourceWorkbook: string;
  sourceSheet: string;
  workbookSha256: string;
  importSourceRowCount: number;
  entryId: string;
  entryImportId: string;
  sourceKey: string;
  sourceRow: number;
  sourceRowSha256: string;
  currentDeviceIdentifier: string | null;
  recordRevision: number | null;
  recordManuallyCorrectedAt: Date | null;
  recordUpdatedByUserId: string | null;
  immutableValues: Record<SnapshotTargetKey, ImmutableTargetValue>;
  liveValues: Record<SnapshotTargetKey, unknown>;
};

export type WattwatchersMeterRegisterReconciliationSnapshot = {
  schema: typeof METER_REGISTER_RECONCILIATION_SNAPSHOT_SCHEMA;
  database: typeof METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE;
  source: {
    workbook: typeof METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK;
    sheet: typeof METER_REGISTER_RECONCILIATION_MASTER_SHEET;
    workbookSha256: typeof METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256;
  };
  rowCount: number;
  rows: WattwatchersMeterRegisterReconciliationSnapshotRow[];
};

export function buildWattwatchersMeterRegisterReconciliationSnapshot(
  rows: WattwatchersMeterRegisterReconciliationSnapshotRow[],
): WattwatchersMeterRegisterReconciliationSnapshot {
  return {
    schema: METER_REGISTER_RECONCILIATION_SNAPSHOT_SCHEMA,
    database: METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE,
    source: {
      workbook: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
      sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      workbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
    },
    rowCount: rows.length,
    rows,
  };
}

export function assertWattwatchersMeterRegisterReconciliationSnapshotRows(
  rows: WattwatchersMeterRegisterReconciliationSnapshotRow[],
): void {
  if (rows.length !== MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount) {
    throw new Error('Meter Register snapshot row count does not match the pinned import');
  }
  const importIds = new Set<string>();
  let currentIdentifierCount = 0;
  let previous: WattwatchersMeterRegisterReconciliationSnapshotRow | undefined;
  for (const row of rows) {
    if (row.databaseName !== METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE) {
      throw new Error('Meter Register snapshot came from an unapproved database');
    }
    if (row.sourceWorkbook !== METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK
      || row.sourceSheet !== METER_REGISTER_RECONCILIATION_MASTER_SHEET
      || row.workbookSha256 !== METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256
      || row.importSourceRowCount !== MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount) {
      throw new Error('Meter Register snapshot import provenance changed');
    }
    if (row.entryImportId !== row.importId) {
      throw new Error('Meter Register snapshot entry/import provenance changed');
    }
    if (previous && (row.sourceRow < previous.sourceRow
      || (row.sourceRow === previous.sourceRow && row.entryId <= previous.entryId))) {
      throw new Error('Meter Register snapshot ordering or row uniqueness changed');
    }
    importIds.add(row.importId);
    if (row.currentDeviceIdentifier !== null) currentIdentifierCount += 1;
    previous = row;
  }
  if (importIds.size !== 1) {
    throw new Error('Meter Register snapshot must contain exactly one pinned import');
  }
  const expectedCurrentIdentifierCount = MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount
    - MASTER_REGISTER_EXPECTED_SUMMARY.rowsWithoutCurrentIdentifier;
  if (currentIdentifierCount !== expectedCurrentIdentifierCount) {
    throw new Error('Meter Register snapshot current-identifier count changed');
  }
}

export function serializeWattwatchersMeterRegisterReconciliationSnapshot(
  snapshot: WattwatchersMeterRegisterReconciliationSnapshot,
): Buffer {
  return Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function writePrivateSnapshot(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const output = await open(temporaryPath, 'wx', 0o600);
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    await link(temporaryPath, path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function outputOption(argv: string[]): string {
  const indexes = argv.flatMap((value, index) => value === '--output' ? [index] : []);
  if (indexes.length !== 1 || argv.length !== 2 || indexes[0] !== 0 || !argv[1]) {
    throw new Error('Usage: --output <private-db-snapshot.json>');
  }
  return argv[1];
}

async function main(): Promise<void> {
  const outputPath = outputOption(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const rows = await sql.begin(
      METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION,
      async (transaction) => {
        await transaction`SET LOCAL lock_timeout = '5s'`;
        await transaction`SET LOCAL statement_timeout = '2min'`;
        return transaction.unsafe<WattwatchersMeterRegisterReconciliationSnapshotRow[]>(
          METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
          [
            METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
            METER_REGISTER_RECONCILIATION_MASTER_SHEET,
            METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
            METER_REGISTER_RECONCILIATION_SNAPSHOT_DATABASE,
          ],
        );
      },
    );
    assertWattwatchersMeterRegisterReconciliationSnapshotRows([...rows]);
    const snapshot = buildWattwatchersMeterRegisterReconciliationSnapshot([...rows]);
    const bytes = serializeWattwatchersMeterRegisterReconciliationSnapshot(snapshot);
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex');
    await writePrivateSnapshot(outputPath, bytes);
    console.log(JSON.stringify({
      schema: snapshot.schema,
      rowCount: snapshot.rowCount,
      snapshotSha256,
      outputPath,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
