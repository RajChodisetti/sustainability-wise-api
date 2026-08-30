'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimInstallHubInventoryMeterByDeviceId,
  getInstallHubInventoryAccess,
  listInstallHubInventoryMeters,
  type InstallHubInventoryScope,
} from '@/modules/installhub/api/inventory';

const installHubInventoryKeys = {
  all: ['installhub', 'inventory'] as const,
  access: ['installhub', 'inventory', 'access'] as const,
  meters: (scope: InstallHubInventoryScope, search: string) => (
    ['installhub', 'inventory', 'meters', scope, search] as const
  ),
};

export function useInstallHubInventoryAccess() {
  return useQuery({
    queryKey: installHubInventoryKeys.access,
    queryFn: getInstallHubInventoryAccess,
  });
}

export function useInstallHubInventoryMeters(
  scope: InstallHubInventoryScope,
  search = '',
  enabled = true,
) {
  const normalizedSearch = search.trim();
  return useQuery({
    queryKey: installHubInventoryKeys.meters(scope, normalizedSearch),
    queryFn: () => listInstallHubInventoryMeters(scope, normalizedSearch),
    enabled,
  });
}

export function useClaimInstallHubInventoryMeter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimInstallHubInventoryMeterByDeviceId,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: installHubInventoryKeys.all });
    },
  });
}
