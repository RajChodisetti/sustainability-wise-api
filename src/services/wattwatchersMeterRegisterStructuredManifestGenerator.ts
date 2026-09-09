import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import {
  METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT,
  METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT,
} from './wattwatchersMeterRegisterInvoiceReconciliation.js';
import {
  assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit,
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT,
  METER_REGISTER_STRUCTURED_MASTER_SHEET,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
  METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
  METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE,
  METER_REGISTER_STRUCTURED_QA_DATABASE,
  METER_REGISTER_STRUCTURED_QA_SNAPSHOT_SCHEMA,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
  METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
  METER_REGISTER_STRUCTURED_WORKS_SHEET,
  METER_REGISTER_STRUCTURED_WORKS_WORKBOOK,
  METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
  parseWattwatchersMeterRegisterStructuredManifest,
  type WattwatchersMeterRegisterStructuredFieldCounts,
  type WattwatchersMeterRegisterStructuredFieldKey,
  type WattwatchersMeterRegisterStructuredManifest,
  wattwatchersMeterRegisterStructuredAuditedFieldCounts,
} from './wattwatchersMeterRegisterStructuredReconciliation.js';
import {
  assertWattwatchersMeterRegisterReconciliationTargetBinding,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA,
  WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH,
  type WattwatchersMeterRegisterReconciliationTarget,
} from './wattwatchersMeterRegisterReconciliationTarget.js';
import { MASTER_REGISTER_EXPECTED_SUMMARY } from './wattwatchersMeterRegisterImportSql.js';

export {
  METER_REGISTER_STRUCTURED_QA_DATABASE,
  METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA,
  METER_REGISTER_STRUCTURED_QA_SNAPSHOT_SCHEMA,
};
export const METER_REGISTER_STRUCTURED_OUTCOME_LEDGER_SCHEMA =
  'wattwatchers-meter-register-structured-outcome-ledger/v2';
export const METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT = 1_440;

export const METER_REGISTER_STRUCTURED_EXCLUSION_REASONS = [
  'live_nonblank',
  'manual_or_actor',
  'missing_join',
  'duplicate_join',
  'immutable_source_nonblank',
] as const;

type StructuredExclusionReason = typeof METER_REGISTER_STRUCTURED_EXCLUSION_REASONS[number];
type LiveNonblankKind = 'already_matches' | 'conflicting_nonblank';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const identityFingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const tableOidSchema = z.string().regex(/^[1-9][0-9]*$/u);
const approvedDeviceIdentifierSchema = z.string().regex(/^[A-Z0-9]{13}$/u);
const nonblankCurrentIdentifierSchema = z.string().refine(
  (value) => value.trim().length > 0,
  'current device identifier must not be blank',
);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const FIELD_KEYS = Object.keys(
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT,
) as WattwatchersMeterRegisterStructuredFieldKey[];
const FIELD_ORDER = new Map(FIELD_KEYS.map((key, index) => [key, index]));
const TARGET_TO_KEY = Object.fromEntries(FIELD_KEYS.map((key) => [
  METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key].auditTargetField,
  key,
])) as Record<string, WattwatchersMeterRegisterStructuredFieldKey>;

const projectedValuesSchema = z.object({
  invoiceNumber: jsonValueSchema,
  status: jsonValueSchema,
  serviceType: jsonValueSchema,
  meteringSolutionType: jsonValueSchema,
  meterType: jsonValueSchema,
  fergusJobNumber: jsonValueSchema,
  quoteNumber: jsonValueSchema,
  purchaseOrderNumber: jsonValueSchema,
  jobCompletionDate: jsonValueSchema,
  jobCompletedBy: jsonValueSchema,
  hardwareInstalled: jsonValueSchema,
  maas: jsonValueSchema,
  invoiceIssuedDate: jsonValueSchema,
  comments: jsonValueSchema,
}).strict();

const immutableProjectedValueSchema = z.object({
  snapshot: jsonValueSchema,
  payload: jsonValueSchema,
}).strict();
const immutableValuesSchema = z.object({
  invoiceNumber: immutableProjectedValueSchema,
  status: immutableProjectedValueSchema,
  serviceType: immutableProjectedValueSchema,
  meteringSolutionType: immutableProjectedValueSchema,
  meterType: immutableProjectedValueSchema,
  fergusJobNumber: immutableProjectedValueSchema,
  quoteNumber: immutableProjectedValueSchema,
  purchaseOrderNumber: immutableProjectedValueSchema,
  jobCompletionDate: immutableProjectedValueSchema,
  jobCompletedBy: immutableProjectedValueSchema,
  hardwareInstalled: immutableProjectedValueSchema,
  maas: immutableProjectedValueSchema,
  invoiceIssuedDate: immutableProjectedValueSchema,
  comments: immutableProjectedValueSchema,
}).strict();

