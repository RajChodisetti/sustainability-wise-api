import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectProjectedMeterRegisterIdentifiers,
  interpretMeterRegisterCustomerName,
  meaningfulMeterRegisterOperationalText,
  meterRegisterOperationalNameKey,
  meterRegisterPlaceholderSiteId,
  meterRegisterYesNo,
  normalizeWattwatchersMeterRegister,
  normalizeWattwatchersMeterRegisterRow,
  projectMeterRegisterOperationalRecord,
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

test('projects Master Register client, customer and site fallbacks without changing evidence', () => {
  const normalized = normalizeWattwatchersMeterRegisterRow(row(19, {
    'Customer Name': '  Example Customer  ',
    'Client Name': ' N/A ',
    'Site Address': ' 0 ',
    State: ' vic ',
    'Existing Device ID': CONFIRMED_ID,
  }), options());
  const projected = projectMeterRegisterOperationalRecord(normalized);

  assert.equal(projected.businessClientName, 'Example Customer');
  assert.equal(projected.businessClientNormalizedKey, 'example customer');
  assert.equal(projected.customerName, 'Example Customer');
  assert.equal(projected.siteName, 'Example Customer');
  assert.equal(projected.siteNameNormalizedKey, 'example customer');
  assert.equal(projected.siteAddress, 'NA');
  assert.equal(projected.siteState, 'VIC');
  assert.equal(normalized.clientNameSnapshot, 'N/A');
  assert.equal(normalized.siteAddressSnapshot, '0');

  const unknown = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(20, {
      'Customer Name': '',
      'Client Name': ' NA ',
      'Site Address': ' 12 Example Road, Testville ',
      State: 'Victoria',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(unknown.businessClientName, 'NA');
  assert.equal(unknown.customerName, 'NA');
  assert.equal(unknown.siteName, '12 Example Road, Testville');
  assert.equal(unknown.siteNameNormalizedKey, '12 example road, testville');
  assert.equal(unknown.siteAddress, '12 Example Road, Testville');
  assert.equal(unknown.siteState, null);
});

test('maps confirmed Inchcape customer-held clients and separates installation detail', () => {
  const normalized = normalizeWattwatchersMeterRegisterRow(row(21, {
    'Customer Name': 'Subaru - Essendon Fields (DB Showroom & DB Workshop)',
    'Client Name': 'InchCape',
    'Site Address': '',
    State: 'VIC',
    'Existing Device ID': CONFIRMED_ID,
  }), options());
  const projected = projectMeterRegisterOperationalRecord(normalized);

  assert.equal(projected.businessClientName, 'Subaru Essendon');
  assert.equal(projected.customerName, 'Subaru Essendon');
  assert.equal(projected.siteName, 'Subaru Essendon');
  assert.equal(projected.siteAddress, '344 Wirraway Road, Essendon Fields VIC 3041');
  assert.equal(projected.siteState, 'VIC');
  assert.equal(projected.details.installationDetail, 'DB Showroom & DB Workshop');
  assert.equal(
    normalized.customerNameSnapshot,
    'Subaru - Essendon Fields (DB Showroom & DB Workshop)',
  );
  assert.equal(normalized.clientNameSnapshot, 'InchCape');

  const plainAlias = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(22, {
      'Customer Name': 'Subaru Essendon',
      'Client Name': 'Inchcape',
      'Site Address': '344 Wirraway Road, Essendon Fields, AU, 3041',
      State: 'VIC',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(plainAlias.businessClientName, 'Subaru Essendon');
  assert.equal(plainAlias.customerName, 'Subaru Essendon');
  assert.equal(plainAlias.siteName, 'Subaru Essendon');
  assert.equal(plainAlias.details.installationDetail, null);
});

test('separates only clearly electrical customer suffixes and preserves other parentheses', () => {
  assert.deepEqual(
    interpretMeterRegisterCustomerName('AutoNexus - Altona (HVAC Units)'),
    { customerName: 'AutoNexus - Altona', installationDetail: 'HVAC Units' },
  );
  assert.deepEqual(
    interpretMeterRegisterCustomerName('Trivett - Parramatta (Subaru) (A/C Units)'),
    {
      customerName: 'Trivett - Parramatta (Subaru)',
      installationDetail: 'A/C Units',
    },
  );
  assert.deepEqual(
    interpretMeterRegisterCustomerName('Wangara (WA)'),
    { customerName: 'Wangara (WA)', installationDetail: null },
  );
  assert.deepEqual(
    interpretMeterRegisterCustomerName('Estia Health (Operational)'),
    { customerName: 'Estia Health (Operational)', installationDetail: null },
  );
  assert.deepEqual(
    interpretMeterRegisterCustomerName('Richmond Dairy (No installation required)'),
    {
      customerName: 'Richmond Dairy (No installation required)',
      installationDetail: null,
    },
  );

  const nationalStorage = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(23, {
      'Customer Name': 'Moonah Central (TAS) - Solar 1 (DB-A)',
      'Client Name': 'National Storage',
      'Site Address': '1 Example Road',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(nationalStorage.businessClientName, 'National Storage');
  assert.equal(nationalStorage.customerName, 'Moonah Central (TAS) - Solar 1');
  assert.equal(nationalStorage.siteName, 'Moonah Central (TAS) - Solar 1');
  assert.equal(nationalStorage.details.installationDetail, 'DB-A');

  const labelInSiteColumn = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(24, {
      'Customer Name': '',
      'Client Name': 'SUMS Fleet | Sustainability Wise',
      'Site Address': 'Subaru - Narellan (EV Charging)',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(labelInSiteColumn.businessClientName, 'SUMS Fleet | Sustainability Wise');
  assert.equal(labelInSiteColumn.customerName, 'NA');
  assert.equal(labelInSiteColumn.siteName, 'Subaru - Narellan');
  assert.equal(labelInSiteColumn.siteAddress, 'NA');
  assert.equal(labelInSiteColumn.details.installationDetail, 'EV Charging');
});

test('separates reviewed placement details only when workbook context makes them unambiguous', () => {
  const fixtures = [
    ['Aroona - 19 Wyralla Rd Yowie Bay - HDB-4 (Pool)', 'SUMS', 'Pool'],
    ['Fremantle (WA) - Grid (A Block)', 'National Storage', 'A Block'],
    ['Box Hill #55 (VIC) - Solar 2 (front office)', 'National Storage', 'front office'],
    ['Bunbury (WA) - Grid (A, Office)', 'National Storage', 'A, Office'],
    ['Fremantle (WA) - Grid (D Block)', 'National Storage', 'D Block'],
    ['Fremantle (WA) - Grid (B&C Block)', 'National Storage', 'B&C Block'],
    ['Marcoola (Qld) - Solar #1 (house)', 'National Storage', 'house'],
    ['Marcoola (Qld) - Solar #2 (left shed)', 'National Storage', 'left shed'],
    ['Yatala (QLD) #2 (rear)', 'National Storage', 'rear'],
    ['Yatala (QLD) #1 (front)', 'National Storage', 'front'],
    ['Hope Island (QLD) - Solar (Office)', 'National Storage', 'Office'],
    ['Hope Island (QLD) - Solar (Shed)', 'National Storage', 'Shed'],
    ['Osborne Park (WA) - Solar (F Block)', 'National Storage', 'F Block'],
  ] as const;

  for (const [customer, client, installationDetail] of fixtures) {
    const projected = projectMeterRegisterOperationalRecord(
      normalizeWattwatchersMeterRegisterRow(row(26, {
        'Customer Name': customer,
        'Client Name': client,
        'Site Address': '',
        'Existing Device ID': CONFIRMED_ID,
      }), options()),
    );
    assert.equal(projected.customerName, customer.slice(0, customer.lastIndexOf(' (')));
    assert.equal(projected.details.installationDetail, installationDetail);
  }

  const ambiguousClient = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(27, {
      'Customer Name': 'Example Customer (Office)',
      'Client Name': 'Example Client',
      'Site Address': '',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(ambiguousClient.customerName, 'Example Customer (Office)');
  assert.equal(ambiguousClient.details.installationDetail, null);

  const physicalAddressPresent = projectMeterRegisterOperationalRecord(
    normalizeWattwatchersMeterRegisterRow(row(28, {
      'Customer Name': 'Hope Island (QLD) - Solar (Office)',
      'Client Name': 'National Storage',
      'Site Address': '1 Example Road',
      'Existing Device ID': CONFIRMED_ID,
    }), options()),
  );
  assert.equal(physicalAddressPresent.customerName, 'Hope Island (QLD) - Solar (Office)');
  assert.equal(physicalAddressPresent.details.installationDetail, null);
});

test('projects every non-identity Meter Register field into typed operational details', () => {
  const normalized = normalizeWattwatchersMeterRegisterRow(row(25, {
    Status: 'Complete',
    'Customer Name': 'Customer',
    'Client Name': 'Client',
    'Site Address': '1 Test Street',
    State: 'NSW',
    'Service Type': 'Install',
    'Metering Solution Type': 'Submetering',
    'Meter Type': 'A6M',
    'Fergus Job #': 'JOB-1',
    'Quote #': 'QUOTE-1',
    'PO Number': 'PO-1',
    'Job Completion Date': '2026-08-31',
    'Job Completed By': 'Technician',
    'Existing Device ID': CONFIRMED_ID,
    'Hardware Installed': 'Meter and CTs',
    'MaaS (Yes/No)': 'Yes',
    'MaaS Start Date': '2026-09-01',
    'MaaS Term': '36 months',
    'MaaS reporting required (Y/N)': 'N',
    'Data (Yes/No)': 'Y',
    'Product name (WW)': 'Wattwatchers',
    'Xero Invoice #': 'INV-1',
    'Meter Cost (EXC.GST)': 100,
    'Metering Recurring Fee (EXC. GST)': 10,
    'Other costs in invoice (if any)': 5,
    'Invoice Amount (EXC.GST)': 115,
    'Recurring fee PO (if any)': 'RPO-1',
    'Invoicing Client Contact': 'Accounts',
    Comments: 'Imported note',
    'Recurring Start Date': '2026-09-01',
    'Recurring Frequency': 'Monthly',
    'Next Invoice Issue Date': '2026-10-01',
    'Inv issued date': '2026-09-02',
    Period: 'September 2026',
    'Next Invoice Issue Date__2': '2026-11-01',
  }), options());
  const projected = projectMeterRegisterOperationalRecord(normalized);

  assert.deepEqual(projected.details, {
    status: 'Complete',
    serviceType: 'Install',
    meteringSolutionType: 'Submetering',
    installationDetail: null,
    meterType: 'A6M',
    fergusJobNumber: 'JOB-1',
    quoteNumber: 'QUOTE-1',
    purchaseOrderNumber: 'PO-1',
    jobCompletionDate: '2026-08-31',
    jobCompletedBy: 'Technician',
    hardwareInstalled: 'Meter and CTs',
    maas: true,
    maasStartDate: '2026-09-01',
    maasTerm: '36 months',
    maasReportingRequired: false,
    dataEnabled: true,
    productName: 'Wattwatchers',
    xeroInvoiceNumber: 'INV-1',
    meterCostExGstCents: 10_000,
    meteringRecurringFeeExGstCents: 1_000,
    otherInvoiceCostsExGstCents: 500,
    invoiceAmountExGstCents: 11_500,
    recurringFeePo: 'RPO-1',
    invoicingClientContact: 'Accounts',
    comments: 'Imported note',
    recurringStartDate: '2026-09-01',
    recurringFrequency: 'Monthly',
    recurringNextInvoiceIssueDate: '2026-10-01',
    invoiceIssuedDate: '2026-09-02',
    billingPeriod: 'September 2026',
    issuedPeriodNextInvoiceIssueDate: '2026-11-01',
  });
  assert.equal(meaningfulMeterRegisterOperationalText(' n/a '), null);
  assert.equal(meaningfulMeterRegisterOperationalText('  Client  Name '), 'Client Name');
  assert.equal(meterRegisterOperationalNameKey('  Ｅxample  Site '), 'example site');
  assert.throws(() => meterRegisterOperationalNameKey('  '), /operational name is required/u);
  assert.match(
    meterRegisterPlaceholderSiteId('wwmre_example', 'client-1'),
    /^bs_wwmr_[a-f0-9]{32}$/u,
  );
  assert.notEqual(
    meterRegisterPlaceholderSiteId('wwmre_example', 'client-1'),
    meterRegisterPlaceholderSiteId('wwmre_another', 'client-1'),
  );
  assert.notEqual(
    meterRegisterPlaceholderSiteId('wwmre_example', 'client-1'),
    meterRegisterPlaceholderSiteId('wwmre_example', 'client-2'),
  );
  assert.throws(() => meterRegisterPlaceholderSiteId('  ', 'client-1'), /entryId is required/u);
  assert.throws(
    () => meterRegisterPlaceholderSiteId('wwmre_example', ' '),
    /businessClientId is required/u,
  );
});
