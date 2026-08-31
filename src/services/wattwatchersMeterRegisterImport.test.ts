import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectProjectedMeterRegisterIdentifiers,
  meterRegisterYesNo,
  normalizeWattwatchersMeterRegister,
  normalizeWattwatchersMeterRegisterRow,
  summarizeWattwatchersMeterRegister,
  WATTWATCHERS_METER_REGISTER_SHEET,
  WATTWATCHERS_METER_REGISTER_WORKBOOK,
  type ExtractedMeterRegisterRow,
  type MeterRegisterNormalizationOptions,
} from './wattwatchersMeterRegisterImport.js';

const WORKBOOK_SHA = 'a'.repeat(64);
const CONFIRMED_ID = 'DD65335309637';
const CANDIDATE_ID = 'AB12345678901';

function options(
  overrides: Partial<MeterRegisterNormalizationOptions> = {},
): MeterRegisterNormalizationOptions {
  return {
    sourceWorkbookSha256: WORKBOOK_SHA,
    authoritativeWattwatchersIds: [CONFIRMED_ID.toLocaleLowerCase('en-AU')],
    ...overrides,
  };
}

function row(
  sourceRow: number,
  values: Record<string, unknown> = {},
): ExtractedMeterRegisterRow {
  return { sourceRow, values };
}

test('preserves every source row and duplicate device occurrence', () => {
  const normalized = normalizeWattwatchersMeterRegister([
    row(4, { 'Existing Device ID': CONFIRMED_ID, 'New Device ID': '' }),
    row(5, { 'Existing Device ID': CONFIRMED_ID, 'New Device ID': 'NA' }),
  ], options());

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.existingDeviceClassification, 'confirmed_wattwatchers');
  assert.equal(normalized[1]?.existingDeviceClassification, 'confirmed_wattwatchers');
  assert.notEqual(normalized[0]?.sourceKey, normalized[1]?.sourceKey);

  const projected = collectProjectedMeterRegisterIdentifiers(normalized);
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.externalDeviceId, CONFIRMED_ID);
  assert.deepEqual(projected[0]?.occurrences.map((occurrence) => occurrence.sourceRow), [4, 5]);

  const summary = summarizeWattwatchersMeterRegister(normalized);
  assert.equal(summary.sourceRowCount, 2);
  assert.equal(summary.deviceValueCount, 2);
  assert.equal(summary.uniqueIdentifierCount, 1);
  assert.equal(summary.duplicateDeviceValueCount, 1);
  assert.equal(summary.confirmedWattwatchersIdentifierCount, 1);
  assert.equal(summary.candidateWattwatchersIdentifierCount, 0);
  assert.equal(summary.otherHardwareIdentifierCount, 0);
});

test('keeps blank rows, preserves raw values, compacts display strings, and treats NA as absent', () => {
  const rawCustomer = '  Example\n   Customer  ';
  const rawComments = '  First line\n\tsecond line  ';
  const normalized = normalizeWattwatchersMeterRegisterRow(row(6, {
    'Customer Name': rawCustomer,
    Comments: rawComments,
    'Existing Device ID': '  nA  ',
    'New Device ID': null,
  }), options());

  assert.equal(normalized.customerNameSnapshot, 'Example Customer');
  assert.equal(normalized.commentsSnapshot, 'First line second line');
  assert.equal(normalized.rawValues['Customer Name'], rawCustomer);
  assert.equal(normalized.rawValues.Comments, rawComments);
  assert.equal(normalized.existingDeviceIdentifier, null);
  assert.equal(normalized.existingDeviceClassification, 'absent');
  assert.equal(normalized.newDeviceClassification, 'absent');
  assert.equal(normalized.currentDeviceIdentifier, null);
  assert.equal(normalized.currentDeviceIdentifierSource, null);

  const blank = normalizeWattwatchersMeterRegisterRow(row(7), options());
  assert.deepEqual(blank.rawValues, {});
  assert.equal(blank.currentDeviceClassification, 'absent');
});

