import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import {
  computeWattwatchersMeterRegisterInvoiceEvidenceSha256,
  METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT,
  METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT,
  METER_REGISTER_RECONCILIATION_CURRENT_INVOICE_EVIDENCE_COUNT,
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_RECONCILIATION_INVOICE_EVIDENCE_COUNT,
  METER_REGISTER_RECONCILIATION_MASTER_SHEET,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
  METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
  METER_REGISTER_RECONCILIATION_PRODUCTION_DATABASE,
  METER_REGISTER_RECONCILIATION_QA_DATABASE,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
  METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
  METER_REGISTER_RECONCILIATION_WORKS_SHEET,
  METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK,
  METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
  METER_REGISTER_RECONCILIATION_XERO_DATE_INVOICE_EVIDENCE_COUNT,
  parseWattwatchersMeterRegisterInvoiceReconciliationManifest,
  type WattwatchersMeterRegisterInvoiceEvidence,
  type WattwatchersMeterRegisterInvoiceReconciliationCandidate,
  type WattwatchersMeterRegisterInvoiceReconciliationManifest,
} from './wattwatchersMeterRegisterInvoiceReconciliation.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetBinding,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
  type WattwatchersMeterRegisterReconciliationTarget,
  type WattwatchersMeterRegisterReconciliationTargetBinding,
} from './wattwatchersMeterRegisterReconciliationTarget.js';

export {
  METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_RECONCILIATION_PRODUCTION_DATABASE,
  METER_REGISTER_RECONCILIATION_QA_DATABASE,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256,
  METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
} from './wattwatchersMeterRegisterInvoiceReconciliation.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const identityFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const tableOidSchema = z.string().regex(/^[1-9][0-9]*$/u);
const invoiceNumberSchema = z.string()
  .regex(/^INV-[A-Z0-9][A-Z0-9./_-]*$/u)
  .max(300)
  .refine((value) => value === value.trim() && value === value.toUpperCase());
const deviceIdentifierSchema = z.string().regex(/^[A-Z0-9]{13}$/u);
const snapshotDeviceIdentifierSchema = z.string();
const METER_REGISTER_RECONCILIATION_SOURCE_ROW_COUNT = 1_917;
const METER_REGISTER_RECONCILIATION_CURRENT_IDENTIFIER_COUNT = 1_857;

const sourceRowEvidenceSchema = z.object({
  audit_row_sha256: sha256Schema,
  cached_values_sha256: sha256Schema,
  formula_values_sha256: sha256Schema,
  sheet: z.literal(METER_REGISTER_RECONCILIATION_WORKS_SHEET),
  source_row: z.number().int().min(2),
}).strict();

const masterRowEvidenceSchema = z.object({
  audit_row_sha256: sha256Schema,
  cached_values_sha256: sha256Schema,
  formula_values_sha256: sha256Schema,
  sheet: z.literal(METER_REGISTER_RECONCILIATION_MASTER_SHEET),
  source_row: z.number().int().min(4),
}).strict();

const invoiceEvidenceSchema = sourceRowEvidenceSchema.extend({
  is_current_for_device: z.boolean(),
  source_column: z.enum(['XERO Inv #', 'XERO Date']),
  value: invoiceNumberSchema,
  works_row: z.number().int().min(2),
}).strict().refine((evidence) => evidence.source_row === evidence.works_row, {
  message: 'Works Planning source row and works row must agree',
});

const invoiceCandidateSchema = z.object({
  all_matching_works_rows: z.array(sourceRowEvidenceSchema).min(1),
  decision: z.literal('safe_auto_fill'),
  decision_rule: z.literal('S1'),
  device_id: deviceIdentifierSchema,
  distinct_invoice_numbers: z.array(invoiceNumberSchema).length(1),
  master: masterRowEvidenceSchema,
  target_field: z.literal('xeroInvoiceNumber'),
  value: invoiceNumberSchema,
  works_evidence: z.array(invoiceEvidenceSchema).min(1),
}).strict();

