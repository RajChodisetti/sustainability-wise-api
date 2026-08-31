import { createHash } from 'node:crypto';

export const WATTWATCHERS_METER_REGISTER_WORKBOOK = 'Master Register (1).xlsx';
export const WATTWATCHERS_METER_REGISTER_SHEET = 'Master Project Register';

/**
 * The workbook contains two columns with the same visible heading. The JSON
 * extractor keeps them positional by suffixing the second occurrence with
 * `__2`; these constants make that distinction an explicit import contract.
 */
export const WATTWATCHERS_METER_REGISTER_FIELDS = {
  status: 'Status',
  customerName: 'Customer Name',
  clientName: 'Client Name',
  siteAddress: 'Site Address',
  state: 'State',
  serviceType: 'Service Type',
  meteringSolutionType: 'Metering Solution Type',
  meterType: 'Meter Type',
  fergusJobNumber: 'Fergus Job #',
  quoteNumber: 'Quote #',
  purchaseOrderNumber: 'PO Number',
  jobCompletionDate: 'Job Completion Date',
  jobCompletedBy: 'Job Completed By',
  existingDeviceId: 'Existing Device ID',
  newDeviceId: 'New Device ID',
  hardwareInstalled: 'Hardware Installed',
  maasIndicator: 'MaaS (Yes/No)',
  maasStartDate: 'MaaS Start Date',
  maasTerm: 'MaaS Term',
  maasReportingRequired: 'MaaS reporting required (Y/N)',
  dataIndicator: 'Data (Yes/No)',
  wattwatchersProductName: 'Product name (WW)',
  xeroInvoiceNumber: 'Xero Invoice #',
  meterCost: 'Meter Cost (EXC.GST)',
  meteringRecurringFee: 'Metering Recurring Fee (EXC. GST)',
  otherInvoiceCosts: 'Other costs in invoice (if any)',
  invoiceAmount: 'Invoice Amount (EXC.GST)',
  recurringFeePurchaseOrder: 'Recurring fee PO (if any)',
  invoicingClientContact: 'Invoicing Client Contact',
  comments: 'Comments',
  recurringStartDate: 'Recurring Start Date',
  recurringFrequency: 'Recurring Frequency',
  nextInvoiceIssueDate: 'Next Invoice Issue Date',
  invoiceIssuedDate: 'Inv issued date',
  period: 'Period',
  nextInvoiceIssueDate2: 'Next Invoice Issue Date__2',
} as const;

export type MeterRegisterJsonValue =
  | null
  | boolean
  | number
  | string
  | MeterRegisterJsonValue[]
  | { [key: string]: MeterRegisterJsonValue };

export type ExtractedMeterRegisterRow = {
  sourceRow: number;
  values: Record<string, unknown>;
};

export type MeterRegisterIdentifierClassification =
  | 'absent'
  | 'confirmed_wattwatchers'
  | 'candidate_wattwatchers'
  | 'other_hardware';

export type MeterRegisterIdentifierPosition = 'existing' | 'new';

export type MeterRegisterCurrentIdentifierSource = MeterRegisterIdentifierPosition | null;

export type MeterRegisterNormalizationOptions = {
  sourceWorkbookSha256: string;
  authoritativeWattwatchersIds: Iterable<string>;
  sourceWorkbook?: string;
  sourceSheet?: string;
};

