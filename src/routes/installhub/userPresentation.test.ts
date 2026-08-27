import assert from 'node:assert/strict';
import test from 'node:test';
import type { unifiedUsers } from '../../db/schema/shared.js';
import {
  installHubPasswordRevocationTargets,
  isSourceManagedInstallHubUser,
  presentUnifiedInstallHubUser,
} from './users.js';

const createdAt = new Date('2026-07-01T00:00:00.000Z');
const updatedAt = new Date('2026-07-02T00:00:00.000Z');

function registryUser(
  overrides: Partial<typeof unifiedUsers.$inferSelect> = {},
): typeof unifiedUsers.$inferSelect {
  return {
    id: 'unified-user:installhub:field-user',
    globalUserId: 'global-user:installhub:field-user',
    originApp: 'installhub',
    originUserId: 'field-user',
    fieldUserId: 'field-user',
    email: 'field@installhub.users.local',
    passwordHash: 'field-password-hash',
    fullName: 'Field User',
    role: 'inspector',
    isActive: true,
    sourceCreatedAt: createdAt,
    sourceUpdatedAt: updatedAt,
    syncedAt: updatedAt,
    deletedAt: null,
    syncVersion: 1,
    ...overrides,
  };
}

test('native Field users retain the legacy public account envelope', () => {
  const presented = presentUnifiedInstallHubUser(registryUser());

  assert.deepEqual(presented, {
    id: 'field-user',
    email: 'field@installhub.users.local',
    fullName: 'Field User',
    role: 'inspector',
    isActive: true,
    createdAt,
    updatedAt,
    sourceManaged: false,
    isMaintainer: false,
    sourceApp: null,
    sourceState: 'explicit',
  });
  assert.equal(
    isSourceManagedInstallHubUser(registryUser()),
    false,
  );
});

test('maintainer authority is exposed independently from administrator role', () => {
  const presented = presentUnifiedInstallHubUser({
    ...registryUser({ role: 'inspector' }),
    isMaintainer: true,
  });
  assert.equal(presented.role, 'inspector');
  assert.equal(presented.isMaintainer, true);
});

test('Eco Audit registry rows expose their synthetic Field subject and current source role', () => {
  const user = registryUser({
    id: 'unified-user:ecoaudit:eco-admin',
    originApp: 'ecoaudit',
    originUserId: 'eco-admin',
    fieldUserId: 'unified-field:ecoaudit:eco-admin',
    email: 'admin@ecoaudit.users.local',
    fullName: 'Eco Administrator',
    role: 'admin',
    isActive: true,
  });
  const presented = presentUnifiedInstallHubUser(user);

  assert.equal(presented.id, 'unified-field:ecoaudit:eco-admin');
  assert.equal(presented.email, 'admin@ecoaudit.users.local');
  assert.equal(presented.fullName, 'Eco Administrator');
  assert.equal(presented.role, 'admin');
  assert.equal(presented.isActive, true);
  assert.equal(presented.sourceManaged, true);
  assert.equal(presented.sourceApp, 'ecoaudit');
  assert.equal(presented.sourceState, 'linked');
  assert.equal(isSourceManagedInstallHubUser(user), true);
});

test('deleted Solar Sense origins remain traceable inactive read-only subjects', () => {
  const deletedAt = new Date('2026-07-03T00:00:00.000Z');
  const presented = presentUnifiedInstallHubUser(registryUser({
    id: 'unified-user:solarsense:deleted-solar-user',
    originApp: 'solarsense',
    originUserId: 'deleted-solar-user',
    fieldUserId: 'unified-field:solarsense:deleted-solar-user',
    email: 'former.user@solarsense.users.local',
    fullName: 'Former Solar User',
    role: 'inspector',
    isActive: false,
    deletedAt,
  }));

  assert.equal(
    presented.id,
    'unified-field:solarsense:deleted-solar-user',
  );
  assert.equal(
    presented.email,
    'former.user@solarsense.users.local',
  );
  assert.equal(presented.isActive, false);
  assert.equal(presented.sourceManaged, true);
  assert.equal(presented.sourceApp, 'solarsense');
  assert.equal(presented.sourceState, 'orphaned');
});

test('source password changes revoke both source and synthetic Field sessions', () => {
  assert.deepEqual(
    installHubPasswordRevocationTargets(registryUser({
      originApp: 'ecoaudit',
      originUserId: 'eco-admin',
      fieldUserId: 'unified-field:ecoaudit:eco-admin',
    })),
    [
      { app: 'ecoaudit', userId: 'eco-admin' },
      {
        app: 'installhub',
        userId: 'unified-field:ecoaudit:eco-admin',
      },
    ],
  );
});

test('native password changes revoke only the existing Field session', () => {
  assert.deepEqual(
    installHubPasswordRevocationTargets(registryUser()),
    [{ app: 'installhub', userId: 'field-user' }],
  );
});
