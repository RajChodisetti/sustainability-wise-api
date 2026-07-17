import { createHash } from 'node:crypto';
import type { App } from './jwt.js';

export interface LoginUser {
  passwordHash: string;
  isActive: boolean;
}

export type FleetSourceApp = Extract<App, 'ecoaudit' | 'solarsense'>;

export interface FleetSourceIdentity {
  app: FleetSourceApp;
  email: string;
}

export interface FleetSourceAdmin extends LoginUser {
  app: FleetSourceApp;
  id: string;
  email: string;
  fullName: string | null;
  role: string;
}

export type FleetLoginAuthority = 'source_admin' | 'explicit_fleet' | null;

type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>;

// A valid bcrypt hash keeps missing/inactive/ineligible lookups on the same
// verification path without exposing whether an app identity exists.
const DUMMY_PASSWORD_HASH = '$2b$10$a1lmvS6vLz25GfpMp58yjOQV3fVZy.pUmhhGpHkZWhcfYt0cLDFSK';
const APP_LOCAL_EMAIL = /^([^@]+)@(ecoaudit|solarsense|wattwatchers)\.users\.local$/;
const SOURCE_APPS: readonly FleetSourceApp[] = ['ecoaudit', 'solarsense'];

export function cloudEmailForLogin(app: App, value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safeUsername}@${app}.users.local`;
}

export function sourceIdentitiesForFleetLogin(value: string): {
  fleetEmail: string;
  sources: readonly [FleetSourceIdentity, FleetSourceIdentity];
} {
  const normalized = value.toLowerCase().trim();
  const localMatch = APP_LOCAL_EMAIL.exec(normalized);
  const localUsername = localMatch?.[1] ?? (!normalized.includes('@')
    ? cloudEmailForLogin('wattwatchers', normalized).split('@', 1)[0]
    : null);
  const fleetEmail = localUsername
    ? `${localUsername}@wattwatchers.users.local`
    : normalized;

  return {
    fleetEmail,
    sources: [
      { app: 'ecoaudit', email: localUsername ? `${localUsername}@ecoaudit.users.local` : normalized },
      { app: 'solarsense', email: localUsername ? `${localUsername}@solarsense.users.local` : normalized },
    ],
  };
}

/** Keep a source-controlled shadow separate from explicit Fleet identities. */
export function fleetBridgeIdentity(source: Pick<FleetSourceAdmin, 'app' | 'id'>): {
  id: string;
  email: string;
} {
  const digest = createHash('sha256')
    .update(`${source.app}:${source.id}`)
    .digest('hex')
    .slice(0, 32);
  return {
    id: `bridge-${digest}`,
    email: `bridge-${digest}@wattwatchers.users.local`,
  };
}

export async function verifyActiveLogin(
  user: LoginUser | null | undefined,
  password: string,
  verifyPassword: PasswordVerifier,
): Promise<boolean> {
  const passwordHash = user?.isActive ? user.passwordHash : DUMMY_PASSWORD_HASH;
  try {
    return Boolean(user?.isActive && await verifyPassword(password, passwordHash));
  } catch {
    return false;
  }
}

/** Source-admin entitlement wins if the same credential also matches a Fleet user. */
export function selectFleetLoginAuthority(
  explicitLoginValid: boolean,
  sourceAdmin: FleetSourceAdmin | null,
): FleetLoginAuthority {
  if (sourceAdmin) return 'source_admin';
  return explicitLoginValid ? 'explicit_fleet' : null;
}

/** Verify both source slots; only an active administrator may bridge. */
export async function verifyFleetSourceAdmin(
  users: readonly (FleetSourceAdmin | null | undefined)[],
  password: string,
  verifyPassword: PasswordVerifier,
): Promise<FleetSourceAdmin | null> {
  const byApp = new Map<FleetSourceApp, FleetSourceAdmin>();
  for (const user of users) {
    if (user && !byApp.has(user.app)) byApp.set(user.app, user);
  }

  const slots = SOURCE_APPS.map((sourceApp) => {
    const user = byApp.get(sourceApp);
    const eligible = Boolean(user?.isActive && user.role === 'admin');
    return {
      user: eligible ? user! : null,
      passwordHash: eligible ? user!.passwordHash : DUMMY_PASSWORD_HASH,
    };
  });

  const matches = await Promise.all(slots.map(async ({ passwordHash }) => {
    try {
      return await verifyPassword(password, passwordHash);
    } catch {
      return false;
    }
  }));

  const matchingIndex = matches.findIndex((matchesPassword, index) => (
    matchesPassword && slots[index]?.user !== null
  ));
  return matchingIndex === -1 ? null : slots[matchingIndex]!.user;
}
