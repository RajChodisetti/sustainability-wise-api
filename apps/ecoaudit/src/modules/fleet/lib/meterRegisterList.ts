import type {
  FleetMeterRegisterIdentifierClassification,
  FleetRegisterEvidence,
} from '@/modules/fleet/types/domain';

export type MeterRegisterClassificationTone = 'positive' | 'warning' | 'neutral';

const classificationPresentation: Record<
  FleetMeterRegisterIdentifierClassification,
  { label: string; tone: MeterRegisterClassificationTone }
> = {
  absent: { label: 'Not present', tone: 'neutral' },
  confirmed_wattwatchers: { label: 'Confirmed Wattwatchers', tone: 'positive' },
  candidate_wattwatchers: { label: 'Candidate Wattwatchers', tone: 'warning' },
  other_hardware: { label: 'Other hardware', tone: 'neutral' },
};

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return 'NA';
}

export function meterRegisterClassificationPresentation(
  classification?: FleetMeterRegisterIdentifierClassification | null,
): { label: string; tone: MeterRegisterClassificationTone } {
  return classification
    ? classificationPresentation[classification]
    : { label: 'Not classified', tone: 'neutral' };
}

export function meterRegisterListValues(evidence: FleetRegisterEvidence) {
  const { record } = evidence;
  const sourceClient = evidence.clientName ?? evidence.fleetAccountName;
  const sourceSite = firstText(evidence.siteAddress);
  return {
    identifier: firstText(evidence.currentDeviceIdentifier),
    clientName: record?.clientName ?? firstText(sourceClient, evidence.customerName),
    customerName: record?.customerName ?? firstText(evidence.customerName),
    siteName: record?.siteName ?? firstText(evidence.customerName, evidence.siteAddress),
    siteAddress: record?.siteAddress ?? sourceSite,
    siteState: record?.siteState ?? (record ? null : evidence.siteState?.trim() || null),
    revision: record?.revision ?? null,
    sourceClient: firstText(sourceClient),
  };
}

export function meterRegisterRawSourceValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
