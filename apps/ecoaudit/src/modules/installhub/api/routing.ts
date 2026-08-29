import { installHubRequest } from '@/modules/installhub/api/client';
import type {
  InstallHubRouteAddressSuggestionsResponse,
  InstallHubRouteSuggestion,
  InstallHubRouteSuggestionInput,
} from '@/modules/installhub/types/routing';

export function fetchInstallHubRouteSuggestion(
  input: InstallHubRouteSuggestionInput,
): Promise<InstallHubRouteSuggestion> {
  return installHubRequest(
    'POST',
    '/v1/installhub/route-suggestions',
    input,
  );
}

export function fetchInstallHubRouteAddressSuggestions(
  query: string,
): Promise<InstallHubRouteAddressSuggestionsResponse> {
  return installHubRequest(
    'POST',
    '/v1/installhub/client-address-suggestions',
    { query, limit: 8 },
  );
}