const snapshotRowSchema = z.object({
  databaseName: z.enum([
    METER_REGISTER_STRUCTURED_QA_DATABASE,
    METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE,
  ]),
  databaseUser: z.string().min(1),
  databaseSchemaName: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_DATABASE_SCHEMA),
  currentSchemaName: z.literal('pg_catalog'),
  searchPath: z.literal(WATTWATCHERS_METER_REGISTER_RECONCILIATION_SEARCH_PATH),
  tableOids: z.object({
    imports: tableOidSchema,
    entries: tableOidSchema,
    records: tableOidSchema,
  }).strict(),
  importId: z.string().min(1),
  sourceWorkbook: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK),
  sourceSheet: z.literal(METER_REGISTER_STRUCTURED_MASTER_SHEET),
  workbookSha256: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256),
  importSourceRowCount: z.literal(MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount),
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u),
  entryImportId: z.string().min(1),
  sourceKey: z.string().min(1),
  sourceRow: z.number().int().min(4),
  sourceRowSha256: sha256Schema,
  currentDeviceIdentifier: nonblankCurrentIdentifierSchema.nullable(),
  recordRevision: z.number().int().positive().nullable(),
  recordManuallyCorrectedAt: z.string().min(1).nullable(),
  recordUpdatedByUserId: z.string().min(1).nullable(),
  immutableValues: immutableValuesSchema,
  liveValues: projectedValuesSchema,
}).strict().superRefine((row, context) => {
  const hasRecord = row.recordRevision !== null;
  if (row.entryImportId !== row.importId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entryImportId'],
      message: 'entry import binding must match the selected import',
    });
  }
  if (!hasRecord && (row.recordManuallyCorrectedAt !== null
      || row.recordUpdatedByUserId !== null
      || Object.values(row.liveValues).some((value) => value !== null))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'record state must be wholly present or wholly absent',
    });
  }
});

const snapshotSchema = z.object({
  schema: z.literal(METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA),
  target: z.enum(['qa', 'production']),
  database: z.enum([
    METER_REGISTER_STRUCTURED_QA_DATABASE,
    METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE,
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
    workbook: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK),
    sheet: z.literal(METER_REGISTER_STRUCTURED_MASTER_SHEET),
    workbookSha256: z.literal(METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256),
  }).strict(),
  rowCount: z.literal(MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount),
  rows: z.array(snapshotRowSchema),
}).strict().superRefine((snapshot, context) => {
  try {
    assertWattwatchersMeterRegisterReconciliationTargetBinding(snapshot);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'invalid target binding',
    });
  }
  if (snapshot.rowCount !== snapshot.rows.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rowCount'],
      message: 'snapshot rowCount must equal rows length',
    });
  }
});

const sourceAuditMasterSchema = z.object({
  sheet: z.literal(METER_REGISTER_STRUCTURED_MASTER_SHEET),
  source_row: z.number().int().min(4),
  audit_row_sha256: sha256Schema,
  cached_values_sha256: sha256Schema,
  formula_values_sha256: sha256Schema,
}).strict();
const sourceAuditEvidenceSchema = z.object({
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
  works_evidence: z.array(sourceAuditEvidenceSchema).min(1),
}).strict();
const predecessorInvoiceCandidateSchema = z.object({
  decision: z.literal('safe_auto_fill'),
  decision_rule: z.literal('S1'),
  device_id: approvedDeviceIdentifierSchema,
  target_field: z.literal('xeroInvoiceNumber'),
  value: z.string().regex(/^INV-[A-Z0-9][A-Z0-9./_-]*$/u),
  master: sourceAuditMasterSchema,
}).passthrough();
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
  safe_invoice_fills: z.array(z.unknown()),
  safe_other_fills: z.array(z.unknown()),
}).passthrough();

type Snapshot = z.infer<typeof snapshotSchema>;
type SnapshotRow = z.infer<typeof snapshotRowSchema>;
type SourceAuditCandidate = z.infer<typeof sourceAuditCandidateSchema>;

type ApprovedCandidate = {
  sourceOrdinal: number;
  sourceCandidateSha256: string;
  key: WattwatchersMeterRegisterStructuredFieldKey;
  candidate: SourceAuditCandidate;
};

const structuredFieldKeySchema = z.enum([
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
]);
const structuredFieldCountsSchema = z.object({
  status: z.number().int().nonnegative(),
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
  comments: z.number().int().nonnegative(),
}).strict();
const exclusionCountsSchema = z.object({
  live_nonblank: z.number().int().nonnegative(),
  manual_or_actor: z.number().int().nonnegative(),
  missing_join: z.number().int().nonnegative(),
  duplicate_join: z.number().int().nonnegative(),
  immutable_source_nonblank: z.number().int().nonnegative(),
}).strict();
const structuredLedgerEntrySchema = z.object({
  sourceOrdinal: z.number().int().positive(),
  sourceCandidateSha256: sha256Schema,
  fieldKey: structuredFieldKeySchema,
  currentDeviceIdentifier: approvedDeviceIdentifierSchema,
  masterSourceRow: z.number().int().min(4),
  value: z.union([z.string(), z.boolean()]),
  outcome: z.enum(['selected', 'excluded']),
  exclusionReason: z.enum(METER_REGISTER_STRUCTURED_EXCLUSION_REASONS).nullable(),
  liveNonblankKind: z.enum(['already_matches', 'conflicting_nonblank']).nullable(),
  entryId: z.string().regex(/^wwmre_[a-f0-9]{32}$/u).nullable(),
  expectedRevision: z.number().int().positive().nullable(),
}).strict().superRefine((entry, context) => {
  if (entry.outcome === 'selected') {
    if (entry.exclusionReason !== null || entry.liveNonblankKind !== null
      || entry.entryId === null || entry.expectedRevision === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected ledger entries must carry DB identity and no exclusion state',
      });
    }
  } else if (entry.exclusionReason === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['exclusionReason'],
      message: 'excluded ledger entries must state an exclusion reason',
    });
  }
  if ((entry.exclusionReason === 'live_nonblank') !== (entry.liveNonblankKind !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['liveNonblankKind'],
      message: 'live nonblank entries must retain exactly one live-value distinction',
    });
  }
});

