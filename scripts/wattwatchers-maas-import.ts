import { readFile, writeFile } from 'node:fs/promises';
import {
  normalizeMaasWorkbook,
  type MaasWorkbookRow,
  type NormalizedMaasImportRow,
} from '../src/services/wattwatchersMaasImport.js';

type Mode = 'dry-run' | 'apply';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sqlText(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

function sqlDate(value: string | null): string {
  return value === null ? 'NULL' : `${sqlText(value)}::date`;
}

function rowSql(row: NormalizedMaasImportRow): string {
  return `(${[
    sqlText(row.assignmentId),
    sqlText(row.sourceKey),
    row.sourceRow,
    sqlText(row.fleetAccountCode),
    sqlText(row.customerName),
    sqlText(row.customerNormalizedKey),
    sqlText(row.fallbackBusinessClientId),
    sqlText(row.siteName),
    sqlText(row.siteAddress),
    sqlText(row.siteLocality),
    sqlText(row.siteState),
    sqlText(row.sitePostcode),
    sqlText(row.siteAddressFingerprint),
    sqlText(row.fallbackBusinessSiteId),
    sqlText(row.deviceLabel),
    sqlDate(row.jobCompletionDate),
    sqlDate(row.maasStartDate),
    sqlDate(row.effectiveDate),
    sqlText(row.existingDeviceId),
    sqlText(row.newDeviceId),
    sqlText(row.currentExternalDeviceId),
    sqlText(row.fallbackExistingDeviceInternalId),
    sqlText(row.fallbackNewDeviceInternalId),
    sqlText(row.fallbackCurrentDeviceInternalId),
    sqlText(row.notes),
  ].join(', ')})`;
}

function importSql(rows: NormalizedMaasImportRow[], mode: Mode): string {
  const values = rows.map(rowSql).join(',\n');
  const finish = mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';
  return `\\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('wattwatchers-maas-devices-import'));

CREATE TEMP TABLE ww_maas_import_stage (
  assignment_id text NOT NULL,
  source_key text NOT NULL,
  source_row integer NOT NULL,
  account_code text NOT NULL,
  customer_name text NOT NULL,
  customer_normalized_key text NOT NULL,
  fallback_business_client_id text NOT NULL,
  site_name text,
  site_address text,
  site_locality text,
  site_state text,
  site_postcode text,
  site_address_fingerprint text,
  fallback_business_site_id text,
  device_label text NOT NULL,
  job_completion_date date,
  maas_start_date date,
  effective_date date NOT NULL,
  existing_external_device_id text,
  new_external_device_id text,
  current_external_device_id text NOT NULL,
  fallback_existing_device_internal_id text,
  fallback_new_device_internal_id text,
  fallback_current_device_internal_id text NOT NULL,
  notes text
) ON COMMIT DROP;

INSERT INTO ww_maas_import_stage VALUES
${values};

DO $$
BEGIN
  IF (SELECT count(*) FROM ww_maas_import_stage) <> 146 THEN
    RAISE EXCEPTION 'Expected 146 source rows';
  END IF;
  IF (SELECT count(DISTINCT device_id) FROM (
    SELECT existing_external_device_id AS device_id FROM ww_maas_import_stage
    UNION ALL
    SELECT new_external_device_id FROM ww_maas_import_stage
  ) ids WHERE device_id IS NOT NULL) <> 168 THEN
    RAISE EXCEPTION 'Expected 168 unique physical device IDs';
  END IF;
  IF EXISTS (
    SELECT account_code FROM ww_maas_import_stage s
    LEFT JOIN ww_clients c ON c.code = s.account_code
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A required Fleet account client is missing';
  END IF;
END $$;

INSERT INTO business_clients (
  id, company_key, name, normalized_key, created_at, updated_at
)
SELECT DISTINCT ON (s.customer_normalized_key)
  s.fallback_business_client_id,
  'sustainability-wise',
  s.customer_name,
  s.customer_normalized_key,
  now(),
  now()
FROM ww_maas_import_stage s
WHERE NOT EXISTS (
  SELECT 1
  FROM business_clients existing
  WHERE existing.company_key = 'sustainability-wise'
    AND existing.normalized_key = s.customer_normalized_key
    AND existing.merged_into_client_id IS NULL
)
ORDER BY s.customer_normalized_key, s.source_row
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  normalized_key = excluded.normalized_key,
  updated_at = now();

WITH site_sources AS (
  SELECT DISTINCT ON (
    customer_normalized_key,
    fallback_business_site_id
  ) *
  FROM ww_maas_import_stage
  WHERE fallback_business_site_id IS NOT NULL
  ORDER BY customer_normalized_key, fallback_business_site_id, source_row
), resolved AS (
  SELECT
    s.*,
    (
      SELECT client.id
      FROM business_clients client
      WHERE client.company_key = 'sustainability-wise'
        AND client.normalized_key = s.customer_normalized_key
        AND client.merged_into_client_id IS NULL
      ORDER BY client.created_at, client.id
      LIMIT 1
    ) AS resolved_business_client_id
  FROM site_sources s
)
INSERT INTO business_sites (
  id, client_id, name, address, locality, state, postcode, country_code,
  address_source, geocode_status, address_fingerprint, timezone,
  created_at, updated_at
)
SELECT
  r.fallback_business_site_id,
  r.resolved_business_client_id,
  r.site_name,
  r.site_address,
  r.site_locality,
  r.site_state,
  r.site_postcode,
  'AU',
  'manual',
  'unresolved',
  r.site_address_fingerprint,
  CASE r.site_state
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
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1
  FROM business_sites existing
  WHERE existing.client_id = r.resolved_business_client_id
    AND existing.name = r.site_name
    AND existing.address_fingerprint = r.site_address_fingerprint
)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  address = excluded.address,
  locality = excluded.locality,
  state = excluded.state,
  postcode = excluded.postcode,
  timezone = excluded.timezone,
  updated_at = now();

WITH device_sources AS (
  SELECT
    s.source_row,
    s.account_code,
    s.device_label,
    s.existing_external_device_id AS external_device_id,
    s.fallback_existing_device_internal_id AS fallback_internal_id,
    CASE
      WHEN s.new_external_device_id IS NOT NULL THEN NULL
      WHEN s.job_completion_date IS NOT NULL THEN s.job_completion_date
      ELSE NULL
    END AS install_date
  FROM ww_maas_import_stage s
  WHERE s.existing_external_device_id IS NOT NULL
  UNION ALL
  SELECT
    s.source_row,
    s.account_code,
    s.device_label,
    s.new_external_device_id,
    s.fallback_new_device_internal_id,
    s.effective_date
  FROM ww_maas_import_stage s
  WHERE s.new_external_device_id IS NOT NULL
)
INSERT INTO ww_devices (
  id, device_id, label, install_date, primary_client_id,
  first_seen_at, last_discovered_at, created_at, updated_at
)
SELECT
  d.fallback_internal_id,
  d.external_device_id,
  d.device_label,
  d.install_date,
  account.id,
  now(),
  now(),
  now(),
  now()
FROM device_sources d
JOIN ww_clients account ON account.code = d.account_code
ON CONFLICT (device_id) DO UPDATE SET
  label = excluded.label,
  install_date = coalesce(excluded.install_date, ww_devices.install_date),
  primary_client_id = excluded.primary_client_id,
  updated_at = now();

INSERT INTO ww_device_clients (
  id, device_id, client_id, is_current, first_seen_at, last_seen_at
)
SELECT
  'wwdc_' || md5(device.id || ':' || account.id),
  device.id,
  account.id,
  false,
  now(),
  now()
FROM ww_maas_import_stage s
JOIN ww_devices device ON device.device_id = s.existing_external_device_id
JOIN ww_clients account ON account.code = s.account_code
WHERE s.new_external_device_id IS NOT NULL
ON CONFLICT (device_id, client_id) DO UPDATE SET
  is_current = false,
  last_seen_at = now();

INSERT INTO ww_device_clients (
  id, device_id, client_id, is_current, first_seen_at, last_seen_at
)
SELECT
  'wwdc_' || md5(device.id || ':' || account.id),
  device.id,
  account.id,
  true,
  now(),
  now()
FROM ww_maas_import_stage s
JOIN ww_devices device ON device.device_id = s.current_external_device_id
JOIN ww_clients account ON account.code = s.account_code
ON CONFLICT (device_id, client_id) DO UPDATE SET
  is_current = true,
  last_seen_at = now();

INSERT INTO ww_device_installation_assignments (
  id, source_key, source_workbook, source_sheet, source_row,
  fleet_account_client_id, business_client_id, business_site_id,
  customer_name_snapshot, site_name_snapshot, site_address_snapshot,
  device_label_snapshot, job_completion_date, maas_start_date, effective_date,
  existing_device_id, new_device_id, current_device_id, notes,
  created_at, updated_at
)
SELECT
  s.assignment_id,
  s.source_key,
  'SW Works Planning.xlsx',
  'MaaS Devices',
  s.source_row,
  account.id,
  business_client.id,
  business_site.id,
  s.customer_name,
  s.site_name,
  s.site_address,
  s.device_label,
  s.job_completion_date,
  s.maas_start_date,
  s.effective_date,
  existing_device.id,
  new_device.id,
  current_device.id,
  s.notes,
  now(),
  now()
FROM ww_maas_import_stage s
JOIN ww_clients account ON account.code = s.account_code
JOIN LATERAL (
  SELECT client.id
  FROM business_clients client
  WHERE client.company_key = 'sustainability-wise'
    AND client.normalized_key = s.customer_normalized_key
    AND client.merged_into_client_id IS NULL
  ORDER BY client.created_at, client.id
  LIMIT 1
) business_client ON true
LEFT JOIN LATERAL (
  SELECT site.id
  FROM business_sites site
  WHERE s.fallback_business_site_id IS NOT NULL
    AND site.client_id = business_client.id
    AND site.name = s.site_name
    AND site.address_fingerprint = s.site_address_fingerprint
  ORDER BY site.created_at, site.id
  LIMIT 1
) business_site ON true
LEFT JOIN ww_devices existing_device ON existing_device.device_id = s.existing_external_device_id
LEFT JOIN ww_devices new_device ON new_device.device_id = s.new_external_device_id
JOIN ww_devices current_device ON current_device.device_id = s.current_external_device_id
ON CONFLICT (source_key) DO UPDATE SET
  fleet_account_client_id = excluded.fleet_account_client_id,
  business_client_id = excluded.business_client_id,
  business_site_id = excluded.business_site_id,
  customer_name_snapshot = excluded.customer_name_snapshot,
  site_name_snapshot = excluded.site_name_snapshot,
  site_address_snapshot = excluded.site_address_snapshot,
  device_label_snapshot = excluded.device_label_snapshot,
  job_completion_date = excluded.job_completion_date,
  maas_start_date = excluded.maas_start_date,
  effective_date = excluded.effective_date,
  existing_device_id = excluded.existing_device_id,
  new_device_id = excluded.new_device_id,
  current_device_id = excluded.current_device_id,
  notes = excluded.notes,
  updated_at = now();

DO $$
BEGIN
  IF (SELECT count(*) FROM ww_device_installation_assignments WHERE source_workbook = 'SW Works Planning.xlsx' AND source_sheet = 'MaaS Devices') <> 146 THEN
    RAISE EXCEPTION 'Expected 146 imported assignments';
  END IF;
  IF (SELECT count(*) FROM ww_device_installation_assignments WHERE source_workbook = 'SW Works Planning.xlsx' AND new_device_id IS NOT NULL AND existing_device_id IS NOT NULL) <> 22 THEN
    RAISE EXCEPTION 'Expected 22 replacement assignments';
  END IF;
  IF (SELECT count(*) FROM ww_device_installation_assignments WHERE source_workbook = 'SW Works Planning.xlsx' AND business_site_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Expected two unknown-site assignments';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ww_device_installation_assignments assignment
    JOIN ww_device_clients membership
      ON membership.device_id = assignment.current_device_id
     AND membership.client_id = assignment.fleet_account_client_id
    WHERE assignment.source_workbook = 'SW Works Planning.xlsx'
      AND membership.is_current = false
  ) THEN
    RAISE EXCEPTION 'A current assignment has a non-current account membership';
  END IF;
END $$;

SELECT
  count(*) AS assignments,
  count(*) FILTER (WHERE existing_device_id IS NOT NULL AND new_device_id IS NOT NULL) AS replacements,
  count(*) FILTER (WHERE business_site_id IS NULL) AS unknown_sites,
  count(*) FILTER (WHERE job_completion_date IS NOT NULL) AS completed_jobs,
  count(*) FILTER (WHERE maas_start_date IS NOT NULL) AS maas_rollovers,
  count(DISTINCT business_client_id) AS business_clients,
  count(DISTINCT business_site_id) AS business_sites,
  count(DISTINCT current_device_id) AS current_devices
FROM ww_device_installation_assignments
WHERE source_workbook = 'SW Works Planning.xlsx'
  AND source_sheet = 'MaaS Devices';

${finish}
`;
}

const inputPath = option('--input');
const outputPath = option('--output');
const mode = (option('--mode') ?? 'dry-run') as Mode;
if (!inputPath || !outputPath) {
  throw new Error('Usage: --input <rows.json> --output <import.sql> [--mode dry-run|apply]');
}
if (mode !== 'dry-run' && mode !== 'apply') throw new Error('--mode must be dry-run or apply');

const parsed = JSON.parse(await readFile(inputPath, 'utf8')) as MaasWorkbookRow[];
const normalized = normalizeMaasWorkbook(parsed);
await writeFile(outputPath, importSql(normalized, mode), { encoding: 'utf8', mode: 0o600 });

const deviceIds = new Set(normalized.flatMap((row) => [row.existingDeviceId, row.newDeviceId]).filter(Boolean));
console.log(JSON.stringify({
  mode,
  sourceRows: normalized.length,
  physicalDeviceIds: deviceIds.size,
  replacements: normalized.filter((row) => row.existingDeviceId && row.newDeviceId).length,
  unknownSites: normalized.filter((row) => !row.siteAddress).length,
  outputPath,
}, null, 2));
