export type UnifiedUserApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type UnifiedUserSourceApp = Exclude<UnifiedUserApp, 'installhub'>;
export type UnifiedUserRole = 'admin' | 'inspector';
export type UnifiedUserSyncStatus =
  | 'synced'
  | 'drifted'
  | 'missing_projection'
  | 'orphaned_projection'
  | 'field_only'
  | 'unlinked';

/**
 * Public directory input selected from the additive unified_users registry.
 *
 * Deliberately excludes passwordHash: directory construction never needs to
 * load credentials into application memory.
 */
export interface UnifiedUserRegistryRow {
  id: string;
  originApp: UnifiedUserApp;
  originUserId: string;
  fieldUserId: string;
  email: string;
  fullName: string | null;
  role: UnifiedUserRole;
  isActive: boolean;
  sourceCreatedAt: Date;
  sourceUpdatedAt: Date;
  deletedAt: Date | null;
}

export interface UnifiedUserMembership {
  app: UnifiedUserApp;
  userId: string;
  identityId: string | null;
  email: string;
  fullName: string | null;
  role: UnifiedUserRole;
  isActive: boolean;
  isSourceProjection: boolean;
  sourceApp: UnifiedUserSourceApp | null;
  sourceUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnifiedUserDirectoryEntry {
  key: string;
  identityIds: string[];
  fullName: string | null;
  displayEmail: string;
  candidateKey: string | null;
  possibleDuplicateCount: number;
  memberships: UnifiedUserMembership[];
  syncStatus: UnifiedUserSyncStatus;
}

interface AppSummary {
  total: number;
  active: number;
  admins: number;
}

export interface UnifiedUserDirectorySummary {
  total: number;
  active: number;
  admins: number;
  needsAttention: number;
  byApp: Record<UnifiedUserApp, AppSummary>;
  bySyncStatus: Record<UnifiedUserSyncStatus, number>;
}

export interface UnifiedUserDirectory {
  data: UnifiedUserDirectoryEntry[];
  summary: UnifiedUserDirectorySummary;
}

const LOCAL_LOGIN_PATTERN =
  /^([^@]+)@(ecoaudit|solarsense|installhub)\.users\.local$/;

function canonicalCandidateKey(email: string): string | null {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;
  const localLogin = LOCAL_LOGIN_PATTERN.exec(normalized);
  if (localLogin) return `username:${localLogin[1]}`;
  return `email:${normalized}`;
}

function membership(
  user: UnifiedUserRegistryRow,
  app: UnifiedUserApp,
  userId: string,
  sourceApp: UnifiedUserSourceApp | null,
): UnifiedUserMembership {
  return {
    app,
    userId,
    identityId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    isSourceProjection: sourceApp !== null,
    sourceApp,
    sourceUserId: sourceApp ? user.originUserId : null,
    createdAt: user.sourceCreatedAt,
    updatedAt: user.sourceUpdatedAt,
  };
}

function directoryEntry(
  user: UnifiedUserRegistryRow,
): UnifiedUserDirectoryEntry {
  const sourceApp = user.originApp === 'installhub'
    ? null
    : user.originApp;
  const memberships: UnifiedUserMembership[] = sourceApp
    ? [
        membership(user, sourceApp, user.originUserId, null),
        membership(user, 'installhub', user.fieldUserId, sourceApp),
      ]
    : [
        membership(user, 'installhub', user.fieldUserId, null),
      ];

  return {
    key: `${user.originApp}:${user.originUserId}`,
    identityIds: [user.id],
    fullName: user.fullName,
    displayEmail: user.email,
    candidateKey: canonicalCandidateKey(user.email),
    possibleDuplicateCount: 0,
    memberships,
    // Source origins include their Field membership in the registry itself;
    // native Field origins remain field_only so existing edit affordances work.
    syncStatus: sourceApp ? 'synced' : 'field_only',
  };
}

function emptyAppSummary(): Record<UnifiedUserApp, AppSummary> {
  return {
    ecoaudit: { total: 0, active: 0, admins: 0 },
    solarsense: { total: 0, active: 0, admins: 0 },
    installhub: { total: 0, active: 0, admins: 0 },
  };
}

function emptySyncSummary(): Record<UnifiedUserSyncStatus, number> {
  return {
    synced: 0,
    drifted: 0,
    missing_projection: 0,
    orphaned_projection: 0,
    field_only: 0,
    unlinked: 0,
  };
}

function directorySummary(
  entries: readonly UnifiedUserDirectoryEntry[],
): UnifiedUserDirectorySummary {
  const byApp = emptyAppSummary();
  const bySyncStatus = emptySyncSummary();

  for (const entry of entries) {
    bySyncStatus[entry.syncStatus] += 1;
    for (const userMembership of entry.memberships) {
      const appSummary = byApp[userMembership.app];
      appSummary.total += 1;
      if (userMembership.isActive) appSummary.active += 1;
      if (userMembership.role === 'admin') appSummary.admins += 1;
    }
  }

  return {
    total: entries.length,
    active: entries.filter((entry) => (
      entry.memberships.some((userMembership) => userMembership.isActive)
    )).length,
    admins: entries.filter((entry) => (
      entry.memberships.some((userMembership) => userMembership.role === 'admin')
    )).length,
    needsAttention: entries.filter((entry) => (
      entry.syncStatus === 'drifted'
      || entry.syncStatus === 'missing_projection'
      || entry.syncStatus === 'orphaned_projection'
      || entry.syncStatus === 'unlinked'
    )).length,
    byApp,
    bySyncStatus,
  };
}

export function buildUnifiedUserDirectory(
  users: readonly UnifiedUserRegistryRow[],
): UnifiedUserDirectory {
  // The route filters tombstones in SQL; retain this guard so direct callers
  // cannot accidentally surface deleted credentials in the current directory.
  const entries = users
    .filter((user) => user.deletedAt === null)
    .map(directoryEntry);

  const candidateCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.candidateKey) continue;
    candidateCounts.set(
      entry.candidateKey,
      (candidateCounts.get(entry.candidateKey) ?? 0) + 1,
    );
  }
  for (const entry of entries) {
    entry.possibleDuplicateCount = entry.candidateKey
      ? Math.max(0, (candidateCounts.get(entry.candidateKey) ?? 1) - 1)
      : 0;
  }

  entries.sort((left, right) => {
    const leftLabel = left.fullName ?? left.displayEmail;
    const rightLabel = right.fullName ?? right.displayEmail;
    return leftLabel.localeCompare(rightLabel)
      || left.key.localeCompare(right.key);
  });

  return {
    data: entries,
    summary: directorySummary(entries),
  };
}
