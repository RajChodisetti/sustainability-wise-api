import { createHash, randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_RECONCILIATION_MASTER_SHEET,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
} from '../src/services/wattwatchersMeterRegisterInvoiceReconciliation.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetBinding,
  computeWattwatchersMeterRegisterDatabaseUrlIdentity,
  parseWattwatchersMeterRegisterReconciliationTarget,
  wattwatchersMeterRegisterReconciliationDatabaseForTarget,
  wattwatchersMeterRegisterReconciliationDatabaseUserForTarget,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_TABLE_NAMES,
  type WattwatchersMeterRegisterReconciliationDatabase,
  type WattwatchersMeterRegisterReconciliationTarget,
  type WattwatchersMeterRegisterReconciliationTargetBinding,
} from '../src/services/wattwatchersMeterRegisterReconciliationTarget.js';
import { MASTER_REGISTER_EXPECTED_SUMMARY } from '../src/services/wattwatchersMeterRegisterImportSql.js';

export const METER_REGISTER_RECONCILIATION_SNAPSHOT_SCHEMA =
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA;
export const METER_REGISTER_RECONCILIATION_SNAPSHOT_TRANSACTION =
  'ISOLATION LEVEL REPEATABLE READ READ ONLY';

export const METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL = `
SELECT
  current_database() AS "databaseName",
  current_user AS "databaseUser",
  'public'::text AS "databaseSchemaName",
  current_schema() AS "currentSchemaName",
  current_setting('search_path') AS "searchPath",
  jsonb_build_object(
    'imports', to_regclass('public.ww_meter_register_imports')::oid::text,
    'entries', to_regclass('public.ww_meter_register_entries')::oid::text,
    'records', to_regclass('public.ww_meter_register_records')::oid::text
  ) AS "tableOids",
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
FROM public.ww_meter_register_imports imported
JOIN public.ww_meter_register_entries entry ON entry.import_id = imported.id
LEFT JOIN public.ww_meter_register_records record ON record.entry_id = entry.id
WHERE imported.source_workbook = $1
  AND imported.source_sheet = $2
  AND imported.workbook_sha256 = $3
  AND current_database() = $4
  AND current_user = $5
  AND session_user = $5
  AND current_schema() = 'pg_catalog'
  AND current_setting('search_path') = 'pg_catalog, pg_temp'
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
  databaseUser: string;
  databaseSchemaName: string;
  currentSchemaName: string;
  searchPath: string;
  tableOids: {
    imports: string;
    entries: string;
    records: string;
  };
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
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: WattwatchersMeterRegisterReconciliationDatabase;
  databaseSchema: typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA;
  searchPath: typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH;
  databaseUser: string;
  databaseIdentitySha256: string;
  tableOids: {
    imports: string;
    entries: string;
    records: string;
  };
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
  target: WattwatchersMeterRegisterReconciliationTarget,
  databaseIdentitySha256: string,
): WattwatchersMeterRegisterReconciliationSnapshot {
  assertWattwatchersMeterRegisterReconciliationSnapshotRows(rows, target);
  const first = rows[0];
  if (!first) throw new Error('Meter Register snapshot cannot be built without rows');
  const binding: WattwatchersMeterRegisterReconciliationTargetBinding = {
    target,
    database: first.databaseName as WattwatchersMeterRegisterReconciliationDatabase,
    databaseSchema: first.databaseSchemaName as
      typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA,
    searchPath: first.searchPath as typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
    databaseUser: first.databaseUser,
    databaseIdentitySha256,
    tableOids: first.tableOids,
  };
  assertWattwatchersMeterRegisterReconciliationTargetBinding(binding);
  return {
    schema: METER_REGISTER_RECONCILIATION_SNAPSHOT_SCHEMA,
    ...binding,
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
  target: WattwatchersMeterRegisterReconciliationTarget,
): void {
  if (rows.length !== MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount) {
    throw new Error('Meter Register snapshot row count does not match the pinned import');
  }
  const importIds = new Set<string>();
  let currentIdentifierCount = 0;
  let previous: WattwatchersMeterRegisterReconciliationSnapshotRow | undefined;
  const expectedDatabase = wattwatchersMeterRegisterReconciliationDatabaseForTarget(target);
  let rowTargetBinding: Omit<
    WattwatchersMeterRegisterReconciliationTargetBinding,
    'databaseIdentitySha256'
  > | undefined;
  for (const row of rows) {
    const rowBinding: Omit<
      WattwatchersMeterRegisterReconciliationTargetBinding,
      'databaseIdentitySha256'
    > = {
      target,
      database: row.databaseName as WattwatchersMeterRegisterReconciliationDatabase,
      databaseSchema: row.databaseSchemaName as
        typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA,
      searchPath: row.searchPath as typeof WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
      databaseUser: row.databaseUser,
      tableOids: row.tableOids,
    };
    assertWattwatchersMeterRegisterReconciliationTargetBinding({
      ...rowBinding,
      databaseIdentitySha256: `sha256:${'0'.repeat(64)}`,
    });
    if (row.databaseName !== expectedDatabase) {
      throw new Error('Meter Register snapshot came from an unapproved database');
    }
    if (row.currentSchemaName !== 'pg_catalog') {
      throw new Error('Meter Register snapshot came from an unapproved current schema');
    }
    if (rowTargetBinding === undefined) {
      rowTargetBinding = rowBinding;
    } else if (JSON.stringify(rowBinding) !== JSON.stringify(rowTargetBinding)) {
      throw new Error('Meter Register snapshot target binding changed between rows');
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

export function parseWattwatchersMeterRegisterSnapshotOptions(argv: string[]): {
  target: WattwatchersMeterRegisterReconciliationTarget;
  outputPath: string;
  databaseIdentitySha256: string;
} {
  const allowed = new Set(['--target', '--database-identity-sha256', '--output']);
  if (argv.length !== 6) {
    throw new Error(
      'Usage: --target <qa|production> --database-identity-sha256 <digest> '
        + '--output <private-db-snapshot.json>',
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !allowed.has(name) || !value || values.has(name)) {
      throw new Error('Snapshot exporter received invalid or duplicate options');
    }
    values.set(name, value);
  }
  const outputPath = values.get('--output');
  if (!outputPath) throw new Error('--output is required');
  const databaseIdentitySha256 = values.get('--database-identity-sha256');
  if (!databaseIdentitySha256 || !/^sha256:[a-f0-9]{64}$/u.test(databaseIdentitySha256)) {
    throw new Error(
      '--database-identity-sha256 must be a prefixed lowercase SHA-256 digest',
    );
  }
  return {
    target: parseWattwatchersMeterRegisterReconciliationTarget(values.get('--target')),
    outputPath,
    databaseIdentitySha256,
  };
}

async function main(): Promise<void> {
  const options = parseWattwatchersMeterRegisterSnapshotOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const databaseIdentity = computeWattwatchersMeterRegisterDatabaseUrlIdentity(databaseUrl);
  if (databaseIdentity.sha256 !== options.databaseIdentitySha256) {
    throw new Error('DATABASE_URL does not match --database-identity-sha256');
  }
  const expectedDatabase = wattwatchersMeterRegisterReconciliationDatabaseForTarget(
    options.target,
  );
  if (databaseIdentity.database !== expectedDatabase) {
    throw new Error(`DATABASE_URL database does not match target ${options.target}`);
  }
  const expectedDatabaseUser = wattwatchersMeterRegisterReconciliationDatabaseUserForTarget(
    options.target,
  );
  if (databaseIdentity.databaseUser !== expectedDatabaseUser) {
    throw new Error(`DATABASE_URL user does not match target ${options.target}`);
  }

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
        await transaction`SET LOCAL search_path = pg_catalog, pg_temp`;
        return transaction.unsafe<WattwatchersMeterRegisterReconciliationSnapshotRow[]>(
          METER_REGISTER_RECONCILIATION_SNAPSHOT_SQL,
          [
            METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
            METER_REGISTER_RECONCILIATION_MASTER_SHEET,
            METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
            expectedDatabase,
            expectedDatabaseUser,
          ],
        );
      },
    );
    assertWattwatchersMeterRegisterReconciliationSnapshotRows([...rows], options.target);
    const snapshot = buildWattwatchersMeterRegisterReconciliationSnapshot(
      [...rows],
      options.target,
      options.databaseIdentitySha256,
    );
    const bytes = serializeWattwatchersMeterRegisterReconciliationSnapshot(snapshot);
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex');
    await writePrivateSnapshot(options.outputPath, bytes);
    console.log(JSON.stringify({
      schema: snapshot.schema,
      target: snapshot.target,
      database: snapshot.database,
      rowCount: snapshot.rowCount,
      snapshotSha256,
      outputPath: options.outputPath,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) await main();