const outcomeLedgerSchema = z.object({
  schema: z.literal(METER_REGISTER_STRUCTURED_OUTCOME_LEDGER_SCHEMA),
  sources: z.object({
    sourceAuditSha256: z.literal(METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256),
    dbSnapshot: z.object({
      target: z.enum(['qa', 'production']),
      database: z.enum([
        METER_REGISTER_STRUCTURED_QA_DATABASE,
        METER_REGISTER_STRUCTURED_PRODUCTION_DATABASE,
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
      schema: z.literal(METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA),
      sha256: sha256Schema,
    }).strict().superRefine((binding, context) => {
      try {
        assertWattwatchersMeterRegisterReconciliationTargetBinding(binding);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : 'invalid target binding',
        });
      }
    }),
    manifestSha256: sha256Schema,
  }).strict(),
  expected: z.object({
    approvedFieldCount: z.literal(METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT),
    approvedFieldCounts: structuredFieldCountsSchema,
  }).strict(),
  outcome: z.object({
    selectedRecordCount: z.number().int().nonnegative(),
    selectedFieldCount: z.number().int().nonnegative(),
    excludedFieldCount: z.number().int().nonnegative(),
    selectedFieldCounts: structuredFieldCountsSchema,
    excludedFieldCounts: structuredFieldCountsSchema,
    exclusionCounts: exclusionCountsSchema,
    alreadyMatchesCount: z.number().int().nonnegative(),
    conflictingNonblankCount: z.number().int().nonnegative(),
  }).strict(),
  candidates: z.array(structuredLedgerEntrySchema)
    .length(METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT),
}).strict().superRefine((ledger, context) => {
  const auditedCounts = wattwatchersMeterRegisterStructuredAuditedFieldCounts();
  const selectedCounts = emptyFieldCounts();
  const excludedCounts = emptyFieldCounts();
  const exclusions = exclusionCounts();
  const ordinals = new Set<number>();
  const fingerprints = new Set<string>();
  const selectedEntries = new Set<string>();
  let alreadyMatchesCount = 0;
  let conflictingNonblankCount = 0;

  for (const candidate of ledger.candidates) {
    if (ordinals.has(candidate.sourceOrdinal)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: 'outcome ledger repeats a source ordinal',
      });
    }
    if (fingerprints.has(candidate.sourceCandidateSha256)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: 'outcome ledger repeats a source candidate fingerprint',
      });
    }
    ordinals.add(candidate.sourceOrdinal);
    fingerprints.add(candidate.sourceCandidateSha256);
    if (candidate.outcome === 'selected') {
      selectedCounts[candidate.fieldKey] += 1;
      if (candidate.entryId !== null) selectedEntries.add(candidate.entryId);
    } else {
      excludedCounts[candidate.fieldKey] += 1;
      if (candidate.exclusionReason !== null) exclusions[candidate.exclusionReason] += 1;
      if (candidate.liveNonblankKind === 'already_matches') alreadyMatchesCount += 1;
      if (candidate.liveNonblankKind === 'conflicting_nonblank') {
        conflictingNonblankCount += 1;
      }
    }
  }

  const selectedFieldCount = Object.values(selectedCounts).reduce((sum, value) => sum + value, 0);
  const excludedFieldCount = Object.values(excludedCounts).reduce((sum, value) => sum + value, 0);
  if (selectedFieldCount + excludedFieldCount !== METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'outcome ledger is incomplete' });
  }
  for (const key of FIELD_KEYS) {
    if (ledger.expected.approvedFieldCounts[key] !== auditedCounts[key]
      || selectedCounts[key] + excludedCounts[key] !== auditedCounts[key]
      || ledger.outcome.selectedFieldCounts[key] !== selectedCounts[key]
      || ledger.outcome.excludedFieldCounts[key] !== excludedCounts[key]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: `outcome ledger ${key} counts do not reconcile`,
      });
    }
  }
  if (ledger.outcome.selectedRecordCount !== selectedEntries.size
    || ledger.outcome.selectedFieldCount !== selectedFieldCount
    || ledger.outcome.excludedFieldCount !== excludedFieldCount
    || ledger.outcome.alreadyMatchesCount !== alreadyMatchesCount
    || ledger.outcome.conflictingNonblankCount !== conflictingNonblankCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outcome'],
      message: 'outcome ledger totals do not reconcile',
    });
  }
  for (const reason of METER_REGISTER_STRUCTURED_EXCLUSION_REASONS) {
    if (ledger.outcome.exclusionCounts[reason] !== exclusions[reason]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome', 'exclusionCounts', reason],
        message: 'outcome ledger exclusion totals do not reconcile',
      });
    }
  }
});

