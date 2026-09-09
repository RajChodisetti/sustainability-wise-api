import { createHash } from 'node:crypto';
import {
  projectMeterRegisterOperationalRecord,
  summarizeWattwatchersMeterRegister,
  type MeterRegisterImportSummary,
  type NormalizedMeterRegisterRow,
} from './wattwatchersMeterRegisterImport.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetDatabase,
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
  type WattwatchersMeterRegisterReconciliationDatabase,
  type WattwatchersMeterRegisterReconciliationDatabaseUser,
  type WattwatchersMeterRegisterReconciliationTarget,
} from './wattwatchersMeterRegisterReconciliationTarget.js';

export type WattwatchersMeterRegisterImportMode = 'dry-run' | 'apply';
export type WattwatchersMeterRegisterImportPhase = 'source' | 'operational';

export const MASTER_REGISTER_WORKBOOK_SHA256 =
  '4bb6e835928eb34bdee30d9e71f94c38d641b078a75c52a58c8450a60acd6c34';

/**
 * SHA-256 of the private, deterministic JSON extract used to build the import
 * SQL. Binding both artifacts prevents edited rows or authoritative IDs from
 * being attributed to the original workbook merely by retaining its declared
 * checksum and aggregate counts.
 */
export const MASTER_REGISTER_EXTRACT_SHA256 =
  'cc0838c881a829068d34906ec4e58db42f6b3a9c35641a0a8789dd6763d09eaa';

function normalizedArtifactSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 digest`);
  }
  return normalized;
}

export function assertMasterRegisterArtifactDigests(input: {
  workbookSha256: string;
  extractSha256: string;
}): void {
  if (normalizedArtifactSha256(input.workbookSha256, 'Master Register workbook digest')
    !== MASTER_REGISTER_WORKBOOK_SHA256) {
    throw new Error('Master Register workbook bytes do not match the approved source');
  }
  if (normalizedArtifactSha256(input.extractSha256, 'Master Register extract digest')
    !== MASTER_REGISTER_EXTRACT_SHA256) {
    throw new Error('Master Register extract bytes do not match the approved source');
  }
}

export type WattwatchersMeterRegisterExpectedSummary = Pick<
  MeterRegisterImportSummary,
  | 'sourceRowCount'
  | 'rowsWithoutCurrentIdentifier'
  | 'deviceValueCount'
  | 'uniqueIdentifierCount'
  | 'duplicateDeviceValueCount'
  | 'confirmedWattwatchersIdentifierCount'
  | 'candidateWattwatchersIdentifierCount'
  | 'otherHardwareIdentifierCount'
>;

export const MASTER_REGISTER_EXPECTED_SUMMARY: WattwatchersMeterRegisterExpectedSummary = {
  sourceRowCount: 1_917,
  rowsWithoutCurrentIdentifier: 60,
  deviceValueCount: 1_870,
  uniqueIdentifierCount: 1_859,
  duplicateDeviceValueCount: 11,
  confirmedWattwatchersIdentifierCount: 1_374,
  candidateWattwatchersIdentifierCount: 51,
  otherHardwareIdentifierCount: 434,
};

function stableId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)}`;
}

