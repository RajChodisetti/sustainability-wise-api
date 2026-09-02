import type {
  FleetAuState,
  FleetMeterRegisterDetails,
  FleetMeterRegisterRecord,
  FleetMeterRegisterUpdateInput,
  FleetRegisterEvidence,
} from '@/modules/fleet/types/domain';
import { FLEET_AU_STATES } from '@/modules/fleet/types/domain';

export type MeterRegisterTriState = '' | 'true' | 'false';

export type MeterRegisterEditFormValues = {
  revision: number | null;
  clientName: string;
  customerName: string;
  siteName: string;
  siteAddress: string;
  siteState: '' | FleetAuState;
  status: string;
  serviceType: string;
  meteringSolutionType: string;
  installationDetail: string;
  meterType: string;
  fergusJobNumber: string;
  quoteNumber: string;
  purchaseOrderNumber: string;
  jobCompletionDate: string;
  jobCompletedBy: string;
  hardwareInstalled: string;
  maas: MeterRegisterTriState;
  maasStartDate: string;
  maasTerm: string;
  maasReportingRequired: MeterRegisterTriState;
  dataEnabled: MeterRegisterTriState;
  productName: string;
  xeroInvoiceNumber: string;
  meterCostExGst: string;
  meteringRecurringFeeExGst: string;
  otherInvoiceCostsExGst: string;
  invoiceAmountExGst: string;
  recurringFeePo: string;
  invoicingClientContact: string;
  comments: string;
  recurringStartDate: string;
  recurringFrequency: string;
  recurringNextInvoiceIssueDate: string;
  invoiceIssuedDate: string;
  billingPeriod: string;
  issuedPeriodNextInvoiceIssueDate: string;
};

export type MeterRegisterEditErrors = Partial<Record<keyof MeterRegisterEditFormValues, string>>;

export type MeterRegisterEditNormalization =
  | { ok: true; input: FleetMeterRegisterUpdateInput; errors: MeterRegisterEditErrors }
  | { ok: false; input: null; errors: MeterRegisterEditErrors };

