import {
  portalAppForPath,
  portalLoginRedirectPath,
  safePortalNext,
} from '@/lib/portalNavigation';
import type { FleetDevicePlacement } from '@/modules/fleet/types/domain';

export function placementSourceLabel(source: FleetDevicePlacement['source']): string {
  return source === 'field_installation' ? 'Field installation' : 'MaaS assignment';
}

export function safeInstallHubPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const safe = safePortalNext(path, '/fleet');
  return portalAppForPath(safe) === 'installhub' ? safe : null;
}

/**
 * Related Field records remain protected by the Field session. Authenticated
 * users go straight to the record; everyone else is sent through portal login
 * with the same-origin destination retained.
 */
export function installHubDrilldownHref(
  path: string | null | undefined,
  hasInstallHubSession: boolean,
): string | null {
  const safe = safeInstallHubPath(path);
  if (!safe) return null;
  return hasInstallHubSession ? safe : portalLoginRedirectPath(safe, '/fleet');
}