export type WattwatchersMeterRegisterStructuredLedgerEntry =
  z.infer<typeof structuredLedgerEntrySchema>;
export type WattwatchersMeterRegisterStructuredOutcomeLedger =
  z.infer<typeof outcomeLedgerSchema>;

export type GeneratedWattwatchersMeterRegisterStructuredArtifacts = {
  manifest: WattwatchersMeterRegisterStructuredManifest;
  manifestBytes: Buffer;
  manifestSha256: string;
  ledger: WattwatchersMeterRegisterStructuredOutcomeLedger;
  ledgerBytes: Buffer;
  ledgerSha256: string;
};

async function writePrivateTemporaryArtifact(path: string, bytes: Uint8Array): Promise<string> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const output = await open(temporaryPath, 'wx', 0o600);
  try {
    await output.writeFile(bytes);
    await output.sync();
    return temporaryPath;
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    await output.close();
  }
}

async function assertArtifactTargetMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const error = new Error(`Protected artifact target already exists: ${path}`) as
    NodeJS.ErrnoException;
  error.code = 'EEXIST';
  throw error;
}

async function syncArtifactDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function writePrivateWattwatchersMeterRegisterStructuredArtifact(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const temporaryPath = await writePrivateTemporaryArtifact(path, bytes);
  try {
    await link(temporaryPath, path);
    await syncArtifactDirectory(path);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function writePrivateWattwatchersMeterRegisterStructuredArtifacts(input: {
  manifestPath: string;
  manifestBytes: Uint8Array;
  ledgerPath: string;
  ledgerBytes: Uint8Array;
}): Promise<void> {
  if (input.manifestPath === input.ledgerPath) {
    throw new Error('Structured manifest and outcome ledger paths must be distinct');
  }
  await Promise.all([
    assertArtifactTargetMissing(input.manifestPath),
    assertArtifactTargetMissing(input.ledgerPath),
  ]);
  let manifestTemporaryPath: string | undefined;
  let ledgerTemporaryPath: string | undefined;
  try {
    manifestTemporaryPath = await writePrivateTemporaryArtifact(
      input.manifestPath,
      input.manifestBytes,
    );
    ledgerTemporaryPath = await writePrivateTemporaryArtifact(input.ledgerPath, input.ledgerBytes);
    // The manifest is the completion marker. Publishing and syncing the ledger
    // first ensures a crash can expose only an inert ledger, never a manifest
    // whose required ledger was not durably published.
    await link(ledgerTemporaryPath, input.ledgerPath);
    await syncArtifactDirectory(input.ledgerPath);
    await link(manifestTemporaryPath, input.manifestPath);
    await syncArtifactDirectory(input.manifestPath);
  } finally {
    await Promise.allSettled([
      manifestTemporaryPath ? unlink(manifestTemporaryPath) : Promise.resolve(),
      ledgerTemporaryPath ? unlink(ledgerTemporaryPath) : Promise.resolve(),
    ]);
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeSha256(value: string, description: string): string {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '');
  if (!sha256Schema.safeParse(normalized).success) {
    throw new Error(`${description} must be a 64-character SHA-256 digest`);
  }
  return normalized;
}

export function parseWattwatchersMeterRegisterStructuredOutcomeLedger(
  input: unknown,
): WattwatchersMeterRegisterStructuredOutcomeLedger {
  return outcomeLedgerSchema.parse(input);
}

export function assertWattwatchersMeterRegisterStructuredGeneratedArtifactsMatch(input: {
  generated: GeneratedWattwatchersMeterRegisterStructuredArtifacts;
  suppliedManifestBytes: Uint8Array;
  suppliedLedgerBytes: Uint8Array;
}): void {
  if (!Buffer.from(input.suppliedManifestBytes).equals(input.generated.manifestBytes)) {
    throw new Error('Structured reconciliation manifest is not the regenerated approved artifact');
  }
  if (!Buffer.from(input.suppliedLedgerBytes).equals(input.generated.ledgerBytes)) {
    throw new Error('Structured outcome ledger is not the regenerated complete artifact');
  }
}

export function assertWattwatchersMeterRegisterStructuredGeneratorDigests(input: {
  sourceAuditSha256: string;
  dbSnapshotSha256: string;
  expectedDbSnapshotSha256: string;
}): void {
  if (normalizeSha256(input.sourceAuditSha256, 'source audit digest')
      !== METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256) {
    throw new Error('Structured source audit bytes do not match the approved artifact');
  }
  if (normalizeSha256(input.dbSnapshotSha256, 'DB snapshot digest')
      !== normalizeSha256(input.expectedDbSnapshotSha256, 'expected DB snapshot digest')) {
    throw new Error('Database snapshot bytes do not match the independently captured digest');
  }
}

function serializeJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function emptyFieldCounts(): WattwatchersMeterRegisterStructuredFieldCounts {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, 0])) as
    WattwatchersMeterRegisterStructuredFieldCounts;
}