function sourceValue<T>(
  record: FleetMeterRegisterRecord | null,
  corrected: T,
  imported: T | null | undefined,
): T | null {
  return record ? corrected : imported ?? null;
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

function triState(value: boolean | null | undefined): MeterRegisterTriState {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

function centsToDollars(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (value / 100).toFixed(2);
}

function requiredFallback(primary?: string | null, fallback?: string | null): string {
  return primary?.trim() || fallback?.trim() || 'NA';
}

function initialSiteState(evidence: FleetRegisterEvidence): '' | FleetAuState {
  if (evidence.record) return evidence.record.siteState ?? '';
  const sourceState = evidence.siteState?.trim().toUpperCase();
  return FLEET_AU_STATES.includes(sourceState as FleetAuState)
    ? sourceState as FleetAuState
    : '';
}

export function meterRegisterEditInitialValues(
  evidence: FleetRegisterEvidence,
): MeterRegisterEditFormValues {
  const { record } = evidence;
  const details = record?.details;
  const sourceClient = evidence.clientName ?? evidence.fleetAccountName;
  const sourceCustomer = evidence.customerName;
  const sourceSiteAddress = evidence.siteAddress;
  return {
    revision: record?.revision ?? null,
    clientName: record?.clientName ?? requiredFallback(sourceClient, sourceCustomer),
    customerName: record?.customerName ?? requiredFallback(sourceCustomer),
    siteName: record?.siteName ?? requiredFallback(sourceCustomer, sourceSiteAddress),
    siteAddress: record?.siteAddress ?? requiredFallback(sourceSiteAddress),
    siteState: initialSiteState(evidence),
    status: text(sourceValue(record, details?.status ?? null, evidence.status)),
    serviceType: text(sourceValue(record, details?.serviceType ?? null, evidence.serviceType)),
    meteringSolutionType: text(sourceValue(
      record,
      details?.meteringSolutionType ?? null,
      evidence.meteringSolutionType,
    )),
    installationDetail: text(details?.installationDetail),
    meterType: text(sourceValue(record, details?.meterType ?? null, evidence.meterType)),
    fergusJobNumber: text(sourceValue(
      record,
      details?.fergusJobNumber ?? null,
      evidence.jobNumber,
    )),
    quoteNumber: text(sourceValue(record, details?.quoteNumber ?? null, evidence.quoteNumber)),
    purchaseOrderNumber: text(sourceValue(
      record,
      details?.purchaseOrderNumber ?? null,
      evidence.purchaseOrderNumber,
    )),
    jobCompletionDate: text(sourceValue(
      record,
      details?.jobCompletionDate ?? null,
      evidence.jobCompletionDate,
    )),
    jobCompletedBy: text(sourceValue(
      record,
      details?.jobCompletedBy ?? null,
      evidence.jobCompletedBy,
    )),
    hardwareInstalled: text(sourceValue(
      record,
      details?.hardwareInstalled ?? null,
      evidence.hardwareInstalled,
    )),
    maas: triState(sourceValue(record, details?.maas ?? null, evidence.maas)),
    maasStartDate: text(sourceValue(record, details?.maasStartDate ?? null, evidence.maasStartDate)),
    maasTerm: text(sourceValue(record, details?.maasTerm ?? null, evidence.maasTerm)),
    maasReportingRequired: triState(sourceValue(
      record,
      details?.maasReportingRequired ?? null,
      evidence.maasReportingRequired,
    )),
    dataEnabled: triState(sourceValue(record, details?.dataEnabled ?? null, evidence.dataEnabled)),
    productName: text(sourceValue(record, details?.productName ?? null, evidence.productName)),
    xeroInvoiceNumber: text(sourceValue(
      record,
      details?.xeroInvoiceNumber ?? null,
      evidence.xeroInvoiceNumber,
    )),
    meterCostExGst: centsToDollars(sourceValue(
      record,
      details?.meterCostExGstCents ?? null,
      evidence.meterCostExGstCents,
    )),
    meteringRecurringFeeExGst: centsToDollars(sourceValue(
      record,
      details?.meteringRecurringFeeExGstCents ?? null,
      evidence.meteringRecurringFeeExGstCents,
    )),
    otherInvoiceCostsExGst: centsToDollars(sourceValue(
      record,
      details?.otherInvoiceCostsExGstCents ?? null,
      evidence.otherInvoiceCostsExGstCents,
    )),
    invoiceAmountExGst: centsToDollars(sourceValue(
      record,
      details?.invoiceAmountExGstCents ?? null,
      evidence.invoiceAmountExGstCents,
    )),
    recurringFeePo: text(sourceValue(
      record,
      details?.recurringFeePo ?? null,
      evidence.recurringFeePo,
    )),
    invoicingClientContact: text(sourceValue(
      record,
      details?.invoicingClientContact ?? null,
      evidence.invoicingClientContact,
    )),
    comments: text(sourceValue(record, details?.comments ?? null, evidence.comments)),
    recurringStartDate: text(sourceValue(
      record,
      details?.recurringStartDate ?? null,
      evidence.recurringStartDate,
    )),
    recurringFrequency: text(sourceValue(
      record,
      details?.recurringFrequency ?? null,
      evidence.recurringFrequency,
    )),
    recurringNextInvoiceIssueDate: text(sourceValue(
      record,
      details?.recurringNextInvoiceIssueDate ?? null,
      evidence.recurringNextInvoiceIssueDate,
    )),
    invoiceIssuedDate: text(sourceValue(
      record,
      details?.invoiceIssuedDate ?? null,
      evidence.invoiceIssuedDate,
    )),
    billingPeriod: text(sourceValue(
      record,
      details?.billingPeriod ?? null,
      evidence.billingPeriod,
    )),
    issuedPeriodNextInvoiceIssueDate: text(sourceValue(
      record,
      details?.issuedPeriodNextInvoiceIssueDate ?? null,
      evidence.issuedPeriodNextInvoiceIssueDate,
    )),
  };
}

function normalizeRequired(
  value: string,
  field: keyof MeterRegisterEditFormValues,
  label: string,
  errors: MeterRegisterEditErrors,
): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) errors[field] = `${label} is required. Use NA when it is not known.`;
  return normalized;
}

function optionalText(value: string): string | null {
  const normalized = value.normalize('NFKC').trim();
  return normalized || null;
}

function optionalDate(
  value: string,
  field: keyof MeterRegisterEditFormValues,
  errors: MeterRegisterEditErrors,
): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    errors[field] = 'Enter a date in YYYY-MM-DD format.';
  }
  return normalized;
}

