import { installHubRequest } from '@/modules/installhub/api/client';
import type {
  InstallHubInventoryAccess,
  InstallHubInventoryMeter,
  InstallHubInventoryResponse,
} from '@/modules/installhub/types/inventory';

export type InstallHubInventoryScope = 'mine' | 'company';

export function getInstallHubInventoryAccess(): Promise<InstallHubInventoryAccess> {
  return installHubRequest('GET', '/v1/installhub/inventory/me');
}

export function listInstallHubInventoryMeters(
  scope: InstallHubInventoryScope,
  search = '',
): Promise<InstallHubInventoryResponse> {
  const query = new URLSearchParams({ scope });
  const normalizedSearch = search.trim();
  if (normalizedSearch) query.set('q', normalizedSearch);
  return installHubRequest('GET', `/v1/installhub/inventory/meters?${query}`);
}

export function claimInstallHubInventoryMeterByDeviceId(
  deviceId: string,
): Promise<InstallHubInventoryMeter> {
  return installHubRequest(
    'POST',
    '/v1/installhub/inventory/meters/claim-by-device',
    { deviceId },
  );
}