export type NormalizedMeterRegisterRow = {
  sourceWorkbook: string;
  workbookSha256: string;
  sourceSheet: string;
  sourceRow: number;
  sourceNamespace: string;
  sourceRowSha256: string;
  sourceKey: string;
  rawValues: Record<string, MeterRegisterJsonValue>;
  statusSnapshot: string | null;
  customerNameSnapshot: string | null;
  clientNameSnapshot: string | null;
  siteAddressSnapshot: string | null;
  siteStateSnapshot: string | null;
  serviceTypeSnapshot: string | null;
  meteringSolutionTypeSnapshot: string | null;
  meterTypeSnapshot: string | null;
  fergusJobNumberSnapshot: string | null;
  quoteNumberSnapshot: string | null;
  purchaseOrderNumberSnapshot: string | null;
  jobCompletionDate: string | null;
  jobCompletedBySnapshot: string | null;
  existingDeviceIdentifier: string | null;
  existingDeviceClassification: MeterRegisterIdentifierClassification;
  newDeviceIdentifier: string | null;
  newDeviceClassification: MeterRegisterIdentifierClassification;
  currentDeviceIdentifier: string | null;
  currentDeviceClassification: MeterRegisterIdentifierClassification;
  currentDeviceIdentifierSource: MeterRegisterCurrentIdentifierSource;
  hardwareInstalledSnapshot: string | null;
  maas: boolean | null;
  maasStartDate: string | null;
  maasTermSnapshot: string | null;
  maasReportingRequired: boolean | null;
  dataEnabled: boolean | null;
  productNameSnapshot: string | null;
  xeroInvoiceNumberSnapshot: string | null;
  meterCostExGstCents: number | null;
  meteringRecurringFeeExGstCents: number | null;
  otherInvoiceCostsExGstCents: number | null;
  invoiceAmountExGstCents: number | null;
  recurringFeePoSnapshot: string | null;
  invoicingClientContactSnapshot: string | null;
  commentsSnapshot: string | null;
  recurringStartDate: string | null;
  recurringFrequencySnapshot: string | null;
  recurringNextInvoiceIssueDate: string | null;
  invoiceIssuedDate: string | null;
  billingPeriodSnapshot: string | null;
  issuedPeriodNextInvoiceIssueDate: string | null;
};

export type ProjectedMeterRegisterIdentifierOccurrence = {
  sourceKey: string;
  sourceRow: number;
  position: MeterRegisterIdentifierPosition;
};

export type ProjectedMeterRegisterIdentifier = {
  externalDeviceId: string;
  classification: Exclude<MeterRegisterIdentifierClassification, 'absent'>;
  occurrences: ProjectedMeterRegisterIdentifierOccurrence[];
};

export type MeterRegisterClassificationCounts = Record<
  MeterRegisterIdentifierClassification,
  number
>;

export type MeterRegisterImportSummary = {
  sourceRowCount: number;
  rowsWithCurrentIdentifier: number;
  rowsWithoutCurrentIdentifier: number;
  deviceValueCount: number;
  uniqueIdentifierCount: number;
  duplicateDeviceValueCount: number;
  confirmedWattwatchersIdentifierCount: number;
  candidateWattwatchersIdentifierCount: number;
  otherHardwareIdentifierCount: number;
  occurrenceClassifications: MeterRegisterClassificationCounts;
  currentClassifications: MeterRegisterClassificationCounts;
};

type PreparedNormalizationContext = {
  sourceWorkbook: string;
  sourceWorkbookSha256: string;
  sourceSheet: string;
  sourceNamespace: string;
  authoritativeWattwatchersIds: ReadonlySet<string>;
};

type ClassifiedIdentifier = {
  normalized: string | null;
  classification: MeterRegisterIdentifierClassification;
};

function compactString(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    return normalized || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

function canonicalJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): MeterRegisterJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Meter register ${path} must contain a finite JSON number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new Error(`Meter register ${path} is not JSON-safe`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Meter register ${path} contains a circular value`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (entry, index) => canonicalJsonValue(
        entry,
        `${path}[${index}]`,
        ancestors,
      ));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Meter register ${path} is not a plain JSON object`);
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalRawValues(values: Record<string, unknown>): Record<string, MeterRegisterJsonValue> {
  return canonicalJsonValue(values, 'rawValues', new WeakSet()) as Record<
    string,
    MeterRegisterJsonValue
  >;
}

function normalizedSha256(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('en-AU').replace(/^sha256:/u, '');
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error('Meter register sourceWorkbookSha256 must be a 64-character SHA-256 digest');
  }
  return normalized;
}

function requiredSourceName(value: string | undefined, fallback: string, field: string): string {
  const exact = value ?? fallback;
  if (!exact.trim()) throw new Error(`Meter register ${field} is required`);
  return exact;
}

export function wattwatchersMeterRegisterSourceNamespace(input: {
  sourceWorkbook?: string;
  sourceWorkbookSha256: string;
  sourceSheet?: string;
}): string {
  requiredSourceName(
    input.sourceWorkbook,
    WATTWATCHERS_METER_REGISTER_WORKBOOK,
    'sourceWorkbook',
  );
  const sourceSheet = requiredSourceName(
    input.sourceSheet,
    WATTWATCHERS_METER_REGISTER_SHEET,
    'sourceSheet',
  );
  const sourceWorkbookSha256 = normalizedSha256(input.sourceWorkbookSha256);
  return [
    'wattwatchers-meter-register:v1',
    `sha256:${sourceWorkbookSha256}`,
    `sheet:${encodeURIComponent(sourceSheet)}`,
  ].join(':');
}

