import type {
  InstallHubRouteAddressSuggestion,
  InstallHubRouteCurrentLocation,
} from '@/modules/installhub/types/routing';

export function installHubRouteLocationIsAustralian(
  location: Pick<InstallHubRouteCurrentLocation, 'latitude' | 'longitude'>,
): boolean {
  return Number.isFinite(location.latitude)
    && Number.isFinite(location.longitude)
    && location.latitude >= -44
    && location.latitude <= -9
    && location.longitude >= 112
    && location.longitude <= 154;
}

export function installHubRouteLocationFromSuggestion(
  suggestion: InstallHubRouteAddressSuggestion,
): InstallHubRouteCurrentLocation | null {
  const location = {
    latitude: suggestion.address.latitude ?? Number.NaN,
    longitude: suggestion.address.longitude ?? Number.NaN,
  };
  return installHubRouteLocationIsAustralian(location) ? location : null;
}

export function installHubRouteOriginFromAddress(
  value: string,
  selectedSuggestion: InstallHubRouteAddressSuggestion | null,
): { currentLocation: InstallHubRouteCurrentLocation } | { startingAddress: string } | null {
  const startingAddress = value.trim();
  if (startingAddress.length < 3 || startingAddress.length > 300) return null;
  const selectedLocation = selectedSuggestion?.label === startingAddress
    ? installHubRouteLocationFromSuggestion(selectedSuggestion)
    : null;
  return selectedLocation
    ? { currentLocation: selectedLocation }
    : { startingAddress };
}

export function installHubRouteDistance(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  if (value < 1_000) return `${Math.round(value)} m`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} km`;
}

export function installHubRouteDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}
