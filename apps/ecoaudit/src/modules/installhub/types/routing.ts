export type InstallHubRouteCurrentLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  capturedAt?: string | null;
};

export type InstallHubRouteAddressSuggestion = {
  kind: 'client_saved' | 'provider';
  id: string;
  label: string;
  clientId: string | null;
  clientSiteId: string | null;
  siteName: string | null;
  address: {
    displayAddress: string;
    locality: string | null;
    state: string | null;
    postcode: string | null;
    countryCode: 'AU';
    latitude: number | null;
    longitude: number | null;
    provider: string | null;
    placeId: string | null;
    source: 'suggested' | 'manual' | 'client_saved';
    geocodingStatus: 'unresolved' | 'resolved' | 'manual' | 'failed';
    fingerprint: string;
  };
};

export type InstallHubRouteAddressSuggestionsResponse = {
  available: boolean;
  provider: 'geoapify' | 'photon' | null;
  attribution: string | null;
  storedSuggestions: InstallHubRouteAddressSuggestion[];
  providerSuggestions: InstallHubRouteAddressSuggestion[];
  suggestions: InstallHubRouteAddressSuggestion[];
};

export type InstallHubRouteJob = {
  sequence: number;
  eventId: string;
  sourceApp: 'installhub';
  sourceType: 'installation';
  sourceId: string;
  title: string;
  address: string;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  travelDistanceMeters: number;
  travelDurationSeconds: number;
};

export type InstallHubUnroutableJob = {
  eventId: string;
  sourceApp: 'installhub';
  sourceType: 'installation';
  sourceId: string | null;
  title: string;
  address: string | null;
  reason: string;
};

export type InstallHubRouteSuggestion = {
  date: string;
  timezone: string;
  assigneeFieldUserId: string;
  currentLocation: InstallHubRouteCurrentLocation;
  jobs: InstallHubRouteJob[];
  unroutableJobs: InstallHubUnroutableJob[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  optimization: 'road_duration' | 'straight_line_distance';
  googleMapsUrl: string | null;
  warnings: string[];
};

export type InstallHubRouteSuggestionInput = { date: string } & (
  | { currentLocation: InstallHubRouteCurrentLocation; startingAddress?: never }
  | { currentLocation?: never; startingAddress: string }
);