function identifierText(value: MeterRegisterJsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else text = JSON.stringify(value);
  const normalized = text.trim().toLocaleUpperCase('en-AU');
  if (!normalized || normalized === 'NA') return null;
  return normalized;
}

function authoritativeIdentifierSet(values: Iterable<string>): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    const identifier = identifierText(value);
    if (identifier) normalized.add(identifier);
  }
  return normalized;
}

function classifyIdentifier(
  value: MeterRegisterJsonValue | undefined,
  authoritativeIds: ReadonlySet<string>,
): ClassifiedIdentifier {
  const normalized = identifierText(value);
  if (!normalized) return { normalized: null, classification: 'absent' };
  if (authoritativeIds.has(normalized)) {
    return { normalized, classification: 'confirmed_wattwatchers' };
  }
  if (/^[A-Z0-9]{13}$/u.test(normalized)) {
    return { normalized, classification: 'candidate_wattwatchers' };
  }
  return { normalized, classification: 'other_hardware' };
}

function isoDate(value: MeterRegisterJsonValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]!) return null;
  return normalized;
}

function numericCents(value: MeterRegisterJsonValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Object.is(value, -0) || value === 0) return 0;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value.toString());
  if (!match) return null;
  const negative = match[1] === '-';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? '0');
  const digits = BigInt(`${match[2]}${fraction}`);
  const decimalScale = exponent - fraction.length + 2;
  let absoluteCents: bigint;
  if (decimalScale >= 0) {
    absoluteCents = digits * (10n ** BigInt(decimalScale));
  } else {
    const divisor = 10n ** BigInt(-decimalScale);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    absoluteCents = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  }
  const cents = negative ? -absoluteCents : absoluteCents;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(cents);
}

function textField(
  values: Record<string, MeterRegisterJsonValue>,
  field: string,
): string | null {
  return compactString(values[field]);
}

export function meterRegisterYesNo(value: string | null): boolean | null {
  if (value === null) return null;
  switch (value.trim().toLocaleLowerCase('en-AU')) {
    case 'yes':
    case 'y':
    case 'true':
      return true;
    case 'no':
    case 'n':
    case 'false':
      return false;
    default:
      return null;
  }
}

function prepareContext(options: MeterRegisterNormalizationOptions): PreparedNormalizationContext {
  const sourceWorkbook = requiredSourceName(
    options.sourceWorkbook,
    WATTWATCHERS_METER_REGISTER_WORKBOOK,
    'sourceWorkbook',
  );
  const sourceSheet = requiredSourceName(
    options.sourceSheet,
    WATTWATCHERS_METER_REGISTER_SHEET,
    'sourceSheet',
  );
  const sourceWorkbookSha256 = normalizedSha256(options.sourceWorkbookSha256);
  return {
    sourceWorkbook,
    sourceWorkbookSha256,
    sourceSheet,
    sourceNamespace: wattwatchersMeterRegisterSourceNamespace({
      sourceWorkbook,
      sourceWorkbookSha256,
      sourceSheet,
    }),
    authoritativeWattwatchersIds: authoritativeIdentifierSet(options.authoritativeWattwatchersIds),
  };
}