function canonicalSourceCandidate(candidate: SourceAuditCandidate, key: WattwatchersMeterRegisterStructuredFieldKey) {
  return {
    decision: candidate.decision,
    decisionRule: candidate.decision_rule,
    deviceId: candidate.device_id,
    fieldKey: key,
    targetField: candidate.target_field,
    targetMasterHeader: candidate.target_master_header,
    sourceWorksHeader: candidate.source_works_header,
    value: candidate.value,
    master: {
      sheet: candidate.master.sheet,
      sourceRow: candidate.master.source_row,
      auditRowSha256: candidate.master.audit_row_sha256,
      cachedValuesSha256: candidate.master.cached_values_sha256,
      formulaValuesSha256: candidate.master.formula_values_sha256,
    },
    worksEvidence: candidate.works_evidence.map((evidence) => ({
      sheet: evidence.sheet,
      sourceRow: evidence.source_row,
      auditRowSha256: evidence.audit_row_sha256,
      cachedValuesSha256: evidence.cached_values_sha256,
      formulaValuesSha256: evidence.formula_values_sha256,
    })).sort((left, right) => left.sourceRow - right.sourceRow),
  };
}

function approvedSourceCandidates(sourceAuditInput: unknown): ApprovedCandidate[] {
  const sourceAudit = sourceAuditSchema.parse(sourceAuditInput);
  const approved: ApprovedCandidate[] = [];
  const counts = emptyFieldCounts();
  const uniqueFields = new Set<string>();

  for (const [index, rawCandidate] of sourceAudit.safe_other_fills.entries()) {
    if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) continue;
    const rawTarget = (rawCandidate as Record<string, unknown>).target_field;
    if (typeof rawTarget !== 'string' || !TARGET_TO_KEY[rawTarget]) continue;
    const candidate = sourceAuditCandidateSchema.parse(rawCandidate);
    const key = TARGET_TO_KEY[candidate.target_field]!;
    const contract = METER_REGISTER_STRUCTURED_FIELD_CONTRACT[key];
    if (candidate.target_master_header !== contract.masterHeader
      || candidate.source_works_header !== contract.worksHeader) {
      throw new Error('Approved structured candidate headers contradict the field contract');
    }
    const uniquenessKey = `${candidate.device_id}\u0000${key}`;
    if (uniqueFields.has(uniquenessKey)) {
      throw new Error('Approved structured source audit contains a duplicate device field');
    }
    uniqueFields.add(uniquenessKey);
    counts[key] += 1;
    const canonical = canonicalSourceCandidate(candidate, key);
    approved.push({
      sourceOrdinal: index + 1,
      sourceCandidateSha256: sha256(JSON.stringify(canonical)),
      key,
      candidate,
    });
  }

  const auditedCounts = wattwatchersMeterRegisterStructuredAuditedFieldCounts();
  for (const key of FIELD_KEYS) {
    if (counts[key] !== auditedCounts[key]) {
      throw new Error(`Approved structured source audit ${key} count changed`);
    }
  }
  if (approved.length !== METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT) {
    throw new Error('Approved structured source audit candidate total changed');
  }

  const sourceIdentity = new Map<string, string>();
  for (const item of approved) {
    const candidate = item.candidate;
    const identity = JSON.stringify({
      sourceRow: candidate.master.source_row,
      auditRowSha256: candidate.master.audit_row_sha256,
      cachedValuesSha256: candidate.master.cached_values_sha256,
      formulaValuesSha256: candidate.master.formula_values_sha256,
    });
    const existing = sourceIdentity.get(candidate.device_id);
    if (existing !== undefined && existing !== identity) {
      throw new Error('Approved structured source audit has contradictory device provenance');
    }
    sourceIdentity.set(candidate.device_id, identity);
  }
  return approved;
}

function parseSnapshot(input: unknown): Snapshot {
  const snapshot = snapshotSchema.parse(input);
  const entryIds = new Set<string>();
  const sourceRows = new Set<number>();
  const importIds = new Set<string>();
  let currentIdentifierCount = 0;
  let previous: SnapshotRow | undefined;
  for (const row of snapshot.rows) {
    if (row.databaseName !== snapshot.database
      || row.databaseUser !== snapshot.databaseUser
      || row.databaseSchemaName !== snapshot.databaseSchema
      || row.currentSchemaName !== 'pg_catalog'
      || row.searchPath !== snapshot.searchPath
      || row.tableOids.imports !== snapshot.tableOids.imports
      || row.tableOids.entries !== snapshot.tableOids.entries
      || row.tableOids.records !== snapshot.tableOids.records) {
      throw new Error('Database snapshot row target binding does not match its artifact binding');
    }
    if (entryIds.has(row.entryId)) {
      throw new Error('Database snapshot contains a duplicate entry identifier');
    }
    if (sourceRows.has(row.sourceRow)) {
      throw new Error('Database snapshot contains a duplicate Master source row');
    }
    entryIds.add(row.entryId);
    sourceRows.add(row.sourceRow);
    importIds.add(row.importId);
    if (row.currentDeviceIdentifier !== null) currentIdentifierCount += 1;
    if (previous && (row.sourceRow < previous.sourceRow
      || row.sourceRow === previous.sourceRow && row.entryId <= previous.entryId)) {
      throw new Error('Database snapshot ordering contradicts the pinned query');
    }
    previous = row;
  }
  if (importIds.size !== 1) {
    throw new Error('Database snapshot must contain exactly one pinned import');
  }
  if (currentIdentifierCount !== MASTER_REGISTER_EXPECTED_SUMMARY.sourceRowCount
      - MASTER_REGISTER_EXPECTED_SUMMARY.rowsWithoutCurrentIdentifier) {
    throw new Error('Database snapshot current-identifier coverage changed');
  }
  return snapshot;
}

