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
export type FieldLoginAuthority = 'source_user' | 'explicit_field' | null;

export interface FieldSourceUser extends FleetSourceAdmin {
  /** Retained as an ignored compatibility field for older pure callers. */
  identityId?: string | null;
  fieldUserId?: string;
}

type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>;

// A valid bcrypt hash keeps missing/inactive/ineligible lookups on the same
// verification path without exposing whether an app identity exists.
const DUMMY_PASSWORD_HASH = '$2b$10$a1lmvS6vLz25GfpMp58yjOQV3fVZy.pUmhhGpHkZWhcfYt0cLDFSK';
const APP_LOCAL_EMAIL = /^([^@]+)@(ecoaudit|solarsense|installhub|wattwatchers)\.users\.local$/;
const GLOBAL_LOCAL_EMAIL = /^([^@]+)@(ecoaudit|solarsense|installhub)\.users\.local$/;
const SOURCE_APPS: readonly FleetSourceApp[] = ['ecoaudit', 'solarsense'];

export interface GlobalCredentialCandidate {
  globalUserId: string;
  passwordHash: string;
  isActive: boolean;
}

/** Mirrors global_identity_login_key() in migration 0030. */
export function globalLoginKey(value: string): string {
  const normalized = value.toLowerCase().trim();
  const localMatch = GLOBAL_LOCAL_EMAIL.exec(normalized);
  if (localMatch) return `username:${localMatch[1]}`;
  if (!normalized.includes('@')) return `username:${normalized}`;
  return `email:${normalized}`;
}

/**
 * Resolve one canonical identity while retaining every migrated password hash.
 * Two identities accepting the same credential fail closed instead of picking
 * an arbitrary product user ID.
 */
export async function verifyGlobalLoginIdentity(
  candidates: readonly GlobalCredentialCandidate[],
  password: string,
  verifyPassword: PasswordVerifier,
): Promise<{ globalUserId: string; passwordHash: string } | null> {
  const uniqueCredentials = new Map<string, GlobalCredentialCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.globalUserId}\u0000${candidate.passwordHash}`;
    if (!uniqueCredentials.has(key)) uniqueCredentials.set(key, candidate);
  }
  const slots = uniqueCredentials.size > 0
    ? [...uniqueCredentials.values()].map((candidate) => ({
        ...candidate,
        passwordHash: candidate.isActive
          ? candidate.passwordHash
          : DUMMY_PASSWORD_HASH,
      }))
    : [{ globalUserId: '', passwordHash: DUMMY_PASSWORD_HASH, isActive: false }];
  const verified = await Promise.all(slots.map(async (candidate) => {
    try {
      const passwordMatches = await verifyPassword(password, candidate.passwordHash);
      return candidate.isActive && passwordMatches;
    } catch {
      return false;
    }
  }));
  const matches = slots.filter((_candidate, index) => verified[index]);
  const matchingIdentityIds = new Set(matches.map((match) => match.globalUserId));
  if (matchingIdentityIds.size !== 1) return null;
  const match = matches[0]!;
  return { globalUserId: match.globalUserId, passwordHash: match.passwordHash };
}

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

/**
 * Resolve one InstallHub login without collapsing the two source namespaces.
 *
 * A source-local address is an explicit source hint. A plain username,
 * InstallHub-local alias, or real email checks both source memberships because
 * legacy Field clients do not send a source-app selector.
 */
export function sourceIdentitiesForFieldLogin(value: string): {
  fieldEmail: string;
  sourceHint: FleetSourceApp | null;
  sources: readonly [FleetSourceIdentity, FleetSourceIdentity];
} {
  const normalized = value.toLowerCase().trim();
  const localMatch = APP_LOCAL_EMAIL.exec(normalized);
  const localUsername = localMatch?.[1] ?? (!normalized.includes('@')
    ? cloudEmailForLogin('installhub', normalized).split('@', 1)[0]
    : null);
  const localApp = localMatch?.[2];
  const sourceHint = localApp === 'ecoaudit' || localApp === 'solarsense'
    ? localApp
    : null;

  return {
    fieldEmail: localUsername
      ? `${localUsername}@installhub.users.local`
      : normalized,
    sourceHint,
    sources: [
      { app: 'ecoaudit', email: localUsername ? `${localUsername}@ecoaudit.users.local` : normalized },
      { app: 'solarsense', email: localUsername ? `${localUsername}@solarsense.users.local` : normalized },
    ],
  };
}

/**
 * Preserve an exact explicit InstallHub row created with a legacy source-local
 * email. A portal-internal source selection deliberately bypasses explicit
 * Field aliases so the selected source membership remains authoritative.
 */
export function explicitFieldEmailForLogin(
  value: string,
  forcedSourceHint: FleetSourceApp | null = null,
): string | null {
  if (forcedSourceHint) return null;
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) {
    return cloudEmailForLogin('installhub', normalized);
  }
  return sourceIdentitiesForFieldLogin(normalized).fieldEmail;
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

/**
 * Stable Field authorization subject for one source account.
 *
 * The app namespace and original ID are retained verbatim, so this identifier
 * does not rely on a hash collision boundary. The internal email is kept only
 * for compatibility with older pure helpers; no shared registry login exposes
 * it to a client.
 */
export function fieldBridgeIdentity(source: Pick<FieldSourceUser, 'app' | 'id'>): {
  id: string;
  email: string;
} {
  const digest = createHash('md5')
    .update(`${source.app}:${source.id}`)
    .digest('hex');
  return {
    id: `unified-field:${source.app}:${source.id}`,
    email: `unified-field-${digest}@installhub.users.local`,
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

/** Existing explicit Field credentials retain precedence over source bridges. */
export function selectFieldLoginAuthority(
  explicitLoginValid: boolean,
  sourceUser: FieldSourceUser | null,
): FieldLoginAuthority {
  if (explicitLoginValid) return 'explicit_field';
  return sourceUser ? 'source_user' : null;
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

/**
 * Verify current EcoAudit/SolarSense credentials for Field access.
 *
 * Every eligible slot follows a password-verification path. When an unhinted
 * login matches more than one source membership, authentication is rejected so
 * Field ownership cannot be attributed to the wrong app-specific user ID.
 * Supplying an app-local source address selects that exact source membership.
 */
export async function verifyFieldSourceUser(
  users: readonly (FieldSourceUser | null | undefined)[],
  password: string,
  verifyPassword: PasswordVerifier,
  sourceHint: FleetSourceApp | null = null,
): Promise<FieldSourceUser | null> {
  const byApp = new Map<FleetSourceApp, FieldSourceUser>();
  for (const user of users) {
    if (user && !byApp.has(user.app)) byApp.set(user.app, user);
  }

  const slots = SOURCE_APPS.map((sourceApp) => {
    const user = byApp.get(sourceApp);
    const eligible = Boolean(
      user?.isActive && (sourceHint === null || sourceHint === sourceApp),
    );
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
  const matchingUsers = slots
    .map((slot, index) => matches[index] ? slot.user : null)
    .filter((user): user is FieldSourceUser => user !== null);
  if (matchingUsers.length > 1) return null;
  matchingUsers.sort((left, right) => {
    const leftPrivilege = left.role === 'admin' ? 1 : 0;
    const rightPrivilege = right.role === 'admin' ? 1 : 0;
    if (leftPrivilege !== rightPrivilege) return leftPrivilege - rightPrivilege;
    return SOURCE_APPS.indexOf(left.app) - SOURCE_APPS.indexOf(right.app);
  });
  return matchingUsers[0] ?? null;
}
