import type { ScheduleSourceApp, ScheduleSourceType } from './domain';

export type AustralianState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';

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
  provider: 'photon' | null;
  attribution: string | null;
  suggestions: SchedulerAddressSuggestion[];
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