function isDatabaseBlank(value: unknown): boolean {
  return value === null || typeof value === 'string' && value.trim() === '';
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertInvoiceReconciliationPredecessor(
  sourceAuditInput: unknown,
  snapshot: Snapshot,
): void {
  const sourceAudit = sourceAuditSchema.parse(sourceAuditInput);
  const invoices = sourceAudit.safe_invoice_fills.map((candidate) => (
    predecessorInvoiceCandidateSchema.parse(candidate)
  ));
  if (invoices.length !== METER_REGISTER_RECONCILIATION_APPROVED_CANDIDATE_COUNT) {
    throw new Error('Structured reconciliation requires the complete approved invoice predecessor');
  }

  const rowsByDevice = new Map<string, SnapshotRow[]>();
  for (const row of snapshot.rows) {
    if (row.currentDeviceIdentifier === null) continue;
    const rows = rowsByDevice.get(row.currentDeviceIdentifier) ?? [];
    rows.push(row);
    rowsByDevice.set(row.currentDeviceIdentifier, rows);
  }
  const invoiceByDevice = new Map<string, z.infer<typeof predecessorInvoiceCandidateSchema>>();
  const invoiceMasterRows = new Set<number>();
  for (const invoice of invoices) {
    if (invoiceByDevice.has(invoice.device_id)
      || invoiceMasterRows.has(invoice.master.source_row)) {
      throw new Error('Structured reconciliation invoice predecessor identity is not unique');
    }
    invoiceByDevice.set(invoice.device_id, invoice);
    invoiceMasterRows.add(invoice.master.source_row);
    const rows = rowsByDevice.get(invoice.device_id) ?? [];
    const row = rows.length === 1 ? rows[0]! : null;
    if (!row
      || row.sourceRow !== invoice.master.source_row
      || row.sourceRowSha256 !== invoice.master.cached_values_sha256
      || row.recordRevision === null
      || row.recordManuallyCorrectedAt !== null
      || row.recordUpdatedByUserId !== null
      || !isDatabaseBlank(row.immutableValues.invoiceNumber.snapshot)
      || !isDatabaseBlank(row.immutableValues.invoiceNumber.payload)
      || !sameJsonValue(row.liveValues.invoiceNumber, invoice.value)) {
      throw new Error(
        'Structured reconciliation requires all approved invoices in the fresh DB snapshot',
      );
    }
  }

  const invoiceDates = sourceAudit.safe_other_fills
    .filter((candidate) => candidate && typeof candidate === 'object'
      && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).target_field === 'invoice_issued_date')
    .map((candidate) => sourceAuditCandidateSchema.parse(candidate))
    .filter((candidate) => invoiceByDevice.has(candidate.device_id));
  if (invoiceDates.length !== METER_REGISTER_RECONCILIATION_APPROVED_DATE_COUNT) {
    throw new Error('Structured reconciliation requires the approved invoice-date predecessor');
  }
  const invoiceDate = invoiceDates[0]!;
  const invoice = invoiceByDevice.get(invoiceDate.device_id)!;
  const rows = rowsByDevice.get(invoiceDate.device_id) ?? [];
  const row = rows.length === 1 ? rows[0]! : null;
  if (!row
    || invoiceDate.master.source_row !== invoice.master.source_row
    || invoiceDate.master.cached_values_sha256 !== invoice.master.cached_values_sha256
    || !isDatabaseBlank(row.immutableValues.invoiceIssuedDate.snapshot)
    || !isDatabaseBlank(row.immutableValues.invoiceIssuedDate.payload)
    || !sameJsonValue(row.liveValues.invoiceIssuedDate, invoiceDate.value)) {
    throw new Error(
      'Structured reconciliation requires the approved invoice date in the fresh DB snapshot',
    );
  }
}

function exclusionCounts(): Record<StructuredExclusionReason, number> {
  return Object.fromEntries(METER_REGISTER_STRUCTURED_EXCLUSION_REASONS.map((reason) => [
    reason,
    0,
  ])) as Record<StructuredExclusionReason, number>;
}

type Classified = {
  approved: ApprovedCandidate;
  row: SnapshotRow | null;
  reason: StructuredExclusionReason | null;
  liveNonblankKind: LiveNonblankKind | null;
};

