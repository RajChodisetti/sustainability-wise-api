import assert from 'node:assert/strict';
import test from 'node:test';
import type { unifiedUsers } from '../../db/schema/shared.js';
import {
  buildInstallHubAssignmentResponse,
  isAssignableInstallHubUser,
} from './installations.js';

const sourceCreatedAt = new Date('2026-07-01T00:00:00.000Z');
const sourceUpdatedAt = new Date('2026-07-02T00:00:00.000Z');

function unifiedUser(
  overrides: Partial<typeof unifiedUsers.$inferSelect> = {},
): typeof unifiedUsers.$inferSelect {
  return {
    id: 'unified-user:installhub:field-user',
    originApp: 'installhub',
    originUserId: 'field-user',
    fieldUserId: 'field-user',
    email: 'field@installhub.users.local',
    passwordHash: 'not-returned',
    fullName: 'Field User',
    role: 'inspector',
    isActive: true,
    sourceCreatedAt,
    sourceUpdatedAt,
    syncedAt: sourceUpdatedAt,
    deletedAt: null,
    syncVersion: 1,
    ...overrides,
  };
}

test('assignment response preserves the native Field subject and base fields', () => {
  const response = buildInstallHubAssignmentResponse({
    id: 'installation-1',
    assignedInspectorUserId: 'field-user',
  }, unifiedUser());

  assert.equal(response.installationId, 'installation-1');
  assert.equal(response.assignedInspectorUserId, 'field-user');
  assert.equal(response.assignedInspector?.id, 'field-user');
  assert.equal(
    response.assignedInspector?.email,
    'field@installhub.users.local',
  );
  assert.equal(response.assignedInspector?.fullName, 'Field User');
  assert.equal(response.assignedInspector?.role, 'inspector');
  assert.equal(response.assignedInspector?.isActive, true);
  assert.ok(response.assignedInspector);
  assert.equal('passwordHash' in response.assignedInspector, false);
});

test('assignment response exposes a source account through its synthetic Field subject', () => {
  const sourceUser = unifiedUser({
    id: 'unified-user:ecoaudit:eco-admin',
    originApp: 'ecoaudit',
    originUserId: 'eco-admin',
    fieldUserId: 'unified-field:ecoaudit:eco-admin',
    email: 'admin@ecoaudit.users.local',
    fullName: 'Eco Administrator',
    role: 'admin',
  });
  const response = buildInstallHubAssignmentResponse({
    id: 'installation-1',
    assignedInspectorUserId: sourceUser.fieldUserId,
  }, sourceUser);

  assert.equal(
    response.assignedInspectorUserId,
    'unified-field:ecoaudit:eco-admin',
  );
  assert.equal(
    response.assignedInspector?.id,
    'unified-field:ecoaudit:eco-admin',
  );
  assert.equal(
    response.assignedInspector?.email,
    'admin@ecoaudit.users.local',
  );
  assert.equal(response.assignedInspector?.fullName, 'Eco Administrator');
  assert.equal(response.assignedInspector?.role, 'admin');
  assert.equal(response.assignedInspector?.isActive, true);
});

test('Solar Sense assignments use the same registry-backed Field subject contract', () => {
  const sourceUser = unifiedUser({
    id: 'unified-user:solarsense:solar-inspector',
    originApp: 'solarsense',
    originUserId: 'solar-inspector',
    fieldUserId: 'unified-field:solarsense:solar-inspector',
    email: 'inspector@solarsense.users.local',
    fullName: 'Solar Inspector',
  });
  const response = buildInstallHubAssignmentResponse({
    id: 'installation-1',
    assignedInspectorUserId: sourceUser.fieldUserId,
  }, sourceUser);

  assert.equal(
    response.assignedInspector?.id,
    'unified-field:solarsense:solar-inspector',
  );
  assert.equal(
    response.assignedInspector?.email,
    'inspector@solarsense.users.local',
  );
  assert.equal(response.assignedInspector?.fullName, 'Solar Inspector');
  assert.equal(response.assignedInspector?.role, 'inspector');
  assert.equal(response.assignedInspector?.isActive, true);
});

test('assignment response retains an unresolved subject and returns a null user', () => {
  const response = buildInstallHubAssignmentResponse({
    id: 'installation-1',
    assignedInspectorUserId: 'unified-field:solarsense:deleted-user',
  });

  assert.equal(
    response.assignedInspectorUserId,
    'unified-field:solarsense:deleted-user',
  );
  assert.equal(response.assignedInspector, null);
});

test('only active, non-deleted registry users can be newly assigned', () => {
  assert.equal(isAssignableInstallHubUser(unifiedUser()), true);
  assert.equal(
    isAssignableInstallHubUser(unifiedUser({ isActive: false })),
    false,
  );
  assert.equal(
    isAssignableInstallHubUser(unifiedUser({
      deletedAt: new Date('2026-07-03T00:00:00.000Z'),
    })),
    false,
  );
});
