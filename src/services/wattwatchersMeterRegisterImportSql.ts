import { createHash } from 'node:crypto';
import {
  projectMeterRegisterOperationalRecord,
  summarizeWattwatchersMeterRegister,
  type MeterRegisterImportSummary,
  type NormalizedMeterRegisterRow,
} from './wattwatchersMeterRegisterImport.js';

export type WattwatchersMeterRegisterImportMode = 'dry-run' | 'apply';

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
  return `SELECT pg_advisory_xact_lock(hashtextextended(
  'sustainability-wise:meter-register-entry:' || entry_locks.entry_id,
  0
))
FROM (
  SELECT stage.entry_id
  FROM ww_meter_register_stage stage
  WHERE stage.current_device_identifier IS NOT NULL
  ORDER BY stage.entry_id
) entry_locks;

CREATE TEMP TABLE ww_meter_register_operational_stage ON COMMIT DROP AS
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
  sw_business_site_address_fingerprint(
    stage.operational_site_address,
    NULL,
    stage.operational_site_state,
    NULL,
    'AU'
  ) AS address_fingerprint,
  stage.operational_details AS details
FROM ww_meter_register_stage stage
WHERE stage.current_device_identifier IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ww_meter_register_records existing
    WHERE existing.entry_id = stage.entry_id
  );

ALTER TABLE ww_meter_register_operational_stage ADD PRIMARY KEY (entry_id);

SELECT pg_advisory_xact_lock(hashtextextended(
  'sustainability-wise:client:' || client_locks.business_client_normalized_key,
  0
))
FROM (
  SELECT DISTINCT stage.business_client_normalized_key
  FROM ww_meter_register_operational_stage stage
  ORDER BY stage.business_client_normalized_key
) client_locks;

INSERT INTO business_clients (
  id, company_key, name, normalized_key, created_at, updated_at
)
SELECT DISTINCT ON (stage.business_client_normalized_key)
  'bc_wwmr_' || md5(stage.business_client_normalized_key),
  'sustainability-wise',
  stage.business_client_name,
  stage.business_client_normalized_key,
  now(),
  now()
FROM ww_meter_register_operational_stage stage
WHERE NOT EXISTS (
  SELECT 1
  FROM business_clients existing
  WHERE existing.company_key = 'sustainability-wise'
    AND existing.normalized_key = stage.business_client_normalized_key
)
ORDER BY stage.business_client_normalized_key, stage.entry_id
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE ww_meter_register_operational_client_map ON COMMIT DROP AS
WITH RECURSIVE client_roots AS (
  SELECT
    keys.business_client_normalized_key,
    candidate.id AS business_client_id,
    candidate.merged_into_client_id,
    ARRAY[candidate.id]::text[] AS visited_ids,
    0 AS depth
  FROM (
    SELECT DISTINCT stage.business_client_normalized_key
    FROM ww_meter_register_operational_stage stage
  ) keys
  JOIN LATERAL (
    SELECT client.id, client.merged_into_client_id
    FROM business_clients client
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
  JOIN business_clients next_client
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

ALTER TABLE ww_meter_register_operational_client_map
  ADD PRIMARY KEY (business_client_normalized_key);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ww_meter_register_operational_stage stage
    LEFT JOIN ww_meter_register_operational_client_map client_map
      ON client_map.business_client_normalized_key = stage.business_client_normalized_key
    WHERE client_map.business_client_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Meter Register client alias has an invalid merge target, cycle, or excessive depth';
  END IF;
END $$;

SELECT pg_advisory_xact_lock(hashtextextended(site_locks.lock_key, 0))
FROM (
  SELECT DISTINCT
    'sustainability-wise:site:' || client_map.business_client_id
      || ':' || stage.address_fingerprint AS lock_key
  FROM ww_meter_register_operational_stage stage
  JOIN ww_meter_register_operational_client_map client_map
    ON client_map.business_client_normalized_key = stage.business_client_normalized_key
  ORDER BY lock_key
) site_locks;

WITH resolved AS (
  SELECT stage.*, client_map.business_client_id
  FROM ww_meter_register_operational_stage stage
  JOIN ww_meter_register_operational_client_map client_map
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
INSERT INTO business_sites (
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
  FROM business_sites existing
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
  FROM ww_meter_register_operational_stage stage
  JOIN ww_meter_register_operational_client_map client_map
    ON client_map.business_client_normalized_key = stage.business_client_normalized_key
), linked AS (
  SELECT resolved.*, site.id AS resolved_business_site_id
  FROM resolved
  JOIN LATERAL (
    SELECT candidate.id
    FROM business_sites candidate
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
INSERT INTO ww_meter_register_records (
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
    FROM ww_meter_register_stage stage
    LEFT JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
    WHERE stage.current_device_identifier IS NOT NULL
      AND record.entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every imported Meter Register current identifier must have an operational record';
  END IF;
END $$;`;
}

export type BuildWattwatchersMeterRegisterImportSqlInput = {
  rows: NormalizedMeterRegisterRow[];
  mode: WattwatchersMeterRegisterImportMode;
  expected?: WattwatchersMeterRegisterExpectedSummary;
};

export type BuiltWattwatchersMeterRegisterImportSql = {
  sql: string;
  importId: string;
  summary: MeterRegisterImportSummary;
};

/**
 * Build an append-only, transaction-protected import. The SQL links only IDs
 * confirmed by the workbook's authoritative WW inventory to existing Fleet
 * devices; it never creates or updates Fleet, Field, Scheduler, or finance
 * records.
 */
