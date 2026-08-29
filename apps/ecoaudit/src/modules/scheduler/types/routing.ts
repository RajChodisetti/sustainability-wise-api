import type { ScheduleSourceApp, ScheduleSourceType } from './domain';

export type AustralianState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';

export type SchedulerAddressSource = 'suggested' | 'manual' | 'client_saved';
export type SchedulerGeocodingStatus = 'unresolved' | 'resolved' | 'manual' | 'failed';

export type SchedulerJobAddressInput = {
  freeform: string;
  locality?: string;
  state?: AustralianState;
  postcode?: string;
  countryCode: 'AU';
  latitude?: number;
  longitude?: number;
  provider?: string;
  placeId?: string;
  source?: SchedulerAddressSource;
};

export type SchedulerAddressSuggestion = {
  id: string;
  label: string;
  freeform: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number;
  longitude: number;
  provider: string;
  placeId: string | null;
};

export type SchedulerAddressSuggestionsResponse = {
  available: boolean;
  provider: 'geoapify' | 'photon' | null;
  attribution: string | null;
  suggestions: SchedulerAddressSuggestion[];
};

export type SchedulerClientSite = {
  id: string;
  clientId: string;
  siteName: string;
  displayAddress: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  placeId: string | null;
  source: SchedulerAddressSource;
  geocodingStatus: SchedulerGeocodingStatus;
  fingerprint: string;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accessInformation: string | null;
  updatedAt: string;
};

export type SchedulerClient = {
  id: string;
  name: string;
  normalizedKey: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  updatedAt: string;
  sites: SchedulerClientSite[];
};

export type SchedulerClientDirectoryResponse = {
  companyScope: 'current';
  clients: SchedulerClient[];
};

export type SchedulerContractAddress = {
  displayAddress: string;
  locality: string | null;
  state: AustralianState | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  placeId: string | null;
  source: SchedulerAddressSource;
  geocodingStatus: SchedulerGeocodingStatus;
  fingerprint: string;
};

export type SchedulerClientAddressSuggestion = {
  kind: 'client_saved' | 'provider';
  id: string;
  label: string;
  clientId: string | null;
  clientSiteId: string | null;
  siteName: string | null;
  address: SchedulerContractAddress;
};

export type SchedulerClientAddressSuggestionsResponse = {
  available: boolean;
  provider: 'geoapify' | 'photon' | null;
  attribution: string | null;
  storedSuggestions: SchedulerClientAddressSuggestion[];
  providerSuggestions: SchedulerClientAddressSuggestion[];
  suggestions: SchedulerClientAddressSuggestion[];
};

export type SchedulerCurrentLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  capturedAt?: string | null;
};

export type SchedulerRouteJob = {
  sequence: number;
  eventId: string;
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  sourceType: Exclude<ScheduleSourceType, 'custom'>;
  sourceId: string;
  title: string;
  address: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  travelDistanceMeters: number;
  travelDurationSeconds: number;
};

export type SchedulerUnroutableJob = {
  eventId: string;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId: string | null;
  title: string;
  address: string | null;
  reason: string;
};

export type SchedulerRouteSuggestion = {
  date: string;
  timezone: string;
  assigneeFieldUserId: string;
  currentLocation: SchedulerCurrentLocation;
  jobs: SchedulerRouteJob[];
  unroutableJobs: SchedulerUnroutableJob[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  optimization: 'road_duration' | 'straight_line_distance';
  googleMapsUrl: string | null;
  warnings: string[];
};

export type SchedulerRouteSuggestionInput = {
  date: string;
  assigneeFieldUserId?: string;
} & (
  | { currentLocation: SchedulerCurrentLocation; startingAddress?: never }
  | { currentLocation?: never; startingAddress: string }
);
