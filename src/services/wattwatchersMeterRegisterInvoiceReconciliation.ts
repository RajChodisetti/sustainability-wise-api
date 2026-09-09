import { createHash } from 'node:crypto';
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
export const METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA =
  'wattwatchers-spreadsheet-reconciliation/v1';
export const METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256 =
  '02d97966529d1dbf9cfe285e7943d25ff3e6de00c1fd72b00ef5cb0aaffac4f5';
export const METER_REGISTER_RECONCILIATION_SOURCE_COMMIT =
  'd29dccfc308c58417331aab4a45a4ab90876b415';
export const METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA =
  'wattwatchers-meter-register-reconciliation-db-snapshot/v1';
export const METER_REGISTER_RECONCILIATION_QA_DATABASE = 'sw_ecoaudit_fixes';
export const METER_REGISTER_RECONCILIATION_INVOICE_EVIDENCE_COUNT = 95;
export const METER_REGISTER_RECONCILIATION_CURRENT_INVOICE_EVIDENCE_COUNT = 93;
export const METER_REGISTER_RECONCILIATION_XERO_DATE_INVOICE_EVIDENCE_COUNT = 6;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const invoiceNumberSchema = z.string()
  .regex(/^INV-[A-Z0-9][A-Z0-9./_-]*$/u)
  .max(300)
  .refine((value) => value === value.trim() && value === value.toUpperCase(), {
    message: 'invoice number must be trimmed uppercase text',
  });
const isoDateSchema = z.string().date();

const worksPlanningEvidenceSchema = z.object({
  sourceRow: z.number().int().min(2),
  worksRow: z.number().int().min(2),
  auditRowSha256: sha256Schema,
  cachedValuesSha256: sha256Schema,
  formulaValuesSha256: sha256Schema,
  sheet: z.literal(METER_REGISTER_RECONCILIATION_WORKS_SHEET),
  isCurrentForDevice: z.boolean(),
  sourceColumn: z.enum(['XERO Inv #', 'XERO Date']),
  value: invoiceNumberSchema,
}).strict().refine((evidence) => evidence.sourceRow === evidence.worksRow, {
  message: 'Works Planning source row and works row must agree',
});

const invoiceDateEvidenceSchema = z.object({
  sourceRow: z.number().int().min(2),
  auditRowSha256: sha256Schema,
  cachedValuesSha256: sha256Schema,
  formulaValuesSha256: sha256Schema,
  sheet: z.literal(METER_REGISTER_RECONCILIATION_WORKS_SHEET),
  sourceColumn: z.literal('XERO Date'),
}).strict();

