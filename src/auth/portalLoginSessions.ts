import type { App } from './jwt.js';
import type { FleetSourceApp } from './loginIdentity.js';

export const PORTAL_LOGIN_APPS: readonly App[] = [
  'ecoaudit',
  'solarsense',
  'installhub',
  'wattwatchers',
];

export type PortalLoginSessionMap<Session> = Partial<Record<App, Session>>;

export type PortalAppLogin<Session> = (
  app: App,
  fieldSourceHint?: FleetSourceApp | null,
) => Promise<Session>;

/**
 * Collect independent legacy application sessions for the portal.
 *
 * A targeted login authenticates the requested workspace before any
 * best-effort secondary work. An EcoAudit/SolarSense target is passed to Field
 * as an explicit source hint so two independent source accounts are never
 * silently merged. Untargeted login retries Field only when exactly one source
 * app authenticated.
 */
export async function collectPortalLoginSessions<Session>(
  login: PortalAppLogin<Session>,
  target?: App,
  skipApps: readonly App[] = [],
): Promise<PortalLoginSessionMap<Session>> {
  const sessions: PortalLoginSessionMap<Session> = {};

  if (target) {
    sessions[target] = await login(target);
    const skipped = new Set(skipApps);
    const secondaryApps = PORTAL_LOGIN_APPS.filter(
      (candidate) => candidate !== target && !skipped.has(candidate),
    );
    const secondaryResults = await Promise.allSettled(
      secondaryApps.map((candidate) => login(
        candidate,
        candidate === 'installhub'
          && (target === 'ecoaudit' || target === 'solarsense')
          ? target
          : null,
      )),
    );
    secondaryResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sessions[secondaryApps[index]!] = result.value;
      }
    });
    return sessions;
  }

  const results = await Promise.allSettled(
    PORTAL_LOGIN_APPS.map((candidate) => login(candidate)),
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sessions[PORTAL_LOGIN_APPS[index]!] = result.value;
    }
  });

  if (!sessions.installhub) {
    const matchingSourceApps = (['ecoaudit', 'solarsense'] as const)
      .filter((candidate) => Boolean(sessions[candidate]));
    if (matchingSourceApps.length === 1) {
      try {
        sessions.installhub = await login(
          'installhub',
          matchingSourceApps[0],
        );
      } catch {
        // Preserve the valid source session when Field provisioning fails.
      }
    }
  }

  return sessions;
}
