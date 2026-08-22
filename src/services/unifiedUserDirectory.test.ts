import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUnifiedUserDirectory,
  type UnifiedUserApp,
  type UnifiedUserRegistryRow,
} from './unifiedUserDirectory.js';

const sourceCreatedAt = new Date('2026-07-01T00:00:00.000Z');
const sourceUpdatedAt = new Date('2026-07-02T00:00:00.000Z');
const globalUpdatedAt = new Date('2026-07-03T00:00:00.000Z');

function registryUser(
  app: UnifiedUserApp,
  overrides: Partial<UnifiedUserRegistryRow> = {},
): UnifiedUserRegistryRow {
  const userIds: Record<UnifiedUserApp, string> = {
    ecoaudit: 'eco-1',
    solarsense: 'solar-1',
    installhub: 'field-1',
  };
  return {
    id: `unified-user:${app}:${userIds[app]}`,
    globalUserId: 'global-user:installhub:field-1',
    globalLoginKey: 'username:alex',
    globalDisplayEmail: 'alex@installhub.users.local',
    billingRateCents: 12_345,
    globalTimezone: 'Australia/Sydney',
    globalWorkingDaysMask: 62,
    globalUpdatedAt,
    originApp: app,
    originUserId: userIds[app],
    fieldUserId: 'field-1',
    email: `alex@${app}.users.local`,
    fullName: 'Alex Installer',
    role: 'admin',
    isActive: true,
    sourceCreatedAt,
    sourceUpdatedAt,
    deletedAt: null,
    ...overrides,
  };
}

test('groups one canonical person with all three product memberships', () => {
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit'),
    registryUser('solarsense'),
    registryUser('installhub'),
  ]);

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.key, 'global-user:installhub:field-1');
  assert.equal(result.data[0]?.billingRate, 123.45);
  assert.equal(result.data[0]?.timezone, 'Australia/Sydney');
  assert.equal(result.data[0]?.workingDaysMask, 62);
  assert.equal(result.data[0]?.updatedAt, globalUpdatedAt);
  assert.equal(result.data[0]?.syncStatus, 'synced');
  assert.deepEqual(result.data[0]?.memberships.map((membership) => ({
    app: membership.app,
    userId: membership.userId,
    fieldUserId: membership.fieldUserId,
    identityId: membership.identityId,
    role: membership.role,
  })), [
    {
      app: 'ecoaudit', userId: 'eco-1', fieldUserId: 'field-1',
      identityId: 'global-user:installhub:field-1', role: 'admin',
    },
    {
      app: 'installhub', userId: 'field-1', fieldUserId: 'field-1',
      identityId: 'global-user:installhub:field-1', role: 'admin',
    },
    {
      app: 'solarsense', userId: 'solar-1', fieldUserId: 'field-1',
      identityId: 'global-user:installhub:field-1', role: 'admin',
    },
  ]);
  assert.deepEqual(result.summary.byApp, {
    ecoaudit: { total: 1, active: 1, admins: 1 },
    solarsense: { total: 1, active: 1, admins: 1 },
    installhub: { total: 1, active: 1, admins: 1 },
  });
});

test('returns a missing billing rate once on the canonical directory entry', () => {
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit', { billingRateCents: null }),
    registryUser('solarsense', { billingRateCents: null }),
    registryUser('installhub', { billingRateCents: null }),
  ]);

  assert.equal(result.data[0]?.billingRate, null);
  assert.equal(
    Object.hasOwn(result.data[0]?.memberships[0] ?? {}, 'billingRate'),
    false,
  );
});

test('fails closed when a stored billing rate cannot be represented safely', () => {
  assert.throws(
    () => buildUnifiedUserDirectory([
      registryUser('installhub', { billingRateCents: Number.MAX_SAFE_INTEGER + 1 }),
    ]),
    /outside the supported accounting range/,
  );
});

test('fails closed when a stored working-days mask is outside the supported range', () => {
  for (const globalWorkingDaysMask of [0, 128, 1.5]) {
    assert.throws(
      () => buildUnifiedUserDirectory([
        registryUser('installhub', { globalWorkingDaysMask }),
      ]),
      /working-days mask is outside the supported range/,
    );
  }
});

test('marks a missing product projection for attention', () => {
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit'),
    registryUser('installhub'),
  ]);
  assert.equal(result.data[0]?.syncStatus, 'missing_projection');
  assert.equal(result.summary.needsAttention, 1);
});

test('marks membership profile or role drift for attention', () => {
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit'),
    registryUser('solarsense', { role: 'inspector' }),
    registryUser('installhub'),
  ]);
  assert.equal(result.data[0]?.syncStatus, 'drifted');
  assert.equal(result.summary.needsAttention, 1);
});

test('keeps deterministic ordinal identities separate and flags login ambiguity', () => {
  const second = {
    globalUserId: 'global-user:ecoaudit:eco-2',
    globalDisplayEmail: 'alex@ecoaudit.users.local',
    originUserId: 'eco-2',
    fieldUserId: 'unified-field:ecoaudit:eco-2',
  };
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit'),
    registryUser('solarsense'),
    registryUser('installhub'),
    registryUser('ecoaudit', second),
    registryUser('solarsense', { ...second, originUserId: 'solar-2' }),
    registryUser('installhub', { ...second, originUserId: second.fieldUserId }),
  ]);
  assert.equal(result.data.length, 2);
  assert.ok(result.data.every((entry) => entry.candidateKey === 'username:alex'));
  assert.ok(result.data.every((entry) => entry.possibleDuplicateCount === 1));
});

test('omits tombstones from grouping and summary', () => {
  const result = buildUnifiedUserDirectory([
    registryUser('ecoaudit'),
    registryUser('solarsense'),
    registryUser('installhub', { deletedAt: sourceUpdatedAt }),
  ]);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.memberships.length, 2);
  assert.equal(result.summary.byApp.installhub.total, 0);
});