function sqlText(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

function sqlDate(value: string | null): string {
  return value === null ? 'NULL' : `${sqlText(value)}::date`;
}

function sqlBoolean(value: boolean | null): string {
  if (value === null) return 'NULL';
  return value ? 'true' : 'false';
}

function sqlInteger(value: number | null): string {
  if (value === null) return 'NULL';
  if (!Number.isSafeInteger(value)) throw new Error('Meter Register SQL integer is not safe');
  return String(value);
}

function sqlJson(value: Record<string, unknown>): string {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function assertExpectedSummary(
  actual: MeterRegisterImportSummary,
  expected: WattwatchersMeterRegisterExpectedSummary,
): void {
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[field as keyof WattwatchersMeterRegisterExpectedSummary];
    if (actualValue !== expectedValue) {
      throw new Error(
        `Meter Register ${field} changed: expected ${expectedValue}, received ${actualValue}`,
      );
    }
  }
}

function assertSingleSource(rows: readonly NormalizedMeterRegisterRow[]): NormalizedMeterRegisterRow {
  const first = rows[0];
  if (!first) throw new Error('Meter Register import requires at least one source row');
  for (const row of rows) {
    if (row.sourceWorkbook !== first.sourceWorkbook
      || row.workbookSha256 !== first.workbookSha256
      || row.sourceSheet !== first.sourceSheet
      || row.sourceNamespace !== first.sourceNamespace) {
      throw new Error('Meter Register import rows must share one workbook, checksum, and sheet');
    }
  }
  return first;
}

function stageRowSql(row: NormalizedMeterRegisterRow, importId: string): string {
  const entryId = stableId('wwmre_', row.sourceKey);
  const operational = projectMeterRegisterOperationalRecord(row);
  return `(${[
    sqlText(entryId),
    sqlText(importId),
    sqlText(row.sourceKey),
    row.sourceRow,
    sqlText(row.sourceRowSha256),
    sqlText(row.statusSnapshot),
    sqlText(row.customerNameSnapshot),
    sqlText(row.clientNameSnapshot),
    sqlText(row.siteAddressSnapshot),
    sqlText(row.siteStateSnapshot),
    sqlText(row.serviceTypeSnapshot),
    sqlText(row.meteringSolutionTypeSnapshot),
    sqlText(row.meterTypeSnapshot),
    sqlText(row.fergusJobNumberSnapshot),
    sqlText(row.quoteNumberSnapshot),
    sqlText(row.purchaseOrderNumberSnapshot),
    sqlDate(row.jobCompletionDate),
    sqlText(row.jobCompletedBySnapshot),
    sqlText(row.existingDeviceIdentifier),
    sqlText(row.newDeviceIdentifier),
    sqlText(row.currentDeviceIdentifier),
    sqlText(row.existingDeviceClassification),
    sqlText(row.newDeviceClassification),
    sqlText(row.currentDeviceClassification),
    sqlText(row.hardwareInstalledSnapshot),
    sqlBoolean(row.maas),
    sqlDate(row.maasStartDate),
    sqlText(row.maasTermSnapshot),
    sqlBoolean(row.maasReportingRequired),
    sqlBoolean(row.dataEnabled),
    sqlText(row.productNameSnapshot),
    sqlText(row.xeroInvoiceNumberSnapshot),
    sqlInteger(row.meterCostExGstCents),
    sqlInteger(row.meteringRecurringFeeExGstCents),
    sqlInteger(row.otherInvoiceCostsExGstCents),
    sqlInteger(row.invoiceAmountExGstCents),
    sqlText(row.recurringFeePoSnapshot),
    sqlText(row.invoicingClientContactSnapshot),
    sqlText(row.commentsSnapshot),
    sqlDate(row.recurringStartDate),
    sqlText(row.recurringFrequencySnapshot),
    sqlDate(row.recurringNextInvoiceIssueDate),
    sqlDate(row.invoiceIssuedDate),
    sqlText(row.billingPeriodSnapshot),
    sqlDate(row.issuedPeriodNextInvoiceIssueDate),
    sqlJson(row.rawValues),
    sqlText(operational.businessClientName),
    sqlText(operational.businessClientNormalizedKey),
    sqlText(operational.customerName),
    sqlText(operational.siteName),
    sqlText(operational.siteNameNormalizedKey),
    sqlText(operational.siteAddress),
    sqlText(operational.siteState),
    sqlBoolean(operational.siteAddress === 'NA'),
    sqlJson(operational.details),
  ].join(', ')})`;
}

/**
 * Materializes only missing editable records. Existing records may already
 * contain operator corrections, so repeated imports never overwrite them.
 */
function operationalProjectionSql(): string {
  return `DO $$
DECLARE
  locked_entry_id text;
BEGIN
  FOR locked_entry_id IN
    SELECT stage.entry_id
    FROM pg_temp.ww_meter_register_stage stage
    WHERE stage.current_device_identifier IS NOT NULL
    ORDER BY stage.entry_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sustainability-wise:meter-register-entry:' || locked_entry_id,
      0
    ));
  END LOOP;
END $$;

CREATE TEMP TABLE pg_temp.ww_meter_register_operational_stage ON COMMIT DROP AS
SELECT
  stage.entry_id,
  stage.operational_client_name AS business_client_name,
  stage.operational_client_normalized_key AS business_client_normalized_key,
  stage.operational_customer_name AS customer_name,
  stage.operational_site_name AS site_name,
  stage.operational_site_name_normalized_key AS site_name_normalized_key,
  stage.operational_site_address AS site_address,
  stage.operational_site_state AS site_state,
  stage.operational_placeholder_site AS placeholder_site,
  CASE WHEN stage.operational_placeholder_site THEN stage.entry_id ELSE '' END
    AS site_identity_discriminator,
  public.sw_business_site_address_fingerprint(
    stage.operational_site_address,
    NULL,
    stage.operational_site_state,
    NULL,
    'AU'
  ) AS address_fingerprint,
  stage.operational_details AS details
FROM pg_temp.ww_meter_register_stage stage
WHERE stage.current_device_identifier IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.ww_meter_register_records existing
    WHERE existing.entry_id = stage.entry_id
  );

ALTER TABLE pg_temp.ww_meter_register_operational_stage ADD PRIMARY KEY (entry_id);

DO $$
DECLARE
  locked_client_key text;
BEGIN
  FOR locked_client_key IN
    SELECT DISTINCT stage.business_client_normalized_key
    FROM pg_temp.ww_meter_register_operational_stage stage
    ORDER BY stage.business_client_normalized_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sustainability-wise:client:' || locked_client_key,
      0
    ));
  END LOOP;
END $$;

INSERT INTO public.business_clients (
  id, company_key, name, normalized_key, created_at, updated_at
)
SELECT DISTINCT ON (stage.business_client_normalized_key)
  'bc_wwmr_' || md5(stage.business_client_normalized_key),
  'sustainability-wise',
  stage.business_client_name,
  stage.business_client_normalized_key,
  now(),
  now()
FROM pg_temp.ww_meter_register_operational_stage stage
WHERE NOT EXISTS (
  SELECT 1
  FROM public.business_clients existing
  WHERE existing.company_key = 'sustainability-wise'
    AND existing.normalized_key = stage.business_client_normalized_key
)
ORDER BY stage.business_client_normalized_key, stage.entry_id
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE pg_temp.ww_meter_register_operational_client_map ON COMMIT DROP AS
WITH RECURSIVE client_roots AS (
  SELECT
    keys.business_client_normalized_key,
    candidate.id AS business_client_id,
    candidate.merged_into_client_id,
    ARRAY[candidate.id]::text[] AS visited_ids,
    0 AS depth
  FROM (
    SELECT DISTINCT stage.business_client_normalized_key
    FROM pg_temp.ww_meter_register_operational_stage stage
  ) keys
  JOIN LATERAL (
    SELECT client.id, client.merged_into_client_id
    FROM public.business_clients client
    WHERE client.company_key = 'sustainability-wise'
      AND client.normalized_key = keys.business_client_normalized_key
    ORDER BY
      (client.merged_into_client_id IS NULL) DESC,
      client.created_at,
      client.id
    LIMIT 1
  ) candidate ON true
), client_chain AS (
  SELECT * FROM client_roots
  UNION ALL
  SELECT
    client_chain.business_client_normalized_key,
    next_client.id,
    next_client.merged_into_client_id,
    client_chain.visited_ids || next_client.id,
    client_chain.depth + 1
  FROM client_chain
  JOIN public.business_clients next_client
    ON next_client.id = client_chain.merged_into_client_id
   AND next_client.company_key = 'sustainability-wise'
  WHERE client_chain.merged_into_client_id IS NOT NULL
    AND client_chain.depth < 19
    AND NOT (next_client.id = ANY(client_chain.visited_ids))
)
SELECT DISTINCT ON (client_chain.business_client_normalized_key)
  client_chain.business_client_normalized_key,
  client_chain.business_client_id
FROM client_chain
WHERE client_chain.merged_into_client_id IS NULL
ORDER BY
  client_chain.business_client_normalized_key,
  client_chain.depth DESC,
  client_chain.business_client_id;

ALTER TABLE pg_temp.ww_meter_register_operational_client_map
  ADD PRIMARY KEY (business_client_normalized_key);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.ww_meter_register_operational_stage stage
    LEFT JOIN pg_temp.ww_meter_register_operational_client_map client_map
      ON client_map.business_client_normalized_key = stage.business_client_normalized_key
    WHERE client_map.business_client_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Meter Register client alias has an invalid merge target, cycle, or excessive depth';
  END IF;
END $$;

DO $$
DECLARE
  locked_site_key text;
BEGIN
  FOR locked_site_key IN
    SELECT DISTINCT
      'sustainability-wise:site:' || client_map.business_client_id
        || ':' || stage.address_fingerprint AS lock_key
    FROM pg_temp.ww_meter_register_operational_stage stage
    JOIN pg_temp.ww_meter_register_operational_client_map client_map
      ON client_map.business_client_normalized_key = stage.business_client_normalized_key
    ORDER BY lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(locked_site_key, 0));
  END LOOP;
END $$;

WITH resolved AS (
  SELECT stage.*, client_map.business_client_id
  FROM pg_temp.ww_meter_register_operational_stage stage
  JOIN pg_temp.ww_meter_register_operational_client_map client_map
    ON client_map.business_client_normalized_key = stage.business_client_normalized_key
), canonical_sites AS (
  SELECT DISTINCT ON (
    resolved.business_client_id,
    resolved.site_name_normalized_key,
    resolved.address_fingerprint,
    resolved.site_identity_discriminator
  ) resolved.*
  FROM resolved
  ORDER BY
    resolved.business_client_id,
    resolved.site_name_normalized_key,
    resolved.address_fingerprint,
    resolved.site_identity_discriminator,
    resolved.entry_id
)
INSERT INTO public.business_sites (
  id, client_id, name, address, state, country_code,
  address_source, geocode_status, address_fingerprint, timezone,
  created_at, updated_at
)
SELECT
  CASE WHEN canonical_sites.placeholder_site THEN
    'bs_wwmr_' || md5(
      canonical_sites.business_client_id || chr(31)
      || 'entry:' || canonical_sites.entry_id
    )
  ELSE
    'bs_wwmr_' || md5(
      canonical_sites.business_client_id || chr(31)
      || canonical_sites.site_name_normalized_key || chr(31)
      || canonical_sites.address_fingerprint
    )
  END,
  canonical_sites.business_client_id,
  canonical_sites.site_name,
  canonical_sites.site_address,
  canonical_sites.site_state,
  'AU',
  'manual',
  'unresolved',
  canonical_sites.address_fingerprint,
  CASE canonical_sites.site_state
    WHEN 'QLD' THEN 'Australia/Brisbane'
    WHEN 'NT' THEN 'Australia/Darwin'
    WHEN 'SA' THEN 'Australia/Adelaide'
    WHEN 'TAS' THEN 'Australia/Hobart'
    WHEN 'VIC' THEN 'Australia/Melbourne'
    WHEN 'WA' THEN 'Australia/Perth'
    ELSE 'Australia/Sydney'
  END,
  now(),
  now()
FROM canonical_sites
WHERE NOT EXISTS (
  SELECT 1
  FROM public.business_sites existing
  WHERE (
    canonical_sites.placeholder_site
    AND existing.id = 'bs_wwmr_' || md5(
      canonical_sites.business_client_id || chr(31)
      || 'entry:' || canonical_sites.entry_id
    )
  ) OR (
    NOT canonical_sites.placeholder_site
    AND existing.client_id = canonical_sites.business_client_id
    AND lower(regexp_replace(btrim(normalize(existing.name, NFKC)), '[[:space:]]+', ' ', 'g'))
      = canonical_sites.site_name_normalized_key
    AND existing.address_fingerprint = canonical_sites.address_fingerprint
  )
)
ON CONFLICT (id) DO NOTHING;

WITH resolved AS (
  SELECT
    stage.*,
    client_map.business_client_id AS resolved_business_client_id,
    CASE WHEN stage.placeholder_site THEN
      'bs_wwmr_' || md5(
        client_map.business_client_id || chr(31) || 'entry:' || stage.entry_id
      )
    ELSE NULL END AS placeholder_business_site_id
  FROM pg_temp.ww_meter_register_operational_stage stage
  JOIN pg_temp.ww_meter_register_operational_client_map client_map
    ON client_map.business_client_normalized_key = stage.business_client_normalized_key
), linked AS (
  SELECT resolved.*, site.id AS resolved_business_site_id
  FROM resolved
  JOIN LATERAL (
    SELECT candidate.id
    FROM public.business_sites candidate
    WHERE (
      resolved.placeholder_site
      AND candidate.client_id = resolved.resolved_business_client_id
      AND candidate.id = resolved.placeholder_business_site_id
    ) OR (
      NOT resolved.placeholder_site
      AND candidate.client_id = resolved.resolved_business_client_id
      AND lower(regexp_replace(btrim(normalize(candidate.name, NFKC)), '[[:space:]]+', ' ', 'g'))
        = resolved.site_name_normalized_key
      AND candidate.address_fingerprint = resolved.address_fingerprint
    )
    ORDER BY candidate.created_at, candidate.id
    LIMIT 1
  ) site ON true
)
INSERT INTO public.ww_meter_register_records (
  entry_id, business_client_id, business_site_id, customer_name,
  details, revision, updated_by_user_id, created_at, updated_at
)
SELECT
  linked.entry_id,
  linked.resolved_business_client_id,
  linked.resolved_business_site_id,
  linked.customer_name,
  linked.details,
  1,
  NULL,
  now(),
  now()
FROM linked
ON CONFLICT (entry_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.ww_meter_register_stage stage
    LEFT JOIN public.ww_meter_register_records record ON record.entry_id = stage.entry_id
    WHERE stage.current_device_identifier IS NOT NULL
      AND record.entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every imported Meter Register current identifier must have an operational record';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.ww_meter_register_stage stage
    JOIN public.ww_meter_register_records record ON record.entry_id = stage.entry_id
    WHERE stage.current_device_identifier IS NULL
  ) THEN
    RAISE EXCEPTION 'A Meter Register operational record has no current identifier';
  END IF;
END $$;`;
}

export type BuildWattwatchersMeterRegisterImportSqlInput = {
  rows: NormalizedMeterRegisterRow[];
  mode: WattwatchersMeterRegisterImportMode;
  phase: WattwatchersMeterRegisterImportPhase;
  target: WattwatchersMeterRegisterReconciliationTarget;
  database: WattwatchersMeterRegisterReconciliationDatabase;
  databaseUser: WattwatchersMeterRegisterReconciliationDatabaseUser;
  databaseIdentitySha256: string;
  expected?: WattwatchersMeterRegisterExpectedSummary;
};

export type BuiltWattwatchersMeterRegisterImportSql = {
  sql: string;
  importId: string;
  summary: MeterRegisterImportSummary;
};

/**
 * Build a transaction-protected import. The source phase appends immutable
 * workbook evidence and links only source-confirmed IDs to existing Fleet
 * devices. The operational phase creates only missing Meter Register business
 * clients, sites, and editable records; neither phase creates or updates Fleet
 * devices, Field, Scheduler, or finance records.
 */
export function buildWattwatchersMeterRegisterImportSql(
  input: BuildWattwatchersMeterRegisterImportSqlInput,
): BuiltWattwatchersMeterRegisterImportSql {
  if (input.mode !== 'dry-run' && input.mode !== 'apply') {
    throw new Error('Meter Register import mode must be dry-run or apply');
  }
  if (input.phase !== 'source' && input.phase !== 'operational') {
    throw new Error('Meter Register import phase must be source or operational');
  }
  assertWattwatchersMeterRegisterReconciliationTargetDatabase(input);
  assertWattwatchersMeterRegisterReconciliationTargetDatabaseUser(input);
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.databaseIdentitySha256)) {
    throw new Error('Meter Register import database identity must be a prefixed SHA-256 digest');
  }
  const source = assertSingleSource(input.rows);
  const summary = summarizeWattwatchersMeterRegister(input.rows);
  const expected = input.expected ?? MASTER_REGISTER_EXPECTED_SUMMARY;
  assertExpectedSummary(summary, expected);
  const importId = stableId('wwmri_', source.sourceNamespace);
  const values = input.rows.map((row) => stageRowSql(row, importId)).join(',\n');
  const finish = input.mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';
  const expectedOperationalRecordCount =
    summary.sourceRowCount - summary.rowsWithoutCurrentIdentifier;
  // Current business-site triggers call their public helper functions without
  // schema qualification. Keep pg_catalog first, but explicitly admit public
  // only for the operational phase that invokes those triggers.
  const importSearchPath = input.phase === 'operational'
    ? 'pg_catalog, public, pg_temp'
    : WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH;
  const requiredTables = [
    'ww_devices',
    'ww_meter_register_imports',
    'ww_meter_register_entries',
    ...(input.phase === 'operational'
      ? ['business_clients', 'business_sites', 'ww_meter_register_records']
      : []),
  ];
  const missingRequiredRelationsSql = requiredTables
    .map((table) => `to_regclass('public.${table}') IS NULL`)
    .join('\n      OR ');
  const requiredRelationRegclassesSql = requiredTables
    .map((table) => `to_regclass('public.${table}')`)
    .join(',\n      ');
  const missingRequiredFunctionSql = input.phase === 'operational'
    ? `\n      OR to_regprocedure(\n        'public.sw_business_site_address_fingerprint(text,text,text,text,text)'\n      ) IS NULL`
    : '';
  const operationalRecordCountSql = input.phase === 'operational'
    ? `(\n      SELECT count(*)::integer\n      FROM pg_temp.ww_meter_register_stage stage\n      JOIN public.ww_meter_register_records record ON record.entry_id = stage.entry_id\n      WHERE stage.current_device_identifier IS NOT NULL\n    )`
    : 'NULL::integer';
  const pendingPreexistingStateSql = input.phase === 'operational'
    ? `metadata_count = 1\n        AND source_entry_count = ${summary.sourceRowCount}\n        AND import_entry_count = ${summary.sourceRowCount}\n        AND operational_record_count = 0`
    : `metadata_count = 0\n        AND source_entry_count = 0\n        AND import_entry_count = 0`;
  const appliedPreexistingStateSql = input.phase === 'operational'
    ? `metadata_count = 1\n        AND source_entry_count = ${summary.sourceRowCount}\n        AND import_entry_count = ${summary.sourceRowCount}\n        AND operational_record_count = ${expectedOperationalRecordCount}`
    : `metadata_count = 1\n        AND source_entry_count = ${summary.sourceRowCount}\n        AND import_entry_count = ${summary.sourceRowCount}`;
  const operationalProjection = input.phase === 'operational'
    ? operationalProjectionSql()
    : '';
  const operationalRecordResultSql = input.phase === 'operational'
    ? `(SELECT count(*)::integer
       FROM pg_temp.ww_meter_register_stage stage
       JOIN public.ww_meter_register_records record ON record.entry_id = stage.entry_id
       WHERE stage.current_device_identifier IS NOT NULL)`
    : 'NULL::integer';

  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SET LOCAL search_path = ${importSearchPath};