function optionalBoolean(value: MeterRegisterTriState): boolean | null {
  if (!value) return null;
  return value === 'true';
}

function optionalDollarsToCents(
  value: string,
  field: keyof MeterRegisterEditFormValues,
  errors: MeterRegisterEditErrors,
): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) {
    errors[field] = 'Enter an amount with no more than two decimal places.';
    return null;
  }
  const magnitude = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  const cents = match[1] === '-' ? -magnitude : magnitude;
  if (!Number.isSafeInteger(cents)) {
    errors[field] = 'This amount is too large.';
    return null;
  }
  return cents;
}

export function normalizeMeterRegisterEdit(
  values: MeterRegisterEditFormValues,
): MeterRegisterEditNormalization {
  const errors: MeterRegisterEditErrors = {};
  const details: FleetMeterRegisterDetails = {
    status: optionalText(values.status),
    serviceType: optionalText(values.serviceType),
    meteringSolutionType: optionalText(values.meteringSolutionType),
    installationDetail: optionalText(values.installationDetail),
    meterType: optionalText(values.meterType),
    fergusJobNumber: optionalText(values.fergusJobNumber),
    quoteNumber: optionalText(values.quoteNumber),
    purchaseOrderNumber: optionalText(values.purchaseOrderNumber),
    jobCompletionDate: optionalDate(values.jobCompletionDate, 'jobCompletionDate', errors),
    jobCompletedBy: optionalText(values.jobCompletedBy),
    hardwareInstalled: optionalText(values.hardwareInstalled),
    maas: optionalBoolean(values.maas),
    maasStartDate: optionalDate(values.maasStartDate, 'maasStartDate', errors),
    maasTerm: optionalText(values.maasTerm),
    maasReportingRequired: optionalBoolean(values.maasReportingRequired),
    dataEnabled: optionalBoolean(values.dataEnabled),
    productName: optionalText(values.productName),
    xeroInvoiceNumber: optionalText(values.xeroInvoiceNumber),
    meterCostExGstCents: optionalDollarsToCents(
      values.meterCostExGst,
      'meterCostExGst',
      errors,
    ),
    meteringRecurringFeeExGstCents: optionalDollarsToCents(
      values.meteringRecurringFeeExGst,
      'meteringRecurringFeeExGst',
      errors,
    ),
    otherInvoiceCostsExGstCents: optionalDollarsToCents(
      values.otherInvoiceCostsExGst,
      'otherInvoiceCostsExGst',
      errors,
    ),
    invoiceAmountExGstCents: optionalDollarsToCents(
      values.invoiceAmountExGst,
      'invoiceAmountExGst',
      errors,
    ),
    recurringFeePo: optionalText(values.recurringFeePo),
    invoicingClientContact: optionalText(values.invoicingClientContact),
    comments: optionalText(values.comments),
    recurringStartDate: optionalDate(values.recurringStartDate, 'recurringStartDate', errors),
    recurringFrequency: optionalText(values.recurringFrequency),
    recurringNextInvoiceIssueDate: optionalDate(
      values.recurringNextInvoiceIssueDate,
      'recurringNextInvoiceIssueDate',
      errors,
    ),
    invoiceIssuedDate: optionalDate(values.invoiceIssuedDate, 'invoiceIssuedDate', errors),
    billingPeriod: optionalText(values.billingPeriod),
    issuedPeriodNextInvoiceIssueDate: optionalDate(
      values.issuedPeriodNextInvoiceIssueDate,
      'issuedPeriodNextInvoiceIssueDate',
      errors,
    ),
  };
  const input: FleetMeterRegisterUpdateInput = {
    revision: values.revision,
    clientName: normalizeRequired(values.clientName, 'clientName', 'Client name', errors),
    customerName: normalizeRequired(values.customerName, 'customerName', 'Customer name', errors),
    siteName: normalizeRequired(values.siteName, 'siteName', 'Site name', errors),
    siteAddress: normalizeRequired(values.siteAddress, 'siteAddress', 'Site address', errors),
    siteState: values.siteState || null,
    details,
  };
  return Object.keys(errors).length > 0
    ? { ok: false, input: null, errors }
    : { ok: true, input, errors };
}