test('classifies exact authoritative IDs, candidates, and mixed hardware without extracting substrings', () => {
  const confirmed = normalizeWattwatchersMeterRegisterRow(row(8, {
    'Existing Device ID': `  ${CONFIRMED_ID.toLocaleLowerCase('en-AU')}  `,
  }), options());
  assert.equal(confirmed.existingDeviceIdentifier, CONFIRMED_ID);
  assert.equal(confirmed.existingDeviceClassification, 'confirmed_wattwatchers');

  const candidate = normalizeWattwatchersMeterRegisterRow(row(9, {
    'Existing Device ID': CANDIDATE_ID.toLocaleLowerCase('en-AU'),
  }), options());
  assert.equal(candidate.existingDeviceIdentifier, CANDIDATE_ID);
  assert.equal(candidate.existingDeviceClassification, 'candidate_wattwatchers');

  const otherHardware = normalizeWattwatchersMeterRegisterRow(row(10, {
    'Existing Device ID': 'legacy-meter/42',
    'New Device ID': `Replacement notes\n${CONFIRMED_ID}`,
  }), options());
  assert.equal(otherHardware.existingDeviceIdentifier, 'LEGACY-METER/42');
  assert.equal(otherHardware.existingDeviceClassification, 'other_hardware');
  assert.equal(otherHardware.newDeviceIdentifier, `REPLACEMENT NOTES\n${CONFIRMED_ID}`);
  assert.equal(otherHardware.newDeviceClassification, 'other_hardware');
});

test('keeps the two positional Next Invoice Issue Date columns separate', () => {
  const normalized = normalizeWattwatchersMeterRegisterRow(row(11, {
    'Next Invoice Issue Date': '2027-01-10',
    'Next Invoice Issue Date__2': '2027-02-20',
  }), options());

  assert.equal(normalized.recurringNextInvoiceIssueDate, '2027-01-10');
  assert.equal(normalized.issuedPeriodNextInvoiceIssueDate, '2027-02-20');
  assert.equal(normalized.rawValues['Next Invoice Issue Date'], '2027-01-10');
  assert.equal(normalized.rawValues['Next Invoice Issue Date__2'], '2027-02-20');
});

test('builds canonical row hashes and source-scoped keys independent of object key order', () => {
  const left = normalizeWattwatchersMeterRegisterRow(row(12, {
    z: { beta: 2, alpha: 1 },
    a: ['value', null],
  }), options());
  const right = normalizeWattwatchersMeterRegisterRow(row(12, {
    a: ['value', null],
    z: { alpha: 1, beta: 2 },
  }), options({ sourceWorkbookSha256: `sha256:${WORKBOOK_SHA.toLocaleUpperCase('en-AU')}` }));

  assert.equal(left.sourceWorkbook, WATTWATCHERS_METER_REGISTER_WORKBOOK);
  assert.equal(left.sourceSheet, WATTWATCHERS_METER_REGISTER_SHEET);
  assert.equal(left.workbookSha256, WORKBOOK_SHA);
  assert.equal(left.sourceRowSha256, right.sourceRowSha256);
  assert.equal(left.sourceNamespace, right.sourceNamespace);
  assert.equal(left.sourceKey, right.sourceKey);
  assert.match(left.sourceRowSha256, /^[a-f0-9]{64}$/u);
  assert.match(left.sourceNamespace, /wattwatchers-meter-register:v1/iu);

  const anotherRow = normalizeWattwatchersMeterRegisterRow(row(13, left.rawValues), options());
  assert.equal(anotherRow.sourceRowSha256, left.sourceRowSha256);
  assert.notEqual(anotherRow.sourceKey, left.sourceKey);

  const anotherWorkbook = normalizeWattwatchersMeterRegisterRow(row(12, left.rawValues), options({
    sourceWorkbookSha256: 'b'.repeat(64),
  }));
  assert.equal(anotherWorkbook.sourceRowSha256, left.sourceRowSha256);
  assert.notEqual(anotherWorkbook.sourceNamespace, left.sourceNamespace);
  assert.notEqual(anotherWorkbook.sourceKey, left.sourceKey);

  const renamedSameWorkbook = normalizeWattwatchersMeterRegisterRow(
    row(12, left.rawValues),
    options({ sourceWorkbook: 'Renamed copy.xlsx' }),
  );
  assert.equal(renamedSameWorkbook.sourceWorkbook, 'Renamed copy.xlsx');
  assert.equal(renamedSameWorkbook.sourceNamespace, left.sourceNamespace);
  assert.equal(renamedSameWorkbook.sourceKey, left.sourceKey);

  const distinctExactSheet = normalizeWattwatchersMeterRegisterRow(
    row(12, left.rawValues),
    options({ sourceSheet: 'Master  Project Register' }),
  );
  assert.equal(distinctExactSheet.sourceSheet, 'Master  Project Register');
  assert.notEqual(distinctExactSheet.sourceNamespace, left.sourceNamespace);
  assert.notEqual(distinctExactSheet.sourceKey, left.sourceKey);
});