function classifyCandidates(approved: ApprovedCandidate[], snapshot: Snapshot): Classified[] {
  const rowsByDevice = new Map<string, SnapshotRow[]>();
  for (const row of snapshot.rows) {
    if (row.currentDeviceIdentifier === null) continue;
    const rows = rowsByDevice.get(row.currentDeviceIdentifier) ?? [];
    rows.push(row);
    rowsByDevice.set(row.currentDeviceIdentifier, rows);
  }

  return approved.map((item) => {
    const candidate = item.candidate;
    const rows = rowsByDevice.get(candidate.device_id) ?? [];
    if (rows.length === 0) {
      return { approved: item, row: null, reason: 'missing_join', liveNonblankKind: null };
    }
    if (rows.length !== 1) {
      return { approved: item, row: null, reason: 'duplicate_join', liveNonblankKind: null };
    }
    const row = rows[0]!;
    if (row.sourceRow !== candidate.master.source_row
      || row.sourceRowSha256 !== candidate.master.cached_values_sha256) {
      throw new Error('Database snapshot provenance contradicts the pinned source audit');
    }
    if (row.recordRevision === null) {
      return { approved: item, row, reason: 'missing_join', liveNonblankKind: null };
    }
    const immutableValue = row.immutableValues[item.key];
    if (!isDatabaseBlank(immutableValue.snapshot) || !isDatabaseBlank(immutableValue.payload)) {
      return {
        approved: item,
        row,
        reason: 'immutable_source_nonblank',
        liveNonblankKind: null,
      };
    }
    if (row.recordManuallyCorrectedAt !== null || row.recordUpdatedByUserId !== null) {
      return { approved: item, row, reason: 'manual_or_actor', liveNonblankKind: null };
    }
    const liveValue = row.liveValues[item.key];
    if (!isDatabaseBlank(liveValue)) {
      return {
        approved: item,
        row,
        reason: 'live_nonblank',
        liveNonblankKind: sameJsonValue(liveValue, candidate.value)
          ? 'already_matches'
          : 'conflicting_nonblank',
      };
    }
    return { approved: item, row, reason: null, liveNonblankKind: null };
  });
}