function normalizeRow(
  input: ExtractedMeterRegisterRow,
  context: PreparedNormalizationContext,
): NormalizedMeterRegisterRow {
  if (!Number.isInteger(input.sourceRow) || input.sourceRow < 2) {
    throw new Error('Meter register sourceRow must be an integer of at least 2');
  }
  const rawValues = canonicalRawValues(input.values);
  const canonicalRowJson = JSON.stringify(rawValues);
  const rowHash = createHash('sha256').update(canonicalRowJson, 'utf8').digest('hex');
  const sourceKey = `${context.sourceNamespace}:row:${input.sourceRow}:row-sha256:${rowHash}`;
  const existing = classifyIdentifier(
    rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.existingDeviceId],
    context.authoritativeWattwatchersIds,
  );
  const replacement = classifyIdentifier(
    rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.newDeviceId],
    context.authoritativeWattwatchersIds,
  );
  const current = replacement.classification !== 'absent' ? replacement : existing;
  const currentSource: MeterRegisterCurrentIdentifierSource = replacement.classification !== 'absent'
    ? 'new'
    : existing.classification !== 'absent'
      ? 'existing'
      : null;

  return {
    sourceWorkbook: context.sourceWorkbook,
    workbookSha256: context.sourceWorkbookSha256,
    sourceSheet: context.sourceSheet,
    sourceRow: input.sourceRow,
    sourceNamespace: context.sourceNamespace,
    sourceRowSha256: rowHash,
    sourceKey,
    rawValues,
    statusSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.status),
    customerNameSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.customerName),
    clientNameSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.clientName),
    siteAddressSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.siteAddress),
    siteStateSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.state),
    serviceTypeSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.serviceType),
    meteringSolutionTypeSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.meteringSolutionType,
    ),
    meterTypeSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.meterType),
    fergusJobNumberSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.fergusJobNumber,
    ),
    quoteNumberSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.quoteNumber),
    purchaseOrderNumberSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.purchaseOrderNumber,
    ),
    jobCompletionDate: isoDate(rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.jobCompletionDate]),
    jobCompletedBySnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.jobCompletedBy,
    ),
    existingDeviceIdentifier: existing.normalized,
    existingDeviceClassification: existing.classification,
    newDeviceIdentifier: replacement.normalized,
    newDeviceClassification: replacement.classification,
    currentDeviceIdentifier: current.normalized,
    currentDeviceClassification: current.classification,
    currentDeviceIdentifierSource: currentSource,
    hardwareInstalledSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.hardwareInstalled,
    ),
    maas: meterRegisterYesNo(textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.maasIndicator)),
    maasStartDate: isoDate(rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.maasStartDate]),
    maasTermSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.maasTerm),
    maasReportingRequired: meterRegisterYesNo(
      textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.maasReportingRequired),
    ),
    dataEnabled: meterRegisterYesNo(
      textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.dataIndicator),
    ),
    productNameSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.wattwatchersProductName,
    ),
    xeroInvoiceNumberSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.xeroInvoiceNumber,
    ),
    meterCostExGstCents: numericCents(rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.meterCost]),
    meteringRecurringFeeExGstCents: numericCents(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.meteringRecurringFee],
    ),
    otherInvoiceCostsExGstCents: numericCents(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.otherInvoiceCosts],
    ),
    invoiceAmountExGstCents: numericCents(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.invoiceAmount],
    ),
    recurringFeePoSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.recurringFeePurchaseOrder,
    ),
    invoicingClientContactSnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.invoicingClientContact,
    ),
    commentsSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.comments),
    recurringStartDate: isoDate(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.recurringStartDate],
    ),
    recurringFrequencySnapshot: textField(
      rawValues,
      WATTWATCHERS_METER_REGISTER_FIELDS.recurringFrequency,
    ),
    recurringNextInvoiceIssueDate: isoDate(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.nextInvoiceIssueDate],
    ),
    invoiceIssuedDate: isoDate(rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.invoiceIssuedDate]),
    billingPeriodSnapshot: textField(rawValues, WATTWATCHERS_METER_REGISTER_FIELDS.period),
    issuedPeriodNextInvoiceIssueDate: isoDate(
      rawValues[WATTWATCHERS_METER_REGISTER_FIELDS.nextInvoiceIssueDate2],
    ),
  };
}

export function normalizeWattwatchersMeterRegisterRow(
  input: ExtractedMeterRegisterRow,
  options: MeterRegisterNormalizationOptions,
): NormalizedMeterRegisterRow {
  return normalizeRow(input, prepareContext(options));
}

/**
 * Rows deliberately remain one-for-one with the extracted workbook rows.
 * Device identifiers are not used as row identity and are never deduplicated.
 */
export function normalizeWattwatchersMeterRegister(
  rows: ExtractedMeterRegisterRow[],
  options: MeterRegisterNormalizationOptions,
): NormalizedMeterRegisterRow[] {
  const context = prepareContext(options);
  const sourceRows = new Set<number>();
  for (const row of rows) {
    if (sourceRows.has(row.sourceRow)) {
      throw new Error(`Meter register contains duplicate sourceRow ${row.sourceRow}`);
    }
    sourceRows.add(row.sourceRow);
  }
  return rows.map((row) => normalizeRow(row, context));
}

