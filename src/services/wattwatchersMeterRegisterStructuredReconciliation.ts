import { z } from 'zod';

export type WattwatchersMeterRegisterStructuredReconciliationMode = 'dry-run' | 'apply';

export const METER_REGISTER_STRUCTURED_MASTER_WORKBOOK = 'Master Register (1).xlsx';
export const METER_REGISTER_STRUCTURED_MASTER_SHEET = 'Master Project Register';
export const METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256 =
  '4bb6e835928eb34bdee30d9e71f94c38d641b078a75c52a58c8450a60acd6c34';
export const METER_REGISTER_STRUCTURED_WORKS_WORKBOOK = 'SW Works Planning.xlsx';
export const METER_REGISTER_STRUCTURED_WORKS_SHEET = 'Works Planning';
export const METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256 =
  '900856dfc259c178235b55cd3255773d1037e40562b083dae1095543747cea9b';
export const METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA =
  'wattwatchers-spreadsheet-reconciliation/v1';
export const METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256 =
  '02d97966529d1dbf9cfe285e7943d25ff3e6de00c1fd72b00ef5cb0aaffac4f5';
export const METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT =
  'd29dccfc308c58417331aab4a45a4ab90876b415';

export const METER_REGISTER_STRUCTURED_FIELD_CONTRACT = {
  serviceType: {
    auditTargetField: 'service_type',
    valueType: 'text',
    sourceAuditCount: 159,
    worksHeader: 'Service Type',
    masterHeader: 'Service Type',
  },
  meteringSolutionType: {
    auditTargetField: 'metering_solution_type',
    valueType: 'text',
    sourceAuditCount: 130,
    worksHeader: 'Metering Solution Type',
    masterHeader: 'Metering Solution Type',
  },
  meterType: {
    auditTargetField: 'meter_type',
    valueType: 'text',
    sourceAuditCount: 131,
    worksHeader: 'Meter Type',
    masterHeader: 'Meter Type',
  },
  fergusJobNumber: {
    auditTargetField: 'fergus_job_number',
    valueType: 'text',
    sourceAuditCount: 142,
    worksHeader: 'Fergus Job #',
    masterHeader: 'Fergus Job #',
  },
  quoteNumber: {
    auditTargetField: 'quote_number',
    valueType: 'text',
    sourceAuditCount: 3,
    worksHeader: 'QUOTE #',
    masterHeader: 'Quote #',
  },
  purchaseOrderNumber: {
    auditTargetField: 'purchase_order_number',
    valueType: 'text',
    sourceAuditCount: 67,
    worksHeader: 'PO #',
    masterHeader: 'PO Number',
  },
  jobCompletionDate: {
    auditTargetField: 'job_completion_date',
    valueType: 'date',
    sourceAuditCount: 126,
    worksHeader: 'Job Completion Date',
    masterHeader: 'Job Completion Date',
  },
  jobCompletedBy: {
    auditTargetField: 'job_completed_by',
    valueType: 'text',
    sourceAuditCount: 175,
    worksHeader: 'Job Completed By',
    masterHeader: 'Job Completed By',
  },
  hardwareInstalled: {
    auditTargetField: 'hardware_installed',
    valueType: 'text',
    sourceAuditCount: 97,
    worksHeader: 'Hardware Installed',
    masterHeader: 'Hardware Installed',
  },
  maas: {
    auditTargetField: 'maas',
    valueType: 'boolean',
    sourceAuditCount: 42,
    worksHeader: 'MaaS (Yes/No)',
    masterHeader: 'MaaS (Yes/No)',
  },
  invoiceIssuedDate: {
    auditTargetField: 'invoice_issued_date',
    valueType: 'date',
    sourceAuditCount: 11,
    worksHeader: 'XERO Date',
    masterHeader: 'Inv issued date',
  },
} as const;

export type WattwatchersMeterRegisterStructuredFieldKey =
  keyof typeof METER_REGISTER_STRUCTURED_FIELD_CONTRACT;

