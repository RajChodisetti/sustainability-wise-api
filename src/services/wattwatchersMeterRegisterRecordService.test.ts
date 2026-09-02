import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../utils/errors.js';
import type { MeterRegisterOperationalDetails } from './wattwatchersMeterRegisterImport.js';
import { normalizeMeterRegisterOperationalDetails } from './wattwatchersMeterRegisterRecordService.js';

const details: MeterRegisterOperationalDetails = {
  status: 'Active',
  serviceType: null,
  meteringSolutionType: null,
  installationDetail: 'DB Showroom',
  meterType: null,
  fergusJobNumber: null,
  quoteNumber: null,
  purchaseOrderNumber: null,
  jobCompletionDate: '2026-08-31',
  jobCompletedBy: null,
  hardwareInstalled: null,
  maas: true,
  maasStartDate: null,
  maasTerm: null,
  maasReportingRequired: null,
  dataEnabled: null,
  productName: null,
  xeroInvoiceNumber: null,
  meterCostExGstCents: 12_345,
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

test('Meter Register detail corrections preserve omitted fields and normalize edits', () => {
  const result = normalizeMeterRegisterOperationalDetails(details, {
    status: '  In   service ',
    installationDetail: '  HVAC   Units ',
    comments: '  verified   from UI ',
    maas: false,
    meterCostExGstCents: null,
  });
  assert.equal(result.status, 'In service');
  assert.equal(result.installationDetail, 'HVAC Units');
  assert.equal(result.comments, 'verified from UI');
  assert.equal(result.maas, false);
  assert.equal(result.meterCostExGstCents, null);
  assert.equal(result.jobCompletionDate, '2026-08-31');
});

test('Meter Register detail correction rejects unknown, invalid date and fractional cents', () => {
  const isBadRequest = (error: unknown) => error instanceof AppError && error.statusCode === 400;
  assert.throws(() => normalizeMeterRegisterOperationalDetails(details, {
    unexpected: 'value',
  } as Partial<MeterRegisterOperationalDetails>), isBadRequest);
  assert.throws(() => normalizeMeterRegisterOperationalDetails(details, {
    jobCompletionDate: '2026-02-30',
  }), isBadRequest);
  assert.throws(() => normalizeMeterRegisterOperationalDetails(details, {
    invoiceAmountExGstCents: 12.5,
  }), isBadRequest);
});