DO $$
BEGIN
  IF current_database() IS DISTINCT FROM ${sqlText(input.database)} THEN
    RAISE EXCEPTION 'Meter Register import target/database fence failed';
  END IF;
  IF current_user IS DISTINCT FROM ${sqlText(input.databaseUser)}
      OR session_user IS DISTINCT FROM ${sqlText(input.databaseUser)} THEN
    RAISE EXCEPTION 'Meter Register import database-role fence failed';
  END IF;
  IF current_schema() IS DISTINCT FROM 'pg_catalog'
      OR current_setting('search_path') IS DISTINCT FROM ${sqlText(
        importSearchPath,
      )} THEN
    RAISE EXCEPTION 'Meter Register import schema/search_path fence failed';
  END IF;
  IF ${missingRequiredRelationsSql}${missingRequiredFunctionSql} THEN
    RAISE EXCEPTION 'Meter Register import required public tables/functions are missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      ${requiredRelationRegclassesSql}
    ]) required(table_oid)
    JOIN pg_catalog.pg_class table_class ON table_class.oid = required.table_oid
    JOIN pg_catalog.pg_namespace table_schema
      ON table_schema.oid = table_class.relnamespace
    WHERE table_schema.nspname IS DISTINCT FROM 'public'
       OR table_class.relkind IS DISTINCT FROM 'r'
  ) THEN
    RAISE EXCEPTION 'Meter Register import required relations are not public base tables';
  END IF;
