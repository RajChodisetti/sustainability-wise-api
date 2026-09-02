import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  FleetMeterRegisterDetails,
  FleetRegisterEvidence,
} from '@/modules/fleet/types/domain';
import {
  meterRegisterEditInitialValues,
  normalizeMeterRegisterEdit,
} from './meterRegisterEdit';

const emptyDetails: FleetMeterRegisterDetails = {
  status: null,
  serviceType: null,
  meteringSolutionType: null,
  installationDetail: null,
  meterType: null,
  fergusJobNumber: null,
  quoteNumber: null,
  purchaseOrderNumber: null,
  jobCompletionDate: null,
  jobCompletedBy: null,
  hardwareInstalled: null,
  maas: null,
  maasStartDate: null,
  maasTerm: null,
  maasReportingRequired: null,
  dataEnabled: null,
  productName: null,
  xeroInvoiceNumber: null,
  meterCostExGstCents: null,
  meteringRecurringFeeExGstCents: null,
  otherInvoiceCostsExGstCents: null,
  invoiceAmountExGstCents: null,
  recurringFeePo: null,
  invoicingClientContact: null,
  comments: null,
  recurringStartDate: null,
  recurringFrequency: null,
  recurringNextInvoiceIssueDate: null,
  invoiceIssuedDate: null,
  billingPeriod: null,
  issuedPeriodNextInvoiceIssueDate: null,
};

function evidence(overrides: Partial<FleetRegisterEvidence> = {}): FleetRegisterEvidence {
  return {
    id: 'entry-1',
    customerName: 'End customer',
    fleetAccountName: 'Source client',
    siteAddress: '1 Test Street',
    record: null,
    ...overrides,
  };
}

test('new correction starts from immutable source values and applies required fallbacks', () => {
  const sourceValues = meterRegisterEditInitialValues(evidence({
    clientName: null,
    fleetAccountName: null,
    customerName: 'Customer fallback',
    siteAddress: null,
    maas: false,
    meterCostExGstCents: 12345,
  }));
  assert.equal(sourceValues.clientName, 'Customer fallback');
  assert.equal(sourceValues.customerName, 'Customer fallback');
  assert.equal(sourceValues.siteName, 'Customer fallback');
  assert.equal(sourceValues.siteAddress, 'NA');
  assert.equal(sourceValues.maas, 'false');
  assert.equal(sourceValues.meterCostExGst, '123.45');
  assert.equal(sourceValues.revision, null);
});

test('an existing correction remains authoritative when an optional field was cleared', () => {
  const values = meterRegisterEditInitialValues(evidence({
    status: 'Imported status',
    siteState: 'VIC',
    record: {
      entryId: 'entry-1',
      businessClientId: 'client-1',
      businessSiteId: 'site-1',
      clientName: 'Corrected client',
      customerName: 'Corrected customer',
      siteName: 'Corrected site',
      siteAddress: 'NA',
      siteState: null,
      revision: 3,
      details: { ...emptyDetails, status: null, installationDetail: 'DB Showroom' },
    },
  }));
  assert.equal(values.clientName, 'Corrected client');
  assert.equal(values.status, '');
  assert.equal(values.installationDetail, 'DB Showroom');
  assert.equal(values.siteState, '');
  assert.equal(values.revision, 3);
});

test('a new correction only initializes state from a valid imported Australian state', () => {
  assert.equal(meterRegisterEditInitialValues(evidence({ siteState: ' nsw ' })).siteState, 'NSW');
  assert.equal(meterRegisterEditInitialValues(evidence({ siteState: 'Victoria' })).siteState, '');
});

test('normalization emits nullable details, tri-state booleans and exact cents', () => {
  const values = meterRegisterEditInitialValues(evidence());
  const result = normalizeMeterRegisterEdit({
    ...values,
    clientName: '  Client   name  ',
    customerName: ' Customer ',
    siteName: ' Site ',
    siteAddress: ' NA ',
    siteState: 'VIC',
    status: '  ',
    installationDetail: '  HVAC   showroom ',
    maas: 'true',
    maasReportingRequired: '',
    dataEnabled: 'false',
    meterCostExGst: '10.05',
    meteringRecurringFeeExGst: '2',
    otherInvoiceCostsExGst: '-0.50',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.input.clientName, 'Client name');
  assert.equal(result.input.siteAddress, 'NA');
  assert.equal(result.input.siteState, 'VIC');
  assert.equal(result.input.details.status, null);
  assert.equal(result.input.details.installationDetail, 'HVAC   showroom');
  assert.equal(result.input.details.maas, true);
  assert.equal(result.input.details.maasReportingRequired, null);
  assert.equal(result.input.details.dataEnabled, false);
  assert.equal(result.input.details.meterCostExGstCents, 1005);
  assert.equal(result.input.details.meteringRecurringFeeExGstCents, 200);
  assert.equal(result.input.details.otherInvoiceCostsExGstCents, -50);
});

test('normalization rejects missing required values and malformed optional inputs', () => {
  const values = meterRegisterEditInitialValues(evidence());
  const result = normalizeMeterRegisterEdit({
    ...values,
    clientName: '',
    customerName: '',
    siteName: '',
    siteAddress: '',
    jobCompletionDate: '01/09/2026',
    invoiceAmountExGst: '1.001',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.clientName);
  assert.ok(result.errors.customerName);
  assert.ok(result.errors.siteName);
  assert.ok(result.errors.siteAddress);
  assert.ok(result.errors.jobCompletionDate);
  assert.ok(result.errors.invoiceAmountExGst);
});