const STRUCTURED_FIELD_KEYS = Object.keys(
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT,
) as WattwatchersMeterRegisterStructuredFieldKey[];

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoDateSchema = z.string().date();
const structuredFieldKeySchema = z.enum([
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
]);

const fieldCountSchema = z.object({
  serviceType: z.number().int().nonnegative(),
  meteringSolutionType: z.number().int().nonnegative(),
  meterType: z.number().int().nonnegative(),
  fergusJobNumber: z.number().int().nonnegative(),
  quoteNumber: z.number().int().nonnegative(),
  purchaseOrderNumber: z.number().int().nonnegative(),
  jobCompletionDate: z.number().int().nonnegative(),
  jobCompletedBy: z.number().int().nonnegative(),
  hardwareInstalled: z.number().int().nonnegative(),
  maas: z.number().int().nonnegative(),
  invoiceIssuedDate: z.number().int().nonnegative(),
}).strict();

const auditedFieldCountSchema = z.object({
  serviceType: z.literal(159),
  meteringSolutionType: z.literal(130),
  meterType: z.literal(131),
  fergusJobNumber: z.literal(142),
  quoteNumber: z.literal(3),
  purchaseOrderNumber: z.literal(67),
  jobCompletionDate: z.literal(126),
  jobCompletedBy: z.literal(175),
  hardwareInstalled: z.literal(97),
  maas: z.literal(42),
  invoiceIssuedDate: z.literal(11),
}).strict();

const worksEvidenceSchema = z.object({
  sheet: z.literal(METER_REGISTER_STRUCTURED_WORKS_SHEET),
  sourceRow: z.number().int().min(2),
  auditRowSha256: sha256Schema,
  cachedValuesSha256: sha256Schema,
  formulaValuesSha256: sha256Schema,
}).strict();

const structuredFieldSchema = z.object({
  key: structuredFieldKeySchema,
  auditTargetField: z.string().min(1),
  value: z.union([z.string(), z.boolean()]),
  auditDecision: z.literal('safe_auto_fill'),
  auditDecisionRule: z.literal('S2'),
  worksHeader: z.string().min(1),
  masterHeader: z.string().min(1),
  worksEvidence: z.array(worksEvidenceSchema).min(1),
}).strict().superRefine((field, context) => {
  const contract = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[field.key];
  if (field.auditTargetField !== contract.auditTargetField) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['auditTargetField'],
      message: `expected source-audit target field ${contract.auditTargetField}`,
    });
  }
  if (field.worksHeader !== contract.worksHeader) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['worksHeader'],
      message: `expected Works Planning header ${contract.worksHeader}`,
    });
  }
  if (field.masterHeader !== contract.masterHeader) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['masterHeader'],
      message: `expected Master Register header ${contract.masterHeader}`,
    });
  }
  if (contract.valueType === 'boolean') {
    if (typeof field.value !== 'boolean') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${field.key} must be boolean`,
      });
    }
  } else if (typeof field.value !== 'string') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `${field.key} must be text`,
    });
  } else if (contract.valueType === 'date') {
    if (!isoDateSchema.safeParse(field.value).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${field.key} must be an ISO calendar date`,
      });
    }
  } else if (!field.value.trim() || field.value.length > 300
    || field.value !== field.value.trim()
    || field.value !== field.value.replace(/\s+/gu, ' ')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `${field.key} must be trimmed nonblank text of at most 300 characters`,
    });
  }

  const worksRows = new Set<number>();
  for (const evidence of field.worksEvidence) {
    if (worksRows.has(evidence.sourceRow)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['worksEvidence'],
        message: `${field.key} has duplicate Works Planning source rows`,
      });
      break;
    }
    worksRows.add(evidence.sourceRow);
  }
});

