import type { PortalApp } from '@/lib/portalNavigation';
import type { CloudUser } from '@/types/domain';
import type { FleetUser } from '@/modules/fleet/types/domain';
import type { InstallHubUser } from '@/modules/installhub/types/domain';
import type { CloudUser as SolarCloudUser } from '@solar/types/domain';
import { API_URL } from '@/lib/config';

type PortalSessionUser = {
  ecoaudit: CloudUser;
  solarsense: SolarCloudUser;
  installhub: InstallHubUser;
  wattwatchers: FleetUser;
};

export type PortalLoginSession<App extends PortalApp = PortalApp> = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PortalSessionUser[App];
};

export type PortalLoginSessions = {
  [App in PortalApp]?: PortalLoginSession<App>;
};

export type PortalLoginResponse = {
  sessions: PortalLoginSessions;
};

export type PortalLoginInput = {
  email: string;
  password: string;
  target?: PortalApp;
  skipApps?: PortalApp[];
};

export type PortalLoginHandlers = {
  [App in PortalApp]: (session: PortalLoginSession<App>) => void;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class PortalLoginHttpError extends Error {
  readonly type = 'api' as const;

  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export class PortalLoginNetworkError extends Error {
  readonly type = 'network' as const;
}

export class PortalLoginResponseError extends Error {
  readonly type = 'response' as const;
}

const APPS = [
  'ecoaudit',
  'solarsense',
  'installhub',
  'wattwatchers',
] as const satisfies readonly PortalApp[];

function errorDetail(text: string): string {
  try {
    const json = JSON.parse(text) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const candidate = json.detail ?? json.message ?? json.error;
    return typeof candidate === 'string' && candidate.trim() ? candidate : text;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPortalLoginSession(value: unknown): value is PortalLoginSession {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresIn === 'number' &&
    Number.isFinite(value.expiresIn) &&
    typeof value.user.id === 'string' &&
    value.user.id.length > 0
  );
}

function parsePortalLoginResponse(value: unknown): PortalLoginResponse {
  if (!isRecord(value) || !isRecord(value.sessions)) {
    throw new PortalLoginResponseError('Invalid portal authentication response.');
  }

  const sessions: PortalLoginSessions = {};
  for (const app of APPS) {
    const session = value.sessions[app];
    if (session === undefined) continue;
    if (!isPortalLoginSession(session)) {
      throw new PortalLoginResponseError(
        `Invalid ${app} session in portal authentication response.`,
      );
    }
    sessions[app] = session as never;
  }

  return { sessions };
}

export function isPortalLoginUnavailable(error: unknown): boolean {
  return (
    error instanceof PortalLoginHttpError &&
    [404, 405, 501].includes(error.status)
  );
}

export type FieldSessionSourceApp = 'ecoaudit' | 'solarsense';

export function fieldSessionSourceOptions(input: {
  ecoAccessToken: string | null;
  ecoAuthenticated: boolean;
  solarAccessToken: string | null;
  solarAuthenticated: boolean;
}): FieldSessionSourceApp[] {
  return [
    ...(input.ecoAuthenticated && input.ecoAccessToken
      ? ['ecoaudit' as const]
      : []),
    ...(input.solarAuthenticated && input.solarAccessToken
      ? ['solarsense' as const]
      : []),
  ];
}

/** Select one unambiguous existing source session for Field token exchange. */
export function fieldSessionSourceToken(input: {
  ecoAccessToken: string | null;
  ecoAuthenticated: boolean;
  solarAccessToken: string | null;
  solarAuthenticated: boolean;
}): string | null {
  // If both token stores are populated, wait for both source sessions to
  // resolve. Otherwise the faster /me request could win nondeterministically
  // and provision Field from the wrong independent source account.
  if (input.ecoAccessToken && input.solarAccessToken) return null;
  const sources = fieldSessionSourceOptions(input);
  if (sources.length !== 1) return null;
  return sources[0] === 'ecoaudit'
    ? input.ecoAccessToken
    : input.solarAccessToken;
}

export async function requestPortalLogin(
  input: PortalLoginInput,
  fetcher: FetchLike = fetch,
): Promise<PortalLoginResponse> {
  let response: Response;
  try {
    response = await fetcher(`${API_URL}/v1/auth/portal-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        ...(input.target ? { target: input.target } : {}),
        ...(input.skipApps?.length ? { skipApps: input.skipApps } : {}),
      }),
    });
  } catch (error) {
    throw new PortalLoginNetworkError(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const detail = errorDetail(text) || response.statusText || 'Portal login failed.';
    throw new PortalLoginHttpError(detail, response.status, detail);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new PortalLoginResponseError('Invalid portal authentication response.');
  }

  const parsed = parsePortalLoginResponse(data);
  const apps = APPS.filter((app) => parsed.sessions[app]);
  if (input.target && !parsed.sessions[input.target]) {
    throw new PortalLoginResponseError(
      `Portal authentication did not return the required ${input.target} session.`,
    );
  }
  if (!input.target && apps.length === 0) {
    throw new PortalLoginResponseError(
      'Portal authentication did not return an application session.',
    );
  }
  return parsed;
}

/**
 * Exchange one already-verified Eco Audit or Solar Sense portal JWT for a
 * separate Field session. No credential is re-prompted or shared between app
 * token stores.
 */
export async function requestFieldSession(
  sourceAccessToken: string,
  sourceRefreshToken: string,
  fetcher: FetchLike = fetch,
): Promise<PortalLoginSession<'installhub'>> {
  let response: Response;
  try {
    response = await fetcher(`${API_URL}/v1/auth/field-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sourceAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: sourceRefreshToken }),
    });
  } catch (error) {
    throw new PortalLoginNetworkError(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    const detail = errorDetail(text) || response.statusText || 'Field session failed.';
    throw new PortalLoginHttpError(detail, response.status, detail);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new PortalLoginResponseError('Invalid Field authentication response.');
  }
  if (!isPortalLoginSession(data)) {
    throw new PortalLoginResponseError('Invalid Field authentication response.');
  }
  return data as PortalLoginSession<'installhub'>;
}

export function applyPortalLoginSessions(
  response: PortalLoginResponse,
  handlers: PortalLoginHandlers,
): PortalApp[] {
  const applied: PortalApp[] = [];
  for (const app of APPS) {
    const session = response.sessions[app];
    if (!session) continue;
    handlers[app](session as never);
    applied.push(app);
  }
  return applied;
}

/**
 * Targeted workspace login must not replace an already-active secondary app
 * session. Shared portal login intentionally refreshes every matched session.
 */
export function shouldApplyPortalLoginSession(
  target: PortalApp | null | undefined,
  app: PortalApp,
  hadExistingSession: boolean,
): boolean {
  return !target || target === app || !hadExistingSession;
}