END $$;

SELECT pg_advisory_xact_lock(hashtext(${sqlText(
    `wattwatchers-meter-register-import:${input.target}`,
  )}));

CREATE TEMP TABLE pg_temp.ww_meter_register_import_provenance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  target_name text NOT NULL,
  database_name text NOT NULL,
  database_user text NOT NULL,
  database_identity_sha256 text NOT NULL,
  search_path text NOT NULL,
  import_phase text NOT NULL,
  import_id text NOT NULL,
  source_workbook text NOT NULL,
  source_sheet text NOT NULL,
  workbook_sha256 text NOT NULL,
  extract_sha256 text NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.ww_meter_register_import_provenance (
  target_name,
  database_name,
  database_user,
  database_identity_sha256,
  search_path,
  import_phase,
  import_id,
  source_workbook,
  source_sheet,
  workbook_sha256,
  extract_sha256
) VALUES (
  ${sqlText(input.target)},
  ${sqlText(input.database)},
  ${sqlText(input.databaseUser)},
  ${sqlText(input.databaseIdentitySha256)},
  ${sqlText(importSearchPath)},
  ${sqlText(input.phase)},
  ${sqlText(importId)},
  ${sqlText(source.sourceWorkbook)},
  ${sqlText(source.sourceSheet)},
  ${sqlText(source.workbookSha256)},
  ${sqlText(MASTER_REGISTER_EXTRACT_SHA256)}
);