const candidateSchema = z.object({
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u),
  masterSourceRow: z.number().int().min(4),
  masterSourceRowSha256: sha256Schema,
  masterAuditRowSha256: sha256Schema,
  masterCachedValuesSha256: sha256Schema,
  masterFormulaValuesSha256: sha256Schema,
  currentDeviceIdentifier: z.string().regex(/^[A-Z0-9]{13}$/u),
  expectedRevision: z.number().int().positive(),
  expectedUpdatedByUserId: z.null(),
  expectedManuallyCorrectedAt: z.null(),
  fields: z.array(structuredFieldSchema).min(1),
}).strict().superRefine((candidate, context) => {
  const fieldKeys = new Set<WattwatchersMeterRegisterStructuredFieldKey>();
  for (const field of candidate.fields) {
    if (fieldKeys.has(field.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fields'],
        message: `candidate contains duplicate field ${field.key}`,
      });
      break;
    }
    fieldKeys.add(field.key);
  }
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.object({
    masterRegister: z.object({
      workbook: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK),
      workbookSha256: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256),
      sheet: z.literal(METER_REGISTER_STRUCTURED_MASTER_SHEET),
    }).strict(),
    worksPlanning: z.object({
      workbook: z.literal(METER_REGISTER_STRUCTURED_WORKS_WORKBOOK),
      workbookSha256: z.literal(METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256),
      sheet: z.literal(METER_REGISTER_STRUCTURED_WORKS_SHEET),
    }).strict(),
    sourceAudit: z.object({
      schema: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA),
      sha256: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256),
      repositoryCommit: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT),
      auditedFieldCounts: auditedFieldCountSchema,
    }).strict(),
  }).strict(),
  expected: z.object({
    recordUpdateCount: z.number().int().positive(),
    fieldUpdateCounts: fieldCountSchema,
  }).strict(),
  candidates: z.array(candidateSchema).min(1),
}).strict();

const sourceAuditMasterSchema = z.object({
  sheet: z.literal(METER_REGISTER_STRUCTURED_MASTER_SHEET),
  source_row: z.number().int().min(4),
  audit_row_sha256: sha256Schema,
  cached_values_sha256: sha256Schema,
  formula_values_sha256: sha256Schema,
}).strict();

const sourceAuditWorksEvidenceSchema = z.object({
  sheet: z.literal(METER_REGISTER_STRUCTURED_WORKS_SHEET),
  source_row: z.number().int().min(2),
  audit_row_sha256: sha256Schema,
  cached_values_sha256: sha256Schema,
  formula_values_sha256: sha256Schema,
}).strict();

const sourceAuditCandidateSchema = z.object({
  decision: z.literal('safe_auto_fill'),
  decision_rule: z.literal('S2'),
  device_id: z.string().regex(/^[A-Z0-9]{13}$/u),
  target_field: z.string().min(1),
  target_master_header: z.string().min(1),
  source_works_header: z.string().min(1),
  value: z.union([z.string(), z.boolean()]),
  master: sourceAuditMasterSchema,
  works_evidence: z.array(sourceAuditWorksEvidenceSchema).min(1),
}).strict();

const sourceAuditSchema = z.object({
  schema: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA),
  repository_commit: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT),
  sources: z.object({
    master_register: z.object({
      workbook_sha256: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256),
    }).passthrough(),
    sw_works_planning: z.object({
      workbook_sha256: z.literal(METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256),
    }).passthrough(),
  }).passthrough(),
  safe_other_fills: z.array(z.unknown()),
}).passthrough();

export type WattwatchersMeterRegisterStructuredField = z.infer<typeof structuredFieldSchema>;
export type WattwatchersMeterRegisterStructuredCandidate = z.infer<typeof candidateSchema>;
export type WattwatchersMeterRegisterStructuredManifest = z.infer<typeof manifestSchema>;
export type WattwatchersMeterRegisterStructuredFieldCounts = z.infer<typeof fieldCountSchema>;