export function generateWattwatchersMeterRegisterStructuredArtifacts(input: {
  sourceAudit: unknown;
  sourceAuditSha256: string;
  dbSnapshot: unknown;
  dbSnapshotSha256: string;
  expectedTarget: WattwatchersMeterRegisterReconciliationTarget;
  expectedDatabaseIdentitySha256: string;
}): GeneratedWattwatchersMeterRegisterStructuredArtifacts {
  const sourceAuditSha256 = normalizeSha256(input.sourceAuditSha256, 'source audit digest');
  if (sourceAuditSha256 !== METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256) {
    throw new Error('Structured source audit digest is not the approved artifact');
  }
  const dbSnapshotSha256 = normalizeSha256(input.dbSnapshotSha256, 'DB snapshot digest');
  const approved = approvedSourceCandidates(input.sourceAudit);
  const snapshot = parseSnapshot(input.dbSnapshot);
  if (snapshot.target !== input.expectedTarget) {
    throw new Error('DB snapshot target does not match the explicitly requested target');
  }
  if (snapshot.databaseIdentitySha256 !== input.expectedDatabaseIdentitySha256) {
    throw new Error('DB snapshot identity does not match the protected target identity');
  }
  assertInvoiceReconciliationPredecessor(input.sourceAudit, snapshot);
  const classified = classifyCandidates(approved, snapshot);

  const selectedByEntry = new Map<string, {
    row: SnapshotRow;
    approved: ApprovedCandidate[];
  }>();
  for (const item of classified) {
    if (item.reason !== null || item.row === null) continue;
    const grouped = selectedByEntry.get(item.row.entryId) ?? { row: item.row, approved: [] };
    grouped.approved.push(item.approved);
    selectedByEntry.set(item.row.entryId, grouped);
  }

  const selectedFieldCounts = emptyFieldCounts();
  const candidates = [...selectedByEntry.values()]
    .sort((left, right) => left.row.sourceRow - right.row.sourceRow
      || left.row.entryId.localeCompare(right.row.entryId))
    .map(({ row, approved: selected }) => {
      const first = selected[0]!.candidate;
      const fields = [...selected]
        .sort((left, right) => FIELD_ORDER.get(left.key)! - FIELD_ORDER.get(right.key)!)
        .map(({ key, candidate }) => {
          selectedFieldCounts[key] += 1;
          return {
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
            })).sort((left, right) => left.sourceRow - right.sourceRow),
          };
        });
      return {
        entryId: row.entryId,
        masterSourceRow: row.sourceRow,
        masterSourceRowSha256: row.sourceRowSha256,
        masterAuditRowSha256: first.master.audit_row_sha256,
        masterCachedValuesSha256: first.master.cached_values_sha256,
        masterFormulaValuesSha256: first.master.formula_values_sha256,
        currentDeviceIdentifier: first.device_id,
        expectedRevision: row.recordRevision!,
        expectedUpdatedByUserId: null,
        expectedManuallyCorrectedAt: null,
        fields,
      };
    });

  const manifest = parseWattwatchersMeterRegisterStructuredManifest({
    schemaVersion: 3,
    sources: {
      masterRegister: {
        workbook: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK,
        workbookSha256: METER_REGISTER_STRUCTURED_MASTER_WORKBOOK_SHA256,
        sheet: METER_REGISTER_STRUCTURED_MASTER_SHEET,
      },
      worksPlanning: {
        workbook: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK,
        workbookSha256: METER_REGISTER_STRUCTURED_WORKS_WORKBOOK_SHA256,
        sheet: METER_REGISTER_STRUCTURED_WORKS_SHEET,
      },
      sourceAudit: {
        schema: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SCHEMA,
        sha256: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_SHA256,
        repositoryCommit: METER_REGISTER_STRUCTURED_SOURCE_AUDIT_COMMIT,
        auditedFieldCounts: wattwatchersMeterRegisterStructuredAuditedFieldCounts(),
      },
      dbSnapshot: {
        schema: METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA,
        target: snapshot.target,
        database: snapshot.database,
        databaseSchema: snapshot.databaseSchema,
        searchPath: snapshot.searchPath,
        databaseUser: snapshot.databaseUser,
        databaseIdentitySha256: snapshot.databaseIdentitySha256,
        tableOids: snapshot.tableOids,
        sha256: dbSnapshotSha256,
      },
    },
    expected: {
      recordUpdateCount: candidates.length,
      fieldUpdateCounts: selectedFieldCounts,
    },
    candidates,
  });
  assertWattwatchersMeterRegisterStructuredManifestMatchesSourceAudit(
    manifest,
    input.sourceAudit,
  );
  const manifestBytes = serializeJson(manifest);
  const manifestSha256 = sha256(manifestBytes);

  const excludedFieldCounts = emptyFieldCounts();
  const excludedCounts = exclusionCounts();
  let alreadyMatchesCount = 0;
  let conflictingNonblankCount = 0;
  const ledgerCandidates = classified.map((item): WattwatchersMeterRegisterStructuredLedgerEntry => {
    const selected = item.reason === null;
    if (!selected) {
      excludedFieldCounts[item.approved.key] += 1;
      excludedCounts[item.reason!] += 1;
      if (item.liveNonblankKind === 'already_matches') alreadyMatchesCount += 1;
      if (item.liveNonblankKind === 'conflicting_nonblank') conflictingNonblankCount += 1;
    }
    return {
      sourceOrdinal: item.approved.sourceOrdinal,
      sourceCandidateSha256: item.approved.sourceCandidateSha256,
      fieldKey: item.approved.key,
      currentDeviceIdentifier: item.approved.candidate.device_id,
      masterSourceRow: item.approved.candidate.master.source_row,
      value: item.approved.candidate.value,
      outcome: selected ? 'selected' : 'excluded',
      exclusionReason: item.reason,
      liveNonblankKind: item.liveNonblankKind,
      entryId: item.row?.entryId ?? null,
      expectedRevision: item.row?.recordRevision ?? null,
    };
  });
  const selectedFieldCount = Object.values(selectedFieldCounts).reduce((sum, value) => sum + value, 0);
  const excludedFieldCount = Object.values(excludedFieldCounts).reduce((sum, value) => sum + value, 0);
  if (ledgerCandidates.length !== METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT
    || selectedFieldCount + excludedFieldCount !== METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT) {
    throw new Error('Structured outcome ledger is not complete');
  }

  const ledger = parseWattwatchersMeterRegisterStructuredOutcomeLedger({
    schema: METER_REGISTER_STRUCTURED_OUTCOME_LEDGER_SCHEMA,
    sources: {
      sourceAuditSha256,
      dbSnapshot: {
        schema: METER_REGISTER_STRUCTURED_DB_SNAPSHOT_SCHEMA,
        target: snapshot.target,
        database: snapshot.database,
        databaseSchema: snapshot.databaseSchema,
        searchPath: snapshot.searchPath,
        databaseUser: snapshot.databaseUser,
        databaseIdentitySha256: snapshot.databaseIdentitySha256,
        tableOids: snapshot.tableOids,
        sha256: dbSnapshotSha256,
      },
      manifestSha256,
    },
    expected: {
      approvedFieldCount: METER_REGISTER_STRUCTURED_APPROVED_FIELD_COUNT,
      approvedFieldCounts: wattwatchersMeterRegisterStructuredAuditedFieldCounts(),
    },
    outcome: {
      selectedRecordCount: manifest.expected.recordUpdateCount,
      selectedFieldCount,
      excludedFieldCount,
      selectedFieldCounts,
      excludedFieldCounts,
      exclusionCounts: excludedCounts,
      alreadyMatchesCount,
      conflictingNonblankCount,
    },
    candidates: ledgerCandidates,
  });
  const ledgerBytes = serializeJson(ledger);
  return {
    manifest,
    manifestBytes,
    manifestSha256,
    ledger,
    ledgerBytes,
    ledgerSha256: sha256(ledgerBytes),
  };
}