CREATE TEMP TABLE pg_temp.ww_meter_register_stage (
  entry_id text NOT NULL,
  import_id text NOT NULL,
  source_key text NOT NULL,
  source_row integer NOT NULL,
  source_row_sha256 text NOT NULL,
  status_snapshot text,
  customer_name_snapshot text,
  client_name_snapshot text,
  site_address_snapshot text,
  site_state_snapshot text,
  service_type_snapshot text,
  metering_solution_type_snapshot text,
  meter_type_snapshot text,
  fergus_job_number_snapshot text,
  quote_number_snapshot text,
  purchase_order_number_snapshot text,
  job_completion_date date,
  job_completed_by_snapshot text,
  existing_device_identifier text,
  new_device_identifier text,
  current_device_identifier text,
  existing_device_classification text NOT NULL,
  new_device_classification text NOT NULL,
  current_device_classification text NOT NULL,
  hardware_installed_snapshot text,
  maas boolean,
  maas_start_date date,
  maas_term_snapshot text,
  maas_reporting_required boolean,
  data_enabled boolean,
  product_name_snapshot text,
  xero_invoice_number_snapshot text,
  meter_cost_ex_gst_cents bigint,
  metering_recurring_fee_ex_gst_cents bigint,
  other_invoice_costs_ex_gst_cents bigint,
  invoice_amount_ex_gst_cents bigint,
  recurring_fee_po_snapshot text,
  invoicing_client_contact_snapshot text,
  comments_snapshot text,
  recurring_start_date date,
  recurring_frequency_snapshot text,
  recurring_next_invoice_issue_date date,
  invoice_issued_date date,
  billing_period_snapshot text,
  issued_period_next_invoice_issue_date date,
  source_payload jsonb NOT NULL,
  operational_client_name text NOT NULL,
  operational_client_normalized_key text NOT NULL,
  operational_customer_name text NOT NULL,
  operational_site_name text NOT NULL,
  operational_site_name_normalized_key text NOT NULL,
  operational_site_address text NOT NULL,
  operational_site_state text,
  operational_placeholder_site boolean NOT NULL,
  operational_details jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.ww_meter_register_stage VALUES
${values};

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.ww_meter_register_stage) <> ${expected.sourceRowCount} THEN
    RAISE EXCEPTION 'Meter Register source row count changed';
  END IF;
  IF (SELECT count(*) FROM (
    SELECT existing_device_identifier AS identifier FROM pg_temp.ww_meter_register_stage
    UNION ALL
    SELECT new_device_identifier FROM pg_temp.ww_meter_register_stage
  ) identifiers WHERE identifier IS NOT NULL) <> ${expected.deviceValueCount} THEN
    RAISE EXCEPTION 'Meter Register device value count changed';
  END IF;
  IF (SELECT count(DISTINCT identifier) FROM (
    SELECT existing_device_identifier AS identifier FROM pg_temp.ww_meter_register_stage
    UNION ALL
    SELECT new_device_identifier FROM pg_temp.ww_meter_register_stage
  ) identifiers WHERE identifier IS NOT NULL) <> ${expected.uniqueIdentifierCount} THEN
    RAISE EXCEPTION 'Meter Register unique identifier count changed';
  END IF;
  IF EXISTS (
    SELECT identifier
    FROM (
      SELECT existing_device_identifier AS identifier,
             existing_device_classification AS classification
      FROM pg_temp.ww_meter_register_stage
      WHERE existing_device_identifier IS NOT NULL
      UNION ALL
      SELECT new_device_identifier, new_device_classification
      FROM pg_temp.ww_meter_register_stage
      WHERE new_device_identifier IS NOT NULL
    ) classified
    GROUP BY identifier
    HAVING count(DISTINCT classification) <> 1
  ) THEN
    RAISE EXCEPTION 'Meter Register identifier classification is inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT existing_device_identifier AS identifier
      FROM pg_temp.ww_meter_register_stage
      WHERE existing_device_classification = 'confirmed_wattwatchers'
      UNION
      SELECT new_device_identifier
      FROM pg_temp.ww_meter_register_stage
      WHERE new_device_classification = 'confirmed_wattwatchers'
    ) confirmed
    LEFT JOIN public.ww_devices device ON device.device_id = confirmed.identifier
    WHERE device.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A source-confirmed Wattwatchers identifier is missing from Fleet';
  END IF;