export type BuiltWattwatchersMeterRegisterStructuredReconciliationSql = {
  sql: string;
  recordUpdateCount: number;
  fieldUpdateCounts: WattwatchersMeterRegisterStructuredFieldCounts;
};

export function wattwatchersMeterRegisterStructuredAuditedFieldCounts():
WattwatchersMeterRegisterStructuredFieldCounts {
  return Object.fromEntries(STRUCTURED_FIELD_KEYS.map((key) => [
    key,
    METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key].sourceAuditCount,
  ])) as WattwatchersMeterRegisterStructuredFieldCounts;
}

function emptyFieldCounts(): WattwatchersMeterRegisterStructuredFieldCounts {
  return Object.fromEntries(
    STRUCTURED_FIELD_KEYS.map((key) => [key, 0]),
  ) as WattwatchersMeterRegisterStructuredFieldCounts;
}

const AUDIT_TARGET_TO_FIELD = Object.fromEntries(
  STRUCTURED_FIELD_KEYS.map((key) => [
    METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key].auditTargetField,
    key,
  ]),
) as Record<string, WattwatchersMeterRegisterStructuredFieldKey>;

type SourceAuditCandidate = z.infer<typeof sourceAuditCandidateSchema>;

function canonicalEvidence(evidence: WattwatchersMeterRegisterStructuredField['worksEvidence']) {
  return evidence.map((item) => ({
    sheet: item.sheet,
    sourceRow: item.sourceRow,
    auditRowSha256: item.auditRowSha256,
    cachedValuesSha256: item.cachedValuesSha256,
    formulaValuesSha256: item.formulaValuesSha256,
  })).sort((left, right) => left.sourceRow - right.sourceRow);
}

function sourceAuditFingerprint(input: {
  deviceId: string;
  key: WattwatchersMeterRegisterStructuredFieldKey;
  value: string | boolean;
  masterSourceRow: number;
  masterAuditRowSha256: string;
  masterCachedValuesSha256: string;
  masterFormulaValuesSha256: string;
  worksEvidence: WattwatchersMeterRegisterStructuredField['worksEvidence'];
}): string {
  const contract = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[input.key];
  return JSON.stringify({
    deviceId: input.deviceId,
    key: input.key,
    auditTargetField: contract.auditTargetField,
    value: input.value,
    masterHeader: contract.masterHeader,
    worksHeader: contract.worksHeader,
    masterSourceRow: input.masterSourceRow,
    masterAuditRowSha256: input.masterAuditRowSha256,
    masterCachedValuesSha256: input.masterCachedValuesSha256,
    masterFormulaValuesSha256: input.masterFormulaValuesSha256,
    worksEvidence: canonicalEvidence(input.worksEvidence),
  });
}

function normalizedSourceAuditCandidate(candidate: SourceAuditCandidate): {
  key: WattwatchersMeterRegisterStructuredFieldKey;
  field: WattwatchersMeterRegisterStructuredField;
  fingerprint: string;
} {
  const key = AUDIT_TARGET_TO_FIELD[candidate.target_field];
  if (!key) throw new Error('Structured source audit contains an unapproved target field');
  const field = structuredFieldSchema.parse({
    key,
    auditTargetField: candidate.target_field,
    value: candidate.value,
    auditDecision: candidate.decision,
    auditDecisionRule: candidate.decision_rule,
    worksHeader: candidate.source_works_header,
    masterHeader: candidate.target_master_header,
    worksEvidence: candidate.works_evidence.map((evidence) => ({
      sheet: evidence.sheet,
      sourceRow: evidence.source_row,
      auditRowSha256: evidence.audit_row_sha256,
      cachedValuesSha256: evidence.cached_values_sha256,
      formulaValuesSha256: evidence.formula_values_sha256,
    })),
  });
  return {
    key,
    field,
    fingerprint: sourceAuditFingerprint({
      deviceId: candidate.device_id,
      key,
      value: field.value,
      masterSourceRow: candidate.master.source_row,
      masterAuditRowSha256: candidate.master.audit_row_sha256,
      masterCachedValuesSha256: candidate.master.cached_values_sha256,
      masterFormulaValuesSha256: candidate.master.formula_values_sha256,
      worksEvidence: field.worksEvidence,
    }),
  };
}