const candidateSchema = z.object({
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u),
  masterSourceRow: z.number().int().min(4),
  masterSourceRowSha256: sha256Schema,
  currentDeviceIdentifier: z.string().regex(/^[A-Z0-9]{13}$/u)
    .refine((value) => value === value.trim() && value === value.toUpperCase(), {
      message: 'current device identifier must be trimmed uppercase text',
    }),
  expectedRevision: z.number().int().positive(),
  worksPlanningEvidence: z.array(worksPlanningEvidenceSchema).min(1),
  matchKind: z.literal('current_device'),
  worksPlanningInvoiceEventCount: z.literal(1),
  reviewDecision: z.literal('safe'),
  masterInvoiceNumber: z.null(),
  masterInvoiceIssuedDateBlank: z.boolean(),
  hasInvoiceConflict: z.literal(false),
  invoiceNumber: invoiceNumberSchema,
  invoiceIssuedDate: isoDateSchema.nullable(),
  invoiceDateSourceColumn: z.literal('XERO Date').nullable(),
  invoiceDateEvidence: invoiceDateEvidenceSchema.nullable(),
}).strict().superRefine((candidate, context) => {
  if (candidate.invoiceIssuedDate === null
    && (candidate.invoiceDateSourceColumn !== null || candidate.invoiceDateEvidence !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceDateEvidence'],
      message: 'invoice date provenance must be null when no date is supplied',
    });
  }
  if (candidate.invoiceIssuedDate !== null
    && (candidate.invoiceDateSourceColumn !== 'XERO Date'
      || candidate.invoiceDateEvidence === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceDateEvidence'],
      message: 'invoice date must retain its XERO Date row provenance',
    });
  }
  if (candidate.invoiceIssuedDate !== null && !candidate.masterInvoiceIssuedDateBlank) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['masterInvoiceIssuedDateBlank'],
      message: 'an invoice date cannot replace a populated Master Register date',
    });
  }
  const evidenceKeys = new Set<string>();
  for (const evidence of candidate.worksPlanningEvidence) {
    const evidenceKey = [
      evidence.sourceRow,
      evidence.sourceColumn,
      evidence.auditRowSha256,
      evidence.cachedValuesSha256,
      evidence.formulaValuesSha256,
      evidence.isCurrentForDevice,
    ].join('\u001f');
    if (evidenceKeys.has(evidenceKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['worksPlanningEvidence'],
        message: 'Works Planning invoice evidence rows must be unique',
      });
    }
    evidenceKeys.add(evidenceKey);
    if (evidence.value !== candidate.invoiceNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['worksPlanningEvidence'],
        message: 'Works Planning evidence must agree with the candidate invoice number',
      });
    }
  }
  if (!candidate.worksPlanningEvidence.some((evidence) => evidence.isCurrentForDevice)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['worksPlanningEvidence'],
      message: 'at least one Works Planning evidence row must match the current device',
    });
  }
  if (candidate.invoiceDateEvidence !== null
    && !candidate.worksPlanningEvidence.some((evidence) => (
      evidence.isCurrentForDevice
      && evidence.sourceRow === candidate.invoiceDateEvidence!.sourceRow
      && evidence.auditRowSha256 === candidate.invoiceDateEvidence!.auditRowSha256
      && evidence.cachedValuesSha256 === candidate.invoiceDateEvidence!.cachedValuesSha256
      && evidence.formulaValuesSha256 === candidate.invoiceDateEvidence!.formulaValuesSha256
    ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceDateEvidence'],
      message: 'invoice date must share a current invoice-evidence Works row',
    });
  }
  if (candidate.invoiceDateEvidence !== null
    && candidate.worksPlanningEvidence.some((evidence) => (
      evidence.sourceRow === candidate.invoiceDateEvidence!.sourceRow
      && evidence.sourceColumn === 'XERO Date'
    ))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceIssuedDate'],
      message: 'one XERO Date cell cannot be both an invoice number and a date',
    });
  }
});

const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  provenance: z.object({
    sourceAudit: z.object({
      schema: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA),
      sha256: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256),
      repositoryCommit: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_COMMIT),
    }).strict(),
    dbSnapshot: z.object({
      schema: z.literal(METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA),
      sha256: sha256Schema,
      database: z.literal(METER_REGISTER_RECONCILIATION_QA_DATABASE),
    }).strict(),
    invoiceEvidence: z.object({
      rowCount: z.number().int().nonnegative(),
      currentRowCount: z.number().int().nonnegative(),
      xeroDateValueRowCount: z.number().int().nonnegative(),
      sha256: sha256Schema,
    }).strict(),
  }).strict(),
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

export type WattwatchersMeterRegisterInvoiceEvidence = z.infer<
  typeof worksPlanningEvidenceSchema
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

function compareWorksPlanningEvidence(
  left: WattwatchersMeterRegisterInvoiceEvidence,
  right: WattwatchersMeterRegisterInvoiceEvidence,
): number {
  if (left.isCurrentForDevice !== right.isCurrentForDevice) {
    return left.isCurrentForDevice ? -1 : 1;
  }
  return left.sourceRow - right.sourceRow
    || left.sourceColumn.localeCompare(right.sourceColumn, 'en')
    || left.auditRowSha256.localeCompare(right.auditRowSha256, 'en');
}