const dateCandidateSchema = z.object({
  decision: z.literal('safe_auto_fill'),
  decision_rule: z.literal('S2'),
  device_id: deviceIdentifierSchema,
  master: masterRowEvidenceSchema,
  source_works_header: z.literal('XERO Date'),
  target_field: z.literal('invoice_issued_date'),
  target_master_header: z.literal('Inv issued date'),
  value: z.string().date(),
  works_evidence: z.array(sourceRowEvidenceSchema).length(1),
}).strict();

const sourceAuditSchema = z.object({
  schema: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA),
  repository_commit: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_COMMIT),
  sources: z.object({
    master_register: z.object({
      workbook_sha256: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256),
      sheet: z.literal(METER_REGISTER_RECONCILIATION_MASTER_SHEET),
    }).passthrough(),
    sw_works_planning: z.object({
      workbook_sha256: z.literal(METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256),
      sheets: z.record(z.unknown()).refine(
        (sheets) => Object.prototype.hasOwnProperty.call(
          sheets,
          METER_REGISTER_RECONCILIATION_WORKS_SHEET,
        ),
      ),
    }).passthrough(),
  }).passthrough(),
  summary: z.object({
    safe_invoice_fill_count: z.literal(METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT),
  }).passthrough(),
  safe_invoice_fills: z.array(invoiceCandidateSchema)
    .length(METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT),
  safe_other_fills: z.array(z.object({
    target_field: z.string(),
  }).passthrough()),
}).passthrough();

const immutableValueSchema = z.object({
  snapshot: z.unknown(),
  payload: z.unknown(),
}).strict();

const SNAPSHOT_TARGET_KEYS = [
  'invoiceNumber',
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
  'status',
  'comments',
] as const;

const immutableValuesShape = Object.fromEntries(
  SNAPSHOT_TARGET_KEYS.map((key) => [key, immutableValueSchema]),
) as Record<(typeof SNAPSHOT_TARGET_KEYS)[number], typeof immutableValueSchema>;
const liveValuesShape = Object.fromEntries(
  SNAPSHOT_TARGET_KEYS.map((key) => [key, z.unknown()]),
) as Record<(typeof SNAPSHOT_TARGET_KEYS)[number], z.ZodUnknown>;

const snapshotRowSchema = z.object({
  databaseName: z.enum([
    METER_REGISTER_RECONCILIATION_QA_DATABASE,
    METER_REGISTER_RECONCILIATION_PRODUCTION_DATABASE,
  ]),
  databaseSchemaName: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA),
  currentSchemaName: z.literal('pg_catalog'),
  searchPath: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH),
  databaseUser: z.string().min(1),
  tableOids: z.object({
    imports: tableOidSchema,
    entries: tableOidSchema,
    records: tableOidSchema,
  }).strict(),
  importId: z.string().min(1),
  sourceWorkbook: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK),
  sourceSheet: z.literal(METER_REGISTER_RECONCILIATION_MASTER_SHEET),
  workbookSha256: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256),
  importSourceRowCount: z.literal(METER_REGISTER_RECONCILIATION_SOURCE_ROW_COUNT),
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u),
  entryImportId: z.string().min(1),
  sourceKey: z.string().min(1),
  sourceRow: z.number().int().min(4),
  sourceRowSha256: sha256Schema,
  currentDeviceIdentifier: snapshotDeviceIdentifierSchema.nullable(),
  recordRevision: z.number().int().positive().nullable(),
  recordManuallyCorrectedAt: z.string().datetime({ offset: true }).nullable(),
  recordUpdatedByUserId: z.string().min(1).nullable(),
  immutableValues: z.object(immutableValuesShape).strict(),
  liveValues: z.object(liveValuesShape).strict(),
}).strict();