/**
 * Proves that every live DB candidate is an exact subset of the pinned source
 * audit. Exclusion is allowed because a fresh DB read may find a destination
 * populated or operator-edited after the source-only audit.
 */
export function assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
  manifest: WattwatchersMeterRegisterStructuredManifest,
  sourceAuditInput: unknown,
): void {
  const sourceAudit = sourceAuditSchema.parse(sourceAuditInput);
  const auditedCounts = emptyFieldCounts();
  const fingerprintCounts = new Map<string, number>();

  for (const rawCandidate of sourceAudit.safe_other_fills) {
    if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) continue;
    const targetField = (rawCandidate as Record<string, unknown>).target_field;
    if (typeof targetField !== 'string' || !AUDIT_TARGET_TO_FIELD[targetField]) continue;
    const candidate = sourceAuditCandidateSchema.parse(rawCandidate);
    const normalized = normalizedSourceAuditCandidate(candidate);
    auditedCounts[normalized.key] += 1;
    fingerprintCounts.set(
      normalized.fingerprint,
      (fingerprintCounts.get(normalized.fingerprint) ?? 0) + 1,
    );
  }

  for (const key of STRUCTURED_FIELD_KEYS) {
    const expected = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key].sourceAuditCount;
    if (auditedCounts[key] !== expected) {
      throw new Error(`Structured source audit ${key} count changed`);
    }
  }

  for (const candidate of manifest.candidates) {
    for (const field of candidate.fields) {
      const fingerprint = sourceAuditFingerprint({
        deviceId: candidate.currentDeviceIdentifier,
        key: field.key,
        value: field.value,
        masterSourceRow: candidate.masterSourceRow,
        masterAuditRowSha256: candidate.masterAuditRowSha256,
        masterCachedValuesSha256: candidate.masterCachedValuesSha256,
        masterFormulaValuesSha256: candidate.masterFormulaValuesSha256,
        worksEvidence: field.worksEvidence,
      });
      if (fingerprintCounts.get(fingerprint) !== 1) {
        throw new Error(`Structured live manifest field ${field.key} has no unique source audit match`);
      }
      fingerprintCounts.set(fingerprint, 0);
    }
  }
}

export function parseWattwatchersMeterRegisterStructuredManifest(
  input: unknown,
): WattwatchersMeterRegisterStructuredManifest {
  const manifest = manifestSchema.parse(input);
  const entryIds = new Set<string>();
  const masterRows = new Set<number>();
  const deviceIdentifiers = new Set<string>();
  const actualCounts = emptyFieldCounts();

  for (const candidate of manifest.candidates) {
    if (entryIds.has(candidate.entryId)) {
      throw new Error(`Duplicate structured reconciliation entryId: ${candidate.entryId}`);
    }
    if (masterRows.has(candidate.masterSourceRow)) {
      throw new Error(`Duplicate structured reconciliation Master row: ${candidate.masterSourceRow}`);
    }
    if (deviceIdentifiers.has(candidate.currentDeviceIdentifier)) {
      throw new Error('Structured reconciliation current device identifiers must be unique');
    }
    entryIds.add(candidate.entryId);
    masterRows.add(candidate.masterSourceRow);
    deviceIdentifiers.add(candidate.currentDeviceIdentifier);
    for (const field of candidate.fields) actualCounts[field.key] += 1;
  }

  if (manifest.expected.recordUpdateCount !== manifest.candidates.length) {
    throw new Error('Structured reconciliation record count does not match its candidates');
  }
  for (const key of STRUCTURED_FIELD_KEYS) {
    if (manifest.expected.fieldUpdateCounts[key] !== actualCounts[key]) {
      throw new Error(`Structured reconciliation ${key} count does not match its candidates`);
    }
    if (actualCounts[key] > METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key].sourceAuditCount) {
      throw new Error(`Structured reconciliation ${key} exceeds the source-audited count`);
    }
  }
  return manifest;
}

