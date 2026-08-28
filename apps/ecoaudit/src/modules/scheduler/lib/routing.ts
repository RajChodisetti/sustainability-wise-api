import type {
  AustralianState,
  SchedulerAddressSuggestion,
  SchedulerClientAddressSuggestion,
  SchedulerJobAddressInput,
} from '@/modules/scheduler/types/routing';
import type { SchedulerSiteOption } from '@/modules/scheduler/types/domain';

export const AUSTRALIAN_STATES: Array<{ value: AustralianState; label: string }> = [
  { value: 'ACT', label: 'Australian Capital Territory' },
  { value: 'NSW', label: 'New South Wales' },
  { value: 'NT', label: 'Northern Territory' },
  { value: 'QLD', label: 'Queensland' },
  { value: 'SA', label: 'South Australia' },
  { value: 'TAS', label: 'Tasmania' },
  { value: 'VIC', label: 'Victoria' },
  { value: 'WA', label: 'Western Australia' },
];

export const EMPTY_SCHEDULER_JOB_ADDRESS: SchedulerJobAddressInput = {
  freeform: '',
  locality: '',
  state: undefined,
  postcode: '',
  countryCode: 'AU',
  source: 'manual',
};

export function schedulerAddressFromSuggestion(
  suggestion: SchedulerAddressSuggestion,
): SchedulerJobAddressInput {
  return {
    freeform: suggestion.freeform,
    locality: suggestion.locality ?? '',
    state: suggestion.state ?? undefined,
    postcode: suggestion.postcode ?? '',
    countryCode: 'AU',
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    provider: suggestion.provider,
    placeId: suggestion.placeId ?? undefined,
    source: 'suggested',
  };
}

export function schedulerAddressFromClientSuggestion(
  suggestion: SchedulerClientAddressSuggestion,
): SchedulerJobAddressInput {
  return {
    freeform: suggestion.address.displayAddress,
    locality: suggestion.address.locality ?? '',
    state: suggestion.address.state ?? undefined,
    postcode: suggestion.address.postcode ?? '',
    countryCode: 'AU',
    latitude: suggestion.address.latitude ?? undefined,
    longitude: suggestion.address.longitude ?? undefined,
    provider: suggestion.address.provider ?? undefined,
    placeId: suggestion.address.placeId ?? undefined,
    source: suggestion.kind === 'client_saved' ? 'client_saved' : 'suggested',
  };
}

export function schedulerManualAddress(
  current: SchedulerJobAddressInput,
  changes: Partial<Pick<SchedulerJobAddressInput, 'freeform' | 'locality' | 'state' | 'postcode'>>,
): SchedulerJobAddressInput {
  return {
    ...current,
    ...changes,
    countryCode: 'AU',
    latitude: undefined,
    longitude: undefined,
    provider: undefined,
    placeId: undefined,
    source: 'manual',
  };
}

export function schedulerAddressPostcodeChange(
  current: SchedulerJobAddressInput,
  rawPostcode: string,
): SchedulerJobAddressInput {
  const postcode = rawPostcode.replace(/\D/g, '').slice(0, 4);
  return schedulerManualAddress(current, {
    postcode,
    ...(postcode !== current.postcode
      ? { locality: '', state: undefined }
      : {}),
  });
}

export function schedulerAddressIsComplete(value: SchedulerJobAddressInput): boolean {
  return Boolean(
    value.freeform.trim()
    && value.locality?.trim()
    && value.state
    && /^\d{4}$/.test(value.postcode?.trim() ?? ''),
  );
}

export function schedulerAddressDisplay(value: SchedulerJobAddressInput): string {
  if (
    value.source === 'suggested'
    || value.source === 'client_saved'
    || value.provider
  ) return value.freeform.trim();
  const localityLine = [
    value.locality?.trim(),
    value.state,
    value.postcode?.trim(),
  ].filter(Boolean).join(' ');
  return [value.freeform.trim(), localityLine, 'Australia'].filter(Boolean).join(', ');
}

export function schedulerAddressPayload(
  value: SchedulerJobAddressInput,
): SchedulerJobAddressInput {
  const provider = value.provider?.trim() || undefined;
  return {
    freeform: value.freeform.trim(),
    locality: value.locality?.trim() || undefined,
    state: value.state,
    postcode: value.postcode?.trim() || undefined,
    countryCode: 'AU',
    latitude: value.latitude,
    longitude: value.longitude,
    provider,
    placeId: value.placeId?.trim() || undefined,
    source: value.source ?? (provider ? 'suggested' : 'manual'),
  };
}

export function schedulerDispatchSiteSelectionPayload(input: {
  address: SchedulerJobAddressInput;
  clientId?: string | null;
  existingSiteId?: string | null;
}): {
  siteMode: 'new' | 'existing';
  existingSiteId: string | null;
  clientId: string | null;
} {
  const existingSiteId = input.existingSiteId?.trim() || null;
  const useSavedSite = input.address.source === 'client_saved' && Boolean(existingSiteId);
  return {
    siteMode: useSavedSite ? 'existing' : 'new',
    existingSiteId: useSavedSite ? existingSiteId : null,
    clientId: input.clientId?.trim() || null,
  };
}

export function schedulerSiteOptionLabel(
  site: Pick<SchedulerSiteOption, 'clientName' | 'siteName' | 'address'>,
): string {
  return `${site.clientName} · ${site.siteName} · ${site.address}`;
}

export function uniquePostcodeLocalities(
  suggestions: ReadonlyArray<{
    locality: string | null;
    state: AustralianState | null;
  }>,
): Array<{ locality: string; state: AustralianState }> {
  const seen = new Set<string>();
  const options: Array<{ locality: string; state: AustralianState }> = [];
  for (const suggestion of suggestions) {
    const locality = suggestion.locality?.trim();
    const state = suggestion.state;
    if (!locality || !state) continue;
    const key = `${locality.toLocaleLowerCase('en-AU')}|${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ locality, state });
  }
  return options.sort((left, right) => (
    left.locality.localeCompare(right.locality, 'en-AU') || left.state.localeCompare(right.state)
  ));
}

export function schedulerRouteDistance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  if (value < 1_000) return `${Math.round(value)} m`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} km`;
}

export function schedulerRouteDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function schedulerRouteJobTypeLabel(sourceApp: string): string {
  if (sourceApp === 'ecoaudit') return 'EcoAudit';
  if (sourceApp === 'solarsense') return 'SolarSense';
  if (sourceApp === 'installhub') return 'Field App';
  return 'Custom';
}