export function computeWattwatchersMeterRegisterInvoiceEvidenceSha256(
  candidates: readonly WattwatchersMeterRegisterInvoiceReconciliationCandidate[],
): string {
  const evidence = [...candidates]
    .sort((left, right) => left.masterSourceRow - right.masterSourceRow
      || left.currentDeviceIdentifier.localeCompare(right.currentDeviceIdentifier, 'en'))
    .flatMap((candidate) => (
      [...candidate.worksPlanningEvidence]
        .sort(compareWorksPlanningEvidence)
        .map((row) => ({
          masterSourceRow: candidate.masterSourceRow,
          deviceIdentifier: candidate.currentDeviceIdentifier,
          evidence: [
            row.sheet,
            row.sourceRow,
            row.auditRowSha256,
            row.cachedValuesSha256,
            row.formulaValuesSha256,
            row.sourceColumn,
            row.value,
            row.isCurrentForDevice ? 'current' : 'non-current',
          ].join('\u001f'),
        }))
    ));
  return createHash('sha256')
    .update(Buffer.from(JSON.stringify(evidence), 'utf8'))
    .digest('hex');
}

export function parseWattwatchersMeterRegisterInvoiceReconciliationManifest(
  input: unknown,
): WattwatchersMeterRegisterInvoiceReconciliationManifest {
  const manifest = manifestSchema.parse(input);
  const entryIds = new Set<string>();
  const masterRows = new Set<number>();
  const deviceIdentifiers = new Set<string>();
  let invoiceEvidenceRowCount = 0;
  let currentInvoiceEvidenceRowCount = 0;
  let xeroDateInvoiceEvidenceRowCount = 0;
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
    invoiceEvidenceRowCount += candidate.worksPlanningEvidence.length;
    currentInvoiceEvidenceRowCount += candidate.worksPlanningEvidence.filter(
      (evidence) => evidence.isCurrentForDevice,
    ).length;
    xeroDateInvoiceEvidenceRowCount += candidate.worksPlanningEvidence.filter(
      (evidence) => evidence.sourceColumn === 'XERO Date',
    ).length;
  }

  const actualDateCount = manifest.candidates.filter(
    (candidate) => candidate.invoiceIssuedDate !== null,
  ).length;
  if (manifest.expected.matchedCount !== manifest.candidates.length
    || manifest.expected.invoiceNumberUpdateCount !== manifest.candidates.length
    || manifest.expected.invoiceDateUpdateCount !== actualDateCount) {
    throw new Error('Invoice reconciliation manifest counts do not match its candidates');
  }
  if (manifest.provenance.invoiceEvidence.rowCount !== invoiceEvidenceRowCount
    || manifest.provenance.invoiceEvidence.currentRowCount
      !== currentInvoiceEvidenceRowCount
    || manifest.provenance.invoiceEvidence.xeroDateValueRowCount
      !== xeroDateInvoiceEvidenceRowCount) {
    throw new Error('Invoice reconciliation evidence counts do not match its candidates');
  }
  if (manifest.provenance.invoiceEvidence.sha256
    !== computeWattwatchersMeterRegisterInvoiceEvidenceSha256(manifest.candidates)) {
    throw new Error('Invoice reconciliation evidence digest does not match its candidates');
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
      !== METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT
    || manifest.provenance.invoiceEvidence.rowCount
      !== METER_REGISTER_RECONCILIATION_INVOICE_EVIDENCE_COUNT
    || manifest.provenance.invoiceEvidence.currentRowCount
      !== METER_REGISTER_RECONCILIATION_CURRENT_INVOICE_EVIDENCE_COUNT
    || manifest.provenance.invoiceEvidence.xeroDateValueRowCount
      !== METER_REGISTER_RECONCILIATION_XERO_DATE_INVOICE_EVIDENCE_COUNT) {
    throw new Error(
      'Approved invoice reconciliation must contain exactly 92 invoice numbers, one date, '
        + 'and the complete 95-row evidence set',
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
  const dateEvidence = candidate.invoiceDateEvidence;
  return `(${[
    ordinal,
    sqlText(candidate.entryId),
    candidate.masterSourceRow,
    sqlText(candidate.masterSourceRowSha256),
    sqlText(candidate.currentDeviceIdentifier),
    candidate.expectedRevision,
    sqlText(candidate.invoiceNumber),
    candidate.invoiceIssuedDate === null ? 'NULL' : `${sqlText(candidate.invoiceIssuedDate)}::date`,
    dateEvidence === null ? 'NULL' : dateEvidence.sourceRow,
    dateEvidence === null ? 'NULL' : sqlText(dateEvidence.auditRowSha256),
    dateEvidence === null ? 'NULL' : sqlText(dateEvidence.cachedValuesSha256),
    dateEvidence === null ? 'NULL' : sqlText(dateEvidence.formulaValuesSha256),
  ].join(', ')})`;
}

function stageEvidenceRowSql(input: {
  candidate: WattwatchersMeterRegisterInvoiceReconciliationCandidate;
  evidence: WattwatchersMeterRegisterInvoiceEvidence;
  ordinal: number;
}): string {
  return `(${[
    input.ordinal,
    sqlText(input.candidate.entryId),
    input.evidence.sourceRow,
    input.evidence.worksRow,
    sqlText(input.evidence.auditRowSha256),
    sqlText(input.evidence.cachedValuesSha256),
    sqlText(input.evidence.formulaValuesSha256),
    input.evidence.isCurrentForDevice ? 'true' : 'false',
    sqlText(input.evidence.sourceColumn),
    sqlText(input.evidence.value),
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
  const expectedEvidenceCount = manifest.provenance.invoiceEvidence.rowCount;
  const expectedCurrentEvidenceCount = manifest.provenance.invoiceEvidence.currentRowCount;
  const expectedXeroDateEvidenceCount =
    manifest.provenance.invoiceEvidence.xeroDateValueRowCount;
  const values = manifest.candidates.map((candidate, index) => (
    stageRowSql(candidate, index + 1)
  )).join(',\n');
  let evidenceOrdinal = 0;
  const evidenceValues = manifest.candidates.flatMap((candidate) => (
    candidate.worksPlanningEvidence.map((evidence) => stageEvidenceRowSql({
      candidate,
      evidence,
      ordinal: evidenceOrdinal += 1,
    }))
  )).join(',\n');
  const finish = input.mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';

  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
  IF current_database() <> ${sqlText(METER_REGISTER_RECONCILIATION_QA_DATABASE)} THEN
    RAISE EXCEPTION 'Invoice reconciliation may run only against the approved QA database';
  END IF;
END $$;

SELECT pg_advisory_xact_lock(hashtext('wattwatchers-meter-register-invoice-reconcile-v1'));

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_provenance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  source_audit_schema text NOT NULL,
  source_audit_sha256 text NOT NULL,
  source_commit text NOT NULL,
  db_snapshot_schema text NOT NULL,
  db_snapshot_sha256 text NOT NULL,
  database_name text NOT NULL,
  invoice_evidence_sha256 text NOT NULL
) ON COMMIT DROP;

INSERT INTO ww_meter_register_invoice_reconcile_provenance (
  source_audit_schema,
  source_audit_sha256,
  source_commit,
  db_snapshot_schema,
  db_snapshot_sha256,
  database_name,
  invoice_evidence_sha256
) VALUES (
  ${sqlText(manifest.provenance.sourceAudit.schema)},
  ${sqlText(manifest.provenance.sourceAudit.sha256)},
  ${sqlText(manifest.provenance.sourceAudit.repositoryCommit)},
  ${sqlText(manifest.provenance.dbSnapshot.schema)},
  ${sqlText(manifest.provenance.dbSnapshot.sha256)},
  ${sqlText(manifest.provenance.dbSnapshot.database)},
  ${sqlText(manifest.provenance.invoiceEvidence.sha256)}
);

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_stage (
  ordinal integer PRIMARY KEY,
  entry_id text NOT NULL UNIQUE,
  master_source_row integer NOT NULL UNIQUE,
  master_source_row_sha256 text NOT NULL,
  current_device_identifier text NOT NULL UNIQUE,
  expected_revision integer NOT NULL,
  invoice_number text NOT NULL,
  invoice_issued_date date,
  invoice_date_works_source_row integer,
  invoice_date_works_audit_row_sha256 text,
  invoice_date_works_cached_values_sha256 text,
  invoice_date_works_formula_values_sha256 text,
  CHECK (
    (invoice_issued_date IS NULL
      AND invoice_date_works_source_row IS NULL
      AND invoice_date_works_audit_row_sha256 IS NULL
      AND invoice_date_works_cached_values_sha256 IS NULL
      AND invoice_date_works_formula_values_sha256 IS NULL)
    OR
    (invoice_issued_date IS NOT NULL
      AND invoice_date_works_source_row IS NOT NULL
      AND invoice_date_works_audit_row_sha256 IS NOT NULL
      AND invoice_date_works_cached_values_sha256 IS NOT NULL
      AND invoice_date_works_formula_values_sha256 IS NOT NULL)
  )
) ON COMMIT DROP;

INSERT INTO ww_meter_register_invoice_reconcile_stage VALUES
${values};

CREATE TEMP TABLE ww_meter_register_invoice_reconcile_works_evidence_stage (
  ordinal integer PRIMARY KEY,
  entry_id text NOT NULL REFERENCES ww_meter_register_invoice_reconcile_stage(entry_id),
  works_source_row integer NOT NULL,
  works_row integer NOT NULL,
  works_audit_row_sha256 text NOT NULL,
  works_cached_values_sha256 text NOT NULL,
  works_formula_values_sha256 text NOT NULL,
  is_current_for_device boolean NOT NULL,
  source_column text NOT NULL CHECK (source_column IN ('XERO Inv #', 'XERO Date')),
  invoice_number text NOT NULL,
  UNIQUE (
    entry_id,
    works_source_row,
    source_column,
    works_audit_row_sha256,
    works_cached_values_sha256,
    works_formula_values_sha256,
    is_current_for_device
  ),
  CHECK (works_source_row = works_row)
) ON COMMIT DROP;

INSERT INTO ww_meter_register_invoice_reconcile_works_evidence_stage VALUES
${evidenceValues};

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
  IF (SELECT count(*) FROM ww_meter_register_invoice_reconcile_works_evidence_stage)
      <> ${expectedEvidenceCount} THEN
    RAISE EXCEPTION 'Invoice reconciliation staged Works evidence count changed';
  END IF;
  IF (SELECT count(*) FROM ww_meter_register_invoice_reconcile_works_evidence_stage
      WHERE is_current_for_device) <> ${expectedCurrentEvidenceCount} THEN
    RAISE EXCEPTION 'Invoice reconciliation staged current Works evidence count changed';
  END IF;
  IF (SELECT count(*) FROM ww_meter_register_invoice_reconcile_works_evidence_stage
      WHERE source_column = 'XERO Date') <> ${expectedXeroDateEvidenceCount} THEN
    RAISE EXCEPTION 'Invoice reconciliation staged XERO Date evidence count changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ww_meter_register_invoice_reconcile_stage stage
    LEFT JOIN ww_meter_register_invoice_reconcile_works_evidence_stage evidence
      ON evidence.entry_id = stage.entry_id
    GROUP BY stage.entry_id, stage.invoice_number
    HAVING count(evidence.ordinal) = 0
      OR count(*) FILTER (WHERE evidence.is_current_for_device) = 0
      OR bool_or(evidence.invoice_number <> stage.invoice_number)
  ) THEN
    RAISE EXCEPTION 'Invoice reconciliation staged Works evidence no longer supports candidates';
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