function normalizeSha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 digest`);
  }
  return normalized;
}

export function assertWattwatchersMeterRegisterStructuredArtifactDigests(input: {
  masterWorkbookSha256: string;
  worksWorkbookSha256: string;
  sourceAuditSha256: string;
  manifestSha256: string;
  expectedManifestSha256: string;
}): void {
  if (normalizeSha256(input.masterWorkbookSha256, 'Master Register workbook digest')
    !== METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256) {
    throw new Error('Master Register workbook bytes do not match the structured source contract');
  }
  if (normalizeSha256(input.worksWorkbookSha256, 'Works Planning workbook digest')
    !== METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256) {
    throw new Error('Works Planning workbook bytes do not match the structured source contract');
  }
  if (normalizeSha256(input.sourceAuditSha256, 'source audit digest')
    !== METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256) {
    throw new Error('Structured source audit bytes do not match the approved artifact');
  }
  if (normalizeSha256(input.manifestSha256, 'manifest digest')
    !== normalizeSha256(input.expectedManifestSha256, 'expected manifest digest')) {
    throw new Error('Structured reconciliation manifest bytes do not match the approved digest');
  }
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: unknown): string {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function entryStageRowSql(
  candidate: WattwatchersMeterRegisterStructuredCandidate,
  ordinal: number,
): string {
  return `(${[
    ordinal,
    sqlText(candidate.entryId),
    candidate.masterSourceRow,
    sqlText(candidate.masterSourceRowSha256),
    sqlText(candidate.currentDeviceIdentifier),
    candidate.expectedRevision,
  ].join(', ')})`;
}

function fieldStageRowSql(
  candidate: WattwatchersMeterRegisterStructuredCandidate,
  field: WattwatchersMeterRegisterStructuredField,
): string {
  return `(${[
    sqlText(candidate.entryId),
    sqlText(field.key),
    sqlJson(field.value),
    sqlText(field.masterHeader),
  ].join(', ')})`;
}

function countAssertionsSql(counts: WattwatchersMeterRegisterStructuredFieldCounts): string {
  return STRUCTURED_FIELD_KEYS.map((key) => `  IF (SELECT count(*)
      FROM ww_meter_register_structured_field_stage
      WHERE field_key = ${sqlText(key)}) <> ${counts[key]} THEN
    RAISE EXCEPTION 'Structured reconciliation ${key} staged count changed';
  END IF;`).join('\n');
}

function expectedCountsJsonSql(counts: WattwatchersMeterRegisterStructuredFieldCounts): string {
  return `jsonb_build_object(${STRUCTURED_FIELD_KEYS.flatMap((key) => [
    sqlText(key),
    String(counts[key]),
  ]).join(', ')})`;
}

function updatedCountsJsonSql(): string {
  return `jsonb_build_object(${STRUCTURED_FIELD_KEYS.flatMap((key) => [
    sqlText(key),
    `(SELECT count(*)
      FROM ww_meter_register_structured_updated updated
      JOIN ww_meter_register_structured_field_stage field
        ON field.entry_id = updated.entry_id
      WHERE field.field_key = ${sqlText(key)})`,
  ]).join(', ')})`;
}

export function buildWattwatchersMeterRegisterStructuredReconciliationSql(input: {
  manifest: WattwatchersMeterRegisterStructuredManifest;
  mode: WattwatchersMeterRegisterStructuredReconciliationMode;
}): BuiltWattwatchersMeterRegisterStructuredReconciliationSql {
  if (input.mode !== 'dry-run' && input.mode !== 'apply') {
    throw new Error('Structured reconciliation mode must be dry-run or apply');
  }
  const { manifest } = input;
  const expectedRecordCount = manifest.expected.recordUpdateCount;
  const entryValues = manifest.candidates.map(entryStageRowSql).join(',\n');
  const fieldValues = manifest.candidates.flatMap((candidate) => candidate.fields.map(
    (field) => fieldStageRowSql(candidate, field),
  )).join(',\n');
  const finish = input.mode === 'apply' ? 'COMMIT;' : 'ROLLBACK;';

  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
SELECT pg_advisory_xact_lock(hashtext('wattwatchers-meter-register-structured-reconcile-v1'));

CREATE TEMP TABLE ww_meter_register_structured_entry_stage (
  ordinal integer PRIMARY KEY,
  entry_id text NOT NULL UNIQUE,
  master_source_row integer NOT NULL UNIQUE,
  master_source_row_sha256 text NOT NULL,
  current_device_identifier text NOT NULL UNIQUE,
  expected_revision integer NOT NULL
) ON COMMIT DROP;

INSERT INTO ww_meter_register_structured_entry_stage VALUES
${entryValues};

CREATE TEMP TABLE ww_meter_register_structured_field_stage (
  entry_id text NOT NULL REFERENCES ww_meter_register_structured_entry_stage(entry_id),
  field_key text NOT NULL,
  field_value jsonb NOT NULL,
  master_header text NOT NULL,
  PRIMARY KEY (entry_id, field_key)
) ON COMMIT DROP;

INSERT INTO ww_meter_register_structured_field_stage VALUES
${fieldValues};

DO $$
DECLARE
  matched_count integer;
BEGIN
  IF (SELECT count(*) FROM ww_meter_register_structured_entry_stage)
      <> ${expectedRecordCount} THEN
    RAISE EXCEPTION 'Structured reconciliation staged record count changed';
  END IF;
${countAssertionsSql(manifest.expected.fieldUpdateCounts)}

  SELECT count(*) INTO matched_count
  FROM ww_meter_register_structured_entry_stage stage
  JOIN ww_meter_register_entries entry ON entry.id = stage.entry_id
  JOIN ww_meter_register_imports imported ON imported.id = entry.import_id
  JOIN ww_meter_register_records record ON record.entry_id = entry.id
  WHERE imported.source_workbook = ${sqlText(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK)}
    AND imported.source_sheet = ${sqlText(METER_REGISTER_STRUCTURED_MASTER_SHEET)}
    AND imported.workbook_sha256 = ${sqlText(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256)}
    AND entry.source_row = stage.master_source_row
    AND entry.source_row_sha256 = stage.master_source_row_sha256
    AND entry.current_device_identifier = stage.current_device_identifier
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND jsonb_typeof(record.details) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM ww_meter_register_structured_field_stage field
      WHERE field.entry_id = stage.entry_id
        AND NULLIF(btrim(entry.source_payload ->> field.master_header), '') IS NOT NULL
    );

  IF matched_count <> ${expectedRecordCount} THEN
    RAISE EXCEPTION
      'Structured reconciliation provenance/manual guard matched %, expected ${expectedRecordCount}',
      matched_count;
  END IF;
END $$;

CREATE TEMP TABLE ww_meter_register_structured_state ON COMMIT DROP AS
WITH patches AS (
  SELECT field.entry_id, jsonb_object_agg(field.field_key, field.field_value) AS patch
  FROM ww_meter_register_structured_field_stage field
  GROUP BY field.entry_id
)
SELECT
  stage.*,
  patches.patch,
  CASE
    WHEN record.revision = stage.expected_revision
      AND NOT EXISTS (
        SELECT 1
        FROM ww_meter_register_structured_field_stage field
        WHERE field.entry_id = stage.entry_id
          AND NULLIF(btrim(record.details ->> field.field_key), '') IS NOT NULL
      )
      THEN 'pending'
    WHEN record.revision = stage.expected_revision + 1
      AND NOT EXISTS (
        SELECT 1
        FROM ww_meter_register_structured_field_stage field
        WHERE field.entry_id = stage.entry_id
          AND record.details -> field.field_key IS DISTINCT FROM field.field_value
      )
      THEN 'applied'
    ELSE 'invalid'
  END AS reconciliation_state
FROM ww_meter_register_structured_entry_stage stage
JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
JOIN patches ON patches.entry_id = stage.entry_id;

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
  FROM ww_meter_register_structured_state;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'Structured reconciliation found % conflicting or stale records', invalid_count;
  END IF;
  IF NOT (
    (pending_count = ${expectedRecordCount} AND applied_count = 0)
    OR (pending_count = 0 AND applied_count = ${expectedRecordCount})
  ) THEN
    RAISE EXCEPTION
      'Structured reconciliation is partially applied: pending %, applied %, expected ${expectedRecordCount}',
      pending_count, applied_count;
  END IF;
END $$;

CREATE TEMP TABLE ww_meter_register_structured_updated ON COMMIT DROP AS
WITH updated AS (
  UPDATE ww_meter_register_records record
  SET
    details = record.details || state.patch,
    revision = record.revision + 1,
    updated_at = clock_timestamp()
  FROM ww_meter_register_structured_state state
  WHERE record.entry_id = state.entry_id
    AND state.reconciliation_state = 'pending'
    AND record.revision = state.expected_revision
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ww_meter_register_structured_field_stage field
      WHERE field.entry_id = state.entry_id
        AND NULLIF(btrim(record.details ->> field.field_key), '') IS NOT NULL
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
  FROM ww_meter_register_structured_state
  WHERE reconciliation_state = 'pending';
  SELECT count(*) INTO updated_count FROM ww_meter_register_structured_updated;
  IF updated_count <> pending_count THEN
    RAISE EXCEPTION
      'Structured reconciliation updated %, expected pending %', updated_count, pending_count;
  END IF;

  SELECT count(*) INTO verified_count
  FROM ww_meter_register_structured_entry_stage stage
  JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
  WHERE record.revision = stage.expected_revision + 1
    AND record.manually_corrected_at IS NULL
    AND record.updated_by_user_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ww_meter_register_structured_field_stage field
      WHERE field.entry_id = stage.entry_id
        AND record.details -> field.field_key IS DISTINCT FROM field.field_value
    );
  IF verified_count <> ${expectedRecordCount} THEN
    RAISE EXCEPTION
      'Structured reconciliation post-update verification matched %, expected ${expectedRecordCount}',
      verified_count;
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM ww_meter_register_structured_state) AS matched_record_count,
  (
    SELECT count(*) FROM ww_meter_register_structured_state
    WHERE reconciliation_state = 'pending'
  ) AS initially_pending_record_count,
  (
    SELECT count(*) FROM ww_meter_register_structured_state
    WHERE reconciliation_state = 'applied'
  ) AS initially_applied_record_count,
  (SELECT count(*) FROM ww_meter_register_structured_updated) AS updated_record_count,
  ${updatedCountsJsonSql()} AS updated_field_counts,
  ${expectedCountsJsonSql(manifest.expected.fieldUpdateCounts)} AS expected_field_counts,
  (
    SELECT count(*)
    FROM ww_meter_register_structured_entry_stage stage
    JOIN ww_meter_register_records record ON record.entry_id = stage.entry_id
    WHERE record.revision = stage.expected_revision + 1
      AND record.manually_corrected_at IS NULL
      AND record.updated_by_user_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ww_meter_register_structured_field_stage field
        WHERE field.entry_id = stage.entry_id
          AND record.details -> field.field_key IS DISTINCT FROM field.field_value
      )
  ) AS verified_record_count,
  ${input.mode === 'apply' ? 'true' : 'false'}::boolean AS apply_mode;

${finish}
`;

  return {
    sql,
    recordUpdateCount: expectedRecordCount,
    fieldUpdateCounts: manifest.expected.fieldUpdateCounts,
  };
}