const dbSnapshotSchema = z.object({
  schema: z.literal(METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA),
  target: z.enum(['qa', 'production']),
  database: z.enum([
    METER_REGISTER_RECONCILIATION_QA_DATABASE,
    METER_REGISTER_RECONCILIATION_PRODUCTION_DATABASE,
  ]),
  databaseSchema: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA),
  searchPath: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH),
  databaseUser: z.string().min(1),
  databaseIdentitySha256: identityFingerprintSchema,
  tableOids: z.object({
    imports: tableOidSchema,
    entries: tableOidSchema,
    records: tableOidSchema,
  }).strict(),
  source: z.object({
    workbook: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK),
    sheet: z.literal(METER_REGISTER_RECONCILIATION_MASTER_SHEET),
    workbookSha256: z.literal(METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256),
  }).strict(),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(snapshotRowSchema).length(METER_REGISTER_RECONCILIATION_SOURCE_ROW_COUNT),
}).strict().superRefine((snapshot, context) => {
  try {
    assertWattwatchersMeterRegisterReconciliationTargetBinding(
      snapshot as WattwatchersMeterRegisterReconciliationTargetBinding,
    );
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'invalid target binding',
    });
  }
});

type SourceAudit = z.infer<typeof sourceAuditSchema>;
type InvoiceCandidate = z.infer<typeof invoiceCandidateSchema>;
type InvoiceEvidence = z.infer<typeof invoiceEvidenceSchema>;
type DbSnapshot = z.infer<typeof dbSnapshotSchema>;
type SnapshotRow = z.infer<typeof snapshotRowSchema>;

export type BuiltWattwatchersMeterRegisterInvoiceManifest = {
  manifest: WattwatchersMeterRegisterInvoiceReconciliationManifest;
  manifestBytes: Buffer;
  invoiceEvidenceSha256: string;
};

export type GeneratedWattwatchersMeterRegisterInvoiceManifest =
  BuiltWattwatchersMeterRegisterInvoiceManifest & {
    sourceAuditSha256: string;
    dbSnapshotSha256: string;
    manifestSha256: string;
  };

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseSchema<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const paths = [...new Set(result.error.issues.map((issue) => (
    issue.path.length === 0 ? '<root>' : issue.path.join('.')
  )))].slice(0, 5);
  throw new Error(`${label} is invalid at ${paths.join(', ')}`);
}

