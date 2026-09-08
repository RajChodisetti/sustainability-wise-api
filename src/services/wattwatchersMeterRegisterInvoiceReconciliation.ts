import { z } from 'zod';

export type WattwatchersMeterRegisterInvoiceReconciliationMode = 'dry-run' | 'apply';

export const METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK = 'Master Register (1).xlsx';
export const METER_REGISTER_RECONCILIATION_MASTER_SHEET = 'Master Project Register';
export const METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256 =
  '4bb6e835928eb34bdee30d9e71f94c38d641b078a75c52a58c8450a60acd6c34';
export const METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK = 'SW Works Planning.xlsx';
export const METER_REGISTER_RECONCILIATION_WORKS_SHEET = 'Works Planning';
export const METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256 =
  '900856dfc259c178235b55cd3255773d1037e40562b083dae1095543747cea9b';
export const METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT = 92;
export const METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT = 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const invoiceNumberSchema = z.string()
  .regex(/^INV-[A-Z0-9][A-Z0-9./_-]*$/u)
  .max(300)
  .refine((value) => value === value.trim() && value === value.toUpperCase(), {
    message: 'invoice number must be trimmed uppercase text',
  });
const isoDateSchema = z.string().date();

const candidateSchema = z.object({
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u),
  masterSourceRow: z.number().int().min(4),
  masterSourceRowSha256: sha256Schema,
  currentDeviceIdentifier: z.string().regex(/^[A-Z0-9]{13}$/u)
    .refine((value) => value === value.trim() && value === value.toUpperCase(), {
      message: 'current device identifier must be trimmed uppercase text',
    }),
  expectedRevision: z.number().int().positive(),
  worksPlanningSourceRow: z.number().int().min(2),
  worksPlanningSourceRowSha256: sha256Schema,
  matchKind: z.literal('current_device'),
  worksPlanningInvoiceEventCount: z.literal(1),
  reviewDecision: z.literal('safe'),
  masterInvoiceNumber: z.null(),
  masterInvoiceIssuedDateBlank: z.boolean(),
  hasInvoiceConflict: z.literal(false),
  invoiceNumber: invoiceNumberSchema,
  invoiceNumberSourceColumn: z.enum(['XERO Inv #', 'XERO Date']),
  invoiceIssuedDate: isoDateSchema.nullable(),
  invoiceDateSourceColumn: z.literal('XERO Date').nullable(),
}).strict().superRefine((candidate, context) => {
  if (candidate.invoiceIssuedDate === null && candidate.invoiceDateSourceColumn !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceDateSourceColumn'],
      message: 'invoice date source column must be null when no date is supplied',
    });
  }
  if (candidate.invoiceIssuedDate !== null && candidate.invoiceDateSourceColumn !== 'XERO Date') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceDateSourceColumn'],
      message: 'invoice date must come from XERO Date',
    });
  }
  if (candidate.invoiceIssuedDate !== null && !candidate.masterInvoiceIssuedDateBlank) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['masterInvoiceIssuedDateBlank'],
      message: 'an invoice date cannot replace a populated Master Register date',
    });
  }
  if (candidate.invoiceNumberSourceColumn === 'XERO Date'
    && candidate.invoiceIssuedDate !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceIssuedDate'],
      message: 'one XERO Date cell cannot be both an invoice number and a date',
    });
  }
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.object({
    masterRegister: z.object({
      workbook: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK),
      workbookSha256: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256),
      sheet: z.literal(METER_REGISTER_RECONCILIATION_MASTER_SHEET),
    }).strict(),
    worksPlanning: z.object({
      workbook: z.literal(METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK),
      workbookSha256: z.literal(METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256),
      sheet: z.literal(METER_REGISTER_RECONCILIATION_WORKS_SHEET),
    }).strict(),
  }).strict(),
  expected: z.object({
    matchedCount: z.number().int().nonnegative(),
    invoiceNumberUpdateCount: z.number().int().nonnegative(),
    invoiceDateUpdateCount: z.number().int().nonnegative(),
  }).strict(),
  candidates: z.array(candidateSchema),
}).strict();

export type WattwatchersMeterRegisterInvoiceReconciliationCandidate = z.infer<
  typeof candidateSchema
>;
export type WattwatchersMeterRegisterInvoiceReconciliationManifest = z.infer<
  typeof manifestSchema
>;

export type BuiltWattwatchersMeterRegisterInvoiceReconciliationSql = {
  sql: string;
  matchedCount: number;
  invoiceNumberUpdateCount: number;
  invoiceDateUpdateCount: number;
};