function nonAbsentClassification(
  classification: MeterRegisterIdentifierClassification,
): Exclude<MeterRegisterIdentifierClassification, 'absent'> | null {
  return classification === 'absent' ? null : classification;
}

function preferredClassification(
  left: Exclude<MeterRegisterIdentifierClassification, 'absent'>,
  right: Exclude<MeterRegisterIdentifierClassification, 'absent'>,
): Exclude<MeterRegisterIdentifierClassification, 'absent'> {
  if (left === 'confirmed_wattwatchers' || right === 'confirmed_wattwatchers') {
    return 'confirmed_wattwatchers';
  }
  if (left === 'candidate_wattwatchers' || right === 'candidate_wattwatchers') {
    return 'candidate_wattwatchers';
  }
  return 'other_hardware';
}

/**
 * Returns one deterministic projection per non-blank external identifier while
 * retaining every source occurrence for audit and duplicate reporting.
 */
export function collectProjectedMeterRegisterIdentifiers(
  rows: NormalizedMeterRegisterRow[],
): ProjectedMeterRegisterIdentifier[] {
  const projected = new Map<string, ProjectedMeterRegisterIdentifier>();
  for (const row of rows) {
    const identifiers = [
      {
        externalDeviceId: row.existingDeviceIdentifier,
        classification: row.existingDeviceClassification,
        position: 'existing' as const,
      },
      {
        externalDeviceId: row.newDeviceIdentifier,
        classification: row.newDeviceClassification,
        position: 'new' as const,
      },
    ];
    for (const identifier of identifiers) {
      const classification = nonAbsentClassification(identifier.classification);
      if (!identifier.externalDeviceId || !classification) continue;
      const existing = projected.get(identifier.externalDeviceId);
      const occurrence = {
        sourceKey: row.sourceKey,
        sourceRow: row.sourceRow,
        position: identifier.position,
      };
      if (existing) {
        existing.classification = preferredClassification(existing.classification, classification);
        existing.occurrences.push(occurrence);
      } else {
        projected.set(identifier.externalDeviceId, {
          externalDeviceId: identifier.externalDeviceId,
          classification,
          occurrences: [occurrence],
        });
      }
    }
  }
  return [...projected.values()]
    .map((identifier) => ({
      ...identifier,
      occurrences: [...identifier.occurrences].sort((left, right) => (
        left.sourceRow - right.sourceRow
        || left.sourceKey.localeCompare(right.sourceKey, 'en')
        || left.position.localeCompare(right.position, 'en')
      )),
    }))
    .sort((left, right) => left.externalDeviceId.localeCompare(right.externalDeviceId, 'en'));
}

function emptyClassificationCounts(): MeterRegisterClassificationCounts {
  return {
    absent: 0,
    confirmed_wattwatchers: 0,
    candidate_wattwatchers: 0,
    other_hardware: 0,
  };
}

export function summarizeWattwatchersMeterRegister(
  rows: NormalizedMeterRegisterRow[],
): MeterRegisterImportSummary {
  const occurrenceClassifications = emptyClassificationCounts();
  const currentClassifications = emptyClassificationCounts();
  for (const row of rows) {
    occurrenceClassifications[row.existingDeviceClassification] += 1;
    occurrenceClassifications[row.newDeviceClassification] += 1;
    currentClassifications[row.currentDeviceClassification] += 1;
  }
  const projected = collectProjectedMeterRegisterIdentifiers(rows);
  const uniqueIdentifierClassifications = emptyClassificationCounts();
  for (const identifier of projected) {
    uniqueIdentifierClassifications[identifier.classification] += 1;
  }
  const deviceValueCount = projected.reduce(
    (total, identifier) => total + identifier.occurrences.length,
    0,
  );
  return {
    sourceRowCount: rows.length,
    rowsWithCurrentIdentifier: rows.length - currentClassifications.absent,
    rowsWithoutCurrentIdentifier: currentClassifications.absent,
    deviceValueCount,
    uniqueIdentifierCount: projected.length,
    duplicateDeviceValueCount: deviceValueCount - projected.length,
    confirmedWattwatchersIdentifierCount:
      uniqueIdentifierClassifications.confirmed_wattwatchers,
    candidateWattwatchersIdentifierCount:
      uniqueIdentifierClassifications.candidate_wattwatchers,
    otherHardwareIdentifierCount: uniqueIdentifierClassifications.other_hardware,
    occurrenceClassifications,
    currentClassifications,
  };
}