END $$;

CREATE TEMP TABLE pg_temp.ww_meter_register_import_preflight (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  preexisting_state text NOT NULL CHECK (preexisting_state IN ('pending', 'applied')),
  metadata_count integer NOT NULL,
  source_entry_count integer NOT NULL,
  import_entry_count integer NOT NULL,
  operational_record_count integer
) ON COMMIT DROP;

WITH counts AS (
  SELECT
    (
      SELECT count(*)::integer
      FROM public.ww_meter_register_imports imported
      WHERE imported.id = ${sqlText(importId)}
         OR (
           imported.workbook_sha256 = ${sqlText(source.workbookSha256)}
           AND imported.source_sheet = ${sqlText(source.sourceSheet)}
         )
    ) AS metadata_count,
    (
      SELECT count(*)::integer
      FROM public.ww_meter_register_entries imported
      JOIN pg_temp.ww_meter_register_stage stage ON stage.source_key = imported.source_key
    ) AS source_entry_count,
    (
      SELECT count(*)::integer
      FROM public.ww_meter_register_entries imported
      WHERE imported.import_id = ${sqlText(importId)}
    ) AS import_entry_count,
    ${operationalRecordCountSql} AS operational_record_count
), classified AS (
  SELECT
    CASE
      WHEN ${pendingPreexistingStateSql}
        THEN 'pending'
      WHEN ${appliedPreexistingStateSql}
        THEN 'applied'
      ELSE NULL
    END AS preexisting_state,
    counts.*
  FROM counts
)
INSERT INTO pg_temp.ww_meter_register_import_preflight (
  preexisting_state,
  metadata_count,
  source_entry_count,
  import_entry_count,
  operational_record_count
)
SELECT
  preexisting_state,
  metadata_count,
  source_entry_count,
  import_entry_count,
  operational_record_count
FROM classified
WHERE preexisting_state IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.ww_meter_register_import_preflight) THEN
    RAISE EXCEPTION 'Meter Register import is in a mixed or partial preexisting state';
  END IF;
END $$;

INSERT INTO public.ww_meter_register_imports (
  id, source_workbook, source_sheet, workbook_sha256,
  source_row_count, device_value_count, unique_identifier_count,
  confirmed_wattwatchers_identifier_count,
  candidate_wattwatchers_identifier_count,
  other_hardware_identifier_count,
  created_at, updated_at
) VALUES (
  ${sqlText(importId)},
  ${sqlText(source.sourceWorkbook)},
  ${sqlText(source.sourceSheet)},
  ${sqlText(source.workbookSha256)},
  ${summary.sourceRowCount},
  ${summary.deviceValueCount},
  ${summary.uniqueIdentifierCount},
  ${summary.confirmedWattwatchersIdentifierCount},
  ${summary.candidateWattwatchersIdentifierCount},
  ${summary.otherHardwareIdentifierCount},
  now(),
  now()
)
ON CONFLICT (workbook_sha256, source_sheet) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ww_meter_register_imports imported
    WHERE imported.id = ${sqlText(importId)}
      AND imported.source_sheet = ${sqlText(source.sourceSheet)}
      AND imported.workbook_sha256 = ${sqlText(source.workbookSha256)}
      AND imported.source_row_count = ${summary.sourceRowCount}
      AND imported.device_value_count = ${summary.deviceValueCount}
      AND imported.unique_identifier_count = ${summary.uniqueIdentifierCount}
      AND imported.confirmed_wattwatchers_identifier_count = ${summary.confirmedWattwatchersIdentifierCount}
      AND imported.candidate_wattwatchers_identifier_count = ${summary.candidateWattwatchersIdentifierCount}
      AND imported.other_hardware_identifier_count = ${summary.otherHardwareIdentifierCount}
  ) THEN
    RAISE EXCEPTION 'Existing Meter Register import metadata does not match';
  END IF;
END $$;