/**
 * The immutable Meter Register row hash is checked against DB evidence. Works
 * Planning has no corresponding evidence table, so its row hashes are bound by
 * two independently reviewed artifacts instead: the approved whole-workbook
 * digest and the required digest of the private manifest containing those row
 * hashes. The CLI verifies both before this builder can be reached.
 */

function normalizeSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 digest`);
  }
  return normalized;
}

export function assertWattwatchersMeterRegisterInvoiceReconciliationDigests(input: {
  masterWorkbookSha256: string;
  worksWorkbookSha256: string;
  manifestSha256: string;
  expectedManifestSha256: string;
}): void {
  if (normalizeSha256(input.masterWorkbookSha256, 'Master Register workbook digest')
    !== METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256) {
    throw new Error('Master Register workbook bytes do not match the approved source');
  }
  if (normalizeSha256(input.worksWorkbookSha256, 'Works Planning workbook digest')
    !== METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256) {
    throw new Error('Works Planning workbook bytes do not match the approved source');
  }
  if (normalizeSha256(input.manifestSha256, 'manifest digest')
    !== normalizeSha256(input.expectedManifestSha256, 'expected manifest digest')) {
    throw new Error('Invoice reconciliation manifest bytes do not match the approved digest');
  }
}

export function parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
  input: unknown,
): WattwatchersMeterRegisterInvoiceReconciliationManifest {
  const manifest = manifestSchema.parse(input);
  const entryIds = new Set<string>();
  const masterRows = new Set<number>();
  const deviceIdentifiers = new Set<string>();
  for (const candidate of manifest.candidates) {
    if (entryIds.has(candidate.entryId)) {
      throw new Error(`Duplicate reconciliation entryId: ${candidate.entryId}`);
    }
    if (masterRows.has(candidate.masterSourceRow)) {
      throw new Error(`Duplicate Master Register source row: ${candidate.masterSourceRow}`);
    }
    if (deviceIdentifiers.has(candidate.currentDeviceIdentifier)) {
      throw new Error('Reconciliation candidates must have unique current device identifiers');
    }
    entryIds.add(candidate.entryId);
    masterRows.add(candidate.masterSourceRow);
    deviceIdentifiers.add(candidate.currentDeviceIdentifier);
  }

  const actualDateCount = manifest.candidates.filter(
    (candidate) => candidate.invoiceIssuedDate !== null,
  ).length;
  if (manifest.expected.matchedCount !== manifest.candidates.length
    || manifest.expected.invoiceNumberUpdateCount !== manifest.candidates.length
    || manifest.expected.invoiceDateUpdateCount !== actualDateCount) {
    throw new Error('Invoice reconciliation manifest counts do not match its candidates');
  }
  return manifest;
}

export function assertApprovedWattwatchersMeterRegisterInvoiceReconciliationManifest(
  manifest: WattwatchersMeterRegisterInvoiceReconciliationManifest,
): void {
  if (manifest.expected.matchedCount
      !== METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT
    || manifest.expected.invoiceNumberUpdateCount
      !== METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT
    || manifest.expected.invoiceDateUpdateCount
      !== METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT) {
    throw new Error(
      'Approved invoice reconciliation must contain exactly 92 invoice numbers and one date',
    );
  }
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function stageRowSql(
  candidate: WattwatchersMeterRegisterInvoiceReconciliationCandidate,
  ordinal: number,
): string {
  return `(${[
    ordinal,
    sqlText(candidate.entryId),
    candidate.masterSourceRow,
    sqlText(candidate.masterSourceRowSha256),
    sqlText(candidate.currentDeviceIdentifier),
    candidate.expectedRevision,
    candidate.worksPlanningSourceRow,
    sqlText(candidate.worksPlanningSourceRowSha256),
    sqlText(candidate.invoiceNumber),
    sqlText(candidate.invoiceNumberSourceColumn),
    candidate.invoiceIssuedDate === null ? 'NULL' : `${sqlText(candidate.invoiceIssuedDate)}::date`,
  ].join(', ')})`;
}

export function buildWattwatchersMeterRegisterInvoiceReconciliationSql(input: {
  manifest: WattwatchersMeterRegisterInvoiceReconciliationManifest;
  mode: WattwatchersMeterRegisterInvoiceReconciliationMode;
}): BuiltWattwatchersMeterRegisterInvoiceReconciliationSql {
  if (input.mode !== 'dry-run' && input.mode !== 'apply') {
    throw new Error('Invoice reconciliation mode must be dry-run or apply');
  }
  const { manifest } = input;
  const expectedCount = manifest.expected.matchedCount;
  const expectedDateCount = manifest.expected.invoiceDateUpdateCount;
  const values = manifest.candidates.map((candidate, index) => (
    stageRowSql(candidate, index + 1)
  )).join(',\n');
  const finish = input.mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';

  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
SELECT pg_advisory_xact_lock(hashtext('wattwatchers-meter-register-invoice-reconcile-v1'));

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_stage (
  ordinal integer PRIMARY KEY,
  entry_id text NOT NULL UNIQUE,
  master_source_row integer NOT NULL UNIQUE,
  master_source_row_sha256 text NOT NULL,
  current_device_identifier text NOT NULL UNIQUE,
  expected_revision integer NOT NULL,
  works_source_row integer NOT NULL,
  works_source_row_sha256 text NOT NULL,
  invoice_number text NOT NULL,
  invoice_number_source_column text NOT NULL,
  invoice_issued_date date
) ON COMMIT DROP;

INSERT INTO ww_meter_register_invoice_reconcile_stage VALUES
${values};

DO $$
DECLARE
  matched_count integer;
BEGIN
  IF (SELECT count(*) FROM ww_meter_register_invoice_reconcile_stage) <> ${expectedCount} THEN
    RAISE EXCEPTION 'Invoice reconciliation staged count changed';
  END IF;
  IF (SELECT count(*) FROM ww_meter_register_invoice_reconcile_stage
      WHERE invoice_issued_date IS NOT NULL) <> ${expectedDateCount} THEN
    RAISE EXCEPTION 'Invoice reconciliation staged date count changed';
  END IF;

  SELECT count(*) INTO matched_count
  FROM ww_meter_register_invoice_reconcile_stage stage
  JOIN ww_meter_register_entries entry ON entry.id = stage.entry_id
  JOIN ww_meter_register_imports imported ON imported.id = entry.import_id
  JOIN ww_meter_register_records record ON record.entry_id = entry.id
  WHERE imported.source_workbook = ${sqlText(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK)}
    AND imported.source_sheet = ${sqlText(METER_REGISTER_RECONCILIATION_MASTER_SHEET)}
    AND imported.workbook_sha256 = ${sqlText(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256)}
    AND entry.source_row = stage.master_source_row
    AND entry.source_row_sha256 = stage.master_source_row_sha256
    AND entry.current_device_identifier = stage.current_device_identifier
    AND NULLIF(btrim(entry.xero_invoice_number_snapshot), '') IS NULL
    AND NULLIF(btrim(entry.source_payload ->> 'Xero Invoice #'), '') IS NULL
    AND (
      stage.invoice_issued_date IS NULL
      OR (
        entry.invoice_issued_date IS NULL
        AND NULLIF(btrim(entry.source_payload ->> 'Inv issued date'), '') IS NULL
      )
    )
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND jsonb_typeof(record.details) = 'object';

  IF matched_count <> ${expectedCount} THEN
    RAISE EXCEPTION
      'Invoice reconciliation identity/provenance/manual guard matched %, expected ${expectedCount}',
      matched_count;
  END IF;
END $$;

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_state ON COMMIT DROP AS
SELECT
  stage.*,
  record.revision AS actual_revision,
  CASE
    WHEN record.revision = stage.expected_revision
      AND NULLIF(btrim(record.details ->> 'xeroInvoiceNumber'), '') IS NULL
      AND (
        stage.invoice_issued_date IS NULL
        OR NULLIF(btrim(record.details ->> 'invoiceIssuedDate'), '') IS NULL
      )
      THEN 'pending'
    WHEN record.revision = stage.expected_revision + 1
      AND record.details ->> 'xeroInvoiceNumber' = stage.invoice_number
      AND (
        stage.invoice_issued_date IS NULL
        OR record.details ->> 'invoiceIssuedDate' = stage.invoice_issued_date::text
      )
      THEN 'applied'
    ELSE 'invalid'
  END AS reconciliation_state
FROM ww_meter_register_invoice_reconcile_stage stage
JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id;

DO $$
DECLARE
  pending_count integer;
  applied_count integer;
  invalid_count integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE reconciliation_state = 'pending'),
    count(*) FILTER (WHERE reconciliation_state = 'applied'),
    count(*) FILTER (WHERE reconciliation_state = 'invalid')
  INTO pending_count, applied_count, invalid_count
  FROM ww_meter_register_invoice_reconcile_state;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'Invoice reconciliation found % conflicting or stale records', invalid_count;
  END IF;
  IF NOT (
    (pending_count = ${expectedCount} AND applied_count = 0)
    OR (pending_count = 0 AND applied_count = ${expectedCount})
  ) THEN
    RAISE EXCEPTION
      'Invoice reconciliation is partially applied: pending %, applied %, expected ${expectedCount}',
      pending_count, applied_count;
  END IF;
END $$;

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_updated ON COMMIT DROP AS
WITH updated AS (
  UPDATE ww_meter_register_records record
  SET
    details = record.details || CASE
      WHEN state.invoice_issued_date IS NULL THEN
        jsonb_build_object('xeroInvoiceNumber', state.invoice_number)
      ELSE
        jsonb_build_object(
          'xeroInvoiceNumber', state.invoice_number,
          'invoiceIssuedDate', state.invoice_issued_date::text
        )
    END,
    revision = record.revision + 1,
    updated_at = clock_timestamp()
  FROM ww_meter_register_invoice_reconcile_state state
  WHERE record.entry_id = state.entry_id
    AND state.reconciliation_state = 'pending'
    AND record.revision = state.expected_revision
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND NULLIF(btrim(record.details ->> 'xeroInvoiceNumber'), '') IS NULL
    AND (
      state.invoice_issued_date IS NULL
      OR NULLIF(btrim(record.details ->> 'invoiceIssuedDate'), '') IS NULL
    )
  RETURNING record.entry_id
)
SELECT entry_id FROM updated;

DO $$
DECLARE
  pending_count integer;
  updated_count integer;
  verified_count integer;
BEGIN
  SELECT count(*) INTO pending_count
  FROM ww_meter_register_invoice_reconcile_state
  WHERE reconciliation_state = 'pending';
  SELECT count(*) INTO updated_count
  FROM ww_meter_register_invoice_reconcile_updated;

  IF updated_count <> pending_count THEN
    RAISE EXCEPTION
      'Invoice reconciliation updated %, expected pending %', updated_count, pending_count;
  END IF;

  SELECT count(*) INTO verified_count
  FROM ww_meter_register_invoice_reconcile_stage stage
  JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
  WHERE record.revision = stage.expected_revision + 1
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND record.details ->> 'xeroInvoiceNumber' = stage.invoice_number
    AND (
      stage.invoice_issued_date IS NULL
      OR record.details ->> 'invoiceIssuedDate' = stage.invoice_issued_date::text
    );
  IF verified_count <> ${expectedCount} THEN
    RAISE EXCEPTION
      'Invoice reconciliation post-update verification matched %, expected ${expectedCount}',
      verified_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM ww_meter_register_invoice_reconcile_state) AS matched_count,
  (
    SELECT count(*) FROM ww_meter_register_invoice_reconcile_state
    WHERE reconciliation_state = 'pending'
  ) AS initially_pending_count,
  (
    SELECT count(*) FROM ww_meter_register_invoice_reconcile_state
    WHERE reconciliation_state = 'applied'
  ) AS initially_applied_count,
  (SELECT count(*) FROM ww_meter_register_invoice_reconcile_updated) AS updated_count,
  (
    SELECT count(*)
    FROM ww_meter_register_invoice_reconcile_updated updated
    JOIN ww_meter_register_invoice_reconcile_stage stage
      ON stage.entry_id = updated.entry_id
    WHERE stage.invoice_issued_date IS NOT NULL
  ) AS invoice_date_updated_count,
  ${expectedDateCount}::integer AS expected_invoice_date_count,
  (
    SELECT count(*)
    FROM ww_meter_register_invoice_reconcile_stage stage
    JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
    WHERE record.revision = stage.expected_revision + 1
      AND record.manually_corrected_at IS NULL
      AND record.updated_by_user_id IS NULL
      AND record.details ->> 'xeroInvoiceNumber' = stage.invoice_number
      AND (
        stage.invoice_issued_date IS NULL
        OR record.details ->> 'invoiceIssuedDate' = stage.invoice_issued_date::text
      )
  ) AS verified_count,
  ${input.mode === 'apply' ? 'true' : 'false'}::boolean AS apply_mode;

${finish}
`;

  return {
    sql,
    matchedCount: expectedCount,
    invoiceNumberUpdateCount: manifest.expected.invoiceNumberUpdateCount,
    invoiceDateUpdateCount: expectedDateCount,
  };
}