test('parses only safe ISO dates and numeric money while retaining raw source values', () => {
  const normalized = normalizeWattwatchersMeterRegisterRow(row(14, {
    'Job Completion Date': ' 2028-02-29 ',
    'MaaS Start Date': '2027-02-29',
    'Recurring Start Date': 46_036,
    'Meter Cost (EXC.GST)': 1_300.25,
    'Metering Recurring Fee (EXC. GST)': 0,
    'Other costs in invoice (if any)': -1.005,
    'Invoice Amount (EXC.GST)': '1299.25',
  }), options());

  assert.equal(normalized.jobCompletionDate, '2028-02-29');
  assert.equal(normalized.maasStartDate, null);
  assert.equal(normalized.recurringStartDate, null);
  assert.equal(normalized.meterCostExGstCents, 130_025);
  assert.equal(normalized.meteringRecurringFeeExGstCents, 0);
  assert.equal(normalized.otherInvoiceCostsExGstCents, -101);
  assert.equal(normalized.invoiceAmountExGstCents, null);
  assert.equal(normalized.rawValues['Recurring Start Date'], 46_036);
  assert.equal(normalized.rawValues['Invoice Amount (EXC.GST)'], '1299.25');
});

test('prefers any non-absent new identifier and otherwise falls back to existing', () => {
  const replacement = normalizeWattwatchersMeterRegisterRow(row(15, {
    'Existing Device ID': CONFIRMED_ID,
    'New Device ID': 'hybrid-hardware-7',
  }), options());
  assert.equal(replacement.currentDeviceIdentifier, 'HYBRID-HARDWARE-7');
  assert.equal(replacement.currentDeviceClassification, 'other_hardware');
  assert.equal(replacement.currentDeviceIdentifierSource, 'new');

  const fallback = normalizeWattwatchersMeterRegisterRow(row(16, {
    'Existing Device ID': CANDIDATE_ID,
    'New Device ID': ' na ',
  }), options());
  assert.equal(fallback.currentDeviceIdentifier, CANDIDATE_ID);
  assert.equal(fallback.currentDeviceClassification, 'candidate_wattwatchers');
  assert.equal(fallback.currentDeviceIdentifierSource, 'existing');
});

test('normalizes only explicit yes/no tokens and keeps ambiguous values null', () => {
  assert.equal(meterRegisterYesNo(' Yes '), true);
  assert.equal(meterRegisterYesNo('Y'), true);
  assert.equal(meterRegisterYesNo('true'), true);
  assert.equal(meterRegisterYesNo('No'), false);
  assert.equal(meterRegisterYesNo('n'), false);
  assert.equal(meterRegisterYesNo('FALSE'), false);
  assert.equal(meterRegisterYesNo('TBC'), null);
  assert.equal(meterRegisterYesNo(null), null);

  const normalized = normalizeWattwatchersMeterRegisterRow(row(17, {
    'MaaS (Yes/No)': 'YES',
    'MaaS reporting required (Y/N)': 'n',
    'Data (Yes/No)': 'TBC',
  }), options());
  assert.equal(normalized.maas, true);
  assert.equal(normalized.maasReportingRequired, false);
  assert.equal(normalized.dataEnabled, null);
  assert.equal(normalized.rawValues['Data (Yes/No)'], 'TBC');
});

test('rejects duplicate source rows while continuing to allow duplicate identifiers', () => {
  assert.throws(() => normalizeWattwatchersMeterRegister([
    row(18, { 'Existing Device ID': CONFIRMED_ID }),
    row(18, { 'Existing Device ID': CANDIDATE_ID }),
  ], options()), /duplicate sourceRow 18/u);
  assert.throws(
    () => normalizeWattwatchersMeterRegisterRow(row(1), options()),
    /integer of at least 2/u,
  );
});