INSERT INTO public.ww_meter_register_entries (
  id, import_id, source_key, source_row, source_row_sha256,
  status_snapshot, customer_name_snapshot, client_name_snapshot,
  site_address_snapshot, site_state_snapshot, service_type_snapshot,
  metering_solution_type_snapshot, meter_type_snapshot,
  fergus_job_number_snapshot, quote_number_snapshot, purchase_order_number_snapshot,
  job_completion_date, job_completed_by_snapshot,
  existing_device_identifier, new_device_identifier, current_device_identifier,
  existing_device_classification, new_device_classification, current_device_classification,
  existing_wattwatchers_device_id, new_wattwatchers_device_id, current_wattwatchers_device_id,
  hardware_installed_snapshot, maas, maas_start_date, maas_term_snapshot,
  maas_reporting_required, data_enabled, product_name_snapshot, xero_invoice_number_snapshot,
  meter_cost_ex_gst_cents, metering_recurring_fee_ex_gst_cents,
  other_invoice_costs_ex_gst_cents, invoice_amount_ex_gst_cents,
  recurring_fee_po_snapshot, invoicing_client_contact_snapshot, comments_snapshot,
  recurring_start_date, recurring_frequency_snapshot, recurring_next_invoice_issue_date,
  invoice_issued_date, billing_period_snapshot, issued_period_next_invoice_issue_date,
  source_payload, created_at, updated_at
)
SELECT
  stage.entry_id,
  stage.import_id,
  stage.source_key,
  stage.source_row,
  stage.source_row_sha256,
  stage.status_snapshot,
  stage.customer_name_snapshot,
  stage.client_name_snapshot,
  stage.site_address_snapshot,
  stage.site_state_snapshot,
  stage.service_type_snapshot,
  stage.metering_solution_type_snapshot,
  stage.meter_type_snapshot,
  stage.fergus_job_number_snapshot,
  stage.quote_number_snapshot,
  stage.purchase_order_number_snapshot,
  stage.job_completion_date,
  stage.job_completed_by_snapshot,
  stage.existing_device_identifier,
  stage.new_device_identifier,
  stage.current_device_identifier,
  stage.existing_device_classification,
  stage.new_device_classification,
  stage.current_device_classification,
  existing_device.id,
  new_device.id,
  current_device.id,
  stage.hardware_installed_snapshot,
  stage.maas,
  stage.maas_start_date,
  stage.maas_term_snapshot,
  stage.maas_reporting_required,
  stage.data_enabled,
  stage.product_name_snapshot,
  stage.xero_invoice_number_snapshot,
  stage.meter_cost_ex_gst_cents,
  stage.metering_recurring_fee_ex_gst_cents,
  stage.other_invoice_costs_ex_gst_cents,
  stage.invoice_amount_ex_gst_cents,
  stage.recurring_fee_po_snapshot,
  stage.invoicing_client_contact_snapshot,
  stage.comments_snapshot,
  stage.recurring_start_date,
  stage.recurring_frequency_snapshot,
  stage.recurring_next_invoice_issue_date,
  stage.invoice_issued_date,
  stage.billing_period_snapshot,
  stage.issued_period_next_invoice_issue_date,
  stage.source_payload,
  now(),
  now()
FROM pg_temp.ww_meter_register_stage stage
LEFT JOIN public.ww_devices existing_device
  ON stage.existing_device_classification = 'confirmed_wattwatchers'
 AND existing_device.device_id = stage.existing_device_identifier
LEFT JOIN public.ww_devices new_device
  ON stage.new_device_classification = 'confirmed_wattwatchers'
 AND new_device.device_id = stage.new_device_identifier
LEFT JOIN public.ww_devices current_device
  ON stage.current_device_classification = 'confirmed_wattwatchers'
 AND current_device.device_id = stage.current_device_identifier
