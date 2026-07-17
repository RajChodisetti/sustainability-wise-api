import type { App } from './jwt.js';

export interface LoginUser {
  passwordHash: string;
  isActive: boolean;
}

type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>;

// A valid bcrypt hash keeps missing/inactive/ineligible lookups on the same
// verification path without exposing whether an app identity exists.
const DUMMY_PASSWORD_HASH = '$2b$10$a1lmvS6vLz25GfpMp58yjOQV3fVZy.pUmhhGpHkZWhcfYt0cLDFSK';

export function cloudEmailForLogin(app: App, value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safeUsername}@${app}.users.local`;
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
