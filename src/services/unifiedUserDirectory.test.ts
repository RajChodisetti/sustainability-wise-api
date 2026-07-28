import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUnifiedUserDirectory,
  type UnifiedUserRegistryRow,
} from './unifiedUserDirectory.js';

const sourceCreatedAt = new Date('2026-07-01T00:00:00.000Z');
const sourceUpdatedAt = new Date('2026-07-02T00:00:00.000Z');

function registryUser(
  overrides: Partial<UnifiedUserRegistryRow> = {},
): UnifiedUserRegistryRow {
  return {
    id: 'unified-user:ecoaudit:eco-1',
    originApp: 'ecoaudit',
    originUserId: 'eco-1',
    fieldUserId: 'unified-field:ecoaudit:eco-1',
    email: 'alex@ecoaudit.users.local',
    fullName: 'Alex Installer',
    role: 'inspector',
    isActive: true,
    sourceCreatedAt,
    sourceUpdatedAt,
    deletedAt: null,
    ...overrides,
  };
}

test('derives Eco and Solar source plus Field memberships from registry rows', () => {
  const result = buildUnifiedUserDirectory([
    registryUser({
      role: 'admin',
    }),
    registryUser({
      id: 'unified-user:solarsense:solar-1',
      originApp: 'solarsense',
      originUserId: 'solar-1',
      fieldUserId: 'unified-field:solarsense:solar-1',
      email: 'sam@solarsense.users.local',
      fullName: 'Sam Solar',
    }),
  ]);

  const byKey = new Map(result.data.map((entry) => [entry.key, entry]));
  assert.deepEqual(
    byKey.get('ecoaudit:eco-1')?.identityIds,
    ['unified-user:ecoaudit:eco-1'],
  );
  assert.deepEqual(
    byKey.get('ecoaudit:eco-1')?.memberships.map((item) => ({
      app: item.app,
      userId: item.userId,
      role: item.role,
      isSourceProjection: item.isSourceProjection,
      sourceApp: item.sourceApp,
      sourceUserId: item.sourceUserId,
    })),
    [
      {
        app: 'ecoaudit',
        userId: 'eco-1',
        role: 'admin',
        isSourceProjection: false,
        sourceApp: null,
        sourceUserId: null,
      },
      {
        app: 'installhub',
        userId: 'unified-field:ecoaudit:eco-1',
        role: 'admin',
        isSourceProjection: true,
        sourceApp: 'ecoaudit',
        sourceUserId: 'eco-1',
      },
    ],
  );
  assert.deepEqual(
    byKey.get('solarsense:solar-1')?.memberships.map((item) => item.app),
    ['solarsense', 'installhub'],
  );
  assert.ok(result.data.every((entry) => entry.syncStatus === 'synced'));
  assert.equal(result.summary.needsAttention, 0);
});

test('keeps a native Field origin editable as one field_only membership', () => {
  const result = buildUnifiedUserDirectory([
    registryUser({
      id: 'unified-user:installhub:field-1',
      originApp: 'installhub',
      originUserId: 'field-1',
      fieldUserId: 'field-1',
      email: 'field.admin@installhub.users.local',
      fullName: 'Field Administrator',
      role: 'admin',
    }),
  ]);

  assert.deepEqual(result.data[0], {
    key: 'installhub:field-1',
    identityIds: ['unified-user:installhub:field-1'],
    fullName: 'Field Administrator',
    displayEmail: 'field.admin@installhub.users.local',
    candidateKey: 'username:field.admin',
    possibleDuplicateCount: 0,
    memberships: [{
      app: 'installhub',
      userId: 'field-1',
      identityId: 'unified-user:installhub:field-1',
      email: 'field.admin@installhub.users.local',
      fullName: 'Field Administrator',
      role: 'admin',
      isActive: true,
      isSourceProjection: false,
      sourceApp: null,
      sourceUserId: null,
      createdAt: sourceCreatedAt,
      updatedAt: sourceUpdatedAt,
    }],
    syncStatus: 'field_only',
  });
  assert.equal(result.summary.bySyncStatus.field_only, 1);
  assert.equal(result.summary.needsAttention, 0);
});

test('keeps equal usernames independent and flags all duplicate candidates', () => {
  const result = buildUnifiedUserDirectory([
    registryUser(),
    registryUser({
      id: 'unified-user:solarsense:solar-1',
      originApp: 'solarsense',
      originUserId: 'solar-1',
      fieldUserId: 'unified-field:solarsense:solar-1',
      email: 'ALEX@solarsense.users.local',
      fullName: 'Alex Solar',
    }),
    registryUser({
      id: 'unified-user:installhub:field-1',
      originApp: 'installhub',
      originUserId: 'field-1',
      fieldUserId: 'field-1',
      email: 'alex@installhub.users.local',
      fullName: 'Alex Field',
    }),
  ]);

  assert.equal(result.data.length, 3);
  assert.ok(result.data.every((entry) => entry.candidateKey === 'username:alex'));
  assert.ok(result.data.every((entry) => entry.possibleDuplicateCount === 2));
  assert.equal(new Set(result.data.map((entry) => entry.key)).size, 3);
});

test('omits tombstones from directory data, duplicate hints and summary', () => {
  const result = buildUnifiedUserDirectory([
    registryUser(),
    registryUser({
      id: 'unified-user:solarsense:deleted',
      originApp: 'solarsense',
      originUserId: 'deleted',
      fieldUserId: 'unified-field:solarsense:deleted',
      email: 'alex@solarsense.users.local',
      deletedAt: new Date('2026-07-03T00:00:00.000Z'),
    }),
  ]);

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.possibleDuplicateCount, 0);
  assert.equal(result.summary.total, 1);
  assert.deepEqual(result.summary.byApp.solarsense, {
    total: 0,
    active: 0,
    admins: 0,
  });
});

test('summarizes origin and derived Field memberships without double-counting people', () => {
  const result = buildUnifiedUserDirectory([
    registryUser({ role: 'admin' }),
    registryUser({
      id: 'unified-user:solarsense:solar-1',
      originApp: 'solarsense',
      originUserId: 'solar-1',
      fieldUserId: 'unified-field:solarsense:solar-1',
      email: 'inactive@solarsense.users.local',
      fullName: 'Inactive Solar',
      isActive: false,
    }),
    registryUser({
      id: 'unified-user:installhub:field-1',
      originApp: 'installhub',
      originUserId: 'field-1',
      fieldUserId: 'field-1',
      email: 'native@installhub.users.local',
      fullName: 'Native Field',
    }),
  ]);

  assert.deepEqual(result.summary, {
    total: 3,
    active: 2,
    admins: 1,
    needsAttention: 0,
    byApp: {
      ecoaudit: { total: 1, active: 1, admins: 1 },
      solarsense: { total: 1, active: 0, admins: 0 },
      installhub: { total: 3, active: 2, admins: 1 },
    },
    bySyncStatus: {
      synced: 2,
      drifted: 0,
      missing_projection: 0,
      orphaned_projection: 0,
      field_only: 1,
      unlinked: 0,
    },
  });
});