ON CONFLICT (source_key) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.ww_meter_register_entries WHERE import_id = ${sqlText(importId)}) <> ${summary.sourceRowCount} THEN
    RAISE EXCEPTION 'Imported Meter Register row count is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.ww_meter_register_stage stage
    JOIN public.ww_meter_register_entries imported ON imported.source_key = stage.source_key
    LEFT JOIN public.ww_devices existing_device
      ON stage.existing_device_classification = 'confirmed_wattwatchers'
     AND existing_device.device_id = stage.existing_device_identifier
    LEFT JOIN public.ww_devices new_device
      ON stage.new_device_classification = 'confirmed_wattwatchers'
     AND new_device.device_id = stage.new_device_identifier
    LEFT JOIN public.ww_devices current_device
      ON stage.current_device_classification = 'confirmed_wattwatchers'
     AND current_device.device_id = stage.current_device_identifier
    WHERE ROW(
      imported.import_id,
      imported.source_row,
      imported.source_row_sha256,
      imported.status_snapshot,
      imported.customer_name_snapshot,
      imported.client_name_snapshot,
      imported.site_address_snapshot,
      imported.site_state_snapshot,
      imported.service_type_snapshot,
      imported.metering_solution_type_snapshot,
      imported.meter_type_snapshot,
      imported.fergus_job_number_snapshot,
      imported.quote_number_snapshot,
      imported.purchase_order_number_snapshot,
      imported.job_completion_date,
      imported.job_completed_by_snapshot,
      imported.existing_device_identifier,
      imported.new_device_identifier,
      imported.current_device_identifier,
      imported.existing_device_classification,
      imported.new_device_classification,
      imported.current_device_classification,
      imported.existing_wattwatchers_device_id,
      imported.new_wattwatchers_device_id,
      imported.current_wattwatchers_device_id,
      imported.hardware_installed_snapshot,
      imported.maas,
      imported.maas_start_date,
      imported.maas_term_snapshot,
      imported.maas_reporting_required,
      imported.data_enabled,
      imported.product_name_snapshot,
      imported.xero_invoice_number_snapshot,
      imported.meter_cost_ex_gst_cents,
      imported.metering_recurring_fee_ex_gst_cents,
      imported.other_invoice_costs_ex_gst_cents,
      imported.invoice_amount_ex_gst_cents,
      imported.recurring_fee_po_snapshot,
      imported.invoicing_client_contact_snapshot,
      imported.comments_snapshot,
      imported.recurring_start_date,
      imported.recurring_frequency_snapshot,
      imported.recurring_next_invoice_issue_date,
      imported.invoice_issued_date,
      imported.billing_period_snapshot,
      imported.issued_period_next_invoice_issue_date,
      imported.source_payload
    ) IS DISTINCT FROM ROW(
      stage.import_id,
      stage.source_row,
      stage.source_row_sha256,
      stage.status_snapshot,
      stage.customer_name_snapshot,
      stage.client_name_snapshot,
      stage.site_address_snapshot,
      stage.site_state_snapshot,
      stage.service_type_snapshot,
      stage.metering_solution_type_snapshot,
      stage.meter_type_snapshot,
      stage.fergus_job_number_snapshot,
      stage.quote_number_snapshot,
      stage.purchase_order_number_snapshot,
      stage.job_completion_date,
      stage.job_completed_by_snapshot,
      stage.existing_device_identifier,
      stage.new_device_identifier,
      stage.current_device_identifier,
      stage.existing_device_classification,
      stage.new_device_classification,
      stage.current_device_classification,
      existing_device.id,
      new_device.id,
      current_device.id,
      stage.hardware_installed_snapshot,
      stage.maas,
      stage.maas_start_date,
      stage.maas_term_snapshot,
      stage.maas_reporting_required,
      stage.data_enabled,
      stage.product_name_snapshot,
      stage.xero_invoice_number_snapshot,
      stage.meter_cost_ex_gst_cents,
      stage.metering_recurring_fee_ex_gst_cents,
      stage.other_invoice_costs_ex_gst_cents,
      stage.invoice_amount_ex_gst_cents,
      stage.recurring_fee_po_snapshot,
      stage.invoicing_client_contact_snapshot,
      stage.comments_snapshot,
      stage.recurring_start_date,
      stage.recurring_frequency_snapshot,
      stage.recurring_next_invoice_issue_date,
      stage.invoice_issued_date,
      stage.billing_period_snapshot,
      stage.issued_period_next_invoice_issue_date,
      stage.source_payload
    )
  ) THEN
    RAISE EXCEPTION 'Existing Meter Register normalized source row or Fleet link does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.ww_meter_register_entries imported
    WHERE imported.import_id = ${sqlText(importId)}
      AND (
        (imported.existing_device_classification = 'confirmed_wattwatchers')
          <> (imported.existing_wattwatchers_device_id IS NOT NULL)
        OR (imported.new_device_classification = 'confirmed_wattwatchers')
          <> (imported.new_wattwatchers_device_id IS NOT NULL)
        OR (imported.current_device_classification = 'confirmed_wattwatchers')
          <> (imported.current_wattwatchers_device_id IS NOT NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Meter Register Fleet links do not match source confirmation';
  END IF;
END $$;

${operationalProjection}

WITH identifiers AS (
  SELECT existing_device_identifier AS identifier,
         existing_device_classification AS classification
  FROM public.ww_meter_register_entries
  WHERE import_id = ${sqlText(importId)} AND existing_device_identifier IS NOT NULL
  UNION ALL
  SELECT new_device_identifier, new_device_classification
  FROM public.ww_meter_register_entries
  WHERE import_id = ${sqlText(importId)} AND new_device_identifier IS NOT NULL
), unique_identifiers AS (
  SELECT identifier, min(classification) AS classification
  FROM identifiers
  GROUP BY identifier
)
SELECT
  (SELECT target_name FROM pg_temp.ww_meter_register_import_provenance) AS target_name,
  current_database() AS database_name,
  current_user AS database_user,
  session_user AS session_user,
  (SELECT database_identity_sha256 FROM pg_temp.ww_meter_register_import_provenance)
    AS database_identity_sha256,
  current_setting('search_path') AS search_path,
  (SELECT import_phase FROM pg_temp.ww_meter_register_import_provenance) AS import_phase,
  ${sqlText(input.mode)} AS apply_mode,
  ${sqlText(input.mode === 'apply' ? 'commit' : 'rollback')} AS transaction_action,
  (SELECT import_id FROM pg_temp.ww_meter_register_import_provenance) AS import_id,
  (SELECT workbook_sha256 FROM pg_temp.ww_meter_register_import_provenance)
    AS workbook_sha256,
  (SELECT extract_sha256 FROM pg_temp.ww_meter_register_import_provenance) AS extract_sha256,
  pg_catalog.jsonb_build_object(
    'devices', to_regclass('public.ww_devices')::oid::text,
    'imports', to_regclass('public.ww_meter_register_imports')::oid::text,
    'entries', to_regclass('public.ww_meter_register_entries')::oid::text,
    'records', to_regclass('public.ww_meter_register_records')::oid::text
  ) AS table_oids,
  (SELECT preexisting_state FROM pg_temp.ww_meter_register_import_preflight)
    AS preexisting_state,
  ${operationalRecordResultSql} AS operational_record_count,
  (SELECT count(*) FROM public.ww_meter_register_entries WHERE import_id = ${sqlText(importId)}) AS source_rows,
  (SELECT count(*) FROM identifiers) AS device_values,
  count(*) AS unique_identifiers,
  count(*) FILTER (WHERE classification = 'confirmed_wattwatchers') AS confirmed_wattwatchers,
  count(*) FILTER (WHERE classification = 'candidate_wattwatchers') AS candidate_wattwatchers,
  count(*) FILTER (WHERE classification = 'other_hardware') AS other_hardware,
  (SELECT count(*) FROM public.ww_meter_register_entries
    WHERE import_id = ${sqlText(importId)} AND current_device_identifier IS NULL) AS rows_without_identifier
FROM unique_identifiers;

${finish}
`;

  return { sql, importId, summary };
}