export function buildWattwatchersMeterRegisterImportSql(
  input: BuildWattwatchersMeterRegisterImportSqlInput,
): BuiltWattwatchersMeterRegisterImportSql {
  if (input.mode !== 'dry-run' && input.mode !== 'apply') {
    throw new Error('Meter Register import mode must be dry-run or apply');
  }
  const source = assertSingleSource(input.rows);
  const summary = summarizeWattwatchersMeterRegister(input.rows);
  const expected = input.expected ?? MASTER_REGISTER_EXPECTED_SUMMARY;
  assertExpectedSummary(summary, expected);
  const importId = stableId('wwmri_', source.sourceNamespace);
  const values = input.rows.map((row) => stageRowSql(row, importId)).join(',\n');
  const finish = input.mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';

  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('wattwatchers-meter-register-import'));

CREATE TEMP TABLE ww_meter_register_stage (
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

INSERT INTO ww_meter_register_stage VALUES
${values};

DO $$
BEGIN
  IF (SELECT count(*) FROM ww_meter_register_stage) <> ${expected.sourceRowCount} THEN
    RAISE EXCEPTION 'Meter Register source row count changed';
  END IF;
  IF (SELECT count(*) FROM (
    SELECT existing_device_identifier AS identifier FROM ww_meter_register_stage
    UNION ALL
    SELECT new_device_identifier FROM ww_meter_register_stage
  ) identifiers WHERE identifier IS NOT NULL) <> ${expected.deviceValueCount} THEN
    RAISE EXCEPTION 'Meter Register device value count changed';
  END IF;
  IF (SELECT count(DISTINCT identifier) FROM (
    SELECT existing_device_identifier AS identifier FROM ww_meter_register_stage
    UNION ALL
    SELECT new_device_identifier FROM ww_meter_register_stage
  ) identifiers WHERE identifier IS NOT NULL) <> ${expected.uniqueIdentifierCount} THEN
    RAISE EXCEPTION 'Meter Register unique identifier count changed';
  END IF;
  IF EXISTS (
    SELECT identifier
    FROM (
      SELECT existing_device_identifier AS identifier,
             existing_device_classification AS classification
      FROM ww_meter_register_stage
      WHERE existing_device_identifier IS NOT NULL
      UNION ALL
      SELECT new_device_identifier, new_device_classification
      FROM ww_meter_register_stage
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
      FROM ww_meter_register_stage
      WHERE existing_device_classification = 'confirmed_wattwatchers'
      UNION
      SELECT new_device_identifier
      FROM ww_meter_register_stage
      WHERE new_device_classification = 'confirmed_wattwatchers'
    ) confirmed
    LEFT JOIN ww_devices device ON device.device_id = confirmed.identifier
    WHERE device.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A source-confirmed Wattwatchers identifier is missing from Fleet';
  END IF;
END $$;

INSERT INTO ww_meter_register_imports (
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
    FROM ww_meter_register_imports imported
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

INSERT INTO ww_meter_register_entries (
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
FROM ww_meter_register_stage stage
LEFT JOIN ww_devices existing_device
  ON stage.existing_device_classification = 'confirmed_wattwatchers'
 AND existing_device.device_id = stage.existing_device_identifier
LEFT JOIN ww_devices new_device
  ON stage.new_device_classification = 'confirmed_wattwatchers'
 AND new_device.device_id = stage.new_device_identifier
LEFT JOIN ww_devices current_device
  ON stage.current_device_classification = 'confirmed_wattwatchers'
 AND current_device.device_id = stage.current_device_identifier
ON CONFLICT (source_key) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM ww_meter_register_entries WHERE import_id = ${sqlText(importId)}) <> ${summary.sourceRowCount} THEN
    RAISE EXCEPTION 'Imported Meter Register row count is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ww_meter_register_stage stage
    JOIN ww_meter_register_entries imported ON imported.source_key = stage.source_key
    LEFT JOIN ww_devices existing_device
      ON stage.existing_device_classification = 'confirmed_wattwatchers'
     AND existing_device.device_id = stage.existing_device_identifier
    LEFT JOIN ww_devices new_device
      ON stage.new_device_classification = 'confirmed_wattwatchers'
     AND new_device.device_id = stage.new_device_identifier
    LEFT JOIN ww_devices current_device
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
    FROM ww_meter_register_entries imported
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

${operationalProjectionSql()}

WITH identifiers AS (
  SELECT existing_device_identifier AS identifier,
         existing_device_classification AS classification
  FROM ww_meter_register_entries
  WHERE import_id = ${sqlText(importId)} AND existing_device_identifier IS NOT NULL
  UNION ALL
  SELECT new_device_identifier, new_device_classification
  FROM ww_meter_register_entries
  WHERE import_id = ${sqlText(importId)} AND new_device_identifier IS NOT NULL
), unique_identifiers AS (
  SELECT identifier, min(classification) AS classification
  FROM identifiers
  GROUP BY identifier
)
SELECT
  (SELECT count(*) FROM ww_meter_register_entries WHERE import_id = ${sqlText(importId)}) AS source_rows,
  (SELECT count(*) FROM identifiers) AS device_values,
  count(*) AS unique_identifiers,
  count(*) FILTER (WHERE classification = 'confirmed_wattwatchers') AS confirmed_wattwatchers,
  count(*) FILTER (WHERE classification = 'candidate_wattwatchers') AS candidate_wattwatchers,
  count(*) FILTER (WHERE classification = 'other_hardware') AS other_hardware,
  (SELECT count(*) FROM ww_meter_register_entries
    WHERE import_id = ${sqlText(importId)} AND current_device_identifier IS NULL) AS rows_without_identifier
FROM unique_identifiers;

${finish}
`;

  return { sql, importId, summary };
}
