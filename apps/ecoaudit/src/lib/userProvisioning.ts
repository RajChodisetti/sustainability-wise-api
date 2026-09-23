export type EcoAuditUserRole = 'admin' | 'inspector';

export type EcoAuditUserProvisioningInput = {
  fullName: string;
  usernameOrEmail: string;
  password: string;
  role: EcoAuditUserRole;
  legacyLocalId?: string;
};

export type EcoAuditUserCreateBody = {
  id?: string;
  email: string;
  password: string;
  fullName: string;
  role: EcoAuditUserRole;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function cloudEmailForEcoAuditUser(value: string): string {
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized
    .replace(/[^a-z0-9._-]/gu, '-')
    .replace(/-+/gu, '-');
  return `${safeUsername}@ecoaudit.users.local`;
}

export function buildEcoAuditUserCreateBody(
  input: EcoAuditUserProvisioningInput,
): EcoAuditUserCreateBody {
  const fullName = input.fullName.trim();
  const usernameOrEmail = input.usernameOrEmail.trim();
  const legacyLocalId = input.legacyLocalId?.trim() ?? '';

  if (!fullName) throw new Error('Full name is required.');
  if (!usernameOrEmail) throw new Error('Username or email is required.');
  if (input.password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  if (legacyLocalId && !UUID_PATTERN.test(legacyLocalId)) {
    throw new Error('Legacy local account ID must be a valid UUID.');
  }

  return {
    ...(legacyLocalId ? { id: legacyLocalId } : {}),
    email: cloudEmailForEcoAuditUser(usernameOrEmail),
    password: input.password,
    fullName,
    role: input.role,
  };
}