function isBlank(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

type HashRowEvidence = {
  audit_row_sha256: string;
  cached_values_sha256: string;
  formula_values_sha256: string;
  sheet: string;
  source_row: number;
};

function rowEvidenceKey(evidence: HashRowEvidence): string {
  return [
    evidence.sheet,
    evidence.source_row,
    evidence.audit_row_sha256,
    evidence.cached_values_sha256,
    evidence.formula_values_sha256,
  ].join('\u001f');
}

function invoiceEvidenceKey(evidence: InvoiceEvidence): string {
  return [
    rowEvidenceKey(evidence),
    evidence.source_column,
    evidence.value,
    evidence.is_current_for_device ? 'current' : 'non-current',
  ].join('\u001f');
}

function compareInvoiceEvidence(left: InvoiceEvidence, right: InvoiceEvidence): number {
  if (left.is_current_for_device !== right.is_current_for_device) {
    return left.is_current_for_device ? -1 : 1;
  }
  return left.source_row - right.source_row
    || left.source_column.localeCompare(right.source_column, 'en')
    || left.audit_row_sha256.localeCompare(right.audit_row_sha256, 'en');
}

function toManifestInvoiceEvidence(
  evidence: InvoiceEvidence,
): WattwatchersMeterRegisterInvoiceEvidence {
  return {
    sourceRow: evidence.source_row,
    worksRow: evidence.works_row,
    auditRowSha256: evidence.audit_row_sha256,
    cachedValuesSha256: evidence.cached_values_sha256,
    formulaValuesSha256: evidence.formula_values_sha256,
    sheet: evidence.sheet,
    isCurrentForDevice: evidence.is_current_for_device,
    sourceColumn: evidence.source_column,
    value: evidence.value,
  };
}

function validateInvoiceSourceAudit(sourceAudit: SourceAudit): {
  candidates: InvoiceCandidate[];
  dateByDevice: Map<string, z.infer<typeof dateCandidateSchema>>;
  invoiceEvidenceSha256: string;
} {
  const candidates = [...sourceAudit.safe_invoice_fills].sort(
    (left, right) => left.master.source_row - right.master.source_row
      || left.device_id.localeCompare(right.device_id, 'en'),
  );
  const deviceIds = new Set<string>();
  const masterRows = new Set<number>();
  const allEvidence: InvoiceEvidence[] = [];

  candidates.forEach((candidate, index) => {
    if (deviceIds.has(candidate.device_id) || masterRows.has(candidate.master.source_row)) {
      throw new Error(`Source audit candidate ${index + 1} is not uniquely identified`);
    }
    deviceIds.add(candidate.device_id);
    masterRows.add(candidate.master.source_row);

    if (candidate.distinct_invoice_numbers[0] !== candidate.value) {
      throw new Error(`Source audit candidate ${index + 1} has inconsistent invoice evidence`);
    }
    if (!candidate.works_evidence.some((evidence) => evidence.is_current_for_device)) {
      throw new Error(`Source audit candidate ${index + 1} lacks current-device invoice evidence`);
    }
    const matchingRows = new Set(candidate.all_matching_works_rows.map(rowEvidenceKey));
    for (const evidence of candidate.works_evidence) {
      if (evidence.value !== candidate.value || !matchingRows.has(rowEvidenceKey(evidence))) {
        throw new Error(`Source audit candidate ${index + 1} has inconsistent Works evidence`);
      }
      allEvidence.push(evidence);
    }
  });

  const currentEvidenceCount = allEvidence.filter(
    (evidence) => evidence.is_current_for_device,
  ).length;
  const xeroDateEvidenceCount = allEvidence.filter(
    (evidence) => evidence.source_column === 'XERO Date',
  ).length;
  if (allEvidence.length !== METER_REGISTER_RECONCILIATION_INVOICE_EVIDENCE_COUNT
    || currentEvidenceCount !== METER_REGISTER_RECONCILIATION_CURRENT_INVOICE_EVIDENCE_COUNT
    || xeroDateEvidenceCount
      !== METER_REGISTER_RECONCILIATION_XERO_DATE_INVOICE_EVIDENCE_COUNT) {
    throw new Error('Source audit invoice evidence set does not match the approved 95-row set');
  }

  const dateCandidates = sourceAudit.safe_other_fills
    .filter((candidate) => candidate.target_field === 'invoice_issued_date')
    .map((candidate, index) => parseSchema(
      dateCandidateSchema,
      candidate,
      `Source audit invoice-date candidate ${index + 1}`,
    ))
    .filter((candidate) => deviceIds.has(candidate.device_id));
  if (dateCandidates.length !== METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT) {
    throw new Error('Source audit must have exactly one invoice-date candidate in the invoice set');
  }
  const dateByDevice = new Map(dateCandidates.map((candidate) => [candidate.device_id, candidate]));
  const invoiceByDevice = new Map(candidates.map((candidate) => [candidate.device_id, candidate]));
  for (const dateCandidate of dateCandidates) {
    const invoiceCandidate = invoiceByDevice.get(dateCandidate.device_id);
    if (!invoiceCandidate
      || rowEvidenceKey(dateCandidate.master) !== rowEvidenceKey(invoiceCandidate.master)) {
      throw new Error('Source audit invoice-date candidate has inconsistent Master provenance');
    }
    const currentInvoiceEvidence = new Set(invoiceCandidate.works_evidence
      .filter((evidence) => evidence.is_current_for_device)
      .map(rowEvidenceKey));
    if (!dateCandidate.works_evidence.every(
      (evidence) => currentInvoiceEvidence.has(rowEvidenceKey(evidence)),
    )) {
      throw new Error('Source audit invoice-date candidate lacks matching current invoice evidence');
    }
  }

  const orderedEvidence = candidates.flatMap((candidate) => (
    [...candidate.works_evidence].sort(compareInvoiceEvidence).map((evidence) => ({
      masterSourceRow: candidate.master.source_row,
      deviceIdentifier: candidate.device_id,
      evidence: invoiceEvidenceKey(evidence),
    }))
  ));
  return {
    candidates,
    dateByDevice,
    invoiceEvidenceSha256: sha256(Buffer.from(JSON.stringify(orderedEvidence), 'utf8')),
  };
}

function validateSnapshot(snapshot: DbSnapshot): void {
  if (snapshot.rowCount !== snapshot.rows.length) {
    throw new Error('DB snapshot rowCount does not match its rows');
  }
  const entryIds = new Set<string>();
  const sourceRows = new Set<number>();
  const importIds = new Set<string>();
  let currentIdentifierCount = 0;
  let previousSourceRow = -1;
  for (const row of snapshot.rows) {
    if (row.databaseName !== snapshot.database
      || row.databaseSchemaName !== snapshot.databaseSchema
      || row.searchPath !== snapshot.searchPath
      || row.databaseUser !== snapshot.databaseUser
      || row.tableOids.imports !== snapshot.tableOids.imports
      || row.tableOids.entries !== snapshot.tableOids.entries
      || row.tableOids.records !== snapshot.tableOids.records) {
      throw new Error('DB snapshot row target binding does not match its artifact binding');
    }
    if (row.importId !== row.entryImportId) {
      throw new Error('DB snapshot contains an entry/import provenance mismatch');
    }
    if (entryIds.has(row.entryId) || sourceRows.has(row.sourceRow)) {
      throw new Error('DB snapshot contains duplicate entry or source-row identity');
    }
    if (row.sourceRow <= previousSourceRow) {
      throw new Error('DB snapshot row ordering changed');
    }
    entryIds.add(row.entryId);
    sourceRows.add(row.sourceRow);
    importIds.add(row.importId);
    if (row.currentDeviceIdentifier !== null) currentIdentifierCount += 1;
    previousSourceRow = row.sourceRow;
  }
  if (importIds.size !== 1
    || currentIdentifierCount !== METER_REGISTER_RECONCILIATION_CURRENT_IDENTIFIER_COUNT) {
    throw new Error('DB snapshot import or current-identifier population changed');
  }
}

function resolveEligibleSnapshotRow(
  candidate: InvoiceCandidate,
  candidateIndex: number,
  snapshot: DbSnapshot,
  hasInvoiceDate: boolean,
): SnapshotRow {
  const sourceRowMatches = snapshot.rows.filter(
    (row) => row.sourceRow === candidate.master.source_row,
  );
  const deviceMatches = snapshot.rows.filter(
    (row) => row.currentDeviceIdentifier === candidate.device_id,
  );
  if (sourceRowMatches.length !== 1 || deviceMatches.length !== 1
    || sourceRowMatches[0] !== deviceMatches[0]) {
    throw new Error(`DB snapshot candidate ${candidateIndex + 1} does not resolve uniquely`);
  }
  const row = sourceRowMatches[0]!;
  if (row.sourceRowSha256 !== candidate.master.cached_values_sha256) {
    throw new Error(`DB snapshot candidate ${candidateIndex + 1} has changed source provenance`);
  }
  if (row.recordRevision === null || row.recordManuallyCorrectedAt !== null
    || row.recordUpdatedByUserId !== null
    || !isBlank(row.immutableValues.invoiceNumber.snapshot)
    || !isBlank(row.immutableValues.invoiceNumber.payload)
    || !isBlank(row.liveValues.invoiceNumber)) {
    throw new Error(`DB snapshot candidate ${candidateIndex + 1} is no longer invoice-eligible`);
  }
  if (hasInvoiceDate && (
    !isBlank(row.immutableValues.invoiceIssuedDate.snapshot)
    || !isBlank(row.immutableValues.invoiceIssuedDate.payload)
    || !isBlank(row.liveValues.invoiceIssuedDate)
  )) {
    throw new Error(`DB snapshot candidate ${candidateIndex + 1} is no longer date-eligible`);
  }
  return row;
}

export function buildWattwatchersMeterRegisterInvoiceManifest(input: {
  sourceAudit: unknown;
  dbSnapshot: unknown;
  sourceAuditSha256: string;
  dbSnapshotSha256: string;
  expectedTarget: WattwatchersMeterRegisterReconciliationTarget;
  expectedDatabaseIdentitySha256: string;
}): BuiltWattwatchersMeterRegisterInvoiceManifest {
  if (input.sourceAuditSha256 !== METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256) {
    throw new Error('Source audit provenance digest does not match the approved audit');
  }
  if (!sha256Schema.safeParse(input.dbSnapshotSha256).success) {
    throw new Error('DB snapshot provenance digest must be a SHA-256 digest');
  }
  const sourceAudit = parseSchema(sourceAuditSchema, input.sourceAudit, 'Source audit');
  const snapshot = parseSchema(dbSnapshotSchema, input.dbSnapshot, 'DB snapshot');
  if (snapshot.target !== input.expectedTarget) {
    throw new Error('DB snapshot target does not match the explicitly requested target');
  }
  if (snapshot.databaseIdentitySha256 !== input.expectedDatabaseIdentitySha256) {
    throw new Error('DB snapshot identity does not match the protected target identity');
  }
  validateSnapshot(snapshot);
  const validatedSource = validateInvoiceSourceAudit(sourceAudit);

  const candidates: WattwatchersMeterRegisterInvoiceReconciliationCandidate[] =
    validatedSource.candidates.map((sourceCandidate, index) => {
    const dateCandidate = validatedSource.dateByDevice.get(sourceCandidate.device_id) ?? null;
    const snapshotRow = resolveEligibleSnapshotRow(
      sourceCandidate,
      index,
      snapshot,
      dateCandidate !== null,
    );
    const worksPlanningEvidence = [...sourceCandidate.works_evidence]
      .sort(compareInvoiceEvidence)
      .map(toManifestInvoiceEvidence);
    const dateEvidence = dateCandidate?.works_evidence[0] ?? null;
    const immutableDateBlank = isBlank(snapshotRow.immutableValues.invoiceIssuedDate.snapshot)
      && isBlank(snapshotRow.immutableValues.invoiceIssuedDate.payload);
    return {
      entryId: snapshotRow.entryId,
      masterSourceRow: sourceCandidate.master.source_row,
      masterSourceRowSha256: snapshotRow.sourceRowSha256,
      currentDeviceIdentifier: sourceCandidate.device_id,
      expectedRevision: snapshotRow.recordRevision!,
      worksPlanningEvidence,
      matchKind: 'current_device' as const,
      worksPlanningInvoiceEventCount: 1 as const,
      reviewDecision: 'safe' as const,
      masterInvoiceNumber: null,
      masterInvoiceIssuedDateBlank: immutableDateBlank,
      hasInvoiceConflict: false as const,
      invoiceNumber: sourceCandidate.value,
      invoiceIssuedDate: dateCandidate?.value ?? null,
      invoiceDateSourceColumn: dateCandidate === null ? null : 'XERO Date' as const,
      invoiceDateEvidence: dateEvidence === null ? null : {
        sourceRow: dateEvidence.source_row,
        auditRowSha256: dateEvidence.audit_row_sha256,
        cachedValuesSha256: dateEvidence.cached_values_sha256,
        formulaValuesSha256: dateEvidence.formula_values_sha256,
        sheet: dateEvidence.sheet,
        sourceColumn: 'XERO Date' as const,
      },
    };
  });

  const invoiceEvidenceSha256 =
    computeWattwatchersMeterRegisterInvoiceEvidenceSha256(candidates);
  if (invoiceEvidenceSha256 !== validatedSource.invoiceEvidenceSha256) {
    throw new Error('Generated invoice evidence digest changed during manifest normalization');
  }
  const currentEvidenceCount = candidates.flatMap(
    (candidate) => candidate.worksPlanningEvidence,
  ).filter((evidence) => evidence.isCurrentForDevice).length;
  const xeroDateEvidenceCount = candidates.flatMap(
    (candidate) => candidate.worksPlanningEvidence,
  ).filter((evidence) => evidence.sourceColumn === 'XERO Date').length;

  const manifest = parseWattwatchersMeterRegisterInvoiceReconciliationManifest({
    schemaVersion: 3,
    provenance: {
      sourceAudit: {
        schema: METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SCHEMA,
        sha256: input.sourceAuditSha256,
        repositoryCommit: METER_REGISTER_RECONCILIATION_SOURCE_COMMIT,
      },
      dbSnapshot: {
        schema: METER_REGISTER_RECONCILIATION_DB_SNAPSHOT_SCHEMA,
        sha256: input.dbSnapshotSha256,
        target: snapshot.target,
        database: snapshot.database,
        databaseSchema: snapshot.databaseSchema,
        searchPath: snapshot.searchPath,
        databaseUser: snapshot.databaseUser,
        databaseIdentitySha256: snapshot.databaseIdentitySha256,
        tableOids: snapshot.tableOids,
      },
      invoiceEvidence: {
        rowCount: candidates.flatMap(
          (candidate) => candidate.worksPlanningEvidence,
        ).length,
        currentRowCount: currentEvidenceCount,
        xeroDateValueRowCount: xeroDateEvidenceCount,
        sha256: invoiceEvidenceSha256,
      },
    },
    sources: {
      masterRegister: {
        workbook: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK,
        workbookSha256: METER_REGISTER_RECONCILIATION_MASTER_WORKBOOK_SHA256,
        sheet: METER_REGISTER_RECONCILIATION_MASTER_SHEET,
      },
      worksPlanning: {
        workbook: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK,
        workbookSha256: METER_REGISTER_RECONCILIATION_WORKS_WORKBOOK_SHA256,
        sheet: METER_REGISTER_RECONCILIATION_WORKS_SHEET,
      },
    },
    expected: {
      matchedCount: METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT,
      invoiceNumberUpdateCount: METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT,
      invoiceDateUpdateCount: METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT,
    },
    candidates,
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifest,
    manifestBytes,
    invoiceEvidenceSha256,
  };
}

export function assertWattwatchersMeterRegisterDbSnapshotDigest(
  bytes: Uint8Array,
  expectedSha256: string,
): string {
  const actualSha256 = sha256(bytes);
  const normalizedExpected = expectedSha256
    .trim()
    .toLowerCase()
    .replace(/^sha256:/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalizedExpected)) {
    throw new Error('Expected DB snapshot digest must be a 64-character SHA-256 digest');
  }
  if (actualSha256 !== normalizedExpected) {
    throw new Error('DB snapshot bytes do not match the independently captured SHA-256 digest');
  }
  return actualSha256;
}

export function generateWattwatchersMeterRegisterInvoiceManifest(input: {
  sourceAuditBytes: Uint8Array;
  dbSnapshotBytes: Uint8Array;
  expectedDbSnapshotSha256: string;
  expectedTarget: WattwatchersMeterRegisterReconciliationTarget;
  expectedDatabaseIdentitySha256: string;
}): GeneratedWattwatchersMeterRegisterInvoiceManifest {
  const sourceAuditSha256 = sha256(input.sourceAuditBytes);
  if (sourceAuditSha256 !== METER_REGISTER_RECONCILIATION_SOURCE_AUDIT_SHA256) {
    throw new Error('Source audit bytes do not match the approved SHA-256 digest');
  }
  const dbSnapshotSha256 = assertWattwatchersMeterRegisterDbSnapshotDigest(
    input.dbSnapshotBytes,
    input.expectedDbSnapshotSha256,
  );
  const built = buildWattwatchersMeterRegisterInvoiceManifest({
    sourceAudit: parseJson(input.sourceAuditBytes, 'Source audit'),
    dbSnapshot: parseJson(input.dbSnapshotBytes, 'DB snapshot'),
    sourceAuditSha256,
    dbSnapshotSha256,
    expectedTarget: input.expectedTarget,
    expectedDatabaseIdentitySha256: input.expectedDatabaseIdentitySha256,
  });
  return {
    ...built,
    sourceAuditSha256,
    dbSnapshotSha256,
    manifestSha256: sha256(built.manifestBytes),
  };
}

export async function readPrivateWattwatchersMeterRegisterReconciliationArtifact(
  path: string,
  label: string,
): Promise<Buffer> {
  const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await input.stat();
    if (!fileStat.isFile() || (fileStat.mode & 0o077) !== 0) {
      throw new Error(`${label} must be a regular file inaccessible to group and other users`);
    }
    return await input.readFile();
  } finally {
    await input.close();
  }
}

export async function writePrivateWattwatchersMeterRegisterReconciliationArtifact(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(
    directory,
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
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

export async function writePrivateWattwatchersMeterRegisterInvoiceManifest(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await writePrivateWattwatchersMeterRegisterReconciliationArtifact(path, bytes);
}
