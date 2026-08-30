import { createHash } from 'node:crypto';
import { schedulerAddressFingerprint } from './schedulerAddressService.js';

export type MaasWorkbookRow = {
  sourceRow: number;
  customerName: string;
  clientName: string;
  siteAddress: string | null;
  jobCompletionDate: string | null;
  maasStartDate: string | null;
  existingDeviceId: string | null;
  newDeviceId: string | null;
  notes: string | null;
};

export type NormalizedMaasImportRow = {
  sourceKey: string;
  sourceRow: number;
  fleetAccountCode: 'eutility' | 'sums-for-sustainability-wise' | 'ram-for-sustainability-wise';
  customerName: string;
  customerNormalizedKey: string;
  fallbackBusinessClientId: string;
  siteName: string | null;
  siteAddress: string | null;
  siteLocality: string | null;
  siteState: 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA' | null;
  sitePostcode: string | null;
  siteAddressFingerprint: string | null;
  fallbackBusinessSiteId: string | null;
  deviceLabel: string;
  jobCompletionDate: string | null;
  maasStartDate: string | null;
  effectiveDate: string;
  existingDeviceId: string | null;
  newDeviceId: string | null;
  currentExternalDeviceId: string;
  fallbackExistingDeviceInternalId: string | null;
  fallbackNewDeviceInternalId: string | null;
  fallbackCurrentDeviceInternalId: string;
  assignmentId: string;
  notes: string | null;
};

const ACCOUNT_CODES: Record<string, NormalizedMaasImportRow['fleetAccountCode']> = {
  eutility: 'eutility',
  sums: 'sums-for-sustainability-wise',
  ram: 'ram-for-sustainability-wise',
};

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

