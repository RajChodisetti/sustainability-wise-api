'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchInstallHubRouteAddressSuggestions,
  fetchInstallHubRouteSuggestion,
} from '@/modules/installhub/api/routing';

const installHubRouteKeys = {
  all: ['installhub', 'route'] as const,
  addressSuggestions: (query: string) => (
    [...installHubRouteKeys.all, 'address-suggestions', query] as const
  ),
};

export function useInstallHubRouteSuggestion() {
  return useMutation({ mutationFn: fetchInstallHubRouteSuggestion });
}

export function useInstallHubRouteAddressSuggestions(
  query: string,
  enabled = true,
) {
  const normalizedQuery = query.trim();
  return useQuery({
    queryKey: installHubRouteKeys.addressSuggestions(normalizedQuery),
    queryFn: () => fetchInstallHubRouteAddressSuggestions(normalizedQuery),
    enabled: enabled && normalizedQuery.length >= 3,
    staleTime: 5 * 60_000,
  });
}