function compact(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function optionalCompact(value: string | null): string | null {
  if (value === null) return null;
  const normalized = compact(value);
  return normalized || null;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)}`;
}

function requiredDate(value: string | null, field: string, sourceRow: number): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`MaaS Devices row ${sourceRow}: ${field} must be YYYY-MM-DD`);
  }
  return value;
}

function deviceId(value: string | null, field: string, sourceRow: number): string | null {
  const normalized = optionalCompact(value)?.toUpperCase() ?? null;
  if (normalized && !/^[A-Z0-9]{13}$/u.test(normalized)) {
    throw new Error(`MaaS Devices row ${sourceRow}: ${field} is not a 13-character device ID`);
  }
  return normalized;
}

function canonicalCustomerName(raw: string): string {
  if (/^Hastings Deering(?:\s|-|\()/iu.test(raw)) return 'Hastings Deering (Australia) Limited';
  if (/^Keyton\s*-/iu.test(raw)) return 'Keyton';
  if (/^Broadway Plaza\s*-/iu.test(raw)) return 'Broadway Plaza';
  if (raw === 'Mount Penang Gardens (Devices rolled over to MaaS)') return 'Mount Penang Gardens';
  if (raw === 'Richmond Dairy (No installation required)') return 'Richmond Dairy';
  return raw;
}

function cleanAddress(raw: string): string {
  return compact(raw)
    .replace(/\s+,/gu, ',')
    .replace(/,{2,}/gu, ',')
    .replace(/,\s*(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s*,\s*(\d{4})$/u, ', $1 $2');
}

function protenSiteAndAddress(raw: string): { siteName: string; address: string } | null {
  if (!/^Proten\s*-/iu.test(raw)) return null;
  const streetStart = raw.search(/\b(?:195 St Station Road|8 Notts Well Road)\b/iu);
  if (streetStart < 0) return null;
  const siteName = compact(raw.slice(0, streetStart).replace(/\s*-\s*$/u, ''));
  return { siteName, address: cleanAddress(raw.slice(streetStart)) };
}

function structuredAddress(value: string): {
  address: string;
  locality: string | null;
  state: NormalizedMaasImportRow['siteState'];
  postcode: string | null;
} {
  const address = cleanAddress(value);
  const statePostcode = address.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)[, ]+(\d{4})$/u);
  if (!statePostcode) return { address, locality: null, state: null, postcode: null };
  const state = statePostcode[1] as typeof AUSTRALIAN_STATES[number];
  const postcode = statePostcode[2];
  const beforeState = address.slice(0, statePostcode.index).replace(/[\s,]+$/u, '');
  const commaParts = beforeState.split(',').map((part) => compact(part)).filter(Boolean);
  const finalPart = commaParts.at(-1) ?? '';
  const locality = /^[A-Z][A-Z\s]+$/u.test(finalPart) ? finalPart.replace(/\s+/gu, ' ') : null;
  return { address, locality, state, postcode };
}

function siteNameFor(
  rawCustomerName: string,
  customerName: string,
  address: string,
  parsedLocality: string | null,
  protenSiteName: string | null,
): string {
  if (protenSiteName) return protenSiteName;
  if (/^Keyton\s*-/iu.test(rawCustomerName)) return compact(rawCustomerName.replace(/^Keyton\s*-\s*/iu, ''));
  if (/^Broadway Plaza\s*-/iu.test(rawCustomerName)) return 'Broadway Plaza - Punchbowl';
  if (rawCustomerName === 'Mount Penang Gardens (Devices rolled over to MaaS)') return 'Mount Penang Gardens';
  if (parsedLocality) return `${customerName} - ${parsedLocality.replace(/\b\w/gu, (value) => value.toUpperCase())}`;
  return `${customerName} - ${address}`;
}

function deviceLabelFor(
  rawCustomerName: string,
  customerName: string,
  siteName: string,
): string {
  if (/^Broadway Plaza\s*-/iu.test(rawCustomerName)) return rawCustomerName;
  if (/^Keyton\s*-/iu.test(rawCustomerName)) return rawCustomerName;
  if (/^Hastings Deering\s*-/iu.test(rawCustomerName)) return siteName;
  if (siteName.toLocaleLowerCase('en-AU').startsWith(customerName.toLocaleLowerCase('en-AU'))) {
    return siteName;
  }
  return `${customerName} - ${siteName}`;
}

export function normalizeMaasWorkbookRow(input: MaasWorkbookRow): NormalizedMaasImportRow {
  if (!Number.isInteger(input.sourceRow) || input.sourceRow < 2) {
    throw new Error('MaaS Devices sourceRow must be an integer of at least 2');
  }
  const rawCustomerName = compact(input.customerName);
  const customerName = canonicalCustomerName(rawCustomerName);
  const customerNormalizedKey = customerName.toLocaleLowerCase('en-AU');
  const account = ACCOUNT_CODES[compact(input.clientName).toLocaleLowerCase('en-AU')];
  if (!account) throw new Error(`MaaS Devices row ${input.sourceRow}: unsupported Client Name`);

  const jobCompletionDate = requiredDate(input.jobCompletionDate, 'Job Completion Date', input.sourceRow);
  const maasStartDate = requiredDate(input.maasStartDate, 'Start date in MaaS', input.sourceRow);
  if (Number(Boolean(jobCompletionDate)) + Number(Boolean(maasStartDate)) !== 1) {
    throw new Error(`MaaS Devices row ${input.sourceRow}: exactly one effective date is required`);
  }
  const effectiveDate = jobCompletionDate ?? maasStartDate!;
  const existingDeviceId = deviceId(input.existingDeviceId, 'Existing Device ID', input.sourceRow);
  const newDeviceId = deviceId(input.newDeviceId, 'New Device ID', input.sourceRow);
  if (!existingDeviceId && !newDeviceId) {
    throw new Error(`MaaS Devices row ${input.sourceRow}: at least one device ID is required`);
  }
  if (existingDeviceId && existingDeviceId === newDeviceId) {
    throw new Error(`MaaS Devices row ${input.sourceRow}: replacement IDs must differ`);
  }
  const currentExternalDeviceId = newDeviceId ?? existingDeviceId!;

  const rawSiteAddress = optionalCompact(input.siteAddress);
  const proten = rawSiteAddress ? protenSiteAndAddress(rawSiteAddress) : null;
  const parsed = rawSiteAddress ? structuredAddress(proten?.address ?? rawSiteAddress) : null;
  const siteName = parsed
    ? siteNameFor(rawCustomerName, customerName, parsed.address, parsed.locality, proten?.siteName ?? null)
    : null;
  const siteKey = siteName && parsed
    ? `${customerNormalizedKey}\u001f${siteName.toLocaleLowerCase('en-AU')}\u001f${parsed.address.toLocaleLowerCase('en-AU')}`
    : null;
  const deviceLabel = siteName
    ? deviceLabelFor(rawCustomerName, customerName, siteName)
    : `${customerName} - Site unknown`;

  return {
    sourceKey: `sw-works-planning:maas-devices:${input.sourceRow}`,
    sourceRow: input.sourceRow,
    fleetAccountCode: account,
    customerName,
    customerNormalizedKey,
    fallbackBusinessClientId: stableId('bc_ww_', customerNormalizedKey),
    siteName,
    siteAddress: parsed?.address ?? null,
    siteLocality: parsed?.locality ?? null,
    siteState: parsed?.state ?? null,
    sitePostcode: parsed?.postcode ?? null,
    siteAddressFingerprint: parsed ? schedulerAddressFingerprint({
      displayAddress: parsed.address,
      locality: parsed.locality,
      state: parsed.state,
      postcode: parsed.postcode,
      countryCode: 'AU',
    }) : null,
    fallbackBusinessSiteId: siteKey ? stableId('bs_ww_', siteKey) : null,
    deviceLabel,
    jobCompletionDate,
    maasStartDate,
    effectiveDate,
    existingDeviceId,
    newDeviceId,
    currentExternalDeviceId,
    fallbackExistingDeviceInternalId: existingDeviceId ? stableId('wwd_', existingDeviceId) : null,
    fallbackNewDeviceInternalId: newDeviceId ? stableId('wwd_', newDeviceId) : null,
    fallbackCurrentDeviceInternalId: stableId('wwd_', currentExternalDeviceId),
    assignmentId: stableId('wwdia_', `sw-works-planning:maas-devices:${input.sourceRow}`),
    notes: optionalCompact(input.notes),
  };
}

export function normalizeMaasWorkbook(rows: MaasWorkbookRow[]): NormalizedMaasImportRow[] {
  const normalized = rows.map(normalizeMaasWorkbookRow);
  const sourceKeys = new Set<string>();
  const deviceIds = new Set<string>();
  for (const row of normalized) {
    if (sourceKeys.has(row.sourceKey)) throw new Error(`Duplicate source row: ${row.sourceRow}`);
    sourceKeys.add(row.sourceKey);
    for (const value of [row.existingDeviceId, row.newDeviceId]) {
      if (!value) continue;
      if (deviceIds.has(value)) throw new Error(`Duplicate device ID in workbook: ${value}`);
      deviceIds.add(value);
    }
  }
  return normalized;
}
